// Note-name rendering for the five notation modes, plus interval and key names.
//
// Spelling model: every pitch is placed on the line of fifths (C=0, G=1, D=2, … F=-1, B♭=-2 …).
// Diatonic notes of the key use the key's own spelling (so F♯ major has E♯, G♭ major has C♭);
// chromatic notes use a natural letter when one exists, otherwise sharps in sharp keys and flats
// in flat keys. In minor keys the raised 7th (leading tone) is always spelled as such (E♯ in
// F♯ minor, C♯ in D minor).

import type { KeySig } from '../music/types';

export type NotationMode = 'letter' | 'fixed' | 'movable' | 'jianpu' | 'pc';

export interface NoteLabel {
  text: string;
  dotsAbove: number;
  dotsBelow: number;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Letters in line-of-fifths order starting at C. */
const LOF_LETTERS = 'CGDAEBF';
/** Letters in scale order. */
const SCALE_LETTERS = 'CDEFGAB';
const FIXED_SYLLABLES: Record<string, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

interface Spelled {
  /** Position on the line of fifths. */
  lof: number;
  letter: string;
  /** -2..2 */
  accidental: number;
}

function fromLof(k: number): Spelled {
  return { lof: k, letter: LOF_LETTERS[mod(k, 7)], accidental: Math.floor((k + 1) / 7) };
}

function accidentalSymbol(a: number): string {
  switch (a) {
    case 0: return '';
    case 1: return '♯';
    case -1: return '♭';
    case 2: return '𝄪';
    case -2: return '𝄫';
    default: return a > 0 ? '♯'.repeat(a) : '♭'.repeat(-a);
  }
}

/** Line-of-fifths position k with 7k ≡ pc (mod 12), closest to `center`. */
function lofNear(pc: number, center: number): number {
  const k0 = mod(7 * pc, 12); // 7*7 = 49 ≡ 1 (mod 12)
  let best = k0;
  for (let k = k0 - 36; k <= k0 + 36; k += 12) if (Math.abs(k - center) < Math.abs(best - center)) best = k;
  return best;
}

/** Spell a pitch class in a key. */
export function spellPc(pc: number, key: Pick<KeySig, 'fifths' | 'mode'>): Spelled {
  pc = mod(Math.round(pc), 12);
  const f = key.fifths;
  // Diatonic window of the (relative) major scale: [f-1, f+5].
  for (let k = f - 1; k <= f + 5; k++) if (mod(7 * k, 12) === pc) return fromLof(k);
  // Minor: raised 7th of the minor tonic (tonic at f+3, leading tone 5 fifths higher).
  if (key.mode === 'minor' && mod(7 * (f + 8), 12) === pc) return fromLof(f + 8);
  // Natural letter if possible.
  for (let k = -1; k <= 5; k++) if (mod(7 * k, 12) === pc) return fromLof(k);
  if (f > 0) return fromLof(lofNear(pc, 9)); // sharps: positions 6..12
  if (f < 0) return fromLof(lofNear(pc, -5)); // flats: positions -8..-2
  // C major / A minor: C♯ E♭ F♯ A♭ B♭
  const cMajor: Record<number, number> = { 1: 7, 3: -3, 6: 6, 8: -4, 10: -2 };
  return fromLof(cMajor[pc]);
}

function spellName(s: Spelled): string {
  return s.letter + accidentalSymbol(s.accidental);
}

/** Scale degree (0..6) of a spelled note relative to `do` (line-of-fifths position of do), plus alteration. */
function degreeOf(s: Spelled, doLof: number): { degree: number; alt: number } {
  const rel = s.lof - doLof;
  const base = mod(rel + 1, 7) - 1; // -1..5
  const alt = (rel - base) / 7;
  const DEG: Record<number, number> = { [-1]: 3, 0: 0, 1: 4, 2: 1, 3: 5, 4: 2, 5: 6 };
  return { degree: DEG[base], alt };
}

const MOVABLE_DIATONIC = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];
const MOVABLE_SHARP: Record<number, string> = { 0: 'Di', 1: 'Ri', 3: 'Fi', 4: 'Si', 5: 'Li' };
const MOVABLE_FLAT: Record<number, string> = { 1: 'Ra', 2: 'Me', 4: 'Se', 5: 'Le', 6: 'Te' };
// Fallbacks by semitones above do: [degree, alteration]
const SHARP_TABLE: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLAT_TABLE: [number, number][] = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];

