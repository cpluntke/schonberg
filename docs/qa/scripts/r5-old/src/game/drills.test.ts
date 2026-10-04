import { describe, expect, it } from 'vitest';
import { entryNotes, hardestIntervals } from './drills';
import { makePart } from './testutil';

describe('hardestIntervals', () => {
  const part = makePart('T', [
    [60, 1], [62, 1], // M2
    [66, 1], // M3
    [60, 1], // -TT
    [70, 1], // m7
    [71, 1], // m2
    [57, 1], // -M9
    [64, 1], // P5
    [null, 4],
    [76, 1], // after a long rest: entry, not an interval
    [60, 1], // -M10
    [70, 1], // m7 again (duplicate)
  ]);
  it('ranks ninths, sevenths and tritones first, skipping duplicates and rests', () => {
    const r = hardestIntervals(part, 4);
    expect(r.map((x) => x.semitones)).toEqual([-14, -16, 10, -6]);
    expect(r[0]).toEqual({ index: 6, semitones: -14, measure: 1 });
  });
  it('n limits the result', () => expect(hardestIntervals(part, 2)).toHaveLength(2));
});

describe('entryNotes', () => {
  const part = makePart('A', [[60, 1], [62, 1], [null, 1], [64, 1], [null, 0.25], [65, 1], [null, 2], [67, 1]]);
  it('finds notes after rests ≥ 0.5 s (and the first note)', () => expect(entryNotes(part)).toEqual([0, 2, 4]));
  it('custom threshold', () => {
    expect(entryNotes(part, 0.2)).toEqual([0, 2, 3, 4]);
    expect(entryNotes(part, 1.5)).toEqual([0, 4]);
  });
});
