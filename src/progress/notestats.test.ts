import { beforeEach, describe, expect, it } from 'vitest';
import type { NoteResult } from '../game/types';
import { _resetAllForTests } from './store';
import { getNoteStats, mainFault, recordNotes, sharedNotes } from './notestats';

const note = (index: number, o: Partial<NoteResult> = {}): NoteResult => ({
  index, grade: 'perfect', cents: 0, hitRatio: 1, voicedRatio: 1, onsetMs: 0, drift: 0, scoop: 0, targetOffset: 0, points: 100, ...o,
} as NoteResult);
const flat = (i: number) => note(i, { grade: 'miss', cents: -70, hitRatio: 0.1 });
const silent = (i: number) => note(i, { grade: 'miss', cents: null, voicedRatio: 0, hitRatio: 0, clearly: 'silent' });

beforeEach(() => { localStorage.clear(); _resetAllForTests(); });

describe('per-note history (the section cheat sheet)', () => {
  it('keeps how often a note went wrong lately and how; one wrong run (sight-reading) is not shared; notes sung right drop out', () => {
    recordNotes('p', 'P1', { notes: [note(0), flat(1), silent(2)] }, 35, 1);
    expect(sharedNotes('p', 'P1')).toEqual({}); // (once is not "keeps going wrong")
    recordNotes('p', 'P1', { notes: [note(0), flat(1), note(2)] }, 35, 2);
    const m = getNoteStats('p', 'P1');
    expect(m[0]).toBeUndefined();
    expect(m[1]).toMatchObject({ n: 2, at: 2 });
    expect(m[1].w).toBeCloseTo(0.64);
    expect(mainFault(m[1])).toBe('flat');
    expect(m[2].w).toBeCloseTo(0.24);
    expect(mainFault(m[2])).toBe('missed');
    expect(sharedNotes('p', 'P1')).toEqual({ 1: [0.64, 'flat'] });
    // Fixed: sung right a few times, it fades and is no longer shared, then dropped.
    for (let t = 3; t < 5; t++) recordNotes('p', 'P1', { notes: [note(1)] }, 35, t);
    expect(getNoteStats('p', 'P1')[1].w).toBeLessThan(0.5);
    expect(sharedNotes('p', 'P1')).toEqual({});
    for (let t = 5; t < 14; t++) recordNotes('p', 'P1', { notes: [note(1)] }, 35, t);
    expect(getNoteStats('p', 'P1')[1]).toBeUndefined();
  });
  it('the usual fault follows recent runs; a note the tracker could not judge says nothing', () => {
    recordNotes('p', 'P1', { notes: [silent(4)] }, 35);
    for (let t = 0; t < 3; t++) recordNotes('p', 'P1', { notes: [flat(4)] }, 35);
    expect(mainFault(getNoteStats('p', 'P1')[4])).toBe('flat');
    recordNotes('p', 'P1', { notes: [note(5, { grade: 'miss', unsure: 'range' as never })] }, 35);
    expect(getNoteStats('p', 'P1')[5]).toBeUndefined();
    expect(Object.keys(sharedNotes('p', 'P1'))).toEqual(['4']);
    expect(sharedNotes('p', 'P1')[4][1]).toBe('flat');
  });
});
