/**
 * PulseGuard Edge — deterministic sensor simulation and signal-quality assessment.
 *
 * Everything here is pure and seeded: `generateWindow(scenario, index)` returns the
 * same samples on every machine and every run, so a reviewer can reproduce any
 * number shown in the UI. This stands in for the sensor-acquisition and
 * signal-conditioning stages of the target firmware.
 */

export type ScenarioId = 'stable' | 'artifact' | 'drift' | 'critical';

export const SAMPLES_PER_WINDOW = 30; // 30 s at 1 Hz
export const WINDOW_SECONDS = 30;

/** Sensor frame: one second of synchronized multivital samples. */
export type RawWindow = {
  hr: number[];
  spo2: number[];
  temp: number[];
  /** Band-limited movement energy — the "is the patient active" channel. */
  activity: number[];
  /** High-frequency accelerometer magnitude — the motion-artifact channel. */
  motion: number[];
};

export type QualityReport = {
  /** 0-100 composite signal quality. */
  quality: number;
  /** Mean high-frequency accelerometer magnitude (g). */
  motionIndex: number;
  /** Median absolute successive difference of the PPG-derived rate (bpm). */
  ppgJitter: number;
  /** Sample standard deviation of SpO2 within the window (%). */
  satVariance: number;
};

/* ------------------------------------------------------------------ *
 * Deterministic pseudo-random source
 * ------------------------------------------------------------------ */

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform over a uniform source. */
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const SCENARIO_SEED: Record<ScenarioId, number> = {
  stable: 0x5ea5_0001,
  artifact: 0x5ea5_0002,
  drift: 0x5ea5_0003,
  critical: 0x5ea5_0004,
};

/* ------------------------------------------------------------------ *
 * Physiological profiles
 * ------------------------------------------------------------------ */

type Profile = {
  hr: number;
  spo2: number;
  temp: number;
  activity: number;
  motion: number;
  /** Per-window drift applied to each channel, saturating at RAMP_CAP windows. */
  ramp: { hr: number; spo2: number; temp: number; activity: number };
  /** Slow physiological wander (respiratory / circadian), amplitude per channel. */
  wander: { hr: number; spo2: number; temp: number; activity: number };
  noise: { hr: number; spo2: number; temp: number; activity: number; motion: number };
  /** Fraction of samples corrupted by a PPG motion spike. */
  artifactRate: number;
  artifactAmplitude: number;
};

const RAMP_CAP = 12;

const PROFILES: Record<ScenarioId, Profile> = {
  stable: {
    hr: 72, spo2: 98.0, temp: 36.80, activity: 1.00, motion: 0.020,
    ramp: { hr: 0, spo2: 0, temp: 0, activity: 0 },
    wander: { hr: 3.0, spo2: 0.55, temp: 0.10, activity: 0.20 },
    noise: { hr: 1.1, spo2: 0.30, temp: 0.040, activity: 0.10, motion: 0.008 },
    artifactRate: 0, artifactAmplitude: 0,
  },
  artifact: {
    // True physiology is close to baseline; the *measurement* is corrupted.
    hr: 74, spo2: 96.2, temp: 36.90, activity: 2.60, motion: 0.860,
    ramp: { hr: 0, spo2: 0, temp: 0, activity: 0 },
    wander: { hr: 3.0, spo2: 0.55, temp: 0.10, activity: 0.20 },
    noise: { hr: 2.0, spo2: 2.40, temp: 0.050, activity: 0.55, motion: 0.240 },
    artifactRate: 0.38, artifactAmplitude: 34,
  },
  drift: {
    hr: 86, spo2: 94.0, temp: 37.20, activity: 0.50, motion: 0.030,
    ramp: { hr: 0.25, spo2: -0.08, temp: 0.015, activity: -0.012 },
    wander: { hr: 2.2, spo2: 0.40, temp: 0.08, activity: 0.12 },
    noise: { hr: 1.2, spo2: 0.35, temp: 0.050, activity: 0.09, motion: 0.010 },
    artifactRate: 0, artifactAmplitude: 0,
  },
  critical: {
    hr: 118, spo2: 89.0, temp: 38.10, activity: 0.15, motion: 0.012,
    ramp: { hr: 0.35, spo2: -0.12, temp: 0.020, activity: -0.008 },
    wander: { hr: 2.4, spo2: 0.45, temp: 0.09, activity: 0.06 },
    noise: { hr: 1.6, spo2: 0.45, temp: 0.050, activity: 0.05, motion: 0.006 },
    artifactRate: 0, artifactAmplitude: 0,
  },
};

