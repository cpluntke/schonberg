// Level 1 (Notes, sung on "doo"), slow step: every note must be right (docs/LEVELS.md). Notes the
// scorer can't judge reliably (NoteResult.unsure) are forgiven below "good", unless the tracker
// clearly heard them wrong (NoteResult.clearly). In tempo: 80% and the entries on time.
import { beforeEach, describe, expect, it } from 'vitest';
import { SILENCE_RMS, TRACKER_HIGH_HZ, TRACKER_LOW_HZ, scoreAttempt, type ScoringContext } from '../game/scoring';
import { MAX_HZ, MIN_HZ, RMS_GATE } from '../audio/pitch';
import { makePart, makeScore, sampleSinging } from '../game/testutil';
import type { AttemptResult, Grade, NoteResult, ScoringOptions } from '../game/types';
import type { Section } from '../music/types';
import { attemptPasses, fullRunCounts, levelSpec, noteVerdict, passLabel, sectionChecks, sectionHeld, sectionRunCounts, speakerPractice, stepSpec, wrongNotes, nextStep } from './ladder';
import { _resetAllForTests, attemptLog, getProgress, recordAttempt, recordFullRun } from './store';

const L1: ScoringOptions = { toleranceCents: 50, tuning: 'equal', octaveTolerant: false };
const GV: Record<Grade, number> = { perfect: 1, good: 0.85, ok: 0.5, miss: 0 };

type N = Partial<NoteResult> & { grade: Grade };
/** A result with these notes (index = position), accuracy as the app computes it. */
function result(notes: N[]): AttemptResult {
  const ns = notes.map((n, index) => ({
    index, cents: 0, hitRatio: 1, voicedRatio: 1, onsetMs: 20, drift: null, scoop: null, targetOffset: 0, points: 0, ...n,
  })) as NoteResult[];
  const accuracy = ns.length ? ns.reduce((a, n) => a + GV[n.grade], 0) / ns.length : 0;
  return {
    accuracy, pitch: accuracy, rhythm: 1, score: Math.round(accuracy * 1000), maxCombo: 0,
    counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, notes: ns, perMeasure: {}, insights: [],
  };
}
const good = (k: number): N[] => Array.from({ length: k }, (_, i) => ({ grade: i % 3 ? 'perfect' : 'good' }));

beforeEach(() => { localStorage.clear(); _resetAllForTests(); });

const SLOW = { step: 'slow' as const };

