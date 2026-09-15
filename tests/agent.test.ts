import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assessSignalQuality, generateWindow } from '../lib/signal.ts';
import { BaselineModel, CHANNELS, COHORT_BASELINE, infer, link, MODEL_BYTES, Z_LIMIT } from '../lib/model.ts';
import { ACTION_TONE, type Action, EVENT_LOG_LENGTH, POLICY, PulseGuardAgent } from '../lib/agent.ts';

/** Drive the agent for `n` windows and return every action it chose. */
function run(agent: PulseGuardAgent, n: number): Action[] {
  const actions: Action[] = [];
  for (let i = 0; i < n; i += 1) actions.push(agent.step().action);
  return actions;
}

describe('deterministic signal source', () => {
  it('produces identical windows for the same (scenario, index)', () => {
    assert.deepEqual(generateWindow('drift', 5), generateWindow('drift', 5));
  });

  it('produces different windows for different indices', () => {
    assert.notDeepEqual(generateWindow('drift', 5), generateWindow('drift', 6));
  });
});

describe('signal quality gate', () => {
  it('accepts clean resting windows', () => {
    for (let k = 0; k < 20; k += 1) {
      const { quality } = assessSignalQuality(generateWindow('stable', k));
      assert.ok(quality >= POLICY.QUALITY_FLOOR, `stable window ${k} scored ${quality}`);
    }
  });

  it('rejects every motion-corrupted window', () => {
    for (let k = 0; k < 20; k += 1) {
      const { quality } = assessSignalQuality(generateWindow('artifact', k));
      assert.ok(quality < POLICY.QUALITY_FLOOR, `artifact window ${k} scored ${quality}`);
    }
  });

  it('keeps true deterioration measurable — quality stays high while risk rises', () => {
    for (let k = 0; k < 20; k += 1) {
      const { quality } = assessSignalQuality(generateWindow('critical', k));
      assert.ok(quality >= POLICY.QUALITY_FLOOR, `critical window ${k} scored ${quality}`);
    }
  });
});

describe('int8 quantized model', () => {
  it('is monotone in every feature', () => {
    const base = { hr: 0, spo2: 0, temp: 0, activity: 0 };
    for (const channel of CHANNELS) {
      let previous = -Infinity;
      for (let z = 0; z <= Z_LIMIT; z += 0.5) {
        const { logit } = infer({ ...base, [channel]: z }, 100);
        assert.ok(logit >= previous - 1e-9, `${channel} decreased at z=${z}`);
        previous = logit;
      }
    }
  });

  it('keeps the calibration link strictly monotone, so it cannot reorder windows', () => {
    let previous = -Infinity;
    for (let x = -6; x <= 10; x += 0.25) {
      const y = link(x);
      assert.ok(y > previous, `link not monotone at ${x}`);
      previous = y;
    }
  });

  it('separates a resting window from a deteriorating one', () => {
    const rest = infer({ hr: 0.1, spo2: 0, temp: 0, activity: 0 }, 97);
    const sick = infer({ hr: 5.2, spo2: 4.8, temp: 3.4, activity: 2.0 }, 95);
    assert.ok(rest.risk < 20, `resting risk ${rest.risk}`);
    assert.ok(sick.risk > 90, `deteriorating risk ${sick.risk}`);
  });

  it('reports low confidence on a corrupted window even when risk looks high', () => {
    const features = { hr: 3.0, spo2: 2.0, temp: 0.5, activity: 0 };
    const clean = infer(features, 96);
    const dirty = infer(features, 27);
    assert.equal(clean.risk, dirty.risk, 'risk must not depend on quality');
    assert.ok(dirty.confidence < POLICY.CONFIDENCE_FLOOR, `dirty confidence ${dirty.confidence}`);
    assert.ok(dirty.confidence < clean.confidence - 20);
  });

  it('never lets elevated activity suppress a desaturation signal', () => {
    const baseline = new BaselineModel();
    const resting = baseline.features({ hr: 95, spo2: 92, temp: 37.0, activity: 1.0 });
    const moving = baseline.features({ hr: 95, spo2: 92, temp: 37.0, activity: 3.4 });
    assert.equal(infer(resting, 95).risk, infer(moving, 95).risk);
  });

  it('fits in a small enough footprint to be plausible on an MCU', () => {
    assert.ok(MODEL_BYTES > 0 && MODEL_BYTES < 1024, `model is ${MODEL_BYTES} bytes`);
  });
});

