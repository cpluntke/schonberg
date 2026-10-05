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
    // As the tracker sees "ta-ta-ta" at 144 bpm: the tail of the note's own consonant (unclear), two
    // clear readings on the vowel, one already a third of the way to the next note as the next
    // consonant begins, then that consonant. (A vowel heard only in the first quarter of the note,
    // with a single reading after a gap, can't be told from the guide's attack bleeding into the
    // mic plus a stray frame; see the guide-bleed tests below.)
    const { part, ctx } = run();
    const s = perNote(part, [0.005, 0.025, 0.045, 0.065, 0.085], (i, k) => {
      const next = part.notes[i + 1];
      const toNext = next ? 100 * (next.midi - part.notes[i].midi) : 0;
      return [null, 8, 12, 0.3 * toNext, null][k];
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

  it('a tracker error far from every note (a subharmonic in a fast change) is not held against the note', () => {
    // Two of four readings at ×⅕ of the voice (−27.9 semitones), as McLeod sometimes reads a fast change.
    const { part, ctx } = run();
    const s = perNote(part, [0.005, 0.025, 0.045, 0.065, 0.085], (_i, k) => [10, -2786, -2790, 5, null][k]);
    const r = scoreAttempt(ctx, s, L4);
    expect(r.counts.miss + r.counts.ok).toBe(0);
    // ...but a voice that is far off for most of the note is what was sung (here: an octave low).
    const low = perNote(part, [0.005, 0.025, 0.045, 0.065, 0.085], (_i, k) => [0, -1200, -1200, -1200, 0][k]);
    expect(scoreAttempt(ctx, low, L4).counts.miss).toBe(RUN.length);
  });

  it('a voice swinging evenly around a note it never quite rests on counts', () => {
    // At 144 bpm the voice overshoots and rings: the tracker reads it on either side of the note,
    // about equally far, but never within ±25¢, and more often on one side.
    const { part, ctx } = run();
    const s = perNote(part, [0.005, 0.025, 0.045, 0.065, 0.085], (i, k) => {
      const prev = part.notes[i - 1];
      const fromPrev = prev ? 100 * (prev.midi - part.notes[i].midi) : 0;
      const sign = fromPrev > 0 ? -1 : 1; // overshoot away from where the voice came from
      return [0.8 * fromPrev, -30 * sign, 40 * sign, 32 * sign, null][k];
    });
    const r = scoreAttempt(ctx, s, L4);
    expect(r.counts.miss + r.counts.ok).toBe(0);
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
  it('a voice passing through the note on its way to a pitch 45 cents flat is not on the note', () => {
    // One reading just above the note, then the voice sits ~50¢ low: the readings straddle the
    // note, but unevenly (+12 / −48), so this is not a swing around it.
    const s = perNote(part, [0.005, 0.025, 0.045, 0.065, 0.085], (i, k) => {
      const prev = part.notes[i - 1];
      const fromPrev = prev ? 100 * (prev.midi - part.notes[i].midi) : 0;
      return [fromPrev - 40, 12, -48, -55, null][k]; // (still on the previous pitch, 40¢ low)
    });
    const r = scoreAttempt(ctx, s, L4);
    expect(r.counts.miss).toBe(RUN.length);
  });
  it('a silent singer is not credited for one reading per note (an attack, a consonant)', () => {
    // Nothing but one correct reading 2 ms into each note: the short-note rule needs two readings
    // standing for 30% of the note.
    const end = part.notes[part.notes.length - 1].start + 0.104;
    const s: PitchSample[] = [];
    for (let t = 0; t < end; t += 0.02) s.push({ time: t, midi: null, clarity: 0.3, rms: 0.001 });
    for (const n of part.notes) s.push({ time: n.start + 0.002, midi: n.midi, clarity: 0.95, rms: 0.05 });
    const r = scoreAttempt(ctx, s.sort((x, y) => x.time - y.time), L4);
    expect(r.accuracy).toBe(0);
  });
  it('readings only in the attack of each note (consonant blips, guide bleed) are not the note', () => {
    // Two correct readings in the first quarter of every note, unvoiced otherwise (they scored 0.45, with 9 perfect).
    const s = perNote(part, [0.005, 0.025, 0.045, 0.065, 0.085], (_i, k) => (k < 2 ? 0 : null));
    expect(scoreAttempt(ctx, s, L2).accuracy).toBe(0);
  });
  it('a silent singer with the guide bleeding into a fifth of the readings fails', () => {
    for (const bpm of [104, 144]) {
      const { part: p, ctx: c } = run(bpm);
      const end = p.notes[p.notes.length - 1].start + p.notes[p.notes.length - 1].dur;
      let seed = 7;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const s: PitchSample[] = [];
      for (let t = 0; t < end; t += 0.02) {
        const due = p.notes.find((n) => n.start <= t && t < n.start + n.dur);
        const m = due && rnd() < 0.2 ? due.midi : null;
        s.push({ time: t, midi: m, clarity: m === null ? 0.3 : 0.95, rms: m === null ? 0.001 : 0.05 });
      }
      // (before the coverage rule: 0.70 at 104 bpm and 0.55 at 144 bpm)
      expect(scoreAttempt(c, s, L2).accuracy).toBeLessThan(0.55);
    }
  });
  it('at L1 the guide bleeding in (its attack on every note plus a quarter of the frames) scores no higher than before', () => {
    // Silent singer, slow practice tempo (70%), ±50¢: the guide's 30 ms attack and 25% random frames
    // at the right pitch. (Old scorer: about 0.72 / 0.66; scattered frames judged as a note: 0.79 / 0.76.)
    const L1: ScoringOptions = { toleranceCents: 50, tuning: 'equal', octaveTolerant: false };
    const rate = 0.7;
    for (const [bpm, max] of [[104, 0.74], [144, 0.68]]) {
      const p = makePart('A', [...RUN, ...RUN, ...RUN].map((m) => [m, 0.25] as [number, number]), bpm);
      const c: ScoringContext = { score: makeScore([p], bpm), part: p, range: [0, p.notes.length - 1] };
      const end = p.notes[p.notes.length - 1].start + p.notes[p.notes.length - 1].dur;
      let sum = 0;
      for (const seed0 of [1, 2, 3, 4, 5]) {
        let seed = seed0 * 7919;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        const s: PitchSample[] = [];
        for (let t = 0; t < end; t += 0.02 * rate) {
          const n = p.notes.find((x) => x.start <= t && t < x.start + x.dur)!;
          const on = t - n.start < 0.03 * rate || rnd() < 0.25;
          s.push({ time: t, midi: on ? n.midi : null, clarity: on ? 0.95 : 0.3, rms: on ? 0.05 : 0.001 });
        }
        sum += scoreAttempt(c, s, L1).accuracy;
      }
      expect(sum / 5, `${bpm} bpm`).toBeLessThan(max);
    }
  });
  it('30 cents flat fails at L4', () => {
    for (const bpm of [104, 144]) {
      const { part: p, ctx: c } = run(bpm);
      expect(scoreAttempt(c, sing(p, { fn: 9, zeta: 0.55, vibCents: 15, offsetCents: -30 }), L4).accuracy).toBeLessThan(0.5);
    }
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
