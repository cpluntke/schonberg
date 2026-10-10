import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AttemptResult } from '../game/types';
import type { Section } from '../music/types';
import type { Score } from '../music/types';
import {
  _resetAllForTests, loadProfile, saveProfile, getProgress, recordAttempt, attemptLog, streakDays,
  dueForReview, practiceMinutes, loadCycle, saveCycle, exportBackup, importBackup, subscribe,
  personalBest, snapshotReadiness, readinessHistory, saveImportedScore, loadImportedScores,
  deleteImportedScore, LOG_CAP, DEFAULT_PROFILE, practiceDisplay, storageSaveFailed, onStorageSaveFailed,
  SCHEMA_VERSION, migrateToSteps, upgradeFullRuns, recordFullRun, logStep,
} from './store';
import { currentStep, pieceReadiness } from './ladder';

const DAY = 86_400_000;
const res = (accuracy: number, score = Math.round(accuracy * 1000)): AttemptResult => ({
  accuracy, pitch: accuracy, rhythm: accuracy, score, maxCombo: 0,
  counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, notes: [], perMeasure: {}, insights: [],
});
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

beforeEach(() => { localStorage.clear(); _resetAllForTests(); });

describe('practice display: sheet music by default', () => {
  const v1 = { ...DEFAULT_PROFILE, onboarded: true, displayMigrated: true };

  it('Automatic is sheet music at every level', () => {
    expect(practiceDisplay({}, 0)).toBe('score');
    expect(practiceDisplay({}, 3)).toBe('score');
    expect(practiceDisplay({}, 5)).toBe('score');
    expect(practiceDisplay({ display: 'highway' }, 1)).toBe('highway');
  });

  it('a highway set by the first migration (card never answered) goes back to Automatic, with a note', () => {
    recordAttempt('p', 'S', 'a', 1, res(0.9), 30);
    localStorage.setItem('sh:profile', JSON.stringify({ ...v1, display: 'highway', scoreViewNews: true }));
    const p = loadProfile();
    expect(p.display).toBeUndefined();
    expect(p.scoreDefaultNote).toBe(true);
    expect(p.scoreViewNews).toBeUndefined();
    expect(practiceDisplay(p, 4)).toBe('score');
    // Once only: picking the highway afterwards sticks.
    saveProfile({ ...p, display: 'highway', displayChosen: true, scoreDefaultNote: false });
    expect(loadProfile().display).toBe('highway');
  });

  it('a highway the singer chose stays (toggle, Settings or "No thanks" on the old card)', () => {
    recordAttempt('p', 'S', 'a', 3, res(0.9), 30);
    localStorage.setItem('sh:profile', JSON.stringify({ ...v1, display: 'highway', scoreViewNews: false }));
    expect(loadProfile()).toMatchObject({ display: 'highway', displayChosen: true });
    expect(loadProfile().scoreDefaultNote).toBeFalsy();
    _resetAllForTests();
    localStorage.clear();
    // A newer singer who picked the highway (no card ever) keeps it too.
    localStorage.setItem('sh:profile', JSON.stringify({ ...v1, display: 'highway' }));
    expect(loadProfile()).toMatchObject({ display: 'highway', displayChosen: true });
    _resetAllForTests();
    localStorage.clear();
    // Recorded as chosen: kept even with a stale card flag.
    localStorage.setItem('sh:profile', JSON.stringify({ ...v1, display: 'highway', displayChosen: true, scoreViewNews: true }));
    expect(loadProfile().display).toBe('highway');
  });

  it('singers who got the highway automatically (level 3+, or before the score view) get the note once', () => {
    recordAttempt('p', 'S', 'a', 3, res(0.9), 30);
    localStorage.setItem('sh:profile', JSON.stringify({ ...v1 }));
    expect(loadProfile()).toMatchObject({ scoreDefaultNote: true, scoreDefaultMigrated: true });
    expect(loadProfile().display).toBeUndefined();
    _resetAllForTests();
    localStorage.clear();
    // Practised before the score view existed (no migration yet).
    recordAttempt('p', 'S', 'a', 1, res(0.9), 30);
    localStorage.setItem('sh:profile', JSON.stringify({ ...DEFAULT_PROFILE, onboarded: true }));
    const p = loadProfile();
    expect(p.display).toBeUndefined();
    expect(p.scoreDefaultNote).toBe(true);
    expect(p.displayMigrated).toBe(true);
  });

  it('new singers and level 1-2 singers on Automatic just get sheet music, no note', () => {
    saveProfile({ ...DEFAULT_PROFILE, onboarded: true });
    const p = loadProfile();
    expect(p.display).toBeUndefined();
    expect(p.scoreDefaultNote).toBeFalsy();
    expect(p.scoreDefaultMigrated).toBe(true);
    recordAttempt('p', 'S', 'a', 3, res(0.9), 30);
    expect(loadProfile().scoreDefaultNote).toBeFalsy(); // the migration doesn't run again
    _resetAllForTests();
    localStorage.clear();
    recordAttempt('p', 'S', 'a', 2, res(0.9), 30);
    localStorage.setItem('sh:profile', JSON.stringify({ ...v1 }));
    expect(loadProfile().scoreDefaultNote).toBeFalsy();
  });

  it('an explicit score choice is kept', () => {
    recordAttempt('p', 'S', 'a', 1, res(0.9), 30);
    localStorage.setItem('sh:profile', JSON.stringify({ ...v1, display: 'score' }));
    expect(loadProfile()).toMatchObject({ display: 'score' });
    expect(loadProfile().scoreDefaultNote).toBeFalsy();
  });
});

describe('profile & corrupted storage', () => {
  it('defaults and roundtrip', () => {
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
    expect(loadProfile().voice).toBe('S');
    saveProfile({ ...loadProfile(), name: 'Anna', voice: 'A' });
    expect(loadProfile()).toMatchObject({ name: 'Anna', voice: 'A', notation: 'letter' });
  });
  it('tolerates corrupted JSON and resets the key', () => {
    localStorage.setItem('sh:profile', '{nope');
    localStorage.setItem('sh:log', '"not an array"');
    localStorage.setItem('sh:cycle', 'null');
    localStorage.setItem('sh:progress:p:S', '[1,2]');
    expect(() => loadProfile()).not.toThrow();
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
    expect(localStorage.getItem('sh:profile')).toBeNull();
    expect(attemptLog()).toEqual([]);
    expect(loadCycle()).toEqual({ name: 'This cycle', pieceIds: [] });
    expect(getProgress('p', 'S')).toBeUndefined();
    expect(() => recordAttempt('p', 'S', 's0', 1, res(0.9))).not.toThrow();
  });
});

