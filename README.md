# PulseGuard Edge

Interactive software prototype for an offline-first patient deterioration monitor.

The demo simulates four on-device stages:

1. signal conditioning and motion-artifact rejection;
2. personalized baseline normalization;
3. quantized multivital inference;
4. confidence-aware monitoring, re-measurement, or escalation.

Use the three scenario controls to compare a stable baseline, a motion artifact, and sustained multivital drift. Toggle network connectivity to demonstrate that local monitoring continues offline.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Prototype status

This is an interactive software demonstration using simulated sensor inputs. Performance, memory, latency, transmission, and battery figures are design targets pending validation on physical hardware. PulseGuard Edge is clinical decision-support research, not a diagnostic or emergency-response device.
