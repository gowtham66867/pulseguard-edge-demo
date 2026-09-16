# PulseGuard Edge

Offline-first Edge AI for continuous patient deterioration monitoring.

[Live prototype](https://pulseguard-edge-demo.trilogy-1207.chatgpt.site/) · [Judge run](docs/JUDGE_DEMO_RUNBOOK.md) · [Architecture](docs/ARCHITECTURE.md) · [Agentic features](docs/AGENTIC_FEATURES.md) · [Evaluation plan](docs/EVALUATION.md) · [Hardware references](docs/OPEN_SOURCE_REFERENCES.md)

PulseGuard Edge analyzes short multivital windows locally, learns a bounded personal baseline, rejects unreliable measurements, and chooses a proportional response. The device keeps monitoring when the network is unavailable and synchronizes compact event summaries after connectivity returns.

> **Prototype scope.** Sensors are simulated and the model weights are hand-authored, not trained on patient data. This is not a diagnostic device or an emergency-response system. Hardware latency, memory, battery and clinical-performance figures in the project deck are engineering targets pending validation.

## What is actually running

The demo is not a slideshow of canned results. Every number on screen is computed in your browser, on every window, by the code in `lib/`:

| Stage | Implementation | Source |
| --- | --- | --- |
| Sensor acquisition | Seeded generator producing 30 samples per 30 s window | [`lib/signal.ts`](lib/signal.ts) |
| Signal quality gate | Composite of accelerometer motion, PPG beat-to-beat jitter and SpO₂ variance | [`lib/signal.ts`](lib/signal.ts) |
| Personal baseline | EWMA means with per-step *and* cumulative drift ceilings | [`lib/model.ts`](lib/model.ts) |
| Risk inference | int8 weights, int32 accumulators, explicit requantization between layers | [`lib/model.ts`](lib/model.ts) |
| Calibration | Monotone link plus Platt scaling, kept separate from the model | [`lib/model.ts`](lib/model.ts) |
| Confidence | Decision-boundary margin combined with measurement trust | [`lib/model.ts`](lib/model.ts) |
| Policy and escalation | Quality gate → confidence gate → persistence over a ring buffer | [`lib/agent.ts`](lib/agent.ts) |
| Audit log, offline queue, sync | Bounded event log with delivery and acknowledgement state | [`lib/agent.ts`](lib/agent.ts) |

Because the generator is seeded, the whole pipeline is reproducible: the same scenario and window index yield the same samples, the same score and the same decision on any machine. 44 automated tests assert exactly that, including the browser-to-device `PGE/1` protocol contract.

The model weights are **hand-authored and interpretable**, encoding four clinically-motivated hidden features. They are not trained, and they are not a clinical model. Replacing them with a model trained and calibrated on replay data is the first item in [docs/EVALUATION.md](docs/EVALUATION.md).

## Why this matters

Fixed thresholds often miss slow deterioration and produce nuisance alarms when patients move. Cloud-only monitoring also depends on continuous connectivity and transmits more sensitive physiological data. PulseGuard Edge is designed around three constraints:

- compare the patient with their own recent baseline;
- make the first safety decision on the device;
- transmit an explanation-ready event summary instead of a continuous raw stream.

## What the working demo shows

Values are computed live, so they vary window to window. Observed ranges over the first 20 windows:

| Scenario | Signal quality | Risk index | Confidence | Decision | Reached at |
| --- | ---: | ---: | ---: | --- | ---: |
| Stable baseline | 95–98% | 12–13% | 91–93% | `MONITOR` | window 1 |
| Motion artifact | 28–44% | 16–40% | 35–51% | `RE-MEASURE` | window 1 |
| Sustained drift | 94–97% | 76–85% | 77–92% | `CAREGIVER` | window 4 |
| Critical cascade | 93–97% | 95–96% | 96–98% | `CLINICIAN` | window 5 |

Three of these are worth watching closely.

**Motion artifact** produces a *visibly elevated* risk index — up to 40% — and the agent still refuses to act on it. Signal quality sits around 28%, below the 60% floor, so the window never enters the policy buffer at all. Without that gate this is exactly the window that becomes a false alarm.

**Sustained drift** does not escalate immediately. The persistence meter fills one pip per qualifying window and the agent holds at `MONITOR` until 4 of the last 6 valid windows clear 55% risk. One bad window is not an alarm.

**Critical cascade** climbs the ladder in order — `MONITOR` → `CAREGIVER` → `CLINICIAN` — and never skips a rung. Switch to a calm scenario afterwards and the alert *stays open*: the agent does not cancel its own escalation. Only the acknowledge button releases it.

The **Online / Offline** control cuts the uplink. Decisions continue unchanged, escalations accumulate in a local queue with a visible count, and reconnecting drains the queue and writes a `SYNC COMPLETE` entry to the audit log. A test asserts that the decision sequence is byte-identical with and without the cloud.

## Quick start

Requirements: Node.js 22.13 or newer and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## How to use the prototype

1. Start on **Stable baseline**. Note the risk index, confidence, signal quality and the `MONITOR` decision.
2. Select **Motion artifact**. Risk climbs, but the quality gate rejects the window and the action becomes `RE-MEASURE`. Leave it running: after 6 consecutive rejections the agent reports a suspected sensor fault.
3. Select **Sustained drift** and watch the persistence meter fill before the agent escalates to `CAREGIVER`.
4. Select **Critical cascade** to see the governed `CLINICIAN` request, then download its event packet.
5. Toggle **Offline** and repeat. The decision loop is unchanged; the ribbon and event timeline show what is being retained locally.
6. Switch the event timeline to **Every window** to see the full audit trail rather than just the decisions.
7. Scroll to **Edge Safety Verification Lab** and press **Run proof suite**. It executes a 612-window adversarial replay against the same agent classes, then exports a machine-readable evidence report.
8. Use **Judge run** for a guided 35-second care story: baseline → artifact rejection → persistent drift → offline critical escalation → human closure.
9. Use **Auto demo** for an open-ended hands-free sequence, or **Reset** to return to the enrolled state.

Keyboard: <kbd>1</kbd>–<kbd>4</kbd> scenario, <kbd>O</kbd> connectivity, <kbd>A</kbd> auto demo, <kbd>Space</kbd> pause, <kbd>R</kbd> reset.

See [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) for a 90-second judging script.

## Edge decision pipeline

```text
Simulated sensor window (30 s)
        ↓
Signal conditioning and quality gate ──── rejected ──> RE-MEASURE
        ↓
Personal baseline normalization (bounded EWMA)
        ↓
Quantized int8 multivital inference
        ↓
Calibration and confidence ───── below floor ────────> RE-MEASURE
        ↓
Persistence over the last N valid windows
        ↓
MONITOR | CAREGIVER | CLINICIAN
        ↓
Compact event record and deferred encrypted sync
```

## Safety properties the tests enforce

These are not aspirations in a document; they are assertions in [`tests/agent.test.ts`](tests/agent.test.ts) that fail the build if broken.

- Every motion-corrupted window is rejected, and no clean deteriorating window ever is.
- Risk is independent of signal quality; only *confidence* depends on it.
- Elevated activity can never suppress a desaturation signal.
- The baseline cannot be walked onto a deteriorating patient, even over 500 consecutive accepted windows.
- The escalation ladder never skips a rung.
- The agent never de-escalates its own open alert; only acknowledgement releases it.
- A rejected window is never logged as scored.
- Decisions are identical online and offline, and the offline queue always drains on reconnect.

## Advanced agentic behavior

PulseGuard uses a bounded safety agent, not a free-form generative agent. Its authority is limited to sensing, scoring, requesting a better measurement, and escalating to a human.

- **Observe:** score a rolling physiological window and measure signal quality.
- **Contextualize:** compare the window with a bounded patient baseline.
- **Decide:** combine risk, confidence, persistence, connectivity and device state.
- **Act:** select the least disruptive safe response from an allow-listed policy.
- **Explain:** package the decision, confidence, signal quality and contributing trend.
- **Recover:** queue compact events offline and reconcile them after reconnection.
- **Adapt safely:** update normalization statistics within hard limits while model weights stay frozen.

The state machine, guardrails, memory boundaries and failure modes are in [docs/AGENTIC_FEATURES.md](docs/AGENTIC_FEATURES.md).

## Technology stack

### Working web prototype

- React 19 and TypeScript
- Vinext and Vite
- Tailwind CSS, with two shadcn primitives
- Lucide icons
- Cloudflare-compatible deployment through OpenAI Sites

### Target edge implementation

- ESP32-S3 class MCU with BLE and secure storage
- PPG / SpO₂, heart-rate, skin-temperature and IMU inputs
- TensorFlow Lite Micro or Edge Impulse runtime
- INT8 temporal model with a confidence or conformal-abstention layer
- Ring-buffered event log with encrypted deferred synchronization

The browser build already runs the int8 forward pass the firmware would run — same quantization, same accumulator discipline, same 40 bytes of parameters. Target hardware choices remain provisional until profiling confirms memory, latency, thermal and battery limits.

## Repository map

```text
lib/signal.ts             Seeded sensor simulation and the signal-quality gate
lib/model.ts              INT8 quantized model, calibration, bounded baseline
lib/agent.ts              Policy engine, escalation ladder, audit log, offline queue
lib/evaluation.ts         Browser-safe 612-window verification harness
tests/*.test.ts           44 automated tests covering engine, harness and device-frame contract
app/page.tsx              Interactive surface bound to the live agent
app/globals.css           Visual system and responsive states
docs/ARCHITECTURE.md      Software, firmware, data and trust boundaries
docs/AGENTIC_FEATURES.md  Bounded autonomous loop and safety controls
docs/DEMO_GUIDE.md        Setup, walkthrough and judging script
docs/EVALUATION.md        Test matrix, harness design, metrics and gates
docs/JUDGE_DEMO_RUNBOOK.md Scripted 35-second judge-facing care workflow
docs/OPEN_SOURCE_REFERENCES.md Hardware implementation references and evidence boundaries
```

## Verification

```bash
npm run verify
```

That runs lint, the test suite and a production build. Individually:

```bash
npm run lint
npm test
npm run build
```

## Accessibility

- Every decision change is announced through a polite live region.
- All controls are reachable by keyboard and show a visible focus ring.
- The scenario, connectivity and playback controls remain available at phone widths.
- Motion is disabled under `prefers-reduced-motion`.

## Privacy and safety principles

- Raw physiological windows stay local by default.
- Cloud synchronization carries compact event summaries only.
- Low-confidence or low-quality inputs trigger abstention or re-measurement.
- Model weights do not update autonomously in the field.
- Human caregivers and clinicians retain escalation authority.
- Every production decision must be traceable through a timestamped event record.

## Responsible use

No clinical use is authorized. Any real-world pilot requires institutional review, informed consent, security review, documented data governance, calibrated alert thresholds, and validation with representative patient populations.
