// Helpers shared by the MusicXML and MIDI importers.
import type { ScoreNote } from './types';

/**
 * Make a sung line strictly monophonic: notes sorted by start; of simultaneous onsets the highest
 * pitch is kept (its lyric is taken from a dropped twin if it has none); a note that still sounds
 * when the next one starts is shortened to end there. Exporter quirks (bad <backup>, MIDI legato
 * overlaps, stray chords in a vocal track) otherwise produce overlapping notes that the scorer and
 * the lane view can't handle.
 */
export function monophonize(notes: ScoreNote[]): ScoreNote[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || b.midi - a.midi);
  const out: ScoreNote[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && n.startBeat - prev.startBeat < 1e-6) {
      if (!prev.lyric && n.lyric) {
        prev.lyric = n.lyric;
        prev.syllabic = n.syllabic;
      }
      if (n.durBeats > prev.durBeats) {
        prev.durBeats = n.durBeats;
        prev.dur = n.dur;
      }
      continue;
    }
    if (prev && prev.startBeat + prev.durBeats > n.startBeat + 1e-9) {
      prev.durBeats = n.startBeat - prev.startBeat;
      prev.dur = n.start - prev.start;
    }
    out.push({ ...n });
  }
  return out.filter((n) => n.dur > 0 && n.durBeats > 0);
}

/** min/max without spreading into Math.min/max (Safari's argument limit is 65536). */
export function minMax(xs: Iterable<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return [lo, hi];
}
