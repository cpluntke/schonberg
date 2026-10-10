// The singing view's big live readout ("C♯ · a touch flat ↓") and the progress strip of a long
// run. Pure functions, called by Play's HUD tick (about 11 times a second, not every frame).
import type { PitchSample } from '../../game/types';
import type { Part, Score, Section } from '../../music/types';

/** The note being sung and how far off it is (cents, octave-folded); null when silent. */
export interface Reading {
  /** Index of the note in the part. */
  index: number;
  cents: number;
}

/**
 * What the voice is singing now: of your notes sounding when the last reading was sung (a chord in
 * an instrument part: the nearest), and its pitch averaged over ~0.2 s (one vibrato cycle) against
 * it. The same reading as the score view's bubble. Null when there's no voice in the last 0.2 s,
 * in a rest, or when the note is hidden (off book) and not yet sung.
 */
export function liveReading(s: {
  samples: PitchSample[];
  pos: number;
  part: Pick<Part, 'notes'>;
  range: [number, number] | null;
  hide?: (i: number) => 'show' | 'letters' | 'none';
}): Reading | null {
  const smp = s.samples;
  const last = smp[smp.length - 1];
  if (!last || last.midi == null || s.pos - last.time >= 0.2 || !s.range) return null;
  const notes = s.part.notes;
  let heard = -1;
  let bestD = Infinity;
  const [h0, h1] = s.range;
  for (let i = h0; i <= h1; i++) {
    if (notes[i].start > last.time) break;
    if (last.time >= notes[i].start + notes[i].dur) continue;
    let d = Math.abs(last.midi - notes[i].midi);
    if (d > 6) d = Math.abs(((d % 12) + 6) % 12 - 6);
    if (d < bestD) {
      bestD = d;
      heard = i;
    }
  }
  if (heard < 0) return null;
  if (s.hide && s.hide(heard) !== 'show' && notes[heard].start + notes[heard].dur > s.pos) return null;
  let sum = 0;
  let cnt = 0;
  for (let r = smp.length - 1; r >= 0 && last.time - smp[r].time < 0.2 && smp[r].time >= notes[heard].start; r--) {
    const mm = smp[r].midi;
    if (mm != null && Math.abs(mm - last.midi) < 1.5) {
      sum += mm;
      cnt++;
    }
  }
  const shown = cnt ? sum / cnt : last.midi;
  let cents = (shown - notes[heard].midi) * 100;
  if (Math.abs(cents) > 600) cents = ((cents % 1200) + 1800) % 1200 - 600;
  return { index: heard, cents };
}

/** A long run's bars, for the progress strip: its passages (bars each) and where the music is. */
export interface RunProgress {
  /** Bars in the run. */
  total: number;
  /** Bars of each passage in the run, in order (they add up to `total`). */
  parts: number[];
}

/**
 * The progress strip of a run longer than one passage (the whole piece, a stretch over several
 * passages): null for one passage or less. Passages are the piece's sections (bars between them
 * count with the passage before).
 */
export function runProgress(score: Pick<Score, 'measures'>, sections: Pick<Section, 'start' | 'end'>[], from: number, to: number): RunProgress | null {
  const bars = score.measures.filter((m) => m.start >= from - 1e-6 && m.start < to - 1e-6);
  if (bars.length < 2) return null;
  const inside = sections.filter((x) => x.end > from + 1e-6 && x.start < to - 1e-6).sort((a, b) => a.start - b.start);
  if (inside.length < 2) return null;
  const parts = inside.map(() => 0);
  for (const b of bars) {
    let k = 0;
    for (let q = 0; q < inside.length; q++) if (inside[q].start <= b.start + 1e-6) k = q;
    parts[k]++;
  }
  const kept = parts.filter((n) => n > 0);
  return kept.length < 2 ? null : { total: bars.length, parts: kept };
}

/** Bars of the run before the one at `pos` (0 at the start, `total` once past the end). */
export function barsDone(score: Pick<Score, 'measures'>, from: number, to: number, pos: number): number {
  let n = 0;
  for (const m of score.measures) {
    if (m.start < from - 1e-6 || m.start >= to - 1e-6) continue;
    if (m.start + m.dur <= pos + 1e-6) n++;
  }
  return n;
}
