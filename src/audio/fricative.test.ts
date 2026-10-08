import { describe, expect, it } from 'vitest';
import { FRIC_HZ, RMS_GATE, detectPitch, highFreqHz, isFricative } from './pitch';

const SR = 48000;
const sine = (hz: number, n = 1024, a = 0.1) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * hz * i) / SR));
function noise(n: number, seed = 1): Float32Array {
  let s = seed;
  return Float32Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s / 2147483648 - 0.5) * 0.1;
  });
}

describe('fricatives', () => {
  it('highFreqHz is the frequency of a sine, and high for white noise', () => {
    for (const hz of [220, 880, 3000]) expect(highFreqHz(sine(hz), SR)).toBeCloseTo(hz, -1);
    expect(highFreqHz(noise(1024), SR)).toBeGreaterThan(9000);
  });

  it('a voice is no fricative; an unpitched hiss above the level gate is', () => {
    // A vowel-like tone with harmonics at 1/k².
    const v = Float32Array.from({ length: 1024 }, (_, i) => [1, 2, 3, 4, 5].reduce((x, k) => x + (0.1 / (k * k)) * Math.sin((2 * Math.PI * 220 * k * i) / SR), 0));
    const rv = detectPitch(v, SR);
    expect(isFricative({ pitched: true, rms: rv.rms, hfHz: rv.hfHz })).toBe(false);
    expect(rv.hfHz!).toBeLessThan(FRIC_HZ);
    const h = detectPitch(noise(1024), SR);
    expect(h.rms).toBeGreaterThan(RMS_GATE);
    expect(isFricative({ pitched: false, rms: h.rms, hfHz: h.hfHz })).toBe(true);
    // Too quiet: silence, not a consonant.
    expect(isFricative({ pitched: false, rms: RMS_GATE / 2, hfHz: 8000 })).toBe(false);
  });
});