describe('level 1: the rule', () => {
  it('level 1 is sung on "doo"; its slow step needs every note; the rest keep their percentage', () => {
    const every = (st: 'slow' | 'tempo') => [1, 2, 3, 4, 5].map((l) => stepSpec(l, st).everyNote);
    expect(every('slow')).toEqual([true, false, false, false, false]);
    expect(every('tempo')).toEqual([false, false, false, false, false]);
    expect([1, 2, 3, 4, 5].map((l) => levelSpec(l).doo)).toEqual([true, false, false, false, false]);
    expect(passLabel(stepSpec(1, 'slow'))).toBe('every note right');
    expect(passLabel(stepSpec(2, 'slow'))).toBe('80%');
    expect(levelSpec(1).description).toMatch(/doo/);
    expect(levelSpec(2).description).toMatch(/words/);
  });

  it('all notes right passes the slow step', () => {
    expect(attemptPasses(1, 'slow', result(good(12)))).toBe(true);
    expect(recordAttempt('p', 'S', 's0', 1, result(good(12)), undefined, undefined, SLOW))
      .toMatchObject({ passed: true, step: 'slow', newLevel: 0, prevSlow: 0, newSlow: 1, stepUp: true });
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 0, slow: 1 });
  });

  it('one flat note fails, however high the accuracy', () => {
    const r = result([...good(19), { grade: 'miss', cents: -70, hitRatio: 0 }]);
    expect(r.accuracy).toBeGreaterThan(0.85); // the old 75% rule would pass it
    expect(attemptPasses(1, 'slow', r)).toBe(false);
    expect(wrongNotes(r).map((n) => n.index)).toEqual([19]);
    expect(recordAttempt('p', 'S', 's0', 1, r, undefined, undefined, SLOW)).toMatchObject({ passed: false, newLevel: 0, newSlow: 0 });
    // In tempo the same run passes (80%), the entries aside.
    expect(attemptPasses(1, 'tempo', r)).toBe(true);
    // An "ok" note (partly in tune) isn't right either.
    expect(attemptPasses(1, 'slow', result([...good(19), { grade: 'ok', cents: -30, hitRatio: 0.4 }]))).toBe(false);
    // Level 2 keeps its percentage: one weak note in twenty is fine there.
    expect(attemptPasses(2, 'tempo', r)).toBe(true);
  });

  it('a short or unreliable note that is "ok" (or an unclear miss) is forgiven', () => {
    expect(noteVerdict({ grade: 'ok', unsure: 'short' })).toBe('forgiven');
    expect(noteVerdict({ grade: 'ok', unsure: 'range' })).toBe('forgiven');
    // Too few readings to say what was sung (no `clearly`): forgiven too.
    expect(noteVerdict({ grade: 'miss', unsure: 'short' })).toBe('forgiven');
    expect(noteVerdict({ grade: 'good', unsure: 'short' })).toBe('right');
    expect(noteVerdict({ grade: 'ok' })).toBe('wrong');
    expect(attemptPasses(1, 'slow', result([...good(10), { grade: 'ok', unsure: 'short', cents: 40, hitRatio: 0.4 }]))).toBe(true);
  });

  it('an exempt note the tracker clearly heard wrong fails', () => {
    expect(noteVerdict({ grade: 'miss', unsure: 'short', clearly: 'off' })).toBe('wrong');
    expect(noteVerdict({ grade: 'miss', unsure: 'short', clearly: 'silent' })).toBe('wrong');
    expect(attemptPasses(1, 'slow', result([...good(10), { grade: 'miss', unsure: 'short', clearly: 'off', cents: -100, hitRatio: 0 }]))).toBe(false);
  });

  it('the pass mark stays as a backstop: a run can’t pass on forgiven notes alone', () => {
    const r = result([...good(4), ...Array.from({ length: 6 }, () => ({ grade: 'miss' as Grade, unsure: 'short' as const }))]);
    expect(wrongNotes(r)).toEqual([]);
    expect(attemptPasses(1, 'slow', r)).toBe(false);
  });
});

