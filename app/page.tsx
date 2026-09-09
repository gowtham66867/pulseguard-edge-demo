'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bluetooth,
  CheckCircle2,
  ChevronRight,
  CloudOff,
  Cpu,
  Download,
  HeartPulse,
  LockKeyhole,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Scenario = 'stable' | 'artifact' | 'drift' | 'critical';
type Action = 'MONITOR' | 'RE-MEASURE' | 'CAREGIVER' | 'CLINICIAN';

type ScenarioState = {
  label: string;
  short: string;
  description: string;
  risk: number;
  confidence: number;
  action: Action;
  tone: 'green' | 'amber' | 'orange' | 'red';
  hr: number;
  spo2: number;
  temp: number;
  quality: number;
  deviations: Array<{ label: string; value: string; delta: string; width: number }>;
  reason: string;
  policy: string;
  waveform: string;
};

const scenarios: Record<Scenario, ScenarioState> = {
  stable: {
    label: 'Stable baseline',
    short: 'Clean resting signals',
    description: 'Personal baseline holds across all valid channels.',
    risk: 12,
    confidence: 95,
    action: 'MONITOR',
    tone: 'green',
    hr: 72,
    spo2: 98,
    temp: 36.8,
    quality: 98,
    deviations: [
      { label: 'Heart rate', value: '72 bpm', delta: '+0.2σ', width: 51 },
      { label: 'SpO₂', value: '98%', delta: '+0.1σ', width: 49 },
      { label: 'Temperature', value: '36.8°C', delta: '+0.1σ', width: 50 },
      { label: 'Activity', value: 'normal', delta: 'baseline', width: 50 },
    ],
    reason: 'All channels are valid and remain inside the patient’s learned baseline envelope.',
    policy: 'Risk below 35% across 8 of 8 valid windows',
    waveform: 'M0 84 C35 78 55 92 88 80 S145 86 178 76 S235 84 268 73 S325 80 358 70 S415 77 448 67 S505 74 560 65',
  },
  artifact: {
    label: 'Motion artifact',
    short: 'Walking with a loose sensor',
    description: 'The quality gate blocks a false escalation.',
    risk: 18,
    confidence: 34,
    action: 'RE-MEASURE',
    tone: 'amber',
    hr: 108,
    spo2: 96,
    temp: 36.9,
    quality: 27,
    deviations: [
      { label: 'Heart rate', value: '108 bpm', delta: '+2.8σ', width: 82 },
      { label: 'SpO₂', value: '96%', delta: '−0.8σ', width: 39 },
      { label: 'Temperature', value: '36.9°C', delta: '+0.2σ', width: 52 },
      { label: 'IMU motion', value: 'high', delta: '+4.6σ', width: 96 },
    ],
    reason: 'IMU motion and PPG distortion agree. This window is unreliable, so risk cannot trigger an alert.',
    policy: 'Signal quality below 60% forces abstention',
    waveform: 'M0 84 L52 79 L76 20 L97 137 L121 61 L163 82 L214 77 L246 25 L269 128 L294 66 L343 80 L392 73 L428 33 L452 122 L480 68 L528 76 L560 70',
  },
  drift: {
    label: 'Sustained drift',
    short: 'Slow multivital deterioration',
    description: 'Patient-relative change persists across windows.',
    risk: 82,
    confidence: 93,
    action: 'CAREGIVER',
    tone: 'orange',
    hr: 86,
    spo2: 94,
    temp: 37.2,
    quality: 96,
    deviations: [
      { label: 'Heart rate', value: '86 bpm', delta: '+1.9σ', width: 72 },
      { label: 'SpO₂', value: '94%', delta: '−2.1σ', width: 25 },
      { label: 'Temperature', value: '37.2°C', delta: '+1.3σ', width: 66 },
      { label: 'Activity', value: 'reduced', delta: '−1.7σ', width: 30 },
    ],
    reason: 'Heart rate, oxygen saturation, temperature, and activity have moved together for six valid windows.',
    policy: 'Moderate-to-high risk persisted in 6 of 8 windows',
    waveform: 'M0 105 C70 104 92 99 145 96 S226 86 280 82 S367 64 418 58 S499 39 560 29',
  },
  critical: {
    label: 'Critical cascade',
    short: 'Persistent high-risk pattern',
    description: 'The full escalation packet is prepared locally.',
    risk: 94,
    confidence: 96,
    action: 'CLINICIAN',
    tone: 'red',
    hr: 118,
    spo2: 89,
    temp: 38.1,
    quality: 92,
    deviations: [
      { label: 'Heart rate', value: '118 bpm', delta: '+4.1σ', width: 96 },
      { label: 'SpO₂', value: '89%', delta: '−4.4σ', width: 10 },
      { label: 'Temperature', value: '38.1°C', delta: '+3.0σ', width: 88 },
      { label: 'Activity', value: 'minimal', delta: '−3.2σ', width: 14 },
    ],
    reason: 'High-confidence deterioration persists after caregiver escalation. The agent requests clinical review with context.',
    policy: 'Risk above 90% in 7 of 8 valid windows',
    waveform: 'M0 112 C45 111 77 106 112 104 S175 92 215 88 S272 68 315 61 S372 42 414 35 S486 20 560 13',
  },
};

