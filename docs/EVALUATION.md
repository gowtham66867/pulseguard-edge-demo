# Evaluation plan and test harness

## Evaluation goals

The evaluation program must answer five questions:

1. Does the signal gate reject corrupted windows without hiding true deterioration?
2. Does personalization improve detection of gradual change without drifting during illness?
3. Does the model abstain when confidence is insufficient?
4. Does the policy escalate only after the configured persistence condition?
5. Can the device continue safely through network, sensor, power, and storage faults?

## Test harness architecture

```text
CSV / EDF replay data or synthetic generator
                 │
                 v
        sensor adapter interface
                 │
                 v
 firmware-in-the-loop or native simulator
                 │
       ┌─────────┴─────────┐
       v                   v
 decision event log   performance trace
       │                   │
       └─────────┬─────────┘
                 v
   oracle comparison and metric report
```

The same sensor-adapter contract should serve browser fixtures, native model tests, hardware-in-the-loop replay, and recorded pilot data. Each fixture includes input samples, connectivity and fault events, expected allowed actions, and timing bounds.

## Suggested fixture schema

```json
{
  "caseId": "artifact-walking-001",
  "sampleRateHz": 50,
  "signals": {
    "ppg": "fixtures/artifact-walking-001.ppg.csv",
    "spo2": "fixtures/artifact-walking-001.spo2.csv",
    "temperature": "fixtures/artifact-walking-001.temp.csv",
    "imu": "fixtures/artifact-walking-001.imu.csv"
  },
  "events": [{ "atMs": 30000, "network": "offline" }],
  "oracle": {
    "forbiddenActions": ["CAREGIVER", "CLINICIAN"],
    "requiredActionByMs": { "action": "RE_MEASURE", "deadline": 35000 }
  }
}
```

## Deterministic policy test cases

| ID | Input condition | Expected result | Pass criterion |
| --- | --- | --- | --- |
| P01 | Stable signals, high quality, low risk | `MONITOR` | No escalation across 60 valid windows |
| P02 | One noisy PPG window with high apparent risk | `RE-MEASURE` | No caregiver or clinician event |
| P03 | Low confidence with valid signal quality | `RE-MEASURE` | Risk cannot bypass confidence floor |
| P04 | One high-risk valid window | `MONITOR` or pending state | No escalation before persistence rule passes |
| P05 | High risk in N of M valid windows | `CAREGIVER` | One event with correct persistence count |
| P06 | High risk persists after caregiver state | `CLINICIAN` request | Escalation only under governed threshold set |
| P07 | Risk resolves before persistence threshold | `MONITOR` | Pending state clears without alert |
| P08 | Repeated re-measurement failures | Caregiver sensor-fault event | Reason code identifies measurement failure |
| P09 | Missing temperature channel | Degraded inference or abstention | Behavior matches declared feature contract |
| P10 | Impossible SpO₂ value | Window rejected | Invalid sample never reaches model input |
| P11 | Network disconnect during high risk | Local escalation and queued record | Decision latency unchanged; event retained |
| P12 | Reconnect after queued events | Ordered idempotent delivery | No duplicated or missing event IDs |
| P13 | Storage near capacity | Priority retention | Unacknowledged severe event remains available |
| P14 | Model signature failure | Safe device-fault state | Inference escalation disabled |
| P15 | Clock correction after outage | Monotonic event order | Records retain sequence and uncertainty marker |
| P16 | Baseline drift during an alert | Baseline freeze | Alert data cannot normalize itself away |
| P17 | Reboot during caregiver event | State recovery | Unacknowledged event remains visible |
| P18 | Duplicate acknowledgement | Idempotent update | Event resolves once without corruption |

## Signal and model evaluation

### Dataset split

- Split by patient, never by window, to prevent identity leakage.
- Reserve a locked test cohort before feature tuning.
- Report results by age, sex, skin tone where available, care setting, device placement, and major comorbidity groups.
- Keep motion-heavy and low-perfusion segments as explicit challenge sets.

### Metrics

| Layer | Primary metrics |
| --- | --- |
| Signal quality | corrupted-window sensitivity, clean-window specificity, false rejection rate |
| Risk model | AUROC, AUPRC, sensitivity at fixed alert burden, specificity, calibration error, Brier score |
| Abstention | coverage, selective risk, error rate among accepted windows |
| Persistence policy | event sensitivity, false alerts per patient-day, median detection delay |
| Personalization | change in patient-level sensitivity and alert burden versus population baseline |
| Reliability | queued-event loss, duplicate delivery rate, recovery time |
| Edge performance | median and p95 inference latency, peak tensor arena, total RAM, flash, energy per window |

Accuracy alone is insufficient because deterioration datasets are often imbalanced. The review should emphasize event-level sensitivity, false alerts per patient-day, calibration, and detection delay.

## Synthetic and replay scenarios

1. Clean stable rest for at least one hour.
2. Walking artifact without physiological deterioration.
3. Sensor displacement and partial detachment.
4. Low perfusion with intermittent PPG dropout.
5. Slow coordinated change across heart rate, SpO₂, and temperature.
6. Abrupt isolated value change that fails persistence.
7. True drift hidden inside moderate motion.
8. Network outage before, during, and after an escalation.
9. Low battery, full event storage, and repeated reboot.
10. Baseline enrollment with insufficient clean samples.

## Hardware-in-the-loop procedure

1. Convert the same fixture window to the exact fixed-point or quantized input used by firmware.
2. Replay samples at real time and accelerated time through the sensor-adapter interface.
3. Capture model input tensors, risk, confidence, state transitions, event records, peak RAM, and cycle counts.
4. Compare decisions with the native reference implementation and the fixture oracle.
5. Fail the build on decision mismatch, event loss, forbidden action, memory overflow, or latency beyond the approved target.

## Initial engineering gates

The following gates are proposed targets, not validated results:

| Gate | Initial target |
| --- | ---: |
| Inference latency | p95 below 40 ms per window |
| Model size | 48 KB or less |
| Tensor arena | 26 KB or less |
| Offline event loss | 0 across planned outage tests |
| Duplicate event delivery | 0 after retry and reconnection |
| Forbidden escalation on corrupted window | 0 in deterministic policy suite |
| Raw waveform network transmission | 0 in default configuration |

Clinical performance gates must be set with clinical partners after defining the population, outcome horizon, intervention workflow, and acceptable alert burden.

## Release evidence

Every candidate firmware and model release should archive:

- source commit, model hash, policy version, and compiler settings;
- dataset manifest and patient-level split hashes;
- full test-case results and subgroup metrics;
- memory map, latency distribution, and energy trace;
- known limitations and failed challenge cases;
- approval record and rollback package.
