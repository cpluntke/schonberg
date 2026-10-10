// A note of the singer's part named in words for Results, in the singer's notation: "the raised B
// (B♯)", "the B♭", "the Si". In letter names a note outside the key signature says how it differs
// (raised / lowered / natural), as the mockups' FIXTURE asks ("the raised C (C♯)").
import type { KeySig, NoteSpelling } from '../../music/types';
import { noteLabel, spellNote, type NotationMode } from '../../game/notation';

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** "the raised B (B♯)", "the E", "the lowered B (B♭)", "the F natural (F♮)"; other notations: "the Si". */
export function noteInWords(midi: number, key: Pick<KeySig, 'fifths' | 'mode'>, notation: NotationMode, written?: Pick<NoteSpelling, 'letter' | 'alter'> | null): string {
  const text = noteLabel(midi, notation, key, written).text;
  if (notation !== 'letter') return `the ${text}`;
  const s = spellNote(midi, key, written);
  // The key signature's own form of this letter: the position with the same letter in the diatonic window [f-1, f+5].
  let k = key.fifths - 1;
  while (mod(k, 7) !== mod(s.lof, 7)) k++;
  const diff = (s.lof - k) / 7;
  if (diff > 0) return `the raised ${s.letter} (${text})`;
  if (diff < 0) return s.accidental === 0 ? `the ${s.letter} natural (${s.letter}♮)` : `the lowered ${s.letter} (${text})`;
  return `the ${text}`;
}
