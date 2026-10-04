import { describe, expect, it } from 'vitest';
import { estimateLag, scoreAligned } from './align';
import { makePart, makeScore, singRealistic } from './testutil';
import type { ScoringOptions } from './types';
import type { ScoringContext } from './scoring';

const opts: ScoringOptions = { toleranceCents: 35, tuning: 'equal', octaveTolerant: true };
// Phrases with a rest in between, quarter notes at 90 bpm.
const part = makePart('A', [[62, 1], [65, 1], [64, 1], [67, 1], [null, 1], [69, 1], [67, 1], [65, 2], [null, 1], [64, 1], [62, 1], [60, 2]], 90);
const ctx: ScoringContext = { score: makeScore([part], 90), part, range: [0, part.notes.length - 1] };

describe('estimateLag', () => {
  for (const lag of [0.08, 0.15, 0.25, 0.32]) {
    it(`finds a ${lag * 1000} ms delay`, () => {
      const e = estimateLag(part, ctx.range, singRealistic(part, { lag }));
      expect(e.confident).toBe(true);
      // The glide into each note makes the voice look ~a few tens of ms later than the step.
      expect(e.lag).toBeGreaterThan(lag - 0.02);
      expect(e.lag).toBeLessThan(lag + 0.07);
    });
  }
  it('leaves an on-time singer alone', () => {
    const e = estimateLag(part, ctx.range, singRealistic(part, { fn: 12, zeta: 0.7 }));
    expect(Math.abs(e.lag)).toBeLessThan(0.04);
  });
  it('is not confident about a singer on the wrong notes', () => {
    const wrong = singRealistic(part, { lag: 0.2 }).map((s) => ({ ...s, midi: s.midi === null ? null : s.midi + 3 }));
    expect(estimateLag(part, ctx.range, wrong).confident).toBe(false);
  });
  it('needs pitch changes to line up', () => {
    const drone = makePart('A', [[62, 4], [62, 4]], 90);
    expect(estimateLag(drone, [0, 1], singRealistic(drone, { lag: 0.2 })).confident).toBe(false);
  });
});

describe('scoreAligned', () => {
  it('rescues intonation hidden by an uncorrected 220 ms delay', () => {
    const samples = singRealistic(part, { lag: 0.22 });
    const al = scoreAligned(ctx, samples, opts, { rate: 1, latencyMs: 80, calibrated: false });
    expect(al.shiftMs).toBeGreaterThan(190);
    expect(al.result.pitch).toBeGreaterThan(0.93);
    expect(al.result.accuracy).toBeGreaterThan(0.9);
  });
  it('only nudges a measured delay', () => {
    const al = scoreAligned(ctx, singRealistic(part, { lag: 0.22 }), opts, { rate: 1, latencyMs: 80, calibrated: true });
    expect(Math.abs(al.shiftMs)).toBeLessThanOrEqual(80);
  });
  it('works in real time at slow practice tempo', () => {
    // At 70% tempo a 200 ms real delay is 140 ms of score time.
    const al = scoreAligned(ctx, singRealistic(part, { lag: 0.14 }), opts, { rate: 0.7, latencyMs: 80, calibrated: false });
    expect(al.shiftMs).toBeGreaterThan(180);
    expect(al.shiftMs).toBeLessThan(290);
  });
  it('changes nothing for an on-time singer', () => {
    const al = scoreAligned(ctx, singRealistic(part, { fn: 12, zeta: 0.7 }), opts, { rate: 1, latencyMs: 80, calibrated: false });
    expect(al.shiftMs).toBe(0);
  });
});
