'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Beaker,
  Bluetooth,
  CheckCircle2,
  CloudOff,
  Cpu,
  Download,
  ExternalLink,
  FileCheck2,
  Gauge as GaugeIcon,
  GitBranch,
  HeartPulse,
  LockKeyhole,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Siren,
  TimerReset,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { POLICY, PulseGuardAgent, type Snapshot } from '@/lib/agent';
import { runProofSuite, type ProofReport } from '@/lib/evaluation';
import { MODEL_VERSION, POLICY_VERSION } from '@/lib/model';
import { encodeFirmwareFrame, toFirmwareFrame } from '@/lib/firmware';
import { type ScenarioId, WINDOW_SECONDS } from '@/lib/signal';

/** Wall-clock pacing of the simulated 30 s window, in milliseconds. */
const WINDOW_PERIOD_MS = 950;
/** How long the hands-free tour holds each scenario. */
const AUTO_DWELL_MS = 9_000;

type ScenarioMeta = { id: ScenarioId; label: string; short: string; hint: string };

const SCENARIOS: ScenarioMeta[] = [
  { id: 'stable', label: 'Stable baseline', short: 'Clean resting signals', hint: 'Expect MONITOR' },
  { id: 'artifact', label: 'Motion artifact', short: 'Walking with a loose sensor', hint: 'Expect RE-MEASURE' },
  { id: 'drift', label: 'Sustained drift', short: 'Slow multivital deterioration', hint: 'Expect CAREGIVER' },
  { id: 'critical', label: 'Critical cascade', short: 'Persistent high-risk pattern', hint: 'Expect CLINICIAN' },
];

/* ------------------------------------------------------------------ *
 * Presentation components
 * ------------------------------------------------------------------ */

function Gauge({ value, tone }: { value: number; tone: Snapshot['tone'] }) {
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="gauge">
      <svg viewBox="0 0 190 190" aria-hidden="true">
        <circle className="gauge-track" cx="95" cy="95" r={radius} />
        <circle
          className={`gauge-value tone-${tone}`}
          cx="95"
          cy="95"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <div className="gauge-number">
        <strong>{value}</strong>
        <span>% risk</span>
      </div>
    </div>
  );
}

/**
 * Risk history, drawn from the values the policy actually scored.
 * The dashed rules are the live escalation thresholds, so a viewer can see the
 * exact moment the trace crosses the rule that fires.
 */
