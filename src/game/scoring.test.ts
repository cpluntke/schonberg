import { describe, expect, it } from 'vitest';
import { guessChord, justOffsetCents, LiveScorer, scoreAttempt, type ScoringContext } from './scoring';
import { makePart, makeScore, sampleSinging } from './testutil';
import type { ScoringOptions } from './types';

const opts: ScoringOptions = { toleranceCents: 25, tuning: 'equal', octaveTolerant: false };

// Simple 3-bar melody at 60 bpm (1 beat = 1 s).
const melody = makePart('S', [[62, 1], [64, 1], [66, 2], [67, 1], [69, 1], [71, 1], [69, 1], [67, 4]]);
const score = makeScore([melody]);
const ctx: ScoringContext = { score, part: melody, range: [0, melody.notes.length - 1] };

describe('scoreAttempt', () => {
  it('perfect singing → all perfect', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, (n) => n.midi), opts);
    expect(r.counts).toEqual({ perfect: 8, good: 0, ok: 0, miss: 0 });
    expect(r.accuracy).toBe(1);
    expect(r.pitch).toBeGreaterThan(0.98);
    expect(r.rhythm).toBe(1);
    expect(r.maxCombo).toBe(8);
    expect(r.score).toBe(800);
    for (const n of r.notes) {
      expect(n.cents).toBeCloseTo(0);
      expect(n.onsetMs).toBe(0);
      expect(n.scoop).toBeNull();
      expect(n.targetOffset).toBe(0);
    }
    expect(Object.keys(r.perMeasure).map(Number)).toEqual([0, 1, 2]);
    expect(r.insights.some((i) => i.kind === 'great')).toBe(true);
  });

  it('is robust to the sample rate', () => {
    for (const period of [0.01, 0.023, 0.045]) {
      const r = scoreAttempt(ctx, sampleSinging(melody, (n) => n.midi, period), opts);
      expect(r.counts.perfect).toBe(8);
      expect(r.pitch).toBeGreaterThan(0.95);
    }
  });

  it('30 cents flat with tolerance 25 → misses', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, (n) => n.midi - 0.3), opts);
    expect(r.counts.miss).toBe(8);
    expect(r.accuracy).toBe(0);
    expect(r.notes[0].cents).toBeCloseTo(-30);
    expect(r.notes[0].voicedRatio).toBeGreaterThan(0.95);
    expect(r.insights[0].kind).toBe('missed-notes');
  });

  it('20 cents flat with tolerance 25 → good (not perfect), flat tendency reported', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, (n) => n.midi - 0.2), opts);
    expect(r.counts.good).toBe(8);
    expect(r.insights.map((i) => i.kind)).toContain('flat-overall');
  });

  it('half of each note in tune → ok', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, (n, t) => (t < n.dur / 2 ? n.midi : n.midi + 1)), opts);
    for (const n of r.notes) expect(n.grade).toBe('ok');
  });

  it('octave error: miss when strict; full credit and no flag when octave tolerant', () => {
    const samples = sampleSinging(melody, (n) => n.midi - 12);
    const strict = scoreAttempt(ctx, samples, opts);
    expect(strict.counts.miss).toBe(8);
    expect(strict.notes.every((n) => n.octave)).toBe(true);
    expect(strict.insights.map((i) => i.kind)).toContain('octave');
    const tolerant = scoreAttempt(ctx, samples, { ...opts, octaveTolerant: true });
    expect(tolerant.counts.perfect).toBe(8);
    expect(tolerant.notes[0].cents).toBeCloseTo(0);
    expect(tolerant.notes.some((n) => n.octave)).toBe(false);
  });

  it('late onsets lower rhythm and are measured', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, (n, t) => (t < 0.3 ? null : n.midi)), opts);
    for (const n of r.notes) expect(Math.abs(n.onsetMs! - 300)).toBeLessThanOrEqual(25);
    // clamp(1 - (|300-40|-60)/400) = 0.5
    expect(r.rhythm).toBeCloseTo(0.5, 1);
    // Every note 300 ms late reads as "behind the beat" (which subsumes late entries).
    expect(r.insights.map((i) => i.kind).some((k) => k === 'late-entries' || k === 'behind-beat')).toBe(true);
  });

  it('silence → all misses, zero rhythm, combo 0', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, () => null), opts);
    expect(r.counts.miss).toBe(8);
    expect(r.rhythm).toBe(0);
    expect(r.maxCombo).toBe(0);
    expect(r.notes[0].cents).toBeNull();
    expect(r.notes[0].onsetMs).toBeNull();
  });

  it('scoop from below detected', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, (n, t) => (t < 0.15 ? n.midi - 1 : n.midi)), opts);
    // Note 3 (F♯→G) is approached by a semitone: "a semitone below" is the previous note,
    // which reads as holding on late rather than scooping.
    expect(r.notes.filter((n) => n.index !== 3).every((n) => n.scoop === 'below')).toBe(true);
    expect(r.insights.map((i) => i.kind)).toContain('scooping');
  });

  it('drift on long notes', () => {
    // last note (4 s) sags linearly by 40 cents
    const r = scoreAttempt(ctx, sampleSinging(melody, (n, t, i) => (i === 7 ? n.midi - 0.4 * (t / n.dur) : n.midi)), opts);
    expect(r.notes[7].drift!).toBeLessThan(-20);
    expect(r.notes[0].drift!).toBeCloseTo(0);
  });

  it('combo multiplier and reset on miss', () => {
    const long = makePart('S', Array.from({ length: 20 }, (_, i) => [60 + (i % 5), 1] as [number, number]));
    const c: ScoringContext = { score: makeScore([long]), part: long, range: [0, 19] };
    const r = scoreAttempt(c, sampleSinging(long, (n, _t, i) => (i === 12 ? null : n.midi)), opts);
    expect(r.notes[12].grade).toBe('miss');
    // notes 0..7 ×1, 8..11 ×2, 12 miss, 13..19 ×1 (combo restarted)
    expect(r.score).toBe(8 * 100 + 4 * 200 + 7 * 100);
    expect(r.maxCombo).toBe(12);
  });

  it('respects ctx.range', () => {
    const c: ScoringContext = { ...ctx, range: [2, 4] };
    const r = scoreAttempt(c, sampleSinging(melody, (n) => n.midi), opts);
    expect(r.notes.map((n) => n.index)).toEqual([2, 3, 4]);
  });

  it('very short notes are lenient', () => {
    const fast = makePart('S', [[60, 0.25], [62, 0.25], [64, 0.25], [65, 0.25]], 120);
    const c: ScoringContext = { score: makeScore([fast], 120), part: fast, range: [0, 3] };
    // the tracker caught only a single (in-tune) moment in the middle of each note
    const r = scoreAttempt(c, sampleSinging(fast, (n, t) => (Math.abs(t - 0.06) < 0.011 ? n.midi : null)), opts);
    for (const n of r.notes) expect(['good', 'perfect']).toContain(n.grade);
    // ...but one in-tune moment in a note otherwise sung a tone sharp (on the next note) is a wrong note
    const sharp = scoreAttempt(c, sampleSinging(fast, (n, t) => (Math.abs(t - 0.06) < 0.011 ? n.midi : n.midi + 2)), opts);
    for (const n of sharp.notes.slice(0, 3)) expect(n.grade).toBe('miss');
  });

  it('sample order does not matter', () => {
    const s = sampleSinging(melody, (n, t) => n.midi + 0.1 * Math.sin(t * 7));
    const shuffled = [...s].reverse();
    expect(scoreAttempt(ctx, shuffled, opts)).toEqual(scoreAttempt(ctx, s, opts));
  });
});

