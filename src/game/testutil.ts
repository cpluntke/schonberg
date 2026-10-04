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

export interface Voice {
  /** Natural frequency (Hz) and damping of the pitch response to a new note. */
  fn?: number;
  zeta?: number;
  vibCents?: number;
  vibHz?: number;
  /** Constant offset in cents. */
  offsetCents?: number;
  /** The singer (or an uncorrected device delay) is this many seconds late. */
  lag?: number;
}

/**
 * A realistic sung pitch contour: an underdamped 2nd-order response to the written notes (glide,
 * overshoot, ringing) plus vibrato, sampled every 20 ms. Rests are silent.
 */
export function singRealistic(part: Part, v: Voice = {}): PitchSample[] {
  const { fn = 8, zeta = 0.5, vibCents = 25, vibHz = 5.5, offsetCents = 0, lag = 0 } = v;
  const w = 2 * Math.PI * fn;
  const dt = 0.001;
  const end = part.notes[part.notes.length - 1].start + part.notes[part.notes.length - 1].dur;
  let x = part.notes[0].midi;
  let vel = 0;
  let noteStart = 0;
  let cur = -1;
  const out: PitchSample[] = [];
  let nextSample = 0;
  for (let t = 0; t <= end + lag + 1e-9; t += dt) {
    const st = t - lag;
    let j = -1;
    for (let k = 0; k < part.notes.length; k++) if (part.notes[k].start <= st && st < part.notes[k].start + part.notes[k].dur) j = k;
    if (j !== cur && j >= 0) { cur = j; noteStart = t; }
    const target = cur >= 0 ? part.notes[cur].midi : x;
    const acc = w * w * (target - x) - 2 * zeta * w * vel;
    vel += acc * dt;
    x += vel * dt;
    if (t >= nextSample - 1e-9) {
      nextSample += 0.02;
      const inNote = j >= 0;
      const tn = t - noteStart;
      const vib = tn > 0.15 ? (vibCents / 100) * Math.sin(2 * Math.PI * vibHz * tn) : 0;
      const midi = inNote ? x + vib + offsetCents / 100 : null;
      out.push({ time: t, midi, clarity: midi === null ? 0 : 0.95, rms: midi === null ? 0 : 0.2 });
    }
  }
  return out;
}

