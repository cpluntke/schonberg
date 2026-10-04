// Where is the singer on their own? Passages where nothing you can hear is playing (a solo, an
// exposed entry, a general pause) are where tempo drifts, so the practice beat plays there.

import type { Score } from './types';

/** One beat of the bar grid (as the player's click track uses). */
export interface Beat { time: number; downbeat: boolean }

/**
 * Beats (from `beats`) inside a stretch of at least `minBeats` consecutive beats during which no
 * audible part (ids in `audible`) is sounding. The singer's own part counts as audible when the
 * guide plays it.
 */
export function exposedBeats(score: Score, audible: Set<string>, beats: Beat[], minBeats: number): Set<number> {
  const parts = score.parts.filter((p) => audible.has(p.id) && p.notes.length);
  const sounding = (a: number, b: number) =>
    parts.some((p) => p.notes.some((n) => n.start < b - 1e-6 && n.start + n.dur > a + 1e-6));
  const out = new Set<number>();
  let run: number[] = [];
  const flush = () => {
    if (run.length >= minBeats) for (const t of run) out.add(t);
    run = [];
  };
  for (let i = 0; i < beats.length; i++) {
    const t = beats[i].time;
    const end = i + 1 < beats.length ? beats[i + 1].time : t + (i > 0 ? t - beats[i - 1].time : 0.5);
    if (sounding(t, end)) flush();
    else run.push(t);
  }
  flush();
  return out;
}

/** Indices of the singer's notes that start inside an exposed stretch. */
export function exposedNotes(score: Score, partId: string, exposed: Set<number>, beats: Beat[]): number[] {
  const part = score.parts.find((p) => p.id === partId);
  if (!part || !exposed.size) return [];
  const sorted = [...exposed].sort((a, b) => a - b);
  const beatLen = beats.length > 1 ? (beats[beats.length - 1].time - beats[0].time) / (beats.length - 1) : 0.5;
  const inside = (t: number) => sorted.some((b) => t >= b - 1e-6 && t < b + beatLen - 1e-6);
  return part.notes.map((n, i) => (inside(n.start) ? i : -1)).filter((i) => i >= 0);
}
