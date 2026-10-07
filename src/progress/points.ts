// Cycle points: the notes sung right since the current cycle began (every sung run counts, practice
// too: it's singing). A choir's cycles have dates (the admins set them): when the next one starts,
// everyone's points start again from 0. Without a choir, the singer's own cycle name does the same.

import { noteVerdict } from './ladder';
import { cachedChoir, choirCycleNow } from './choir';
import { dayKey, loadCycle, loadProfile, practiceDays, readJSON, writeJSON } from './store';
import type { AttemptResult } from '../game/types';

const KEY = 'sh:cyclePoints';
export interface CyclePoints { k: string; n: number; since: number }

/** Which cycle the singer is in now (and its name as shown); `alias`: its key in an earlier version. */
export function currentCycle(): { key: string; name: string; alias?: string } {
  const code = loadProfile().choirCode;
  const info = code ? cachedChoir() : null;
  const now = info && info.code === code ? choirCycleNow(info) : null;
  const name = now?.name?.trim() ?? '';
  // (points counted before cycles had dates were kept under the programme's name)
  if (now?.id) return { key: `choir:${info!.code}:#${now.id}`, name, alias: `choir:${info!.code}:${name.toLowerCase()}` };
  if (name) return { key: `choir:${info!.code}:${name.toLowerCase()}`, name };
  if (info && info.code === code && Array.isArray(info.cycles)) return { key: `choir:${info.code}:between`, name: '' };
  const own = loadCycle().name.trim();
  // (the app renames its starting "Demo cycle" to "This cycle" once dates are set: the same cycle)
  const k = own.toLowerCase();
  return { key: `own:${k === 'demo cycle' || k === 'this cycle' ? '' : k}`, name: own };
}

const stored = (): CyclePoints | null => readJSON<CyclePoints | null>(KEY, null, (v) => {
  const o = v as CyclePoints;
  return !!o && typeof o.k === 'string' && typeof o.n === 'number' && Number.isFinite(o.n) && o.n >= 0;
});

/** Points in the current cycle (0 when a new cycle began since the last run). */
const same = (s: CyclePoints | null, c: ReturnType<typeof currentCycle>): s is CyclePoints => !!s && (s.k === c.key || (!!c.alias && s.k === c.alias));

export function cyclePoints(): { n: number; name: string } {
  const c = currentCycle();
  const s = stored();
  return { n: same(s, c) ? Math.round(s.n) : 0, name: c.name };
}

/** Notes sung right in a run (level 1's "right"; let-off notes don't count as sung right). */
export const rightNotes = (r: Pick<AttemptResult, 'notes'>): number => r.notes.filter((n) => noteVerdict(n) === 'right').length;

/** Add a run's right notes; returns the new total. */
export function addCyclePoints(n: number, now = Date.now()): number {
  const c = currentCycle();
  const s = stored();
  const base = same(s, c) ? { ...s, k: c.key } : { k: c.key, n: 0, since: now };
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
  // (both phones end up with the same copy: the larger count, the earlier start)
  const since = Math.min(s.since, Number(r.since) || s.since);
  if (r.n > s.n || since !== s.since) writeJSON(KEY, { ...s, n: Math.max(s.n, Math.round(r.n)), since }, false);
}

/** Has the singer practised today (any run, listening too)? */
export function practisedToday(now = new Date()): boolean {
  return practiceDays(3).includes(dayKey(now));
}