describe('recordAttempt', () => {
  it('a practice run (a loop, a drill) is logged but never kept as a passage', () => {
    recordAttempt('p', 'S', 's0', 1, res(0.9), undefined, undefined, { step: 'slow' });
    const r = recordAttempt('p', 'S', 'drill', 1, res(0.95), 12, undefined, { step: 'slow', practice: true });
    expect(r).toMatchObject({ newLevel: 0, prevLevel: 0, newSlow: 0 });
    expect(r.stepUp).toBeUndefined();
    expect(getProgress('p', 'S')!.sections.drill).toBeUndefined();
    expect(attemptLog().at(-1)).toMatchObject({ sectionId: 'drill', level: 1, step: 'slow' });
  });
  it('pass / fail at thresholds: a slow pass ticks the step, a pass in tempo the level', () => {
    const S = { step: 'slow' as const };
    const T = { step: 'tempo' as const };
    const u = undefined;
    expect(recordAttempt('p', 'S', 's0', 1, res(0.74), u, u, S)).toEqual({ passed: false, step: 'slow', newLevel: 0, prevLevel: 0, prevSlow: 0, newSlow: 0 });
    // Level 1 slow passed: a step-up, not a level-up.
    expect(recordAttempt('p', 'S', 's0', 1, res(0.75), u, u, S)).toEqual({ passed: true, step: 'slow', newLevel: 0, prevLevel: 0, prevSlow: 0, newSlow: 1, stepUp: true });
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 0, slow: 1 });
    // Again slow: passed, but nothing new.
    expect(recordAttempt('p', 'S', 's0', 1, res(0.9), u, u, S)).toEqual({ passed: true, step: 'slow', newLevel: 0, prevLevel: 0, prevSlow: 1, newSlow: 1 });
    expect(recordAttempt('p', 'S', 's0', 1, res(0.79), u, u, T)).toEqual({ passed: false, step: 'tempo', newLevel: 0, prevLevel: 0, prevSlow: 1, newSlow: 1 });
    // In tempo: Level 1 complete (the slow step with it).
    expect(recordAttempt('p', 'S', 's0', 1, res(0.8), u, u, T)).toEqual({ passed: true, step: 'tempo', newLevel: 1, prevLevel: 0, prevSlow: 1, newSlow: 0 });
    expect(getProgress('p', 'S')!.sections.s0.slow).toBeUndefined();
    expect(recordAttempt('p', 'S', 's0', 2, res(0.8), u, u, S)).toMatchObject({ passed: true, newLevel: 1, newSlow: 2, stepUp: true });
    expect(recordAttempt('p', 'S', 's0', 2, res(0.8), u, u, T)).toEqual({ passed: true, step: 'tempo', newLevel: 2, prevLevel: 1, prevSlow: 2, newSlow: 0 });
    // passing a lower level never lowers
    expect(recordAttempt('p', 'S', 's0', 1, res(0.99), u, u, T)).toEqual({ passed: true, step: 'tempo', newLevel: 2, prevLevel: 2, prevSlow: 0, newSlow: 0 });
    // nor does a slow pass at or below the level
    expect(recordAttempt('p', 'S', 's0', 2, res(0.99), u, u, S)).toEqual({ passed: true, step: 'slow', newLevel: 2, prevLevel: 2, prevSlow: 0, newSlow: 0 });
    const sp = getProgress('p', 'S')!.sections.s0;
    expect(sp.attempts).toBe(9);
    // Best results are kept for runs in tempo.
    expect(sp.best[1]).toBe(0.99);
    expect(sp.best[2]).toBe(0.8);
    expect(getProgress('p', 'S')!.bestScore).toBe(990);
    expect(personalBest('p', 'S', 's0', 2)).toEqual({ accuracy: 0.8, score: 800 });
    expect(personalBest('p', 'S', 's0', 2, 'slow')).toBeNull();
    expect(personalBest('p', 'S', 's0', 4)).toBeNull();
    expect(attemptLog()).toHaveLength(9);
    expect(attemptLog().map((e) => e.step)).toEqual(['slow', 'slow', 'slow', 'tempo', 'tempo', 'slow', 'tempo', 'tempo', 'slow']);
  });
  it('a slow pass above the level never reviews, fixes or reaches anything', () => {
    recordAttempt('p', 'S', 's0', 3, res(0.9), undefined, 1000, { step: 'tempo' });
    const r = recordAttempt('p', 'S', 's0', 4, res(0.9), undefined, 5000, { step: 'slow' });
    expect(r).toMatchObject({ passed: true, newLevel: 3, newSlow: 4, stepUp: true });
    expect(r.fixed).toBeUndefined();
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 3, slow: 4, lastPassed: 1000, lastPracticed: 5000 });
  });
  it('level 5: the two-day rule is for the step in tempo only', () => {
    recordAttempt('p', 'S', 's0', 4, res(0.9), undefined, undefined, { step: 'tempo' });
    expect(recordAttempt('p', 'S', 's0', 5, res(0.9), undefined, undefined, { step: 'slow' })).toMatchObject({ passed: true, newLevel: 4, newSlow: 5, stepUp: true });
    expect(getProgress('p', 'S')!.sections.s0.offBookDays).toBeUndefined();
    // In tempo on day 1: still Level 4 (concert-ready), the slow step stays ticked; then Level 5 in tempo on another day.
    const day1 = new Date(2026, 9, 4, 12).getTime();
    expect(recordAttempt('p', 'S', 's0', 5, res(0.9), undefined, day1, { step: 'tempo' })).toMatchObject({ passed: true, newLevel: 4, offBookDays: 1, newSlow: 5 });
    expect(recordAttempt('p', 'S', 's0', 5, res(0.9), undefined, day1 + 86_400_000, { step: 'tempo' })).toMatchObject({ newLevel: 5, offBookDays: 2, newSlow: 0 });
  });
  it('late entries or late timing fail the run', () => {
    expect(recordAttempt('p', 'S', 's0', 1, res(0.95), undefined, undefined, { step: 'tempo', entriesLate: true }).passed).toBe(false);
    expect(recordAttempt('p', 'S', 's0', 2, res(0.95), undefined, undefined, { step: 'slow', timingFail: true }).passed).toBe(false);
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 0 });
    expect(getProgress('p', 'S')!.sections.s0.slow).toBeUndefined();
  });
  it('skip ahead', () => {
    expect(recordAttempt('p', 'S', 's1', 4, res(0.84))).toMatchObject({ passed: false, newLevel: 0 });
    expect(recordAttempt('p', 'S', 's1', 4, res(0.86))).toEqual({ passed: true, step: 'tempo', newLevel: 4, prevLevel: 0, prevSlow: 0, newSlow: 0 });
  });
  it('level 0 listen only updates lastPracticed', () => {
    const r = recordAttempt('p', 'S', 's2', 0, res(0), undefined, 1000);
    expect(r).toEqual({ passed: false, step: 'tempo', newLevel: 0, prevLevel: 0, prevSlow: 0, newSlow: 0 });
    const sp = getProgress('p', 'S')!.sections.s2;
    expect(sp).toMatchObject({ level: 0, attempts: 0, lastPracticed: 1000 });
    expect(getProgress('p', 'S')!.totalAttempts).toBe(0);
  });
  it('caps the log', () => {
    const big = Array.from({ length: LOG_CAP }, (_, i) => ({ at: i, pieceId: 'p', partId: 'S', sectionId: 's', level: 1, accuracy: 0, score: 0, passed: false }));
    localStorage.setItem('sh:log', JSON.stringify(big));
    recordAttempt('p', 'S', 's0', 1, res(0.5));
    const log = attemptLog();
    expect(log).toHaveLength(LOG_CAP);
    expect(log[0].at).toBe(1);
  });
  it('notifies subscribers', () => {
    const cb = vi.fn();
    const off = subscribe(cb);
    recordAttempt('p', 'S', 's0', 1, res(0.5));
    saveCycle({ name: 'Spring', pieceIds: ['a'] });
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    saveCycle({ name: 'Spring', pieceIds: [] });
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('stats', () => {
  it('streak across days', () => {
    expect(streakDays(new Date(at(2026, 10, 4)))).toBe(0);
    for (const d of [1, 2, 3]) recordAttempt('p', 'S', 's0', 1, res(0.5), 60, at(2026, 10, d, 21));
    // ending yesterday
    expect(streakDays(new Date(at(2026, 10, 4, 9)))).toBe(3);
    // ending today, across a month boundary
    recordAttempt('p', 'S', 's0', 1, res(0.5), 60, at(2026, 9, 30, 8));
    recordAttempt('p', 'S', 's0', 1, res(0.5), 60, at(2026, 10, 4, 7));
    expect(streakDays(new Date(at(2026, 10, 4, 23)))).toBe(5);
    // gap of two days breaks it
    expect(streakDays(new Date(at(2026, 10, 6)))).toBe(0);
  });
  it('practice minutes', () => {
    const now = at(2026, 10, 4);
    recordAttempt('p', 'S', 's0', 1, res(0.5), 90, now - DAY);
    recordAttempt('p', 'S', 's0', 1, res(0.5), 90, now - 2 * DAY);
    recordAttempt('p', 'S', 's0', 1, res(0.5), 600, now - 10 * DAY);
    expect(practiceMinutes(7, now)).toBe(3);
  });
  it('due for review', () => {
    const sections = ['s0', 's1', 's2'].map((id, index) => ({ id, index, label: id, startMeasure: 0, endMeasure: 0, start: 0, end: 0 })) as Section[];
    const now = at(2026, 10, 20);
    recordAttempt('p', 'S', 's0', 3, res(0.9), 30, at(2026, 10, 1));
    recordAttempt('p', 'S', 's1', 3, res(0.9), 30, at(2026, 10, 18));
    recordAttempt('p', 'S', 's2', 2, res(0.9), 30, at(2026, 10, 1));
    expect(dueForReview('p', 'S', sections, now)).toEqual(['s0']);
    recordAttempt('p', 'S', 's0', 3, res(0.9), 30, now);
    expect(dueForReview('p', 'S', sections, now)).toEqual([]);
  });
  it('readiness snapshots', () => {
    snapshotReadiness('p', 'S', 0.25, at(2026, 10, 1));
    snapshotReadiness('p', 'S', 0.5, at(2026, 10, 3));
    snapshotReadiness('p', 'S', 0.6, at(2026, 10, 3, 18));
    expect(readinessHistory('p', 'S')).toEqual([{ day: '2026-10-01', pct: 0.25 }, { day: '2026-10-03', pct: 0.6 }]);
  });
});

describe('cycle, backup, scores', () => {
  it('cycle defaults & roundtrip', () => {
    expect(loadCycle()).toEqual({ name: 'This cycle', pieceIds: [] });
    saveCycle({ name: 'Advent', concertDate: '2026-12-20', pieceIds: ['x'] });
    expect(loadCycle()).toEqual({ name: 'Advent', concertDate: '2026-12-20', pieceIds: ['x'] });
  });
  it('backup roundtrip', () => {
    saveProfile({ ...loadProfile(), name: 'Ben', voice: 'B' });
    recordAttempt('p', 'B1', 's0', 1, res(0.9));
    localStorage.setItem('other:key', 'keep');
    const json = exportBackup();
    localStorage.clear(); _resetAllForTests();
    localStorage.setItem('sh:junk', '1');
    importBackup(json);
    expect(loadProfile().name).toBe('Ben');
    expect(getProgress('p', 'B1')!.sections.s0.level).toBe(1);
    expect(attemptLog()).toHaveLength(1);
    expect(localStorage.getItem('sh:junk')).toBeNull();
    expect(() => importBackup('{bad')).toThrow();
    expect(() => importBackup('{"app":"x"}')).toThrow();
  });
  it('imported scores fall back to memory without IndexedDB', async () => {
    const s = { id: 'imp1', title: 'T', composer: 'C', source: 'musicxml', parts: [], measures: [], keys: [], tempos: [], duration: 1 } as Score;
    await saveImportedScore(s);
    expect((await loadImportedScores()).map((x) => x.id)).toEqual(['imp1']);
    await deleteImportedScore('imp1');
    expect(await loadImportedScores()).toEqual([]);
  });
});

describe('programme slots', () => {
  it('matches titles loosely and files an import into the cycle and the rehearsal focus', async () => {
    const { sameWork, fillWantedSlot, saveCycle, loadCycle } = await import('./store');
    expect(sameWork('Madrigal', 'Madrigal, Op. 35')).toBe(true);
    expect(sameWork('Huit chansons francaises: 1. Clic, clac', 'Huit chansons françaises')).toBe(true);
    expect(sameWork('Vinea mea electa', 'Kyrie')).toBe(false);
    saveCycle({ name: 'X', pieceIds: ['a'], focusPieceIds: ['a'], wanted: [
      { title: 'Madrigal, Op. 35', composer: 'Fauré', focus: true },
      { title: 'Vinea mea electa', composer: 'Poulenc' }] });
    expect(fillWantedSlot('imp-1', 'Madrigal')?.composer).toBe('Fauré');
    expect(fillWantedSlot('imp-2', 'Vinea mea electa')).not.toBeNull();
    expect(fillWantedSlot('imp-3', 'Something else')).toBeNull();
    const c = loadCycle();
    expect(c.pieceIds).toEqual(['a', 'imp-1', 'imp-2']);
    expect(c.focusPieceIds).toEqual(['a', 'imp-1']);
  });
});

describe('timing gate and delay migration', () => {
  it('a run with the right notes but late entries does not pass', async () => {
    const { recordAttempt, _resetAllForTests } = await import('./store');
    _resetAllForTests();
    const res = { accuracy: 0.95, pitch: 0.95, rhythm: 0.5, score: 100, maxCombo: 5, counts: { perfect: 5, good: 0, ok: 0, miss: 0 }, notes: [], perMeasure: {}, insights: [] };
    expect(recordAttempt('p', 'A', 's1', 2, res, 10, Date.now(), { timingFail: true }).passed).toBe(false);
    expect(recordAttempt('p', 'A', 's1', 2, res, 10).passed).toBe(true);
  });
  it('treats a delay saved before the source was recorded as learned', async () => {
    const { loadProfile, _resetAllForTests } = await import('./store');
    _resetAllForTests();
    localStorage.setItem('sh:profile', JSON.stringify({ name: 'X', latencyMs: 180 }));
    expect(loadProfile().latencySource).toBe('learned');
  });
});

describe('off book needs two days', () => {
  it('reaches level 5 only after passes on two different days', async () => {
    const { recordAttempt, _resetAllForTests } = await import('./store');
    _resetAllForTests();
    const ok = { accuracy: 0.95, pitch: 0.95, rhythm: 1, score: 100, maxCombo: 5, counts: { perfect: 5, good: 0, ok: 0, miss: 0 }, notes: [], perMeasure: {}, insights: [] };
    const d1 = new Date(2026, 9, 5, 20).getTime();
    expect(recordAttempt('p', 'A', 's1', 4, ok, 10, d1 - 3600e3).newLevel).toBe(4);
    let r = recordAttempt('p', 'A', 's1', 5, ok, 10, d1);
    expect(r.passed).toBe(true);
    expect(r.newLevel).toBe(4);
    expect(r.offBookDays).toBe(1);
    r = recordAttempt('p', 'A', 's1', 5, ok, 10, d1 + 3600e3); // same day
    expect(r.newLevel).toBe(4);
    r = recordAttempt('p', 'A', 's1', 5, ok, 10, d1 + 86400e3);
    expect(r.newLevel).toBe(5);
    expect(r.offBookDays).toBe(2);
  });
});

describe('piece levels from full runs (docs/LEVELS.md)', () => {
  // Three 8-second sections; eight notes in each (note i starts at second i).
  const secs: Section[] = [0, 1, 2].map((i) => ({
    id: `s${i}`, index: i, label: `Bars ${i * 4 + 1}–${i * 4 + 4}`, startMeasure: i * 4, endMeasure: i * 4 + 3, start: i * 8, end: i * 8 + 8,
  }));
  const noteStart = (i: number) => (i >= 0 && i < 24 ? i : undefined);
  type G = 'perfect' | 'good' | 'ok' | 'miss';
  /** A full-run result with these grades for notes 0..; accuracy as the app computes it. */
  const run = (grades: G[]): AttemptResult => {
    const v = { perfect: 1, good: 0.85, ok: 0.5, miss: 0 };
    const notes = grades.map((grade, index) => ({ index, grade }));
    const accuracy = grades.reduce((a, g) => a + v[g], 0) / grades.length;
    return { ...res(accuracy), notes } as unknown as AttemptResult;
  };
  const good8: G[] = ['perfect', 'perfect', 'good', 'perfect', 'perfect', 'good', 'perfect', 'perfect'];
  const half8: G[] = ['perfect', 'miss', 'perfect', 'miss', 'perfect', 'miss', 'perfect', 'miss'];
  const allGood: G[] = [...good8, ...good8, ...good8];
  // Overall 0.81 (passes level 3 at 0.8), but s1 only 0.5.
  const oneSlips: G[] = [...good8, ...half8, ...good8];
  const counted = { counted: true };

  it('a clean run grants the piece level at once, with a clean-run star, and credits every section', async () => {
    const { recordFullRun } = await import('./store');
    const { pieceReadiness } = await import('./ladder');
    const now = at(2026, 10, 5);
    const r = recordFullRun('p', 'S', 3, run(allGood), secs, noteStart, { ...counted, now });
    expect(r).toMatchObject({ counted: true, opened: true, clean: true, overallPassed: true, passed: true, prevLevel: 0, newLevel: 3, toFix: [] });
    expect(getProgress('p', 'S')!.full?.clean).toEqual([3]);
    expect(pieceReadiness(secs, getProgress('p', 'S')).clean).toEqual([3]);
    expect(r.sections.map((x) => x.passed)).toEqual([true, true, true]);
    const prog = getProgress('p', 'S')!;
    expect(prog.full).toMatchObject({ level: 3, attempts: 1, lastPassed: now });
    expect(prog.sections.s1).toMatchObject({ level: 3, lastPassed: now });
    expect(pieceReadiness(secs, prog)).toMatchObject({ pieceLevel: 3, rehearsalReady: true, concertReady: false });
    expect(attemptLog().at(-1)).toMatchObject({ sectionId: 'all', level: 3, passed: true });
    expect(personalBest('p', 'S', 'all', 3)?.accuracy).toBeCloseTo(run(allGood).accuracy);
  });

  it('a run with a section below the mark opens the level: the section is to fix, no star', async () => {
    const { recordFullRun } = await import('./store');
    const r = recordFullRun('p', 'S', 3, run(oneSlips), secs, noteStart, counted);
    expect(r.overallPassed).toBe(true);
    expect(r).toMatchObject({ opened: true, clean: false, passed: false });
    expect(getProgress('p', 'S')!.full?.clean).toEqual([]);
    expect(r.newLevel).toBe(0);
    expect(r.toFix).toEqual(['s1']);
    const prog = getProgress('p', 'S')!;
    expect(prog.full?.toFix).toEqual({ 3: ['s1'] });
    // The sections that held are credited; the one that slipped isn't.
    expect(prog.sections.s0.level).toBe(3);
    expect(prog.sections.s1).toBeUndefined();
  });

  it('the last section fixed on its own grants the level: no second full run', async () => {
    const { recordFullRun } = await import('./store');
    recordFullRun('p', 'S', 3, run(oneSlips), secs, noteStart, counted);
    // A failed or lower-level section run doesn't fix it.
    expect(recordAttempt('p', 'S', 's1', 3, res(0.6)).fixed).toBeUndefined();
    expect(recordAttempt('p', 'S', 's1', 2, res(0.95)).fixed).toBeUndefined();
    expect(getProgress('p', 'S')!.full?.level).toBe(0);
    // Passing it at level 3 on its own does, and the piece reaches level 3.
    const r = recordAttempt('p', 'S', 's1', 3, res(0.9));
    expect(r.fixed).toEqual([{ level: 3, remaining: 0 }]);
    expect(r.reached).toMatchObject({ level: 3, prevLevel: 0, newLevel: 3 });
    const prog = getProgress('p', 'S')!;
    expect(prog.full).toMatchObject({ level: 3, clean: [] });
    expect(prog.full?.toFix).toBeUndefined();
  });

  // Four sections, eight notes each (note i starts at second i).
  const secs4: Section[] = [0, 1, 2, 3].map((i) => ({
    id: `s${i}`, index: i, label: `Bars ${i * 4 + 1}–${i * 4 + 4}`, startMeasure: i * 4, endMeasure: i * 4 + 3, start: i * 8, end: i * 8 + 8,
  }));
  const ns4 = (i: number) => (i >= 0 && i < 32 ? i : undefined);
  const runOf = (...slip: number[]) => run([0, 1, 2, 3].flatMap((i) => (slip.includes(i) ? half8 : good8)));

  it('a run that slips two of four sections, then those two fixed: the level, without a re-run', async () => {
    const { recordFullRun } = await import('./store');
    const { nextStep, pieceReadiness } = await import('./ladder');
    const r = recordFullRun('p', 'S', 2, runOf(1, 3), secs4, ns4, counted);
    expect(r).toMatchObject({ opened: true, passed: false, newLevel: 0, toFix: ['s1', 's3'] });
    let prog = getProgress('p', 'S')!;
    expect(pieceReadiness(secs4, prog).toFix).toEqual([{ level: 2, sectionIds: ['s1', 's3'] }]);
    const n = nextStep(secs4, prog)!;
    expect(n).toMatchObject({ sectionId: 's1', level: 2, kind: 'fix' });
    expect(n.reason).toBe('Fix Bars 5–8 in tempo to reach Level 2 · Words. 1 more to fix after this one.');
    expect(recordAttempt('p', 'S', 's1', 2, res(0.9)).fixed).toEqual([{ level: 2, remaining: 1 }]);
    expect(getProgress('p', 'S')!.full?.level).toBe(0);
    expect(nextStep(secs4, getProgress('p', 'S'))!.reason).toBe('Fix Bars 13–16 in tempo to reach Level 2 · Words.');
    // Fixing at a higher level counts too.
    expect(recordAttempt('p', 'S', 's3', 3, res(0.9)).reached).toMatchObject({ level: 2, newLevel: 2 });
    prog = getProgress('p', 'S')!;
    expect(pieceReadiness(secs4, prog)).toMatchObject({ pieceLevel: 2, toFix: [], clean: [] });
  });

  it('more than half of the sections slipped: practice, nothing changes', async () => {
    const { recordFullRun } = await import('./store');
    const { nextStep } = await import('./ladder');
    // Two of three slipped.
    const r = recordFullRun('p', 'S', 3, run([...good8, ...half8, ...half8]), secs, noteStart, counted);
    expect(r).toMatchObject({ counted: true, opened: false, tooMuch: true, passed: false, toFix: [], newLevel: 0 });
    let prog = getProgress('p', 'S')!;
    expect(prog.full?.toFix).toBeUndefined();
    expect(prog.full?.attempts).toBe(0);
    expect(prog.sections.s0).toBeUndefined(); // practice: the section that held isn't credited either
    expect(attemptLog().at(-1)?.sectionId).toBe('practice');
    expect(nextStep(secs, prog)).toMatchObject({ sectionId: 's0', level: 1, kind: 'section' });
    // Exactly half (two of four) still opens; three of four doesn't.
    expect(recordFullRun('p', 'S', 2, runOf(0, 1), secs4, ns4, counted).opened).toBe(true);
    const many = recordFullRun('p', 'S', 2, runOf(0, 1, 2), secs4, ns4, counted);
    expect(many.tooMuch).toBe(true);
    // …and leaves the open list from the run before as it was.
    prog = getProgress('p', 'S')!;
    expect(prog.full?.toFix).toEqual({ 2: ['s0', 's1'] });
  });

  it('a run far under the mark is practice even when at most half of the sections slipped', async () => {
    const { recordFullRun } = await import('./store');
    const miss8: G[] = Array(8).fill('miss');
    // Two of four sections not sung at all: about 48% overall at level 2 (mark 80%, floor 70%).
    const r = recordFullRun('p', 'S', 2, run([...good8, ...miss8, ...good8, ...miss8]), secs4, ns4, counted);
    expect(r).toMatchObject({ opened: false, tooMuch: true, toFix: [] });
    expect(getProgress('p', 'S')!.full?.toFix).toBeUndefined();
    expect(getProgress('p', 'S')!.sections.s0).toBeUndefined();
    // Two of four at half marks: 73%, within 10 points, opens.
    expect(recordFullRun('p', 'S', 2, runOf(1, 3), secs4, ns4, counted)).toMatchObject({ opened: true, toFix: ['s1', 's3'] });
    expect(getProgress('p', 'S')!.full?.toFixLocks).toEqual({ 2: true });
  });

  it('a new run at the level replaces the open fix list with its own slips', async () => {
    const { recordFullRun } = await import('./store');
    recordFullRun('p', 'S', 2, runOf(1, 2), secs4, ns4, counted);
    recordAttempt('p', 'S', 's1', 2, res(0.9)); // s1 fixed, s2 still to fix
    expect(getProgress('p', 'S')!.full?.toFix).toEqual({ 2: ['s2'] });
    // Again: s1 slips this time, s2 holds, s3 slips. s1 is back on the list (it didn't hold again).
    let r = recordFullRun('p', 'S', 2, runOf(1, 3), secs4, ns4, counted);
    expect(r.toFix).toEqual(['s1', 's3']);
    expect(getProgress('p', 'S')!.full?.toFix).toEqual({ 2: ['s1', 's3'] });
    // And a clean run settles it: the level and the star.
    r = recordFullRun('p', 'S', 2, runOf(), secs4, ns4, counted);
    expect(r).toMatchObject({ passed: true, clean: true, newLevel: 2 });
    expect(getProgress('p', 'S')!.full).toMatchObject({ level: 2, clean: [2] });
    expect(getProgress('p', 'S')!.full?.toFix).toBeUndefined();
  });

  it('never lowers the piece level: slips in a run at or below it are to practise', async () => {
    const { recordFullRun } = await import('./store');
    const { nextStep } = await import('./ladder');
    recordFullRun('p', 'S', 3, runOf(), secs4, ns4, counted);
    let r = recordFullRun('p', 'S', 3, runOf(2), secs4, ns4, counted);
    expect(r).toMatchObject({ opened: true, prevLevel: 3, newLevel: 3, toFix: ['s2'] });
    expect(nextStep(secs4, getProgress('p', 'S'))!.reason).toBe('Fix Bars 9–12 at Level 3 in tempo: it slipped in your full run.');
    r = recordFullRun('p', 'S', 2, runOf(0, 1), secs4, ns4, counted);
    expect(r.newLevel).toBe(3);
    expect(recordAttempt('p', 'S', 's2', 3, res(0.9)).reached).toMatchObject({ level: 3, prevLevel: 3, newLevel: 3 });
    expect(getProgress('p', 'S')!.full?.level).toBe(3);
    // Too much slipped at level 1: still level 3.
    expect(recordFullRun('p', 'S', 1, runOf(0, 1, 2), secs4, ns4, counted).newLevel).toBe(3);
    expect(getProgress('p', 'S')!.full).toMatchObject({ level: 3, clean: [3] });
  });

  it('level 5: the off-book run opens it, fixes finish it, and memorised still needs a second day', async () => {
    const { recordFullRun } = await import('./store');
    const { pieceReadiness, nextStep } = await import('./ladder');
    const d1 = at(2026, 10, 5, 18);
    let r = recordFullRun('p', 'S', 5, runOf(1), secs4, ns4, { ...counted, now: d1 });
    expect(r).toMatchObject({ opened: true, newLevel: 0, offBookDays: 0, toFix: ['s1'] });
    expect(nextStep(secs4, getProgress('p', 'S'), d1)!.reason).toBe('Fix Bars 5–8 at Level 5 in tempo to finish the whole piece from memory: day 1 of 2.');
    // Fixed the same day: sung from memory on one day, so concert-ready (4).
    const fix = recordAttempt('p', 'S', 's1', 5, res(0.9), 10, d1 + 3600e3);
    expect(fix.reached).toMatchObject({ level: 5, prevLevel: 0, newLevel: 4, offBookDays: 1 });
    expect(pieceReadiness(secs4, getProgress('p', 'S'))).toMatchObject({ pieceLevel: 4, concertReady: true, memorised: false });
    // Another off-book run the same day, with a slip fixed: still day 1.
    recordFullRun('p', 'S', 5, runOf(2), secs4, ns4, { ...counted, now: d1 + 2 * 3600e3 });
    expect(recordAttempt('p', 'S', 's2', 5, res(0.9), 10, d1 + 3 * 3600e3).reached).toMatchObject({ newLevel: 4, offBookDays: 1 });
    // Day 2 needs the off-book full run again; its fixes then count.
    const d2 = d1 + DAY;
    expect(nextStep(secs4, getProgress('p', 'S'), d2)).toMatchObject({ sectionId: 'all', level: 5, kind: 'full' });
    r = recordFullRun('p', 'S', 5, runOf(3), secs4, ns4, { ...counted, now: d2 });
    expect(r).toMatchObject({ newLevel: 4, toFix: ['s3'] });
    expect(recordAttempt('p', 'S', 's3', 5, res(0.9), 10, d2 + 600e3).reached).toMatchObject({ level: 5, prevLevel: 4, newLevel: 5, offBookDays: 2 });
    expect(pieceReadiness(secs4, getProgress('p', 'S')).memorised).toBe(true);
  });

  it('a run at the next level is open while lower fixes are pending, and a pass settles them', async () => {
    const { recordFullRun } = await import('./store');
    recordFullRun('p', 'S', 2, run(oneSlips), secs, noteStart, counted);
    expect(getProgress('p', 'S')!.full?.toFix).toEqual({ 2: ['s1'] });
    const r = recordFullRun('p', 'S', 3, run(allGood), secs, noteStart, counted);
    expect(r.passed).toBe(true);
    expect(getProgress('p', 'S')!.full?.toFix).toBeUndefined();
  });

  it('a practice run (slower tempo, stopped early, paused) changes nothing', async () => {
    const { recordFullRun } = await import('./store');
    const r = recordFullRun('p', 'S', 1, run(allGood), secs, noteStart, { counted: false });
    expect(r).toMatchObject({ counted: false, passed: false, newLevel: 0 });
    const prog = getProgress('p', 'S')!;
    expect(prog.full?.level).toBe(0);
    expect(prog.full?.attempts).toBe(0);
    expect(prog.sections).toEqual({});
    expect(attemptLog().at(-1)).toMatchObject({ sectionId: 'practice', passed: false });
    // Even a failing practice run marks nothing to fix.
    recordFullRun('p', 'S', 3, run(oneSlips), secs, noteStart, { counted: false });
    expect(getProgress('p', 'S')!.full?.toFix).toBeUndefined();
  });

  it('a section with no real score is never credited, slack or not', async () => {
    const { recordFullRun } = await import('./store');
    // s2 has a single missed note.
    const one = (i: number) => (i < 16 ? i : i === 16 ? 17 : undefined);
    const r = recordFullRun('p', 'S', 3, run([...good8, ...good8, 'miss']), secs, one, counted);
    expect(r.sections[2]).toMatchObject({ id: 's2', accuracy: 0, passed: false });
    expect(getProgress('p', 'S')!.sections.s2).toBeUndefined();
  });

  it('a new singer whose run far above their level slips everywhere: practice, Next up unchanged', async () => {
    const { recordFullRun } = await import('./store');
    const { nextStep } = await import('./ladder');
    const bad: G[] = [...half8, ...half8, ...half8];
    const r = recordFullRun('p', 'S', 5, run(bad), secs, noteStart, counted);
    expect(r).toMatchObject({ tooMuch: true, toFix: [] });
    expect(r.sections.every((x) => !x.passed)).toBe(true);
    const prog = getProgress('p', 'S')!;
    expect(nextStep(secs, prog)).toMatchObject({ sectionId: 's0', level: 1, kind: 'section' });
  });

  it('a short section is not failed by one weak note', async () => {
    const { recordFullRun } = await import('./store');
    // s2 has only two notes here: one perfect, one ok.
    const short = (i: number) => (i < 16 ? i : i === 16 ? 17 : i === 17 ? 20 : undefined);
    const r = recordFullRun('p', 'S', 3, run([...good8, ...good8, 'perfect', 'ok']), secs, short, counted);
    expect(r.sections[2]).toMatchObject({ id: 's2', accuracy: 0.75, passed: true });
    expect(r.passed).toBe(true);
  });

  it('a counted full run refreshes the review date of sections above its level', async () => {
    const { recordFullRun } = await import('./store');
    const old = at(2026, 9, 1);
    recordAttempt('p', 'S', 's0', 4, res(0.95), 10, old);
    const now = at(2026, 10, 5);
    recordFullRun('p', 'S', 2, run(allGood), secs, noteStart, { ...counted, now });
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 4, lastPassed: now });
  });

  it('late entries fail the run even with the right notes', async () => {
    const { recordFullRun } = await import('./store');
    const r = recordFullRun('p', 'S', 3, run(allGood), secs, noteStart, { counted: true, timingFail: true });
    expect(r).toMatchObject({ counted: true, opened: false, overallPassed: false, passed: false, toFix: [] });
    expect(r.tooMuch).toBeUndefined();
    expect(attemptLog().at(-1)?.sectionId).toBe('practice');
    expect(getProgress('p', 'S')!.sections.s0).toBeUndefined();
  });

  it('memorised: the full run off book passed on two different days', async () => {
    const { recordFullRun } = await import('./store');
    const { pieceReadiness } = await import('./ladder');
    const d1 = at(2026, 10, 5, 20);
    let r = recordFullRun('p', 'S', 5, run(allGood), secs, noteStart, { ...counted, now: d1 });
    expect(r).toMatchObject({ passed: true, newLevel: 4, offBookDays: 1 });
    expect(pieceReadiness(secs, getProgress('p', 'S')).concertReady).toBe(true);
    r = recordFullRun('p', 'S', 5, run(allGood), secs, noteStart, { ...counted, now: d1 + 3600e3 }); // same day
    expect(r.newLevel).toBe(4);
    r = recordFullRun('p', 'S', 5, run(allGood), secs, noteStart, { ...counted, now: d1 + DAY });
    expect(r).toMatchObject({ newLevel: 5, offBookDays: 2 });
    expect(pieceReadiness(secs, getProgress('p', 'S')).memorised).toBe(true);
  });

  it('migration: section levels saved before piece levels are kept, the piece level starts at 0', async () => {
    const { recordFullRun } = await import('./store');
    const { pieceReadiness, nextStep } = await import('./ladder');
    // Stored by the previous version: sections at level 3–4 and an old 'all' record (practice runs mixed in), no `full`.
    const old = {
      pieceId: 'p', partId: 'S', totalAttempts: 9, bestScore: 900,
      sections: {
        s0: { level: 3, best: { 3: 0.9 }, attempts: 3, lastPassed: Date.now() },
        s1: { level: 4, best: { 4: 0.9 }, attempts: 3, lastPassed: Date.now() },
        s2: { level: 3, best: { 3: 0.9 }, attempts: 3, lastPassed: Date.now() },
        all: { level: 4, best: { 4: 0.9 }, attempts: 1 },
      },
    };
    localStorage.setItem('sh:progress:p:S', JSON.stringify(old));
    localStorage.setItem('sh:readiness', JSON.stringify({ 'p|S': { '2026-09-01': 0.8 } }));
    const prog = getProgress('p', 'S')!;
    expect(prog.sections.s1.level).toBe(4); // not stripped
    const r = pieceReadiness(secs, prog);
    expect(r).toMatchObject({ pieceLevel: 0, unconfirmed: 3, rehearsalReady: false, minLevel: 3 });
    expect(r.pct).toBeCloseTo((1.5 + 2 + 1.5) / 12);
    expect(nextStep(secs, prog)).toMatchObject({ sectionId: 'all', level: 3, kind: 'full' });
    // Readiness history restarts under the new key (no false drop on "most improved"); the old key is kept.
    expect(readinessHistory('p', 'S')).toEqual([]);
    expect(localStorage.getItem('sh:readiness')).not.toBeNull();
    // A section run still works on the old record, and the first full run adds `full` without touching the rest.
    recordAttempt('p', 'S', 's0', 4, res(0.9));
    recordFullRun('p', 'S', 3, run(allGood), secs, noteStart, counted);
    const after = getProgress('p', 'S')!;
    expect(after.full?.level).toBe(3);
    expect(after.sections.s0.level).toBe(4);
    expect(after.sections.s1.level).toBe(4);
    expect(after.sections.all.level).toBe(4); // left alone, ignored
    expect(after.totalAttempts).toBe(11);
  });
});

