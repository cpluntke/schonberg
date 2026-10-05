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
  it('never lines a measured run of 16ths up with the neighbouring notes (one note behind)', () => {
    // 16ths at 144 bpm (0.104 s): a voice one note late lines up best at a ~0.1 s shift, which the
    // ±80 ms correction of a measured delay would almost reach. A voice displaced by about a note is not shifted.
    const RUN = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 67, 65, 69, 67, 71, 69, 72];
    const fast = makePart('A', RUN.map((m) => [m, 0.25] as [number, number]), 144);
    const c: ScoringContext = { score: makeScore([fast], 144), part: fast, range: [0, fast.notes.length - 1] };
    const strict: ScoringOptions = { toleranceCents: 35, tuning: 'equal', octaveTolerant: false };
    const behind = singRealistic(fast, { lag: 0.104, fn: 12, zeta: 0.6, vibCents: 0 });
    const al = scoreAligned(c, behind, strict, { rate: 1, latencyMs: 130, calibrated: true });
    expect(al.shiftMs).toBe(0);
    expect(al.result.accuracy).toBeLessThan(0.5);
    // A small error in the measured delay is still corrected.
    const off = scoreAligned(c, singRealistic(fast, { lag: 0.03, fn: 12, zeta: 0.6, vibCents: 0 }), strict, { rate: 1, latencyMs: 130, calibrated: true });
    expect(off.shiftMs).toBeGreaterThanOrEqual(20);
    expect(off.result.accuracy).toBeGreaterThan(0.85);
  });
  it('a measured delay that is off by more than the cap is still corrected as far as allowed (no cliff)', () => {
    const RUN = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 67, 65, 69, 67, 71, 69, 72];
    const strict: ScoringOptions = { toleranceCents: 35, tuning: 'equal', octaveTolerant: false };
    for (const [bpm, lateMs, fn] of [[144, 52, 12], [144, 57, 12], [144, 70, 12], [104, 87, 12], [104, 94, 12], [144, 52, 6]]) {
      const fast = makePart('A', RUN.map((m) => [m, 0.25] as [number, number]), bpm);
      const c: ScoringContext = { score: makeScore([fast], bpm), part: fast, range: [0, fast.notes.length - 1] };
      const al = scoreAligned(c, singRealistic(fast, { lag: lateMs / 1000, fn, zeta: fn < 10 ? 0.7 : 0.6, vibCents: 0 }), strict, { rate: 1, latencyMs: 130, calibrated: true });
      // (before: 57 ms at 144 bpm and 94 ms at 104 bpm scored 0.05 — no shift at all; a slow glide 52 ms late 0.58)
      expect(al.shiftMs, `${bpm} bpm, ${lateMs} ms late`).toBeGreaterThan(0);
      expect(al.result.accuracy, `${bpm} bpm, ${lateMs} ms late`).toBeGreaterThan(0.9);
    }
  });
  it('does not shift a measured run of fast notes for a voice on the wrong notes', () => {
    // A semitone off throughout lines up nowhere: no shift, no credit (a forced shift scored 0.22–0.43).
    const SCALE = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 67, 65, 69, 67, 71, 69, 72];
    const CHROM = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 71, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61];
    for (const [notes, off, lag, tol] of [[SCALE, -100, 0, 35], [SCALE, 100, 0, 35], [CHROM, -100, 0, 35], [SCALE, -40, 0.07, 25]] as const) {
      const fast = makePart('A', notes.map((m) => [m, 0.25] as [number, number]), 144);
      const c: ScoringContext = { score: makeScore([fast], 144), part: fast, range: [0, fast.notes.length - 1] };
      const al = scoreAligned(c, singRealistic(fast, { lag, fn: 12, zeta: 0.6, vibCents: 0, offsetCents: off }), { toleranceCents: tol, tuning: 'equal', octaveTolerant: false }, { rate: 1, latencyMs: 130, calibrated: true });
      expect(al.shiftMs, `${off}¢`).toBe(0);
      expect(al.result.accuracy, `${off}¢`).toBeLessThan(0.1);
    }
  });
  it('does not line up a voice one note ahead, or nearly a note behind, on fast notes (measured delay)', () => {
    // The glide into each note makes one note ahead look only ~2/3 of a note early: within reach of
    // a correction. Lined up, such a voice scored 0.85–0.99; 0.9 of a note behind 0.93–1.00.
    const SCALE = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 67, 65, 69, 67, 71, 69, 72];
    const CHROM = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 71, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61];
    for (const notes of [SCALE, CHROM]) for (const bpm of [104, 144]) for (const tol of [25, 50]) {
      const T = 15 / bpm;
      const fast = makePart('A', notes.map((m) => [m, 0.25] as [number, number]), bpm);
      const c: ScoringContext = { score: makeScore([fast], bpm), part: fast, range: [0, fast.notes.length - 1] };
      const ahead = makePart('A', notes.map((_m, i) => [notes[Math.min(i + 1, notes.length - 1)], 0.25] as [number, number]), bpm);
      const o: ScoringOptions = { toleranceCents: tol, tuning: 'equal', octaveTolerant: false };
      const run = { rate: 1, latencyMs: 130, calibrated: true };
      for (const [label, s] of [
        ['ahead (time)', singRealistic(fast, { lag: -T, fn: 12, zeta: 0.6, vibCents: 0 })],
        ['ahead (melody)', singRealistic(ahead, { fn: 12, zeta: 0.6, vibCents: 0 })],
        ['0.9 behind', singRealistic(fast, { lag: 0.9 * T, fn: 12, zeta: 0.6, vibCents: 0 })],
      ] as const) {
        const al = scoreAligned(c, s, o, run);
        expect(al.result.accuracy, `${label} ${bpm} bpm ±${tol}¢`).toBeLessThan(0.5);
      }
    }
  });
  describe('8th-note runs at 144–176 bpm, measured delay (L1–L3, standard and forgiving)', () => {
    // 8ths there are 0.17–0.29 s long: the ±80 ms correction moved a voice one note ahead most of
    // the way onto the right notes, and the short-note rule then credited it (0.72–0.98).
    const SCALE = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 67, 65, 69, 67, 71, 69, 72];
    const CHROM = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 71, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61];
    // [level, playback rate, tolerance ¢]: L1 at 70%, L2/L3 standard, L2/L3 forgiving (×1.3).
    const LEVELS: [string, number, number][] = [['L1', 0.7, 50], ['L2', 1, 35], ['L3', 1, 30], ['L2 forgiving', 1, 46], ['L3 forgiving', 1, 39]];
    const cases = (f: (label: string, c: ScoringContext, fast: ReturnType<typeof makePart>, notes: number[], T: number, rate: number, o: ScoringOptions) => void) => {
      for (const [mel, notes] of [['stepwise', SCALE], ['chromatic', CHROM]] as const) for (const bpm of [144, 160, 176]) for (const [lv, rate, tol] of LEVELS) {
        const fast = makePart('A', notes.map((m) => [m, 0.5] as [number, number]), bpm);
        const c: ScoringContext = { score: makeScore([fast], bpm), part: fast, range: [0, fast.notes.length - 1] };
        f(`${mel} ${bpm} bpm ${lv}`, c, fast, notes, 30 / bpm, rate, { toleranceCents: tol, tuning: 'equal', octaveTolerant: false });
      }
    };
    it('one note ahead or one note behind fails', () => {
      cases((label, c, fast, notes, T, rate, o) => {
        const run = { rate, latencyMs: 130, calibrated: true };
        const ahead = makePart('A', notes.map((_m, i) => [notes[Math.min(i + 1, notes.length - 1)], 0.5] as [number, number]), 60 / (2 * T));
        for (const [what, s] of [
          ['ahead (time)', singRealistic(fast, { lag: -T, fn: 12, zeta: 0.6, vibCents: 0 })],
          ['ahead (melody)', singRealistic(ahead, { fn: 12, zeta: 0.6, vibCents: 0 })],
          ['behind (time)', singRealistic(fast, { lag: T, fn: 12, zeta: 0.6, vibCents: 0 })],
        ] as const) expect(scoreAligned(c, s, o, run).result.accuracy, `${what}, ${label}`).toBeLessThan(0.5);
      });
    });
    it('a measured delay off by 30–70 ms either way is still corrected', () => {
      cases((label, c, fast, _notes, _T, rate, o) => {
        for (const ms of [-70, -30, 30, 70]) for (const fn of [12, 6]) {
          const s = singRealistic(fast, { lag: (ms / 1000) * rate, fn, zeta: 0.6, vibCents: 0 });
          expect(scoreAligned(c, s, o, { rate, latencyMs: 130, calibrated: true }).result.accuracy, `${ms} ms, fn ${fn}, ${label}`).toBeGreaterThan(0.9);
        }
      });
    });
  });
  it('still corrects measured-delay errors of 40–70 ms either way on fast notes', () => {
    const SCALE = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 67, 65, 69, 67, 71, 69, 72];
    for (const bpm of [104, 144]) for (const ms of [-70, -40, 40, 52, 70]) for (const fn of [12, 6]) {
      const fast = makePart('A', SCALE.map((m) => [m, 0.25] as [number, number]), bpm);
      const c: ScoringContext = { score: makeScore([fast], bpm), part: fast, range: [0, fast.notes.length - 1] };
      const al = scoreAligned(c, singRealistic(fast, { lag: ms / 1000, fn, zeta: 0.6, vibCents: 0 }), { toleranceCents: 25, tuning: 'equal', octaveTolerant: false }, { rate: 1, latencyMs: 130, calibrated: true });
      expect(al.result.accuracy, `${bpm} bpm, ${ms} ms, fn ${fn}`).toBeGreaterThan(fn === 12 ? 0.98 : 0.9);
    }
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