function relativeDegree(midi: number, key: Pick<KeySig, 'fifths' | 'mode'>): { degree: number; alt: number } {
  const s = spellPc(midi, key);
  const d = degreeOf(s, key.fifths);
  const syllableExists = d.alt === 0 || (d.alt === 1 && d.degree in MOVABLE_SHARP) || (d.alt === -1 && d.degree in MOVABLE_FLAT);
  if (syllableExists) return d;
  const semis = mod(Math.round(midi) - mod(7 * key.fifths, 12), 12);
  const [degree, alt] = (d.alt > 0 ? SHARP_TABLE : FLAT_TABLE)[semis];
  return { degree, alt };
}

const PC_SYMBOLS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 't', 'e'];

/** Symbol for a pitch class in 0..11 notation (t = 10, e = 11). */
export function pcSymbol(pc: number): string {
  return PC_SYMBOLS[mod(Math.round(pc), 12)];
}

export function noteLabel(midi: number, mode: NotationMode, key: Pick<KeySig, 'fifths' | 'mode'>): NoteLabel {
  const m = Math.round(midi);
  const plain = (text: string): NoteLabel => ({ text, dotsAbove: 0, dotsBelow: 0 });
  switch (mode) {
    case 'pc':
      return plain(pcSymbol(m));
    case 'letter':
      return plain(spellName(spellPc(m, key)));
    case 'fixed': {
      const s = spellPc(m, key);
      return plain(FIXED_SYLLABLES[s.letter] + accidentalSymbol(s.accidental));
    }
    case 'movable': {
      const { degree, alt } = relativeDegree(m, key);
      const text = alt === 0 ? MOVABLE_DIATONIC[degree] : alt > 0 ? MOVABLE_SHARP[degree] : MOVABLE_FLAT[degree];
      return plain(text);
    }
    case 'jianpu': {
      const { degree, alt } = relativeDegree(m, key);
      const text = accidentalSymbol(alt) + String(degree + 1);
      // Reference octave: the octave starting at "1" (do) whose pitch lies in [55, 66].
      const doPc = mod(7 * key.fifths, 12);
      const refDo = 55 + mod(doPc - 55, 12);
      const MAJOR = [0, 2, 4, 5, 7, 9, 11];
      // Pitch of the degree's natural (diatonic) form; its octave decides the dots.
      const natural = m - alt;
      const degreeSemis = MAJOR[degree];
      const octave = Math.floor((natural - degreeSemis - refDo + 6) / 12);
      return { text, dotsAbove: Math.max(0, octave), dotsBelow: Math.max(0, -octave) };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Intervals

const SIMPLE_SHORT = ['P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7'];
const SIMPLE_NUMBER = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7];
const SIMPLE_QUALITY = ['perfect', 'minor', 'major', 'minor', 'major', 'perfect', 'augmented', 'perfect', 'minor', 'major', 'minor', 'major'];
const ORDINALS = ['', 'unison', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'octave', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth',
  'nineteenth', 'twentieth', 'twenty-first', 'twenty-second'];

/** Short interval name for an (unsigned) number of semitones: "P1", "m3", "TT", "P8", "M9", "A11", "P15"… */
export function intervalName(semitones: number): string {
  const s = Math.abs(Math.round(semitones));
  if (s < 12) return SIMPLE_SHORT[s];
  const octaves = Math.floor(s / 12);
  const r = s % 12;
  if (r === 0) return 'P' + (1 + 7 * octaves);
  const n = SIMPLE_NUMBER[r] + 7 * octaves;
  const q = SIMPLE_SHORT[r] === 'TT' ? 'A' : SIMPLE_SHORT[r][0];
  return q + n;
}

/** Long interval name: "minor third", "tritone", "octave", "major ninth", "augmented eleventh"… */
export function intervalLongName(semitones: number): string {
  const s = Math.abs(Math.round(semitones));
  if (s === 0) return 'unison';
  if (s === 6) return 'tritone';
  if (s === 12) return 'octave';
  if (s === 24) return 'two octaves';
  const octaves = Math.floor(s / 12);
  const r = s % 12;
  const n = r === 0 ? 1 + 7 * octaves : SIMPLE_NUMBER[r] + 7 * octaves;
  const quality = r === 0 ? 'perfect' : SIMPLE_QUALITY[r];
  const ord = ORDINALS[n] ?? `${n}th`;
  return `${quality} ${ord}`;
}

// ---------------------------------------------------------------------------------------------
// Keys

/** Tonic spelling of a key, e.g. "F♯" for {fifths: 3, mode: 'minor'}. */
export function keyTonicName(key: Pick<KeySig, 'fifths' | 'mode'>): string {
  return spellName(fromLof(key.fifths + (key.mode === 'minor' ? 3 : 0)));
}

/** "D major", "F♯ minor". */
export function keyName(key: Pick<KeySig, 'fifths' | 'mode'>): string {
  return `${keyTonicName(key)} ${key.mode}`;
}
