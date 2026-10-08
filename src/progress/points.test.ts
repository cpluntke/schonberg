import { describe, it, expect, beforeEach } from 'vitest';
import { _resetAllForTests, loadCycle, saveCycle, loadProfile, saveProfile, recordAttempt, writeJSON, streakDays, addSyncedDays, dayKey } from './store';
import { addCyclePoints, cyclePoints, mergeSyncedPoints, rightNotes, currentCycle } from './points';
import { choirCycleNow, choirCycleNext } from './choir';
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
    expect(cyclePoints()).toMatchObject({ n: 8, name: 'Autumn' });
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
    expect(cyclePoints()).toMatchObject({ n: 0, name: 'Spring 2027' });
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

describe('dated cycles', () => {
  const cyc = (id: string, start: string, end?: string) => ({ id, name: id, start, ...(end ? { end } : {}), pieceIds: [] });
  it('the running cycle is the latest started one that has not ended; between cycles there is none', () => {
    const info = { cycle: null, cycles: [cyc('autumn', '2026-09-01', '2026-12-20'), cyc('spring', '2027-01-10')] };
    expect(choirCycleNow(info, '2026-08-31')).toBeNull();
    expect(choirCycleNow(info, '2026-09-01')?.id).toBe('autumn');
    expect(choirCycleNow(info, '2026-12-20')?.id).toBe('autumn');
    expect(choirCycleNow(info, '2026-12-21')).toBeNull();
    expect(choirCycleNext(info, '2026-12-21')?.id).toBe('spring');
    expect(choirCycleNow(info, '2027-01-10')?.id).toBe('spring');
    // an older server: its one programme
    expect(choirCycleNow({ cycle: { name: 'X', pieceIds: [] } }, '2027-01-10')?.name).toBe('X');
  });

  it('a cycle runs until its end or the next start: an earlier one never comes back; a same-day tie goes to the later made', () => {
    const at = (c: ReturnType<typeof cyc>, createdAt: number) => ({ ...c, createdAt });
    const info = { cycle: null, cycles: [cyc('year', '2026-01-01'), cyc('week', '2026-09-10', '2026-09-15')] };
    expect(choirCycleNow(info, '2026-09-12')?.id).toBe('week');
    expect(choirCycleNow(info, '2026-09-20')).toBeNull();
    // two starting the same day (older cycles without createdAt come first)
    const tie = { cycle: null, cycles: [at(cyc('b', '2026-11-01'), 20), at(cyc('a', '2026-11-01'), 10), cyc('old', '2026-11-01')] };
    expect(choirCycleNow(tie, '2026-11-01')?.id).toBe('b');
    expect(choirCycleNext(tie, '2026-10-01')?.id).toBe('b');
  });

  it('points follow the dated cycle; a count kept under the programme name carries over', () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    writeJSON('sh:cyclePoints', { k: 'choir:kammerchor:autumn', n: 40, since: 1 });
    writeJSON('sh:choir', { code: 'kammerchor', name: 'K', cycle: null, cycles: [cyc('autumn', '2000-01-01')], pieces: [], updatedAt: 1, leads: [] });
    expect(cyclePoints().n).toBe(40);
    expect(addCyclePoints(2)).toBe(42);
    expect(currentCycle().key).toBe('choir:kammerchor:#autumn');
    // the next cycle starts: back to 0
    writeJSON('sh:choir', { code: 'kammerchor', name: 'K', cycle: null, cycles: [cyc('autumn', '2000-01-01', '2000-02-01'), cyc('winter', '2000-02-02')], pieces: [], updatedAt: 2, leads: [] });
    expect(cyclePoints()).toMatchObject({ n: 0, name: 'winter' });
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
