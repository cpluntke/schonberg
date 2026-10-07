// Cycle points: the notes sung right since the current cycle began (every sung run counts, practice
// too: it's singing). A choir's cycle is its programme as the admins name it: when they publish a
// programme under a new name (a new cycle), everyone's points start again from 0. Without a choir,
// the singer's own cycle name does the same.

import { noteVerdict } from './ladder';
import { cachedChoir } from './choir';
import { attemptLog, dayKey, loadCycle, loadProfile, readJSON, writeJSON } from './store';
import type { AttemptResult } from '../game/types';

const KEY = 'sh:cyclePoints';
export interface CyclePoints { k: string; n: number; since: number }

/** Which cycle the singer is in now (and its name as shown). */
export function currentCycle(): { key: string; name: string } {
  const code = loadProfile().choirCode;
  const info = code ? cachedChoir() : null;
  const name = info && info.code === code && info.cycle?.name?.trim() ? info.cycle.name.trim() : '';
  if (name) return { key: `choir:${info!.code}:${name.toLowerCase()}`, name };
  const own = loadCycle().name.trim();
  return { key: `own:${own.toLowerCase()}`, name: own };
}

const stored = (): CyclePoints | null => readJSON<CyclePoints | null>(KEY, null, (v) => {
  const o = v as CyclePoints;
  return !!o && typeof o.k === 'string' && typeof o.n === 'number' && Number.isFinite(o.n) && o.n >= 0;
});

/** Points in the current cycle (0 when a new cycle began since the last run). */
export function cyclePoints(): { n: number; name: string } {
  const c = currentCycle();
  const s = stored();
  return { n: s && s.k === c.key ? Math.round(s.n) : 0, name: c.name };
}

/** Notes sung right in a run (level 1's "right"; let-off notes don't count as sung right). */
export const rightNotes = (r: Pick<AttemptResult, 'notes'>): number => r.notes.filter((n) => noteVerdict(n) === 'right').length;

/** Add a run's right notes; returns the new total. */
export function addCyclePoints(n: number, now = Date.now()): number {
  const c = currentCycle();
  const s = stored();
  const base = s && s.k === c.key ? s : { k: c.key, n: 0, since: now };
  const out = { ...base, n: base.n + Math.max(0, Math.round(n)) };
  writeJSON(KEY, out);
  return out.n;
}

/** For the account copy: this phone's points. */
export const pointsForSync = (): CyclePoints | null => stored();

/** From the account copy: the same cycle on another phone keeps the larger count. */
export function mergeSyncedPoints(remote: unknown): void {
  const r = remote as CyclePoints | null;
  if (!r || typeof r.k !== 'string' || typeof r.n !== 'number' || !Number.isFinite(r.n) || r.n < 0 || r.n > 1e8) return;
  const s = stored();
  if (!s || s.k !== r.k) {
    // Another cycle: only taken when it's the one this phone is in now.
    if (r.k === currentCycle().key && (!s || s.k !== r.k)) writeJSON(KEY, { k: r.k, n: Math.round(r.n), since: Number(r.since) || Date.now() }, false);
    return;
  }
  if (r.n > s.n) writeJSON(KEY, { ...s, n: Math.round(r.n) }, false);
}

/** Has the singer practised today (any run, listening too)? */
export function practisedToday(now = new Date()): boolean {
  const today = dayKey(now);
  const log = attemptLog();
  return log.length > 0 && dayKey(log[log.length - 1].at) === today;
}
