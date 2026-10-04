// Tracker fidelity against the ground-truth f0, and where scoring loses points.
import type { AttemptResult, PitchSample } from '../../src/game/types';
import type { Part } from '../../src/music/types';
import { truthAt, type RenderedTake } from './singer';
import type { TrackReading } from './tracker';

export interface ErrStats {
  n: number;
  meanSigned: number;
  medianAbs: number;
  p90Abs: number;
  p99Abs: number;
  /** Share of readings off the truth by more than 50 ¢ (spikes the voice does not have). */
  over50: number;
  /** Share off by more than 600 ¢ (octave / subharmonic errors). */
  octave: number;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function errStats(errs: number[]): ErrStats {
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const n = errs.length;
  return {
    n,
    meanSigned: n ? errs.reduce((a, b) => a + b, 0) / n : NaN,
    medianAbs: quantile(abs, 0.5),
    p90Abs: quantile(abs, 0.9),
    p99Abs: quantile(abs, 0.99),
    over50: n ? abs.filter((x) => x > 50).length / n : NaN,
    octave: n ? abs.filter((x) => x > 600).length / n : NaN,
  };
}

/** Rec times of pitch changes: legato commands to a new pitch, and voice onsets after rests. */
export function transitionTimes(take: RenderedTake): number[] {
  const out: number[] = [];
  take.notes.forEach((n, k) => {
    const prev = take.notes[k - 1];
    if (n.afterRest || !prev) out.push(n.vowelSec);
    else if (n.writtenMidi !== prev.writtenMidi) out.push(n.cmdSec);
  });
  return out;
}

export interface OvershootStats {
  transitions: number;
  /** Mean overshoot (¢) of the voice's pitch centre (2nd-order dynamics only). */
  voiceCentre: number;
  /** Mean overshoot (¢) of the true sung pitch (dynamics + vibrato). */
  voiceTrue: number;
  /** Mean overshoot (¢) of the smoothed tracker output. */
  detected: number;
  /** Mean voice-centre overshoot as a share of the interval. */
  centreShareOfInterval: number;
  /** Share of transitions where the tracker shows > 25 ¢ more overshoot than the voice had. */
  invented: number;
  /** Share where the tracker shows > 25 ¢ less (smoothed away). */
  hidden: number;
}

export interface Fidelity {
  smoothed: { overall: ErrStats; nearTransitions: ErrStats; steady: ErrStats };
  raw: { overall: ErrStats; nearTransitions: ErrStats; steady: ErrStats };
  /** Truth voiced, reading null. */
  missedVoiced: number;
  /** Truth unvoiced (consonant, breath, release), reading has a pitch. */
  falseVoiced: number;
  overshoot: OvershootStats;
  /** Largest smoothed errors (for inspection). */
  worst: { sec: number; truth: number; detected: number; errCents: number }[];
}

export interface TakeReadings { take: RenderedTake; readings: TrackReading[] }

/** Tracker output vs ground truth, pooled over one or more takes. */
export function fidelity(pairs: TakeReadings[], nearSec = 0.15): Fidelity {
  const buckets = () => ({ overall: [] as number[], nearTransitions: [] as number[], steady: [] as number[] });
  const sm = buckets();
  const raw = buckets();
  let voicedN = 0;
  let missed = 0;
  let unvoicedN = 0;
  let falseV = 0;
  const worst: Fidelity['worst'] = [];
  for (const { take, readings } of pairs) {
    const trans = transitionTimes(take);
    const near = (t: number) => trans.some((x) => Math.abs(t - x) <= nearSec);
    for (const r of readings) {
      if (r.stampSec > take.stopSec) break;
      const tr = truthAt(take.truthMidi, r.stampSec);
      if (Number.isFinite(tr)) {
        voicedN++;
        if (r.midi == null) missed++;
        else {
          const e = 100 * (r.midi - tr);
          sm.overall.push(e);
          (near(r.stampSec) ? sm.nearTransitions : sm.steady).push(e);
          worst.push({ sec: r.stampSec, truth: tr, detected: r.midi, errCents: e });
        }
      } else {
        unvoicedN++;
        if (r.midi != null) falseV++;
      }
      const trc = truthAt(take.truthMidi, r.centreSec);
      if (Number.isFinite(trc) && r.rawMidi != null) {
        const e = 100 * (r.rawMidi - trc);
        raw.overall.push(e);
        (near(r.centreSec) ? raw.nearTransitions : raw.steady).push(e);
      }
    }
  }
  worst.sort((a, b) => Math.abs(b.errCents) - Math.abs(a.errCents));
  const stats = (b: ReturnType<typeof buckets>) => ({ overall: errStats(b.overall), nearTransitions: errStats(b.nearTransitions), steady: errStats(b.steady) });
  return {
    smoothed: stats(sm),
    raw: stats(raw),
    missedVoiced: voicedN ? missed / voicedN : NaN,
    falseVoiced: unvoicedN ? falseV / unvoicedN : NaN,
    overshoot: overshoot(pairs),
    worst: worst.slice(0, 5),
  };
}

/** Overshoot after legato pitch changes: voice vs what the tracker reports. */
export function overshoot(pairs: TakeReadings[], winSec = 0.4): OvershootStats {
  const acc = { n: 0, centre: 0, truth: 0, det: 0, share: 0, inv: 0, hid: 0 };
  for (const { take, readings } of pairs) {
    for (let k = 1; k < take.notes.length; k++) {
      const a = take.notes[k - 1];
      const b = take.notes[k];
      if (b.afterRest || Math.abs(b.targetMidi - a.targetMidi) < 0.8) continue;
      const dir = Math.sign(b.targetMidi - a.targetMidi);
      const t0 = b.cmdSec;
      const t1 = Math.min(t0 + winSec, take.notes[k + 1]?.cmdSec ?? Infinity);
      if (t1 - t0 < 0.15) continue;
      let oc = 0;
      let ot = 0;
      for (let t = t0; t < t1; t += 0.002) {
        const c = truthAt(take.truthCentre, t);
        const v = truthAt(take.truthMidi, t);
        if (Number.isFinite(c)) oc = Math.max(oc, 100 * dir * (c - b.targetMidi));
        if (Number.isFinite(v)) ot = Math.max(ot, 100 * dir * (v - b.targetMidi));
      }
      let od = 0;
      let seen = false;
      for (const r of readings) {
        if (r.stampSec < t0 || r.midi == null) continue;
        if (r.stampSec >= t1) break;
        seen = true;
        od = Math.max(od, 100 * dir * (r.midi - b.targetMidi));
      }
      if (!seen) continue;
      acc.n++;
      acc.centre += oc;
      acc.truth += ot;
      acc.det += od;
      acc.share += oc / (100 * Math.abs(b.targetMidi - a.targetMidi));
      if (od > ot + 25) acc.inv++;
      if (od < ot - 25) acc.hid++;
    }
  }
  const n = acc.n || 1;
  return {
    transitions: acc.n, voiceCentre: acc.centre / n, voiceTrue: acc.truth / n, detected: acc.det / n,
    centreShareOfInterval: acc.share / n, invented: acc.inv / n, hidden: acc.hid / n,
  };
}

// ---------------------------------------------------------------------------------------------
// Where are points lost? (re-derives the baseline scorer's rules per note from the samples)

export interface LossBreakdown {
  notes: number;
  perfect: number;
  /** Not perfect only because |median| > tol/2 (hit ratio was ≥ 0.8). */
  demotedByMedian: number;
  /** Hit ratio < 0.8. */
  lowHitRatio: number;
  /** Of the out-of-tune body time: share in the first 150 ms of the body (transition / late arrival). */
  lostEarlyShare: number;
  /** Mean hitRatio of notes with body < 0.27 s (median rule) vs longer notes. */
  shortNoteHit: number;
  longNoteHit: number;
  /** Mean voicedRatio (body time with any pitch). */
  voicedRatio: number;
}

export function lossBreakdown(part: Part, r: AttemptResult, samples: PitchSample[], tol: number, vibWin = 0.18, grace = 0.08): LossBreakdown {
  let perfect = 0;
  let byMed = 0;
  let lowHit = 0;
  let lostEarly = 0;
  let lostAll = 0;
  let shortH = 0;
  let shortN = 0;
  let longH = 0;
  let longN = 0;
  let voiced = 0;
  const sorted = [...samples].sort((a, b) => a.time - b.time);
  for (const n of r.notes) {
    const note = part.notes[n.index];
    voiced += n.voicedRatio;
    if (n.grade === 'perfect') perfect++;
    else if (n.hitRatio >= 0.8) byMed++;
    else lowHit++;
    const g = Math.min(grace, (note.dur < 0.3 ? 0.4 : 0.3) * note.dur);
    const bs = note.start + g;
    const be = Math.max(bs + 1e-3, note.start + note.dur - Math.min(0.04, 0.2 * note.dur));
    const body = be - bs;
    if (body < 1.5 * vibWin) { shortH += n.hitRatio; shortN++; } else { longH += n.hitRatio; longN++; }
    // Centred moving average over the body (as the baseline finalize does), then locate misses.
    const pts = sorted.filter((s) => s.time >= bs && s.time < be && s.midi != null);
    for (let i = 0; i < pts.length; i++) {
      let sum = 0;
      let c = 0;
      for (const p of pts) if (Math.abs(p.time - pts[i].time) <= vibWin / 2) { sum += 100 * (p.midi! - note.midi); c++; }
      const dev = body < 1.5 * vibWin ? 100 * (pts[i].midi! - note.midi) : sum / c;
      if (Math.abs(dev) > tol) {
        lostAll++;
        if (pts[i].time < bs + 0.15) lostEarly++;
      }
    }
  }
  const N = r.notes.length || 1;
  return {
    notes: r.notes.length, perfect, demotedByMedian: byMed, lowHitRatio: lowHit,
    lostEarlyShare: lostAll ? lostEarly / lostAll : 0,
    shortNoteHit: shortN ? shortH / shortN : NaN, longNoteHit: longN ? longH / longN : NaN,
    voicedRatio: voiced / N,
  };
}

// ---------------------------------------------------------------------------------------------
// The live cents bubble (highway2d.ts): what the singer SEES around note changes.

export interface BubbleStats {
  changes: number;
  /** Mean of the largest readout toward the previous note (¢, lag artefact), per note change. */
  lagPeak: number;
  /** Mean of the largest readout beyond the new note (¢, "overshoot" as displayed). */
  overPeak: number;
  /** Share of note changes where the bubble shows > tolerance toward the previous note. */
  lagShare: number;
  /** Share where the bubble shows > tolerance beyond the new note. */
  overShare: number;
  /** Mean real-time ms after the bar changes until the bubble is last out of tolerance (within 1 s). */
  settleMs: number;
}

/**
 * Emulate the cents bubble: at 60 fps, pos = scoreTimeAt(ctx − outputLatency); the target is the
 * note under pos; the readout averages the last 0.2 s of samples within 1.5 st of the latest one.
 * `samples` must be the mapped PitchSamples with `availSec[i]` = rec time sample i becomes visible.
 */
export function bubbleStats(
  part: Part, range: [number, number], samples: PitchSample[], availSec: number[],
  m: { scoreTimeAtSample0: number; rate: number; outputLatencyMs: number; tolerance: number; stopSec: number },
): BubbleStats {
  const fps = 60;
  const acc = { n: 0, lag: 0, over: 0, lagN: 0, overN: 0, settle: 0 };
  const changes: { k: number; start: number; end: number; dir: number }[] = [];
  for (let i = range[0] + 1; i <= range[1]; i++) {
    const a = part.notes[i - 1];
    const b = part.notes[i];
    if (b.midi === a.midi || b.start - (a.start + a.dur) > 0.03) continue;
    changes.push({ k: i, start: b.start, end: b.start + Math.min(b.dur, 1.0 * m.rate), dir: Math.sign(b.midi - a.midi) });
  }
  let si = 0;
  for (const ch of changes) {
    const target = part.notes[ch.k].midi;
    let lag = 0;
    let over = 0;
    let lastBad = -1;
    let seen = false;
    const tau0 = (ch.start - m.scoreTimeAtSample0) / m.rate + m.outputLatencyMs / 1000;
    const tau1 = (ch.end - m.scoreTimeAtSample0) / m.rate + m.outputLatencyMs / 1000;
    si = 0;
    for (let tau = tau0; tau < Math.min(tau1, m.stopSec); tau += 1 / fps) {
      const pos = m.scoreTimeAtSample0 + (tau - m.outputLatencyMs / 1000) * m.rate;
      while (si < samples.length && availSec[si] <= tau) si++;
      const last = samples[si - 1];
      if (!last || last.midi == null || pos - last.time >= 0.2) continue;
      let sum = 0;
      let cnt = 0;
      for (let k = si - 1; k >= 0 && last.time - samples[k].time < 0.2; k--) {
        const mm = samples[k].midi;
        if (mm != null && Math.abs(mm - last.midi) < 1.5) { sum += mm; cnt++; }
      }
      const shown = cnt ? sum / cnt : last.midi;
      const c = (shown - target) * 100 * ch.dir;
      seen = true;
      lag = Math.max(lag, -c);
      over = Math.max(over, c);
      if (Math.abs(c) > m.tolerance) lastBad = tau - tau0;
    }
    if (!seen) continue;
    acc.n++;
    acc.lag += Math.max(0, lag);
    acc.over += Math.max(0, over);
    if (lag > m.tolerance) acc.lagN++;
    if (over > m.tolerance) acc.overN++;
    acc.settle += Math.max(0, lastBad) * 1000;
  }
  const n = acc.n || 1;
  return { changes: acc.n, lagPeak: acc.lag / n, overPeak: acc.over / n, lagShare: acc.lagN / n, overShare: acc.overN / n, settleMs: acc.settle / n };
}
