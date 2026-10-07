// Cleaning the microphone signal before pitch tracking: a gentle high-pass well below the lowest
// note the singer is expected to sing, and notches at the mains hum (50 or 60 Hz) and its
// harmonics below that note. Only what the pitch tracker analyses is filtered; the recording of the
// run stays raw (qa/realism replays it through the same filters, see applyInputFilter).
//
// The browser builds BiquadFilterNodes; applyInputFilter() runs the same filters in plain JS with
// the Web Audio API's formulas, so offline tracking and unit tests see what the app sees. IIR
// biquads add no buffering: the group delay is about 2 ms at the lowest note and under 1 ms an
// octave above, against a 20 ms reading interval and a 43 ms analysis window.

/** The high-pass sits at this share of the lowest written note's frequency… */
export const HP_SHARE = 0.7;
/** …but never above this (a voice singing an octave below the part must still be heard)… */
export const HP_MAX_HZ = 90;
/** …nor below this. */
export const HP_MIN_HZ = 40;
/** Lowest note assumed when the part is unknown (tuner, range check): C2. */
export const DEFAULT_LOWEST_HZ = 65.4;
/** Notches at the hum's harmonics stay this many semitones under the lowest note (their skirts never touch it). */
const NOTCH_MARGIN_ST = 3;
/** Notch Q: about 4–5 Hz wide at the mains fundamental, proportionally wider at its harmonics. */
export const NOTCH_Q = 12;
/** Butterworth high-pass: Web Audio interprets a high-pass Q in dB (20·log10(1/√2)). */
export const HP_Q_DB = -3.0103;

export interface InputFilterPlan {
  /** High-pass corner (Hz). */
  highpassHz: number;
  /** Notch centres (Hz): the mains fundamental and harmonics under the lowest note. */
  notches: number[];
  /** Mains hum fundamental the notches are tuned to (null = no hum found). */
  mainsHz: number | null;
}

/** The filters for a singer whose lowest note is `lowestHz` (null = unknown) with hum at `mainsHz`. */
export function inputFilterPlan(lowestHz: number | null, mainsHz: number | null): InputFilterPlan {
  const low = lowestHz != null && Number.isFinite(lowestHz) && lowestHz > 0 ? lowestHz : DEFAULT_LOWEST_HZ;
  const highpassHz = Math.round(Math.min(HP_MAX_HZ, Math.max(HP_MIN_HZ, HP_SHARE * low)) * 10) / 10;
  const notches: number[] = [];
  if (mainsHz != null && mainsHz > 0) {
    const top = low * Math.pow(2, -NOTCH_MARGIN_ST / 12);
    // The fundamental whenever it is under the lowest note (with C2 as the lowest, 60 Hz costs C2 under 1 dB):
    // left in, the hum itself reads as a B1 in every pause.
    for (let k = 1; (k * mainsHz <= top || (k === 1 && mainsHz < low)) && k <= 8; k++) notches.push(Math.round(k * mainsHz * 100) / 100);
  }
  return { highpassHz, notches, mainsHz: mainsHz ?? null };
}

export function samePlan(a: InputFilterPlan | null, b: InputFilterPlan | null): boolean {
  if (!a || !b) return a === b;
  return a.highpassHz === b.highpassHz && a.notches.length === b.notches.length && a.notches.every((x, i) => Math.abs(x - b.notches[i]) < 0.05);
}

/** Normalised biquad coefficients (a0 = 1). */
export interface BiquadCoefs { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Web Audio BiquadFilterNode 'highpass' (Q in dB) and 'notch' (Q linear) coefficients. */
export function biquadCoefs(type: 'highpass' | 'notch', f0: number, q: number, sampleRate: number): BiquadCoefs {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  if (type === 'highpass') {
    const alpha = s / (2 * Math.pow(10, q / 20));
    const a0 = 1 + alpha;
    return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
  }
  const alpha = s / (2 * q);
  const a0 = 1 + alpha;
  return { b0: 1 / a0, b1: (-2 * c) / a0, b2: 1 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

/** The stages of a plan, in the order the app chains them. */
export function planStages(plan: InputFilterPlan): { type: 'highpass' | 'notch'; f: number; q: number }[] {
  return [
    { type: 'highpass' as const, f: plan.highpassHz, q: HP_Q_DB },
    ...plan.notches.map((f) => ({ type: 'notch' as const, f, q: NOTCH_Q })),
  ];
}

/** Run `pcm` through the plan's filters (offline / tests). Returns a new array. */
export function applyInputFilter(pcm: Float32Array, sampleRate: number, plan: InputFilterPlan): Float32Array {
  const out = Float32Array.from(pcm);
  for (const st of planStages(plan)) {
    const k = biquadCoefs(st.type, st.f, st.q, sampleRate);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const x = out[i];
      const y = k.b0 * x + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] = y;
    }
  }
  return out;
}

/** Magnitude response (linear) of the plan at `hz`. */
export function planGain(plan: InputFilterPlan, hz: number, sampleRate: number): number {
  let g = 1;
  const w = (2 * Math.PI * hz) / sampleRate;
  for (const st of planStages(plan)) {
    const k = biquadCoefs(st.type, st.f, st.q, sampleRate);
    // H(e^jw) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
    const nr = k.b0 + k.b1 * Math.cos(w) + k.b2 * Math.cos(2 * w);
    const ni = -(k.b1 * Math.sin(w) + k.b2 * Math.sin(2 * w));
    const dr = 1 + k.a1 * Math.cos(w) + k.a2 * Math.cos(2 * w);
    const di = -(k.a1 * Math.sin(w) + k.a2 * Math.sin(2 * w));
    g *= Math.hypot(nr, ni) / Math.hypot(dr, di);
  }
  return g;
}
