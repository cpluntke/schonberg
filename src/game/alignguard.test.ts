import { describe, expect, it } from 'vitest';
import { scoreAligned } from './align';
import { scoreAttempt, type ScoringContext } from './scoring';
import { makePart, makeScore } from './testutil';
import type { PitchSample, ScoringOptions } from './types';

describe('scoreAligned with a measured delay', () => {
  it('keeps the voice as heard when the line-up would score it worse', () => {
    // Eighths at 100 bpm, "sa sa sa…" with a long s before each beat and a slow re-attack: each vowel
    // starts on the previous pitch for 80 ms, and the next s masks the last 120 ms of the note. The
    // pitch evidence looks ~80 ms late, but shifting it pulls every vowel out of its note.
    const mel = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 64, 62, 65, 69, 65, 64, 60];
    const part = makePart('A', mel.map((m) => [m, 0.5] as [number, number]), 100);
    const ctx: ScoringContext = { score: makeScore([part], 100), part, range: [0, part.notes.length - 1] };
    const opts: ScoringOptions = { toleranceCents: 30, tuning: 'equal', octaveTolerant: false, rate: 1 };
    const samples: PitchSample[] = [];
    for (let t = 0; t < 0.3 * mel.length; t += 0.02) {
      const i = Math.min(mel.length - 1, Math.floor(t / 0.3 + 1e-9));
      const dt = t - i * 0.3;
      const midi = dt < 0.08 ? (i > 0 ? mel[i - 1] : null) : dt < 0.18 ? mel[i] : null;
      samples.push({ time: t, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.02 : 0.05 });
    }
    const plain = scoreAttempt(ctx, samples, opts);
    const al = scoreAligned(ctx, samples, opts, { rate: 1, latencyMs: 150, calibrated: true });
    expect(al.estimate.match).toBeGreaterThan(0); // the search ran
    expect(al.shiftMs).toBe(0);
    expect(al.result.accuracy).toBe(plain.accuracy);
    expect(al.rejectedShiftMs).toBeGreaterThanOrEqual(60);
  });

  it('keeps a real correction when both score the same (a clean singer, the delay 60–80 ms off)', () => {
    const mel = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 64, 62, 65, 69, 65, 64, 60];
    const part = makePart('A', mel.map((m) => [m, 1] as [number, number]), 100);
    const ctx: ScoringContext = { score: makeScore([part], 100), part, range: [0, part.notes.length - 1] };
    const opts: ScoringOptions = { toleranceCents: 30, tuning: 'equal', octaveTolerant: false, rate: 1 };
    for (const err of [0.06, 0.08]) {
      const samples: PitchSample[] = [];
      for (let t = 0; t < 0.6 * mel.length + 0.3; t += 0.02) {
        const i = Math.floor((t - err) / 0.6 + 1e-9);
        const midi = i >= 0 && i < mel.length ? mel[i] : null;
        samples.push({ time: t, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.001 : 0.05 });
      }
      const al = scoreAligned(ctx, samples, opts, { rate: 1, latencyMs: 150, calibrated: true });
      expect(Math.abs(al.shiftMs)).toBeGreaterThanOrEqual(50);
    }
  });
});
