import { describe, expect, it } from 'vitest';
import { cleanMarks, keyAtBeatIn, keyAtTimeIn, nameKeys } from './keymarks';
import { keyHint } from '../game/notation';
import type { KeySig, Measure } from './types';

const measures: Measure[] = Array.from({ length: 10 }, (_, i) => ({
  index: i, number: String(i + 1), startBeat: i * 4, durBeats: 4, start: i * 2, dur: 2, timeSig: [4, 4],
}));
const key = (beat: number, fifths: number, mode: 'major' | 'minor' = 'major'): KeySig => ({ beat, time: beat / 2, fifths, mode });

describe('key marks', () => {
  it('without marks the names follow the key signatures', () => {
    const keys = [key(0, 0), key(20, 2)];
    expect(nameKeys({ keys, measures }, [])).toBe(keys);
  });

  it('a mark moves do from its bar until the next mark or key signature', () => {
    const keys = [key(0, 0), key(32, -1)];
    const nk = nameKeys({ keys, measures }, [{ bar: 3, fifths: 1, mode: 'major' }]);
    expect(nk.map((k) => [k.beat, k.fifths])).toEqual([[0, 0], [12, 1], [32, -1]]);
    expect(keyAtBeatIn(nk, 11).fifths).toBe(0);
    expect(keyAtBeatIn(nk, 12).fifths).toBe(1);
    expect(keyAtBeatIn(nk, 31).fifths).toBe(1);
    expect(keyAtTimeIn(nk, 16).fifths).toBe(-1);
  });

  it('"back to the key signature" restores the written key; a mark at a key change wins', () => {
    const keys = [key(0, 4, 'minor'), key(24, 0)];
    const nk = nameKeys({ keys, measures }, [{ bar: 2, fifths: 1, mode: 'major' }, { bar: 4 }, { bar: 6, fifths: -2, mode: 'major' }]);
    expect(nk.map((k) => [k.beat, k.fifths, k.mode])).toEqual([[0, 4, 'minor'], [8, 1, 'major'], [16, 4, 'minor'], [24, -2, 'major']]);
  });

  it('a mark at bar 1 corrects the mode of the whole piece', () => {
    const nk = nameKeys({ keys: [key(0, 4)], measures }, [{ bar: 0, fifths: 4, mode: 'minor' }]);
    expect(nk).toEqual([key(0, 4, 'minor')]);
  });

  it('keeps only well-formed marks, one per bar, within the piece', () => {
    expect(cleanMarks([{ bar: 5, fifths: 1, mode: 'major' }, { bar: 2 }, { bar: 5, fifths: 2, mode: 'minor' }, { bar: -1 }, { bar: 1.5 },
      { bar: 3, fifths: 9, mode: 'major' }, { bar: 4, fifths: 1, mode: 'lydian' }, { bar: 12 }, null, 'x'], 10))
      .toEqual([{ bar: 2 }, { bar: 5, fifths: 2, mode: 'minor' }]);
    expect(cleanMarks('nope')).toEqual([]);
  });

  it('hints name do (movable), 1 (jianpu) or the key', () => {
    const cs = { fifths: 4, mode: 'minor' as const };
    expect(keyHint('movable', cs)).toBe('Do = E');
    expect(keyHint('jianpu', cs)).toBe('1 = E');
    expect(keyHint('letter', cs)).toBe('C♯ minor');
    expect(keyHint('fixed', cs)).toBe('Do♯ minor');
    expect(keyHint('pc', cs)).toBeNull();
    expect(keyHint('movable', { fifths: -3, mode: 'major' })).toBe('Do = E♭');
  });
});
