// NoteResult.unsure 'mic': notes let off at level 1 because of the tracker's evidence of input
// trouble (PitchSample.mic), and only when nothing says the note was sung wrong.
import { describe, expect, it } from 'vitest';
import { scoreAttempt, type ScoringContext } from './scoring';
import { makePart, makeScore } from './testutil';
import type { PitchSample, ScoringOptions } from './types';
import { noteVerdict } from '../progress/ladder';

const opts: ScoringOptions = { toleranceCents: 50, tuning: 'equal', octaveTolerant: false };
// Bass, level-1 style: C#4 held notes (1 beat = 1 s), as in the run with hum.
const part = makePart('B', [[61, 2], [61, 2], [61, 2]]);
const score = makeScore([part]);
const ctx: ScoringContext = { score, part, range: [0, 2] };

/**
 * Readings every 20 ms. `note1(t)` sets the middle note's readings (t in the note): a pitch, null
 * (unvoiced but loud), or 'quiet' (silence); `mic(t)` flags them as input trouble.
 */
function samples(note1: (t: number) => number | null | 'quiet', mic: (t: number) => boolean): PitchSample[] {
  const out: PitchSample[] = [];
  for (let t = 0; t < 6; t += 0.02) {
    const inMid = t >= 2 && t < 4;
    const v = inMid ? note1(t - 2) : 61;
    const midi = v === 'quiet' ? null : v;
    out.push({ time: t, midi, clarity: midi == null ? 0.78 : 0.92, rms: v === 'quiet' ? 0.003 : 0.12, ...(inMid && mic(t - 2) ? { mic: true } : {}) });
  }
  return out;
}

/** Every other 0.2 s unvoiced (the tracker losing the voice), the rest on `midi`. */
const gappy = (midi: number) => (t: number) => (Math.floor(t / 0.2) % 3 === 0 ? midi : null);

describe('mic trouble', () => {
  it('a right note mostly lost to input trouble is let off (not wrong)', () => {
    const r = scoreAttempt(ctx, samples(gappy(61), () => true), opts);
    const n = r.notes[1];
    expect(n.grade === 'ok' || n.grade === 'miss').toBe(true);
    expect(n.unsure).toBe('mic');
    expect(noteVerdict(n)).toBe('forgiven');
  });

  it('the same gaps without the tracker’s evidence stay wrong (hum alone excuses nothing)', () => {
    const n = scoreAttempt(ctx, samples(gappy(61), () => false), opts).notes[1];
    expect(n.unsure).toBeUndefined();
    expect(noteVerdict(n)).toBe('wrong');
  });

  it('a wrong note is never let off, whatever the input', () => {
    for (const wrong of [62, 59, 49, 42]) {
      // 42 = F#2: a bass really singing an octave and a fifth low reads there (the harmonic check keeps it).
      const n = scoreAttempt(ctx, samples(gappy(wrong), () => true), opts).notes[1];
      expect(noteVerdict(n)).toBe('wrong');
      expect(n.unsure).not.toBe('mic');
    }
  });

  it('a voice down at F#2 with a few right readings is not let off', () => {
    const n = scoreAttempt(ctx, samples((t) => (t > 0.5 && t < 0.6 ? 61 : 42), () => true), opts).notes[1];
    expect(noteVerdict(n)).toBe('wrong');
  });

  it('a note cut short or not sung is not let off', () => {
    // Sung for the first 0.6 s, then silence.
    const short = scoreAttempt(ctx, samples((t) => (t < 0.6 ? (Math.floor(t / 0.2) % 2 ? null : 61) : 'quiet'), () => true), opts).notes[1];
    expect(noteVerdict(short)).toBe('wrong');
    const silent = scoreAttempt(ctx, samples(() => 'quiet', () => false), opts).notes[1];
    expect(noteVerdict(silent)).toBe('wrong');
  });

  it('only a few flagged frames are not enough', () => {
    const n = scoreAttempt(ctx, samples(gappy(61), (t) => t < 0.3), opts).notes[1];
    expect(n.unsure).toBeUndefined();
  });

  it('clean runs are untouched', () => {
    const r = scoreAttempt(ctx, samples(() => 61, () => false), opts);
    expect(r.notes.every((n) => n.grade === 'perfect' && !n.unsure)).toBe(true);
  });
});
