// Opt-in: send my per-bar progress on this cycle's pieces to my choir, where my section lead sees
// what's hard for the section. Called after each run (debounced) and when sharing is switched on.

import { loadCycle, loadProfile, getProgress } from '../../progress/store';
import { getBars, type BarMap } from '../../progress/bars';
import { pieceReadiness } from '../../progress/ladder';
import { shareProgress, apiBase } from '../../progress/choir';
import { getPiece, chosenPartId, singableSections } from '../library';

const MIN_GAP_MS = 60_000;
let last = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

async function send(): Promise<void> {
  const p = loadProfile();
  if (!p.choirCode || !p.shareProgress || !p.name.trim() || !apiBase()) return;
  const pieces: Record<string, { readiness: number; level: number; bars: BarMap }> = {};
  for (const id of loadCycle().pieceIds.slice(0, 40)) {
    const piece = getPiece(id);
    if (!piece) continue;
    const partId = chosenPartId(piece, p.voice);
    const prog = getProgress(id, partId);
    const bars = getBars(id, partId);
    if (!prog && Object.keys(bars).length === 0) continue;
    const r = pieceReadiness(singableSections(piece, partId), prog);
    pieces[id] = { readiness: Math.round(r.pct * 100) / 100, level: r.minLevel, bars };
  }
  last = Date.now();
  try {
    await shareProgress(p.choirCode, p.name.trim(), p.voice, pieces);
  } catch (e) {
    console.warn('share progress', e);
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
