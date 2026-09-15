# Advanced agentic features

## Definition

PulseGuard Edge is a bounded autonomous safety agent. It repeatedly observes physiological and device state, uses limited patient context, chooses an action from an approved policy, records the reason, and continues during a network outage. It does not use an on-device large language model and does not generate medical advice.

## Agent loop

| Stage | Agent behavior | Guardrail |
| --- | --- | --- |
| Observe | Collect synchronized vitals, IMU context, battery, connectivity, and signal quality | Validate ranges and reject corrupted windows |
| Contextualize | Compare features with a personal rolling baseline | Bound update rates and minimum sample counts |
| Infer | Produce risk and confidence from a signed INT8 model | Freeze model weights on device |
| Deliberate | Combine quality, confidence, persistence, and current state | Deterministic versioned policy |
| Act | Monitor, request a new reading, notify a caregiver, or request clinician review | Allow-listed actions with severity limits |
| Explain | Store risk, confidence, quality, reason codes, and contributing trends | No unsupported diagnosis or free-form advice |
| Recover | Queue events offline and retry delivery after reconnection | Encrypted storage and idempotent delivery |

## Memory model

The agent uses three deliberately small forms of memory:

- **Window memory:** a short ring buffer for signal conditioning and feature extraction.
- **Baseline memory:** bounded exponentially weighted statistics representing the patient’s recent stable state.
- **Event memory:** compact, timestamped decision records kept until acknowledgement or expiry.

No unrestricted conversation history, cloud dependency, or autonomous model retraining is required.

## Confidence-aware abstention

Risk alone does not trigger action. The policy also checks whether the measurement is trustworthy and whether the model is confident enough to act. A conformal or calibrated uncertainty layer is planned for the hardware model.

```text
if signal_quality < 60:            # window is excluded from the policy buffer entirely
    action = RE_MEASURE
else if confidence < 70:           # measurement is usable, model is not resolved
    action = RE_MEASURE
else if risk >= 88 in 5 of last 8 valid windows and stage >= CAREGIVER:
    action = CLINICIAN             # the ladder is never skipped
else if risk >= 55 in 4 of last 6 valid windows:
    action = CAREGIVER
else if an escalation is already open:
    action = hold                  # only a human acknowledgement releases it
else:
    action = MONITOR
```

This design prevents a single noisy window from becoming an alarm and ensures the system can say “I do not have reliable evidence.”

## Safe personalization

Personalization changes feature normalization, not the model’s learned weights. Baseline updates occur only during accepted stable windows and stop during alerts, poor-quality sensing, fever-like excursions, or suspected sensor faults. Production firmware should enforce:

- minimum enrollment duration before personalized thresholds activate;
- maximum baseline change per hour and per day;
- rollback to a known-good baseline snapshot;
- a visible baseline-reset event;
- cohort-level fallback ranges when personal history is insufficient.

## Graduated actions

1. `MONITOR`: continue local scoring and store no alert.
2. `RE-MEASURE`: prompt repositioning, a rest period, or a repeated window.
3. `CAREGIVER`: create a local high-priority event and use BLE or network delivery.
4. `CLINICIAN`: request clinical review after persistent, high-confidence evidence.

The public prototype demonstrates the first three states. The clinician state remains a policy and workflow design until clinical governance approves it.

## Explainability packet

Each production escalation should expose:

- current action and previous state;
- risk, confidence, and signal quality;
- persistence count and policy version;
- relative changes from personal baseline;
- missing or rejected inputs;
- local/offline delivery status;
- model and firmware versions.

The packet explains why the agent acted without pretending to provide a diagnosis.

## Security and governance controls

- signed firmware, model, and policy packages;
- secure boot and encrypted local storage;
- least-privilege BLE and network interfaces;
- versioned thresholds with an approval trail;
- append-only decision records for incident review;
- explicit consent and retention configuration;
- human acknowledgement for escalations;
- kill switch or safe-mode transition after integrity failure.

## Current implementation versus roadmap

| Capability | Public software demo | Target edge prototype |
| --- | --- | --- |
| Deterministic scenarios | Implemented | Replaced by live sensors and replay datasets |
| Signal-quality gate | Demonstrated through motion-artifact state | DSP and IMU-derived quality model |
| Personal baseline | Displayed as a pipeline stage | Bounded streaming statistics |
| INT8 inference | Displayed with target latency | TFLite Micro / Edge Impulse model |
| Confidence gate | Demonstrated through scenario confidence | Calibrated uncertainty and abstention |
| Offline operation | Interactive connectivity state | Encrypted event queue and BLE handoff |
| Audit trail | Documented | Signed or tamper-evident event log |
| Clinical escalation | Caregiver state demonstrated | Governed caregiver and clinician workflow |
