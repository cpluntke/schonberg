import { describe, it, expect } from 'vitest';
import type { Section } from '../music/types';
import {
  LEVELS, LISTEN, SLOW_RATE, levelSpec, stepSpec, stepLabel, stepFor, currentStep, passLabel, strictnessFactor, effectiveTolerance, pieceReadiness, nextStep,
  sectionStatus, targetForDate, pieceLevel, sectionAccuracies, fullRunCounts, fullRunDue, fixesBefore, sectionChecks, runOpensLevel,
  sectionRunCounts, speakerPractice, attemptPasses, entriesOnTime,
} from './ladder';
import type { FullRunProgress, PieceProgress, SectionProgress } from './store';

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 4, 12).getTime();
const secs: Section[] = [0, 1, 2, 3].map((i) => ({
  id: `s${i}`, index: i, label: `Bars ${i * 4 + 1}–${i * 4 + 4}`, startMeasure: i * 4, endMeasure: i * 4 + 3, start: i * 8, end: i * 8 + 8,
}));
function prog(levels: number[], extra: Record<string, Partial<SectionProgress>> = {}): PieceProgress {
  const sections: Record<string, SectionProgress> = {};
  levels.forEach((l, i) => {
    sections[`s${i}`] = { level: l, best: {}, attempts: l ? 1 : 0, lastPracticed: NOW - DAY, lastPassed: l ? NOW - DAY : undefined, ...extra[`s${i}`] };
  });
  return { pieceId: 'p', partId: 'S', sections, totalAttempts: 0, bestScore: 0 };
}
/** Progress with a full-run record (piece level). */
function withFull(p: PieceProgress, full: Partial<FullRunProgress>): PieceProgress {
  return { ...p, full: { level: 0, best: {}, attempts: 1, ...full } };
}

