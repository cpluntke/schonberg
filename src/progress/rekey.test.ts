import { beforeEach, describe, expect, it } from 'vitest';
import { _resetAllForTests, loadCycle, saveCycle } from './store';
import { hasPieceData, movePieceData } from './rekey';

const OLD = 'choir-continuo-50b86de43dc9';
const NEW = 'debussy-yver';
const sec = (level: number, at: number) => ({ level, bestScore: level * 100, attempts: 1, passedLevels: [], lastPlayed: at });

beforeEach(() => {
  localStorage.clear();
  _resetAllForTests();
});

describe('a piece moving to its library id', () => {
  it('moves everything, merging with what the library id already had (newer practice is never lost)', () => {
    // Under the library id: level 1 long ago (from when the piece was built in). Under the old id: level 4 today.
    localStorage.setItem(`sh:progress:${NEW}:P1`, JSON.stringify({ pieceId: NEW, partId: 'P1', sections: { s0: sec(1, 1) } }));
    localStorage.setItem(`sh:progress:${OLD}:P1`, JSON.stringify({ pieceId: OLD, partId: 'P1', sections: { s0: sec(4, 1000), s1: sec(2, 900) } }));
    localStorage.setItem(`sh:part:${OLD}`, 'P1');
    localStorage.setItem(`sh:notes:${OLD}:P1`, JSON.stringify({ 3: { n: 5, w: 0.8, at: 9 }, 7: { n: 1, w: 0.4, at: 9 } }));
    localStorage.setItem(`sh:notes:${NEW}:P1`, JSON.stringify({ 3: { n: 2, w: 0.1, at: 1 }, 8: { n: 4, w: 0.6, at: 1 } }));
    localStorage.setItem(`sh:words:${OLD}:P1`, JSON.stringify({ s0: { passed: 2, best: { 0: 0.9, 2: 0.8 }, at: 5 } }));
    localStorage.setItem(`sh:words:${NEW}:P1`, JSON.stringify({ s0: { passed: 0, best: { 0: 0.95 }, at: 1 } }));
    localStorage.setItem('sh:readiness2', JSON.stringify({ [`${OLD}|P1`]: { '2026-10-07': 30 }, [`${NEW}|P1`]: { '2026-03-01': 5 } }));
    localStorage.setItem('sh:log', JSON.stringify([{ at: 1, pieceId: OLD, partId: 'P1' }, { at: 2, pieceId: 'other', partId: 'P1' }]));
    localStorage.setItem('sh:seenSections', JSON.stringify([`${OLD}|P1|s0`, `${NEW}|P1|s0`]));
    localStorage.setItem('sh:lastRunPiece', JSON.stringify({ pieceId: OLD, at: 3 }));
    saveCycle({ ...loadCycle(), pieceIds: [OLD, 'x'], focusPieceIds: [OLD] });
    expect(hasPieceData(OLD)).toBe(true);

    movePieceData(OLD, NEW);

    const prog = JSON.parse(localStorage.getItem(`sh:progress:${NEW}:P1`)!);
    expect(prog.sections.s0.level).toBe(4);
    expect(prog.sections.s1.level).toBe(2);
    expect(prog).toMatchObject({ pieceId: NEW, partId: 'P1' });
    expect(localStorage.getItem(`sh:progress:${OLD}:P1`)).toBeNull();
    expect(localStorage.getItem(`sh:part:${NEW}`)).toBe('P1');
    // Per-note history: per note, the one from more runs.
    expect(JSON.parse(localStorage.getItem(`sh:notes:${NEW}:P1`)!)).toEqual({ 3: { n: 5, w: 0.8, at: 9 }, 7: { n: 1, w: 0.4, at: 9 }, 8: { n: 4, w: 0.6, at: 1 } });
    expect(localStorage.getItem(`sh:notes:${OLD}:P1`)).toBeNull();
    expect(JSON.parse(localStorage.getItem(`sh:words:${NEW}:P1`)!).s0).toEqual({ passed: 2, best: { 0: 0.95, 2: 0.8 }, at: 5 });
    expect(JSON.parse(localStorage.getItem('sh:readiness2')!)).toEqual({ [`${NEW}|P1`]: { '2026-03-01': 5, '2026-10-07': 30 } });
    expect(JSON.parse(localStorage.getItem('sh:log')!).map((e: { pieceId: string }) => e.pieceId)).toEqual([NEW, 'other']);
    expect(JSON.parse(localStorage.getItem('sh:seenSections')!)).toEqual([`${NEW}|P1|s0`]);
    expect(JSON.parse(localStorage.getItem('sh:lastRunPiece')!).pieceId).toBe(NEW);
    expect(loadCycle()).toMatchObject({ pieceIds: [NEW, 'x'], focusPieceIds: [NEW] });
    expect(hasPieceData(OLD)).toBe(false);
    // Moved without a merge (nothing under the new id yet): the record names the new id too.
    localStorage.setItem(`sh:progress:${OLD}:P2`, JSON.stringify({ pieceId: OLD, partId: 'P2', sections: { s0: sec(2, 7) } }));
    movePieceData(OLD, NEW);
    expect(JSON.parse(localStorage.getItem(`sh:progress:${NEW}:P2`)!)).toMatchObject({ pieceId: NEW, partId: 'P2' });

    // Again: nothing changes.
    const before = JSON.stringify({ ...localStorage });
    movePieceData(OLD, NEW);
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
});
