# Demo guide

## Public deployment

Open [https://pulseguard-edge-demo.trilogy-1207.chatgpt.site/](https://pulseguard-edge-demo.trilogy-1207.chatgpt.site/).

## Local setup

```bash
git clone https://github.com/gowtham66867/pulseguard-edge-demo.git
cd pulseguard-edge-demo
npm install
npm run dev
```

## Ninety-second judging script

**Opening, 15 seconds**

“PulseGuard Edge looks for patient-specific deterioration on the device. Raw physiological windows stay local, and the first response does not wait for the cloud.”

**Stable baseline, 15 seconds**

Select **Stable baseline**. Point to high signal quality, low risk, high confidence, and the `MONITOR` action.

**Motion artifact, 20 seconds**

Select **Motion artifact**. Point to the distorted trace and low signal quality. The agent selects `RE-MEASURE` instead of raising a false alarm.

**Sustained drift, 20 seconds**

Select **Sustained drift**. The trace moves gradually, multiple vitals change, signal quality stays high, and the agent selects `CAREGIVER`.

**Offline operation, 15 seconds**

Toggle **Offline**. Repeat a scenario and show that local scoring continues. Explain that a target device retains compact event summaries and supports a BLE caregiver handoff.

**Close, 5 seconds**

“The next milestone connects real sensors, validates the model on replay data, and measures latency, memory, and energy on hardware.”

## Expected values

| Scenario | Risk | Confidence | Signal quality | Action |
| --- | ---: | ---: | ---: | --- |
| Stable baseline | 12% | 95% | 98% | `MONITOR` |
| Motion artifact | 18% | 34% | 27% | `RE-MEASURE` |
| Sustained drift | 82% | 93% | 96% | `CAREGIVER` |

These values are deterministic demonstration fixtures, not results from a clinical model.

## Common questions

**Does the demo use real sensors?**  
No. The public build uses simulated inputs so reviewers can reproduce every state.

**Why call it agentic?**  
It closes a bounded observe-contextualize-decide-act loop, maintains limited state, explains decisions, and continues offline. Its action space is deliberately restricted.

**Does it diagnose a condition?**  
No. It estimates deterioration risk and routes attention. It does not diagnose disease or generate treatment advice.

**What runs on the edge?**  
The target firmware performs signal conditioning, baseline normalization, INT8 risk inference, confidence checks, persistence logic, and event storage.

**What reaches the cloud?**  
By default, only a compact event record with derived values and delivery metadata. Raw streams require a separate approved workflow.

**What must be validated next?**  
Sensor acquisition, replay-dataset accuracy, subgroup calibration, false-alert burden, hardware latency, peak RAM, storage recovery, BLE delivery, and battery life.
