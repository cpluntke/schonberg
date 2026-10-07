import { describe, expect, it } from 'vitest';
import { applyInputFilter, biquadCoefs, inputFilterPlan, planGain, samePlan } from './inputFilter';
import { midiToHz } from './pitch';

const SR = 48000;
const dB = (g: number) => 20 * Math.log10(g);

describe('inputFilterPlan', () => {
  it('puts the high-pass at 0.7 × the lowest note, between 40 and 90 Hz', () => {
    expect(inputFilterPlan(midiToHz(44), null).highpassHz).toBeCloseTo(72.7, 1); // bass part down to G#2
    expect(inputFilterPlan(midiToHz(40), null).highpassHz).toBeCloseTo(57.7, 1); // E2
    expect(inputFilterPlan(midiToHz(60), null).highpassHz).toBe(90); // sopranos: capped (an octave low must still be heard)
    expect(inputFilterPlan(null, null).highpassHz).toBe(45.8); // unknown: C2
  });

  it('notches the mains and its harmonics only below the lowest note', () => {
    expect(inputFilterPlan(midiToHz(44), 60).notches).toEqual([60]); // G#2 104 Hz: not 120
    expect(inputFilterPlan(midiToHz(60), 50).notches).toEqual([50, 100, 150, 200]); // C4 262 Hz
    expect(inputFilterPlan(midiToHz(60), 59.4).notches).toEqual([59.4, 118.8, 178.2]);
    expect(inputFilterPlan(midiToHz(60), null).notches).toEqual([]);
    // Lowest note unknown (tuner, range check: C2 assumed): the fundamental only, so the hum doesn't read as a B1.
    expect(inputFilterPlan(null, 60).notches).toEqual([60]);
    expect(inputFilterPlan(null, 50).notches).toEqual([50]);
  });

  it('compares plans', () => {
    expect(samePlan(inputFilterPlan(100, 60), inputFilterPlan(100, 60))).toBe(true);
    expect(samePlan(inputFilterPlan(100, 60), inputFilterPlan(100, null))).toBe(false);
  });
});

describe('filter response', () => {
  it('never cuts the lowest note or above by more than 1.5 dB, and removes the hum', () => {
    for (const [low, mains] of [[36, 60], [36, 50], [40, 50], [44, 60], [48, 60], [55, 50], [60, 60], [67, 50]] as const) {
      const plan = inputFilterPlan(midiToHz(low), mains);
      // (C2, the lowest note assumed when none is known, keeps the 60 Hz notch's skirt: −2 dB.)
      for (let m = low; m <= low + 36; m += 1) expect(dB(planGain(plan, midiToHz(m), SR))).toBeGreaterThan(low === 36 && m < 38 ? -2.5 : -1.5);
      for (const f of plan.notches) expect(dB(planGain(plan, f, SR))).toBeLessThan(-30);
    }
  });

  it('a bass singing an octave and a fifth under C#4 (F#2) loses under 2 dB', () => {
    const plan = inputFilterPlan(midiToHz(44), 60);
    expect(dB(planGain(plan, midiToHz(42), SR))).toBeGreaterThan(-2);
  });

  it('matches the Web Audio formulas (applyInputFilter = planGain on a steady sine)', () => {
    const plan = inputFilterPlan(midiToHz(44), 60);
    for (const f of [55, 70, 80, 110, 300]) {
      const n = SR;
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / SR);
      const y = applyInputFilter(x, SR, plan);
      let p = 0;
      for (let i = n / 2; i < n; i++) p += y[i] * y[i];
      const g = Math.sqrt(p / (n / 2)) * Math.SQRT2;
      expect(dB(g)).toBeCloseTo(dB(planGain(plan, f, SR)), 0);
    }
    // Notch: unity at DC and Nyquist; high-pass (Q −3.01 dB = Butterworth): −3 dB at the corner.
    const k = biquadCoefs('notch', 60, 12, SR);
    expect((k.b0 + k.b1 + k.b2) / (1 + k.a1 + k.a2)).toBeCloseTo(1, 6);
    expect(dB(planGain({ highpassHz: 100, notches: [], mainsHz: null }, 100, SR))).toBeCloseTo(-3, 1);
  });

  it('adds no measurable delay at the sung pitches (group delay ≈ 2 ms at the lowest note, less above)', () => {
    const plan = inputFilterPlan(midiToHz(44), 60);
    // Phase slope by finite difference of the steady-state response.
    const phase = (f: number) => {
      const n = SR;
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / SR);
      const y = applyInputFilter(x, SR, plan);
      let re = 0, im = 0;
      for (let i = n / 2; i < n; i++) { re += y[i] * Math.sin((2 * Math.PI * f * i) / SR); im += y[i] * Math.cos((2 * Math.PI * f * i) / SR); }
      return Math.atan2(im, re);
    };
    for (const m of [44, 50, 61]) {
      const f = midiToHz(m);
      const gd = -(phase(f + 1) - phase(f - 1)) / (2 * Math.PI * 2);
      expect(Math.abs(gd) * 1000).toBeLessThan(m === 44 ? 2.5 : 1.2);
    }
  });
});