describe('bounded personal baseline', () => {
  it('refuses to update while an escalation is active', () => {
    const baseline = new BaselineModel();
    const before = baseline.stats.hr.mean;
    baseline.update({ hr: 130, spo2: 88, temp: 38.5, activity: 0.1 }, false, 'escalation active');
    assert.equal(baseline.stats.hr.mean, before);
    assert.equal(baseline.frozen, true);
  });

  it('caps how far a single accepted window can move the baseline', () => {
    const baseline = new BaselineModel();
    const before = baseline.stats.hr.mean;
    baseline.update({ hr: 200, spo2: 98, temp: 36.8, activity: 1 }, true, 'accepted');
    const moved = baseline.stats.hr.mean - before;
    assert.ok(moved > 0 && moved <= 0.08 * COHORT_BASELINE.hr.sd + 1e-9, `moved ${moved}`);
  });

  it('cannot be walked onto a deteriorating patient, even over many windows', () => {
    // A patient sitting at a frankly abnormal heart rate, with the agent
    // (incorrectly) told every window is a resting MONITOR window.
    const baseline = new BaselineModel();
    for (let i = 0; i < 500; i += 1) {
      baseline.update({ hr: 140, spo2: 88, temp: 38.6, activity: 0.2 }, true, 'accepted');
    }
    const z = baseline.z('hr', 140);
    assert.ok(z > 1.0, `a sustained 140 bpm normalized away to z=${z.toFixed(2)}`);
  });

  it('clamps deviations at the quantization limit', () => {
    const baseline = new BaselineModel();
    assert.equal(baseline.z('hr', 10_000), Z_LIMIT);
    assert.equal(baseline.z('hr', -10_000), -Z_LIMIT);
  });
});

describe('policy: end-to-end scenario behavior', () => {
  it('holds MONITOR through a long stable run', () => {
    const agent = new PulseGuardAgent();
    const actions = run(agent, 24);
    assert.deepEqual([...new Set(actions)], ['MONITOR']);
  });

  it('abstains on motion artifact instead of escalating', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('artifact');
    const actions = run(agent, 12);
    assert.deepEqual([...new Set(actions)], ['RE-MEASURE']);
    assert.ok(!actions.includes('CAREGIVER'));
    assert.ok(!actions.includes('CLINICIAN'));
  });

  it('reports a suspected sensor fault after sustained rejection', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('artifact');
    run(agent, POLICY.FAULT_AFTER + 1);
    assert.match(agent.snapshot().reason, /sensor fault/i);
  });

  it('requires persistence before escalating a genuine drift', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('drift');
    const actions = run(agent, 10);
    const first = actions.indexOf('CAREGIVER');
    assert.ok(first >= POLICY.CAREGIVER.n - 1, `escalated after only ${first + 1} windows`);
    assert.equal(actions.slice(0, first).every((a) => a === 'MONITOR'), true);
  });

  it('does not reach CLINICIAN on drift alone', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('drift');
    assert.ok(!run(agent, 30).includes('CLINICIAN'));
  });

  it('climbs the ladder in order on a critical cascade', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('critical');
    const actions = run(agent, 14);
    const caregiver = actions.indexOf('CAREGIVER');
    const clinician = actions.indexOf('CLINICIAN');
    assert.ok(caregiver >= 0, 'never escalated to caregiver');
    assert.ok(clinician > caregiver, 'clinician must come after caregiver, never skip a rung');
  });

  it('never de-escalates an open alert by itself', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('critical');
    run(agent, 10);
    agent.setScenario('stable');
    const after = run(agent, 10);
    assert.ok(!after.includes('MONITOR'), 'silently cancelled its own escalation');
  });

  it('releases the ladder only after a human acknowledges', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('critical');
    run(agent, 10);
    agent.acknowledge();
    agent.setScenario('stable');
    assert.deepEqual([...new Set(run(agent, 8))], ['MONITOR']);
  });

  it('maps every action to a distinct tone', () => {
    assert.equal(new Set(Object.values(ACTION_TONE)).size, Object.keys(ACTION_TONE).length);
  });
});

describe('offline recovery', () => {
  it('queues escalations while offline and delivers them on reconnect', () => {
    const agent = new PulseGuardAgent();
    agent.setOnline(false);
    agent.setScenario('critical');
    run(agent, 10);

    const queued = agent.snapshot().queuedCount;
    assert.ok(queued > 0, 'nothing was queued while offline');

    agent.setOnline(true);
    const after = agent.step();
    assert.equal(after.queuedCount, 0, 'queue did not drain on reconnect');
    assert.ok(after.events.some((e) => e.kind === 'SYNC COMPLETE'));
    assert.ok(after.events.filter((e) => e.packet).every((e) => e.delivered));
  });

  it('keeps making decisions with no uplink at all', () => {
    const online = new PulseGuardAgent();
    online.setScenario('critical');
    const withCloud = run(online, 10);

    const offline = new PulseGuardAgent();
    offline.setOnline(false);
    offline.setScenario('critical');
    const withoutCloud = run(offline, 10);

    assert.deepEqual(withoutCloud, withCloud, 'decisions changed when the cloud went away');
  });

  it('emits an explainable packet with every escalation', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('critical');
    run(agent, 10);
    const packet = agent.openPacket();
    assert.ok(packet, 'no packet was produced');
    assert.ok(packet.reason.length > 40, 'packet reason is not explanatory');
    assert.ok(packet.policy.includes('%'), 'packet does not cite the rule that fired');
    assert.ok(packet.modelVersion && packet.policyVersion && packet.baselineVersion);
    for (const channel of CHANNELS) assert.equal(typeof packet.features[channel], 'number');
  });

  it('clears the unacknowledged flag once a human responds', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('critical');
    run(agent, 10);
    assert.equal(agent.hasUnacknowledged(), true);
    agent.acknowledge();
    assert.equal(agent.hasUnacknowledged(), false);
  });
});