describe('progress saved under the earlier level rules (upgradeFullRuns)', () => {
  const secs: Section[] = [0, 1, 2, 3].map((i) => ({
    id: `s${i}`, index: i, label: `Bars ${i * 4 + 1}–${i * 4 + 4}`, startMeasure: i * 4, endMeasure: i * 4 + 3, start: i * 8, end: i * 8 + 8,
  }));
  const T0 = at(2026, 9, 20);
  const sec = (level: number, lastPassed: number) => ({ level, best: { [level]: 0.9 }, attempts: 2, lastPassed, lastPracticed: lastPassed });
  // (runs in tempo, saved under the current schema: levels mean in tempo)
  const entry = (sectionId: string, level: number, t: number, passed: boolean, accuracy = 0.82) =>
    ({ at: t, pieceId: 'p', partId: 'S', sectionId, level, step: 'tempo', accuracy, score: 800, passed });
  const store = (prog: object, log: object[]) => {
    localStorage.setItem('sh:schema', String(SCHEMA_VERSION));
    localStorage.setItem('sh:progress:p:S', JSON.stringify({ pieceId: 'p', partId: 'S', totalAttempts: 5, bestScore: 900, ...prog }));
    localStorage.setItem('sh:log', JSON.stringify(log));
  };

  it('a fix list done since the run grants the level (no second run needed any more)', async () => {
    const { upgradeFullRuns } = await import('./store');
    // Level-2 run at T0: s1 slipped (overall 82%); the others held (credited at T0). s1 passed level 2 later; the list was cleared.
    store({
      sections: { s0: sec(2, T0), s1: sec(2, T0 + DAY), s2: sec(2, T0), s3: sec(3, T0) },
      full: { level: 1, best: { 1: 0.9, 2: 0.82 }, attempts: 2, lastPracticed: T0, lastPassed: T0 - DAY },
    }, [entry('all', 1, T0 - DAY, true), entry('all', 2, T0, false), entry('s1', 2, T0 + DAY, true, 0.9)]);
    expect(upgradeFullRuns('p', 'S', secs)).toBe(true);
    const full = getProgress('p', 'S')!.full!;
    expect(full.level).toBe(2);
    expect(full.lastPassed).toBe(T0 + DAY);
    // The passed level-1 run is a clean run.
    expect(full.clean).toEqual([1]);
    // Idempotent.
    expect(upgradeFullRuns('p', 'S', secs)).toBe(false);
  });

  it('not while a section is still to fix, nor from a run far off the mark; never lowers', async () => {
    const { upgradeFullRuns } = await import('./store');
    const sections = { s0: sec(3, T0), s1: sec(3, T0 + DAY), s2: sec(3, T0), s3: sec(3, T0) };
    store({ sections, full: { level: 1, best: { 1: 0.9, 3: 0.84 }, attempts: 2, lastPracticed: T0, toFix: { 3: ['s2'] }, clean: [1] } },
      [entry('all', 3, T0, false, 0.84)]);
    expect(upgradeFullRuns('p', 'S', secs)).toBe(true); // the list is checked and marked open
    expect(getProgress('p', 'S')!.full).toMatchObject({ level: 1, toFix: { 3: ['s2'] }, toFixLocks: { 3: true } });
    expect(upgradeFullRuns('p', 'S', secs)).toBe(false);
    // That list is open under the new rules: fixing s2 now grants level 3.
    expect(recordAttempt('p', 'S', 's2', 3, res(0.9), 10, T0 + 2 * DAY).reached).toMatchObject({ level: 3, newLevel: 3 });
    // A run 30 points under the mark (most of it slipped back then): no level from it.
    localStorage.clear(); _resetAllForTests();
    store({ sections, full: { level: 0, best: { 3: 0.5 }, attempts: 1, lastPracticed: T0 } }, [entry('all', 3, T0, false, 0.5)]);
    upgradeFullRuns('p', 'S', secs);
    expect(getProgress('p', 'S')!.full?.level).toBe(0);
    // A piece already above the run's level keeps its level.
    localStorage.clear(); _resetAllForTests();
    store({ sections, full: { level: 4, best: { 2: 0.82, 4: 0.9 }, attempts: 3, lastPracticed: T0 } }, [entry('all', 4, T0 - DAY, true), entry('all', 2, T0, false)]);
    upgradeFullRuns('p', 'S', secs);
    expect(getProgress('p', 'S')!.full).toMatchObject({ level: 4, clean: [4] });
  });

  it('a stale list from a run that would not open the level is dropped and never grants it', async () => {
    const { upgradeFullRuns } = await import('./store');
    const { pieceReadiness, nextStep } = await import('./ladder');
    // Piece level 1; an old level-4 run at 40% where all four sections slipped (no lock).
    const sections = { s0: sec(1, T0 - DAY), s1: sec(1, T0 - DAY), s2: sec(1, T0 - DAY), s3: sec(1, T0 - DAY) };
    const full = { level: 1, best: { 1: 0.9, 4: 0.4 }, attempts: 2, lastPracticed: T0, toFix: { 4: ['s0', 's1', 's2', 's3'] }, clean: [1] };
    store({ sections, full }, [entry('all', 1, T0 - DAY, true), entry('all', 4, T0, false, 0.4)]);
    // Before any upgrade: passing all four at level 4 on their own shrinks the list but grants nothing.
    for (const id of ['s0', 's1', 's2', 's3']) expect(recordAttempt('p', 'S', id, 4, res(0.9), 10, T0 + DAY).reached).toBeUndefined();
    expect(getProgress('p', 'S')!.full?.level).toBe(1);
    // The upgrade drops such a list outright.
    localStorage.clear(); _resetAllForTests();
    store({ sections, full }, [entry('all', 1, T0 - DAY, true), entry('all', 4, T0, false, 0.4)]);
    expect(upgradeFullRuns('p', 'S', secs)).toBe(true);
    expect(getProgress('p', 'S')!.full?.toFix).toBeUndefined();
    // Two of four listed but the run was 40%: dropped too; one of four with a run at 78%: kept, open.
    localStorage.clear(); _resetAllForTests();
    store({ sections, full: { ...full, best: { 4: 0.78 }, toFix: { 4: ['s1'], 3: ['s0', 's2'] } } },
      [entry('all', 3, T0 - DAY, false, 0.4), entry('all', 4, T0, false, 0.78)]);
    upgradeFullRuns('p', 'S', secs);
    const p = getProgress('p', 'S')!;
    expect(p.full).toMatchObject({ toFix: { 4: ['s1'] }, toFixLocks: { 4: true } });
    expect(pieceReadiness(secs, p).toFix).toEqual([{ level: 4, sectionIds: ['s1'] }]);
    expect(nextStep(secs, p)).toMatchObject({ sectionId: 's1', level: 4, kind: 'fix' });
  });

  it('a done list from a run that failed on timing (no section credited) grants nothing', async () => {
    const { upgradeFullRuns } = await import('./store');
    // Level-3 run at 92% that failed on timing: nothing credited, no list. Later every section passed level 3 on its own.
    const sections = { s0: sec(3, T0 + DAY), s1: sec(3, T0 + DAY), s2: sec(3, T0 + DAY), s3: sec(3, T0 + DAY) };
    store({ sections, full: { level: 1, best: { 3: 0.92 }, attempts: 1, lastPracticed: T0, clean: [] } },
      [entry('all', 3, T0, false, 0.92), ...['s0', 's1', 's2', 's3'].map((id) => entry(id, 3, T0 + DAY, true, 0.9))]);
    upgradeFullRuns('p', 'S', secs);
    expect(getProgress('p', 'S')!.full?.level).toBe(1);
  });

  it('clean-run stars from the history, or from the piece level when the log has none', async () => {
    const { upgradeFullRuns } = await import('./store');
    const sections = { s0: sec(3, T0), s1: sec(3, T0), s2: sec(3, T0), s3: sec(3, T0) };
    store({ sections, full: { level: 3, best: { 2: 0.9, 3: 0.88 }, attempts: 2 } }, [entry('all', 2, T0 - DAY, true), entry('all', 3, T0, true)]);
    upgradeFullRuns('p', 'S', secs);
    expect(getProgress('p', 'S')!.full?.clean).toEqual([2, 3]);
    // No log (a new phone, or trimmed): the piece level was a clean run at that level…
    localStorage.clear(); _resetAllForTests();
    store({ sections, full: { level: 3, best: { 3: 0.88 }, attempts: 1 } }, []);
    upgradeFullRuns('p', 'S', secs);
    expect(getProgress('p', 'S')!.full?.clean).toEqual([3]);
    // …or at level 5 when the piece was passed off book.
    localStorage.clear(); _resetAllForTests();
    store({ sections, full: { level: 4, best: { 5: 0.9 }, attempts: 1, offBookDays: ['2026-09-20'] } }, []);
    upgradeFullRuns('p', 'S', secs);
    expect(getProgress('p', 'S')!.full?.clean).toEqual([5]);
    // A record this version already wrote keeps its stars as they are.
    expect(upgradeFullRuns('p', 'S', secs)).toBe(false);
  });
});

