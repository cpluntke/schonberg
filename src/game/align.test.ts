import { describe, expect, it } from 'vitest';
import { estimateLag, medianOnsetMs, scoreAligned } from './align';
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

describe('scoreAligned keeps timing honest', () => {
  it('a singer following 300 ms behind gets intonation credit but late onsets and a timing tip', () => {
    const al = scoreAligned(ctx, singRealistic(part, { lag: 0.3, fn: 12, zeta: 0.7 }), opts, { rate: 1, latencyMs: 130, calibrated: false });
    expect(al.shiftMs).toBeGreaterThan(250);
    expect(al.result.pitch).toBeGreaterThan(0.9);
    expect(al.result.rhythm).toBeLessThan(0.7);
    expect(al.result.insights.some((i) => i.kind === 'behind-beat' || i.kind === 'late-entries')).toBe(true);
  });
});

describe('re-review scenarios', () => {
  const strict: ScoringOptions = { toleranceCents: 35, tuning: 'equal', octaveTolerant: false };
  it('late onsets stay late on notes shorter than the lateness', () => {
    const eighths = makePart('A', [[62, 0.5], [64, 0.5], [65, 0.5], [67, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [64, 0.5], [65, 0.5], [67, 0.5], [69, 2]], 100);
    const c: ScoringContext = { score: makeScore([eighths], 100), part: eighths, range: [0, eighths.notes.length - 1] };
    const al = scoreAligned(c, singRealistic(eighths, { lag: 0.3, fn: 12, zeta: 0.7 }), opts, { rate: 1, latencyMs: 130, calibrated: false });
    expect(al.shiftMs).toBeGreaterThan(250);
    expect(medianOnsetMs(al.result, 1, eighths)!).toBeGreaterThan(250);
  });
  it('lifting subharmonics after the line-up does not invent octave errors on octave leaps', () => {
    const leaps = makePart('B', [[48, 1], [60, 1], [48, 1], [60, 1], [null, 1], [50, 1], [62, 1], [50, 1], [62, 2]], 120);
    const c: ScoringContext = { score: makeScore([leaps], 120), part: leaps, range: [0, leaps.notes.length - 1] };
    const al = scoreAligned(c, singRealistic(leaps, { lag: 0.25 }), strict, { rate: 1, latencyMs: 130, calibrated: false, liftSubharmonics: true });
    expect(al.result.accuracy).toBeGreaterThan(0.9);
    expect(al.result.notes.some((n) => n.octave)).toBe(false);
  });
  it('a note really sung an octave low stays an octave error', () => {
    const leaps = makePart('A', [[57, 1], [69, 1], [57, 1], [69, 1], [57, 1], [69, 2]], 90);
    const c: ScoringContext = { score: makeScore([leaps], 90), part: leaps, range: [0, leaps.notes.length - 1] };
    const low = singRealistic(leaps).map((s) => ({ ...s, midi: s.midi !== null && s.midi > 63 ? s.midi - 12 : s.midi }));
    const al = scoreAligned(c, low, strict, { rate: 1, latencyMs: 130, calibrated: true, liftSubharmonics: true });
    expect(al.result.accuracy).toBeLessThan(0.7);
  });
  it('speaker-bleed subharmonics (×⅓, flickering ×½) are corrected', () => {
    let k = 0;
    const bleed = singRealistic(part).map((s) => {
      if (s.midi === null) return s;
      k++;
      return { ...s, midi: k % 5 === 0 ? s.midi - 19 : k % 5 === 2 ? s.midi - 12 : s.midi };
    });
    const al = scoreAligned(ctx, bleed, { ...opts, octaveTolerant: false }, { rate: 1, latencyMs: 130, calibrated: true, liftSubharmonics: true });
    expect(al.result.accuracy).toBeGreaterThan(0.9);
  });
});

describe('beyond the plausible delay', () => {
  const eighths = makePart('A', [[62, 0.5], [64, 0.5], [65, 0.5], [67, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [64, 0.5], [65, 0.5], [67, 0.5], [69, 2]], 100);
  const c: ScoringContext = { score: makeScore([eighths], 100), part: eighths, range: [0, eighths.notes.length - 1] };
  it('a very slow device (Bluetooth, 450 ms on a 130 ms estimate) is flagged, and intonation still lined up', () => {
    const al = scoreAligned(c, singRealistic(eighths, { lag: 0.32 }), opts, { rate: 1, latencyMs: 130, calibrated: false, maxTotalMs: 280 });
    expect(al.beyondCapMs).toBeGreaterThan(250);
    expect(al.result.accuracy).toBeGreaterThan(0.9);
  });
  it('a normal device is not flagged', () => {
    const al = scoreAligned(c, singRealistic(eighths, { lag: 0.08 }), opts, { rate: 1, latencyMs: 130, calibrated: false, maxTotalMs: 280 });
    expect(al.beyondCapMs).toBeUndefined();
    expect(al.result.accuracy).toBeGreaterThan(0.9);
  });
});
