import { describe, expect, it } from 'vitest';
import { mistakeSpots } from './mistakeSpots';

/** Wrong notes from bars (one note per entry; note index = position in the list). */
const w = (...bars: number[]) => bars.map((measure, index) => ({ index, measure }));
const ranges = (r: ReturnType<typeof mistakeSpots>) => r.spots.map((s) => [s.m0, s.m1]);

describe('mistakeSpots', () => {
  it('no wrong notes: no snippets', () => {
    expect(mistakeSpots([], { lo: 0, hi: 10 })).toEqual({ spots: [], hiddenBars: [] });
  });

  it('one wrong bar: it and a bar either side', () => {
    const r = mistakeSpots(w(4), { lo: 0, hi: 10 });
    expect(r.spots).toEqual([{ m0: 3, m1: 5, bars: [4], notes: [0] }]);
    expect(r.hiddenBars).toEqual([]);
  });

  it('context stays inside the run', () => {
    expect(ranges(mistakeSpots(w(0), { lo: 0, hi: 10 }))).toEqual([[0, 1]]);
    expect(ranges(mistakeSpots(w(10), { lo: 3, hi: 10 }))).toEqual([[9, 10]]);
    expect(ranges(mistakeSpots(w(3), { lo: 3, hi: 3 }))).toEqual([[3, 3]]);
  });

  it('several wrong notes in a bar are one bar', () => {
    const r = mistakeSpots(w(4, 4, 4), { lo: 0, hi: 10 });
    expect(r.spots).toEqual([{ m0: 3, m1: 5, bars: [4], notes: [0, 1, 2] }]);
  });

  it('nearby bars merge into one snippet of at most five bars', () => {
    expect(ranges(mistakeSpots(w(3, 5), { lo: 0, hi: 10 }))).toEqual([[2, 6]]);
    expect(ranges(mistakeSpots(w(3, 4, 5), { lo: 0, hi: 10 }))).toEqual([[2, 6]]);
    // 3 and 6: too far for one five-bar snippet; their context just touches.
    expect(ranges(mistakeSpots(w(3, 6), { lo: 0, hi: 10 }))).toEqual([[2, 4], [5, 7]]);
    // Far apart: separate snippets.
    expect(ranges(mistakeSpots(w(1, 9), { lo: 0, hi: 12 }))).toEqual([[0, 2], [8, 10]]);
  });

  it('no bar is shown twice', () => {
    // 3,4,5 merge (2–6); 6 starts the next snippet, so the first one stops at 5.
    const r = mistakeSpots(w(3, 4, 5, 6), { lo: 0, hi: 10 });
    expect(ranges(r)).toEqual([[2, 5], [6, 7]]);
    const all = r.spots.flatMap((s) => Array.from({ length: s.m1 - s.m0 + 1 }, (_, k) => s.m0 + k));
    expect(new Set(all).size).toBe(all.length);
  });

  it('mistakes everywhere: the worst three spots, in score order; the rest listed as hidden', () => {
    // Spots around 1, 10, 20 (three notes), 30 (two notes), 40.
    const r = mistakeSpots(w(1, 10, 20, 20, 20, 30, 30, 40), { lo: 0, hi: 45 });
    expect(r.spots.map((s) => s.bars)).toEqual([[1], [20], [30]]);
    expect(r.hiddenBars).toEqual([10, 40]);
    expect(r.spots[1].notes).toEqual([2, 3, 4]);
  });

  it('ties go to the earlier spot; dropped neighbours give their context back', () => {
    const r = mistakeSpots(w(2, 5, 8), { lo: 0, hi: 20, maxSpots: 2 });
    // 2 and 5 can't share five bars; all three weigh the same: the first two are kept.
    expect(r.spots.map((s) => s.bars)).toEqual([[2], [5]]);
    expect(ranges(r)).toEqual([[1, 3], [4, 6]]);
    expect(r.hiddenBars).toEqual([8]);
  });

  it('options: more context, longer snippets', () => {
    expect(ranges(mistakeSpots(w(5), { lo: 0, hi: 20, context: 2 }))).toEqual([[3, 7]]);
    expect(ranges(mistakeSpots(w(3, 8), { lo: 0, hi: 20, maxBars: 8 }))).toEqual([[2, 4], [7, 9]]);
    expect(ranges(mistakeSpots(w(3, 6), { lo: 0, hi: 20, maxBars: 8 }))).toEqual([[2, 7]]);
    // (a bar between their contexts: not nearby, whatever the length)
    expect(ranges(mistakeSpots(w(3, 7), { lo: 0, hi: 20, maxBars: 8 }))).toEqual([[2, 4], [6, 8]]);
  });
});
