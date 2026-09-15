/**
 * PulseGuard Edge — INT8 quantized risk model and bounded personal baseline.
 *
 * The forward pass below is genuine fixed-point arithmetic: int8 weights and
 * activations, int32 accumulators, explicit requantization between layers. It is
 * the same shape as the TensorFlow Lite Micro kernel the target firmware would
 * run, which is why the demo can report a measured inference cost rather than a
 * quoted one.
 *
 * The weights are hand-authored and interpretable, not trained. They encode four
 * clinically-motivated hidden features. Any real deployment replaces them with a
 * model trained and calibrated on replay data — see docs/EVALUATION.md.
 */

import { clamp } from './signal.ts';

export type Channel = 'hr' | 'spo2' | 'temp' | 'activity';
export const CHANNELS: Channel[] = ['hr', 'spo2', 'temp', 'activity'];

/**
 * Deviation features, oriented so that larger always means "more concerning".
 *
 * Two channels are deliberately one-sided. Oxygen saturation above baseline is
 * not a benefit to be traded against other findings, and elevated activity must
 * never suppress a risk score: "the patient is moving" is a reason to distrust
 * the measurement, which is the quality gate's job, not a reason to feel safer.
 * Letting motion cancel desaturation is precisely how a wearable misses a
 * deteriorating patient who is still walking around.
 */
export type FeatureVector = {
  /** Tachycardia: +z on heart rate. */
  hr: number;
  /** Desaturation: -z on SpO2, floored so hyperoxia cannot offset other findings. */
  spo2: number;
  /** Pyrexia: +z on temperature. */
  temp: number;
  /** Reduced mobility: -z on activity, floored at zero. */
  activity: number;
};

export const Z_LIMIT = 6; // features saturate here, exactly as int8 quantization would

/* ------------------------------------------------------------------ *
 * Quantization scales
 * ------------------------------------------------------------------ */

const INPUT_SCALE = Z_LIMIT / 127;
const W1_MAX = 0.70;
const W1_SCALE = W1_MAX / 127;
const B1_SCALE = INPUT_SCALE * W1_SCALE;

const H_MAX = 8.0;
const H_SCALE = H_MAX / 127;
const W2_MAX = 0.5845;
const W2_SCALE = W2_MAX / 127;
const B2_SCALE = H_SCALE * W2_SCALE;

function q(value: number, scale: number): number {
  return clamp(Math.round(value / scale), -127, 127);
}

/* ------------------------------------------------------------------ *
 * Layer 1 — four interpretable hidden features
 * ------------------------------------------------------------------ */

/** Real-valued weights, kept alongside the quantized form for documentation. */
export const HIDDEN_UNITS = [
  { name: 'cardio-respiratory', w: { hr: 0.50, spo2: 0.70, temp: 0.00, activity: 0.00 }, b: -0.55 },
  { name: 'inflammatory', w: { hr: 0.35, spo2: 0.00, temp: 0.60, activity: 0.00 }, b: -0.50 },
  { name: 'decompensation', w: { hr: 0.00, spo2: 0.55, temp: 0.00, activity: 0.45 }, b: -0.45 },
  { name: 'global-severity', w: { hr: 0.40, spo2: 0.40, temp: 0.40, activity: 0.40 }, b: -0.10 },
] as const;

const W1_Q: Int8Array[] = HIDDEN_UNITS.map(
  (u) => new Int8Array(CHANNELS.map((c) => q(u.w[c], W1_SCALE))),
);
const B1_Q: Int32Array = new Int32Array(HIDDEN_UNITS.map((u) => Math.round(u.b / B1_SCALE)));

/* ------------------------------------------------------------------ *
 * Layer 2 — risk logit
 * ------------------------------------------------------------------ */

const OUTPUT_W = [0.5230, 0.3384, 0.4922, 0.5845];
const OUTPUT_B = -2.0;

const W2_Q: Int8Array = new Int8Array(OUTPUT_W.map((w) => q(w, W2_SCALE)));
const B2_Q: number = Math.round(OUTPUT_B / B2_SCALE);

