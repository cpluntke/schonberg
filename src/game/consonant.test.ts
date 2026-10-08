import { describe, expect, it } from 'vitest';
import { CONSONANT_MAX, scoreAttempt, type ScoringContext } from './scoring';
import { makePart, makeScore } from './testutil';
import type { NoteResult, PitchSample, ScoringOptions } from './types';

const plain: ScoringOptions = { toleranceCents: 30, tuning: 'equal', octaveTolerant: false, rate: 1 };
const opts: ScoringOptions = { ...plain, consonants: true };

/** What is heard at `dt` seconds into note i: a pitch, or an unpitched reading (rms, fricative or not). */
type Heard = number | { rms: number; fric?: boolean };

/**
 * Samples every 20 ms from 0.6 s before the first note (the count-in: room noise at `floor`) to the
 * end; `sing(i, dt)` gives each note's sound, rests are room noise.
 */
function take(spec: [number | null, number][], bpm: number, sing: (i: number, dt: number, midi: number) => Heard, floor = 0.001): { ctx: ScoringContext; s: PitchSample[] } {
  const part = makePart('A', spec, bpm);
  const ctx: ScoringContext = { score: makeScore([part], bpm), part, range: [0, part.notes.length - 1] };
  const last = part.notes[part.notes.length - 1];
  const s: PitchSample[] = [];
  for (let t = -0.6; t <= last.start + last.dur + 0.2 + 1e-9; t += 0.02) {
    const i = part.notes.findIndex((n) => t >= n.start - 1e-9 && t < n.start + n.dur - 1e-9);
    const h: Heard = i < 0 ? { rms: floor } : sing(i, t - part.notes[i].start, part.notes[i].midi);
    s.push(typeof h === 'number'
      ? { time: t, midi: h, clarity: 0.95, rms: 0.05 }
      : { time: t, midi: null, clarity: 0.3, rms: h.rms, ...(h.fric ? { fric: true } : {}) });
  }
  return { ctx, s };
}

// Four 0.4 s notes, legato (150 bpm); note 1 (D4) is the one under test.
const legato: [number, number][] = [[60, 1], [62, 1], [64, 1], [65, 1]];
const hiss = { rms: 0.02, fric: true };
const quiet = { rms: 0.001 };
/** Note 1: `gap` until `voiceAt` s, then its pitch (`sung`); the other notes in tune. */
const onBeat = (gap: Heard, voiceAt: number, sung?: number) => (i: number, dt: number, m: number): Heard =>
  i !== 1 ? m : dt < voiceAt ? gap : sung ?? m;
const note1 = (t: { ctx: ScoringContext; s: PitchSample[] }, o = opts): NoteResult => scoreAttempt(t.ctx, t.s, o).notes[1];

