// Minimal DSP helpers for the synthetic singer: biquads, FFT convolution, noise.
import { Rng } from './prng';

/** Direct-form-I biquad, coefficients normalised by a0. */
export class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;

  static highpass(fc: number, sr: number, q = Math.SQRT1_2): Biquad {
    return new Biquad().setHighpass(fc, sr, q);
  }

  setHighpass(fc: number, sr: number, q = Math.SQRT1_2): this {
    const w = (2 * Math.PI * fc) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    this.b0 = (1 + c) / 2 / a0;
    this.b1 = -(1 + c) / a0;
    this.b2 = (1 + c) / 2 / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }

  setLowpass(fc: number, sr: number, q = Math.SQRT1_2): this {
    const w = (2 * Math.PI * fc) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0;
    this.b1 = (1 - c) / a0;
    this.b2 = (1 - c) / 2 / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }

  /** Band-pass with 0 dB peak gain (RBJ), used as a formant resonator. */
  setBandpass(fc: number, bw: number, sr: number): this {
    const w = (2 * Math.PI * fc) / sr;
    const q = Math.max(0.5, fc / Math.max(1, bw));
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    this.b0 = al / a0;
    this.b1 = 0;
    this.b2 = -al / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }

  processBuffer(buf: Float32Array): void {
    for (let i = 0; i < buf.length; i++) buf[i] = this.process(buf[i]);
  }
}

/** In-place iterative radix-2 complex FFT (inverse when `inv`, unscaled). */
export function fft(re: Float64Array, im: Float64Array, inv = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k + half] * cr - im[i + k + half] * ci;
        const ai = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k + half] = re[i + k] - ar;
        im[i + k + half] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const nextPow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

/** Linear convolution x * h (output length x.length; the tail is dropped) via FFT overlap-add. */
export function convolve(x: Float32Array, h: Float32Array): Float32Array {
  const nfft = nextPow2(Math.max(65536, 2 * h.length));
  const block = nfft - h.length + 1;
  const hr = new Float64Array(nfft);
  const hi = new Float64Array(nfft);
  hr.set(h);
  fft(hr, hi);
  const out = new Float32Array(x.length);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let start = 0; start < x.length; start += block) {
    re.fill(0);
    im.fill(0);
    const end = Math.min(x.length, start + block);
    for (let i = start; i < end; i++) re[i - start] = x[i];
    fft(re, im);
    for (let k = 0; k < nfft; k++) {
      const r = re[k] * hr[k] - im[k] * hi[k];
      im[k] = re[k] * hi[k] + im[k] * hr[k];
      re[k] = r;
    }
    fft(re, im, true);
    const lim = Math.min(nfft, x.length - start);
    for (let i = 0; i < lim; i++) out[start + i] += re[i] / nfft;
  }
  return out;
}

/** Exponentially decaying noise impulse response with unit energy, scaled by `gain`, plus pre-delay. */
export function roomImpulse(rng: Rng, sr: number, rt60: number, gain: number, preDelaySec = 0.008): Float32Array {
  const len = Math.round(sr * Math.min(1.0, rt60 * 1.1));
  const pre = Math.round(sr * preDelaySec);
  const h = new Float32Array(pre + len);
  let e = 0;
  for (let i = 0; i < len; i++) {
    const v = rng.gauss() * Math.exp((-6.907755 * i) / (sr * rt60));
    h[pre + i] = v;
    e += v * v;
  }
  const s = gain / Math.sqrt(e || 1);
  for (let i = pre; i < h.length; i++) h[i] *= s;
  return h;
}

/** Pink-ish background noise (white + a low-passed component), unit RMS. */
export function backgroundNoise(rng: Rng, n: number): Float32Array {
  const out = new Float32Array(n);
  let lp = 0;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.gauss();
    lp += 0.02 * (w - lp);
    const v = 0.35 * w + 4 * lp;
    out[i] = v;
    e += v * v;
  }
  const s = 1 / Math.sqrt(e / Math.max(1, n));
  for (let i = 0; i < n; i++) out[i] *= s;
  return out;
}

export function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return to > from ? Math.sqrt(s / (to - from)) : 0;
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