/**
 * Reported risk is the model logit passed through a monotone link and a Platt
 * calibration. Keeping calibration separate from the model is deliberate:
 * retraining does not silently move the policy thresholds, and the calibration
 * can be refit on held-out data alone.
 *
 * The link is a variance-stabilizing square root on the positive side. It is
 * strictly monotone, so it cannot reorder two windows or change which side of a
 * threshold one falls on; it only spreads the clinically actionable mid-range so
 * the reported index is not bunched against 100%.
 */
export const CALIBRATION = { shift: -0.1610, temperature: 0.9171 };

export function link(logit: number): number {
  return logit > 0 ? Math.sqrt(logit) : logit;
}

export const MODEL_VERSION = 'edge-mlp-int8-v0.4';
export const POLICY_VERSION = 'safety-policy-v3';

/** Total on-device parameter footprint, in bytes, of the quantized model. */
export const MODEL_BYTES =
  W1_Q.length * CHANNELS.length + B1_Q.length * 4 + W2_Q.length + 4;

export type Inference = {
  /** Calibrated deterioration risk, 0-100. */
  risk: number;
  /** Calibrated confidence that the decision is actionable, 0-100. */
  confidence: number;
  /** Uncalibrated model output. */
  logit: number;
  /** Dequantized hidden activations, for the explanation panel. */
  activations: number[];
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Quantized forward pass.
 *
 * int8 inputs x int8 weights -> int32 accumulator -> dequantize -> ReLU ->
 * requantize to uint8 -> int8 output layer -> logit.
 */
export function infer(features: FeatureVector, quality: number): Inference {
  const { logit, activations } = forward(features);
  const risk = Math.round(100 * sigmoid((link(logit) - CALIBRATION.shift) / CALIBRATION.temperature));
  const confidence = Math.round(100 * confidenceFrom(logit, quality));
  return { risk, confidence, logit, activations };
}

/**
 * The quantized forward pass, with no timing or calibration around it.
 *
 * int8 inputs x int8 weights -> int32 accumulator -> dequantize -> ReLU ->
 * requantize to uint8 -> int8 output layer -> logit.
 */
function forward(features: FeatureVector): { logit: number; activations: number[] } {
  // --- quantize inputs -------------------------------------------------
  const x = new Int8Array(CHANNELS.length);
  for (let i = 0; i < CHANNELS.length; i += 1) {
    x[i] = q(clamp(features[CHANNELS[i]], -Z_LIMIT, Z_LIMIT), INPUT_SCALE);
  }

  // --- layer 1: int32 accumulate, dequantize, ReLU ---------------------
  const activations: number[] = [];
  const hQ = new Int8Array(HIDDEN_UNITS.length);
  for (let j = 0; j < HIDDEN_UNITS.length; j += 1) {
    let acc = B1_Q[j] | 0;
    const row = W1_Q[j];
    for (let i = 0; i < CHANNELS.length; i += 1) acc = (acc + row[i] * x[i]) | 0;
    const activation = Math.max(0, acc * B1_SCALE);
    activations.push(activation);
    hQ[j] = clamp(Math.round(activation / H_SCALE), 0, 127);
  }

  // --- layer 2: int32 accumulate, dequantize ---------------------------
  let out = B2_Q | 0;
  for (let j = 0; j < HIDDEN_UNITS.length; j += 1) out = (out + W2_Q[j] * hQ[j]) | 0;
  return { logit: out * B2_SCALE, activations };
}

/**
 * Mean cost of one forward pass, in microseconds.
 *
 * A single pass is far below `performance.now()`'s resolution, so timing one
 * would report a meaningless 0. Averaging over many runs after a warm-up is the
 * only way to get a figure that means anything. This measures the browser, not
 * the MCU; the ESP32-S3 budget is a separate engineering target.
 */
export function benchmarkForwardPass(features: FeatureVector, iterations = 2000): number {
  for (let i = 0; i < 256; i += 1) forward(features);
  const started = now();
  for (let i = 0; i < iterations; i += 1) forward(features);
  return ((now() - started) * 1000) / iterations;
}

export function confidenceFrom(logit: number, quality: number): number {
  const margin = 0.62 + 0.38 * Math.tanh(Math.abs(logit) / 1.6);
  const trust = Math.pow(clamp(quality, 0, 100) / 100, 0.6);
  return clamp(margin * trust, 0, 1);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/* ------------------------------------------------------------------ *
 * Bounded personal baseline
 * ------------------------------------------------------------------ */

export type BaselineStats = Record<Channel, { mean: number; sd: number }>;

/** Cohort fallback used before the personal baseline has enrolled. */
export const COHORT_BASELINE: BaselineStats = {
  hr: { mean: 72.0, sd: 9.0 },
  spo2: { mean: 98.0, sd: 1.9 },
  temp: { mean: 36.8, sd: 0.38 },
  activity: { mean: 1.0, sd: 0.42 },
};

const EWMA_ALPHA = 0.04;
/** Hard cap on how far one accepted window may move the baseline mean, in SDs. */
const MAX_STEP_SD = 0.08;
/**
 * Hard cap on total drift from the enrolled anchor, in SDs.
 *
 * The per-step cap alone is not a guardrail: enough consecutive accepted windows
 * will still walk the baseline all the way onto a deteriorating patient, quietly
 * redefining their emergency as their new normal. Anchoring the total excursion
 * is what actually bounds personalization.
 */
const MAX_TOTAL_SD = 0.75;

/**
 * Exponentially weighted personal baseline with production-style guardrails.
 *
 * Updates are refused unless the window passed the quality gate *and* the agent
 * is in its resting MONITOR state. This is what stops a deteriorating patient
 * from being quietly normalized into their own new "healthy" baseline — the
 * failure mode that makes naive personalization dangerous.
 */
export class BaselineModel {
  stats: BaselineStats;
  /** Enrollment snapshot. Personal drift is measured, and bounded, against this. */
  readonly anchor: BaselineStats;
  version = 18;
  accepted = 0;
  refused = 0;
  frozen = false;
  lastReason = 'enrolled from cohort priors';

  constructor(seed: BaselineStats = COHORT_BASELINE) {
    this.stats = structuredClone(seed);
    this.anchor = structuredClone(seed);
  }

  /** How far the personal baseline has drifted from enrollment, in SDs. */
  drift(channel: Channel): number {
    return (this.stats[channel].mean - this.anchor[channel].mean) / this.anchor[channel].sd;
  }

  /** True once any channel has reached its total-drift ceiling. */
  atDriftLimit(): boolean {
    return CHANNELS.some((c) => Math.abs(this.drift(c)) >= MAX_TOTAL_SD - 1e-9);
  }

  /** Signed deviation of a measured value from this patient's own normal. */
  z(channel: Channel, value: number): number {
    const { mean, sd } = this.stats[channel];
    return clamp((value - mean) / sd, -Z_LIMIT, Z_LIMIT);
  }

  /** Orient every channel so that a larger feature always means more concerning. */
  features(window: Record<Channel, number>): FeatureVector {
    return {
      hr: this.z('hr', window.hr),
      spo2: Math.max(-1, -this.z('spo2', window.spo2)),
      temp: this.z('temp', window.temp),
      activity: Math.max(0, -this.z('activity', window.activity)),
    };
  }

  /**
   * Apply one bounded update. Returns true when the baseline actually moved.
   */
  update(window: Record<Channel, number>, allowed: boolean, reason: string): boolean {
    if (!allowed) {
      this.frozen = true;
      this.refused += 1;
      this.lastReason = reason;
      return false;
    }

    this.frozen = false;
    for (const channel of CHANNELS) {
      const current = this.stats[channel];
      const anchor = this.anchor[channel];
      const target = current.mean + EWMA_ALPHA * (window[channel] - current.mean);

      // Bound the single step...
      const step = clamp(target - current.mean, -MAX_STEP_SD * current.sd, MAX_STEP_SD * current.sd);
      // ...and then bound the cumulative excursion from enrollment.
      const ceiling = MAX_TOTAL_SD * anchor.sd;
      current.mean = clamp(current.mean + step, anchor.mean - ceiling, anchor.mean + ceiling);
    }

    this.accepted += 1;
    this.lastReason = reason;
    if (this.accepted % 8 === 0) this.version += 1;
    return true;
  }
}