describe('storage full (quota exceeded)', () => {
  const quota = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };

  it('the newest progress is what is read back after a failed write, and the singer is told once', () => {
    expect(recordAttempt('p', 'S', 's0', 1, res(0.9))).toMatchObject({ newLevel: 1 });
    const told = vi.fn();
    const off = onStorageSaveFailed(told);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(quota);
    try {
      expect(recordAttempt('p', 'S', 's0', 2, res(0.9))).toMatchObject({ passed: true, newLevel: 2 });
      expect(getProgress('p', 'S')!.sections.s0.level).toBe(2);
      expect(attemptLog()).toHaveLength(2);
      recordAttempt('p', 'S', 's0', 3, res(0.95));
      expect(getProgress('p', 'S')!.sections.s0.level).toBe(3);
      expect(storageSaveFailed()).toBe(true);
      expect(told).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); off(); }
    // The older copy on disk is kept as the fallback after a reload.
    expect(JSON.parse(localStorage.getItem('sh:progress:p:S')!).sections.s0.level).toBe(1);
    // Once there's room again, the write goes to disk and the memory copy no longer shadows it.
    recordAttempt('p', 'S', 's0', 3, res(0.95));
    expect(JSON.parse(localStorage.getItem('sh:progress:p:S')!).sections.s0.level).toBe(3);
    localStorage.setItem('sh:progress:p:S', JSON.stringify({ ...JSON.parse(localStorage.getItem('sh:progress:p:S')!), totalAttempts: 99 }));
    expect(getProgress('p', 'S')!.totalAttempts).toBe(99);
  });

  it('makes room by trimming the attempt log (never progress) and retries', () => {
    const old = Array.from({ length: 1500 }, (_, i) => ({ at: 1000 + i, pieceId: 'x', partId: 'S', sectionId: 'a', level: 1, accuracy: 0.5, score: 1, passed: false }));
    localStorage.setItem('sh:log', JSON.stringify(old));
    localStorage.setItem('sh:errors', '[]');
    const real = Storage.prototype.setItem;
    // Full until the log has been trimmed.
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      const log = this.getItem('sh:log');
      if (log && log.length > 100_000 && k !== 'sh:log') quota();
      return real.call(this, k, v);
    });
    try {
      recordAttempt('p', 'S', 's0', 1, res(0.9));
    } finally { spy.mockRestore(); }
    expect(storageSaveFailed()).toBe(false);
    expect(JSON.parse(localStorage.getItem('sh:progress:p:S')!).sections.s0.level).toBe(1);
    expect(localStorage.getItem('sh:errors')).toBeNull();
    const log = attemptLog();
    expect(log.length).toBeLessThan(400);
    expect(log[log.length - 1]).toMatchObject({ pieceId: 'p', sectionId: 's0' });
  });
});

