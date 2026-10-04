// Time helpers over a parsed Score: tempo map conversions, lookups by score time.
import type { KeySig, Score, TempoEvent } from './types';

export const DEFAULT_BPM = 90;

/** Binary search: index of the last element with key(el) <= x, or -1. */
function lastAtOrBefore<T>(arr: T[], x: number, key: (t: T) => number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) <= x + 1e-9) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Convert a quarter-beat position to seconds using a (sorted) tempo map. */
export function beatToTime(tempos: TempoEvent[], beat: number): number {
  if (!tempos.length) return (beat * 60) / DEFAULT_BPM;
  const i = Math.max(0, lastAtOrBefore(tempos, beat, (t) => t.beat));
  const t = tempos[i];
  return t.time + ((beat - t.beat) * 60) / t.bpm;
}

/** Convert seconds to a quarter-beat position using a (sorted) tempo map. */
export function timeToBeat(tempos: TempoEvent[], time: number): number {
  if (!tempos.length) return (time * DEFAULT_BPM) / 60;
  const i = Math.max(0, lastAtOrBefore(tempos, time, (t) => t.time));
  const t = tempos[i];
  return t.beat + ((time - t.time) * t.bpm) / 60;
}

/** Build tempo events with `time` filled in from (beat, bpm) pairs. Deduplicates by beat (last wins). */
export function buildTempoMap(events: { beat: number; bpm: number }[], defaultBpm = DEFAULT_BPM): TempoEvent[] {
  const sorted = [...events].filter((e) => e.bpm > 0 && isFinite(e.bpm)).sort((a, b) => a.beat - b.beat);
  const dedup: { beat: number; bpm: number }[] = [];
  for (const e of sorted) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.beat - e.beat) < 1e-6) last.bpm = e.bpm;
    else dedup.push({ ...e });
  }
  if (!dedup.length || dedup[0].beat > 1e-6) dedup.unshift({ beat: 0, bpm: dedup.length ? dedup[0].bpm : defaultBpm });
  const out: TempoEvent[] = [];
  for (const e of dedup) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.bpm - e.bpm) < 1e-6) continue; // no change
    const time = prev ? prev.time + ((e.beat - prev.beat) * 60) / prev.bpm : 0;
    out.push({ beat: e.beat, time, bpm: e.bpm });
  }
  return out;
}

/** 0-based measure index containing `time` (clamped to the score). */
export function measureAtTime(score: Score, time: number): number {
  const ms = score.measures;
  if (!ms.length) return 0;
  const i = lastAtOrBefore(ms, time, (m) => m.start);
  return Math.max(0, Math.min(ms.length - 1, i));
}

export function keyAtTime(score: Score, time: number): KeySig {
  const ks = score.keys;
  if (!ks.length) return { beat: 0, time: 0, fifths: 0, mode: 'major' };
  const i = lastAtOrBefore(ks, time, (k) => k.time);
  return ks[Math.max(0, i)];
}

export function tempoAtTime(score: Score, time: number): number {
  const ts = score.tempos;
  if (!ts.length) return DEFAULT_BPM;
  const i = lastAtOrBefore(ts, time, (t) => t.time);
  return ts[Math.max(0, i)].bpm;
}

/** MIDI pitches sounding at `time` across all parts (optionally excluding one part). */
export function soundingAt(score: Score, time: number, excludePartId?: string): number[] {
  const out: number[] = [];
  for (const p of score.parts) {
    if (p.id === excludePartId) continue;
    const notes = p.notes;
    // notes are sorted by start; find last note starting at or before time, scan back a little for overlaps
    const i = lastAtOrBefore(notes, time, (n) => n.start);
    for (let j = i; j >= 0; j--) {
      const n = notes[j];
      if (n.start <= time && time < n.start + n.dur) out.push(n.midi);
      // stop scanning once we are far before (notes longer than 30s are not expected)
      if (time - n.start > 30) break;
    }
  }
  return out;
}

/** Length of one metric beat in quarter notes for a time signature (compound meters → dotted beats). */
export function beatLength(ts: [number, number]): number {
  const [num, den] = ts;
  const unit = 4 / den;
  if (den >= 8 && num % 3 === 0 && num > 3) return unit * 3;
  return unit;
}

/** Metric beat times between `from` and `to` (score seconds, inclusive of from). */
export function beatTimes(score: Score, from: number, to: number): { time: number; downbeat: boolean }[] {
  const out: { time: number; downbeat: boolean }[] = [];
  for (const m of score.measures) {
    if (m.start > to + 1e-9) break;
    if (m.start + m.dur < from - 1e-9) continue;
    const bl = beatLength(m.timeSig);
    for (let b = 0; b < m.durBeats - 1e-6; b += bl) {
      const t = beatToTime(score.tempos, m.startBeat + b);
      if (t >= from - 1e-9 && t <= to + 1e-9) out.push({ time: t, downbeat: b === 0 });
    }
  }
  return out;
}
