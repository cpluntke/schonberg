// Results, level 1: what went wrong with a note, in a few words.
import type { NoteResult } from '../../game/types';
import { pitchPhrase, pitchTag } from '../../game/pitchwords';

export type FaultKind = 'missed' | 'octave' | 'wrong' | 'flat' | 'sharp' | 'short' | 'unsteady';

/** What went wrong with a note: the kind, and the deviation in cents (rounded) when it was sung. */
export interface Fault {
  kind: FaultKind;
  cents: number | null;
  /** A wrong note: about this many semitones off. */
  semitones?: number;
}

/** What went wrong with a note (see noteFault for the words). */
export function faultOf(n: NoteResult, tol: number): Fault {
  if (n.clearly === 'silent' || n.cents == null || n.voicedRatio < 0.2) return { kind: 'missed', cents: null };
  const c = Math.round(n.cents);
  // Big misses in plain words: an octave, or about N semitones; cents only for small deviations.
  if (n.octave || Math.abs(Math.abs(c) - 1200) <= 60) return { kind: 'octave', cents: c };
  if (Math.abs(c) > 150) return { kind: 'wrong', cents: c, semitones: Math.round(Math.abs(c) / 100) };
  if (c <= -tol) return { kind: 'flat', cents: c };
  if (c >= tol) return { kind: 'sharp', cents: c };
  return { kind: n.voicedRatio < 0.6 ? 'short' : 'unsteady', cents: c };
}

/** What went wrong with a note, in a few words ("clearly flat (62 cents)", "not sung"). */
export function noteFault(n: NoteResult, tol: number): string {
  const f = faultOf(n, tol);
  const c = f.cents ?? 0;
  const dir = c < 0 ? 'low' : 'high';
  switch (f.kind) {
    case 'missed': return 'not sung';
    case 'octave': return `sung an octave ${dir}`;
    case 'wrong': return `a wrong note (about ${f.semitones === 1 ? 'a semitone' : `${f.semitones} semitones`} ${dir})`;
    case 'flat':
    case 'sharp': return pitchPhrase(c);
    case 'short': return 'too short (late or cut off)';
    case 'unsteady': return 'not steady on the note';
  }
}

/** The fault as a short tag over the note in the mistake score ("↓ clearly flat", "not sung"). */
export function faultTag(f: Fault): string {
  const c = f.cents ?? 0;
  const arrow = c < 0 ? '↓' : '↑';
  switch (f.kind) {
    case 'missed': return 'not sung';
    case 'octave': return `octave ${arrow}`;
    case 'wrong': return `${arrow} ${f.semitones} semitone${f.semitones === 1 ? '' : 's'}`;
    case 'flat':
    case 'sharp': return pitchTag(c);
    case 'short': return 'too short';
    case 'unsteady': return 'unsteady';
  }
}
