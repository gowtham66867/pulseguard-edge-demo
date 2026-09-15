/**
 * PulseGuard Edge — bounded safety agent.
 *
 * Owns the full observe -> contextualize -> infer -> deliberate -> act -> explain
 * -> recover loop. The action is *derived* on every window from the quality gate,
 * the calibrated confidence, and a persistence rule over a ring buffer. Nothing
 * in this file is a lookup table keyed by scenario.
 */

import {
  assessSignalQuality,
  clamp,
  generateWindow,
  mean,
  type QualityReport,
  type RawWindow,
  type ScenarioId,
  WINDOW_SECONDS,
} from './signal.ts';
import {
  BaselineModel,
  CHANNELS,
  type Channel,
  type FeatureVector,
  infer,
  type Inference,
  benchmarkForwardPass,
  MODEL_BYTES,
  MODEL_VERSION,
  POLICY_VERSION,
} from './model.ts';

export type Action = 'MONITOR' | 'RE-MEASURE' | 'CAREGIVER' | 'CLINICIAN';
export type Tone = 'green' | 'amber' | 'orange' | 'red';

/* ------------------------------------------------------------------ *
 * Policy constants — the agent's entire authority, in one block
 * ------------------------------------------------------------------ */

export const POLICY = {
  /** Below this signal quality no window may influence any decision. */
  QUALITY_FLOOR: 60,
  /** Below this calibrated confidence the agent abstains rather than acts. */
  CONFIDENCE_FLOOR: 70,
  /** Caregiver escalation: N of the last M valid windows at or above RISK. */
  CAREGIVER: { risk: 55, n: 4, m: 6 },
  /** Clinician escalation: stricter, and only after caregiver has been reached. */
  CLINICIAN: { risk: 88, n: 5, m: 8 },
  /** Consecutive rejected windows before the agent reports a sensor fault. */
  FAULT_AFTER: 6,
} as const;

export const ACTION_TONE: Record<Action, Tone> = {
  MONITOR: 'green',
  'RE-MEASURE': 'amber',
  CAREGIVER: 'orange',
  CLINICIAN: 'red',
};

/** Severity ladder — the agent may step up one rung at a time, never skip. */
const RANK: Record<Action, number> = { MONITOR: 0, 'RE-MEASURE': 1, CAREGIVER: 2, CLINICIAN: 3 };

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type Deviation = {
  channel: Channel;
  label: string;
  value: string;
  z: number;
  /** 0-100 position of this reading within the patient's own range. */
  position: number;
  /** True when this channel is individually outside the personal envelope. */
  flagged: boolean;
};

export type EventKind =
  | 'MONITOR' | 'RE-MEASURE' | 'CAREGIVER' | 'CLINICIAN'
  | 'QUALITY GATE' | 'WINDOW SCORED' | 'BASELINE UPDATE' | 'BASELINE FROZEN'
  | 'EVENT QUEUED' | 'SYNC COMPLETE' | 'ACKNOWLEDGED' | 'SENSOR FAULT';

export type AgentEvent = {
  id: string;
  seq: number;
  time: string;
  kind: EventKind;
  detail: string;
  tone: Tone | 'neutral';
  /** Per-window bookkeeping, as opposed to a decision a reviewer needs to see. */
  routine: boolean;
  /** Present on escalations; drives the offline queue and the event packet. */
  packet?: EventPacket;
  delivered: boolean;
  acknowledged: boolean;
};

export type EventPacket = {
  eventId: string;
  action: Action;
  risk: number;
  confidence: number;
  signalQuality: number;
  reason: string;
  policy: string;
  features: Record<Channel, number>;
  modelVersion: string;
  policyVersion: string;
  baselineVersion: number;
  capturedAt: string;
};

export type Snapshot = {
  scenario: ScenarioId;
  windowIndex: number;
  action: Action;
  tone: Tone;
  risk: number;
  confidence: number;
  quality: number;
  logit: number;
  activations: number[];
  micros: number;
  reason: string;
  policy: string;
  gatePassed: boolean;
  confidencePassed: boolean;
  /** How many of the last M valid windows met the caregiver risk threshold. */
  persistence: { count: number; of: number; need: number; label: string };
  deviations: Deviation[];
  vitals: Record<Channel, number>;
  qualityReport: QualityReport;
  baselineVersion: number;
  baselineFrozen: boolean;
  baselineReason: string;
  /** Recent risk history, oldest first — the trend chart is drawn from this. */
  history: number[];
  events: AgentEvent[];
  queuedCount: number;
  online: boolean;
  escalationStage: Action;
  modelBytes: number;
};

