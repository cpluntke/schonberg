import { describe, expect, it } from 'vitest';
import { noteInWords } from './noteName';

const B_MAJOR = { fifths: 5, mode: 'major' as const };
const C_MAJOR = { fifths: 0, mode: 'major' as const };
const G_MAJOR = { fifths: 1, mode: 'major' as const };

describe('noteInWords', () => {
  it('names a note in the key plainly, a chromatic one as raised or lowered', () => {
    // B♯4 (sounds as C5 = 72), written B♯, in B major (C♯ is in the key, B♯ is a raised B).
    expect(noteInWords(72, B_MAJOR, 'letter', { letter: 6, alter: 1 })).toBe('the raised B (B♯)');
    expect(noteInWords(73, B_MAJOR, 'letter', { letter: 0, alter: 1 })).toBe('the C♯');
    expect(noteInWords(70, C_MAJOR, 'letter', { letter: 6, alter: -1 })).toBe('the lowered B (B♭)');
    expect(noteInWords(65, G_MAJOR, 'letter', { letter: 3, alter: 0 })).toBe('the F natural (F♮)');
    expect(noteInWords(60, C_MAJOR, 'letter')).toBe('the C');
  });
  it('other notations use their own names', () => {
    expect(noteInWords(67, C_MAJOR, 'movable')).toBe('the Sol');
    expect(noteInWords(60, C_MAJOR, 'fixed')).toBe('the Do');
  });
});
