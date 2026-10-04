// Fast notes (16ths at 104–144 bpm, ~0.1 s each): the voice rarely settles, the next syllable's
// consonant cuts the vowel short, and the pitch tracker sees only a handful of readings per note.
// A good singer's fast notes must still count, and singers on the wrong notes must still fail.
import { describe, expect, it } from 'vitest';
import { LiveScorer, scoreAttempt, type ScoringContext } from './scoring';
import { makePart, makeScore, singRealistic as sing } from './testutil';
import type { PitchSample, ScoringOptions } from './types';

const L2: ScoringOptions = { toleranceCents: 35, tuning: 'equal', octaveTolerant: false };
const L4: ScoringOptions = { toleranceCents: 25, tuning: 'equal', octaveTolerant: false };

// Two bars of 16ths at 144 bpm (0.104 s per note): a scale, a neighbour figure and thirds.
const RUN = [60, 62, 64, 65, 67, 69, 71, 72, 71, 72, 71, 69, 67, 64, 67, 64, 60, 64, 62, 60];
const run = (bpm = 144) => {
  const part = makePart('A', RUN.map((m) => [m, 0.25] as [number, number]), bpm);
  const ctx: ScoringContext = { score: makeScore([part], bpm), part, range: [0, part.notes.length - 1] };
  return { part, ctx };
};

/** Readings at fixed offsets into every note, `cents(i, k)` relative to note i (null = unvoiced). */
function perNote(part: ReturnType<typeof run>['part'], offsets: number[], cents: (i: number, k: number) => number | null): PitchSample[] {
  const out: PitchSample[] = [];
  part.notes.forEach((n, i) => offsets.forEach((o, k) => {
    const c = cents(i, k);
    out.push({ time: n.start + o, midi: c === null ? null : n.midi + c / 100, clarity: c === null ? 0.5 : 0.95, rms: 0.05 });
  }));
  return out;
}

describe('fast notes: a good singer is not marked as missing them', () => {
  it('consonant on every note: the vowel sits early in the note, the body only sees a smeared reading', () => {
    // As the tracker sees "ta-ta-ta" at 144 bpm: two clear readings on the vowel, the next
    // consonant (unclear), and one reading half-way to the next note in between.
    const { part, ctx } = run();
    const s = perNote(part, [0.005, 0.025, 0.045, 0.065, 0.085], (i, k) => {
      const next = part.notes[i + 1];
      const toNext = next ? 100 * (next.midi - part.notes[i].midi) : 0;
      return [8, 12, null, 0.2 * toNext, null][k];
    });
    for (const opts of [L2, L4]) {
      const r = scoreAttempt(ctx, s, opts);
      expect(r.counts.miss + r.counts.ok).toBe(0);
      expect(r.accuracy).toBeGreaterThan(0.95);
    }
  });

  it('no consonant: glide in, overshoot, glide out — judged on the whole note, not on two body readings', () => {
    // The two body readings both sit in the overshoot (+30¢); the note as a whole is centred.
    const { part, ctx } = run();
    const s = perNote(part, [0.005, 0.025, 0.045, 0.065, 0.085], (i, k) => {
      const prev = part.notes[i - 1];
      const fromPrev = prev ? 100 * (prev.midi - part.notes[i].midi) : 0;
      const sign = fromPrev > 0 ? -1 : 1; // overshoot away from where the voice came from
      return [0.7 * fromPrev, -5 * sign, 30 * sign, 28 * sign, 10 * sign][k];
    });
    const r = scoreAttempt(ctx, s, L4);
    expect(r.counts.miss + r.counts.ok).toBe(0);
  });

  it('a realistic run (glides, overshoot, vibrato) is in tune at L2 and L4', () => {
    for (const bpm of [104, 144]) {
      const { part, ctx } = run(bpm);
      for (const opts of [L2, L4]) {
        const r = scoreAttempt(ctx, sing(part, { fn: 9, zeta: 0.55, vibCents: 15 }), opts);
        // (at 144 bpm and ±25¢ the overshoot of the falling third 67→64 reads −29¢)
        expect(r.counts.miss + r.counts.ok).toBeLessThanOrEqual(opts === L4 && bpm === 144 ? 1 : 0);
        expect(r.accuracy).toBeGreaterThan(0.9);
      }
    }
  });

  it('the live grade of a short note appears once its readings are in, and matches the result', () => {
    const { part, ctx } = run();
    const s = sing(part, { fn: 9, zeta: 0.55, vibCents: 0 });
    const live = new LiveScorer(ctx, L2);
    const n = part.notes[3];
    for (const x of s) {
      live.push(x);
      if (x.time < n.start + n.dur) expect(live.noteGrade(3)).toBeUndefined();
    }
    const r = live.finish();
    expect(live.noteGrade(3)).toBe(r.notes[3].grade);
    expect(r).toEqual(scoreAttempt(ctx, s, L2));
  });
});

describe('fast notes: singers on the wrong notes still fail', () => {
  const { part, ctx } = run();
  it('one note behind (each pitch sung during the next note)', () => {
    const behind = makePart('A', RUN.map((m, i) => [i ? RUN[i - 1] : m, 0.25] as [number, number]), 144);
    const r = scoreAttempt(ctx, sing(behind, { fn: 9, zeta: 0.55, vibCents: 15 }), L2);
    expect(r.accuracy).toBeLessThan(0.3);
  });
  it('wrong notes (every other note a semitone or a tone off)', () => {
    const wrong = makePart('A', RUN.map((m, i) => [m + (i % 2 ? (i % 4 === 1 ? 1 : -2) : 0), 0.25] as [number, number]), 144);
    const r = scoreAttempt(ctx, sing(wrong, { fn: 9, zeta: 0.55, vibCents: 15 }), L2);
    for (let i = 1; i < RUN.length; i += 2) expect(r.notes[i].grade).toBe('miss');
    expect(r.accuracy).toBeLessThan(0.6);
  });
  it('40 cents flat fails at L2', () => {
    const r = scoreAttempt(ctx, sing(part, { fn: 9, zeta: 0.55, vibCents: 15, offsetCents: -40 }), L2);
    expect(r.accuracy).toBeLessThan(0.5);
  });
  it('a voice that only glides through the notes (60 cents flat, slow) fails', () => {
    // (Falling steps still count: the slow glide down from above spends the short note near it.)
    const r = scoreAttempt(ctx, sing(part, { fn: 5, zeta: 0.9, vibCents: 0, offsetCents: -60 }), L4);
    expect(r.accuracy).toBeLessThan(0.5);
  });
  it('a single in-tune reading among readings of the neighbouring note is not a hit', () => {
    // Sitting on the previous note's pitch through the note, touching the target once at the end.
    const s = perNote(part, [0.005, 0.025, 0.045, 0.065, 0.085], (i, k) => {
      const prev = part.notes[i - 1];
      return k === 4 || !prev ? 0 : 100 * (prev.midi - part.notes[i].midi);
    });
    const r = scoreAttempt(ctx, s, L2);
    expect(r.counts.miss).toBeGreaterThanOrEqual(RUN.length - 3);
  });
});