describe('level 1: what the scorer can’t judge reliably', () => {
  // Quarter notes at 60 bpm, then a bar of 16ths at 150 bpm-equivalent (0.1 s), then quarters.
  const part = makePart('A', [[60, 1], [62, 1], [64, 0.1], [65, 0.1], [67, 0.1], [65, 0.1], [64, 1], [62, 1]], 60);
  const ctx: ScoringContext = { score: makeScore([part], 60), part, range: [0, part.notes.length - 1] };
  const score = (sing: (i: number, t: number) => number | null, period = 0.01): AttemptResult =>
    scoreAttempt(ctx, sampleSinging(part, (n, t, i) => sing(i, t), period), L1);

  it('very short notes are flagged "short"; long notes are judged as usual', () => {
    const r = score((i) => part.notes[i].midi);
    expect(r.notes.map((n) => n.unsure ?? null)).toEqual([null, null, 'short', 'short', 'short', 'short', null, null]);
    expect(r.notes.every((n) => n.grade === 'perfect' || n.grade === 'good')).toBe(true);
    expect(attemptPasses(1, 'slow', r)).toBe(true);
  });

  it('a short note sung a semitone off, heard clearly: a clear miss that fails level 1', () => {
    const r = score((i) => part.notes[i].midi + (i === 4 ? -1 : 0));
    expect(r.notes[4]).toMatchObject({ grade: 'miss', unsure: 'short', clearly: 'off' });
    expect(wrongNotes(r).map((n) => n.index)).toEqual([4]);
    expect(attemptPasses(1, 'slow', r)).toBe(false);
  });

  it('a short note read wildly off (a tracker subharmonic, −27 semitones) is not a clear miss', () => {
    const r = score((i) => part.notes[i].midi + (i === 4 ? -27.2 : 0));
    expect(r.notes[4]).toMatchObject({ grade: 'miss', unsure: 'short' });
    expect(r.notes[4].clearly).toBeUndefined();
    expect(noteVerdict(r.notes[4])).toBe('forgiven');
  });

  it('a short note with no voice at all is "not sung", not forgiven', () => {
    const r = score((i) => (i === 3 ? null : part.notes[i].midi));
    expect(r.notes[3]).toMatchObject({ grade: 'miss', unsure: 'short', clearly: 'silent' });
    expect(attemptPasses(1, 'slow', r)).toBe(false);
  });

  it('a short note the tracker barely caught (one reading) is forgiven', () => {
    // One reading in the middle of the note, a semitone off: too little to say what was sung.
    const r = score((i, t) => (i === 5 ? (Math.abs(t - 0.05) < 0.006 ? part.notes[i].midi + 1 : null) : part.notes[i].midi));
    expect(r.notes[5].unsure).toBe('short');
    expect(r.notes[5].grade === 'perfect' || r.notes[5].grade === 'good').toBe(false);
    expect(r.notes[5].clearly).toBeUndefined();
    expect(noteVerdict(r.notes[5])).toBe('forgiven');
    expect(attemptPasses(1, 'slow', r)).toBe(true);
  });

  it('a long note sung flat is never forgiven', () => {
    const r = score((i) => part.notes[i].midi + (i === 6 ? -0.7 : 0));
    expect(r.notes[6].unsure).toBeUndefined();
    expect(noteVerdict(r.notes[6])).toBe('wrong');
    expect(attemptPasses(1, 'slow', r)).toBe(false);
  });

  it('a written note outside the tracker’s range (60–1400 Hz) is flagged "range"', () => {
    expect([TRACKER_LOW_HZ, TRACKER_HIGH_HZ]).toEqual([MIN_HZ, MAX_HZ]);
    const deep = makePart('B', [[33, 1], [45, 1]], 60); // A1 (55 Hz), A2
    const c: ScoringContext = { score: makeScore([deep], 60), part: deep, range: [0, 1] };
    expect(SILENCE_RMS).toBe(RMS_GATE);
    // Sung (there is sound), but the tracker can't read a pitch that low: forgiven.
    const heard = sampleSinging(deep, () => null).map((x) => (x.time < 1 ? { ...x, rms: 0.08, clarity: 0.4 } : x));
    const r = scoreAttempt(c, heard, L1);
    expect(r.notes.map((n) => n.unsure ?? null)).toEqual(['range', null]);
    expect(r.notes[0].clearly).toBeUndefined();
    expect(r.notes.map(noteVerdict)).toEqual(['forgiven', 'wrong']);
    // Not sung at all (silence): that fails, like any note not sung.
    const silent = scoreAttempt(c, sampleSinging(deep, () => null), L1);
    expect(silent.notes[0]).toMatchObject({ unsure: 'range', clearly: 'silent' });
    expect(noteVerdict(silent.notes[0])).toBe('wrong');
  });

  it('a note tied over the end of the section is judged on the part before the end', () => {
    // The last note (4 beats) runs 2 s past the section's end at 6 s; playback and listening stop there.
    const tied = makePart('A', [[60, 2], [62, 2], [64, 4]], 60);
    const sc = makeScore([tied], 60);
    const sung = sampleSinging(tied, (n, t) => (n.start + t < 6.1 ? n.midi : null));
    const whole = scoreAttempt({ score: sc, part: tied, range: [0, 2] }, sung, L1);
    const cut = scoreAttempt({ score: sc, part: tied, range: [0, 2], end: 6 }, sung, L1);
    expect(noteVerdict(whole.notes[2])).toBe('wrong'); // judged on all 4 beats, half of which can't be heard
    expect(noteVerdict(cut.notes[2])).toBe('right');
    expect(attemptPasses(1, 'slow', cut)).toBe(true);
  });

  it('a low note the tracker reads (partly) an octave up is let off; an octave down or a wrong note is not', () => {
    // E3 (165 Hz) held for 2 s: on "oo" the tracker sometimes locks onto the second partial.
    const low = makePart('B', [[48, 1], [52, 2], [48, 1]], 60);
    const lc: ScoringContext = { score: makeScore([low], 60), part: low, range: [0, 2] };
    const sung = (f: (t: number) => number) => sampleSinging(low, (n, t, i) => n.midi + (i === 1 ? f(t) : 0));
    // Flips between readings at the right pitch are folded down (foldOctaveFlips): simply right.
    const flips = scoreAttempt(lc, sung((t) => (Math.floor(t / 0.1) % 3 === 1 ? 12 : 0)), L1);
    expect(noteVerdict(flips.notes[1])).toBe('right');
    expect(flips.notes[1].octave).toBeUndefined();
    // Mostly an octave up with a few right readings: not folded, but let off on a low note.
    const mostlyUp = scoreAttempt(lc, sung((t) => (Math.floor(t / 0.1) % 5 === 1 ? 0 : 12)), L1);
    expect(mostlyUp.notes[1].unsure).toBe('octave');
    expect(noteVerdict(mostlyUp.notes[1])).toBe('forgiven');
    const allUp = scoreAttempt(lc, sung(() => 12), L1);
    expect(noteVerdict(allUp.notes[1])).toBe('forgiven');
    // An octave down is never folded; a wrong note isn't either (also with octave-up flips).
    expect(noteVerdict(scoreAttempt(lc, sung(() => -12), L1).notes[1])).toBe('wrong');
    expect(noteVerdict(scoreAttempt(lc, sung((t) => (Math.floor(t / 0.1) % 3 === 1 ? -12 : 0)), L1).notes[1])).toBe('wrong');
    expect(noteVerdict(scoreAttempt(lc, sung((t) => (Math.floor(t / 0.1) % 3 === 1 ? 13 : 1)), L1).notes[1])).toBe('wrong');
    // A higher note (A4, 440 Hz) read an octave up is a wrong octave, not let off.
    const high = makePart('A', [[64, 1], [69, 2], [64, 1]], 60);
    const hc: ScoringContext = { score: makeScore([high], 60), part: high, range: [0, 2] };
    const hr = scoreAttempt(hc, sampleSinging(high, (n, t, i) => n.midi + (i === 1 ? 12 : 0)), L1);
    expect(hr.notes[1].unsure).toBeUndefined();
    expect(noteVerdict(hr.notes[1])).toBe('wrong');
  });

  it('only subharmonic readings (19–46 semitones low) count as tracker errors, not a fifth or a sixth off', () => {
    // A2 → A4 → A2 at 60 bpm, the A4 held 2 s; its last 40% sung off, or a burst read deep under it.
    const p = makePart('S', [[57, 1], [69, 2], [57, 1]], 60);
    const pc: ScoringContext = { score: makeScore([p], 60), part: p, range: [0, 2] };
    const take = (f: (t: number) => number) => scoreAttempt(pc, sampleSinging(p, (n, t, i) => n.midi + (i === 1 ? f(t) : 0)), L1);
    for (const off of [-7, 7, 9, -9]) {
      const r = take((t) => (t > 1.2 ? off : 0));
      expect(noteVerdict(r.notes[1]), `last 40% ${off} semitones off`).toBe('wrong');
      expect(r.notes[1].unsure).toBeUndefined();
    }
    // −19 semitones (×⅓) in bursts, a third of the readings: the tracker, let off.
    const sub = take((t) => (Math.floor(t / 0.1) % 3 === 1 ? -19.02 : 0));
    expect(sub.notes[1].unsure).toBe('tracker');
    expect(noteVerdict(sub.notes[1])).toBe('forgiven');
  });

  it('a very short note sung a fifth, a sixth or more than an octave off is a clear miss', () => {
    for (const off of [7, -7, 9, -9, 11, -11, 13]) {
      const r = score((i) => part.notes[i].midi + (i === 4 ? off : 0));
      expect(r.notes[4], `${off} semitones`).toMatchObject({ grade: 'miss', unsure: 'short', clearly: 'off' });
      expect(noteVerdict(r.notes[4]), `${off} semitones`).toBe('wrong');
    }
  });

  it('a very short note sung an octave low is a clear miss (an octave is sung; deeper is the tracker)', () => {
    const r = score((i) => part.notes[i].midi + (i === 4 ? -12 : 0));
    expect(r.notes[4]).toMatchObject({ grade: 'miss', unsure: 'short', clearly: 'off' });
    expect(noteVerdict(r.notes[4])).toBe('wrong');
    // An octave up on a written note above 200 Hz: also sung, also wrong.
    const up = score((i) => part.notes[i].midi + (i === 4 ? 12 : 0));
    expect(noteVerdict(up.notes[4])).toBe('wrong');
  });

  it('a short low note read an octave up and a little sharp is still let off (the tracker, not the singer)', () => {
    // A bass line below 200 Hz: the tracker's octave error on "oo" can come with the note sung a bit sharp.
    const low = makePart('B', [[43, 1], [45, 1], [47, 0.1], [48, 0.1], [50, 0.1], [48, 0.1], [47, 1], [45, 1]], 60);
    const lctx: ScoringContext = { score: makeScore([low], 60), part: low, range: [0, low.notes.length - 1] };
    for (const cents of [0, 40, 60, 70]) {
      const r = scoreAttempt(lctx, sampleSinging(low, (n, _t, i) => n.midi + (i === 4 ? 12 + cents / 100 : 0), 0.01), L1);
      expect(noteVerdict(r.notes[4]), `octave up +${cents}¢`).not.toBe('wrong');
    }
    // A clearly wrong note on the same short low note still fails.
    const r = scoreAttempt(lctx, sampleSinging(low, (n, _t, i) => n.midi + (i === 4 ? 7 : 0), 0.01), L1);
    expect(noteVerdict(r.notes[4])).toBe('wrong');
  });

  it('a "doo" on every note (a short unvoiced "d" before each vowel) still scores every note', () => {
    // 25 ms without voice at the start of every note (the "d"), the vowel on pitch after it.
    const r = score((i, t) => (t < 0.025 ? null : part.notes[i].midi));
    expect(r.notes.every((n) => noteVerdict(n) === 'right')).toBe(true);
    expect(r.notes.slice(0, 2).every((n) => n.onsetMs != null && n.onsetMs < 60)).toBe(true);
  });
});

