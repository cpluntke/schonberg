// Mode inference: many MusicXML files (and most MIDI files) say "major" — or nothing — for a piece
// in the relative minor. The key signature is right; only the mode is missing. The mode matters
// for spelling notes without a written spelling (the raised 7th of the minor: B♯, not C♮, in
// C♯ minor) and for key names. Conservative: only ever turns "major" into "minor", and only when
// the music clearly centres on the relative minor's tonic.
import type { KeySig, Score } from './types';

const mod = (n: number, m: number) => ((n % m) + m) % m;

export interface ModeEvidence {
  /** Notes in the key's stretch. */
  notes: number;
  /** Pitch class of the lowest note of the last sonority / of the first one (-1: none). */
  finalBass: number;
  firstBass: number;
  /** Share of notes on the relative minor's raised 7th (leading tone). */
  leadingTone: number;
}

interface N { midi: number; startBeat: number; durBeats: number }

/** Lowest pitch class sounding at beat `t` (a note starting there or held over it). */
function bassAt(notes: N[], t: number): number {
  let lo = Infinity;
  for (const n of notes) if (n.startBeat <= t + 1e-3 && n.startBeat + n.durBeats > t + 1e-3 && n.midi < lo) lo = n.midi;
  return lo === Infinity ? -1 : mod(lo, 12);
}

/** Evidence for the relative minor of `fifths` from the notes of one key's stretch. */
export function modeEvidence(notes: N[], fifths: number): ModeEvidence {
  if (!notes.length) return { notes: 0, finalBass: -1, firstBass: -1, leadingTone: 0 };
  let first = Infinity;
  let last = -Infinity;
  for (const n of notes) {
    first = Math.min(first, n.startBeat);
    last = Math.max(last, n.startBeat);
  }
  const lt = mod(7 * (fifths + 3) - 1, 12);
  const ltCount = notes.filter((n) => mod(n.midi, 12) === lt).length;
  return { notes: notes.length, finalBass: bassAt(notes, last), firstBass: bassAt(notes, first), leadingTone: ltCount / notes.length };
}

/**
 * Is a stretch whose key signature has `fifths` in the relative minor? Yes when it ends on the
 * minor tonic in the bass and the minor's leading tone is used (a Picardy third still counts),
 * or when it starts on the minor tonic, doesn't end on the major tonic and the leading tone is
 * frequent. A major piece rarely raises its 5th degree that often (only as a passing V of vi).
 */
export function looksMinor(e: ModeEvidence, fifths: number): boolean {
  if (e.notes < 12) return false;
  const majorTonic = mod(7 * fifths, 12);
  const minorTonic = mod(majorTonic + 9, 12);
  if (e.finalBass === majorTonic) return false;
  if (e.finalBass === minorTonic) return e.leadingTone >= 0.01;
  return e.firstBass === minorTonic && e.leadingTone >= 0.03;
}

/** Turn "major" keys whose music is clearly in the relative minor into "minor" (in place). */
export function inferModes(score: Pick<Score, 'keys' | 'parts'>): void {
  const keys: KeySig[] = score.keys;
  keys.forEach((k, i) => {
    if (k.mode === 'minor') return;
    const from = k.beat - 1e-6;
    const to = i + 1 < keys.length ? keys[i + 1].beat - 1e-6 : Infinity;
    const notes: N[] = [];
    for (const p of score.parts) for (const n of p.notes) if (n.startBeat >= from && n.startBeat < to) notes.push(n);
    if (looksMinor(modeEvidence(notes, k.fifths), k.fifths)) k.mode = 'minor';
  });
}