describe('LiveScorer', () => {
  const sing = (n: { midi: number }, t: number, i: number) => (i === 3 ? null : n.midi + 0.15 * Math.sin(t * 5) - (i === 7 ? 0.3 * t / 4 : 0));
  const samples = sampleSinging(melody, sing);

  it('finish() equals scoreAttempt()', () => {
    const live = new LiveScorer(ctx, opts);
    for (const s of samples) live.push(s);
    expect(live.finish()).toEqual(scoreAttempt(ctx, samples, opts));
  });

  it('rightSoFar: the notes over so far and sung right (a run left early)', () => {
    const live = new LiveScorer(ctx, opts);
    const final = scoreAttempt(ctx, samples, opts);
    const right = (k: number) => final.notes.slice(0, k).filter((n) => n.grade === 'perfect' || n.grade === 'good').length;
    expect(live.rightSoFar()).toBe(0);
    const half = samples.filter((s) => s.time < melody.notes[5].start);
    for (const s of half) live.push(s);
    const done = [0, 1, 2, 3, 4, 5].filter((i) => live.noteGrade(i) !== undefined).length;
    expect(done).toBeGreaterThan(2);
    expect(live.rightSoFar()).toBe(right(done));
    expect(live.rightSoFar()).toBeLessThan(done); // (note 3 wasn't sung)
  });

  it('handles slightly out-of-order samples', () => {
    const jittered = [...samples];
    for (let i = 5; i < jittered.length - 1; i += 7) [jittered[i], jittered[i + 1]] = [jittered[i + 1], jittered[i]];
    for (let i = 11; i < jittered.length - 3; i += 50) [jittered[i], jittered[i + 3]] = [jittered[i + 3], jittered[i]];
    const live = new LiveScorer(ctx, opts);
    for (const s of jittered) live.push(s);
    expect(live.finish()).toEqual(scoreAttempt(ctx, samples, opts));
  });

  it('live fill, grade, combo and score track the final result', () => {
    const live = new LiveScorer(ctx, opts);
    const final = scoreAttempt(ctx, samples, opts);
    let sawPartialFill = false;
    for (const s of samples) {
      live.push(s);
      const f = live.noteFill(2);
      if (f > 0.2 && f < 0.8) sawPartialFill = true;
    }
    expect(sawPartialFill).toBe(true);
    expect(live.noteGrade(0)).toBe(final.notes[0].grade);
    expect(live.noteGrade(3)).toBe('miss');
    expect(live.noteGrade(7)).toBeUndefined(); // last note not finalized until finish()
    const r = live.finish();
    expect(live.score).toBe(r.score);
    expect(live.noteGrade(7)).toBe(r.notes[r.notes.length - 1].grade);
    expect(live.noteFill(0)).toBeCloseTo(r.notes[0].hitRatio);
  });

  it('finish(samples) rescoring', () => {
    const live = new LiveScorer(ctx, opts);
    expect(live.finish(samples)).toEqual(scoreAttempt(ctx, samples, opts));
  });
});

