// Scoring of a sung attempt against one part.
//
// scoreAttempt() is implemented on top of LiveScorer (push every sample in time order, then
// finish()), so the live display and the final result can never disagree.

import type { Part, Score, ScoreNote } from '../music/types';
import type { AttemptResult, Grade, NoteResult, PitchSample, ScoringOptions } from './types';
import { analyze } from './analysis';

export interface ScoringContext {
  score: Score;
  part: Part;
  /** Inclusive indices into part.notes. */
  range: [number, number];
}

export const DEFAULT_ONSET_GRACE = 0.08;
/** Seconds ignored at the end of each note (release / next consonant). */
const TAIL = 0.04;
/** Max time one sample may stand for, on each side of it. */
const HALF_COVER_MAX = 0.025;
/** Assumed half-period for the first/last sample (no neighbour known). */
const EDGE_HALF_COVER = 0.01;
const SCOOP_WINDOW = 0.15;
const SHORT_BODY = 0.15;
/** Default vibrato smoothing window (≈ one vibrato cycle at 5.5 Hz). */
export const DEFAULT_VIBRATO_WINDOW = 0.18;

export const GRADE_POINTS: Record<Grade, number> = { perfect: 100, good: 70, ok: 40, miss: 0 };
export const GRADE_VALUE: Record<Grade, number> = { perfect: 1, good: 0.85, ok: 0.5, miss: 0 };
const GRADE_RANK: Record<Grade, number> = { miss: 0, ok: 1, good: 2, perfect: 3 };

export function comboMultiplier(combo: number): number {
  return Math.min(4, 1 + Math.floor(combo / 8));
}

