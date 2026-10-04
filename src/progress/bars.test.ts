import { beforeEach, describe, expect, it } from 'vitest';
import { getBars, knownByHeart, mastery, recordBars, troubleSpots } from './bars';
import { _resetAllForTests } from './store';
import type { AttemptResult } from '../game/types';

const run = (perMeasure: Record<number, number>, insights: AttemptResult['insights'] = []): AttemptResult => ({
  accuracy: 0, pitch: 0, rhythm: 0, score: 0, maxCombo: 0, counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, notes: [], perMeasure, insights,
});

describe('bar history', () => {
  beforeEach(() => _resetAllForTests());
  it('blends recent runs, newer counting more', () => {
    recordBars('p', 'A', run({ 0: 0.2, 1: 1 }), 1, { now: 1 });
    recordBars('p', 'A', run({ 0: 1 }), 1, { now: 2 });
    const b = getBars('p', 'A');
    expect(b[0].ema).toBeCloseTo(0.68);
    expect(b[0].n).toBe(2);
    expect(mastery(b[1])).toBe('solid');
    expect(mastery(b[0])).toBe('ok');
    expect(mastery(b[5])).toBe('none');
  });
  it('keeps the coach issues for weak bars only', () => {
    recordBars('p', 'A', run({ 3: 0.3, 4: 0.9 }, [{ kind: 'flat-overall', title: '', detail: '', measures: [3, 4], severity: 2 }]), 1);
    const b = getBars('p', 'A');
    expect(b[3].issues).toEqual(['flat-overall']);
    expect(b[4].issues).toBeUndefined();
  });
  it('tracks what is known by heart; peeked bars do not count as memorised', () => {
    recordBars('p', 'A', run({ 0: 1, 1: 1 }), 1);
    expect(knownByHeart(getBars('p', 'A')[0])).toBe(false); // sung with names and guide
    recordBars('p', 'A', run({ 0: 1, 1: 1 }), 4);
    expect(knownByHeart(getBars('p', 'A')[0])).toBe(true);
    recordBars('p', 'A', run({ 0: 1, 1: 0.3 }), 5, { peeked: [0] });
    const b = getBars('p', 'A');
    expect(b[0].off).toBeUndefined();
    expect(knownByHeart(b[1])).toBe(false);
  });
  it('lists trouble spots as runs of weak bars, worst first', () => {
    recordBars('p', 'A', run({ 0: 1, 1: 0.2, 2: 0.3, 3: 1, 4: 0.5, 5: 1 }), 1);
    expect(troubleSpots(getBars('p', 'A'), [0, 1, 2, 3, 4, 5])).toEqual([[1, 2], [4, 4]]);
  });
});
