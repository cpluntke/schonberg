// "Use it in your music": where in a score the singer's part holds a fifth or a major third against
// another voice, so a finished intonation course can point at a passage to sing it in (C6).
//
// A spot is a note of the singer's part and a note of another sung part sounding together for at
// least MIN_HOLD seconds, a fifth (7 semitones, or 7 plus octaves) or a major third (4, plus octaves)
// apart, counted upwards from the lower of the two. The best passage is the window of up to MAX_BARS
// bars with the most such held time against one voice.

import type { Score } from '../music/types';

/** A held pair counts from this much overlap (score seconds). */
export const MIN_HOLD = 0.75;
/** The passage to suggest: at most this many bars. */
export const MAX_BARS = 4;
/** And at least this much held time in it (s), from at least two spots. */
const MIN_TOTAL = 2;

export interface HeldSpot {
  /** First and last bar (0-based indices into Score.measures). */
  m0: number;
  m1: number;
  otherPartId: string;
  otherName: string;
  /** Spots (held pairs) in the passage and their held time (s). */
  count: number;
  seconds: number;
}

const INSTRUMENT = /organ|orgel|\borg\b|piano|\bpno\b|klavier|keyboard|accomp|continuo|harp|guitar|cembalo|harpsichord|instr|violin|\bvln\b|viol|cello|\bvc\b|bass(?:o)? continuo|flute|oboe|clarinet|bassoon|horn|trumpet|trombone|timpani/i;

/** Semitones above the lower note: 7 (fifth) or 4 (major third). */
export function heldIntervalSpot(score: Score, partId: string, semis: 7 | 4): HeldSpot | null {
  const mine = score.parts.find((p) => p.id === partId);
  if (!mine || !mine.notes.length) return null;
  let best: HeldSpot | null = null;
  for (const other of score.parts) {
    // Sung parts only (as fullscore.voiceParts: an instrument is voiceType 'other'; "Pno.", "Org."…), the names a second guard.
    if (other.id === partId || other.voiceType === 'other' || INSTRUMENT.test(other.name) || !other.notes.length) continue;
    // Held time per bar (of the singer's note) against this voice.
    const perBar = new Map<number, { n: number; s: number }>();
    let j = 0;
    for (const a of mine.notes) {
      const aEnd = a.start + a.dur;
      while (j < other.notes.length && other.notes[j].start + other.notes[j].dur <= a.start) j++;
      for (let k = j; k < other.notes.length && other.notes[k].start < aEnd; k++) {
        const b = other.notes[k];
        const overlap = Math.min(aEnd, b.start + b.dur) - Math.max(a.start, b.start);
        if (overlap < MIN_HOLD) continue;
        const d = Math.abs(a.midi - b.midi);
        if (d === 0 || d % 12 !== semis) continue;
        const cur = perBar.get(a.measure) ?? { n: 0, s: 0 };
        perBar.set(a.measure, { n: cur.n + 1, s: cur.s + overlap });
      }
    }
    if (!perBar.size) continue;
    const bars = [...perBar.keys()].sort((x, y) => x - y);
    for (const start of bars) {
      let n = 0, s = 0, last = start;
      for (let m = start; m < start + MAX_BARS; m++) {
        const v = perBar.get(m);
        if (!v) continue;
        n += v.n; s += v.s; last = m;
      }
      if (n < 2 || s < MIN_TOTAL) continue;
      if (!best || s > best.seconds + 1e-6) best = { m0: start, m1: last, otherPartId: other.id, otherName: other.name, count: n, seconds: Math.round(s * 10) / 10 };
    }
  }
  return best;
}

/** "bars 9–12", "bar 7" (printed numbers). */
export function barsLabel(score: Score, m0: number, m1: number): string {
  const a = score.measures[m0]?.number ?? String(m0 + 1);
  const b = score.measures[m1]?.number ?? String(m1 + 1);
  return m0 === m1 ? `bar ${a}` : `bars ${a}–${b}`;
}