describe('Level 1 in tempo: full runs (docs/LEVELS.md)', () => {
  // Three 8-second sections, eight notes each (note i starts at second i).
  const secs: Section[] = [0, 1, 2].map((i) => ({
    id: `s${i}`, index: i, label: `Bars ${i * 4 + 1}–${i * 4 + 4}`, startMeasure: i * 4, endMeasure: i * 4 + 3, start: i * 8, end: i * 8 + 8,
  }));
  const noteStart = (i: number) => (i >= 0 && i < 24 ? i : undefined);

  it('each passage is judged on 80%, not every note: one wrong note doesn’t make a passage slip', () => {
    const notes: N[] = good(24);
    notes[3] = { grade: 'miss', cents: -80, hitRatio: 0 }; // s0: a flat long note
    const r = recordFullRun('p', 'S', 1, result(notes), secs, noteStart, { counted: true });
    expect(r).toMatchObject({ opened: true, passed: true, clean: true, newLevel: 1, toFix: [] });
    expect(r.sections.map((x) => [x.id, x.passed])).toEqual([['s0', true], ['s1', true], ['s2', true]]);
    // Every passage is credited Level 1 in tempo (the slow step ticked with it).
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 1 });
    expect(getProgress('p', 'S')!.sections.s0.slow).toBeUndefined();
  });

  it('one passage below the mark: Level 1 is open, and fixing it in tempo (not slow) reaches it', () => {
    const notes: N[] = good(24);
    for (const k of [0, 1, 2, 3]) notes[k] = { grade: 'miss', hitRatio: 0 }; // s0 under 50%
    const r = recordFullRun('p', 'S', 1, result(notes), secs, noteStart, { counted: true });
    expect(r).toMatchObject({ opened: true, passed: false, clean: false, toFix: ['s0'] });
    const prog = getProgress('p', 'S')!;
    expect(prog.full?.toFix).toEqual({ 1: ['s0'] });
    expect(prog.full?.level).toBe(0);
    expect(prog.sections.s1.level).toBe(1);
    expect(nextStep(secs, prog)).toMatchObject({ sectionId: 's0', level: 1, step: 'tempo', kind: 'fix' });
    expect(nextStep(secs, prog)!.reason).toBe('Fix Bars 1–4 in tempo to reach Level 1 · Notes.');
    // A slow pass ticks the slow step but fixes nothing.
    expect(recordAttempt('p', 'S', 's0', 1, result(good(8)), undefined, undefined, SLOW)).toMatchObject({ passed: true, stepUp: true });
    expect(getProgress('p', 'S')!.full?.toFix).toEqual({ 1: ['s0'] });
    expect(getProgress('p', 'S')!.full?.level).toBe(0);
    // In tempo: piece level 1, no second run.
    const fix = recordAttempt('p', 'S', 's0', 1, result(good(8)), undefined, undefined, { step: 'tempo' });
    expect(fix).toMatchObject({ fixed: [{ level: 1, remaining: 0 }], reached: { level: 1, newLevel: 1 }, newLevel: 1 });
    expect(getProgress('p', 'S')!.full?.level).toBe(1);
  });

  it('grants piece level 1 only in one go, and only in tempo', () => {
    expect(recordFullRun('p', 'S', 1, result(good(24)), secs, noteStart, { counted: false }).passed).toBe(false);
    expect(getProgress('p', 'S')!.full?.level ?? 0).toBe(0);
    // A slow run of the whole piece is practice, even when the caller says it counted.
    const slow = recordFullRun('p', 'S', 1, result(good(24)), secs, noteStart, { counted: true, step: 'slow' });
    expect(slow).toMatchObject({ counted: false, opened: false, passed: false, newLevel: 0 });
    expect(getProgress('p', 'S')!.full?.level ?? 0).toBe(0);
    expect(getProgress('p', 'S')!.sections.s0?.level ?? 0).toBe(0);
    expect(attemptLog().slice(-1)[0]).toMatchObject({ sectionId: 'practice', level: 1, step: 'slow' });
    const r = recordFullRun('p', 'S', 1, result(good(24)), secs, noteStart, { counted: true });
    expect(r).toMatchObject({ counted: true, passed: true, clean: true, newLevel: 1, toFix: [] });
    expect(attemptLog().slice(-1)[0]).toMatchObject({ sectionId: 'all', level: 1, step: 'tempo', passed: true });
  });

  it('late entries fail the run like late timing: nothing opens', () => {
    const r = recordFullRun('p', 'S', 1, result(good(24)), secs, noteStart, { counted: true, entriesLate: true });
    expect(r).toMatchObject({ opened: false, passed: false, overallPassed: false, newLevel: 0 });
    expect(getProgress('p', 'S')!.sections.s0?.level ?? 0).toBe(0);
    // A section run with late entries fails too.
    expect(recordAttempt('p', 'S', 's0', 1, result(good(8)), undefined, undefined, { step: 'tempo', entriesLate: true }).passed).toBe(false);
    expect(recordAttempt('p', 'S', 's0', 1, result(good(8)), undefined, undefined, { step: 'tempo' })).toMatchObject({ passed: true, newLevel: 1 });
  });

  it('the short-section slack applies in tempo, not at the every-note slow step', () => {
    // A 3-note section with one "ok" note: one weak note of slack holds it in tempo, not at Level 1 slow.
    const short: Section[] = [{ id: 'a', index: 0, label: 'A', startMeasure: 0, endMeasure: 0, start: 0, end: 3 }];
    const r = result([{ grade: 'perfect' }, { grade: 'ok', hitRatio: 0.4, cents: 20 }, { grade: 'perfect' }]);
    const st = (i: number) => (i < 3 ? i : undefined);
    const c2 = sectionChecks(short, st, r, 2).a;
    const c1 = sectionChecks(short, st, r, 1).a;
    const c1slow = sectionChecks(short, st, r, 1, 'slow').a;
    expect(sectionHeld(2, c2)).toBe(true);
    expect(sectionHeld(1, c1)).toBe(true);
    expect(c1slow.checked).toBeCloseTo(r.accuracy);
    expect(c1slow.wrong).toEqual([1]);
    expect(sectionHeld(1, c1slow, 'slow')).toBe(false);
  });

  it('levels already earned are kept: a Level 1 run that slips never lowers anything', () => {
    recordFullRun('p', 'S', 2, result(good(24)), secs, noteStart, { counted: true });
    expect(getProgress('p', 'S')!.full?.level).toBe(2);
    const notes = good(24);
    for (const k of [0, 1, 2, 3]) notes[k] = { grade: 'miss', hitRatio: 0 };
    const r = recordFullRun('p', 'S', 1, result(notes), secs, noteStart, { counted: true });
    expect(r).toMatchObject({ passed: false, newLevel: 2, prevLevel: 2 });
    expect(getProgress('p', 'S')!.sections.s0.level).toBe(2);
    // A slow fail never lowers a section either.
    recordAttempt('p', 'S', 's0', 1, result([...good(7), { grade: 'miss', cents: 90, hitRatio: 0 }]), undefined, undefined, SLOW);
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 2 });
  });
});