describe('just intonation', () => {
  it('major third of a D major triad is 13.7 cents low', () => {
    expect(justOffsetCents(66, [50, 57, 62])).toBeCloseTo(-13.7);
  });
  it('fifth +2, root 0, minor third +15.6', () => {
    expect(justOffsetCents(57, [50, 66])).toBeCloseTo(2.0);
    expect(justOffsetCents(50, [57, 66])).toBeCloseTo(0);
    expect(justOffsetCents(65, [50, 57])).toBeCloseTo(15.6); // F over D minor
  });
  it('dominant seventh → harmonic 7th, minor seventh chord → 16/9', () => {
    expect(justOffsetCents(65, [43, 59, 62])).toBeCloseTo(-31.2); // F over G B D
    expect(justOffsetCents(60, [50, 53, 57])).toBeCloseTo(-3.9); // C over D F A
  });
  it('no harmony → 0', () => expect(justOffsetCents(66, [])).toBe(0));
  it('chord guessing uses inversions', () => {
    expect(guessChord([64, 67, 72]).root).toBe(0); // C/E
    expect(guessChord([55, 59, 62, 65]).type).toBe('dom7');
  });
  it('scoreAttempt with tuning just uses the other parts', () => {
    const sop = makePart('S', [[66, 4]]);
    const alto = makePart('A', [[62, 4]]);
    const bass = makePart('B', [[50, 4]]);
    const c: ScoringContext = { score: makeScore([sop, alto, bass]), part: sop, range: [0, 0] };
    const justOpts: ScoringOptions = { ...opts, toleranceCents: 10, tuning: 'just' };
    const pure = scoreAttempt(c, sampleSinging(sop, (n) => n.midi - 0.137), justOpts);
    expect(pure.notes[0].targetOffset).toBeCloseTo(-13.7);
    expect(pure.notes[0].grade).toBe('perfect');
    // Tempered (what the backing plays) is accepted too: the target sits halfway, window widened.
    const tempered = scoreAttempt(c, sampleSinging(sop, (n) => n.midi), justOpts);
    expect(tempered.notes[0].cents).toBeCloseTo(13.7); // reported against the pure target
    expect(tempered.notes[0].grade).not.toBe('miss');
    // …but a third sung 25 cents sharp of tempered is still out.
    const sharp = scoreAttempt(c, sampleSinging(sop, (n) => n.midi + 0.25), justOpts);
    expect(sharp.notes[0].grade).toBe('miss');
  });
});