describe('consonants (ScoringOptions.consonants)', () => {
  it('an s on the beat (a loud fricative into the voice) moves the arrival cap', () => {
    const silent = note1(take(legato, 150, onBeat(quiet, 0.24)));
    const s = note1(take(legato, 150, onBeat(hiss, 0.24)));
    expect(silent.grade).not.toBe('perfect');
    expect(['good', 'perfect']).toContain(s.grade);
    expect(s.hitRatio).toBeGreaterThan(silent.hitRatio + 0.15);
    // Only with the option (headphones on): otherwise the same as silence.
    expect(note1(take(legato, 150, onBeat(hiss, 0.24)), plain).hitRatio).toBeCloseTo(silent.hitRatio, 9);
  });

  it('timing counts from a real consonant on the beat (the vowel after it is not late); else from the vowel', () => {
    // Detached quarter notes at 100 bpm (0.6 s), a 0.24 s s on the beat of note 1, then the vowel.
    const det: [number | null, number][] = [[60, 1], [null, 1], [62, 1], [null, 1], [64, 1]];
    const s = (gap: Heard) => (i: number, dt: number, m: number): Heard => (i !== 1 ? m : dt < 0.24 ? gap : m);
    const n = (t: { ctx: ScoringContext; s: PitchSample[] }, o = opts) => scoreAttempt(t.ctx, t.s, o).notes[1];
    const withS = n(take(det, 100, s(hiss)));
    expect(withS.consonantMs).toBeGreaterThanOrEqual(200);
    expect(withS.onsetMs!).toBeLessThan(60);
    // Without headphones (option off), or with silence before the vowel: timed from the vowel, late.
    expect(n(take(det, 100, s(hiss)), plain).onsetMs!).toBeGreaterThanOrEqual(220);
    expect(n(take(det, 100, s(hiss)), plain).consonantMs).toBeUndefined();
    expect(n(take(det, 100, s(quiet))).onsetMs!).toBeGreaterThanOrEqual(220);
    // A hiss longer than a consonant (a late singer hissing from the beat): timed from the vowel.
    const late = (i: number, dt: number, m: number): Heard => (i !== 1 ? m : dt < 0.32 ? hiss : m);
    expect(n(take(det, 100, late)).onsetMs!).toBeGreaterThanOrEqual(300);
    // A consonant that starts well after the beat (a late singer): timed from the vowel, still late.
    const lateS = (i: number, dt: number, m: number): Heard => (i !== 1 ? m : dt < 0.12 ? quiet : dt < 0.32 ? hiss : m);
    const ls = n(take(det, 100, lateS));
    expect(ls.consonantMs).toBeUndefined();
    expect(ls.onsetMs!).toBeGreaterThanOrEqual(300);
  });

  it('room noise, hum or the backing (loud but not fricative) is no consonant', () => {
    const silent = note1(take(legato, 150, onBeat(quiet, 0.26)));
    for (const rms of [0.006, 0.02, 0.05]) expect(note1(take(legato, 150, onBeat({ rms }, 0.26)))).toEqual(silent);
  });

  it('nor is a hiss no louder than the room (the count-in and rests set the floor)', () => {
    const silent = note1(take(legato, 150, onBeat({ rms: 0.02 }, 0.26), 0.02));
    // A constant hiss, also before the first note: the floor is the hiss itself.
    const t = take(legato, 150, onBeat(hiss, 0.26), 0.02);
    for (const x of t.s) if (x.midi === null) x.fric = true;
    expect(note1(t).hitRatio).toBeCloseTo(silent.hitRatio, 9);
  });

  it('fragments of voice between hisses get nothing (the voice must cover 35 % of the note)', () => {
    const frag = (gap: Heard) => (i: number, dt: number, m: number): Heard => (i !== 1 ? m : dt >= 0.16 && dt < 0.24 ? m : gap);
    const silent = note1(take(legato, 150, frag(quiet)));
    const s = note1(take(legato, 150, frag(hiss)));
    expect(['ok', 'miss']).toContain(s.grade);
    expect(s.hitRatio).toBeCloseTo(silent.hitRatio, 9);
  });

  it('a consonant at the end (a final s, before a rest) is excused; silence there still counts', () => {
    const spec: [number | null, number][] = [[60, 1], [62, 1], [null, 1], [65, 1]];
    const end = (gap: Heard) => (i: number, dt: number, m: number): Heard => (i !== 1 ? m : dt < 0.22 ? m : gap);
    const silent = note1(take(spec, 150, end(quiet)));
    const s = note1(take(spec, 150, end(hiss)));
    expect(s.hitRatio).toBeGreaterThan(silent.hitRatio + 0.15);
    expect(['good', 'perfect']).toContain(s.grade);
  });

  it('start and end together count at most CONSONANT_MAX (and 35 % of the note)', () => {
    // A 1 s note before a rest: s for 0.25 s on the beat, voice to 0.65, then a 0.35 s s.
    const spec: [number | null, number][] = [[60, 2], [62, 2], [null, 2], [65, 2]];
    const both = (gap: Heard) => (i: number, dt: number, m: number): Heard => (i !== 1 ? m : dt >= 0.25 && dt < 0.65 ? m : gap);
    const silent = note1(take(spec, 120, both(quiet)));
    const s = note1(take(spec, 120, both(hiss)));
    expect(CONSONANT_MAX).toBe(0.25);
    expect(s.hitRatio).toBeGreaterThan(silent.hitRatio);
    // Without the cap the whole unvoiced part would be excused (hit ratio 1).
    expect(s.hitRatio).toBeLessThan(0.8);
  });

  it('a repeated note: the vowel held past the beat, then the s, then the vowel', () => {
    const spec: [number, number][] = [[62, 1], [62, 1], [62, 1], [62, 1]];
    const rep = (gap: Heard) => (i: number, dt: number, m: number): Heard => (i === 1 && dt >= 0.12 && dt < 0.3 ? gap : m);
    const silent = note1(take(spec, 120, rep(quiet)));
    const s = note1(take(spec, 120, rep(hiss)));
    expect(s.hitRatio).toBeGreaterThan(silent.hitRatio + 0.15);
  });

  it('a consonant that starts late (silence on the beat) is not excused', () => {
    const late = (gap: Heard) => (i: number, dt: number, m: number): Heard => (i !== 1 ? m : dt < 0.16 ? quiet : dt < 0.26 ? gap : m);
    expect(note1(take(legato, 150, late(hiss))).hitRatio).toBeCloseTo(note1(take(legato, 150, late(quiet))).hitRatio, 9);
  });

  it('hissing instead of singing, or a wrong note after the consonant, is still a miss', () => {
    expect(note1(take(legato, 150, onBeat(hiss, 0.4))).grade).toBe('miss');
    expect(note1(take(legato, 150, onBeat(hiss, 0.2, 63))).grade).toBe('miss');
  });
});