export function rhythmValue(onsetMs: number | null): number {
  if (onsetMs === null) return 0;
  return clamp(1 - (Math.abs(onsetMs - 40) - 60) / 400, 0, 1);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---------------------------------------------------------------------------------------------
// Just intonation

/** JI deviation (cents) from equal temperament by interval above the chord root. */
const JI_CENTS: Record<number, number> = {
  0: 0, 1: 11.7, 2: 3.9, 3: 15.6, 4: -13.7, 5: -2.0, 6: -9.8, 7: 2.0, 8: 13.7, 9: -15.6, 10: -3.9, 11: -11.7,
};
const HARMONIC_SEVENTH = -31.2;

interface ChordTemplate { name: string; tones: number[] }
const TEMPLATES: ChordTemplate[] = [
  { name: 'maj', tones: [0, 4, 7] },
  { name: 'min', tones: [0, 3, 7] },
  { name: 'dom7', tones: [0, 4, 7, 10] },
  { name: 'min7', tones: [0, 3, 7, 10] },
  { name: 'maj7', tones: [0, 4, 7, 11] },
  { name: 'hdim7', tones: [0, 3, 6, 10] },
  { name: 'dim7', tones: [0, 3, 6, 9] },
  { name: 'sus4', tones: [0, 5, 7] },
];

const mod12 = (n: number) => ((Math.round(n) % 12) + 12) % 12;

/** Guess the chord root (pitch class) and chord type from a set of MIDI pitches. */
export function guessChord(pitches: number[]): { root: number; type: string | null } {
  if (pitches.length === 0) return { root: 0, type: null };
  const bass = mod12(Math.min(...pitches));
  const pcs = [...new Set(pitches.map(mod12))];
  if (pcs.length === 1) return { root: pcs[0], type: null };
  let best: { root: number; type: string; score: number; matched: number } | null = null;
  for (const root of pcs) {
    for (const t of TEMPLATES) {
      const rel = pcs.map((p) => (p - root + 12) % 12);
      const matched = rel.filter((r) => t.tones.includes(r)).length;
      const extra = rel.length - matched;
      const missing = t.tones.length - matched;
      const score = matched * 2 - extra * 3 - missing * 0.75 + (root === bass ? 0.5 : 0);
      if (!best || score > best.score + 1e-9) best = { root, type: t.name, score, matched };
    }
  }
  if (!best || best.matched < 2) return { root: bass, type: null };
  return { root: best.root, type: best.type };
}

/**
 * Cents to add to the equal-tempered target so it is tuned justly against the chord root
 * guessed from `sounding` (other voices) + the target itself. 0 when there is no harmony.
 */
export function justOffsetCents(targetMidi: number, sounding: number[]): number {
  if (sounding.length === 0) return 0;
  const { root, type } = guessChord([...sounding, targetMidi]);
  const i = (mod12(targetMidi) - root + 12) % 12;
  if (i === 10 && type === 'dom7') return HARMONIC_SEVENTH;
  return JI_CENTS[i];
}

/** MIDI pitches of all other parts sounding at `time` (local helper; parts are monophonic, notes sorted). */
function soundingOthers(score: Score, time: number, excludePartId: string): number[] {
  const out: number[] = [];
  for (const p of score.parts) {
    if (p.id === excludePartId) continue;
    const ns = p.notes;
    // binary search last note with start <= time
    let lo = 0, hi = ns.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ns[mid].start <= time) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    // walk back a little in case of overlapping notes
    for (let j = idx; j >= 0 && j >= idx - 3; j--) {
      const n = ns[j];
      if (n.start <= time && time < n.start + n.dur) out.push(n.midi);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Per-note accumulator

interface NoteWindow {
  index: number;
  note: ScoreNote;
  /** Target in fractional MIDI incl. JI offset. */
  target: number;
  targetOffset: number;
  start: number;
  bodyStart: number;
  bodyEnd: number;
}

class NoteAcc {
  hitTime = 0;
  voicedTime = 0;
  /** Deviations (folded if octave tolerant) of voiced body samples, in time order. */
  devs: number[] = [];
  /** Count of voiced body samples that needed octave folding to be in tolerance. */
  octaveSamples = 0;
  onsetMs: number | null = null;
  scoopDevs: number[] = [];
  /** Causal moving-average window over body deviations (vibrato smoothing). */
  smT: number[] = [];
  smD: number[] = [];
  smHead = 0;
  smSum = 0;
  /** Any single unsmoothed body sample within tolerance (short-note leniency). */
  rawHit = false;
  final: NoteResult | null = null;
  constructor(readonly w: NoteWindow) {}
}

function noteWindows(ctx: ScoringContext, opts: ScoringOptions): NoteWindow[] {
  const [a, b] = ctx.range;
  const notes = ctx.part.notes;
  const out: NoteWindow[] = [];
  const graceOpt = opts.onsetGrace ?? DEFAULT_ONSET_GRACE;
  for (let i = Math.max(0, a); i <= Math.min(b, notes.length - 1); i++) {
    const note = notes[i];
    const grace = Math.min(graceOpt, 0.3 * note.dur);
    const tail = Math.min(TAIL, 0.2 * note.dur);
    const bodyStart = note.start + grace;
    const bodyEnd = Math.max(bodyStart + 1e-3, note.start + note.dur - tail);
    const targetOffset = opts.tuning === 'just'
      ? justOffsetCents(note.midi, soundingOthers(ctx.score, note.start + note.dur / 2, ctx.part.id))
      : 0;
    out.push({ index: i, note, target: note.midi + targetOffset / 100, targetOffset, start: note.start, bodyStart, bodyEnd });
  }
  return out;
}

/** A sample with the time span it stands for. */
interface Covered { s: PitchSample; from: number; to: number }

export class LiveScorer {
  private readonly windows: NoteWindow[];
  private readonly accs: NoteAcc[];
  private readonly byIndex = new Map<number, NoteAcc>();
  private readonly tol: number;
  private readonly vibWin: number;
  /** All samples pushed, in push order. */
  private readonly all: PitchSample[] = [];
  /** Samples waiting for their right neighbour (sorted by time, at most a few). */
  private pending: PitchSample[] = [];
  private prevProcessedTime = -Infinity;
  private outOfOrder = false;
  /** First note not yet finalized. */
  private cur = 0;
  private _combo = 0;
  private _maxCombo = 0;
  private _score = 0;
  private finished: AttemptResult | null = null;

  constructor(private readonly ctx: ScoringContext, private readonly opts: ScoringOptions) {
    this.windows = noteWindows(ctx, opts);
    this.accs = this.windows.map((w) => new NoteAcc(w));
    for (const a of this.accs) this.byIndex.set(a.w.index, a);
    this.tol = opts.toleranceCents;
    this.vibWin = opts.vibratoWindow ?? DEFAULT_VIBRATO_WINDOW;
  }

  get combo(): number { return this._combo; }
  get maxCombo(): number { return this._maxCombo; }
  get score(): number { return this._score; }

  push(s: PitchSample): void {
    this.finished = null;
    this.all.push(s);
    if (s.time < this.prevProcessedTime) {
      // Too late to place it live; finish() rescoring from the sorted list takes care of it.
      this.outOfOrder = true;
      return;
    }
    // Insert into the small pending buffer keeping it sorted.
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].time > s.time) i--;
    this.pending.splice(i, 0, s);
    // Keep two samples buffered so each processed one knows both neighbours.
    while (this.pending.length > 2) this.processHead(false);
  }

  /** Hit ratio so far of note `i` (index into part.notes), 0..1, for drawing. */
  noteFill(i: number): number {
    const a = this.byIndex.get(i);
    if (!a) return 0;
    if (a.final) return a.final.hitRatio;
    return clamp(a.hitTime / (a.w.bodyEnd - a.w.bodyStart), 0, 1);
  }

  /** Grade of note `i` once it is over. */
  noteGrade(i: number): Grade | undefined {
    return this.byIndex.get(i)?.final?.grade;
  }

  /** Live result of note `i` once it is over. */
  noteResult(i: number): NoteResult | undefined {
    return this.byIndex.get(i)?.final ?? undefined;
  }

  finish(samplesSoFar?: PitchSample[]): AttemptResult {
    if (samplesSoFar || this.outOfOrder) {
      const src = [...(samplesSoFar ?? this.all)].sort((a, b) => a.time - b.time);
      const fresh = new LiveScorer(this.ctx, this.opts);
      for (const s of src) fresh.push(s);
      return fresh.finish();
    }
    if (this.finished) return this.finished;
    while (this.pending.length > 0) this.processHead(this.pending.length === 1);
    for (let j = this.cur; j < this.accs.length; j++) this.finalize(this.accs[j]);
    this.cur = this.accs.length;
    const notes = this.accs.map((a) => a.final!);
    this.finished = summarize(this.ctx, notes, this._maxCombo, this._score, this.all);
    return this.finished;
  }

  // -- internals -------------------------------------------------------------------------------

  private processHead(isLast: boolean): void {
    const s = this.pending.shift()!;
    const next = isLast ? undefined : this.pending[0];
    const prevT = this.prevProcessedTime;
    const left = Number.isFinite(prevT) ? Math.min((s.time - prevT) / 2, HALF_COVER_MAX) : EDGE_HALF_COVER;
    const right = next ? Math.min((next.time - s.time) / 2, HALF_COVER_MAX) : EDGE_HALF_COVER;
    this.prevProcessedTime = s.time;
    this.apply({ s, from: s.time - left, to: s.time + right });
  }

  private apply(c: Covered): void {
    const t = c.s.time;
    // Finalize notes whose body is completely before this sample's coverage.
    while (this.cur < this.accs.length && this.accs[this.cur].w.bodyEnd <= c.from) {
      this.finalize(this.accs[this.cur]);
      this.cur++;
    }
    for (let j = this.cur; j < this.accs.length; j++) {
      const a = this.accs[j];
      if (a.w.start > c.to) break;
      if (a.final) continue;
      this.addToNote(a, c, t);
    }
  }

  private addToNote(a: NoteAcc, c: Covered, t: number): void {
    const w = a.w;
    const midi = c.s.midi;
    let dev: number | null = null;
    let rawDev: number | null = null;
    if (midi !== null && Number.isFinite(midi)) {
      rawDev = 100 * (midi - w.target);
      dev = rawDev;
      if (this.opts.octaveTolerant) {
        const k = Math.round(dev / 1200);
        if (k !== 0) dev -= 1200 * k;
      }
    }
    const inTol = dev !== null && Math.abs(dev) <= this.tol;
    // Onset & scoop use samples from the note start (grace included).
    if (t >= w.start && t < w.bodyEnd) {
      if (inTol && a.onsetMs === null) a.onsetMs = Math.max(0, (t - w.start) * 1000);
      if (dev !== null && t < w.start + SCOOP_WINDOW) a.scoopDevs.push(dev);
    }
    // Body coverage. In-tune is judged on the vibrato-smoothed deviation (mean over the last
    // ~one vibrato cycle of this note's body), so a centred vibrato is not punished.
    const overlap = Math.min(c.to, w.bodyEnd) - Math.max(c.from, w.bodyStart);
    if (overlap > 0 && dev !== null) {
      let smooth = dev;
      if (this.vibWin > 0 && t >= w.bodyStart) {
        a.smT.push(t);
        a.smD.push(dev);
        a.smSum += dev;
        while (a.smT[a.smHead] <= t - this.vibWin) a.smSum -= a.smD[a.smHead++];
        smooth = a.smSum / (a.smT.length - a.smHead);
      }
      a.voicedTime += overlap;
      if (inTol) a.rawHit = true;
      if (Math.abs(smooth) <= this.tol) a.hitTime += overlap;
      if (t >= w.bodyStart && t < w.bodyEnd) {
        a.devs.push(dev);
        // Octave error: the sample is in tune only after folding by whole octaves.
        if (rawDev !== null && Math.abs(rawDev) > 600) {
          const f = rawDev - 1200 * Math.round(rawDev / 1200);
          if (Math.abs(f) <= Math.max(this.tol, 50)) a.octaveSamples++;
        }
      }
    }
  }

  private finalize(a: NoteAcc): void {
    if (a.final) return;
    const w = a.w;
    const bodyDur = w.bodyEnd - w.bodyStart;
    const hitRatio = clamp(a.hitTime / bodyDur, 0, 1);
    const voicedRatio = clamp(a.voicedTime / bodyDur, 0, 1);
    const cents = median(a.devs);
    const tol = this.tol;
    let grade: Grade =
      hitRatio >= 0.8 && cents !== null && Math.abs(cents) <= tol / 2 ? 'perfect'
        : hitRatio >= 0.6 ? 'good'
          : hitRatio >= 0.35 ? 'ok'
            : 'miss';
    if (bodyDur < SHORT_BODY && (a.hitTime > 0 || a.rawHit) && GRADE_RANK[grade] < GRADE_RANK.good) grade = 'good';
    const octave = a.devs.length > 0 && a.octaveSamples > a.devs.length / 2;
    if (octave && this.opts.octaveTolerant && GRADE_RANK[grade] > GRADE_RANK.ok) grade = 'ok';

    let drift: number | null = null;
    if (a.devs.length >= 6) {
      const third = Math.floor(a.devs.length / 3);
      drift = median(a.devs.slice(-third))! - median(a.devs.slice(0, third))!;
    }
    const scoopMed = median(a.scoopDevs);
    const scoop = scoopMed === null ? null : scoopMed < -60 ? 'below' : scoopMed > 60 ? 'above' : null;

    let points = 0;
    if (grade === 'miss') {
      this._combo = 0;
    } else {
      points = GRADE_POINTS[grade] * comboMultiplier(this._combo);
      this._combo++;
      this._maxCombo = Math.max(this._maxCombo, this._combo);
    }
    this._score += points;
    a.final = {
      index: w.index, grade, cents, hitRatio, voicedRatio, onsetMs: a.onsetMs, drift, scoop,
      targetOffset: w.targetOffset, points, ...(octave ? { octave: true } : {}),
    };
  }
}

function summarize(ctx: ScoringContext, notes: NoteResult[], maxCombo: number, score: number, samples: PitchSample[]): AttemptResult {
  const counts: Record<Grade, number> = { perfect: 0, good: 0, ok: 0, miss: 0 };
  for (const n of notes) counts[n.grade]++;
  const N = notes.length;
  const accuracy = N ? notes.reduce((s, n) => s + GRADE_VALUE[n.grade], 0) / N : 0;
  const pitch = N ? notes.reduce((s, n) => s + n.hitRatio, 0) / N : 0;
  const rhythm = N ? notes.reduce((s, n) => s + rhythmValue(n.onsetMs), 0) / N : 0;
  const sums = new Map<number, { s: number; n: number }>();
  for (const n of notes) {
    const m = ctx.part.notes[n.index].measure;
    const e = sums.get(m) ?? { s: 0, n: 0 };
    e.s += GRADE_VALUE[n.grade];
    e.n++;
    sums.set(m, e);
  }
  const perMeasure: Record<number, number> = {};
  for (const [m, e] of sums) perMeasure[m] = e.s / e.n;
  const insights = analyze(ctx, notes, samples);
  return { accuracy, pitch, rhythm, score, maxCombo, counts, notes, perMeasure, insights };
}

/** Score a complete attempt. Samples may be in any order. */
export function scoreAttempt(ctx: ScoringContext, samples: PitchSample[], opts: ScoringOptions): AttemptResult {
  const sorted = [...samples].sort((a, b) => a.time - b.time);
  const ls = new LiveScorer(ctx, opts);
  for (const s of sorted) ls.push(s);
  return ls.finish();
}