const scenarioOrder: Scenario[] = ['stable', 'artifact', 'drift', 'critical'];

function Gauge({ value, tone }: { value: number; tone: ScenarioState['tone'] }) {
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  return (
    <div className="gauge" aria-label={`Deterioration risk ${value} percent`}>
      <svg viewBox="0 0 190 190" aria-hidden="true">
        <circle className="gauge-track" cx="95" cy="95" r={radius} />
        <circle
          className={`gauge-value tone-${tone}`}
          cx="95"
          cy="95"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="gauge-number">
        <strong>{value}</strong>
        <span>% risk</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [scenario, setScenario] = useState<Scenario>('stable');
  const [online, setOnline] = useState(true);
  const [autoPlay, setAutoPlay] = useState(false);
  const [tick, setTick] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const state = scenarios[scenario];

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!autoPlay) return;
    const timer = window.setInterval(() => {
      setScenario((current) => scenarioOrder[(scenarioOrder.indexOf(current) + 1) % scenarioOrder.length]);
      setAcknowledged(false);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [autoPlay]);

  const events = useMemo(() => {
    const base = [
      { time: '14:32:18', label: state.action, detail: state.policy, tone: state.tone },
      { time: '14:31:48', label: 'WINDOW SCORED', detail: `Risk ${Math.max(8, state.risk - 7)}% · confidence ${Math.max(30, state.confidence - 2)}%`, tone: 'neutral' },
      { time: '14:31:18', label: 'QUALITY GATE', detail: `${state.quality}% signal quality · ${state.quality > 60 ? 'accepted' : 'rejected'}`, tone: state.quality > 60 ? 'green' : 'amber' },
      { time: '14:30:48', label: 'BASELINE CHECK', detail: 'Patient profile v18 · drift guard active', tone: 'neutral' },
    ];
    return base;
  }, [state]);

  const selectScenario = (next: Scenario) => {
    setScenario(next);
    setAutoPlay(false);
    setAcknowledged(false);
  };

  const resetDemo = () => {
    setScenario('stable');
    setAutoPlay(false);
    setOnline(true);
    setAcknowledged(false);
  };

  const downloadPacket = () => {
    const packet = {
      prototypeNotice: 'Deterministic simulation. Not for clinical use.',
      eventId: `PGE-07-${String(tick).padStart(4, '0')}`,
      patient: 'Patient 07 (pseudonymous demo record)',
      timestamp: new Date().toISOString(),
      connectivity: online ? 'online' : 'offline-queued',
      action: state.action,
      risk: state.risk,
      confidence: state.confidence,
      signalQuality: state.quality,
      reason: state.reason,
      policy: state.policy,
      modelVersion: 'edge-cnn-int8-demo-v0.3',
      policyVersion: 'safety-policy-demo-v2',
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pulseguard-event-${scenario}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><HeartPulse size={23} /></div>
          <div>
            <div className="brand-line"><strong>PulseGuard Edge</strong><span className="live-dot" /> <span className="live-copy">LIVE SIMULATION</span></div>
            <p>Patient-specific deterioration intelligence</p>
          </div>
        </div>
        <div className="header-actions">
          <Badge className="device-badge"><Bluetooth size={14} /> ESP32-S3 · 31 ms</Badge>
          <Button className="header-button" variant="outline" size="sm" onClick={() => setOnline((value) => !value)}>
            {online ? <Wifi size={15} /> : <WifiOff size={15} />}
            {online ? 'Online' : 'Offline'}
          </Button>
          <Button className="present-button" size="sm" onClick={() => setAutoPlay((value) => !value)}>
            {autoPlay ? <Pause size={15} /> : <Play size={15} />}
            {autoPlay ? 'Pause demo' : 'Auto demo'}
          </Button>
        </div>
      </header>

      <section className={`network-ribbon ${online ? 'online' : 'offline'}`}>
        <div>
          {online ? <Radio size={16} /> : <CloudOff size={16} />}
          <strong>{online ? 'Encrypted event sync available' : 'Edge autonomy active'}</strong>
          <span>{online ? 'Raw waveforms remain local.' : '1 event queued locally. BLE handoff remains available.'}</span>
        </div>
        <span className="ribbon-status">{online ? 'SYNCED' : 'NO CLOUD REQUIRED'}</span>
      </section>

      <div className="workspace">
        <section className="patient-surface">
          <div className="patient-heading">
            <div>
              <p className="eyebrow">PATIENT 07 · HOME RECOVERY · ENROLLED 18H 42M</p>
              <h1>Live physiological stream</h1>
            </div>
            <Badge className={`action-badge action-${state.tone}`}>{state.action}</Badge>
          </div>

          <div className="stream-grid">
            <div className="wave-panel">
              <div className="panel-topline">
                <span>FUSED PATIENT-RELATIVE TREND</span>
                <span className="mono">WINDOW {String(tick % 99).padStart(2, '0')} · 30 S</span>
              </div>
              <div className="wave-stage">
                <div className="chart-grid" />
                <div className={`risk-zone zone-${state.tone}`} />
                <svg viewBox="0 0 560 150" aria-label={`Simulated ${state.label.toLowerCase()} trend`}>
                  <path d={state.waveform} fill="none" className={`trend tone-${state.tone}`} />
                </svg>
                <div className="trend-marker"><span>personal baseline</span></div>
              </div>
              <div className="time-axis"><span>−5m</span><span>−4m</span><span>−3m</span><span>−2m</span><span>−1m</span><span>now</span></div>
            </div>

            <div className="risk-panel">
              <div className="risk-heading"><span>EDGE RISK SCORE</span><span className="confidence"><ShieldCheck size={14} /> {state.confidence}% confidence</span></div>
              <Gauge value={state.risk} tone={state.tone} />
              <div className="decision-copy">
                <strong>{state.label}</strong>
                <p>{state.description}</p>
              </div>
            </div>
          </div>

          <div className="baseline-section">
            <div className="section-heading">
              <div><p className="eyebrow">PERSONAL BASELINE</p><h2>Deviation from this patient’s normal</h2></div>
              <span className="baseline-age">PROFILE v18 · UPDATED 4m AGO</span>
            </div>
            <div className="deviation-grid">
              {state.deviations.map((item) => (
                <div className="deviation" key={item.label}>
                  <div className="deviation-label"><span>{item.label}</span><strong>{item.value}</strong></div>
                  <div className="deviation-track"><span className={`deviation-fill tone-${state.tone}`} style={{ width: `${item.width}%` }} /></div>
                  <div className="deviation-meta"><span>personal range</span><span>{item.delta}</span></div>
                </div>
              ))}
            </div>
          </div>

          <div className="scenario-section">
            <div className="section-heading compact">
              <div><p className="eyebrow">CHALLENGE THE AGENT</p><h2>Reproducible safety scenarios</h2></div>
              <Button variant="ghost" size="sm" className="reset-button" onClick={resetDemo}><RotateCcw size={15} /> Reset</Button>
            </div>
            <div className="scenario-grid">
              {(Object.keys(scenarios) as Scenario[]).map((key, index) => {
                const item = scenarios[key];
                return (
                  <button key={key} className={`scenario-card ${scenario === key ? 'selected' : ''}`} onClick={() => selectScenario(key)}>
                    <span className="scenario-index">0{index + 1}</span>
                    <span className={`scenario-icon icon-${item.tone}`}>{key === 'stable' ? <CheckCircle2 /> : key === 'artifact' ? <Activity /> : <HeartPulse />}</span>
                    <strong>{item.label}</strong>
                    <small>{item.short}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="agent-rail">
          <section className="agent-card primary-card">
            <div className="card-heading">
              <div><p className="eyebrow">EDGE AGENT REASONING</p><h2>Why this action?</h2></div>
              <span className={`pulse-orb orb-${state.tone}`} />
            </div>
            <div className="reason-box">
              <p>{state.reason}</p>
              <div className="policy-line"><LockKeyhole size={14} /><span>{state.policy}</span></div>
            </div>
            <div className="agent-steps">
              {[
                ['01', 'Observe', `${state.quality}% quality`, state.quality > 60],
                ['02', 'Contextualize', 'patient v18', true],
                ['03', 'Infer', `${state.risk}% · 31 ms`, state.quality > 60],
                ['04', 'Act', state.action, true],
              ].map(([number, label, value, passed]) => (
                <div className="agent-step" key={String(number)}>
                  <span className="step-number">{number}</span>
                  <span className="step-copy"><strong>{label}</strong><small>{value}</small></span>
                  {passed ? <CheckCircle2 className="step-pass" size={17} /> : <AlertTriangle className="step-warn" size={17} />}
                </div>
              ))}
            </div>
            {state.action === 'CAREGIVER' || state.action === 'CLINICIAN' ? (
              <Button className={`ack-button ack-${state.tone}`} onClick={() => setAcknowledged(true)} disabled={acknowledged}>
                {acknowledged ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                {acknowledged ? 'Escalation acknowledged' : `Acknowledge ${state.action.toLowerCase()} event`}
              </Button>
            ) : null}
            <Button variant="outline" className="packet-button" onClick={downloadPacket}><Download size={16} /> Download event packet</Button>
          </section>

          <section className="agent-card event-card">
            <div className="card-heading compact-heading">
              <div><p className="eyebrow">AUDITABLE MEMORY</p><h2>Local event timeline</h2></div>
              <span className="event-count">4 EVENTS</span>
            </div>
            <div className="event-list">
              {events.map((event, index) => (
                <div className="event-row" key={`${event.time}-${event.label}`}>
                  <span className={`event-dot dot-${event.tone}`} />
                  <span className="event-time">{event.time}</span>
                  <span className="event-copy"><strong>{event.label}</strong><small>{event.detail}</small></span>
                  {index === 0 ? <ChevronRight size={16} /> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="agent-card telemetry-card">
            <div className="telemetry-item"><Cpu /><span><small>INT8 INFERENCE</small><strong>31 ms</strong></span></div>
            <div className="telemetry-item"><Zap /><span><small>MODEL FOOTPRINT</small><strong>48 KB</strong></span></div>
            <div className="telemetry-item"><LockKeyhole /><span><small>RAW DATA SENT</small><strong>0 bytes</strong></span></div>
          </section>

          <p className="prototype-note">Interactive deterministic simulation. Engineering figures are design targets pending hardware validation. Clinical decision support research only.</p>
        </aside>
      </div>
    </main>
  );
}
