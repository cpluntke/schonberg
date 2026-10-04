// Cold start: you're dropped into a random bar, hear two bars of the other voices, and carry on
// from memory. Concert memory breaks most often after a slip, when you don't know where you are;
// this trains finding your place.

import type { Part, Score } from '../music/types';
import { knownByHeart, type BarMap } from '../progress/bars';

export interface ColdStart {
  /** Measure index where you come in. */
  bar: number;
  /** Score time of that bar (scoring starts here). */
  from: number;
  /** End of the stretch you sing (about four bars). */
  to: number;
}

/** Bars of the other voices you hear before you come in. */
export const LEAD_BARS = 2;
const SING_BARS = 4;

/**
 * Pick where to drop the singer: a bar where they have notes, preferring bars they don't know by
 * heart yet (weighted), and not the one they just did.
 */
export function pickColdStart(score: Score, part: Part, bars: BarMap, opts: { avoid?: number; rand?: () => number } = {}): ColdStart | null {
  const rand = opts.rand ?? Math.random;
  const ms = score.measures;
  const withNotes = new Set(part.notes.map((n) => n.measure));
  const all = ms.map((m) => m.index).filter((i) => withNotes.has(i) && i !== opts.avoid);
  // Prefer bars with a full lead-in (not the very start, not right after a short pickup).
  const full = all.filter((i) => i > 0 && ms[i].start - leadInFrom(score, i) >= ms[i].dur * 0.99);
  const candidates = full.length ? full : all;
  if (!candidates.length) return null;
  const weight = (i: number) => {
    const s = bars[i];
    if (!s) return 2;
    if (knownByHeart(s)) return 1;
    return 3 - Math.min(2, 2 * (s.mem ?? s.ema));
  };
  const total = candidates.reduce((x, i) => x + weight(i), 0);
  let r = rand() * total;
  let bar = candidates[candidates.length - 1];
  for (const i of candidates) {
    r -= weight(i);
    if (r <= 0) { bar = i; break; }
  }
  const last = ms[Math.min(ms.length - 1, bar + SING_BARS - 1)];
  return { bar, from: ms[bar].start, to: last.start + last.dur };
}

/** Score time where the lead-in starts (two bars earlier, or the start of the piece). */
export function leadInFrom(score: Score, bar: number): number {
  return score.measures[Math.max(0, bar - LEAD_BARS)]?.start ?? 0;
}
