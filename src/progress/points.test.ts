import { describe, it, expect, beforeEach } from 'vitest';
import { _resetAllForTests, loadCycle, saveCycle, loadProfile, saveProfile, recordAttempt, writeJSON, streakDays, addSyncedDays, dayKey } from './store';
import { addCyclePoints, cyclePoints, mergeSyncedPoints, rightNotes, currentCycle } from './points';
import { failsInARow, firstTime } from './struggle';
import { parseHash, href } from '../ui/router';
import type { AttemptResult, NoteResult } from '../game/types';

const note = (grade: NoteResult['grade'], extra: Partial<NoteResult> = {}): NoteResult =>
  ({ index: 0, grade, cents: 0, coverage: 1, onsetMs: 0, ...extra } as NoteResult);
const result = (notes: NoteResult[], accuracy = 1): AttemptResult => ({ notes, accuracy, score: 100, perMeasure: {}, insights: [] } as unknown as AttemptResult);

beforeEach(() => { localStorage.clear(); _resetAllForTests?.(); });

describe('cycle points', () => {
  it('count notes sung right and start again in a new cycle', () => {
    saveCycle({ ...loadCycle(), name: 'Autumn' });
    expect(rightNotes(result([note('perfect'), note('good'), note('ok'), note('miss'), note('ok', { unsure: 'mic' })]))).toBe(2);
    addCyclePoints(5);
    expect(addCyclePoints(3)).toBe(8);
    expect(cyclePoints()).toEqual({ n: 8, name: 'Autumn' });
    saveCycle({ ...loadCycle(), name: 'Spring' });
    expect(cyclePoints().n).toBe(0);
    // Renamed back before singing: nothing was lost yet.
    saveCycle({ ...loadCycle(), name: 'Autumn' });
    expect(cyclePoints().n).toBe(8);
    saveCycle({ ...loadCycle(), name: 'Spring' });
    expect(addCyclePoints(2)).toBe(2);
    saveCycle({ ...loadCycle(), name: 'Autumn' });
    expect(cyclePoints().n).toBe(0);
  });

  it("a choir's cycle is its programme name, not the singer's local one", () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    writeJSON('sh:choir', { code: 'kammerchor', name: 'K', cycle: { name: 'Advent 2026', pieceIds: [] }, pieces: [], updatedAt: 1, leads: [] });
    saveCycle({ ...loadCycle(), name: 'my own name' });
    expect(currentCycle()).toEqual({ key: 'choir:kammerchor:advent 2026', name: 'Advent 2026' });
    addCyclePoints(4);
    writeJSON('sh:choir', { code: 'kammerchor', name: 'K', cycle: { name: 'Spring 2027', pieceIds: [] }, pieces: [], updatedAt: 2, leads: [] });
    expect(cyclePoints()).toEqual({ n: 0, name: 'Spring 2027' });
  });

  it('the account copy keeps the larger count of the same cycle, and only takes the current cycle', () => {
    saveCycle({ ...loadCycle(), name: 'Autumn' });
    addCyclePoints(10);
    mergeSyncedPoints({ k: 'own:autumn', n: 25, since: 1 });
    expect(cyclePoints().n).toBe(25);
    mergeSyncedPoints({ k: 'own:autumn', n: 3, since: 1 });
    expect(cyclePoints().n).toBe(25);
    mergeSyncedPoints({ k: 'own:summer', n: 99, since: 1 });
    expect(cyclePoints().n).toBe(25);
    mergeSyncedPoints({ k: 'own:autumn', n: -1 });
    mergeSyncedPoints('junk');
    expect(cyclePoints().n).toBe(25);
  });
});

describe('streak days from the account copy', () => {
  it('practice on another phone keeps the streak going', () => {
    const now = new Date(2026, 9, 7, 12);
    recordAttempt('p', 'P1', 's1', 1, result([note('good')]), 10, now.getTime());
    expect(streakDays(now)).toBe(1);
    addSyncedDays([dayKey(new Date(2026, 9, 6, 12)), dayKey(new Date(2026, 9, 5, 12)), 'nonsense', 5]);
    expect(streakDays(now)).toBe(3);
  });
});

describe('struggling', () => {
  it('counts the misses in a row at a level; a pass ends the count; other sections and levels are apart', () => {
    const bad = result([note('miss')], 0.2);
    const good = result([note('perfect')], 1);
    recordAttempt('p', 'P1', 's1', 2, bad);
    recordAttempt('p', 'P1', 's1', 2, good);
    recordAttempt('p', 'P1', 's1', 2, bad);
    recordAttempt('p', 'P1', 's2', 2, bad);
    recordAttempt('p', 'P1', 's1', 3, bad);
    recordAttempt('p', 'P1', 's1', 2, bad);
    expect(failsInARow('p', 'P1', 's1', 2)).toBe(2);
    expect(failsInARow('p', 'P1', 's1', 3)).toBe(1);
    expect(failsInARow('p', 'P1', 's3', 2)).toBe(0);
  });

  it('first time: never sung nor listened to', () => {
    expect(firstTime(undefined)).toBe(true);
    expect(firstTime({ level: 0, best: {}, attempts: 0 })).toBe(true);
    expect(firstTime({ level: 0, best: {}, attempts: 0, lastPracticed: 1 })).toBe(false);
    expect(firstTime({ level: 0, best: {}, attempts: 1 })).toBe(false);
  });
});

describe('routes', () => {
  it('carry a slow tempo and the level to sing after listening', () => {
    const r = parseHash('#/play/p/P1/s1?level=2&rate=0.7');
    expect(r).toMatchObject({ name: 'play', level: 2, rate: 0.7 });
    expect(parseHash('#/play/p/P1/s1?level=2&rate=1.5')).not.toHaveProperty('rate');
    expect(parseHash('#/play/p/P1/s1?level=0&after=3')).toMatchObject({ level: 0, after: 3 });
    expect(parseHash('#/play/p/P1/s1?level=2&after=3')).not.toHaveProperty('after');
    expect(parseHash(href({ name: 'play', pieceId: 'p', partId: 'P1', sectionId: 's1', level: 0, mode: '2d', after: 2 }))).toMatchObject({ level: 0, after: 2 });
  });
});
