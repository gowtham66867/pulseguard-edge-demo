# Demo guide

## Public deployment

Open [https://pulseguard-edge-demo.trilogy-1207.chatgpt.site/](https://pulseguard-edge-demo.trilogy-1207.chatgpt.site/).

## Local setup

```bash
npm install
npm run dev
```

## Ninety-second judging script

Everything on screen is computed live by `lib/`, one decision per simulated 30 s window. Let the stream run while you talk — the agent advances on its own.

**Opening, 10 seconds**

"PulseGuard Edge looks for patient-specific deterioration on the device. Raw physiological windows stay local, and the first response does not wait for the cloud."

**Stable baseline, 10 seconds**

Press <kbd>1</kbd>. High signal quality, low risk, high confidence, `MONITOR`. Point out that the risk index moves slightly window to window — these are scored measurements, not a fixed value.

**Motion artifact, 20 seconds**

Press <kbd>2</kbd>. The key beat of the demo: **risk climbs toward 40%, and the agent still refuses to act.** Signal quality is around 28%, below the 60% floor, so the window never reaches the policy at all. Without that gate this is the window that becomes a false alarm. Leave it running and after six rejections the agent reports a suspected sensor fault rather than guessing.

**Sustained drift, 20 seconds**

Press <kbd>3</kbd>. Watch the persistence meter fill. The agent stays at `MONITOR` until 4 of the last 6 valid windows clear 55% risk, then escalates to `CAREGIVER`. One bad window is not an alarm. Note the baseline panel switching to **FROZEN** — personalization stops during an escalation, so a deteriorating patient can never be normalized into a new "healthy" baseline.

**Critical cascade, 20 seconds**

Press <kbd>4</kbd>. The ladder climbs in order, `CAREGIVER` then `CLINICIAN`, never skipping a rung. Then press <kbd>1</kbd> to return to a calm patient: **the alert stays open.** The agent does not cancel its own escalation; only the acknowledge button releases it. Download the event packet to show the reason, the rule that fired, the feature vector, and the model and policy versions travelling with the decision.

**Offline operation, 15 seconds**

Press <kbd>O</kbd>. Decisions continue unchanged. The ribbon shows the local retention count, escalations get a `QUEUED` flag, and the timeline records the outage. Press <kbd>O</kbd> again and the queue drains with a `SYNC COMPLETE` entry. A test asserts the decision sequence is identical with and without the cloud.

**Executable evidence, 15 seconds**

Scroll to **Edge Safety Verification Lab** and press **Run proof suite**. The browser replays 612 windows through the same imported agent classes: four scenario runs, an online/offline twin, and a 500-window baseline-poisoning challenge. Point out the explicit evidence labels: browser timing is measured now; ESP32-S3 latency remains a target until hardware profiling. Export the JSON report if a judge wants the exact observations.

**Close, 5 seconds**

"The next milestone connects real sensors, trains and calibrates the model on replay data, and measures latency, memory and energy on hardware."

## Keyboard control

| Key | Action |
| --- | --- |
| <kbd>1</kbd>–<kbd>4</kbd> | Select scenario |
| <kbd>O</kbd> | Toggle connectivity |
| <kbd>A</kbd> | Auto demo |
| <kbd>Space</kbd> | Pause / resume the stream |
| <kbd>R</kbd> | Reset, including the learned baseline |

## Expected values

Computed live, so they vary window to window. Observed ranges over the first 20 windows:

| Scenario | Signal quality | Risk index | Confidence | Decision | Reached at |
| --- | ---: | ---: | ---: | --- | ---: |
| Stable baseline | 95–98% | 12–13% | 91–93% | `MONITOR` | window 1 |
| Motion artifact | 28–44% | 16–40% | 35–51% | `RE-MEASURE` | window 1 |
| Sustained drift | 94–97% | 76–85% | 77–92% | `CAREGIVER` | window 4 |
| Critical cascade | 93–97% | 95–96% | 96–98% | `CLINICIAN` | window 5 |

The sensor generator is seeded, so these are reproducible on any machine. `npm test` asserts each scenario lands in the range printed here — if the engine changes and the docs do not, the build fails.

## Common questions

**Does the demo use real sensors?**
No. A seeded generator produces the sample stream so reviewers can reproduce every state exactly. Everything downstream of the sensor — the quality gate, baseline, model and policy — is the real implementation.

**Is the model trained?**
No. The weights are hand-authored and interpretable, encoding four clinically-motivated hidden features. The *arithmetic* is genuine int8 inference with int32 accumulators, which is why the page can report a measured inference cost rather than a quoted one. Training and calibrating on replay data is the first item in the evaluation plan.

**Why call it agentic?**
It closes a bounded observe-contextualize-decide-act loop, maintains limited state, explains its decisions, and continues offline. Its action space is deliberately restricted to four allow-listed responses.

**Does it diagnose a condition?**
No. It estimates deterioration risk and routes attention. It does not diagnose disease or generate treatment advice.

**What runs on the edge?**
The target firmware performs signal conditioning, baseline normalization, int8 risk inference, confidence checks, persistence logic and event storage. The browser build runs the same quantized forward pass in 40 bytes of parameters.

**What reaches the cloud?**
By default, only a compact event record with derived values and delivery metadata. Raw streams require a separate approved workflow.

**What must be validated next?**
Sensor acquisition, replay-dataset accuracy, subgroup calibration, false-alert burden, hardware latency, peak RAM, storage recovery, BLE delivery and battery life.