describe('loadCycle validates its fields', () => {
  it('keeps good fields and drops bad ones', () => {
    localStorage.setItem('sh:cycle', JSON.stringify({
      name: 7, pieceIds: ['a', 3, null, 'b'], focusPieceIds: 'a', concertDate: '2026-12-01', rehearsalWeekday: 9,
      rehearsalTime: '19:30', wanted: [{ title: 'Vinea', composer: 'Victoria', focus: true }, { composer: 'x' }, 'y', { title: 'No composer' }],
    }));
    expect(loadCycle()).toEqual({
      name: 'This cycle', pieceIds: ['a', 'b'], concertDate: '2026-12-01', rehearsalTime: '19:30',
      wanted: [{ title: 'Vinea', composer: 'Victoria', focus: true }, { title: 'No composer', composer: '' }],
    });
  });
});

describe('schema 2: every level has a slow and an in-tempo step (migrateToSteps)', () => {
  const secs: Section[] = [0, 1, 2, 3].map((i) => ({
    id: `s${i}`, index: i, label: `Bars ${i * 4 + 1}–${i * 4 + 4}`, startMeasure: i * 4, endMeasure: i * 4 + 3, start: i * 8, end: i * 8 + 8,
  }));
  /** Progress as the previous version saved it: level 1 was 70% on "doo" (now Level 1 slow). */
  const v1 = () => ({
    pieceId: 'p', partId: 'S', totalAttempts: 12, bestScore: 900,
    sections: {
      s0: { level: 1, best: { 1: 0.92 }, attempts: 3, lastPassed: 1000, lastPracticed: 2000 },
      s1: { level: 2, best: { 1: 0.9, 2: 0.85 }, attempts: 4, lastPassed: 1000 },
      s2: { level: 0, best: { 1: 0.6 }, attempts: 1 },
      s3: { level: 4, best: { 4: 0.9 }, attempts: 2, offBookDays: ['2026-10-01'] },
    },
    full: { level: 1, best: { 1: 0.9 }, attempts: 2, lastPracticed: 3000, lastPassed: 3000, toFix: { 1: ['s2'], 3: ['s1'] }, toFixLocks: { 1: true, 3: true }, clean: [1] },
  });

  it('migrateToSteps: old Level 1 passes become Level 1 slow; levels ≥ 2 and their bests stay; Level 1 bests (sung slow) go', () => {
    const m = migrateToSteps(v1() as never);
    expect(m.sections.s0).toEqual({ level: 0, slow: 1, best: {}, attempts: 3, lastPassed: 1000, lastPracticed: 2000 });
    expect(m.sections.s1).toEqual({ ...v1().sections.s1, best: { 2: 0.85 } });
    expect(m.sections.s2).toEqual({ ...v1().sections.s2, best: {} });
    expect(m.sections.s3).toEqual(v1().sections.s3);
    expect(m.full).toEqual({ level: 0, best: {}, attempts: 2, lastPracticed: 3000, lastPassed: 3000, toFix: { 3: ['s1'] }, toFixLocks: { 3: true }, clean: [] });
    expect(currentStep(m.sections.s0)).toEqual({ level: 1, step: 'tempo' });
    // A full record above level 1 keeps its level; its level-1 list and star go.
    const f2 = migrateToSteps({ ...v1(), full: { level: 3, best: {}, attempts: 1, toFix: { 1: ['s2'] }, toFixLocks: { 1: true }, clean: [1, 3] } } as never).full!;
    expect(f2).toEqual({ level: 3, best: {}, attempts: 1, clean: [3] });
    // Idempotent.
    expect(migrateToSteps(m)).toEqual(m);
  });

  it('local storage is migrated once, on the first read', () => {
    localStorage.setItem('sh:schema', '1');
    localStorage.setItem('sh:progress:p:S', JSON.stringify(v1()));
    const p = getProgress('p', 'S')!;
    expect(p.sections.s0).toMatchObject({ level: 0, slow: 1 });
    expect(p.full).toMatchObject({ level: 0, clean: [] });
    expect(localStorage.getItem('sh:schema')).toBe(String(SCHEMA_VERSION));
    expect(SCHEMA_VERSION).toBe(2);
    // Once: a Level 1 reached in tempo after the update stays.
    recordAttempt('p', 'S', 's0', 1, res(0.9), undefined, undefined, { step: 'tempo' });
    // A reload: the schema is checked again, with what's stored.
    const kept = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)!]));
    _resetAllForTests();
    for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v);
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 1 });
    expect(getProgress('p', 'S')!.sections.s0.slow).toBeUndefined();
  });

  it('data without a schema stamp is never migrated (nothing saved yet, or the stamp could not be saved)', () => {
    localStorage.setItem('sh:progress:p:S', JSON.stringify(v1()));
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 1 });
    expect(localStorage.getItem('sh:schema')).toBe('2');
  });

  it('nobody loses a level: readiness only counts what was in tempo, Next up continues in tempo', () => {
    localStorage.setItem('sh:schema', '1');
    localStorage.setItem('sh:progress:p:S', JSON.stringify(v1()));
    const p = getProgress('p', 'S')!;
    expect(p.sections.s1.level).toBe(2);
    expect(pieceReadiness(secs, p).pieceLevel).toBe(0);
  });

  it('old level-1 log entries were slow: they never grant a piece level or a star', () => {
    expect(logStep({ level: 1 })).toBe('slow');
    expect(logStep({ level: 2 })).toBe('tempo');
    expect(logStep({ level: 1, step: 'tempo' })).toBe('tempo');
    const T = at(2026, 9, 20);
    localStorage.setItem('sh:schema', '1');
    // An old level-1 full run (70%) that left s1 to fix, fixed since: under the old rules that's level 1.
    localStorage.setItem('sh:progress:p:S', JSON.stringify({
      pieceId: 'p', partId: 'S', totalAttempts: 5, bestScore: 900,
      sections: Object.fromEntries(secs.map((x) => [x.id, { level: 1, best: { 1: 0.9 }, attempts: 1, lastPassed: T + DAY }])),
      full: { level: 0, best: { 1: 0.82 }, attempts: 1, lastPracticed: T },
    }));
    localStorage.setItem('sh:log', JSON.stringify([
      { at: T - DAY, pieceId: 'p', partId: 'S', sectionId: 'all', level: 1, accuracy: 0.9, score: 900, passed: true },
      { at: T, pieceId: 'p', partId: 'S', sectionId: 'all', level: 1, accuracy: 0.82, score: 800, passed: false },
      { at: T + DAY, pieceId: 'p', partId: 'S', sectionId: 's1', level: 1, accuracy: 0.9, score: 900, passed: true },
    ]));
    upgradeFullRuns('p', 'S', secs);
    const full = getProgress('p', 'S')!.full!;
    expect(full.level).toBe(0);
    expect(full.clean).toEqual([]);
  });

  it('a schema-1 backup is migrated on import; a schema-2 one is not', () => {
    const backup = (schema: number) => JSON.stringify({
      app: 'schonberg-hero', schema, exportedAt: 1,
      data: { 'sh:schema': String(schema), 'sh:progress:p:S': JSON.stringify(v1()) },
    });
    importBackup(backup(1));
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 0, slow: 1 });
    expect(getProgress('p', 'S')!.full?.level).toBe(0);
    importBackup(backup(2));
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 1 });
    // A backup without the schema key in its data: the file's own schema decides.
    importBackup(JSON.stringify({ app: 'schonberg-hero', schema: 1, exportedAt: 1, data: { 'sh:progress:p:S': JSON.stringify(v1()) } }));
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 0, slow: 1 });
    // What this version exports says schema 2 and comes back unchanged.
    recordAttempt('p', 'S', 's0', 1, res(0.9), undefined, undefined, { step: 'tempo' });
    const out = exportBackup();
    expect(JSON.parse(out).schema).toBe(2);
    importBackup(out);
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 1 });
  });

  it('a slow full run is practice; a counted full run in tempo credits held passages (ticking slow)', () => {
    localStorage.setItem('sh:schema', '2');
    recordAttempt('p', 'S', 's0', 2, res(0.9), undefined, undefined, { step: 'slow' });
    expect(getProgress('p', 'S')!.sections.s0).toMatchObject({ level: 0, slow: 2 });
    const notes = Array.from({ length: 32 }, (_, index) => ({ index, grade: 'perfect' as const, cents: 0, hitRatio: 1, voicedRatio: 1, onsetMs: 20, drift: null, scoop: null, targetOffset: 0, points: 0 }));
    const r: AttemptResult = { ...res(1), notes: notes as never };
    const slow = recordFullRun('p', 'S', 2, r, secs, (i) => i, { counted: true, step: 'slow' });
    expect(slow).toMatchObject({ counted: false, opened: false, newLevel: 0 });
    const tempo = recordFullRun('p', 'S', 2, r, secs, (i) => i, { counted: true, step: 'tempo' });
    expect(tempo).toMatchObject({ counted: true, passed: true, newLevel: 2 });
    expect(getProgress('p', 'S')!.sections.s0.level).toBe(2);
    expect(getProgress('p', 'S')!.sections.s0.slow).toBeUndefined();
  });
});