describe('ladder', () => {
  it('matches the progression table: every level adds one thing', () => {
    expect(LEVELS.map((l) => [l.level, l.name, l.guide, l.showNames, l.cue, l.doo])).toEqual([
      [1, 'Notes', true, true, 'note', true],
      [2, 'Words', true, true, 'note', false],
      [3, 'Alone', false, true, 'note', false],
      [4, 'Concert', false, false, 'chord', false],
      [5, 'By heart', false, false, 'chord', false],
    ]);
    expect(LISTEN.level).toBe(0);
    expect(levelSpec(3).name).toBe('Alone');
    expect(levelSpec(9).level).toBe(5);
  });
  it('stepSpec: every level has a slow step (70%) and an in-tempo step (100%)', () => {
    expect(SLOW_RATE).toBe(0.7);
    const row = (l: number, st: 'slow' | 'tempo') => {
      const x = stepSpec(l, st);
      return [x.rate, x.tolerance, x.pass, x.everyNote, x.headphones, x.entries];
    };
    // Level 1 slow: every note right, with headphones; in tempo: 80% and the entries on time.
    expect(row(1, 'slow')).toEqual([0.7, 50, 0.75, true, true, false]);
    expect(row(1, 'tempo')).toEqual([1, 50, 0.8, false, false, true]);
    for (const [l, tol, pass] of [[2, 35, 0.8], [3, 30, 0.8], [4, 25, 0.85], [5, 25, 0.85]]) {
      expect(row(l, 'slow')).toEqual([0.7, tol, pass, false, false, false]);
      expect(row(l, 'tempo')).toEqual([1, tol, pass, false, false, false]);
    }
    // The level's parts come along.
    expect(stepSpec(1, 'slow')).toMatchObject({ level: 1, name: 'Notes', doo: true, guide: true, cue: 'note', step: 'slow', label: 'Level 1 · Notes · slow' });
    expect(stepSpec(4, 'tempo')).toMatchObject({ showNames: false, cue: 'chord', label: 'Level 4 · Concert · in tempo' });
    expect(stepLabel(2, 'slow')).toBe('Level 2 · Words · slow');
    expect(stepLabel(2, 'tempo')).toBe('Level 2 · Words · in tempo');
    expect(stepSpec(0, 'tempo').level).toBe(1);
    expect(passLabel(stepSpec(1, 'slow'))).toBe('every note right');
    expect(passLabel(stepSpec(1, 'tempo'))).toBe('80%, entries on time');
    expect(passLabel(stepSpec(4, 'slow'))).toBe('85%');
  });
  it('currentStep / stepFor: slow first when a level is new, then in tempo', () => {
    expect(currentStep(undefined)).toEqual({ level: 1, step: 'slow' });
    expect(currentStep({ level: 0, slow: 1 })).toEqual({ level: 1, step: 'tempo' });
    expect(currentStep({ level: 1 })).toEqual({ level: 2, step: 'slow' });
    expect(currentStep({ level: 2, slow: 3 })).toEqual({ level: 3, step: 'tempo' });
    // A slow step passed further up counts for the levels below it too.
    expect(currentStep({ level: 0, slow: 3 })).toEqual({ level: 1, step: 'tempo' });
    expect(currentStep({ level: 4 })).toEqual({ level: 5, step: 'slow' });
    expect(currentStep({ level: 5 })).toEqual({ level: 5, step: 'tempo' });
    // Day 1 of level 5 in tempo: level 4, slow 5 → level 5 in tempo again.
    expect(currentStep({ level: 4, slow: 5 })).toEqual({ level: 5, step: 'tempo' });
    expect(stepFor({ level: 2 }, 1)).toBe('tempo'); // review
    expect(stepFor({ level: 2 }, 4)).toBe('slow');
    expect(stepFor({ level: 2, slow: 4 }, 4)).toBe('tempo');
  });
  it('attemptPasses, speakerPractice and sectionRunCounts follow the step', () => {
    const r = { accuracy: 0.9, notes: [{ index: 0, grade: 'perfect' }, { index: 1, grade: 'ok' }] } as never;
    expect(attemptPasses(1, 'slow', r)).toBe(false); // an "ok" note: not every note right
    expect(attemptPasses(1, 'tempo', r)).toBe(true); // 80%
    expect(attemptPasses(4, 'slow', { accuracy: 0.84, notes: [] })).toBe(false);
    expect(speakerPractice(1, 'slow', false)).toBe(true);
    expect(speakerPractice(1, 'slow', undefined)).toBe(true);
    expect(speakerPractice(1, 'tempo', false)).toBe(false);
    expect(speakerPractice(2, 'slow', false)).toBe(false);
    const ok = { level: 2, step: 'slow' as const, rate: 0.7, partial: false, timingUnsure: false, offBookPractice: false };
    expect(sectionRunCounts(ok)).toEqual({ counted: true });
    // "Practise slowly" below the step's tempo stays practice.
    expect(sectionRunCounts({ ...ok, rate: 0.5 }).why).toBe('tempo');
    expect(sectionRunCounts({ ...ok, step: 'tempo' }).why).toBe('tempo');
    expect(sectionRunCounts({ ...ok, step: 'tempo', rate: 1 }).counted).toBe(true);
    expect(sectionRunCounts({ ...ok, level: 1 }).why).toBe('speaker');
    expect(sectionRunCounts({ ...ok, level: 1, headphones: true }).counted).toBe(true);
    expect(sectionRunCounts({ ...ok, level: 1, step: 'tempo', rate: 1 }).counted).toBe(true);
  });
  it('entriesOnTime: every entry sung, on time on average', () => {
    // Notes 0–2 legato, a rest, notes 3–4, a rest, note 5.
    const part = [
      { start: 0, dur: 1 }, { start: 1, dur: 1 }, { start: 2, dur: 1 },
      { start: 4, dur: 1 }, { start: 5, dur: 1 },
      { start: 6.5, dur: 1 },
    ];
    const run = (on: (number | null)[]) => on.map((onsetMs, index) => ({ index, onsetMs }));
    // Entries: 0, 3 and 5 (after rests of 1 s and 0.5 s).
    expect(entriesOnTime(part, run([50, 400, 400, 100, 900, 60]))).toEqual({ ok: true, entries: 3, missed: 0, meanMs: 70 });
    // Late on average (> 180 ms).
    expect(entriesOnTime(part, run([200, 0, 0, 250, 0, 150]))).toMatchObject({ ok: false, meanMs: 200 });
    // Exactly LATE_MS is on time.
    expect(entriesOnTime(part, run([180, 0, 0, 180, 0, 180])).ok).toBe(true);
    // An entry not sung fails, however early the others.
    expect(entriesOnTime(part, run([0, 0, 0, null, 0, 0]))).toMatchObject({ ok: false, missed: 1 });
    // The first note of a run counts as an entry even mid-phrase (a section starting at note 1).
    expect(entriesOnTime(part, run([0, 600, 0, 0, 0, 0]).slice(1))).toMatchObject({ ok: false, entries: 3, meanMs: 200 });
    // Without a measured delay: the device delay the line-up found is taken off first.
    expect(entriesOnTime(part, run([300, 0, 0, 300, 0, 300]), 150)).toMatchObject({ ok: true, meanMs: 150 });
    expect(entriesOnTime(part, [])).toEqual({ ok: true, entries: 0, missed: 0, meanMs: null });
  });
  it('entriesOnTime: forgives what the scorer cannot judge; one entry gets more room', () => {
    const part = [
      { start: 0, dur: 1 }, { start: 1, dur: 1 }, { start: 2, dur: 1 },
      { start: 4, dur: 0.12 }, { start: 4.12, dur: 1 },
      { start: 6.5, dur: 1 },
    ];
    const n = (index: number, onsetMs: number | null, extra: object = {}) => ({ index, onsetMs, voicedRatio: 1, ...extra });
    // A short pickup the tracker couldn't judge (no onset, unsure, not clearly wrong) is left out.
    expect(entriesOnTime(part, [n(0, 40), n(1, 0), n(2, 0), n(3, null, { unsure: 'short' }), n(4, 0), n(5, 60)]))
      .toMatchObject({ ok: true, entries: 2, missed: 0 });
    // Sung but never in tune: not a missed entry (the accuracy judges the pitch).
    expect(entriesOnTime(part, [n(0, 40), n(1, 0), n(2, 0), n(3, null, { voicedRatio: 0.8 }), n(4, 0), n(5, 60)]))
      .toMatchObject({ ok: true, missed: 0, meanMs: 50 });
    // Clearly silent: missed, even when unsure.
    expect(entriesOnTime(part, [n(0, 40), n(3, null, { unsure: 'short', clearly: 'silent' }), n(5, 60)]))
      .toMatchObject({ ok: false, missed: 1 });
    // A passage without rests has one entry: up to 2 × LATE_MS late is still fine.
    expect(entriesOnTime(part, [n(0, 300), n(1, 0), n(2, 0)]).ok).toBe(true);
    expect(entriesOnTime(part, [n(0, 400), n(1, 0), n(2, 0)]).ok).toBe(false);
  });
  it('strictness scales tolerance', () => {
    expect(strictnessFactor('forgiving')).toBe(1.3);
    expect(effectiveTolerance(1, 'slow', 'forgiving')).toBe(65);
    expect(effectiveTolerance(1, 'tempo', 'forgiving')).toBe(65);
    expect(effectiveTolerance(2, 'slow', 'standard')).toBe(35);
    expect(effectiveTolerance(4, 'tempo', 'strict')).toBe(20);
  });
  it('readiness: ready only through the piece level (full runs)', () => {
    expect(pieceReadiness(secs, undefined)).toEqual({
      pct: 0, pieceLevel: 0, minLevel: 0, rehearsalReady: false, concertReady: false, memorised: false, memorisedSections: 0,
      unconfirmed: 0, toward: { level: 1, done: 0, total: 4 }, toFix: [], clean: [], offBookDays: 0,
    });
    // Section levels alone count half and never make the piece ready.
    const r = pieceReadiness(secs, prog([4, 3, 3, 2]));
    expect(r.pct).toBeCloseTo(6 / 16);
    expect(r.minLevel).toBe(2);
    expect(r.pieceLevel).toBe(0);
    expect(r.unconfirmed).toBe(2);
    expect(r.rehearsalReady).toBe(false);
    expect(pieceReadiness(secs, prog([3, 3, 4, 3])).rehearsalReady).toBe(false);
    expect(pieceReadiness(secs, prog([4, 4, 4, 4])).concertReady).toBe(false);
    // The piece level counts fully; sections above it half.
    const r3 = pieceReadiness(secs, withFull(prog([3, 3, 4, 3]), { level: 3 }));
    expect(r3).toMatchObject({ pieceLevel: 3, rehearsalReady: true, concertReady: false, unconfirmed: 0, toward: { level: 4, done: 1, total: 4 } });
    expect(r3.pct).toBeCloseTo((12 + 0.5) / 16);
    // An experienced singer who skipped the sections: the full run alone makes the piece ready.
    expect(pieceReadiness(secs, withFull(prog([0, 0, 0, 0]), { level: 4 }))).toMatchObject({ pct: 1, concertReady: true, minLevel: 0 });
    // Off book is memorisation on top: it doesn't push readiness past 100%.
    const m = pieceReadiness(secs, withFull(prog([5, 5, 4, 5]), { level: 4, offBookDays: ['2026-10-03'] }));
    expect(m.pct).toBe(1);
    expect(m.memorised).toBe(false);
    expect(m.memorisedSections).toBe(3);
    expect(m.offBookDays).toBe(1);
    expect(pieceReadiness(secs, withFull(prog([5, 5, 5, 5]), { level: 5 })).memorised).toBe(true);
    expect(pieceReadiness(secs, prog([5, 5, 5, 5])).memorised).toBe(false);
    expect(pieceReadiness([], undefined).pct).toBe(0);
  });
  it('piece level: from full runs; a single-section piece uses its section', () => {
    expect(pieceLevel(secs, prog([3, 3, 3, 3]))).toBe(0);
    expect(pieceLevel(secs, withFull(prog([1, 1, 1, 1]), { level: 3 }))).toBe(3);
    const one = secs.slice(0, 1);
    expect(pieceLevel(one, prog([3]))).toBe(3);
    expect(pieceReadiness(one, prog([3])).rehearsalReady).toBe(true);
    expect(nextStep(one, prog([3]), NOW)).toMatchObject({ sectionId: 's0', level: 4, kind: 'section' });
  });
  it('open fix lists come first in Next up: fixing them reaches the level', () => {
    const p = withFull(prog([3, 2, 3, 2]), { level: 2, toFix: { 3: ['s3', 's1'] }, toFixLocks: { 3: true } });
    expect(fixesBefore(secs, p, 3)).toEqual(['s1', 's3']);
    expect(fixesBefore(secs, p, 4)).toEqual([]);
    expect(pieceReadiness(secs, p).toFix).toEqual([{ level: 3, sectionIds: ['s1', 's3'] }]);
    const n = nextStep(secs, p, NOW)!;
    expect(n).toMatchObject({ sectionId: 's1', level: 3, step: 'tempo', kind: 'fix' });
    expect(n.reason).toBe('Fix Bars 5–8 in tempo to reach Level 3 · Alone. 1 more to fix after this one.');
    // Level 1: the notes.
    const l1 = withFull(prog([1, 0, 1, 1]), { toFix: { 1: ['s1'] }, toFixLocks: { 1: true } });
    // A list not from a run that opened its level (saved by an earlier version, unchecked) doesn't count.
    expect(pieceReadiness(secs, withFull(prog([1, 0, 1, 1]), { toFix: { 1: ['s1'] } })).toFix).toEqual([]);
    expect(nextStep(secs, l1, NOW)!.reason).toBe('Fix Bars 5–8 in tempo to reach Level 1 · Notes.');
    // Ids of other parts' sections are ignored.
    expect(fixesBefore(secs, withFull(prog([1, 1, 1, 1]), { toFix: { 2: ['x9'] } }), 2)).toEqual([]);
  });
  it('runOpensLevel: at most half of the sections slipped and within 10 points of the mark', () => {
    const o = (sections: number, slipped: number, accuracy = 0.8, level = 3) => runOpensLevel({ level, sections, slipped, accuracy });
    expect(o(4, 0)).toBe(true);
    expect(o(4, 2)).toBe(true);
    expect(o(4, 3)).toBe(false);
    expect(o(3, 1)).toBe(true);
    expect(o(3, 2)).toBe(false);
    expect(o(2, 1)).toBe(true);
    expect(o(0, 0)).toBe(false);
    // The floor: the in-tempo pass mark minus 10 points (levels 1–3: 70%; level 4: 75%).
    expect(o(4, 1, 0.7)).toBe(true);
    expect(o(4, 1, 0.69)).toBe(false);
    expect(o(4, 2, 0.48, 2)).toBe(false); // two of four not sung at all
    expect(o(4, 1, 0.7, 1)).toBe(true);
    expect(o(4, 1, 0.66, 1)).toBe(false);
    expect(o(4, 1, 0.74, 4)).toBe(false);
    // A list naming more than half the sections never counts, marked or not.
    const p = withFull(prog([0, 0, 0, 0]), { level: 0, toFix: { 3: ['s0', 's1', 's2', 's3'], 5: ['s0', 's1'] }, toFixLocks: { 3: true, 5: true } });
    expect(fixesBefore(secs, p, 3)).toEqual([]);
    expect(pieceReadiness(secs, p).toFix).toEqual([{ level: 5, sectionIds: ['s0', 's1'] }]);
    // Stars by level.
    expect(pieceReadiness(secs, withFull(prog([2, 2, 2, 2]), { level: 2, clean: [2, 1, 9] })).clean).toEqual([1, 2]);
  });
  it('nextStep: after the whole piece from memory on day 1, day 2 is the full run again', () => {
    const p = withFull(prog([4, 4, 4, 4], { s0: { offBookDays: ['2026-10-03'] } }), { level: 4, offBookDays: ['2026-10-03'] });
    expect(nextStep(secs, p, NOW)).toMatchObject({ sectionId: 'all', level: 5, kind: 'full', reason: expect.stringMatching(/day 2 of 2/) });
  });
  it('sectionChecks: short sections get one weak note of slack (as "good"), never a pass without a real score', () => {
    const starts = [0, 1, 9, 10, 11, 12, 13, 14, 15, 16, 25];
    const res = { notes: [
      { index: 0, grade: 'perfect' }, { index: 1, grade: 'ok' }, // s0: 2 notes, 0.75 → checked (1 + 0.85) / 2
      ...[2, 3, 4, 5, 6, 7, 8].map((index) => ({ index, grade: 'perfect' })), // s1: 7 notes
      { index: 9, grade: 'ok' }, // s2: a single note sung "ok" counts as good
      { index: 10, grade: 'miss' }, // s3: a single missed note
    ] } as never;
    const c = sectionChecks(secs, (i) => starts[i], res);
    expect(c.s0.accuracy).toBeCloseTo(0.75);
    expect(c.s0.checked).toBeCloseTo(0.925);
    expect(c.s1.notes).toBe(7);
    expect(c.s2.checked).toBeCloseTo(0.85);
    expect(c.s3.checked).toBe(0);
    const two = sectionChecks(secs, (i) => [0, 1][i], { notes: [{ index: 0, grade: 'miss' }, { index: 1, grade: 'ok' }] } as never);
    expect(two.s0.checked).toBe(0.25); // under 50%: no slack
    // A missed note is never forgiven: perfect + miss = 50% stays 50%.
    const miss = sectionChecks(secs, (i) => [0, 1][i], { notes: [{ index: 0, grade: 'perfect' }, { index: 1, grade: 'miss' }] } as never);
    expect(miss.s0.checked).toBe(0.5);
    expect(fullRunCounts({ level: 3, step: 'tempo', rate: 1, partial: false, resumed: false, timingUnsure: false, offBookPractice: false, arcade: true }).why).toBe('arcade');
  });
  it('sectionAccuracies: each section scored within one run', () => {
    const starts = [0, 2, 9, 10, 17, 40];
    const res = { notes: [
      { index: 0, grade: 'perfect' }, { index: 1, grade: 'miss' }, // s0: 0.5
      { index: 2, grade: 'good' }, { index: 3, grade: 'good' }, // s1: 0.85
      { index: 4, grade: 'perfect' }, // s2: 1
      { index: 5, grade: 'ok' }, // outside every section
    ] } as never;
    const a = sectionAccuracies(secs, (i) => starts[i], res);
    expect(a.s0).toBeCloseTo(0.5);
    expect(a.s1).toBeCloseTo(0.85);
    expect(a.s2).toBe(1);
    expect(a.s3).toBeUndefined();
  });
  it('fullRunCounts: in tempo, one go, full tempo, no peeking', () => {
    const ok = { level: 3, step: 'tempo' as const, rate: 1, partial: false, resumed: false, timingUnsure: false, offBookPractice: false };
    expect(fullRunCounts(ok)).toEqual({ counted: true });
    expect(fullRunCounts({ ...ok, partial: true }).why).toBe('stopped');
    expect(fullRunCounts({ ...ok, resumed: true }).why).toBe('paused');
    // A slow run of the whole piece is practice, at any level.
    expect(fullRunCounts({ ...ok, step: 'slow', rate: 0.7 }).why).toBe('slow');
    expect(fullRunCounts({ ...ok, level: 1, step: 'slow', rate: 0.7, headphones: true }).why).toBe('slow');
    expect(fullRunCounts({ ...ok, level: 1, rate: 0.7 }).why).toBe('tempo');
    // Level 1 in tempo needs no headphones.
    expect(fullRunCounts({ ...ok, level: 1 }).counted).toBe(true);
    expect(fullRunCounts({ ...ok, level: 5, offBookPractice: true }).why).toBe('offbook');
    expect(fullRunCounts({ ...ok, timingUnsure: true }).why).toBe('timing');
  });
  it('nextStep: sections first, the full run once every section is above the piece level', () => {
    expect(nextStep(secs, undefined, NOW)).toMatchObject({ sectionId: 's0', level: 1, step: 'slow', kind: 'section' });
    expect(nextStep(secs, undefined, NOW)!.reason).toBe('Bars 1–4: Level 1 · Notes · slow. Learn the notes on “doo”.');
    expect(nextStep(secs, prog([2, 0, 3, 1]), NOW)).toMatchObject({ sectionId: 's1', level: 1, step: 'slow' });
    expect(nextStep(secs, prog([2, 0, 3, 1]), NOW)!.reason).toBe('Bars 5–8: Level 1 · Notes · slow. Last passage at Level 1.');
    // Its slow step done: the same level in tempo.
    const half = nextStep(secs, prog([2, 0, 3, 1], { s1: { slow: 1 } }), NOW)!;
    expect(half).toMatchObject({ sectionId: 's1', level: 1, step: 'tempo' });
    expect(half.reason).toBe('Bars 5–8: Level 1 · Notes · in tempo. Slow is done: now in tempo.');
    // A slow pass alone never confirms a level: still the section, not the full run.
    expect(nextStep(secs, prog([1, 0, 1, 1], { s1: { slow: 1 } }), NOW)).toMatchObject({ sectionId: 's1', level: 1, step: 'tempo' });
    // One new thing at a time for the whole piece: a passage still on slow comes before one whose
    // slow step is done (the designs' "Last passage slow").
    const mid = nextStep(secs, prog([1, 0, 0, 0], { s1: { slow: 1 }, s2: { slow: 1 } }), NOW)!;
    expect(mid).toMatchObject({ sectionId: 's3', level: 1, step: 'slow' });
    expect(mid.reason).toBe('Bars 13–16: Level 1 · Notes · slow. Last passage to sing slow.');
    expect(nextStep(secs, prog([1, 0, 0, 0], { s1: { slow: 1 }, s2: { slow: 1 }, s3: { slow: 1 } }), NOW)).toMatchObject({ sectionId: 's1', step: 'tempo' });
    // Every section at level ≥ 1, piece level 0: confirm level 1 with a full run.
    expect(nextStep(secs, prog([2, 1, 3, 1]), NOW)).toMatchObject({ sectionId: 'all', level: 1, kind: 'full' });
    expect(nextStep(secs, withFull(prog([2, 1, 3, 1]), { level: 1 }), NOW)).toMatchObject({ sectionId: 's1', level: 2, step: 'slow' });
    expect(nextStep(secs, withFull(prog([4, 4, 4, 3]), { level: 3 }), NOW)).toMatchObject({ sectionId: 's3', level: 4 });
    // Migration: level 3 everywhere from before piece levels → confirm with a full run.
    const m = nextStep(secs, prog([3, 3, 4, 3]), NOW)!;
    expect(m).toMatchObject({ sectionId: 'all', level: 3, step: 'tempo', kind: 'full' });
    expect(m.reason).toBe('Level 3 in every passage: confirm it with a full run-through.');
    expect(nextStep(secs, withFull(prog([4, 4, 4, 4]), { level: 4 }), NOW)).toMatchObject({ sectionId: 's0', level: 5, step: 'slow' });
    expect(nextStep(secs, withFull(prog([5, 5, 5, 5]), { level: 4 }), NOW)).toMatchObject({ sectionId: 'all', level: 5 });
    expect(nextStep(secs, withFull(prog([5, 5, 5, 5]), { level: 5 }), NOW)).toBeNull();
  });
  it('nextStep: the full run from memory waits for a second day', () => {
    const today = '2026-10-04';
    const p = withFull(prog([5, 5, 5, 5]), { level: 4, offBookDays: [today] });
    expect(nextStep(secs, p, NOW)).toBeNull();
    const y = withFull(prog([5, 5, 5, 5]), { level: 4, offBookDays: ['2026-10-03'] });
    expect(nextStep(secs, y, NOW)!.reason).toMatch(/day 2 of 2/);
  });
  it('nextStep: a stale full run is reviewed as a whole', () => {
    const p = withFull(prog([3, 3, 3, 3]), { level: 3, lastPassed: NOW - 9 * DAY });
    expect(fullRunDue(secs, p, NOW)).toBe(true);
    expect(nextStep(secs, p, NOW)).toMatchObject({ sectionId: 'all', level: 3, kind: 'review' });
    expect(fullRunDue(secs, withFull(prog([3, 3, 3, 3]), { level: 3, lastPassed: NOW - 2 * DAY }), NOW)).toBe(false);
    expect(fullRunDue(secs, withFull(prog([2, 2, 2, 2]), { level: 2, lastPassed: NOW - 20 * DAY }), NOW)).toBe(false);
  });
  it('nextStep: due review first, most overdue, at current level', () => {
    const p = prog([4, 1, 3, 4], {
      s0: { lastPassed: NOW - 9 * DAY }, s2: { lastPassed: NOW - 12 * DAY }, s3: { lastPassed: NOW - 2 * DAY },
    });
    const n = nextStep(secs, p, NOW)!;
    expect(n.sectionId).toBe('s2');
    expect(n.level).toBe(3);
    expect(n.reason).toMatch(/Review/);
    const done = prog([4, 4, 4, 4], { s1: { lastPassed: NOW - 8 * DAY } });
    expect(nextStep(secs, done, NOW)).toMatchObject({ sectionId: 's1', level: 4 });
  });
  it('sectionStatus', () => {
    expect(sectionStatus(undefined, NOW)).toBe('new');
    expect(sectionStatus({ level: 0, best: {}, attempts: 0 }, NOW)).toBe('new');
    expect(sectionStatus({ level: 0, best: {}, attempts: 2, lastPracticed: NOW }, NOW)).toBe('learning');
    expect(sectionStatus({ level: 2, best: {}, attempts: 2, lastPassed: NOW - 20 * DAY }, NOW)).toBe('learning');
    expect(sectionStatus({ level: 3, best: {}, attempts: 2, lastPassed: NOW - DAY }, NOW)).toBe('passed');
    expect(sectionStatus({ level: 3, best: {}, attempts: 2, lastPassed: NOW - 8 * DAY }, NOW)).toBe('due');
  });
  it('targetForDate', () => {
    const p = prog([3, 1, 2, 0]);
    expect(targetForDate(secs, p, { rehearsalDate: '2026-10-07' }, NOW)).toBe(
      'Rehearsal in 3 days: get 3 more passages to Level 3 · Alone (about 1 a day), then sing it all through at that level');
    // Counts passages not yet at the level in tempo: a slow step alone doesn't count.
    expect(targetForDate(secs, prog([3, 2, 2, 3], { s1: { slow: 3 }, s2: { slow: 3 } }), { rehearsalDate: '2026-10-06' }, NOW)).toBe(
      'Rehearsal in 2 days: get 2 more passages to Level 3 · Alone (about 1 a day), then sing it all through at that level');
    expect(targetForDate(secs, prog([3, 3, 3, 3]), { rehearsalDate: '2026-10-07' }, NOW)).toBe(
      'Rehearsal in 3 days: sing the whole piece through at Level 3 · Alone');
    expect(targetForDate(secs, withFull(prog([3, 3, 3, 3]), { level: 3 }), { rehearsalDate: '2026-10-07', concertDate: '2026-10-05' }, NOW)).toBe(
      'Concert tomorrow: get 4 more passages to Level 4 · Concert, then sing it all through at that level');
    expect(targetForDate(secs, p, { rehearsalDate: '2026-10-01' }, NOW)).toBeNull();
    expect(targetForDate(secs, p, {}, NOW)).toBeNull();
  });
  it('nextStep: Level 2 slow offers the words in rhythm first while they are not passed', () => {
    const p = withFull(prog([1, 1, 1, 1]), { level: 1 });
    const words = (passed: string[]) => (id: string) => (id === 's3' ? null : passed.includes(id));
    expect(nextStep(secs, p, NOW, words([]))).toMatchObject({ sectionId: 's0', level: 2, step: 'slow', wordsFirst: true });
    expect(nextStep(secs, p, NOW, words(['s0']))!.wordsFirst).toBeUndefined();
    expect(nextStep(secs, p, NOW)!.wordsFirst).toBeUndefined();
    // Not in tempo, and not for a passage without words.
    const allSlow2 = { s0: { slow: 2 }, s1: { slow: 2 }, s2: { slow: 2 }, s3: { slow: 2 } };
    expect(nextStep(secs, withFull(prog([1, 1, 1, 1], allSlow2), { level: 1 }), NOW, words([]))).toMatchObject({ sectionId: 's0', step: 'tempo' });
    expect(nextStep(secs, withFull(prog([1, 1, 1, 1], allSlow2), { level: 1 }), NOW, words([]))!.wordsFirst).toBeUndefined();
    expect(nextStep(secs, withFull(prog([2, 2, 2, 1]), { level: 1 }), NOW, words([]))).toMatchObject({ sectionId: 's3', level: 2 });
    expect(nextStep(secs, withFull(prog([2, 2, 2, 1]), { level: 1 }), NOW, words([]))!.wordsFirst).toBeUndefined();
  });
  it('nextStep: fixes, reviews and full runs are always in tempo', () => {
    expect(nextStep(secs, withFull(prog([3, 3, 3, 3]), { level: 3, lastPassed: NOW - 9 * DAY }), NOW)).toMatchObject({ kind: 'review', step: 'tempo' });
    expect(nextStep(secs, prog([4, 1, 3, 4], { s2: { lastPassed: NOW - 12 * DAY } }), NOW)).toMatchObject({ kind: 'review', sectionId: 's2', step: 'tempo' });
    expect(nextStep(secs, withFull(prog([5, 5, 5, 5]), { level: 4 }), NOW)).toMatchObject({ kind: 'full', step: 'tempo' });
  });
});