const CHANNEL_LABEL: Record<Channel, string> = {
  hr: 'Heart rate',
  spo2: 'SpO₂',
  temp: 'Temperature',
  activity: 'Activity',
};

const HISTORY_LENGTH = 48;
/** The audit log keeps every window; the UI decides how much of it to show. */
export const EVENT_LOG_LENGTH = 160;

/**
 * The agent runs on a virtual clock that advances by exactly one window per
 * step, anchored to a fixed epoch.
 *
 * Two things fall out of this. The audit log now reads as 30 s apart, which is
 * what the windows actually are, instead of showing wall-clock times a second
 * apart while claiming 30 s windows. And because nothing depends on the host's
 * real time or timezone, a server-rendered pass and the browser produce byte
 * identical markup.
 */
const DEMO_EPOCH_MS = Date.UTC(2026, 2, 4, 14, 30, 0);

/* ------------------------------------------------------------------ *
 * The agent
 * ------------------------------------------------------------------ */

export class PulseGuardAgent {
  private baseline = new BaselineModel();
  private scenario: ScenarioId = 'stable';
  private windowIndex = 0;
  private validRisks: number[] = [];
  private history: number[] = [];
  private events: AgentEvent[] = [];
  private queue: AgentEvent[] = [];
  private seq = 0;
  private consecutiveRejects = 0;
  private stage: Action = 'MONITOR';
  /** Last action written to the decision log, so unchanged states are not repeated. */
  private lastLoggedAction: Action | null = null;
  private faultReported = false;
  private online = true;
  private lastSnapshot: Snapshot | null = null;
  private elapsedSeconds = 0;
  /** Mean measured cost of one int8 forward pass, refreshed periodically. */
  private micros = 0;

  private clock(): Date {
    return new Date(DEMO_EPOCH_MS + this.elapsedSeconds * 1000);
  }

  /**
   * Switch scenarios. This models the patient's physiology changing, not the
   * agent restarting: the baseline, the audit log and any *open* escalation all
   * persist. An alert is closed by a human acknowledging it, never by the
   * patient happening to look better on the next window.
   */
  setScenario(scenario: ScenarioId): void {
    if (scenario === this.scenario) return;
    this.scenario = scenario;
    this.windowIndex = 0;
    this.validRisks = [];
    this.history = [];
    this.consecutiveRejects = 0;
  }

  setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    if (online) this.flushQueue();
    else this.log('EVENT QUEUED', 'Uplink lost. Local retention active, BLE handoff available.', 'amber');
  }

  /** Reset everything, including the learned baseline. */
  reset(): void {
    this.baseline = new BaselineModel();
    this.scenario = 'stable';
    this.windowIndex = 0;
    this.validRisks = [];
    this.history = [];
    this.events = [];
    this.queue = [];
    this.seq = 0;
    this.consecutiveRejects = 0;
    this.stage = 'MONITOR';
    this.online = true;
    this.lastLoggedAction = null;
    this.faultReported = false;
    this.lastSnapshot = null;
    this.elapsedSeconds = 0;
    this.micros = 0;
  }

  isOnline(): boolean {
    return this.online;
  }

  acknowledge(): void {
    let changed = false;
    for (const event of this.events) {
      if (event.packet && !event.acknowledged) {
        event.acknowledged = true;
        changed = true;
      }
    }
    if (changed) {
      // A human has closed the loop, so the ladder may now come back down.
      this.stage = 'MONITOR';
      this.validRisks = [];
      this.log('ACKNOWLEDGED', 'Human confirmed receipt \u00b7 escalation ladder released to MONITOR', 'green');
    }
  }

  /** Read the most recent decision without advancing. Pure once primed. */
  snapshot(): Snapshot {
    return this.lastSnapshot ?? this.step();
  }

  /**
   * Advance one 30 s window through the full decision loop.
   */
  step(): Snapshot {
    this.elapsedSeconds += WINDOW_SECONDS;
    const raw = generateWindow(this.scenario, this.windowIndex);
    const qualityReport = assessSignalQuality(raw);
    const quality = qualityReport.quality;
    const vitals = summarize(raw);
    const features = this.baseline.features(vitals);

    const gatePassed = quality >= POLICY.QUALITY_FLOOR;
    const inference = infer(features, quality);
    const confidencePassed = inference.confidence >= POLICY.CONFIDENCE_FLOOR;

    const decision = this.deliberate(gatePassed, confidencePassed, inference, quality, qualityReport);

    this.recordEvents(decision, inference, quality, gatePassed, confidencePassed, features);
    this.maintainBaseline(vitals, decision.action, gatePassed);

    // Never on the very first window: that one may be scored during server
    // rendering, and a host-dependent timing there would not match the browser.
    // After that it is refreshed on a slow cadence, because re-benchmarking every
    // window would cost more than the demo itself and the figure barely moves.
    if (this.windowIndex === 2 || (this.windowIndex > 0 && this.windowIndex % 8 === 0)) {
      this.micros = benchmarkForwardPass(features);
    }

    this.windowIndex += 1;

    const snapshot: Snapshot = {
      scenario: this.scenario,
      windowIndex: this.windowIndex,
      action: decision.action,
      tone: ACTION_TONE[decision.action],
      risk: inference.risk,
      confidence: inference.confidence,
      quality,
      logit: inference.logit,
      activations: inference.activations,
      micros: this.micros,
      reason: decision.reason,
      policy: decision.policy,
      gatePassed,
      confidencePassed,
      persistence: decision.persistence,
      deviations: this.describeDeviations(vitals, features),
      vitals,
      qualityReport,
      baselineVersion: this.baseline.version,
      baselineFrozen: this.baseline.frozen,
      baselineReason: this.baseline.lastReason,
      history: [...this.history],
      events: [...this.events],
      queuedCount: this.queue.length,
      online: this.online,
      escalationStage: this.stage,
      modelBytes: MODEL_BYTES,
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  /* ---------------------------------------------------------------- *
   * Deliberation — the only place an action is chosen
   * ---------------------------------------------------------------- */

  private deliberate(
    gatePassed: boolean,
    confidencePassed: boolean,
    inference: Inference,
    quality: number,
    report: QualityReport,
  ): { action: Action; reason: string; policy: string; persistence: Snapshot['persistence'] } {
    // 1. Quality gate. A rejected window never reaches the policy buffer.
    if (!gatePassed) {
      this.consecutiveRejects += 1;
      const faulted = this.consecutiveRejects >= POLICY.FAULT_AFTER;
      return {
        action: 'RE-MEASURE',
        reason: faulted
          ? `Signal quality has stayed below ${POLICY.QUALITY_FLOOR}% for ${this.consecutiveRejects} consecutive windows. The agent reports a suspected sensor fault rather than inferring from corrupted data.`
          : `Accelerometer motion (${report.motionIndex.toFixed(2)} g) and PPG instability (${report.ppgJitter.toFixed(1)} bpm between samples) agree that this window is corrupted. Risk cannot influence any decision until a clean measurement is obtained.`,
        policy: `Quality ${quality}% is below the ${POLICY.QUALITY_FLOOR}% floor — window excluded from scoring`,
        persistence: this.persistenceView(),
      };
    }

    this.consecutiveRejects = 0;

    // 2. Confidence gate. A trustworthy measurement the model cannot resolve.
    if (!confidencePassed) {
      return {
        action: 'RE-MEASURE',
        reason: `The measurement is usable but the model sits close to its decision boundary (logit ${inference.logit.toFixed(2)}). The agent abstains instead of acting on an ambiguous window.`,
        policy: `Confidence ${inference.confidence}% is below the ${POLICY.CONFIDENCE_FLOOR}% floor — abstaining`,
        persistence: this.persistenceView(),
      };
    }

    // 3. Valid window. It now counts toward persistence.
    this.validRisks.push(inference.risk);
    if (this.validRisks.length > POLICY.CLINICIAN.m) this.validRisks.shift();
    this.history.push(inference.risk);
    if (this.history.length > HISTORY_LENGTH) this.history.shift();

    const clinicianHits = this.countAtOrAbove(POLICY.CLINICIAN.risk, POLICY.CLINICIAN.m);
    const caregiverHits = this.countAtOrAbove(POLICY.CAREGIVER.risk, POLICY.CAREGIVER.m);

    // 4. Clinician — strictest rung, and only reachable from caregiver.
    if (clinicianHits >= POLICY.CLINICIAN.n && RANK[this.stage] >= RANK.CAREGIVER) {
      this.stage = 'CLINICIAN';
      return {
        action: 'CLINICIAN',
        reason: `High-confidence deterioration has persisted through caregiver escalation. ${clinicianHits} of the last ${POLICY.CLINICIAN.m} valid windows scored at or above ${POLICY.CLINICIAN.risk}% with ${inference.confidence}% confidence. The agent requests clinical review and attaches its full reasoning.`,
        policy: `Risk ≥ ${POLICY.CLINICIAN.risk}% in ${clinicianHits} of ${POLICY.CLINICIAN.m} valid windows, after caregiver stage`,
        persistence: this.persistenceView(),
      };
    }

    // 5. Caregiver.
    if (caregiverHits >= POLICY.CAREGIVER.n) {
      this.stage = 'CAREGIVER';
      return {
        action: 'CAREGIVER',
        reason: `Multiple channels have moved away from this patient's own baseline together and stayed there. ${caregiverHits} of the last ${POLICY.CAREGIVER.m} valid windows scored at or above ${POLICY.CAREGIVER.risk}%, all on measurements that passed the quality gate.`,
        policy: `Risk ≥ ${POLICY.CAREGIVER.risk}% in ${caregiverHits} of ${POLICY.CAREGIVER.m} valid windows`,
        persistence: this.persistenceView(),
      };
    }

    // 6. Nothing persistent. Hold the current rung; do not silently de-escalate
    //    an active clinical escalation on a single quieter window.
    if (RANK[this.stage] >= RANK.CAREGIVER) {
      return {
        action: this.stage,
        reason: `Risk eased on this window, but an active ${this.stage.toLowerCase()} escalation is held until a human acknowledges it. The agent does not cancel its own alerts.`,
        policy: `Escalation held — ${caregiverHits} of ${POLICY.CAREGIVER.m} windows still above ${POLICY.CAREGIVER.risk}%`,
        persistence: this.persistenceView(),
      };
    }

    const considered = Math.min(this.validRisks.length, POLICY.CAREGIVER.m);
    return {
      action: 'MONITOR',
      reason: `All four channels are valid and sit inside this patient's learned envelope. Risk ${inference.risk}% with ${inference.confidence}% confidence on ${quality}% signal quality.`,
      policy: `${caregiverHits} of the last ${considered} valid window${considered === 1 ? '' : 's'} at or above ${POLICY.CAREGIVER.risk}% \u00b7 ${POLICY.CAREGIVER.n} needed to escalate`,
      persistence: this.persistenceView(),
    };
  }

  private countAtOrAbove(threshold: number, span: number): number {
    const recent = this.validRisks.slice(-span);
    return recent.reduce((total, risk) => total + (risk >= threshold ? 1 : 0), 0);
  }

  private persistenceView(): Snapshot['persistence'] {
    const escalating = RANK[this.stage] >= RANK.CAREGIVER;
    const rule = escalating ? POLICY.CLINICIAN : POLICY.CAREGIVER;
    return {
      count: this.countAtOrAbove(rule.risk, rule.m),
      of: rule.m,
      need: rule.n,
      label: escalating ? `≥ ${rule.risk}% risk` : `≥ ${rule.risk}% risk`,
    };
  }

  /* ---------------------------------------------------------------- *
   * Audit log, escalation delivery and offline recovery
   * ---------------------------------------------------------------- */

  private recordEvents(
    decision: { action: Action; reason: string; policy: string },
    inference: Inference,
    quality: number,
    gatePassed: boolean,
    confidencePassed: boolean,
    features: FeatureVector,
  ): void {
    // Ordering mirrors execution: the gate runs before scoring, and a rejected
    // window is never reported as scored.
    this.log(
      'QUALITY GATE',
      `${quality}% signal quality · ${gatePassed ? 'accepted' : 'rejected'}`,
      gatePassed ? 'green' : 'amber',
    );

    if (gatePassed) {
      this.log(
        'WINDOW SCORED',
        `Risk ${inference.risk}% · confidence ${inference.confidence}% · logit ${inference.logit.toFixed(2)}`,
        'neutral',
      );
    }

    const escalation = decision.action === 'CAREGIVER' || decision.action === 'CLINICIAN';
    const alreadyOpen = this.events.some((e) => e.packet && e.kind === decision.action && !e.acknowledged);

    if (escalation && !alreadyOpen) {
      const packet: EventPacket = {
        eventId: `PGE-07-${String(this.seq + 1).padStart(4, '0')}`,
        action: decision.action,
        risk: inference.risk,
        confidence: inference.confidence,
        signalQuality: quality,
        reason: decision.reason,
        policy: decision.policy,
        features: { hr: round2(features.hr), spo2: round2(features.spo2), temp: round2(features.temp), activity: round2(features.activity) },
        modelVersion: MODEL_VERSION,
        policyVersion: POLICY_VERSION,
        baselineVersion: this.baseline.version,
        capturedAt: this.clock().toISOString(),
      };
      const event = this.log(decision.action, decision.policy, ACTION_TONE[decision.action], packet);

      if (this.online) {
        event.delivered = true;
      } else {
        this.queue.push(event);
        this.log('EVENT QUEUED', `${packet.eventId} retained locally · ${this.queue.length} awaiting uplink`, 'amber');
      }
    } else if (!escalation && decision.action !== this.lastLoggedAction) {
      // Only state *changes* reach the decision log. Every individual window is
      // still recorded by the quality-gate entry above, so nothing is lost from
      // the audit trail — but a reviewer is not made to read the same unchanged
      // verdict fifty times to find the one line that matters.
      this.log(decision.action, decision.policy, ACTION_TONE[decision.action]);
    }

    if (!gatePassed && this.consecutiveRejects >= POLICY.FAULT_AFTER && !this.faultReported) {
      this.faultReported = true;
      this.log(
        'SENSOR FAULT',
        `${this.consecutiveRejects} consecutive windows rejected \u00b7 suspected sensor placement or hardware fault`,
        'amber',
      );
    }
    if (gatePassed) this.faultReported = false;

    this.lastLoggedAction = decision.action;
  }

  private flushQueue(): void {
    if (this.queue.length === 0) {
      this.log('SYNC COMPLETE', 'Uplink restored · no events were pending', 'green');
      return;
    }
    const count = this.queue.length;
    for (const event of this.queue) event.delivered = true;
    this.queue = [];
    this.log('SYNC COMPLETE', `${count} queued event${count === 1 ? '' : 's'} delivered · raw waveforms never left the device`, 'green');
  }

  private maintainBaseline(vitals: Record<Channel, number>, action: Action, gatePassed: boolean): void {
    const allowed = gatePassed && action === 'MONITOR';
    const reason = !gatePassed
      ? 'frozen — measurement failed the quality gate'
      : action !== 'MONITOR'
        ? `frozen — ${action.toLowerCase()} escalation active`
        : 'updating from accepted resting windows';

    const beforeVersion = this.baseline.version;
    const beforeFrozen = this.baseline.frozen;
    this.baseline.update(vitals, allowed, reason);

    if (this.baseline.version !== beforeVersion) {
      this.log('BASELINE UPDATE', `Personal profile advanced to v${this.baseline.version} · bounded step applied`, 'neutral');
    } else if (this.baseline.frozen && !beforeFrozen) {
      this.log('BASELINE FROZEN', reason, 'amber');
    }
  }

  private log(kind: EventKind, detail: string, tone: Tone | 'neutral', packet?: EventPacket): AgentEvent {
    const routine = kind === 'QUALITY GATE' || kind === 'WINDOW SCORED';
    this.seq += 1;
    const event: AgentEvent = {
      id: `${this.seq}`,
      seq: this.seq,
      time: formatClock(this.clock()),
      kind,
      detail,
      tone,
      routine,
      packet,
      delivered: packet ? false : true,
      acknowledged: false,
    };
    this.events.unshift(event);
    if (this.events.length > EVENT_LOG_LENGTH) this.events.pop();
    return event;
  }

  /* ---------------------------------------------------------------- *
   * Presentation helpers
   * ---------------------------------------------------------------- */

  private describeDeviations(vitals: Record<Channel, number>, features: FeatureVector): Deviation[] {
    return CHANNELS.map((channel) => {
      const z = this.baseline.z(channel, vitals[channel]);
      return {
        channel,
        label: CHANNEL_LABEL[channel],
        value: formatVital(channel, vitals[channel]),
        z,
        // Centre of the track is the patient's own mean; +-3 SD spans the full width.
        position: clamp(50 + (z / 3) * 50, 2, 98),
        flagged: Math.abs(features[channel]) >= 1.5 && features[channel] > 0,
      };
    });
  }

  /** Latest escalation packet, if any is open. */
  openPacket(): EventPacket | null {
    const event = this.events.find((e) => e.packet);
    return event?.packet ?? null;
  }

  hasUnacknowledged(): boolean {
    return this.events.some((e) => e.packet && !e.acknowledged);
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function summarize(raw: RawWindow): Record<Channel, number> {
  return {
    hr: mean(raw.hr),
    spo2: mean(raw.spo2),
    temp: mean(raw.temp),
    activity: mean(raw.activity),
  };
}

export function formatVital(channel: Channel, value: number): string {
  switch (channel) {
    case 'hr': return `${Math.round(value)} bpm`;
    case 'spo2': return `${value.toFixed(1)}%`;
    case 'temp': return `${value.toFixed(1)}°C`;
    case 'activity': return value > 1.6 ? 'high' : value > 0.75 ? 'normal' : value > 0.35 ? 'reduced' : 'minimal';
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatClock(date: Date): string {
  // UTC getters, so the log reads the same regardless of the viewer's timezone.
  return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}
