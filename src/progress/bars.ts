// Per-bar history of a singer's part: how well each bar has been sung recently, so the piece map
// can show where the trouble is and the off-book level can fade out the bars you already know.
//
// Stored per piece + part in localStorage (`sh:bars:<piece>:<part>`), keyed by measure index.
// Recent runs count more (exponential moving average), so a bar turns solid once it's fixed.

import type { AttemptResult, InsightKind } from '../game/types';
import { readJSON, writeJSON } from './store';

export interface BarStat {
  /** Recent accuracy, any level (0..1). */
  ema: number;
  /** Recent accuracy at levels 4–5 (no note names, no guide): what you can do from memory. */
  mem?: number;
  /** Recent accuracy sung off book (level 5, without peeking at this bar). */
  off?: number;
  /** Runs that included this bar. */
  n: number;
  /** Last time sung (ms). */
  at: number;
  /** Problems the coach saw here in the latest run (only kept while the bar is weak). */
  issues?: InsightKind[];
}

export type BarMap = Record<number, BarStat>;

/** New results weigh this much against the history. */
const NEW_WEIGHT = 0.6;
export const SOLID = 0.85;
export const OK = 0.6;

const key = (pieceId: string, partId: string) => `sh:bars:${pieceId}:${partId}`;
const isMap = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function getBars(pieceId: string, partId: string): BarMap {
  return readJSON<BarMap>(key(pieceId, partId), {}, isMap);
}

const blend = (old: number | undefined, v: number) => (old == null ? v : NEW_WEIGHT * v + (1 - NEW_WEIGHT) * old);

/**
 * Fold one run into the bar history. `peeked` = measures the singer revealed during an off-book
 * run: those count for the general history but not as sung from memory.
 */
export function recordBars(
  pieceId: string,
  partId: string,
  result: AttemptResult,
  level: number,
  opts: { peeked?: Iterable<number>; hidden?: Iterable<number>; now?: number } = {},
): BarMap {
  const now = opts.now ?? Date.now();
  const peeked = new Set(opts.peeked ?? []);
  // Off book only counts for bars that were actually hidden (not shown in fade mode, not peeked at).
  const hidden = opts.hidden ? new Set(opts.hidden) : null;
  const bars = { ...getBars(pieceId, partId) };
  const issuesAt = new Map<number, InsightKind[]>();
  for (const i of result.insights) {
    if (!i.measures || i.kind === 'great' || i.kind === 'quiet') continue;
    for (let m = i.measures[0]; m <= i.measures[1]; m++) issuesAt.set(m, [...(issuesAt.get(m) ?? []), i.kind]);
  }
  for (const [ms, v] of Object.entries(result.perMeasure)) {
    const m = Number(ms);
    if (!Number.isFinite(m) || !Number.isFinite(v)) continue;
    const old = bars[m];
    const s: BarStat = { ema: blend(old?.ema, v), n: (old?.n ?? 0) + 1, at: now };
    if (old?.mem != null) s.mem = old.mem;
    if (old?.off != null) s.off = old.off;
    if (level >= 4 && !peeked.has(m)) s.mem = blend(old?.mem, v);
    if (level >= 5 && !peeked.has(m) && (!hidden || hidden.has(m))) s.off = blend(old?.off, v);
    const iss = issuesAt.get(m);
    if (iss && v < SOLID) s.issues = [...new Set(iss)];
    bars[m] = s;
  }
  writeJSON(key(pieceId, partId), bars, false);
  return bars;
}

export type Mastery = 'solid' | 'ok' | 'weak' | 'none';

export function mastery(s: BarStat | undefined): Mastery {
  if (!s) return 'none';
  return s.ema >= SOLID ? 'solid' : s.ema >= OK ? 'ok' : 'weak';
}

/**
 * Off-book practice: a bar is hidden once you've shown you know it without seeing it
 * (sung well off book), or sung it very well without names and guide.
 */
export function knownByHeart(s: BarStat | undefined): boolean {
  if (!s) return false;
  if (s.off != null) return s.off >= SOLID;
  return (s.mem ?? 0) >= 0.9;
}

/** Contiguous runs of weak bars, worst first: "bars 12–13, 27". */
export function troubleSpots(bars: BarMap, measures: number[], max = 3): [number, number][] {
  const weak = measures.filter((m) => mastery(bars[m]) === 'weak');
  const runs: { r: [number, number]; score: number }[] = [];
  for (const m of weak) {
    const last = runs[runs.length - 1];
    if (last && last.r[1] === m - 1) {
      last.r[1] = m;
      last.score += 1 - bars[m].ema;
    } else runs.push({ r: [m, m], score: 1 - bars[m].ema });
  }
  return runs.sort((a, b) => b.score - a.score).slice(0, max).map((x) => x.r).sort((a, b) => a[0] - b[0]);
}
