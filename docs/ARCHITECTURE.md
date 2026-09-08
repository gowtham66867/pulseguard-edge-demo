# Architecture

## System boundary

PulseGuard Edge places signal validation, baseline normalization, risk inference, and the first response decision on an edge device. Network services receive event summaries only when policy and consent allow transmission.

```text
PPG / SpO₂ ─┐
Heart rate ─┼─> acquisition buffer ─> quality gate ─> feature window
Temperature ┤                                      │
IMU ────────┘                                      v
                                      personal baseline normalizer
                                                  │
                                                  v
                                      INT8 multivital model
                                                  │
                                                  v
                                  confidence + persistence policy
                                    │        │          │
                                 monitor  re-measure  escalate
                                                  │
                                      signed event record
                                                  │
                              BLE handoff / deferred encrypted sync
```

## Runtime components

| Component | Responsibility | Data retained |
| --- | --- | --- |
| Acquisition buffer | Align sensor samples into a fixed window | Short rolling window |
| Quality gate | Detect motion, saturation, dropouts, and impossible values | Quality score and reason code |
| Baseline normalizer | Convert values into patient-relative features | Bounded summary statistics |
| Risk model | Produce deterioration risk from valid features | No long-term state |
| Confidence gate | Abstain when evidence is weak or out of distribution | Confidence and abstention reason |
| Policy engine | Apply persistence and escalation rules | Current finite-state-machine state |
| Event store | Preserve compact decisions during outages | Timestamped summary records |
| Sync adapter | Send approved summaries after reconnection | Delivery and acknowledgement state |

## Decision state machine

```text
MONITOR
  ├─ poor signal quality ─> RE-MEASURE
  ├─ persistent moderate risk ─> CAREGIVER
  └─ persistent high risk with high confidence ─> CLINICIAN

RE-MEASURE
  ├─ quality recovers and risk is low ─> MONITOR
  └─ repeated failure ─> CAREGIVER with sensor-fault reason

CAREGIVER
  ├─ acknowledged / resolved ─> MONITOR
  └─ worsening persistent risk ─> CLINICIAN
```

Production thresholds must be configurable, versioned, and locked behind a clinical governance process. The public demo uses deterministic scenario values for explanation and does not implement a medical alarm.

## Data minimization

A production event record should contain:

- pseudonymous device and enrollment identifiers;
- timestamp and firmware/model/policy versions;
- risk, confidence, signal-quality score, and action;
- a small set of derived features or reason codes;
- acknowledgement and delivery status.

Continuous raw waveforms remain on device unless a separately approved diagnostic workflow requests them.

## Target deployment profile

The intended hardware is an ESP32-S3 class device running an INT8 model through TensorFlow Lite Micro or Edge Impulse. The project deck lists 45k parameters, a 48 KB model, a 26 KB tensor arena, and inference below 40 ms as design targets. Hardware profiling must confirm these figures before they become performance claims.

## Trust boundaries

1. **Sensor boundary:** reject malformed, saturated, missing, or motion-corrupted samples.
2. **Model boundary:** accept only signed model packages and immutable inference weights.
3. **Policy boundary:** restrict actions to an allow list and require persistence for escalation.
4. **Storage boundary:** encrypt local event records and rotate device credentials.
5. **Network boundary:** authenticate endpoints, retry idempotently, and avoid raw-stream upload by default.
6. **Human boundary:** expose the reason, confidence, and acknowledgement state for every escalation.

## Degraded modes

| Failure | Safe behavior |
| --- | --- |
| Network unavailable | Continue local monitoring; queue event summaries |
| One sensor missing | Mark feature unavailable; abstain if required evidence is insufficient |
| Low signal quality | Request re-measurement; suppress risk escalation from that window |
| Storage nearing capacity | Preserve highest-severity unacknowledged events first |
| Clock uncertainty | Mark timestamps uncertain; maintain monotonic ordering |
| Model or policy integrity failure | Disable inference escalation and surface a device-fault state |
| Repeated reboot | Retain last acknowledged state and request service |
