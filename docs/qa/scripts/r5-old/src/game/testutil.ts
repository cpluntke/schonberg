// Test helpers (synthetic scores and pitch samples). Only imported by *.test.ts files.

import type { Measure, Part, Score, ScoreNote } from '../music/types';
import type { PitchSample } from './types';

/** Build a one-part (or multi-part) score from [midi, beats] pairs; midi null = rest. 4/4 at `bpm`. */
export function makePart(id: string, spec: [number | null, number][], bpm = 60): Part {
  const spb = 60 / bpm;
  const notes: ScoreNote[] = [];
  let beat = 0;
  for (const [midi, beats] of spec) {
    if (midi !== null) {
      notes.push({ midi, start: beat * spb, dur: beats * spb, startBeat: beat, durBeats: beats, measure: Math.floor(beat / 4 + 1e-9) });
    }
    beat += beats;
  }
  const ms = notes.map((n) => n.midi);
  return { id, name: id, voiceType: 'S', notes, low: ms.length ? Math.min(...ms) : 0, high: ms.length ? Math.max(...ms) : 0 };
}

export function makeScore(parts: Part[], bpm = 60): Score {
  const spb = 60 / bpm;
  const endBeat = Math.max(...parts.flatMap((p) => p.notes.map((n) => n.startBeat + n.durBeats)), 4);
  const nm = Math.ceil(endBeat / 4 - 1e-9);
  const measures: Measure[] = Array.from({ length: nm }, (_, i) => ({
    index: i, number: String(i + 1), startBeat: i * 4, durBeats: 4, start: i * 4 * spb, dur: 4 * spb, timeSig: [4, 4] as [number, number],
  }));
  return {
    id: 'test', title: 'Test', composer: 'Test', source: 'builtin', parts, measures,
    keys: [{ beat: 0, time: 0, fifths: 0, mode: 'major' }], tempos: [{ beat: 0, time: 0, bpm }], duration: nm * 4 * spb,
  };
}

/**
 * Sample a sung performance every `period` seconds from 0 to the end of the part.
 * `sing(note, tInNote, noteIndex)` returns the sung midi (or null) while inside a note; outside notes → null.
 */
export function sampleSinging(
  part: Part,
  sing: (n: ScoreNote, t: number, i: number) => number | null,
  period = 0.02,
  from = 0,
  to = part.notes.length ? part.notes[part.notes.length - 1].start + part.notes[part.notes.length - 1].dur : 0,
): PitchSample[] {
  const out: PitchSample[] = [];
  let j = 0;
  for (let k = 0; ; k++) {
    const t = from + k * period;
    if (t > to + 1e-9) break;
    while (j < part.notes.length && part.notes[j].start + part.notes[j].dur <= t) j++;
    const n = part.notes[j];
    const midi = n && n.start <= t ? sing(n, t - n.start, j) : null;
    out.push({ time: t, midi, clarity: midi === null ? 0 : 0.95, rms: midi === null ? 0 : 0.2 });
  }
  return out;
}
