// Per-note history of a singer's part: how often each note has gone wrong lately, and how (flat,
// sharp, a wrong note, not sung…). Shared with the section lead only as section counts (the
// rehearsal cheat sheet: utils/schonberg_insights.py on the server); never per singer.
//
// Stored per piece + part in localStorage (`sh:notes:<piece>:<part>`), keyed by note index.

import type { AttemptResult } from '../game/types';
import { faultOf, type FaultKind } from '../ui/play/noteFault';
import { noteVerdict } from './ladder';
import { readJSON, writeJSON } from './store';

export interface NoteStat {
  /** Runs that judged this note. */
  n: number;
  /** Recent share of runs where it went wrong (0..1, recent runs count more). */
  w: number;
  /** How it went wrong, recent runs counting more. */
  k?: Partial<Record<FaultKind, number>>;
  /** Last time sung (ms). */
  at: number;
}
export type NoteMap = Record<number, NoteStat>;

/** A new run weighs this much against the history (as the bar history, a little less). */
const NEW_WEIGHT = 0.4;
/** Older fault kinds fade by this much with each new wrong run of the note. */
const KIND_DECAY = 0.7;
/** Notes kept per piece and part (the most often wrong). */
const MAX_NOTES = 600;
/** Shared: notes wrong in at least this share of recent runs, at most this many per piece. */
export const SHARE_MIN = 0.25;
export const SHARE_MAX = 150; // (the server keeps at most 150 per piece)

export const notesKey = (pieceId: string, partId: string) => `sh:notes:${pieceId}:${partId}`;
const isMap = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function getNoteStats(pieceId: string, partId: string): NoteMap {
  return readJSON<NoteMap>(notesKey(pieceId, partId), {}, isMap);
}

/** Fold one run's notes in (`tol`: the run's tolerance in cents, for the kind of fault). */
export function recordNotes(pieceId: string, partId: string, result: Pick<AttemptResult, 'notes'>, tol: number, now = Date.now()): NoteMap {
  const map: NoteMap = { ...getNoteStats(pieceId, partId) };
  for (const note of result.notes) {
    const v = noteVerdict(note);
    if (v === 'forgiven') continue; // (the tracker couldn't tell: says nothing about the singer)
    const wrong = v === 'wrong' ? 1 : 0;
    const old = map[note.index];
    const s: NoteStat = old ? { ...old, k: old.k ? { ...old.k } : undefined } : { n: 0, w: 0, at: now };
    s.w = s.n === 0 ? wrong : NEW_WEIGHT * wrong + (1 - NEW_WEIGHT) * s.w;
    s.n++;
    s.at = now;
    if (wrong) {
      const k: Partial<Record<FaultKind, number>> = {};
      for (const [kind, c] of Object.entries(s.k ?? {})) if (c * KIND_DECAY >= 0.05) k[kind as FaultKind] = Math.round(c * KIND_DECAY * 100) / 100;
      const kind = faultOf(note, tol).kind;
      k[kind] = (k[kind] ?? 0) + 1;
      s.k = k;
    }
    s.w = Math.round(s.w * 1000) / 1000;
    // A note sung right again and again: nothing worth keeping.
    if (s.w < 0.02) delete map[note.index];
    else map[note.index] = s;
  }
  const ids = Object.keys(map);
  if (ids.length > MAX_NOTES) {
    ids.sort((a, b) => map[Number(b)].w - map[Number(a)].w);
    for (const id of ids.slice(MAX_NOTES)) delete map[Number(id)];
  }
  writeJSON(notesKey(pieceId, partId), map);
  return map;
}

/** The usual fault of a note (the kind seen most, recent runs counting more). */
export function mainFault(s: NoteStat): FaultKind | null {
  let best: FaultKind | null = null;
  let bestN = 0;
  for (const [kind, c] of Object.entries(s.k ?? {})) if (c > bestN) { best = kind as FaultKind; bestN = c; }
  return best;
}

/** For sharing with the section: note index → [share of recent runs wrong, usual fault]. */
export function sharedNotes(pieceId: string, partId: string): Record<string, [number, FaultKind]> {
  const map = getNoteStats(pieceId, partId);
  const out: [string, [number, FaultKind]][] = [];
  for (const [i, s] of Object.entries(map)) {
    const kind = mainFault(s);
    if (kind && s.w >= SHARE_MIN) out.push([i, [Math.round(s.w * 100) / 100, kind]]);
  }
  out.sort((a, b) => b[1][0] - a[1][0]);
  return Object.fromEntries(out.slice(0, SHARE_MAX));
}
