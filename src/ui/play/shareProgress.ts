// Part of being in a choir (no opt-out, like the leaderboard): send my per-bar progress on this cycle's pieces to my choir, where my section lead sees
// what's hard for the section (aggregated, never by name), plus my voice range
// (by name, for divisi). Called after each run (debounced) and when sharing is switched on.

import { loadCycle, loadProfile, getProgress } from '../../progress/store';
import { getBars, type BarMap } from '../../progress/bars';
import { sharedNotes } from '../../progress/notestats';
import { pieceReadiness } from '../../progress/ladder';
import { shareProgress, apiBase, sessionFor } from '../../progress/choir';
import { accountConfirmed, loadMeta } from '../../progress/sync';
import { getPiece, chosenPartId, singableSections } from '../library';
import { sharedRange } from '../../progress/insights';

const MIN_GAP_MS = 60_000;
const ERR_KEY = 'sh:shareError';

/** Why the last share didn't reach the choir (shown under the share switch), or null. */
export function shareError(): string | null {
  try { return localStorage.getItem(ERR_KEY); } catch { return null; }
}
function setShareError(msg: string | null) {
  try {
    if (msg) localStorage.setItem(ERR_KEY, msg);
    else localStorage.removeItem(ERR_KEY);
  } catch { /* ignore */ }
}
let last = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

async function send(): Promise<void> {
  const p = loadProfile();
  // Logged in to the choir: the entry is the account's, under the account's name, but only once this
  // phone's progress is known to be the account's (not while a merge question is open).
  const s = sessionFor(p.choirCode);
  const name = s?.account.name ?? p.name.trim();
  if (!p.choirCode || !p.shareProgress || p.shareOptOut || !name || !apiBase()) return;
  if (s && !accountConfirmed()) return;
  // Shared with an account before and logged out now: pause (an anonymous entry would clash with it).
  if (!s && loadMeta().account) {
    setShareError('Log in again (Settings → Keep my progress across phones) to keep sharing.');
    return;
  }
  if (!['S', 'A', 'T', 'B'].includes(p.voice)) {
    setShareError('Choose soprano, alto, tenor or bass in Voice setup so your section lead can see your progress.');
    return;
  }
  if (/[/\\?#%]/.test(name)) {
    setShareError('Your name can’t contain / \\ ? # or %. Change it in Voice setup.');
    return;
  }
  const pieces: Record<string, { readiness: number; level: number; bars: BarMap; notes?: Record<string, [number, string]> }> = {};
  for (const id of loadCycle().pieceIds.slice(0, 30)) {
    const piece = getPiece(id);
    if (!piece) continue;
    const partId = chosenPartId(piece, p.voice);
    const prog = getProgress(id, partId);
    const bars = getBars(id, partId);
    if (!prog && Object.keys(bars).length === 0) continue;
    const r = pieceReadiness(singableSections(piece, partId), prog);
    // level = the piece level (sung through in one go at that level), not the weakest section.
    // (and the notes that keep going wrong, with how: the section's rehearsal cheat sheet)
    const notes = sharedNotes(id, partId);
    pieces[id] = { readiness: Math.round(r.pct * 100) / 100, level: r.pieceLevel, bars, ...(Object.keys(notes).length ? { notes } : {}) };
  }
  last = Date.now();
  try {
    await shareProgress(p.choirCode, name, p.voice, pieces, sharedRange(p));
    setShareError(null);
  } catch (e) {
    console.warn('share progress', e);
    setShareError((e as Error).message);
  }
}

/** Share now (`force`) or soon; at most once a minute otherwise. Never throws. */
export function shareMyProgress(force = false): Promise<void> {
  if (force) {
    if (timer) { clearTimeout(timer); timer = null; }
    return send();
  }
  if (timer) return Promise.resolve();
  const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
  timer = setTimeout(() => { timer = null; void send(); }, wait);
  return Promise.resolve();
}
