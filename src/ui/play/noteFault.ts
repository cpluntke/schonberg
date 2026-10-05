// Results, level 1: what went wrong with a note, in a few words.
import type { NoteResult } from '../../game/types';

/** What went wrong with a note, in a few words ("flat (−62¢)", "not sung"). */
export function noteFault(n: NoteResult, tol: number): string {
  if (n.clearly === 'silent' || n.cents == null || n.voicedRatio < 0.2) return 'not sung';
  const c = Math.round(n.cents);
  const dir = c < 0 ? 'low' : 'high';
  // Big misses in plain words: an octave, or about N semitones; cents only for small deviations.
  if (n.octave || Math.abs(Math.abs(c) - 1200) <= 60) return `sung an octave ${dir}`;
  if (Math.abs(c) > 150) {
    const st = Math.round(Math.abs(c) / 100);
    return `a wrong note (about ${st === 1 ? 'a semitone' : `${st} semitones`} ${dir})`;
  }
  if (c <= -tol) return `flat (−${-c}¢)`;
  if (c >= tol) return `sharp (+${c}¢)`;
  return n.voicedRatio < 0.6 ? 'too short (late or cut off)' : 'not steady on the note';
}
