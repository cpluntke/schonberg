// Harmonic sanity check for the McLeod pitch reading.
//
// McLeod picks the first strong period of the signal. When the input carries a component at a
// fraction of the voice's pitch (mains hum mixing with the voice in a cheap or overloaded input
// stage, or the common period of voice + backing), that period can be twice or three times the
// voice's: the reading drops an octave (×½) or an octave and a fifth (×⅓). A real low voice has
// its own harmonics at every multiple of its pitch, the 2nd one strong; such a reading has energy
// almost only at every 2nd or 3rd multiple. So the reading is lifted when the candidate's own
// harmonics that are not multiples of 2 (or 3) are far weaker than the ones that are.

/** Power of `frame` at `hz` (Hann-windowed Goertzel, normalised so a full-scale sine reads ~0.25). */
export function tonePower(frame: ArrayLike<number>, sampleRate: number, hz: number, win: Float32Array = hannFor(frame.length)): number {
  const n = frame.length;
  const w = (2 * Math.PI * hz) / sampleRate;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = frame[i] * win[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const re = s1 - s2 * Math.cos(w);
  const im = s2 * Math.sin(w);
  const norm = n / 2; // Hann's coherent gain (sum of the window)
  return (re * re + im * im) / (norm * norm);
}

const hanns = new Map<number, Float32Array>();
export function hannFor(n: number): Float32Array {
  let h = hanns.get(n);
  if (!h) {
    h = new Float32Array(n);
    for (let i = 0; i < n; i++) h[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hanns.set(n, h);
  }
  return h;
}

const db = (x: number) => 10 * Math.log10(Math.max(x, 1e-20));

/**
 * Harmonics closer together than this many FFT bins of the frame (Hann main lobe: ±2 bins) leak
 * into each other: below it the split isn't measured (a 2048-sample frame at 48 kHz: ≥ 59 Hz).
 */
const MIN_SPACING_BINS = 2.5;

/** Harmonics `hz` apart can be told apart in a frame of `n` samples. */
export function resolvable(hz: number, n: number, sampleRate: number): boolean {
  return hz >= (MIN_SPACING_BINS * sampleRate) / n;
}

/** Highest frequency (Hz) whose harmonics are compared (above it voices and phone mics have little). */
const HARMONIC_TOP_HZ = 2400;

export interface HarmonicSplit {
  /** Power at the multiples of m·hz (the higher pitch's own harmonics), up to HARMONIC_TOP_HZ. */
  on: number;
  /** Power at the other multiples of hz (what a voice at hz would have and a voice at m·hz wouldn't). */
  off: number;
  /** off relative to on, dB. */
  ratioDb: number;
}

/** Split the power at the multiples of `hz` into the multiples of m·hz and the rest. */
export function harmonicSplit(frame: ArrayLike<number>, sampleRate: number, hz: number, m: number): HarmonicSplit {
  const win = hannFor(frame.length);
  let on = 0;
  let off = 0;
  const top = Math.min(HARMONIC_TOP_HZ, sampleRate / 2 - 100);
  // Three of the higher pitch's harmonics at least (fewer only near the top).
  const H = Math.max(m, Math.min(3 * m, Math.floor(top / hz)));
  for (let h = 1; h <= H; h++) {
    const p = tonePower(frame, sampleRate, h * hz, win);
    if (h % m === 0) on += p;
    else off += p;
  }
  return { on, off, ratioDb: db(off) - db(on) };
}

/**
 * A reading whose own harmonics that aren't multiples of 3 are this far (dB) under the multiples is
 * a ⅓ of the voice. A voice at the reading has its 1st, 2nd, 4th, 5th… harmonics: even through a
 * phone mic that cuts the fundamental, or with a formant on its 3rd harmonic (an alto's C#4 on “a”),
 * they stay within 10 dB of the multiples (synthetic voices on every vowel and section: −9.9 dB at
 * worst in 38 000 frames). Hum intermodulation on a real run puts the false ⅓ readings at −4 to −25 dB.
 */
export const SUB3_LIFT_DB = -12;
/**
 * Between this and SUB3_LIFT_DB the ⅓ reading is lifted only when the note due, or the voice's
 * last reading that wasn't lifted, is there (honest voices: under −3 dB in 0.5 % of frames).
 */
export const SUB3_HINT_DB = -3;
/**
 * The octave (×½) needs far stronger evidence and never uses a hint: a voice whose vowel favours its
 * even harmonics shows its odd ones up to 14 dB down, and a singer an octave low must read low.
 */
export const SUB2_LIFT_DB = -18;

export interface HarmonicVerdict {
  /** The pitch to report (Hz). */
  hz: number;
  /** 1 = as read; 2 or 3 = the reading was a ½ or ⅓ of the voice and was lifted. */
  lifted: 1 | 2 | 3;
  /**
   * Level (dB, relative to the reported pitch's own harmonics) of the strongest set of components at
   * ½ or ⅓ of the reported pitch: what a clean voice doesn't have. Null when the frame is too short
   * to tell them apart (low pitches in a short frame).
   */
  subDb: number | null;
}

/**
 * Check a McLeod reading `hz` against the spectrum of `frame`. `hints` (Hz: the note due, the
 * voice's previous reading) only break ties for a ⅓ in the grey zone (SUB3_HINT_DB…SUB3_LIFT_DB): a
 * voice that clearly has its own harmonics reads where it is, whatever note is due.
 */
export function harmonicCheck(frame: ArrayLike<number>, sampleRate: number, hz: number, maxHz: number, hints: (number | null | undefined)[] = []): HarmonicVerdict {
  const ok = (m: 2 | 3) => m * hz <= maxHz && resolvable(hz, frame.length, sampleRate);
  const r2 = ok(2) ? harmonicSplit(frame, sampleRate, hz, 2).ratioDb : Infinity;
  const r3 = ok(3) ? harmonicSplit(frame, sampleRate, hz, 3).ratioDb : Infinity;
  const near3 = hints.some((h) => h != null && h > 0 && Math.abs(12 * Math.log2((3 * hz) / h)) <= 1);
  const lift3 = r3 <= SUB3_LIFT_DB || (near3 && r3 <= SUB3_HINT_DB);
  const lift2 = r2 <= SUB2_LIFT_DB;
  const lifted: 1 | 2 | 3 = lift3 && (!lift2 || r3 <= r2) ? 3 : lift2 ? 2 : 1;
  const f = hz * lifted;
  return { hz: f, lifted, subDb: subLevelDb(frame, sampleRate, f) };
}

/**
 * Level (dB) of the components at ½ and ⅓ of `hz` (and their multiples that aren't multiples of
 * hz) relative to the harmonics of hz: hum intermodulation, distortion, a second sound. The larger
 * of the two families.
 */
export function subLevelDb(frame: ArrayLike<number>, sampleRate: number, hz: number): number | null {
  let worst: number | null = null;
  for (const m of [2, 3]) {
    if (!resolvable(hz / m, frame.length, sampleRate)) continue;
    const s = harmonicSplit(frame, sampleRate, hz / m, m);
    worst = Math.max(worst ?? -Infinity, s.ratioDb);
  }
  return worst;
}
