// Results: which bars the mistake score shows. The bars with a wrong note, each with a bar of
// context either side, nearby ones merged into one short snippet; when mistakes are everywhere,
// only the worst few spots (the rest stay in "Bar by bar").

export interface Spot {
  /** First and last bar shown (0-based measure indices, inclusive). */
  m0: number;
  m1: number;
  /** The bars inside with a wrong note (ascending). */
  bars: number[];
  /** The wrong notes inside (note indices, ascending). */
  notes: number[];
}

export interface SpotOpts {
  /** Bars of the run (context never reaches outside them). */
  lo: number;
  hi: number;
  /** Bars of context before and after the wrong ones. Default 1. */
  context?: number;
  /** Most bars in one snippet, context included. Default 5. */
  maxBars?: number;
  /** Most snippets. Default 3. */
  maxSpots?: number;
}

export function mistakeSpots(wrong: { index: number; measure: number }[], o: SpotOpts): { spots: Spot[]; hiddenBars: number[] } {
  const ctx = Math.max(0, o.context ?? 1);
  const maxBars = Math.max(1 + 2 * ctx, o.maxBars ?? 5);
  const maxSpots = Math.max(1, o.maxSpots ?? 3);
  const byBar = new Map<number, number[]>();
  for (const n of wrong) byBar.set(n.measure, [...(byBar.get(n.measure) ?? []), n.index]);
  const bars = [...byBar.keys()].sort((a, b) => a - b);
  if (!bars.length) return { spots: [], hiddenBars: [] };
  const lo = Math.min(o.lo, bars[0]);
  const hi = Math.max(o.hi, bars[bars.length - 1]);

  // Clusters of wrong bars whose context touches and that fit one snippet.
  const groups: number[][] = [];
  for (const b of bars) {
    const g = groups[groups.length - 1];
    if (g && b - g[g.length - 1] <= 2 * ctx + 1 && b - g[0] + 1 + 2 * ctx <= maxBars) g.push(b);
    else groups.push([b]);
  }
  const weight = (g: number[]) => g.reduce((a, b) => a + byBar.get(b)!.length, 0);
  // The worst spots (most wrong notes, then most bars, then the earliest), shown in score order.
  const kept = groups.length <= maxSpots ? groups
    : groups.map((g, k) => ({ g, k })).sort((a, b) => weight(b.g) - weight(a.g) || b.g.length - a.g.length || a.k - b.k)
      .slice(0, maxSpots).sort((a, b) => a.k - b.k).map((x) => x.g);
  const spots = kept.map((g, k): Spot => {
    const prev = kept[k - 1];
    const next = kept[k + 1];
    // Context stops short of the neighbouring snippet (no bar shown twice).
    const prevEnd = prev ? Math.min(prev[prev.length - 1] + ctx, g[0] - 1) : -Infinity;
    const m0 = Math.max(lo, g[0] - ctx, prevEnd + 1);
    const m1 = Math.min(hi, g[g.length - 1] + ctx, next ? next[0] - 1 : Infinity);
    return { m0, m1, bars: g, notes: g.flatMap((b) => byBar.get(b)!).sort((a, b) => a - b) };
  });
  const shown = new Set(kept.flat());
  return { spots, hiddenBars: bars.filter((b) => !shown.has(b)) };
}
