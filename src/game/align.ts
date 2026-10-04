// Lining the singer's pitch trace up with the score after a run.
//
// The delay between the backing track and the singer's voice reaching the pitch tracker (output +
// input latency, Bluetooth, the analysis window) differs per phone and headset and is rarely known
// exactly. When it is off, the previous note's pitch appears inside the current note and the app
// calls good intonation "off". Pitch is a much better timing reference than onsets (consonants and
// breaths blur those): we try a range of delays and keep the one under which the sung pitches agree
// best with the written notes.

import type { Part } from '../music/types';
import type { AttemptResult, PitchSample, ScoringOptions } from './types';
import { rhythmValue, scoreAttempt, type ScoringContext } from './scoring';
import { analyze } from './analysis';

export interface LagEstimate {
  /** Score seconds to subtract from sample times (positive = the voice arrived late). */
  lag: number;
  /** True when the trace clearly lines up better at `lag` than at 0. */
  confident: boolean;
  /** Share of voiced readings that match the written pitch at `lag` (0..1). */
  match: number;
  /** Improvement in that share over no shift. */
  gain: number;
}

export interface LagOptions {
  /** Search range in score seconds. */
  minLag?: number;
  maxLag?: number;
  step?: number;
}

/** Semitones within which a reading counts (fully at 0, linearly less up to this). */
const KERNEL = 0.6;
/** Voiced sound where the part has a rest counts against a shift. */
const REST_PENALTY = 0.25;

export function estimateLag(part: Part, range: [number, number], samples: PitchSample[], opts: LagOptions = {}): LagEstimate {
  const { minLag = -0.1, maxLag = 0.4, step = 0.01 } = opts;
  const [a, b] = range;
  const notes = part.notes.slice(Math.max(0, a), Math.min(part.notes.length, b + 1));
  const none: LagEstimate = { lag: 0, confident: false, match: 0, gain: 0 };
  if (notes.length < 2) return none;
  const from = notes[0].start;
  const to = notes[notes.length - 1].start + notes[notes.length - 1].dur;
  const voiced = samples.filter((s) => s.midi !== null && Number.isFinite(s.midi) && s.time >= from + minLag && s.time <= to + maxLag);
  // Something to line up: enough singing and enough pitch changes or entries.
  let changes = 0;
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].midi !== notes[i - 1].midi || notes[i].start - (notes[i - 1].start + notes[i - 1].dur) > 0.2) changes++;
  }
  if (voiced.length < 25 || changes < 3) return none;

  const starts = notes.map((n) => n.start);
  const noteAt = (t: number): number => {
    let lo = 0;
    let hi = notes.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx >= 0 && t < notes[idx].start + notes[idx].dur ? idx : -1;
  };
  const scoreAt = (d: number): number => {
    let sum = 0;
    for (const s of voiced) {
      const t = s.time - d;
      if (t < from || t >= to) continue;
      const i = noteAt(t);
      if (i < 0) { sum -= REST_PENALTY; continue; }
      let diff = s.midi! - notes[i].midi;
      diff -= 12 * Math.round(diff / 12); // the octave doesn't matter for timing
      sum += Math.max(0, 1 - Math.abs(diff) / KERNEL);
    }
    return sum;
  };

  const n = voiced.length;
  const s0 = scoreAt(0);
  let best = 0;
  let bestScore = s0;
  const k0 = Math.ceil(minLag / step - 1e-9);
  const k1 = Math.floor(maxLag / step + 1e-9);
  const curve: [number, number][] = [];
  for (let k = k0; k <= k1; k++) curve.push([k * step, k === 0 ? s0 : scoreAt(k * step)]);
  for (const [d, sc] of curve) if (sc > bestScore + 1e-9) { bestScore = sc; best = d; }
  // Prefer the smallest shift among (nearly) equally good ones: don't move without a reason.
  const near = curve.filter(([, sc]) => sc >= bestScore - 0.005 * n).sort((x, y) => Math.abs(x[0]) - Math.abs(y[0]));
  if (near.length) { best = near[0][0]; bestScore = near[0][1]; }
  const match = Math.max(0, bestScore / n);
  const gain = (bestScore - s0) / n;
  // A singer who is mostly on other notes gives no reliable timing.
  const confident = best !== 0 && match >= 0.4 && gain >= 0.02;
  return { lag: confident ? best : 0, confident, match, gain };
}

/** Shift samples by a lag (score seconds). */
export function shiftSamples(samples: PitchSample[], lag: number): PitchSample[] {
  return lag === 0 ? samples : samples.map((s) => ({ ...s, time: s.time - lag }));
}

export interface AlignedResult {
  result: AttemptResult;
  /** The estimate (score seconds). */
  estimate: LagEstimate;
  /** Real-time milliseconds the voice was shifted by for the intonation judgement (0 = none). */
  shiftMs: number;
  /**
   * The voice lines up clearly better at a total delay beyond `maxTotalMs` (this many ms of shift):
   * a very slow device, or a singer far behind. The run can't be judged fairly without the delay check.
   */
  beyondCapMs?: number;
}

/**
 * Score a finished run, judging intonation after lining the voice up with the music.
 *
 * Only intonation uses the lined-up voice. Onsets, rhythm and the timing tips stay on the delay
 * the app already applies (`latencyMs`), so a singer who follows the guide 300 ms behind still
 * hears that they're late. `calibrated` = that delay was measured with the delay check: then
 * only small corrections are made.
 */
