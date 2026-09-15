# Component test matrix

`npm run verify` runs the whole release gate: lint, 42 executable tests, and a
production build. The browser's **Edge Safety Verification Lab** replays an
additional 612 deterministic windows through the same implementation.

## Signal component — `lib/signal.ts`

| Case | Stimulus | Expected invariant |
| --- | --- | --- |
| Determinism | Same scenario and window index twice | Exact same samples every time |
| Clean baseline | 20 stable windows | Quality stays at or above the 60% floor |
| Motion artifact | 20 corrupted windows | Every window is rejected before scoring |
| True deterioration | 20 critical windows | Quality remains high enough to be evaluated |

## Model component — `lib/model.ts`

| Case | Stimulus | Expected invariant |
| --- | --- | --- |
| Feature monotonicity | Increment each adverse feature | Quantized logit never falls |
| Calibration order | Sweep calibration link | Rank order is preserved |
| Clinical separation | Resting versus adverse vector | Rest remains low risk; adverse vector exceeds 90% risk |
| Low-trust behavior | Same vector at 96% and 27% quality | Risk stays identical; confidence falls below gate |
| Motion safety | Desaturation with higher activity | Activity cannot reduce desaturation risk |
| Footprint | Quantized parameters | Model remains below 1 KB (40 bytes currently) |

## Baseline component — `lib/model.ts`

| Case | Stimulus | Expected invariant |
| --- | --- | --- |
| Active escalation | Attempt baseline update while alerting | Update is refused and profile freezes |
| Single update bound | Extreme accepted value | One update moves at most 0.08 SD |
| Poisoning resistance | 500 forced abnormal windows | 140 bpm still remains more than 1 SD from baseline |
| Quantization bounds | Extreme numeric values | Deviations clamp at the defined 6 SD limit |

## Agent and policy component — `lib/agent.ts`

| Case | Stimulus | Expected invariant |
| --- | --- | --- |
| Stable replay | 24 stable windows | Remains `MONITOR` |
| Artifact replay | 12 motion-corrupted windows | Remains `RE-MEASURE`; no escalation |
| Persistent artifact | 6+ rejected windows | One sensor-fault event is raised |
| Drift replay | Sustained multivital drift | `CAREGIVER` only after 4-of-6 valid windows |
| Critical replay | Persistent critical pattern | Ladder reaches `CAREGIVER` before `CLINICIAN` |
| Alert recovery | Return to stable after escalation | Agent holds the alert until acknowledgement |
| Acknowledgement | Human acknowledges alert | Ladder resets and stable replay returns to `MONITOR` |

## Recovery and audit component — `lib/agent.ts`

| Case | Stimulus | Expected invariant |
| --- | --- | --- |
| Offline escalation | Disconnect during critical replay | Event is retained in the local queue |
| Reconnection | Restore uplink | Queue drains; events are marked delivered |
| Cloud parity | Same critical replay online/offline | Identical action sequence |
| Explainability | Critical escalation | Packet includes reason, policy, versions and features |
| Audit ordering | Artifact and clean windows | Quality gate precedes scoring; rejected windows are never scored |
| Audit bounds | 400-window replay | Event log remains capped at 160 entries |
| Decision signal | Long unchanged run | Decision event is logged once, not repeated every window |

## Browser harness — `lib/evaluation.ts`

The UI proof suite is intentionally not a canned visual. It reuses the agent,
model and signal modules and checks:

1. zero stable false escalations over 20 windows;
2. 20 artifact abstentions;
3. ordered caregiver-to-clinician escalation;
4. 16-window offline decision parity;
5. a 500-window baseline-poisoning challenge; and
6. quantized parameter footprint.

The report is exportable as JSON from the demo and is marked as synthetic,
deterministic verification—not clinical validation.