/**
 * Produce one deterministic 30 s sensor window.
 * The same (scenario, windowIndex) always yields identical samples.
 */
export function generateWindow(scenario: ScenarioId, windowIndex: number): RawWindow {
  const p = PROFILES[scenario];
  const rand = mulberry32(SCENARIO_SEED[scenario] + windowIndex * 7919);
  const k = Math.min(windowIndex, RAMP_CAP);

  // Slow physiological wander: real resting vitals drift with respiration and
  // circadian rhythm, so window means are never perfectly flat.
  const phase = (windowIndex * 2 * Math.PI) / 9;
  const wanderHr = Math.sin(phase) * p.wander.hr;
  const wanderSpo2 = Math.sin(phase + 1.9) * p.wander.spo2;
  const wanderTemp = Math.sin(phase + 3.1) * p.wander.temp;
  const wanderActivity = Math.sin(phase + 0.7) * p.wander.activity;

  const hr: number[] = [];
  const spo2: number[] = [];
  const temp: number[] = [];
  const activity: number[] = [];
  const motion: number[] = [];

  for (let i = 0; i < SAMPLES_PER_WINDOW; i += 1) {
    // Motion corrupts PPG asymmetrically: the peak detector inserts spurious
    // beats far more often than it drops real ones, so the artifact is biased up.
    const spike = rand() < p.artifactRate
      ? (rand() < 0.82 ? 1 : -1) * p.artifactAmplitude * (0.55 + 0.45 * rand())
      : 0;

    hr.push(p.hr + p.ramp.hr * k + wanderHr + gaussian(rand) * p.noise.hr + spike);
    spo2.push(clamp(p.spo2 + p.ramp.spo2 * k + wanderSpo2 + gaussian(rand) * p.noise.spo2, 70, 100));
    temp.push(p.temp + p.ramp.temp * k + wanderTemp + gaussian(rand) * p.noise.temp);
    activity.push(Math.max(0, p.activity + p.ramp.activity * k + wanderActivity + gaussian(rand) * p.noise.activity));
    motion.push(Math.max(0, p.motion + Math.abs(gaussian(rand)) * p.noise.motion));
  }

  return { hr, spo2, temp, activity, motion };
}

/* ------------------------------------------------------------------ *
 * Signal-quality gate
 * ------------------------------------------------------------------ */

// Normalizer knees: the value at which a term starts to cost quality, and the
// span over which it saturates. Tuned so clean resting windows score 95-98.
const MOTION_KNEE = 0.005, MOTION_SPAN = 0.75;
const JITTER_KNEE = 0.60, JITTER_SPAN = 7.0;
const SAT_KNEE = 0.15, SAT_SPAN = 2.0;

const W_MOTION = 0.52, W_JITTER = 0.26, W_SAT = 0.22;
/** Worst-case quality floor: a fully corrupted window still reports ~28%, not 0%. */
const QUALITY_DEPTH = 0.72;

/**
 * Composite signal quality from three independent corruption indicators.
 * This is the gate that lets the agent say "I cannot trust this measurement".
 */
export function assessSignalQuality(w: RawWindow): QualityReport {
  const motionIndex = mean(w.motion);
  const ppgJitter = median(successiveAbsDiffs(w.hr));
  const satVariance = stdev(w.spo2);

  const motionNorm = clamp((motionIndex - MOTION_KNEE) / MOTION_SPAN, 0, 1);
  const jitterNorm = clamp((ppgJitter - JITTER_KNEE) / JITTER_SPAN, 0, 1);
  const satNorm = clamp((satVariance - SAT_KNEE) / SAT_SPAN, 0, 1);

  const corruption = W_MOTION * motionNorm + W_JITTER * jitterNorm + W_SAT * satNorm;
  const quality = Math.round(100 * (1 - QUALITY_DEPTH * clamp(corruption, 0, 1)));

  return { quality, motionIndex, ppgJitter, satVariance };
}

/* ------------------------------------------------------------------ *
 * Small numeric helpers
 * ------------------------------------------------------------------ */

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export function mean(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

export function stdev(values: number[]): number {
  const m = mean(values);
  let sum = 0;
  for (const v of values) sum += (v - m) * (v - m);
  return Math.sqrt(sum / (values.length - 1));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function successiveAbsDiffs(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) out.push(Math.abs(values[i] - values[i - 1]));
  return out;
}
