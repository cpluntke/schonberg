import { describe, expect, it } from 'vitest';
import { groupPieces, pieceRowStatus, readySince } from './pieces';
import type { PathStatus } from './path';

const P = (id: string, title: string, o: { own?: boolean; builtin?: boolean } = {}) => ({ id, title, builtin: !!o.builtin, own: !!o.own });

describe('groupPieces', () => {
  const all = [
    P('abend', 'Abendlied'), P('dieu', "Dieu! qu'il la fait"), P('schaffe', 'Schaffe in mir, Gott'),
    P('locus', 'Locus iste', { own: true }), P('old', 'An old own import', { own: true }),
    P('nicolette', 'Nicolette'), P('warmup-chorale', 'Warm-up chorale', { builtin: true }),
  ];
  const cycle = {
    pieceIds: ['abend', 'dieu', 'locus', 'schaffe', 'gone'],
    wanted: [{ title: 'Ave verum corpus', composer: 'Mozart' }, { title: 'Locus iste', composer: 'Bruckner' }],
  };

  it('the programme in its order, own imports apart, the rest under more', () => {
    const g = groupPieces(all, cycle);
    expect(g.programme.map((p) => p.id)).toEqual(['abend', 'dieu', 'schaffe']);
    expect(g.own.map((p) => p.id)).toEqual(['locus', 'old']);
    expect(g.more.map((p) => p.id)).toEqual(['nicolette', 'warmup-chorale']);
  });

  it('a wanted piece is coming until a piece of that title is in the programme', () => {
    expect(groupPieces(all, cycle).coming.map((w) => w.title)).toEqual(['Ave verum corpus']);
    expect(groupPieces(all, { pieceIds: [] }).coming).toEqual([]);
  });
});

const ps = (o: Partial<PathStatus>): PathStatus => ({
  pieceLevel: 0, filled: 0, waitDay: false, working: { level: 1, step: 'slow' }, done: [], todo: [], fixes: [], half: false, allInTempo: false, here: '', ...o,
});

describe('pieceRowStatus (the fixture wording)', () => {
  it('Dieu!: working on Level 1 · slow, 3 of 4 passages', () => {
    expect(pieceRowStatus(ps({ done: ['a', 'b', 'c'], todo: ['d'] }), true, 4)).toEqual({ text: 'Working on Level 1 · slow · 3 of 4 passages', done: false });
  });
  it('Abendlied: Level 3 reached ✓ while nothing of Level 4 is passed yet', () => {
    expect(pieceRowStatus(ps({ pieceLevel: 3, filled: 3, working: { level: 4, step: 'slow' } }), true, 4)).toEqual({ text: 'Level 3 reached ✓', done: true });
  });
  it('Locus iste: Level 2 slow passed everywhere → working on Level 2 · in tempo', () => {
    expect(pieceRowStatus(ps({ pieceLevel: 1, filled: 1, half: true, working: { level: 2, step: 'tempo' } }), true, 3).text).toBe('Working on Level 2 · in tempo');
  });
  it('a piece just started, one not started, a fix list, a level to confirm, memorised', () => {
    expect(pieceRowStatus(ps({}), true, 1).text).toBe('Working on Level 1 · slow');
    expect(pieceRowStatus(ps({}), false, 4)).toEqual({ text: 'Not started', done: false });
    expect(pieceRowStatus(ps({ pieceLevel: 1, working: { level: 2, step: 'tempo' }, fixes: ['a', 'b'] }), true, 4).text).toBe('Working on Level 2 · 2 passages to fix');
    expect(pieceRowStatus(ps({ allInTempo: true, half: true, done: ['a', 'b'], working: { level: 1, step: 'tempo' } }), true, 2).text).toBe('Level 1 in every passage · sing it all through');
    expect(pieceRowStatus(ps({ pieceLevel: 5, working: null }), true, 4)).toEqual({ text: 'Level 5 reached ✓', done: true });
  });
  it('never says Level 0', () => {
    for (const s of [ps({}), ps({ working: null })]) expect(pieceRowStatus(s, true, 3).text).not.toMatch(/Level 0/);
  });
});

describe('readySince', () => {
  const words = (t: number) => (t === 8 ? 'Thu 8 Oct' : String(t));
  it('the highest milestone, with its date when known', () => {
    expect(readySince(3, { 1: 1, 3: 8 }, words)).toBe('Rehearsal-ready since Thu 8 Oct');
    expect(readySince(4, { 3: 8 }, words)).toBe('Concert-ready');
    expect(readySince(2, { 2: 8 }, words)).toBeNull();
  });
});