export function scoreAligned(
  ctx: ScoringContext,
  samples: PitchSample[],
  opts: ScoringOptions,
  run: { rate: number; latencyMs: number; calibrated: boolean; liftSubharmonics?: boolean; maxTotalMs?: number },
): AlignedResult {
  const rate = run.rate > 0 ? run.rate : 1;
  const prep = (xs: PitchSample[]) => (run.liftSubharmonics ? liftSubharmonics(ctx.part, xs) : xs);
  // Search a plausible range of device delays around the current setting (total ≥ ~20 ms).
  const lo = run.calibrated ? -0.08 : Math.max(-0.25, -(run.latencyMs - 20) / 1000);
  // Never look further than a plausible total device delay (a singer one note behind mustn't be
  // "lined up" with the next note).
  const hiCap = run.maxTotalMs != null ? (run.maxTotalMs - run.latencyMs) / 1000 : 0.3;
  const hi = run.calibrated ? 0.08 : Math.max(0, Math.min(0.3, hiCap));
  let estimate = estimateLag(ctx.part, ctx.range, samples, { minLag: Math.min(0, lo) * rate, maxLag: hi * rate, step: 0.01 * rate });
  let beyondCapMs: number | undefined;
  if (!run.calibrated && run.maxTotalMs != null && hi < 0.45) {
    // Beyond the plausible range the voice may line up much better: a very slow device (or a singer
    // far behind). The caller doesn't count such a run; intonation is shown lined up anyway.
    const wide = estimateLag(ctx.part, ctx.range, samples, { minLag: Math.min(0, lo) * rate, maxLag: 0.45 * rate, step: 0.01 * rate });
    const wideMs = wide.confident ? Math.round((wide.lag / rate) * 1000) : 0;
    if (wideMs > hi * 1000 + 30 && wide.match > estimate.match + 0.1) {
      beyondCapMs = wideMs;
      estimate = wide;
    }
  }
  const shiftMs = estimate.confident ? Math.round((estimate.lag / rate) * 1000) : 0;
  // Small shifts aren't worth second-guessing the delay setting for.
  if (Math.abs(shiftMs) < 25) return { result: scoreAttempt(ctx, prep(samples), opts), estimate, shiftMs: 0, beyondCapMs };
  const aligned = scoreAttempt(ctx, prep(shiftSamples(samples, estimate.lag)), opts);
  // Timing is reported against the delay we applied: add the shift back to every onset.
  const lagMs = estimate.lag * 1000;
  const notes = aligned.notes.map((n) => ({ ...n, onsetMs: n.onsetMs === null ? null : Math.max(0, n.onsetMs + lagMs) }));
  const rhythm = notes.length ? notes.reduce((x, n) => x + rhythmValue(n.onsetMs), 0) / notes.length : 0;
  const result: AttemptResult = { ...aligned, notes, rhythm, insights: analyze(ctx, notes, samples) };
  return { result, estimate, shiftMs, beyondCapMs };
}

/**
 * Practising on the phone speaker, the mic hears the backing too, and McLeod can lock onto the
 * common period of voice + chord: an octave and a fifth (×⅓) or two octaves (×¼) below the voice,
 * or an octave (×½). Such readings are moved onto the note that is due. An octave below is only
 * corrected when the same note also has readings at the right octave (the tracker flickering), so a
 * note genuinely sung an octave low still counts as an octave error. Readings matching the
 * previous or next written note are left alone (that's the voice moving, not a subharmonic).
 */
export function liftSubharmonics(part: Part, samples: PitchSample[]): PitchSample[] {
  const notes = part.notes;
  if (!notes.length) return samples;
  const starts = notes.map((n) => n.start);
  const at = (t: number) => {
    let lo = 0;
    let hi = notes.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx >= 0 && t < notes[idx].start + notes[idx].dur ? idx : -1;
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
  // Per note: how many readings sit on the note, and an octave below it.
  const onNote = new Map<number, number>();
  const octBelow = new Map<number, number>();
  const idx = samples.map((s) => (s.midi === null ? -1 : at(s.time)));
  samples.forEach((s, k) => {
    const i = idx[k];
    if (i < 0 || s.midi === null) return;
    if (near(s.midi, notes[i].midi)) onNote.set(i, (onNote.get(i) ?? 0) + 1);
    else if (near(s.midi + 12, notes[i].midi)) octBelow.set(i, (octBelow.get(i) ?? 0) + 1);
  });
  return samples.map((s, k) => {
    const i = idx[k];
    if (i < 0 || s.midi === null) return s;
    const due = notes[i].midi;
    if (s.midi > due - 7) return s;
    const prev = i > 0 ? notes[i - 1].midi : null;
    const next = i + 1 < notes.length ? notes[i + 1].midi : null;
    if ((prev !== null && near(s.midi, prev)) || (next !== null && near(s.midi, next))) return s;
    for (const kk of [19, 24]) if (near(s.midi + kk, due)) return { ...s, midi: s.midi + kk };
    if (near(s.midi + 12, due)) {
      const on = onNote.get(i) ?? 0;
      const below = octBelow.get(i) ?? 0;
      if (on >= 0.3 * (on + below)) return { ...s, midi: s.midi + 12 };
    }
    return s;
  });
}

/** Median onset (real ms) of the notes whose timing is meaningful, or null. */
export function medianOnsetMs(result: AttemptResult, rate: number, part?: Part): number | null {
  const timed = result.notes.filter((n) => {
    if (n.onsetMs === null || n.scoop !== null) return false;
    // A repeated pitch sung legato has no audible onset of its own.
    const cur = part?.notes[n.index];
    const prev = part && n.index > 0 ? part.notes[n.index - 1] : null;
    return !(cur && prev && prev.midi === cur.midi && cur.start - (prev.start + prev.dur) < 1.0);
  });
  const xs = timed.map((n) => n.onsetMs! / (rate > 0 ? rate : 1)).sort((a, b) => a - b);
  return xs.length >= 3 ? xs[Math.floor(xs.length / 2)] : null;
}
