import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AttemptResult } from '../game/types';
import type { Section } from '../music/types';
import type { Score } from '../music/types';
import {
  _resetAllForTests, loadProfile, saveProfile, getProgress, recordAttempt, attemptLog, streakDays,
  dueForReview, practiceMinutes, loadCycle, saveCycle, exportBackup, importBackup, subscribe,
  personalBest, snapshotReadiness, readinessHistory, saveImportedScore, loadImportedScores,
  deleteImportedScore, LOG_CAP, DEFAULT_PROFILE, practiceDisplay,
} from './store';

const DAY = 86_400_000;
const res = (accuracy: number, score = Math.round(accuracy * 1000)): AttemptResult => ({
  accuracy, pitch: accuracy, rhythm: accuracy, score, maxCombo: 0,
  counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, notes: [], perMeasure: {}, insights: [],
});
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

beforeEach(() => { localStorage.clear(); _resetAllForTests(); });

describe('practice display migration', () => {
  it('singers who practised before the score view keep the highway, once, with the news card', () => {
    recordAttempt('p', 'S', 'a', 1, res(0.9), 30);
    // A profile saved before the migration existed:
    localStorage.setItem('sh:profile', JSON.stringify({ ...DEFAULT_PROFILE, onboarded: true }));
    const p = loadProfile();
    expect(p).toMatchObject({ display: 'highway', scoreViewNews: true, displayMigrated: true });
    expect(practiceDisplay(p, 1)).toBe('highway');
    // Choosing Automatic later sticks (the migration doesn't run again).
    saveProfile({ ...p, display: undefined, scoreViewNews: false });
    expect(loadProfile().display).toBeUndefined();
    expect(practiceDisplay(loadProfile(), 1)).toBe('score');
  });

  it('new singers keep Automatic (score at levels 1–2)', () => {
    saveProfile({ ...DEFAULT_PROFILE, onboarded: true });
    const p = loadProfile();
    expect(p.display).toBeUndefined();
    expect(p.scoreViewNews).toBeFalsy();
    expect(p.displayMigrated).toBe(true);
    recordAttempt('p', 'S', 'a', 1, res(0.9), 30);
    expect(loadProfile().display).toBeUndefined();
  });

  it('an explicit choice is kept', () => {
    recordAttempt('p', 'S', 'a', 1, res(0.9), 30);
    localStorage.setItem('sh:profile', JSON.stringify({ ...DEFAULT_PROFILE, onboarded: true, display: 'score' }));
    expect(loadProfile()).toMatchObject({ display: 'score' });
    expect(loadProfile().scoreViewNews).toBeFalsy();
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

  it('a counted full run that passes grants the piece level and credits every section', async () => {
    const { recordFullRun } = await import('./store');
    const { pieceReadiness } = await import('./ladder');
    const now = at(2026, 10, 5);
    const r = recordFullRun('p', 'S', 3, run(allGood), secs, noteStart, { ...counted, now });
    expect(r).toMatchObject({ counted: true, overallPassed: true, passed: true, prevLevel: 0, newLevel: 3, toFix: [] });
    expect(r.sections.map((x) => x.passed)).toEqual([true, true, true]);
    const prog = getProgress('p', 'S')!;
    expect(prog.full).toMatchObject({ level: 3, attempts: 1, lastPassed: now });
    expect(prog.sections.s1).toMatchObject({ level: 3, lastPassed: now });
    expect(pieceReadiness(secs, prog)).toMatchObject({ pieceLevel: 3, rehearsalReady: true, concertReady: false });
    expect(attemptLog().at(-1)).toMatchObject({ sectionId: 'all', level: 3, passed: true });
    expect(personalBest('p', 'S', 'all', 3)?.accuracy).toBeCloseTo(run(allGood).accuracy);
  });

  it('an overall pass with a section below the mark does not grant the level; the section is to fix', async () => {
    const { recordFullRun } = await import('./store');
    const r = recordFullRun('p', 'S', 3, run(oneSlips), secs, noteStart, counted);
    expect(r.overallPassed).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.newLevel).toBe(0);
    expect(r.toFix).toEqual(['s1']);
    const prog = getProgress('p', 'S')!;
    expect(prog.full?.toFix).toEqual({ 3: ['s1'] });
    // The sections that held are credited; the one that slipped isn't.
    expect(prog.sections.s0.level).toBe(3);
    expect(prog.sections.s1).toBeUndefined();
  });

  it('to-fix sections block the full run until each passes on its own', async () => {
    const { recordFullRun } = await import('./store');
    recordFullRun('p', 'S', 3, run(oneSlips), secs, noteStart, counted);
    // A full run at 3 now can't count, however good.
    const blocked = recordFullRun('p', 'S', 3, run(allGood), secs, noteStart, counted);
    expect(blocked).toMatchObject({ counted: false, passed: false, newLevel: 0, blocked: ['s1'] });
    expect(attemptLog().at(-1)?.sectionId).toBe('practice');
    // A failed or lower-level section run doesn't fix it.
    expect(recordAttempt('p', 'S', 's1', 3, res(0.6)).fixed).toBeUndefined();
    expect(recordAttempt('p', 'S', 's1', 2, res(0.95)).fixed).toBeUndefined();
    // Passing it at level 3 on its own does.
    expect(recordAttempt('p', 'S', 's1', 3, res(0.9)).fixed).toEqual([{ level: 3, remaining: 0 }]);
    expect(getProgress('p', 'S')!.full?.toFix).toBeUndefined();
    const r = recordFullRun('p', 'S', 3, run(allGood), secs, noteStart, counted);
    expect(r).toMatchObject({ counted: true, passed: true, newLevel: 3 });
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

  it('a beginner’s failed high-level run never locks or leads, even when some sections held', async () => {
    const { recordFullRun } = await import('./store');
    const { nextStep, fixesBefore } = await import('./ladder');
    const miss8: G[] = Array(8).fill('miss');
    const perfect8: G[] = Array(8).fill('perfect');
    // Two sections at level 4: one perfect, one all missed (50% overall).
    const two = secs.slice(0, 2);
    recordFullRun('p', 'S', 4, run([...perfect8, ...miss8]), two, noteStart, counted);
    let prog = getProgress('p', 'S')!;
    expect(prog.sections.s0.level).toBe(4); // the section that held is credited…
    expect(fixesBefore(two, prog, 4)).toEqual([]); // …but its own credit doesn't make the list lock
    expect(nextStep(two, prog)).toMatchObject({ sectionId: 's1', level: 1, kind: 'section' });
    // Three sections at level 3, two held, overall 67%: no lock either.
    _resetAllForTests(); localStorage.clear();
    recordFullRun('p', 'S', 3, run([...perfect8, ...perfect8, ...miss8]), secs, noteStart, counted);
    prog = getProgress('p', 'S')!;
    expect(fixesBefore(secs, prog, 3)).toEqual([]);
    expect(nextStep(secs, prog)?.kind).toBe('section');
  });

  it('a section with no real score is never credited, slack or not', async () => {
    const { recordFullRun } = await import('./store');
    // s2 has a single missed note.
    const one = (i: number) => (i < 16 ? i : i === 16 ? 17 : undefined);
    const r = recordFullRun('p', 'S', 3, run([...good8, ...good8, 'miss']), secs, one, counted);
    expect(r.sections[2]).toMatchObject({ id: 's2', accuracy: 0, passed: false });
    expect(getProgress('p', 'S')!.sections.s2).toBeUndefined();
  });

  it('a new singer failing a run far above their level gets no lock and keeps their Next up', async () => {
    const { recordFullRun } = await import('./store');
    const { nextStep, fixesBefore } = await import('./ladder');
    const bad: G[] = [...half8, ...half8, ...half8];
    const r = recordFullRun('p', 'S', 5, run(bad), secs, noteStart, counted);
    expect(r.toFix).toEqual(['s0', 's1', 's2']);
    const prog = getProgress('p', 'S')!;
    expect(fixesBefore(secs, prog, 5)).toEqual([]);
    expect(nextStep(secs, prog)).toMatchObject({ sectionId: 's0', level: 1, kind: 'section' });
    // Trying level 5 again counts (no lock).
    expect(recordFullRun('p', 'S', 5, run(bad), secs, noteStart, counted).counted).toBe(true);
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
    expect(r).toMatchObject({ counted: true, overallPassed: false, passed: false, toFix: [] });
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