describe('Level 1 slow needs headphones (docs/LEVELS.md)', () => {
  const run = { step: 'slow' as const, rate: 0.7, partial: false, timingUnsure: false, offBookPractice: false };

  it('only Level 1 slow asks; without headphones (or no answer) it is practice', () => {
    expect([1, 2, 3, 4, 5].map((l) => stepSpec(l, 'slow').headphones)).toEqual([true, false, false, false, false]);
    expect([1, 2, 3, 4, 5].map((l) => stepSpec(l, 'tempo').headphones)).toEqual([false, false, false, false, false]);
    expect(speakerPractice(1, 'slow', false)).toBe(true);
    expect(speakerPractice(1, 'slow', undefined)).toBe(true);
    expect(speakerPractice(1, 'slow', true)).toBe(false);
    expect(speakerPractice(1, 'tempo', false)).toBe(false);
    for (const l of [2, 3, 4, 5]) expect(speakerPractice(l, 'slow', false)).toBe(false);
    expect(sectionRunCounts({ ...run, level: 1, headphones: false })).toEqual({ counted: false, why: 'speaker' });
    expect(sectionRunCounts({ ...run, level: 1, headphones: true })).toEqual({ counted: true });
    expect(sectionRunCounts({ ...run, level: 1, step: 'tempo', rate: 1, headphones: false })).toEqual({ counted: true });
    expect(sectionRunCounts({ ...run, level: 2, headphones: false })).toEqual({ counted: true });
    // Full runs count in tempo only (no headphones needed); a slow one is practice whatever the answer.
    expect(fullRunCounts({ ...run, level: 1, resumed: false, headphones: true })).toEqual({ counted: false, why: 'slow' });
    expect(fullRunCounts({ ...run, level: 1, step: 'tempo', rate: 1, resumed: false, headphones: false })).toEqual({ counted: true });
    // A slower tempo or a stopped run says so first.
    expect(sectionRunCounts({ ...run, level: 1, rate: 0.6, headphones: false }).why).toBe('tempo');
  });

  it('a perfect slow run without headphones is practice: no slow step', () => {
    // As Play.tsx records it: a run that doesn't count goes to the 'practice' record.
    const c = sectionRunCounts({ ...run, level: 1, headphones: false });
    expect(c.counted).toBe(false);
    recordAttempt('p', 'S', c.counted ? 's0' : 'practice', 1, result(good(8)), undefined, undefined, SLOW);
    expect(getProgress('p', 'S')!.sections.s0).toBeUndefined();
    // With headphones the same run passes the slow step.
    expect(recordAttempt('p', 'S', 's0', 1, result(good(8)), undefined, undefined, SLOW)).toMatchObject({ passed: true, newLevel: 0, newSlow: 1 });
  });
});
