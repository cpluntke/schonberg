import { describe, expect, it } from 'vitest';
import type { NoteResult } from '../../game/types';
import { noteFault } from './noteFault';

const n = (o: Partial<NoteResult>): NoteResult => ({
  index: 0, grade: 'miss', cents: 0, hitRatio: 0, voicedRatio: 1, onsetMs: 0, drift: null, scoop: null, targetOffset: 0, points: 0, ...o,
});

describe('noteFault', () => {
  it('small deviations in cents, big ones in plain words', () => {
    expect(noteFault(n({ cents: -64 }), 50)).toBe('flat (−64¢)');
    expect(noteFault(n({ cents: 90 }), 50)).toBe('sharp (+90¢)');
    expect(noteFault(n({ cents: -140 }), 50)).toBe('flat (−140¢)');
    expect(noteFault(n({ cents: -1000 }), 50)).toBe('a wrong note (about 10 semitones low)');
    expect(noteFault(n({ cents: 190 }), 50)).toBe('a wrong note (about 2 semitones high)');
    expect(noteFault(n({ cents: -1195 }), 50)).toBe('sung an octave low');
    expect(noteFault(n({ cents: 1200, octave: true }), 50)).toBe('sung an octave high');
    expect(noteFault(n({ cents: null, voicedRatio: 0 }), 50)).toBe('not sung');
    expect(noteFault(n({ cents: 10, voicedRatio: 0.4 }), 50)).toBe('too short (late or cut off)');
  });
});
