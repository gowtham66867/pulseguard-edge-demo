'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Bluetooth, CloudOff, HeartPulse, Radio, RotateCcw, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Scenario = 'stable' | 'artifact' | 'drift';
const paths: Record<Scenario, string> = {
  stable: 'M0 76 C55 69 75 83 130 71 S215 78 270 68 S350 75 420 66 S505 71 560 64',
  artifact: 'M0 76 L65 70 L92 16 L110 126 L132 58 L176 72 L242 68 L270 22 L292 118 L318 62 L390 70 L470 67 L560 66',
  drift: 'M0 91 C80 90 92 84 150 84 S236 76 292 74 S385 58 430 55 S510 39 560 34',
};

export default function Home() {
  const [scenario, setScenario] = useState<Scenario>('stable');
  const [online, setOnline] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick((v) => v + 1), 1200); return () => clearInterval(timer); }, []);
  const state = useMemo(() => scenario === 'artifact'
    ? { risk: 18, confidence: 34, action: 'RE-MEASURE', tone: 'amber', hr: 108, spo2: 96, temp: 36.9, quality: 27 }
    : scenario === 'drift'
      ? { risk: 82, confidence: 93, action: 'CAREGIVER', tone: 'red', hr: 86, spo2: 94, temp: 37.2, quality: 96 }
      : { risk: 12, confidence: 95, action: 'MONITOR', tone: 'green', hr: 72, spo2: 98, temp: 36.8, quality: 98 }, [scenario]);

  return <main className="min-h-screen bg-[#071a28] text-[#eff8fb]">
    <header className="border-b border-white/10 px-5 py-4 sm:px-8"><div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
      <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-cyan-300 text-[#071a28]"><HeartPulse size={23}/></div><div><p className="font-semibold tracking-tight">PulseGuard Edge</p><p className="text-xs text-slate-400">Offline-first deterioration monitor</p></div></div>
      <div className="flex items-center gap-2"><Badge className="border-white/10 bg-white/5 text-slate-300"><Bluetooth size={13}/> ESP32-S3</Badge><Button variant="outline" size="sm" className="border-white/15 bg-transparent text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => setOnline(!online)}>{online ? <Wifi size={15}/> : <WifiOff size={15}/>} {online ? 'Online' : 'Offline'}</Button></div>
    </div></header>

    <div className="mx-auto grid max-w-[1440px] gap-5 px-5 py-6 lg:grid-cols-[1.5fr_.8fr] sm:px-8">
      <section className="space-y-5">
        <div className="rounded-3xl border border-white/10 bg-[#0c2638] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-cyan-300">Patient 07 · enrolled 18h 42m</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Live physiological stream</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">The model scores a 30-second multivital window locally. No raw waveform leaves this device.</p></div><Badge className={`status-${state.tone}`}>{state.action}</Badge></div>
          <div className="mt-7 grid gap-5 xl:grid-cols-[1fr_260px]">
            <div className="relative h-[270px] overflow-hidden rounded-2xl border border-white/10 bg-[#071d2d] p-5"><div className="chart-grid absolute inset-0"/><div className="relative flex items-center justify-between"><span className="text-xs font-medium text-slate-400">FUSED TREND · LAST 5 MINUTES</span><span className="font-mono text-xs text-cyan-300">window {String(tick % 99).padStart(2, '0')}</span></div><svg viewBox="0 0 560 145" className="relative mt-8 w-full overflow-visible" role="img" aria-label="Simulated patient trend"><path d={paths[scenario]} fill="none" stroke={scenario === 'artifact' ? '#f6b84a' : scenario === 'drift' ? '#ff6b6b' : '#67e8f9'} strokeWidth="4" strokeLinecap="round" className="trend-line"/></svg><div className="relative mt-3 flex justify-between text-[11px] text-slate-500"><span>−5m</span><span>−4m</span><span>−3m</span><span>−2m</span><span>−1m</span><span>now</span></div></div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">{[['Heart rate', `${state.hr} bpm`], ['SpO₂', `${state.spo2}%`], ['Temperature', `${state.temp}°C`], ['Signal quality', `${state.quality}%`]].map(([label, value]) => <div key={label} className="rounded-2xl bg-white/[.055] px-4 py-3"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</div>
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-[#0c2638] p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-cyan-300">Demo controls</p><h2 className="mt-1 text-xl font-semibold">Challenge the safety logic</h2></div><Button variant="ghost" size="sm" className="text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => setScenario('stable')}><RotateCcw size={15}/> Reset</Button></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3"><button className={`scenario ${scenario === 'stable' ? 'selected' : ''}`} onClick={() => setScenario('stable')}><ShieldCheck/><strong>Stable baseline</strong><span>Clean resting signals</span></button><button className={`scenario ${scenario === 'artifact' ? 'selected' : ''}`} onClick={() => setScenario('artifact')}><Activity/><strong>Motion artifact</strong><span>Must not trigger alarm</span></button><button className={`scenario ${scenario === 'drift' ? 'selected' : ''}`} onClick={() => setScenario('drift')}><HeartPulse/><strong>Sustained drift</strong><span>Multisignal deterioration</span></button></div>
        </div>
      </section>

      <aside className="space-y-5">
        <div className="rounded-3xl border border-white/10 bg-[#0c2638] p-5 sm:p-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-cyan-300">Edge decision</p><div className="mt-5 flex items-end justify-between"><div><p className="text-sm text-slate-400">Deterioration risk</p><p className="mt-1 text-6xl font-semibold tracking-tight">{state.risk}<span className="text-2xl text-slate-500">%</span></p></div><div className="text-right"><p className="text-xs text-slate-500">confidence</p><p className="text-xl font-semibold">{state.confidence}%</p></div></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full risk-${state.tone} transition-all duration-500`} style={{ width: `${state.risk}%` }}/></div><div className="mt-7 space-y-3">{[['01', 'Condition signal', state.quality > 70 ? 'passed' : 'rejected'], ['02', 'Personalize baseline', '1.0 KB RAM'], ['03', 'INT8 inference', '31 ms'], ['04', 'Confidence gate', state.action]].map(([n, label, value]) => <div key={n} className="flex items-center gap-3 border-b border-white/8 pb-3 last:border-0"><span className="font-mono text-xs text-cyan-300">{n}</span><span className="flex-1 text-sm">{label}</span><span className="text-xs text-slate-400">{value}</span></div>)}</div></div>
        <div className={`rounded-3xl border p-5 sm:p-6 ${online ? 'border-emerald-400/20 bg-emerald-400/[.07]' : 'border-amber-300/20 bg-amber-300/[.07]'}`}><div className="flex items-start gap-3">{online ? <Radio className="mt-1 text-emerald-300"/> : <CloudOff className="mt-1 text-amber-300"/>}<div><p className="font-semibold">{online ? 'Encrypted sync available' : 'Monitoring continues offline'}</p><p className="mt-1 text-sm leading-6 text-slate-400">{online ? 'Event summaries can synchronize. Raw physiological data remains local.' : 'Events are retained locally; caregiver handoff remains available over BLE.'}</p></div></div></div>
        <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[.07] p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-[.18em] text-cyan-300">Prototype status</p><p className="mt-3 text-sm leading-6 text-slate-300">Interactive software demonstration using simulated sensor inputs. Performance figures are design targets pending hardware validation.</p></div>
      </aside>
    </div>
  </main>;
}
