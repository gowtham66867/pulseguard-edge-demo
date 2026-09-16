# PulseGuard ESP32-S3 integration scaffold

This folder is an **integration contract**, not a claim that the current web demo is executing on an ESP32-S3. The production path is deliberately separated from the browser prototype so a reviewer can see what must be profiled and validated on physical hardware.

## Target pipeline

`I2C sensors → 30 s feature window → quality gate → int8 inference → persistence policy → UART/BLE event frame`

The browser's `lib/firmware.ts` emits the same stable `PGE/1` frame a device bridge should send:

```text
PGE/1 W=42 Q=96 R=91 C=93 A=CLINICIAN QD=1 NET=OFFLINE M=edge-mlp-int8-v0.4 P=safety-policy-v3
```

## Hardware handoff checklist

1. Use ESP-IDF on an ESP32-S3; configure I2C and sensor identity checks.
2. Integrate MAX3010x optical data and an IMU motion channel, then reproduce the documented feature units.
3. Export a trained, held-out-evaluated model to int8 C data (TensorFlow Lite for Microcontrollers is a suitable reference path).
4. Port the **same** quality thresholds, persistence ladder and event schema from `lib/agent.ts`; add golden-vector tests before changing policy.
5. Measure RAM, flash, energy, sensor timing and end-to-end latency on the exact board; replace all target labels only with measured results.
6. Complete clinical, privacy, cybersecurity and regulatory work before any patient-facing use.

## Reference implementations to study

- [Espressif / ESP-TFLite-Micro](https://github.com/espressif/esp-tflite-micro) — ESP-IDF component and examples for TensorFlow Lite Micro on Espressif targets.
- [TensorFlow / tflite-micro](https://github.com/tensorflow/tflite-micro) — constrained-device inference runtime and conversion examples.
- [SparkFun / MAX3010x Sensor Library](https://github.com/sparkfun/SparkFun_MAX3010x_Sensor_Library) — optical sensor register/driver reference; check its license and attribution terms before reuse.
- [Adafruit / Adafruit_MPU6050](https://github.com/adafruit/Adafruit_MPU6050) — 6-DoF motion-sensor driver reference; check its license and dependency terms before reuse.
- [Espressif / esp-idf](https://github.com/espressif/esp-idf) — I2C, BLE and production build framework.

No third-party source code is copied into PulseGuard. Each dependency must receive a separate license, security, version and hardware-validation review before integration.
