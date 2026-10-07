// A microphone with mains trouble, for synthetic takes: hum at the mains frequency and its 2nd and
// 3rd harmonics added, and the voice amplitude-modulated by the hum's 3rd harmonic (a ground loop
// through a laptop's input stage). The modulation puts sidebands at f ± 3·mains next to the voice,
// which is what wrecked the real run in qa/fixtures/hum-run.wav: a C#4 (277 Hz) with components at
// ~97 Hz (277 − 180) and ~457 Hz, so McLeod read the common period, F#2 (⅓) or C#3 (½).
import { Rng } from './prng';

export interface HumChannel {
  /** Mains frequency (Hz). */
  mains: number;
  /** Level of the hum's fundamental (dBFS RMS). The real run: about −42. */
  humDb: number;
  /** Depth of the voice's modulation by the hum's 3rd harmonic (0 = additive hum only). */
  mod: number;
}

export const HUM_TROUBLE: HumChannel = { mains: 60, humDb: -42, mod: 0.4 };
export const HUM_ONLY: HumChannel = { mains: 60, humDb: -42, mod: 0 };

export function addHum(x: Float32Array, sampleRate: number, o: HumChannel, seed = 7): Float32Array {
  const y = new Float32Array(x.length);
  const a = Math.pow(10, o.humDb / 20) * Math.SQRT2;
  const rng = new Rng(seed);
  // The grid's frequency wanders a little; the phases are fixed per take.
  const drift = 1 + (rng.next() - 0.5) * 0.004;
  const p2 = rng.next() * 6.28;
  const p3 = rng.next() * 6.28;
  for (let i = 0; i < x.length; i++) {
    const w = (2 * Math.PI * o.mains * drift * i) / sampleRate;
    const h3 = Math.sin(3 * w + p3);
    const hum = Math.sin(w) + 0.25 * Math.sin(2 * w + p2) + 0.6 * h3;
    y[i] = x[i] * (1 + o.mod * h3) + a * hum;
  }
  return y;
}
