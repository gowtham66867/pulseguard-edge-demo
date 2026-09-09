# PulseGuard Edge

Offline-first Edge AI for continuous patient deterioration monitoring.

[Live prototype](https://pulseguard-edge-demo.trilogy-1207.chatgpt.site/) · [Architecture](docs/ARCHITECTURE.md) · [Agentic features](docs/AGENTIC_FEATURES.md) · [Evaluation plan](docs/EVALUATION.md) · [Demo guide](docs/DEMO_GUIDE.md)

PulseGuard Edge analyzes short multivital windows locally, learns a bounded personal baseline, rejects unreliable measurements, and chooses a proportional response. The device can continue monitoring when the network is unavailable and synchronize compact event summaries after connectivity returns.

> **Prototype scope:** The public build is an interactive software demonstration with simulated sensor inputs. It is not a diagnostic device or emergency-response system. The latency, memory, transmission, battery, and clinical-performance figures in the project deck are engineering targets pending hardware and clinical validation.

## Why this matters

Fixed thresholds often miss slow deterioration and can produce nuisance alarms when patients move. Cloud-only monitoring also depends on continuous connectivity and transmits more sensitive physiological data. PulseGuard Edge is designed around three constraints:

- compare the patient with their own recent baseline;
- make the first safety decision on the device;
- transmit an explanation-ready event summary instead of a continuous raw stream.

## What the working demo shows

| Scenario | Signal quality | Edge result | Safety behavior |
| --- | ---: | --- | --- |
| Stable baseline | 98% | `MONITOR` | Continues routine local scoring |
| Motion artifact | 27% | `RE-MEASURE` | Rejects the unreliable window instead of escalating |
| Sustained drift | 96% | `CAREGIVER` | Raises a high-confidence local escalation |
| Critical cascade | 92% | `CLINICIAN` | Prepares an explanation-rich clinical review packet |

The **Online / Offline** control shows that local inference continues without the cloud. In offline mode, the interface describes local event retention and a BLE caregiver handoff path.

## Quick start

Requirements: Node.js 22.13 or newer and npm.

```bash
git clone https://github.com/gowtham66867/pulseguard-edge-demo.git
cd pulseguard-edge-demo
npm install
npm run dev
```

Open the local URL printed by the development server. For a production build:

```bash
npm run build
npm run start
```

## How to use the prototype

1. Start with **Stable baseline** and note the risk, confidence, signal quality, and `MONITOR` decision.
2. Select **Motion artifact**. The quality gate rejects the noisy window and changes the action to `RE-MEASURE`.
3. Select **Sustained drift**. Multiple signals move together, confidence remains high, and the policy escalates to `CAREGIVER`.
4. Select **Critical cascade** to show the governed `CLINICIAN` request and download its event packet.
5. Toggle **Offline** and repeat the scenarios. The decision loop remains active because it does not depend on a cloud response.
6. Select **Auto demo** for a hands-free judging sequence, or **Reset** to return to the stable state.

See [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) for a 90-second judging script and expected observations.

## Edge decision pipeline

```text
Sensors / simulated stream
        ↓
Signal conditioning and quality gate
        ↓
Personal baseline normalization
        ↓
Quantized multivital risk inference
        ↓
Confidence and persistence policy
        ↓
MONITOR | RE-MEASURE | CAREGIVER | CLINICIAN
        ↓
Compact event record and deferred encrypted sync
```

The UI demonstrates all four policy outcomes with deterministic inputs. These are workflow fixtures, not results from a clinical model.

## Advanced agentic behavior

PulseGuard uses a bounded safety agent, not a free-form generative agent. Its authority is limited to sensing, scoring, requesting a better measurement, and escalating to a human.

- **Observe:** scores a rolling physiological window and measures signal quality.
- **Contextualize:** compares the window with a bounded patient baseline.
- **Decide:** combines risk, confidence, persistence, connectivity, and device state.
- **Act:** selects the least disruptive safe response from an allow-listed policy.
- **Explain:** packages the decision, confidence, signal quality, and contributing trend.
- **Recover:** queues compact events offline and reconciles them after reconnection.
- **Adapt safely:** updates normalization statistics within limits while model weights remain frozen.

The detailed state machine, guardrails, memory boundaries, and failure modes are in [docs/AGENTIC_FEATURES.md](docs/AGENTIC_FEATURES.md).

## Technology stack

### Working web prototype

- React 19 and TypeScript
- Vinext and Vite
- Tailwind CSS and shadcn components
- Lucide icons
- Cloudflare-compatible deployment through OpenAI Sites

### Target edge implementation

- ESP32-S3 class MCU with BLE and secure storage
- PPG / SpO₂, heart-rate, skin-temperature, and IMU inputs
- TensorFlow Lite Micro or Edge Impulse runtime
- INT8 temporal model with a confidence or conformal-abstention layer
- Ring-buffered event log with encrypted deferred synchronization

Target hardware choices are provisional until profiling confirms memory, latency, thermal, and battery limits.

## Repository map

```text
app/page.tsx              Interactive scenarios and edge-decision display
app/globals.css           Visual system and responsive states
docs/ARCHITECTURE.md      Software, firmware, data, and trust boundaries
docs/AGENTIC_FEATURES.md  Bounded autonomous loop and safety controls
docs/DEMO_GUIDE.md        Setup, walkthrough, and judging script
docs/EVALUATION.md        Test matrix, harness design, metrics, and gates
public/                   Static assets
```

## Verification

```bash
npm run lint
npm run build
```

The evaluation plan covers deterministic scenario tests, policy tests, corrupted-signal tests, offline recovery, latency and memory profiling, and clinical-model validation. See [docs/EVALUATION.md](docs/EVALUATION.md).

## Privacy and safety principles

- Raw physiological windows stay local by default.
- Cloud synchronization carries compact event summaries only.
- Low-confidence or low-quality inputs trigger abstention or re-measurement.
- Model weights do not update autonomously in the field.
- Human caregivers and clinicians retain escalation authority.
- Every production decision must be traceable through a timestamped event record.

## Responsible use

No clinical use is authorized. Any real-world pilot requires institutional review, informed consent, security review, documented data governance, calibrated alert thresholds, and validation with representative patient populations.
