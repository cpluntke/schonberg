import { describe, expect, it } from 'vitest';
import type { NoteResult } from '../../game/types';
import { faultOf, faultTag, noteFault } from './noteFault';

const n = (o: Partial<NoteResult>): NoteResult => ({
  index: 0, grade: 'miss', cents: 0, hitRatio: 0, voicedRatio: 1, onsetMs: 0, drift: null, scoop: null, targetOffset: 0, points: 0, ...o,
});

describe('noteFault', () => {
  it('small deviations in cents, big ones in plain words', () => {
    expect(noteFault(n({ cents: -64 }), 50)).toBe('clearly flat (64 cents)');
    expect(noteFault(n({ cents: 90 }), 50)).toBe('clearly sharp (90 cents)');
    expect(noteFault(n({ cents: -140 }), 50)).toBe('clearly flat (140 cents)');
    expect(noteFault(n({ cents: -1000 }), 50)).toBe('a wrong note (about 10 semitones low)');
    expect(noteFault(n({ cents: 190 }), 50)).toBe('a wrong note (about 2 semitones high)');
    expect(noteFault(n({ cents: -1195 }), 50)).toBe('sung an octave low');
    expect(noteFault(n({ cents: 1200, octave: true }), 50)).toBe('sung an octave high');
    expect(noteFault(n({ cents: null, voicedRatio: 0 }), 50)).toBe('not sung');
    expect(noteFault(n({ cents: 10, voicedRatio: 0.4 }), 50)).toBe('too short (late or cut off)');
  });
});

describe('faultOf / faultTag', () => {
  it('kinds and short tags', () => {
    const tag = (o: Partial<NoteResult>) => faultTag(faultOf(n(o), 50));
    expect(faultOf(n({ cents: -64 }), 50)).toEqual({ kind: 'flat', cents: -64 });
    expect(tag({ cents: -64 })).toBe('↓ clearly flat');
    expect(faultTag(faultOf(n({ cents: -30 }), 25))).toBe('↓ a little flat');
    expect(tag({ cents: 90 })).toBe('↑ clearly sharp');
    expect(tag({ cents: -1000 })).toBe('↓ 10 semitones');
    expect(tag({ cents: 120 * 1.5 })).toBe('↑ 2 semitones');
    expect(tag({ cents: 160 })).toBe('↑ 2 semitones');
    expect(tag({ cents: -1195 })).toBe('octave ↓');
    expect(tag({ cents: null, voicedRatio: 0 })).toBe('not sung');
    expect(tag({ cents: 10, voicedRatio: 0.4 })).toBe('too short');
    expect(tag({ cents: 10, voicedRatio: 0.9 })).toBe('unsteady');
  });
});
