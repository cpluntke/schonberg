// Drill material extracted from the singer's own part.

import type { Part } from '../music/types';

/** Rest longer than this before a note makes it an entry rather than an interval to drill. */
const MAX_GAP_FOR_INTERVAL = 1.5;

/** Difficulty weight of a melodic interval (unsigned semitones). */
export function intervalDifficulty(semitones: number): number {
  const s = Math.abs(semitones);
  let w = s;
  const r = s % 12;
  if (r === 6) w += 5; // tritone (and compound tritone)
  if (r === 10 || r === 11) w += 5; // sevenths
  if (s === 13 || s === 14) w += 6; // ninths
  if (s > 12 && r === 1) w += 2; // minor ninth is nasty
  if (s >= 8) w += 2;
  return w;
}

/**
 * The `n` hardest melodic intervals of a part (largest / most dissonant leaps), one entry per
 * distinct signed interval, hardest first. `index` is the note the leap lands on.
 */
export function hardestIntervals(part: Part, n: number): { index: number; semitones: number; measure: number }[] {
  const cands: { index: number; semitones: number; measure: number; w: number }[] = [];
  const notes = part.notes;
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1];
    const cur = notes[i];
    if (cur.start - (prev.start + prev.dur) > MAX_GAP_FOR_INTERVAL) continue;
    const semitones = cur.midi - prev.midi;
    if (semitones === 0) continue;
    cands.push({ index: i, semitones, measure: cur.measure, w: intervalDifficulty(semitones) });
  }
  cands.sort((a, b) => b.w - a.w || a.index - b.index);
  const seen = new Set<number>();
  const out: { index: number; semitones: number; measure: number }[] = [];
  for (const c of cands) {
    if (out.length >= n) break;
    if (seen.has(c.semitones)) continue;
    seen.add(c.semitones);
    out.push({ index: c.index, semitones: c.semitones, measure: c.measure });
  }
  return out;
}

/** Indices of notes that follow a rest of at least `minRestSec` (the first note always counts). */
export function entryNotes(part: Part, minRestSec = 0.5): number[] {
  const out: number[] = [];
  const notes = part.notes;
  for (let i = 0; i < notes.length; i++) {
    if (i === 0) { out.push(0); continue; }
    const prev = notes[i - 1];
    if (notes[i].start - (prev.start + prev.dur) >= minRestSec - 1e-6) out.push(i);
  }
  return out;
}
