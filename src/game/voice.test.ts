// Scoring against a realistic voice contour: real singers glide into a new pitch, overshoot and
// ring for a moment, and sing with vibrato. None of that is bad intonation.
import { describe, expect, it } from 'vitest';
import { scoreAttempt, type ScoringContext } from './scoring';
import { makePart, makeScore, singRealistic as sing } from './testutil';
import type { ScoringOptions } from './types';

const L4: ScoringOptions = { toleranceCents: 25, tuning: 'equal', octaveTolerant: false };
const L1: ScoringOptions = { toleranceCents: 50, tuning: 'equal', octaveTolerant: true };

// Leaps up and down, quarter notes at 60 and 120 bpm.
const spec: [number, number][] = [[62, 1], [67, 1], [64, 1], [72, 1], [71, 1], [67, 1], [69, 1], [62, 2]];
for (const bpm of [60, 120]) {
  const part = makePart('A', spec, bpm);
  const ctx: ScoringContext = { score: makeScore([part], bpm), part, range: [0, part.notes.length - 1] };

  describe(`realistic voice at ${bpm} bpm`, () => {
    it('glides with overshoot and a small vibrato: fully in tune', () => {
      const r = scoreAttempt(ctx, sing(part), L4);
      expect(r.pitch).toBeGreaterThan(0.95);
      expect(r.accuracy).toBeGreaterThan(0.9);
    });
    it('a slow, ringing transition (big overshoot) is not bad intonation', () => {
      const r = scoreAttempt(ctx, sing(part, { fn: 5, zeta: 0.35 }), L4);
      expect(r.pitch).toBeGreaterThan(0.85);
      expect(r.counts.miss).toBe(0);
    });
    for (const vibHz of [4.5, 5.5, 7]) {
      it(`a wide ±50¢ vibrato at ${vibHz} Hz is in tune at ±25¢`, () => {
        const r = scoreAttempt(ctx, sing(part, { vibCents: 50, vibHz }), L4);
        expect(r.pitch).toBeGreaterThan(0.9);
      });
    }
    it('a small vibrato costs (almost) nothing at L1', () => {
      const plain = scoreAttempt(ctx, sing(part, { vibCents: 0 }), L1);
      const vib = scoreAttempt(ctx, sing(part, { vibCents: 20 }), L1);
      expect(plain.pitch - vib.pitch).toBeLessThan(0.03);
      expect(vib.pitch).toBeGreaterThan(0.95);
    });
    it('the previous note leaking in (device delay 120 ms) is a timing matter, not intonation', () => {
      const r = scoreAttempt(ctx, sing(part, { lag: 0.12 }), L1);
      expect(r.pitch).toBeGreaterThan(0.9);
      expect(r.counts.miss).toBe(0);
    });
    it('still fails a singer who is 40 cents flat', () => {
      const r = scoreAttempt(ctx, sing(part, { offsetCents: -40 }), L4);
      expect(r.accuracy).toBeLessThan(0.3);
    });
    it('still fails wrong notes', () => {
      const wrong = sing(part).map((s) => ({ ...s, midi: s.midi === null ? null : s.midi + 2 }));
      const r = scoreAttempt(ctx, wrong, L1);
      expect(r.accuracy).toBeLessThan(0.2);
    });
  });
}

describe('leniency has limits', () => {
  it('short notes sung 60 cents flat are not "good"', () => {
    const p = makePart('A', [[60, 0.5], [67, 0.5], [60, 0.5], [67, 0.5], [60, 0.5], [67, 0.5], [60, 0.5], [67, 0.5]], 110);
    const c: ScoringContext = { score: makeScore([p], 110), part: p, range: [0, p.notes.length - 1] };
    const r = scoreAttempt(c, sing(p, { offsetCents: -60, vibCents: 0 }), L4);
    expect(r.accuracy).toBeLessThan(0.3);
  });
  it('notes held for only half their length are not "good"', () => {
    const p = makePart('A', [[62, 1], [64, 1], [65, 1], [67, 1], [69, 1], [67, 1], [65, 1], [64, 1]], 60);
    const c: ScoringContext = { score: makeScore([p], 60), part: p, range: [0, p.notes.length - 1] };
    const samples = sing(p, { vibCents: 0, fn: 12, zeta: 0.7 }).map((s) => {
      const n = p.notes.find((x) => s.time >= x.start && s.time < x.start + x.dur);
      return n && s.time - n.start > n.dur / 2 ? { ...s, midi: null, clarity: 0, rms: 0 } : s;
    });
    const r = scoreAttempt(c, samples, L1);
    expect(r.accuracy).toBeLessThan(0.7);
    expect(r.counts.good + r.counts.perfect).toBeLessThan(4);
  });
});

describe('arrival must be real', () => {
  it('a flat note that only glides through the target is not credited', () => {
    const p = makePart('A', [[67, 0.5], [60, 0.5], [67, 0.5], [60, 0.5], [67, 0.5], [60, 0.5], [67, 0.5], [60, 0.5]], 100);
    const c: ScoringContext = { score: makeScore([p], 100), part: p, range: [0, p.notes.length - 1] };
    const r = scoreAttempt(c, sing(p, { offsetCents: -60, vibCents: 0, fn: 5, zeta: 0.9 }), L4);
    expect(r.accuracy).toBeLessThan(0.25);
  });
});
