import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AttemptResult } from '../game/types';
import type { Section } from '../music/types';
import type { Score } from '../music/types';
import {
  _resetAllForTests, loadProfile, saveProfile, getProgress, recordAttempt, attemptLog, streakDays,
  dueForReview, practiceMinutes, loadCycle, saveCycle, exportBackup, importBackup, subscribe,
  personalBest, snapshotReadiness, readinessHistory, saveImportedScore, loadImportedScores,
  deleteImportedScore, LOG_CAP, DEFAULT_PROFILE,
} from './store';

const DAY = 86_400_000;
const res = (accuracy: number, score = Math.round(accuracy * 1000)): AttemptResult => ({
  accuracy, pitch: accuracy, rhythm: accuracy, score, maxCombo: 0,
  counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, notes: [], perMeasure: {}, insights: [],
});
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

beforeEach(() => { localStorage.clear(); _resetAllForTests(); });

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
  it('pass / fail at thresholds', () => {
    expect(recordAttempt('p', 'S', 's0', 1, res(0.74))).toEqual({ passed: false, newLevel: 0, prevLevel: 0 });
    expect(recordAttempt('p', 'S', 's0', 1, res(0.75))).toEqual({ passed: true, newLevel: 1, prevLevel: 0 });
    expect(recordAttempt('p', 'S', 's0', 2, res(0.79))).toEqual({ passed: false, newLevel: 1, prevLevel: 1 });
    expect(recordAttempt('p', 'S', 's0', 2, res(0.8))).toEqual({ passed: true, newLevel: 2, prevLevel: 1 });
    // passing a lower level never lowers
    expect(recordAttempt('p', 'S', 's0', 1, res(0.99))).toEqual({ passed: true, newLevel: 2, prevLevel: 2 });
    const sp = getProgress('p', 'S')!.sections.s0;
    expect(sp.attempts).toBe(5);
    expect(sp.best[1]).toBe(0.99);
    expect(sp.best[2]).toBe(0.8);
    expect(getProgress('p', 'S')!.bestScore).toBe(990);
    expect(personalBest('p', 'S', 's0', 2)).toEqual({ accuracy: 0.8, score: 800 });
    expect(personalBest('p', 'S', 's0', 4)).toBeNull();
    expect(attemptLog()).toHaveLength(5);
  });
  it('skip ahead', () => {
    expect(recordAttempt('p', 'S', 's1', 4, res(0.84))).toMatchObject({ passed: false, newLevel: 0 });
    expect(recordAttempt('p', 'S', 's1', 4, res(0.86))).toEqual({ passed: true, newLevel: 4, prevLevel: 0 });
  });
  it('level 0 listen only updates lastPracticed', () => {
    const r = recordAttempt('p', 'S', 's2', 0, res(0), undefined, 1000);
    expect(r).toEqual({ passed: false, newLevel: 0, prevLevel: 0 });
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