describe('vibrato', () => {
  const vib = (n: { midi: number }, t: number) => n.midi + 0.5 * Math.sin(2 * Math.PI * 5.5 * t);
  it('a centred ±50 cent vibrato is in tune', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, vib), opts);
    expect(r.counts.perfect + r.counts.good).toBe(8);
    expect(r.pitch).toBeGreaterThan(0.8);
  });
  it('without smoothing the same vibrato mostly misses', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, vib), { ...opts, vibratoWindow: 0 });
    expect(r.pitch).toBeLessThan(0.5);
  });
  it('a vibrato centred 40 cents flat is still out of tune', () => {
    const r = scoreAttempt(ctx, sampleSinging(melody, (n, t) => vib(n, t) - 0.4), opts);
    expect(r.counts.miss).toBe(8);
  });
});

describe('octave flips of the tracker', () => {
  // A♯4 on a nasal "on": the tracker reads part of the note an octave up (H2 much stronger than H1).
  const part = makePart('A', [[68, 1], [70, 1], [70, 1], [68, 1]], 120);
  const ctx: ScoringContext = { score: makeScore([part], 120), part, range: [0, 3] };
  const L1: ScoringOptions = { toleranceCents: 50, tuning: 'equal', octaveTolerant: false };
  const take = (inNote: (t: number) => number) => {
    const s = [];
    for (const n of part.notes) for (let t = n.start + 0.01; t < n.start + n.dur; t += 0.024) {
      s.push({ time: t, midi: n.midi + (n === part.notes[2] ? inNote((t - n.start) / n.dur) : 0), clarity: 0.95, rms: 0.1 });
    }
    return s;
  };

  it('readings an octave up between readings at the right pitch are the tracker, not a wrong octave', () => {
    const r = scoreAttempt(ctx, take((u) => (u > 0.25 && u < 0.65 ? 12 : 0.2)), L1);
    expect(r.notes[2].grade).toBe('perfect');
    expect(r.notes[2].octave).toBeUndefined();
    expect(r.insights.map((x) => x.kind)).not.toContain('octave');
  });

  it('a note sung an octave up all through is still a wrong octave', () => {
    const r = scoreAttempt(ctx, take(() => 12), L1);
    expect(r.notes[2].grade).toBe('miss');
    expect(r.notes[2].octave).toBe(true);
  });

  it('a voice that goes up the octave for the rest of the note is in the wrong octave', () => {
    const r = scoreAttempt(ctx, take((u) => (u > 0.35 ? 12 : 0)), L1);
    expect(r.notes[2].grade).not.toBe('perfect');
    expect(r.notes[2].octave).toBe(true);
    const down = scoreAttempt(ctx, take((u) => (u < 0.65 ? 12 : 0)), L1);
    expect(down.notes[2].grade).not.toBe('perfect');
  });

  it('readings heading for a leap of a fifth or a sixth up are not folded', () => {
    for (const leap of [7, 8, 9]) {
      const p = makePart('A', [[64, 1], [69, 1], [69 + leap, 1]], 120);
      const c: ScoringContext = { score: makeScore([p], 120), part: p, range: [0, 2] };
      const s = [];
      for (const n of p.notes) for (let t = n.start + 0.01; t < n.start + n.dur; t += 0.024) {
        const leaving = n === p.notes[1] && t > n.start + 0.85 * n.dur;
        s.push({ time: t, midi: leaving ? n.midi + leap : n.midi, clarity: 0.95, rms: 0.1 });
      }
      for (const tol of [25, 50]) expect(scoreAttempt(c, s, { ...L1, toleranceCents: tol }).notes[1].grade, `+${leap} at ${tol}¢`).toBe('perfect');
    }
  });

  it('only upward: readings an octave down stay wrong', () => {
    const r = scoreAttempt(ctx, take((u) => (u > 0.2 && u < 0.9 ? -12 : 0)), L1);
    expect(r.notes[2].grade).not.toBe('perfect');
  });
});
