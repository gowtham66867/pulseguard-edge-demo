# PulseGuard Edge — 35-second judge run

Select **Judge run** in the top bar. The demo uses a deterministic, simulated signal source and advances through a fixed care workflow. It is designed to be narrated in under one minute.

| Step | What appears | What to say |
| --- | --- | --- |
| 1. Baseline | Stable, clean windows; profile learning | “We judge each patient against their own bounded baseline—not a population average.” |
| 2. Artifact | Low-quality motion window; RE-MEASURE | “Poor optical contact cannot become a false clinical alert. The agent abstains.” |
| 3. Drift | Repeated valid elevated windows; CAREGIVER | “Escalation requires persistence; one bad window cannot trigger a caregiver.” |
| 4. Offline critical | Critical windows while offline; retained event | “No cloud is needed for detection. The local device retains the explainable event.” |
| 5. Human closure | Connectivity returns; acknowledgement releases ladder | “The alert cannot clear itself. A human has to close the loop.” |

## What is real in this demonstration

- The deterministic signal-quality gate, baseline, fixed-point model, policy ladder, local event queue, protocol frame and 44-test harness execute from this repository.
- The patient stream is synthetic. Browser performance is measured in-browser; ESP32 latency, physical sensor behavior, battery use and clinical performance remain future measurement and validation work.

## Fast backup path

If presenting manually, choose scenarios 1–4 with the numbered cards, tap **Offline** before Critical cascade, then reconnect and select **Acknowledge**. The Evidence Lab shows the same code path replayed across deterministic scenarios.
