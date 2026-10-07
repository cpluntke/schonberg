import { describe, it, expect } from 'vitest';
import type { Section } from '../music/types';
import {
  LEVELS, LISTEN, levelSpec, strictnessFactor, effectiveTolerance, pieceReadiness, nextStep,
  sectionStatus, targetForDate, pieceLevel, sectionAccuracies, fullRunCounts, fullRunDue, fixesBefore, sectionChecks, runOpensLevel,
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
  it('matches the progression table', () => {
    expect(LEVELS.map((l) => [l.level, l.name, l.rate, l.guide, l.showNames, l.cue, l.tolerance, l.pass])).toEqual([
      [1, 'Note-learning', 0.7, true, true, 'note', 50, 0.75],
      [2, 'In time', 1.0, true, true, 'note', 35, 0.8],
      [3, 'Independent', 1.0, false, true, 'note', 30, 0.8],
      [4, 'Concert-ready', 1.0, false, false, 'chord', 25, 0.85],
      [5, 'Off book', 1.0, false, false, 'chord', 25, 0.85],
    ]);
    expect(LISTEN.level).toBe(0);
    expect(levelSpec(3).name).toBe('Independent');
    expect(levelSpec(9).level).toBe(5);
  });
  it('strictness scales tolerance', () => {
    expect(strictnessFactor('forgiving')).toBe(1.3);
    expect(effectiveTolerance(1, 'forgiving')).toBe(65);
    expect(effectiveTolerance(2, 'standard')).toBe(35);
    expect(effectiveTolerance(4, 'strict')).toBe(20);
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
    expect(n).toMatchObject({ sectionId: 's1', level: 3, kind: 'fix' });
    expect(n.reason).toBe('Fix Bars 5–8 at level 3 to reach level 3. 1 more to fix after this one.');
    // Level 1: the notes.
    const l1 = withFull(prog([1, 0, 1, 1]), { toFix: { 1: ['s1'] }, toFixLocks: { 1: true } });
    // A list not from a run that opened its level (saved by an earlier version, unchecked) doesn't count.
    expect(pieceReadiness(secs, withFull(prog([1, 0, 1, 1]), { toFix: { 1: ['s1'] } })).toFix).toEqual([]);
    expect(nextStep(secs, l1, NOW)!.reason).toBe('Fix Bars 5–8 at level 1 to reach level 1.');
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
    // The floor: the pass mark minus 10 points (level 3: 70%; level 1: 65%; level 4: 75%).
    expect(o(4, 1, 0.7)).toBe(true);
    expect(o(4, 1, 0.69)).toBe(false);
    expect(o(4, 2, 0.48, 2)).toBe(false); // two of four not sung at all
    expect(o(4, 1, 0.66, 1)).toBe(true);
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
    expect(fullRunCounts({ level: 3, rate: 1, partial: false, resumed: false, timingUnsure: false, offBookPractice: false, arcade: true }).why).toBe('arcade');
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
  it('fullRunCounts: one go, full tempo, no peeking', () => {
    const ok = { level: 3, rate: 1, partial: false, resumed: false, timingUnsure: false, offBookPractice: false };
    expect(fullRunCounts(ok)).toEqual({ counted: true });
    expect(fullRunCounts({ ...ok, partial: true }).why).toBe('stopped');
    expect(fullRunCounts({ ...ok, resumed: true }).why).toBe('paused');
    expect(fullRunCounts({ ...ok, level: 1, rate: 0.6 }).why).toBe('tempo');
    expect(fullRunCounts({ ...ok, level: 1, rate: 0.7, headphones: true }).counted).toBe(true);
    expect(fullRunCounts({ ...ok, level: 1, rate: 0.7 }).why).toBe('speaker');
    expect(fullRunCounts({ ...ok, level: 5, offBookPractice: true }).why).toBe('offbook');
    expect(fullRunCounts({ ...ok, timingUnsure: true }).why).toBe('timing');
  });
  it('nextStep: sections first, the full run once every section is above the piece level', () => {
    expect(nextStep(secs, undefined, NOW)).toMatchObject({ sectionId: 's0', level: 1, kind: 'section' });
    expect(nextStep(secs, prog([2, 0, 3, 1]), NOW)).toMatchObject({ sectionId: 's1', level: 1 });
    // Every section at level ≥ 1, piece level 0: confirm level 1 with a full run.
    expect(nextStep(secs, prog([2, 1, 3, 1]), NOW)).toMatchObject({ sectionId: 'all', level: 1, kind: 'full' });
    expect(nextStep(secs, withFull(prog([2, 1, 3, 1]), { level: 1 }), NOW)).toMatchObject({ sectionId: 's1', level: 2 });
    expect(nextStep(secs, withFull(prog([4, 4, 4, 3]), { level: 3 }), NOW)).toMatchObject({ sectionId: 's3', level: 4 });
    // Migration: level 3 everywhere from before piece levels → confirm with a full run.
    const m = nextStep(secs, prog([3, 3, 4, 3]), NOW)!;
    expect(m).toMatchObject({ sectionId: 'all', level: 3, kind: 'full' });
    expect(m.reason).toBe('Level 3 in every section: confirm it with a full run-through.');
    expect(nextStep(secs, withFull(prog([4, 4, 4, 4]), { level: 4 }), NOW)).toMatchObject({ sectionId: 's0', level: 5 });
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
      'Rehearsal in 3 days: get 3 more sections to Independent (about 1 a day), then sing it all through at that level');
    expect(targetForDate(secs, prog([3, 3, 3, 3]), { rehearsalDate: '2026-10-07' }, NOW)).toBe(
      'Rehearsal in 3 days: sing the whole piece through at Independent (level 3)');
    expect(targetForDate(secs, withFull(prog([3, 3, 3, 3]), { level: 3 }), { rehearsalDate: '2026-10-07', concertDate: '2026-10-05' }, NOW)).toBe(
      'Concert tomorrow: get 4 more sections to Concert-ready, then sing it all through at that level');
    expect(targetForDate(secs, p, { rehearsalDate: '2026-10-01' }, NOW)).toBeNull();
    expect(targetForDate(secs, p, {}, NOW)).toBeNull();
  });
});
