// The leap drill's results (Train's "Your tricky leaps", C5): which leaps landed, the hardest one, and
// the last runs ("last time 4 of 8"), kept on this phone (`sh:leapRuns`).

import type { NoteResult } from '../game/types';
import { noteVerdict } from './ladder';
import { readJSON, writeJSON } from './store';
import { dayOf } from './today';

export interface LeapOutcome {
  /** The leap's index in the drill (one per bar). */
  i: number;
  landed: boolean;
  /** The note that missed (the landing note when both did, or when the leap landed). */
  note: 'start' | 'landing';
  /** That note's cents off (null: not heard). */
  cents: number | null;
}

/**
 * Leap by leap: the drill sings two notes per bar (start, landing). A leap landed when both notes
 * were right (noteVerdict); a landing note that wasn't sung didn't land.
 */
export function leapOutcomes(notes: Pick<NoteResult, 'index' | 'grade' | 'unsure' | 'clearly' | 'cents'>[], leaps: number): LeapOutcome[] {
  const by = new Map(notes.map((n) => [n.index, n]));
  return Array.from({ length: leaps }, (_, i) => {
    const a = by.get(2 * i), b = by.get(2 * i + 1);
    const ok = (n: typeof a) => !!n && noteVerdict(n) !== 'wrong';
    const startMissed = !ok(a) && ok(b);
    return { i, landed: ok(a) && ok(b), note: startMissed ? 'start' : 'landing', cents: (startMissed ? a?.cents : b?.cents) ?? null };
  });
}

/** The leap to practise: the one that missed by most (a landing not heard counts as the worst). */
export function hardestLeap(out: LeapOutcome[]): LeapOutcome | null {
  const missed = out.filter((o) => !o.landed);
  if (!missed.length) return null;
  return [...missed].sort((x, y) => (y.cents == null ? 999 : Math.abs(y.cents)) - (x.cents == null ? 999 : Math.abs(x.cents)))[0];
}

export interface LeapRun { at: number; landed: number; total: number }
const KEY = 'sh:leapRuns';
const MAX = 20;

export function loadLeapRuns(): LeapRun[] {
  return readJSON<LeapRun[]>(KEY, [], (v) => Array.isArray(v)).filter((r) => r && typeof r.at === 'number' && typeof r.landed === 'number' && typeof r.total === 'number');
}
export function addLeapRun(run: LeapRun): void {
  writeJSON(KEY, [...loadLeapRuns(), run].slice(-MAX));
}

/** The run before `at` (the "last time" of a result), or the latest run when `at` is absent. */
export function lastLeapRun(runs: LeapRun[], at?: number): LeapRun | null {
  const before = at == null ? runs : runs.filter((r) => r.at < at);
  return before.length ? before[before.length - 1] : null;
}

/** "earlier today", "yesterday", "Wed" (this week), "3 Oct" (earlier) for a last run. */
export function whenWord(at: number, now = Date.now()): string {
  const d = dayOf(at), today = dayOf(now);
  if (d === today) return 'earlier today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d === dayOf(y)) return 'yesterday';
  const old = now - at > 6 * 86_400_000;
  try { return new Intl.DateTimeFormat('en-GB', old ? { day: 'numeric', month: 'short' } : { weekday: 'short' }).format(new Date(at)); } catch { return d; }
}