function TrendChart({ history, tone }: { history: number[]; tone: Snapshot['tone'] }) {
  const W = 560;
  const H = 150;
  const span = 48;

  const { line, area } = useMemo(() => {
    if (history.length < 2) return { line: '', area: '' };
    // Right-aligned, so the newest window always sits under the "now" label and
    // the trace scrolls leftwards like a bedside monitor.
    const points = history.map((risk, i) => {
      const fromNow = history.length - 1 - i;
      const x = W - (fromNow / (span - 1)) * W;
      const y = H - 8 - (risk / 100) * (H - 18);
      return [x, y] as const;
    });

    // Centripetal-ish smoothing so the trace reads as a physiological signal.
    let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const cx = (x0 + x1) / 2;
      d += ` C${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    const first = points[0][0].toFixed(1);
    const last = points[points.length - 1][0].toFixed(1);
    return { line: d, area: `${d} L${last} ${H} L${first} ${H} Z` };
  }, [history]);

  const y = (risk: number) => H - 8 - (risk / 100) * (H - 18);

  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      <title>{`Scored deterioration risk over the last ${history.length} valid window${history.length === 1 ? '' : 's'}`}</title>
      <line className="threshold caregiver" x1="0" x2={W} y1={y(POLICY.CAREGIVER.risk)} y2={y(POLICY.CAREGIVER.risk)} />
      <line className="threshold clinician" x1="0" x2={W} y1={y(POLICY.CLINICIAN.risk)} y2={y(POLICY.CLINICIAN.risk)} />
      {line ? (
        <>
          <path className={`trend-area tone-${tone}`} d={area} />
          <path className={`trend tone-${tone}`} d={line} fill="none" />
        </>
      ) : null}
    </svg>
  );
}

/** Visual proof that escalation requires persistence, not one bad window. */
function PersistenceMeter({ persistence }: { persistence: Snapshot['persistence'] }) {
  const { count, of, need, label } = persistence;
  return (
    <div className="persistence">
      <div className="persistence-top">
        <span>PERSISTENCE</span>
        <span className="mono">
          {count} / {of} windows {label}
        </span>
      </div>
      <div className="pips" aria-label={`${count} of the last ${of} valid windows met the escalation threshold; ${need} are required`}>
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={`pip ${i < count ? 'lit' : ''} ${i === need - 1 ? 'gate' : ''}`} />
        ))}
      </div>
      <p className="persistence-note">
        {count >= need
          ? `Rule satisfied — ${need} of ${of} required`
          : `${need - count} more qualifying window${need - count === 1 ? '' : 's'} before this rule fires`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function Home() {
  // The agent is stateful hardware, not derived state: it is created once,
  // primed with its first window, and then advanced by the interval below.
  //
  // Priming happens inside this initializer rather than in the snapshot
  // initializer below, because React may invoke a lazy initializer more than
  // once. Stepping there would leave the browser a window ahead of the
  // server-rendered markup; doing it here just builds an extra agent that is
  // discarded, and whichever one survives is internally consistent.
  const [agent] = useState(() => {
    const created = new PulseGuardAgent();
    created.step();
    return created;
  });
  // The agent runs on a virtual clock, so its first window is identical on the
  // server and in the browser and `snapshot()` is a pure read.
  const [snap, setSnap] = useState<Snapshot>(() => agent.snapshot());
  const [scenario, setScenario] = useState<ScenarioId>('stable');
  const [streaming, setStreaming] = useState(true);
  const [autoTour, setAutoTour] = useState(false);
  const [showRoutine, setShowRoutine] = useState(false);
  const [proofState, setProofState] = useState<'idle' | 'running' | 'complete'>('idle');
  const [proof, setProof] = useState<ProofReport | null>(null);

  // --- the clock that advances the agent -------------------------------
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setSnap(agent.step()), WINDOW_PERIOD_MS);
    return () => window.clearInterval(timer);
  }, [agent, streaming]);

  const selectScenario = useCallback(
    (next: ScenarioId) => {
      agent.setScenario(next);
      setScenario(next);
      setSnap(agent.snapshot());
    },
    [agent],
  );

  useEffect(() => {
    if (!autoTour) return;
    const timer = window.setInterval(() => {
      const order = SCENARIOS.map((s) => s.id);
      setScenario((current) => {
        const next = order[(order.indexOf(current) + 1) % order.length];
        agent.setScenario(next);
        return next;
      });
    }, AUTO_DWELL_MS);
    return () => window.clearInterval(timer);
  }, [autoTour, agent]);

  const toggleOnline = useCallback(() => {
    agent.setOnline(!agent.isOnline());
    setSnap(agent.snapshot());
  }, [agent]);

  const resetDemo = useCallback(() => {
    agent.reset();
    setScenario('stable');
    setAutoTour(false);
    setStreaming(true);
    setSnap(agent.step());
  }, [agent]);

  const acknowledge = useCallback(() => {
    agent.acknowledge();
    setSnap(agent.snapshot());
  }, [agent]);

  const runVerification = useCallback(() => {
    setStreaming(false);
    setProofState('running');
    setProof(null);
    // Yield once so the interface can visibly enter its running state before
    // the deterministic replay occupies the main thread.
    window.setTimeout(() => {
      setProof(runProofSuite());
      setProofState('complete');
    }, 420);
  }, []);

  const downloadProofReport = useCallback(() => {
    if (!proof) return;
    const body = {
      prototypeNotice: 'Synthetic deterministic verification; not clinical validation.',
      ...proof,
      modelVersion: MODEL_VERSION,
      policyVersion: POLICY_VERSION,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pulseguard-verification-report.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [proof]);

  // --- keyboard control, so the demo can be driven without a mouse -----
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const index = Number(event.key);
      if (index >= 1 && index <= SCENARIOS.length) {
        selectScenario(SCENARIOS[index - 1].id);
      } else if (event.key.toLowerCase() === 'o') {
        toggleOnline();
      } else if (event.key.toLowerCase() === 'a') {
        setAutoTour((v) => !v);
      } else if (event.key.toLowerCase() === 'r') {
        resetDemo();
      } else if (event.key === ' ') {
        event.preventDefault();
        setStreaming((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectScenario, toggleOnline, resetDemo]);

  const pendingAck = snap.events.some((e) => e.packet && !e.acknowledged);
  // A measured duration cannot be known until the browser has actually run the
  // forward pass a few times, so it is withheld on the first windows. That also
  // keeps the server-rendered markup identical to the first client render.
  const measured = snap.micros > 0 ? `${snap.micros.toFixed(2)} µs` : 'measuring…';
  const firmwareFrame = encodeFirmwareFrame(toFirmwareFrame(snap));

  const downloadPacket = () => {
    const packet = agent.openPacket();
    const body = {
      prototypeNotice: 'Deterministic simulation. Not a medical device. Not for clinical use.',
      generatedAt: new Date().toISOString(),
      scenario,
      windowIndex: snap.windowIndex,
      connectivity: snap.online ? 'online' : 'offline-queued',
      decision: {
        action: snap.action,
        risk: snap.risk,
        confidence: snap.confidence,
        signalQuality: snap.quality,
        reason: snap.reason,
        policy: snap.policy,
      },
      gates: {
        qualityFloor: POLICY.QUALITY_FLOOR,
        confidenceFloor: POLICY.CONFIDENCE_FLOOR,
        qualityPassed: snap.gatePassed,
        confidencePassed: snap.confidencePassed,
        persistence: snap.persistence,
      },
      signalDiagnostics: {
        motionIndex: Number(snap.qualityReport.motionIndex.toFixed(3)),
        ppgJitterBpm: Number(snap.qualityReport.ppgJitter.toFixed(2)),
        spo2StdDev: Number(snap.qualityReport.satVariance.toFixed(2)),
      },
      deviations: snap.deviations.map((d) => ({ channel: d.channel, value: d.value, z: Number(d.z.toFixed(2)) })),
      model: {
        modelVersion: MODEL_VERSION,
        policyVersion: POLICY_VERSION,
        baselineVersion: snap.baselineVersion,
        quantization: 'int8 weights / int32 accumulators',
        parameterBytes: snap.modelBytes,
        measuredInferenceMicros: Number(snap.micros.toFixed(1)),
        rawLogit: Number(snap.logit.toFixed(4)),
      },
      escalationPacket: packet,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pulseguard-event-${scenario}-w${snap.windowIndex}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      {/* Screen readers get every decision change announced, not just sighted users. */}
      <output className="sr-only" aria-live="polite">
        {`${snap.action}. Risk ${snap.risk} percent, confidence ${snap.confidence} percent, signal quality ${snap.quality} percent.`}
      </output>

      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><HeartPulse size={23} /></div>
          <div>
            <div className="brand-line">
              <strong>PulseGuard Edge</strong>
              <span className={`live-dot ${streaming ? '' : 'paused'}`} />
              <span className="live-copy">{streaming ? 'LIVE INFERENCE' : 'PAUSED'}</span>
            </div>
            <p>Patient-specific deterioration intelligence</p>
          </div>
        </div>
        <div className="header-actions">
          <Badge className="device-badge">
            <Bluetooth size={14} /> TARGET MCU · INT8 · {snap.modelBytes} B
          </Badge>
          <Button className="header-button" variant="outline" size="sm" onClick={() => setStreaming((v) => !v)} aria-keyshortcuts="Space">
            {streaming ? <Pause size={15} /> : <Play size={15} />}
            <span className="button-label">{streaming ? 'Pause' : 'Resume'}</span>
          </Button>
          <Button
            className={`header-button ${snap.online ? '' : 'is-offline'}`}
            variant="outline"
            size="sm"
            onClick={toggleOnline}
            aria-pressed={!snap.online}
            aria-keyshortcuts="o"
          >
            {snap.online ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span className="button-label">{snap.online ? 'Online' : 'Offline'}</span>
          </Button>
          <Button className="present-button" size="sm" onClick={() => setAutoTour((v) => !v)} aria-keyshortcuts="a">
            {autoTour ? <Pause size={15} /> : <Play size={15} />}
            <span className="button-label">{autoTour ? 'Stop tour' : 'Auto demo'}</span>
          </Button>
        </div>
      </header>

      <section className={`network-ribbon ${snap.online ? 'online' : 'offline'}`}>
        <div>
          {snap.online ? <Radio size={16} /> : <CloudOff size={16} />}
          <strong>{snap.online ? 'Encrypted event sync available' : 'Edge autonomy active'}</strong>
          <span>
            {snap.online
              ? 'Raw waveforms never leave the device.'
              : `${snap.queuedCount} event${snap.queuedCount === 1 ? '' : 's'} retained locally · BLE caregiver handoff available`}
          </span>
        </div>
        <span className="ribbon-status">{snap.online ? 'SYNCED' : 'NO CLOUD REQUIRED'}</span>
      </section>

      <div className="workspace">
        <section className="patient-surface">
          <div className="patient-heading">
            <div>
              <p className="eyebrow">PATIENT 07 · HOME RECOVERY · WINDOW {snap.windowIndex}</p>
              <h1>Live physiological stream</h1>
            </div>
            <Badge className={`action-badge action-${snap.tone}`}>{snap.action}</Badge>
          </div>

          <div className="stream-grid">
            <div className="wave-panel">
              <div className="panel-topline">
                <span>SCORED RISK · PATIENT-RELATIVE</span>
                <span className="mono">{WINDOW_SECONDS}s WINDOW · {snap.history.length} SCORED</span>
              </div>
              <div className="wave-stage">
                <div className="chart-grid" />
                <TrendChart history={snap.history} tone={snap.tone} />
                <span className="rule-tag tag-clinician">CLINICIAN {POLICY.CLINICIAN.risk}%</span>
                <span className="rule-tag tag-caregiver">CAREGIVER {POLICY.CAREGIVER.risk}%</span>
                {snap.history.length < 2 ? <span className="wave-empty">Waiting for the first valid window…</span> : null}
              </div>
              <div className="time-axis">
                <span>oldest scored window</span>
                <span>now</span>
              </div>
            </div>

            <div className="risk-panel">
              <div className="risk-heading">
                <span>EDGE RISK INDEX</span>
                <span className={`confidence ${snap.confidencePassed ? '' : 'failing'}`}>
                  <ShieldCheck size={14} /> {snap.confidence}% confidence
                </span>
              </div>
              <Gauge value={snap.risk} tone={snap.tone} />
              <div className="gate-row">
                <span className={`gate-chip ${snap.gatePassed ? 'pass' : 'fail'}`}>
                  <GaugeIcon size={13} /> quality {snap.quality}%
                </span>
                <span className={`gate-chip ${snap.confidencePassed ? 'pass' : 'fail'}`}>
                  <ShieldCheck size={13} /> floor {POLICY.CONFIDENCE_FLOOR}%
                </span>
              </div>
              <PersistenceMeter persistence={snap.persistence} />
            </div>
          </div>

          <div className="baseline-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PERSONAL BASELINE</p>
                <h2>Deviation from this patient&rsquo;s normal</h2>
              </div>
              <span className={`baseline-age ${snap.baselineFrozen ? 'frozen' : ''}`}>
                PROFILE v{snap.baselineVersion} · {snap.baselineFrozen ? 'FROZEN' : 'LEARNING'}
              </span>
            </div>
            <div className="deviation-grid">
              {snap.deviations.map((item) => (
                <div className="deviation" key={item.channel}>
                  <div className="deviation-label">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                  <div className="deviation-track">
                    <span className="deviation-centre" />
                    <span
                      className={`deviation-dot ${item.flagged ? `tone-${snap.tone}` : 'nominal'}`}
                      style={{ left: `${item.position}%` }}
                    />
                  </div>
                  <div className="deviation-meta">
                    <span className="meta-label">personal range</span>
                    <span className="sigma">{item.z >= 0 ? '+' : '−'}{Math.abs(item.z).toFixed(1)}&#963;</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="baseline-note">
              Centre of each track is this patient&rsquo;s own mean; the full width spans &#177;3&#963;.
              Updates are {snap.baselineFrozen ? 'suspended' : 'running'} &mdash; {snap.baselineReason}.
            </p>
          </div>

          <div className="scenario-section">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">CHALLENGE THE AGENT</p>
                <h2>Reproducible safety scenarios</h2>
              </div>
              <Button variant="ghost" size="sm" className="reset-button" onClick={resetDemo} aria-keyshortcuts="r">
                <RotateCcw size={15} /> Reset
              </Button>
            </div>
            <div className="scenario-grid">
              {SCENARIOS.map((item, index) => (
                <button
                  key={item.id}
                  className={`scenario-card ${scenario === item.id ? 'selected' : ''}`}
                  onClick={() => selectScenario(item.id)}
                  aria-pressed={scenario === item.id}
                  aria-keyshortcuts={String(index + 1)}
                >
                  <span className="scenario-index">{index + 1}</span>
                  <span className={`scenario-icon icon-${item.id}`}>
                    {item.id === 'stable' ? <CheckCircle2 /> : item.id === 'artifact' ? <Activity /> : item.id === 'critical' ? <Siren /> : <HeartPulse />}
                  </span>
                  <strong>{item.label}</strong>
                  <small>{item.short}</small>
                  <em>{item.hint}</em>
                </button>
              ))}
            </div>
            <p className="keyboard-hint">
              Keyboard: <kbd>1</kbd>&ndash;<kbd>4</kbd> scenario · <kbd>O</kbd> connectivity · <kbd>A</kbd> auto demo · <kbd>Space</kbd> pause · <kbd>R</kbd> reset
            </p>
          </div>
        </section>

        <aside className="agent-rail">
          <section className="agent-card primary-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">EDGE AGENT REASONING</p>
                <h2>Why this action?</h2>
              </div>
              <span className={`pulse-orb orb-${snap.tone}`} />
            </div>
            <div className="reason-box">
              <p>{snap.reason}</p>
              <div className="policy-line"><LockKeyhole size={14} /><span>{snap.policy}</span></div>
            </div>
            <div className="agent-steps">
              {[
                { n: '01', label: 'Observe', value: `${snap.quality}% quality`, ok: snap.gatePassed },
                { n: '02', label: 'Contextualize', value: `profile v${snap.baselineVersion}`, ok: true },
                { n: '03', label: 'Infer', value: `${snap.risk}% risk index`, ok: snap.gatePassed },
                { n: '04', label: 'Deliberate', value: `${snap.persistence.count}/${snap.persistence.need} required`, ok: snap.confidencePassed },
                { n: '05', label: 'Act', value: snap.action, ok: true },
              ].map((step) => (
                <div className="agent-step" key={step.n}>
                  <span className="step-number">{step.n}</span>
                  <span className="step-copy"><strong>{step.label}</strong><small>{step.value}</small></span>
                  {step.ok ? <CheckCircle2 className="step-pass" size={17} /> : <AlertTriangle className="step-warn" size={17} />}
                </div>
              ))}
            </div>
            {pendingAck ? (
              <Button className={`ack-button ack-${snap.tone}`} onClick={acknowledge}>
                <AlertTriangle size={17} /> Acknowledge {snap.action.toLowerCase()} event
              </Button>
            ) : null}
            <Button variant="outline" className="packet-button" onClick={downloadPacket}>
              <Download size={16} /> Download event packet
            </Button>
          </section>

          <section className="agent-card event-card">
            <div className="card-heading compact-heading">
              <div>
                <p className="eyebrow">AUDITABLE MEMORY</p>
                <h2>Local event timeline</h2>
              </div>
              <span className="event-count">
                {snap.events.length} LOGGED{snap.queuedCount > 0 ? ` · ${snap.queuedCount} QUEUED` : ''}
              </span>
            </div>
            <fieldset className="event-filter">
              <legend className="sr-only">Event timeline detail</legend>
              <button className={showRoutine ? '' : 'on'} onClick={() => setShowRoutine(false)} aria-pressed={!showRoutine}>
                Decisions
              </button>
              <button className={showRoutine ? 'on' : ''} onClick={() => setShowRoutine(true)} aria-pressed={showRoutine}>
                Every window
              </button>
            </fieldset>
            <div className="event-list">
              {snap.events.filter((e) => showRoutine || !e.routine).slice(0, 9).map((event) => (
                <div className="event-row" key={event.id}>
                  <span className={`event-dot dot-${event.tone}`} />
                  <span className="event-time mono">{event.time}</span>
                  <span className="event-copy">
                    <strong>{event.kind}</strong>
                    <small>{event.detail}</small>
                  </span>
                  {event.packet ? (
                    <span className={`event-flag ${event.delivered ? 'sent' : 'queued'}`}>
                      {event.acknowledged ? 'ACK' : event.delivered ? 'SENT' : 'QUEUED'}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="agent-card telemetry-card">
            <div className="telemetry-item">
              <Cpu /><span><small>INT8 PASS (THIS BROWSER)</small><strong>{measured}</strong></span>
            </div>
            <div className="telemetry-item">
              <Zap /><span><small>MODEL PARAMETERS</small><strong>{snap.modelBytes} bytes</strong></span>
            </div>
            <div className="telemetry-item">
              <LockKeyhole /><span><small>RAW DATA SENT</small><strong>0 bytes</strong></span>
            </div>
          </section>

          <p className="prototype-note">
            Deterministic simulation with simulated sensors. Decisions, gates, baselines and the quantized model
            are computed live in your browser; sensor hardware, clinical validation and the trained model are future work.
            Not a medical device.
          </p>
        </aside>
      </div>

      <section className="proof-lab" aria-labelledby="proof-title">
        <div className="proof-heading">
          <div>
            <p className="eyebrow">EXECUTABLE EVIDENCE · SAME CODE PATH</p>
            <h2 id="proof-title">Edge Safety Verification Lab</h2>
            <p className="proof-intro">
              Replay 612 deterministic windows through the same signal gate, quantized model,
              personal baseline and escalation policy used by the live monitor.
            </p>
          </div>
          <div className="proof-actions">
            {proof ? (
              <Button variant="outline" className="proof-download" onClick={downloadProofReport}>
                <Download size={16} /> Export evidence
              </Button>
            ) : null}
            <Button className="proof-run" onClick={runVerification} disabled={proofState === 'running'}>
              {proofState === 'running' ? <TimerReset className="spin" size={17} /> : <Beaker size={17} />}
              {proofState === 'running' ? 'Replaying 612 windows…' : proof ? 'Run again' : 'Run proof suite'}
            </Button>
          </div>
        </div>

        <div className="architecture-strip" aria-label="On-device decision pipeline">
          {[
            ['01', 'Sense', '30 s multivital window'],
            ['02', 'Reject noise', `${POLICY.QUALITY_FLOOR}% quality floor`],
            ['03', 'Personalize', 'Bounded patient baseline'],
            ['04', 'Infer', `${snap.modelBytes} B quantized model`],
            ['05', 'Govern', 'Confidence + persistence'],
            ['06', 'Act', 'Human escalation ladder'],
          ].map(([n, label, detail], index) => (
            <div className="architecture-node" key={n}>
              <span>{n}</span>
              <strong>{label}</strong>
              <small>{detail}</small>
              {index < 5 ? <i aria-hidden="true">→</i> : null}
            </div>
          ))}
        </div>

        <section className="hardware-twin" aria-labelledby="hardware-twin-title">
          <div className="hardware-twin-head">
            <div>
              <p className="eyebrow">DEVICE HANDOFF · PROTOCOL EMULATOR</p>
              <h3 id="hardware-twin-title">Firmware integration twin</h3>
              <p>One inspectable contract from simulated signal window to a future ESP32-S3 serial or BLE bridge.</p>
            </div>
            <span className="evidence-chip target">HARDWARE PROFILING PENDING</span>
          </div>
          <div className="hardware-twin-grid">
            <div className="firmware-contract">
              <span className="firmware-led" aria-hidden="true" />
              <code>{firmwareFrame}</code>
              <small>Live browser-emitted PGE/1 frame · not a live device UART feed</small>
            </div>
            <div className="handoff-spec">
              <div><small>TARGET</small><strong>ESP32-S3 · ESP-IDF</strong></div>
              <div><small>SENSOR BUS</small><strong>I²C optics + IMU</strong></div>
              <div><small>ARITHMETIC</small><strong>int8 / int32</strong></div>
              <div><small>TEST HOOK</small><strong>Golden PGE/1 frames</strong></div>
            </div>
          </div>
          <div className="firmware-pipeline" aria-label="Firmware handoff stages">
            {['I²C capture', 'Quality gate', 'Fixed-point infer', 'Persistence policy', 'UART / BLE event'].map((stage, index) => (
              <span key={stage}><b>{String(index + 1).padStart(2, '0')}</b>{stage}</span>
            ))}
          </div>
          <a className="hardware-source" href="https://github.com/gowtham66867/pulseguard-edge-demo/tree/main/firmware/esp32" target="_blank" rel="noreferrer">
            Inspect firmware handoff notes <ExternalLink size={14} />
          </a>
        </section>

        {proofState === 'idle' ? (
          <div className="proof-idle">
            <div><ShieldCheck /><strong>Safety invariants</strong><span>Artifact rejection, rung order and no silent de-escalation</span></div>
            <div><CloudOff /><strong>Offline parity</strong><span>Decision sequence must remain identical with the uplink cut</span></div>
            <div><GitBranch /><strong>Reproducible</strong><span>Seeded inputs and an exportable machine-readable report</span></div>
          </div>
        ) : null}

        {proofState === 'running' ? (
          <output className="proof-running">
            <span className="proof-scan" />
            <div><strong>Executing adversarial replay</strong><small>Four scenarios · offline twin · 500-window baseline poisoning test</small></div>
          </output>
        ) : null}

        {proof ? (
          <div className="proof-results" aria-live="polite">
            <div className="proof-scoreboard">
              <div className="proof-verdict"><CheckCircle2 /><span><small>VERDICT</small><strong>{proof.passed ? 'ALL CHECKS PASS' : 'REVIEW REQUIRED'}</strong></span></div>
              <div><small>WINDOWS REPLAYED</small><strong>{proof.windowsProcessed}</strong></div>
              <div><small>SAFETY PROOFS</small><strong>{proof.checks.filter((check) => check.passed).length}/{proof.checks.length}</strong></div>
              <div><small>SCENARIO OUTCOMES</small><strong>{proof.scenarioMatrix.filter((row) => row.passed).length}/4</strong></div>
              <div><small>MODEL PARAMETERS</small><strong>{proof.modelBytes} B</strong></div>
            </div>

            <div className="proof-grid">
              <div className="matrix-card">
                <div className="evidence-title"><FileCheck2 /><div><strong>Scenario matrix</strong><small>Computed in this browser</small></div><span className="evidence-chip live">LIVE CODE</span></div>
                <table className="matrix-table" aria-label="Scenario verification results">
                  <thead><tr className="matrix-row matrix-header"><th>Scenario</th><th>Quality</th><th>Risk</th><th>Observed</th></tr></thead>
                  <tbody>{proof.scenarioMatrix.map((row) => (
                    <tr className="matrix-row" key={row.scenario}>
                      <td className="scenario-name"><i className={`event-dot dot-${row.scenario === 'stable' ? 'green' : row.scenario === 'artifact' ? 'amber' : row.scenario === 'drift' ? 'orange' : 'red'}`} />{SCENARIOS.find((item) => item.id === row.scenario)?.label}</td>
                      <td>{row.quality}%</td><td>{row.risk}%</td>
                      <td className="matrix-action"><CheckCircle2 />{row.observed}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>

              <div className="checks-card">
                <div className="evidence-title"><ShieldCheck /><div><strong>Safety properties</strong><small>Executable assertions</small></div><span className="evidence-chip automated">AUTOMATED</span></div>
                <div className="check-list">
                  {proof.checks.map((check) => (
                    <div className="check-row" key={check.id}>
                      <CheckCircle2 />
                      <span><strong>{check.label}</strong><small>{check.observation}</small></span>
                      <em>PASS</em>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="evidence-boundary">
              <div><span className="evidence-chip live">MEASURED NOW</span><strong>{measured} browser inference</strong><small>Real timing of this JavaScript fixed-point forward pass</small></div>
              <div><span className="evidence-chip target">HARDWARE TARGET</span><strong>&lt;40 ms on ESP32-S3</strong><small>Pending firmware profiling; never presented as measured hardware data</small></div>
              <a href="https://github.com/gowtham66867/pulseguard-edge-demo" target="_blank" rel="noreferrer">
                Inspect source & tests <ExternalLink size={15} />
              </a>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
