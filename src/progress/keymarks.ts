// Where the key marks of a piece live: a choir piece's come from the choir (set by its admins, see
// setChoirPieceKeys); a singer's own import keeps them on this phone.

import type { KeySig, Score } from '../music/types';
import { cleanMarks, nameKeys, type KeyMark } from '../music/keymarks';
import { cachedChoir, localPieceId, type ChoirPiece } from './choir';
import { readJSON, subscribe, writeJSON } from './store';

const LOCAL = 'sh:keyMarks';

/** The choir piece a choir score came from (from the cached choir details). */
export function choirPieceOf(score: Pick<Score, 'id' | 'choir'>): ChoirPiece | null {
  if (!score.choir) return null;
  const info = cachedChoir();
  if (!info || info.code !== score.choir) return null;
  return info.pieces.find((p) => localPieceId(info.code, p) === score.id) ?? null;
}

export function marksFor(score: Pick<Score, 'id' | 'choir' | 'measures'>): KeyMark[] {
  const raw = score.choir ? choirPieceOf(score)?.keys : readJSON<Record<string, unknown>>(LOCAL, {})[score.id];
  return cleanMarks(raw, score.measures.length);
}

export function saveLocalMarks(id: string, marks: KeyMark[]): void {
  const all = readJSON<Record<string, unknown>>(LOCAL, {});
  if (marks.length) all[id] = marks;
  else delete all[id];
  writeJSON(LOCAL, all);
}

// Any stored change (a sync, a saved mark) may change the marks: recomputed on the next use.
let version = 0;
subscribe(() => { version++; });
const memo = new WeakMap<Score, { v: number; keys: KeySig[] }>();

/** Changes whenever the score's name keys change (for layout caches). */
export function nameKeysSig(score: Score): string {
  return nameKeysOf(score).map((k) => `${k.beat}:${k.fifths}:${k.mode}`).join(',');
}

/** The keys the note names (movable do, jianpu) and the "Do = …" hints follow. */
export function nameKeysOf(score: Score): KeySig[] {
  const m = memo.get(score);
  if (m && m.v === version) return m.keys;
  const keys = nameKeys(score, marksFor(score));
  memo.set(score, { v: version, keys });
  return keys;
}