describe('audit log', () => {
  it('records the quality gate before the score, and never scores a rejected window', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('artifact');
    const { events } = agent.step();
    const ordered = [...events].sort((a, b) => a.seq - b.seq);
    const gate = ordered.findIndex((e) => e.kind === 'QUALITY GATE');
    assert.ok(gate >= 0, 'no quality-gate entry');
    assert.ok(!ordered.some((e) => e.kind === 'WINDOW SCORED'), 'scored a rejected window');
  });

  it('scores accepted windows and logs them after the gate', () => {
    const agent = new PulseGuardAgent();
    const { events } = agent.step();
    const ordered = [...events].sort((a, b) => a.seq - b.seq);
    const gate = ordered.findIndex((e) => e.kind === 'QUALITY GATE');
    const scored = ordered.findIndex((e) => e.kind === 'WINDOW SCORED');
    assert.ok(scored > gate, 'score was logged before the gate that authorized it');
  });

  it('accumulates over time and stays bounded', () => {
    const agent = new PulseGuardAgent();
    const early = agent.step().events.length;
    run(agent, 6);
    assert.ok(agent.snapshot().events.length > early, 'timeline did not grow');
    run(agent, 400);
    assert.ok(agent.snapshot().events.length <= EVENT_LOG_LENGTH, 'event log grew without bound');
  });

  it('logs a sensor fault once, not on every rejected window', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('artifact');
    run(agent, 20);
    const faults = agent.snapshot().events.filter((e) => e.kind === 'SENSOR FAULT');
    assert.equal(faults.length, 1, `logged ${faults.length} sensor-fault entries`);
  });

  it('writes one decision row per state change, not per window', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('artifact');
    run(agent, 20);
    const rows = agent.snapshot().events.filter((e) => e.kind === 'RE-MEASURE');
    assert.equal(rows.length, 1, `repeated an unchanged verdict ${rows.length} times`);
    // The full audit trail is still there, one entry per window.
    assert.ok(agent.snapshot().events.filter((e) => e.kind === 'QUALITY GATE').length >= 20);
  });

  it('separates decisions from per-window bookkeeping', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('critical');
    run(agent, 12);
    const decisions = agent.snapshot().events.filter((e) => !e.routine);
    assert.ok(decisions.length > 0, 'no decision-level events');
    assert.ok(decisions.every((e) => e.kind !== 'WINDOW SCORED' && e.kind !== 'QUALITY GATE'));
    assert.ok(decisions.some((e) => e.kind === 'CLINICIAN'));
  });

  it('reproduces the same decision sequence on a fresh agent', () => {
    const a = new PulseGuardAgent();
    const b = new PulseGuardAgent();
    a.setScenario('critical');
    b.setScenario('critical');
    assert.deepEqual(run(a, 16), run(b, 16));
  });
});

describe('documented demo values', () => {
  const expected: Record<string, { action: Action; quality: [number, number]; risk: [number, number] }> = {
    stable: { action: 'MONITOR', quality: [93, 99], risk: [8, 18] },
    artifact: { action: 'RE-MEASURE', quality: [20, 45], risk: [12, 45] },
    drift: { action: 'CAREGIVER', quality: [92, 99], risk: [70, 87] },
    critical: { action: 'CLINICIAN', quality: [90, 99], risk: [90, 99] },
  };

  for (const [scenario, want] of Object.entries(expected)) {
    it(`${scenario} lands in the range printed in the docs`, () => {
      const agent = new PulseGuardAgent();
      agent.setScenario(scenario as 'stable');
      let last = agent.step();
      for (let i = 0; i < 11; i += 1) last = agent.step();

      assert.equal(last.action, want.action);
      assert.ok(last.quality >= want.quality[0] && last.quality <= want.quality[1], `quality ${last.quality}`);
      assert.ok(last.risk >= want.risk[0] && last.risk <= want.risk[1], `risk ${last.risk}`);
    });
  }

  it('measures a real, non-zero forward-pass cost well under the MCU budget', () => {
    const agent = new PulseGuardAgent();
    agent.setScenario('critical');
    for (let i = 0; i < 20; i += 1) agent.step();
    const { micros } = agent.snapshot();
    assert.ok(micros > 0, 'reported a meaningless zero instead of a measurement');
    // The first window may be scored during server rendering, so it must not
    // carry a host-dependent measurement into the markup.
    assert.equal(new PulseGuardAgent().step().micros, 0, 'benchmarked on the SSR window');
    assert.ok(micros < 40_000, 'browser inference exceeded the 40 ms target envelope');
  });
});
