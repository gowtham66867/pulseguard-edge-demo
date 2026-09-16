# Open-source implementation references

These are credible projects to study for a physical PulseGuard implementation. They are **references, not dependencies** in the browser prototype. The demo's sensor stream and model are simulated and must not be represented as code from these accounts.

| Account / project | Relevance to PulseGuard | Adoption boundary |
| --- | --- | --- |
| [TensorFlow / tflite-micro](https://github.com/tensorflow/tflite-micro) | Quantized inference on memory-constrained microcontrollers; its workflow documents conversion from a trained model to C data. | Use only after a trained model is evaluated on held-out data; measure runtime and memory on target hardware. |
| [Espressif / esp-tflite-micro](https://github.com/espressif/esp-tflite-micro) | ESP-IDF component and examples for TensorFlow Lite Micro on Espressif targets. | Integration candidate for the ESP32-S3 handoff, not evidence of present ESP32 execution. |
| [Espressif / esp-idf](https://github.com/espressif/esp-idf) | Production ESP32 framework for I2C, BLE and device lifecycle. | Pin versions, review security configuration and test radio/sensor coexistence. |
| [Edge Impulse / firmware-espressif-esp32](https://github.com/edgeimpulse/firmware-espressif-esp32) | Reference for device ingestion and embedded inference packaging. | Assess cloud/data-flow implications and licenses before use; PulseGuard's default stays local-first. |
| [ARM / CMSIS-NN](https://github.com/ARM-software/CMSIS-NN) | Optimized int8/int16 kernels if the hardware path changes to a Cortex-M MCU. | Not applicable to ESP32-S3 directly; architecture option only. |
| [SparkFun / MAX3010x Sensor Library](https://github.com/sparkfun/SparkFun_MAX3010x_Sensor_Library) | MAX3010x/MAX30102 optical sensor register and sampling reference. | Preserve attribution and validate signal-processing choices on the selected board and sensor revision. |
| [Adafruit / Adafruit_MPU6050](https://github.com/adafruit/Adafruit_MPU6050) | 6-DoF IMU driver reference for motion-artifact channels. | License/dependency review and calibration required; it is not a clinical motion-quality algorithm. |

## What a judge can verify today

- The live browser prototype exposes an inspectable `PGE/1` device-frame contract.
- `tests/firmware.test.ts` exercises that contract alongside the existing safety harness.
- The current test suite validates deterministic simulation behavior—not clinical performance, sensor accuracy, battery life or ESP32 latency.

## Hardware evidence plan

For a physical build, record raw test fixtures, firmware commit, board/sensor revision, power mode, temperature, sampling rate, latency distribution, RAM/flash and failure logs. Evaluate fixed thresholds and the final model on patient-disjoint held-out data. Do not tune on the test set; report uncertainty intervals, false alerts, missed detections and subgroup performance before making medical-performance claims.
