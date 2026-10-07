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
  /**
   * Score time where the run ends (the section's end). A note tied over it is judged on the part
   * before it: the player stops there, and the app stops listening soon after. Default: no end.
   */
  end?: number;
}

export const DEFAULT_ONSET_GRACE = 0.08;
/** Sustained sound needed before a note counts as started (seconds; shorter for very short notes). */
export const ONSET_RUN = 0.06;
/** Seconds ignored at the end of each note (release / next consonant). */
const TAIL = 0.04;
/** Max time one sample may stand for, on each side of it. */
const HALF_COVER_MAX = 0.025;
/** Assumed half-period for the first/last sample (no neighbour known). */
const EDGE_HALF_COVER = 0.01;
const SCOOP_WINDOW = 0.15;
/** A note whose body is shorter than this is "very short" (fast passages): also judged as a whole (shortNoteDev). */
const SHORT_BODY = 0.15;
/**
 * Very short notes: a reading this far (cents) from the note and from both neighbours is a tracker
 * error (McLeod locking onto a subharmonic, e.g. ×⅕ ≈ −2786¢, in a fast change), not a sung pitch.
 */
const SHORT_FAR = 600;
/** Very short notes: how uneven a swing around the note may be (swingsAround). */
const SWING_RATIO = 1.5;
/**
 * Very short notes are judged on their own readings (shortNoteDev) only with at least this many of
 * them, standing for at least SHORT_MIN_COVER of the note: one reading (an attack, a consonant, the
 * guide bleeding into the mic) says little about what was sung.
 */
const SHORT_MIN_READINGS = 2;
const SHORT_MIN_COVER = 0.3;
/**
 * ...of which an uninterrupted run (no unvoiced reading between) must stand for SHORT_MIN_COVER and
 * reach at least this far into the note: the attack alone, or scattered single frames, are where
 * consonants and guide bleed land.
 */
const SHORT_MIN_REACH = 0.35;
/** Readings standing for this share of a very short note count as the whole note (hit ratio 1). */
const SHORT_FULL_COVER = 0.4;
/** A very short note is "on the note" (for the in-tune-moment rescue) with its median within this many tolerances, at most ON_NOTE_MAX cents. */
const ON_NOTE_TOL = 1.6;
const ON_NOTE_MAX = 50;
/** Default vibrato smoothing window (≈ one vibrato cycle at 5.5 Hz). */
export const DEFAULT_VIBRATO_WINDOW = 0.18;
/**
 * A voice needs a moment to settle on a new pitch: it glides, overshoots and rings for ~0.1–0.3 s,
 * and the device delay is never exact. Intonation is judged from when the voice arrives within
 * tolerance, up to this many seconds (and 35% of the note) after the written start (plus
 * whatever the line-up of the run corrects for the device delay). Coming in
 * late is a timing matter (onset), not an intonation one.
 */
export const TRANSITION_MAX = 0.15;
/** Likewise at the end of a note that leads into another: moving early / the next consonant. */
export const RELEASE_MAX = 0.12;
/** Gaps in the voiced readings shorter than this inside a note (tracker dropouts, an inner consonant) aren't penalised. */
const DROPOUT_MAX = 0.1;
/**
 * The pitch tracker's range in Hz (src/audio/pitch.ts MIN_HZ / MAX_HZ): a written note outside it
 * can't be heard reliably (NoteResult.unsure = 'range'). Kept here so scoring stays free of audio code.
 */
export const TRACKER_LOW_HZ = 60;
export const TRACKER_HIGH_HZ = 1400;
/**
 * A note the scorer can't judge reliably, graded below "good", still counts as clearly wrong when its
 * own readings put it this many tolerances (or more) off: the tracker heard a definite wrong pitch.
 */
export const CLEAR_OFF_TOL = 1.5;
/**
 * Below this input level (RMS) a reading is silence (src/audio/pitch.ts RMS_GATE): an unsure note
 * with no voiced reading and every reading this quiet wasn't sung at all (NoteResult.clearly 'silent').
 */
export const SILENCE_RMS = 0.005;
/**
 * Below this pitch (Hz) a sung "oo" can put its strongest partial at twice the pitch (the first
 * formant sits near 300 Hz), and the tracker then reads some or all of the note an octave up. At an
 * every-note level such a low note is let off (NoteResult.unsure 'octave') when it is right once
 * readings an octave up are folded down. Only upward: an octave low is never folded.
 */
export const OCTAVE_UP_HZ = 200;
/**
 * Readings this far under the note (cents) are the tracker locking onto a fraction of the pitch
 * (×⅓ ≈ −1902, ×¼ = −2400, ×⅕ ≈ −2786 … ×1/14 ≈ −4569), never a sung pitch: a minority of them is
 * let off at level 1 (NoteResult.unsure 'tracker').
 */
export const SUBHARMONIC_HIGH = -1800;
export const SUBHARMONIC_LOW = -4600;
/**
 * Mic trouble (NoteResult.unsure 'mic'): at least this share of the note's body carries the tracker's
 * evidence of input trouble (PitchSample.mic)…
 */
export const MIC_SHARE = 0.25;
/** …the singer was heard through at least this share of it (a voiced reading, or this loud: SOUND_RMS)… */
export const MIC_SOUND_SHARE = 0.7;
export const SOUND_RMS = 0.02;
/** …and at most this share of its pitched readings were elsewhere (a wrong note is never let off). */
export const MIC_OFF_SHARE = 0.25;

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
  /** Pitch of the previous note when it runs legato into this one (null after a rest). */
  legatoFrom: number | null;
  /** Pitch of the next note when this one leads straight into it (null before a rest). */
  legatoTo: number | null;
  /** Extra tolerance (cents) — just-intonation mode accepts both the pure and the tempered pitch. */
  tolExtra: number;
  /** Very short note (body < SHORT_BODY): also judged on all its readings from the written start to end. */
  short: boolean;
  /** Written pitch outside the tracker's range (TRACKER_LOW_HZ…TRACKER_HIGH_HZ). */
  outOfRange: boolean;
  /** Written pitch below OCTAVE_UP_HZ (the tracker may read it an octave up). */
  lowForOctave: boolean;
  /** The note can be finalized once samples are past this time. */
  doneAt: number;
}

class NoteAcc {
  hitTime = 0;
  voicedTime = 0;
  /** Deviations (folded if octave tolerant) of voiced body samples, in time order. */
  devs: number[] = [];
  /** Count of voiced body samples that needed octave folding to be in tolerance. */
  octaveSamples = 0;
  onsetMs: number | null = null;
  /** Start of the current run of qualifying voiced samples (onset needs ~60 ms of sound). */
  runStart: number | null = null;
  runMiss = 0;
  /** An unvoiced gap (consonant/breath) occurred since the note's written start. */
  broke = false;
  /** First voiced sample of this note's own sound (after a consonant / not the held previous pitch). */
  voiceStart: number | null = null;
  scoopDevs: number[] = [];
  /** Causal moving-average window over body deviations (vibrato smoothing). */
  smT: number[] = [];
  smD: number[] = [];
  smHead = 0;
  smSum = 0;
  /** Body samples (time, deviation, covered seconds) for the final whole-note judgement. */
  bT: number[] = [];
  bD: number[] = [];
  bW: number[] = [];
  /** Very short notes: every voiced reading within the written note (time, deviation). */
  nT: number[] = [];
  nD: number[] = [];
  /** ...and the seconds of the written note each of them stands for. */
  nW: number[] = [];
  /** ...and which run of uninterrupted voiced readings each belongs to (counts the unvoiced ones in the note). */
  nR: number[] = [];
  nBreaks = 0;
  /** Readings inside the written note, and how many of them had sound (level at or above SILENCE_RMS). */
  inNote = 0;
  loudInNote = 0;
  /** Body seconds with the tracker's mic-trouble flag, and with sound (voiced or loud). */
  micTime = 0;
  soundTime = 0;
  final: NoteResult | null = null;
  constructor(readonly w: NoteWindow) {}
}

function noteWindows(ctx: ScoringContext, opts: ScoringOptions): NoteWindow[] {
  const [a, b] = ctx.range;
  const notes = ctx.part.notes;
  const out: NoteWindow[] = [];
  const graceOpt = opts.onsetGrace ?? DEFAULT_ONSET_GRACE;
  for (let i = Math.max(0, a); i <= Math.min(b, notes.length - 1); i++) {
    const written = notes[i];
    // A note tied over the end of the run: only the part before the end can be sung and heard.
    const cut = ctx.end != null && written.start + written.dur > ctx.end + 1e-6 && ctx.end > written.start;
    const note = cut ? { ...written, dur: Math.max(1e-3, ctx.end! - written.start) } : written;
    // Short notes: allow a larger share for the attack (detection lag + consonant).
    const grace = Math.min(graceOpt, (note.dur < 0.3 ? 0.4 : 0.3) * note.dur);
    const tail = Math.min(TAIL, 0.2 * note.dur);
    const bodyStart = note.start + grace;
    const bodyEnd = Math.max(bodyStart + 1e-3, note.start + note.dur - tail);
    const targetOffset = opts.tuning === 'just'
      ? justOffsetCents(note.midi, soundingOthers(ctx.score, note.start + note.dur / 2, ctx.part.id))
      : 0;
    const prev = i > 0 ? notes[i - 1] : null;
    // The previous pitch still matters across short rests: a late singer may still be on it.
    const legatoFrom = prev && prev.start + prev.dur >= note.start - 1.0 ? prev.midi : null;
    const next = i + 1 < notes.length ? notes[i + 1] : null;
    const legatoTo = next && next.start <= note.start + note.dur + 0.25 ? next.midi : null;
    // Just intonation: aim halfway between pure and tempered and widen the window by the same
    // amount, so singing either what the (tempered) backing plays or the pure interval is fine.
    const half = targetOffset / 2;
    const short = bodyEnd - bodyStart < SHORT_BODY;
    const hz = 440 * Math.pow(2, (note.midi - 69) / 12);
    out.push({
      index: i, note, target: note.midi + half / 100, targetOffset, start: note.start, bodyStart, bodyEnd, legatoFrom, legatoTo, tolExtra: Math.abs(half),
      short, outOfRange: hz < TRACKER_LOW_HZ || hz > TRACKER_HIGH_HZ, lowForOctave: hz < OCTAVE_UP_HZ, doneAt: short ? note.start + note.dur : bodyEnd,
    });
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
    // Vibrato is real time: at a slower tempo one cycle spans fewer score seconds (ScoringOptions.rate).
    this.vibWin = (opts.vibratoWindow ?? DEFAULT_VIBRATO_WINDOW) * (opts.rate && opts.rate > 0 ? opts.rate : 1);
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
    // Finalize notes whose body (very short notes: the whole note) is completely before this sample's coverage.
    while (this.cur < this.accs.length && this.accs[this.cur].w.doneAt <= c.from) {
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
    const tol = this.tol + w.tolExtra;
    if (t >= w.start && t < w.start + w.note.dur) {
      a.inNote++;
      if (dev !== null || c.s.rms >= SILENCE_RMS) a.loudInNote++;
    }
    if (w.short && dev === null && t >= w.start && t < w.start + w.note.dur) a.nBreaks++;
    if (w.short && dev !== null && t >= w.start && t < w.start + w.note.dur) {
      a.nT.push(t);
      a.nD.push(dev);
      a.nW.push(Math.max(0, Math.min(c.to, w.start + w.note.dur) - Math.max(c.from, w.start)));
      a.nR.push(a.nBreaks);
    }
    // Onset & scoop use samples from the note start (grace included).
    if (t >= w.start && t < w.bodyEnd) {
      // Timing is judged independently of intonation: the note "starts" with the first voiced
      // sound after a rest, or (legato) once the voice has moved closer to this note than the last.
      if (a.onsetMs === null) {
        let qualifies = false;
        if (midi !== null && Number.isFinite(midi)) {
          // Octave-tolerant singers: compare in the target's octave.
          let m = midi;
          if (this.opts.octaveTolerant) m -= 12 * Math.round((m - w.target) / 12);
          qualifies = w.legatoFrom === null
            ? true
            : w.legatoFrom === w.note.midi
              // Repeated pitch: the voice is already there; vibrato swings ±50¢, so accept a semitone.
              ? Math.abs(m - w.target) <= Math.max(1, (this.tol + w.tolExtra) / 100)
              : Math.abs(m - w.target) < Math.abs(m - w.legatoFrom);
        }
        if (qualifies) {
          a.runMiss = 0;
          if (a.runStart === null) a.runStart = t;
          // A real entry is sustained sound, not a 20 ms blip (or speaker bleed).
          if (t - a.runStart >= Math.min(ONSET_RUN, Math.max(0.02, 0.2 * w.note.dur)) - 1e-9) a.onsetMs = Math.max(0, (a.runStart - w.start) * 1000);
        } else if (++a.runMiss >= 2) {
          // Tolerate a single tracker dropout inside the run.
          a.runStart = null;
          a.runMiss = 0;
        }
      }
      // Still on the previous note's pitch = coming in late, not scooping.
      // Dragging = the previous vowel continues past the beat without a break; a scoop starts
      // a new syllable (consonant gap) and glides up. So "holding the previous pitch" only counts
      // while the voice hasn't broken since the note began.
      if (midi === null && t >= w.start) a.broke = true;
      const holdingPrev = !a.broke && midi !== null && w.legatoFrom !== null && w.legatoFrom !== w.note.midi
        && Math.abs(midi - w.legatoFrom) < Math.min(0.75, 0.6 * Math.abs(w.note.midi - w.legatoFrom)); // vibrato-tolerant
      // The scoop window starts when the (new) voice starts — after any consonant — not at the beat.
      if (dev !== null && !holdingPrev && a.voiceStart === null) a.voiceStart = t;
      if (dev !== null && !holdingPrev && a.voiceStart !== null && t < a.voiceStart + SCOOP_WINDOW && t < w.start + 0.45) a.scoopDevs.push(dev);
    }
    // Body coverage. In-tune is judged on the vibrato-smoothed deviation (mean over the last
    // ~one vibrato cycle of this note's body), so a centred vibrato is not punished.
    const overlap = Math.min(c.to, w.bodyEnd) - Math.max(c.from, w.bodyStart);
    if (overlap > 0) {
      if (c.s.mic) a.micTime += overlap;
      if (dev !== null || c.s.rms >= SOUND_RMS) a.soundTime += overlap;
    }
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
      if (Math.abs(smooth) <= tol) a.hitTime += overlap;
      a.bT.push(t);
      a.bD.push(dev);
      a.bW.push(overlap);
      if (t >= w.bodyStart && t < w.bodyEnd) {
        a.devs.push(dev);
        // Octave error: the sample is in tune only after folding by whole octaves.
        if (rawDev !== null && Math.abs(rawDev) > 600) {
          const f = rawDev - 1200 * Math.round(rawDev / 1200);
          if (Math.abs(f) <= Math.max(tol, 50)) a.octaveSamples++;
        }
      }
    }
  }

  private finalize(a: NoteAcc): void {
    if (a.final) return;
    const w = a.w;
    // A qualifying run that was cut short only by the end of a short note still marks its start.
    if (a.onsetMs === null && a.runStart !== null) a.onsetMs = Math.max(0, (a.runStart - w.start) * 1000);
    const tolN = this.tol + w.tolExtra;
    const judged = judgedSpan(a, tolN, this.opts.octaveTolerant);
    const { k0, k1, from, to } = judged;
    const bodyDur = Math.max(1e-3, to - from);
    const jT = a.bT.slice(k0, k1);
    const jD = a.bD.slice(k0, k1);
    const jW = a.bW.slice(k0, k1);
    // Brief tracker dropouts (a breathy moment, an inner consonant) are excused; a note that
    // simply isn't held to its end is not.
    let excused = 0;
    for (let k = 1; k < jT.length; k++) {
      const gap = jT[k] - jW[k] / 2 - (jT[k - 1] + jW[k - 1] / 2);
      if (gap > 0 && gap < DROPOUT_MAX) excused += gap;
    }
    // Final judgement over the settled part of the note: a vibrato-cancelling average (or the
    // median for short notes), so neither vibrato nor the glide into the note reads as out of tune.
    const hitOf = (D: number[]): number => {
      let hitTime = 0;
      if (jT.length) {
        const sm = vibratoSmoothed(jT, D, this.vibWin);
        if (sm) {
          for (let k = 0; k < jT.length; k++) if (Math.abs(sm[k]) <= tolN) hitTime += jW[k];
        } else {
          // Median, not mean: a short pitch glitch shouldn't sink a short note.
          if (Math.abs(median(D)!) <= tolN) hitTime = jW.reduce((x, y) => x + y, 0) + excused;
        }
      }
      return clamp(hitTime / Math.max(1e-3, bodyDur - excused), 0, 1);
    };
    let hitRatio = hitOf(jD);
    const voicedRatio = clamp(a.voicedTime / Math.max(1e-3, w.bodyEnd - w.bodyStart), 0, 1);
    let medDev = jD.length ? median(jD) : median(a.devs);
    // Very short notes: what was sung is the median of the note's own readings (see shortNoteDev).
    // Very short notes: what was sung is the median of the note's own readings (see shortNoteDev),
    // credited in proportion to how much of the note they stand for.
    const sr = w.short ? shortNoteReadings(a, tolN, this.opts.octaveTolerant) : null;
    const shortReadings = sr && enoughShortReadings(sr, w) ? sr.devs : [];
    const shortDev = median(shortReadings);
    if (sr && shortDev !== null) {
      medDev = shortDev;
      if (Math.abs(shortDev) <= tolN) hitRatio = Math.max(hitRatio, Math.min(1, sr.cover / (SHORT_FULL_COVER * w.note.dur)));
    }
    const tol = tolN;
    let grade: Grade =
      hitRatio >= 0.8 && medDev !== null && Math.abs(medDev) <= tol / 2 ? 'perfect'
        : hitRatio >= 0.6 ? 'good'
          : hitRatio >= 0.35 ? 'ok'
            : 'miss';
    // Very short notes: one in-tune moment (within the judged part), or the voice swinging evenly
    // around the note (see swingsAround), is enough for "good" — as long as the note as a whole was
    // on this note and not on a neighbouring semitone (a voice sitting on the previous pitch, or on
    // a wrong note, passes through the target on its way to the next).
    const onNote = shortDev === null || Math.abs(shortDev) < Math.min(ON_NOTE_MAX, ON_NOTE_TOL * tolN);
    const moment = jD.some((d) => Math.abs(d) <= tolN) || swingsAround(shortReadings, tolN);
    if (w.short && onNote && moment && GRADE_RANK[grade] < GRADE_RANK.good) grade = 'good';
    // With octave tolerance on (the singer deliberately sings the part in their own octave),
    // folding is expected and not an error.
    const octave = !this.opts.octaveTolerant && a.devs.length > 0 && a.octaveSamples > a.devs.length / 2;

    // Drift: compare the first and last third of the settled note on the vibrato-smoothed pitch,
    // so a normal vibrato (or the glide in) doesn't read as sagging or creeping.
    let drift: number | null = null;
    if (jD.length >= 6) {
      const sm = vibratoSmoothed(jT, jD, this.vibWin > 0 ? this.vibWin : DEFAULT_VIBRATO_WINDOW * (this.opts.rate && this.opts.rate > 0 ? this.opts.rate : 1)) ?? jD;
      const third = Math.floor(sm.length / 3);
      drift = median(sm.slice(-third))! - median(sm.slice(0, third))!;
    }
    // Notes the scorer can't judge reliably (see NoteResult.unsure): a written pitch outside the
    // tracker's range, or a very short note (the voice rarely settles; few readings). Below "good",
    // say whether it was still clearly wrong: no sound at all inside the note (either kind), or (very
    // short notes) a definite pitch, from enough of its own readings (see shortNoteDev), clearly off.
    // A low note read (partly) an octave up that is right once those readings are folded down: the
    // tracker's octave error on "oo" (OCTAVE_UP_HZ), not a wrong note. Never folded downward.
    const foldUp = (d: number) => (d > 600 && d < 1800 ? d - 1200 : d);
    const octaveUp = w.lowForOctave && !this.opts.octaveTolerant && GRADE_RANK[grade] < GRADE_RANK.good
      && jD.some((d) => d > 600 && d < 1800) && hitOf(jD.map(foldUp)) >= 0.6;
    // A note with a minority of readings deep under it and far from both neighbours (the tracker
    // locking onto a fraction of the pitch) that is right once those readings are replaced by the
    // reading before them: a tracker error.
    const farFrom = (d: number, other: number | null) => Math.abs(d - 100 * ((other ?? w.note.midi) - w.target)) > SHORT_FAR;
    // Only the subharmonic band (an octave and a fifth to almost four octaves low, SUBHARMONIC_LOW…
    // SUBHARMONIC_HIGH): a voice can drop an octave or sing a fifth or a sixth off, so readings there
    // always count; nothing sung lands 19–46 semitones under the note.
    const isFar = (d: number) => d < SUBHARMONIC_HIGH && d > SUBHARMONIC_LOW && farFrom(d, w.legatoFrom) && farFrom(d, w.legatoTo);
    const nFar = jD.filter(isFar).length;
    let slip = false;
    if (!w.short && !octaveUp && GRADE_RANK[grade] < GRADE_RANK.good && nFar > 0 && 2 * nFar < jD.length) {
      const kept = jD.find((d) => !isFar(d))!;
      let last = kept;
      slip = hitOf(jD.map((d) => (isFar(d) ? last : (last = d)))) >= 0.6;
    }
    // Mic trouble: sung through, right wherever a pitch was heard, and the tracker's evidence of input
    // trouble (readings it lifted from ½ / ⅓, strong components at ½ / ⅓) on a good share of the note.
    // A note with pitched readings elsewhere (a wrong note, an octave off: the subharmonic band aside)
    // is never let off, whatever the input.
    let mic = false;
    if (!w.short && !w.outOfRange && !octaveUp && !slip && GRADE_RANK[grade] < GRADE_RANK.good) {
      const body = Math.max(1e-3, w.bodyEnd - w.bodyStart);
      const pitched = jD.filter((d) => !(d < SUBHARMONIC_HIGH && d > SUBHARMONIC_LOW));
      const off = pitched.filter((d) => Math.abs(d) > tolN).length;
      const med = median(pitched);
      // (Readings deep under the note may be the tracker's — but not most of them: that is a voice down there.)
      mic = a.micTime / body >= MIC_SHARE && a.soundTime / body >= MIC_SOUND_SHARE && 2 * (jD.length - pitched.length) < jD.length
        && pitched.length >= 2 && med !== null && Math.abs(med) <= tolN && off <= MIC_OFF_SHARE * pitched.length;
    }
    const unsure: NoteResult['unsure'] = w.outOfRange ? 'range' : w.short ? 'short' : octaveUp ? 'octave' : slip ? 'tracker' : mic ? 'mic' : undefined;
    let clearly: NoteResult['clearly'];
    if (unsure && GRADE_RANK[grade] < GRADE_RANK.good) {
      if (a.inNote > 0 && a.loudInNote === 0) clearly = 'silent';
      // Any clear miss is sung, except readings in the subharmonic band (SUBHARMONIC_LOW…HIGH: the
      // tracker locking onto a third, a quarter … of the pitch) and an octave up on a low note (the
      // tracker's octave error on "oo", see OCTAVE_UP_HZ).
      else if (unsure === 'short' && grade === 'miss' && shortDev !== null && Math.abs(shortDev) >= CLEAR_OFF_TOL * tolN
        && !(shortDev < SUBHARMONIC_HIGH && shortDev > SUBHARMONIC_LOW)
        && !(w.lowForOctave && Math.abs(shortDev - 1200) < CLEAR_OFF_TOL * tolN)) clearly = 'off';
    }
    const scoopMed = median(a.scoopDevs);
    // A scoop is a glide INTO the note: the body must end up clearly closer to the target than the
    // start was (a note sung steadily wrong is not a scoop).
    const tailDev = a.devs.length ? median(a.devs.slice(-Math.max(1, Math.ceil(a.devs.length / 3)))) : null;
    const arrived = scoopMed !== null && tailDev !== null && Math.abs(tailDev) < Math.abs(scoopMed) - 40;
    const scoop = scoopMed === null || !arrived ? null : scoopMed < -60 ? 'below' : scoopMed > 60 ? 'above' : null;

    let points = 0;
    if (grade === 'miss') {
      this._combo = 0;
    } else {
      points = GRADE_POINTS[grade] * comboMultiplier(this._combo);
      this._combo++;
      this._maxCombo = Math.max(this._maxCombo, this._combo);
    }
    this._score += points;
    // Report deviation from the written (just-intonation: pure) target.
    const cents = medDev === null ? null : medDev - (w.targetOffset / 2 - 0);
    a.final = {
      index: w.index, grade, cents, hitRatio, voicedRatio, onsetMs: a.onsetMs, drift, scoop,
      targetOffset: w.targetOffset, points, ...(octave ? { octave: true } : {}),
      ...(unsure ? { unsure } : {}), ...(clearly ? { clearly } : {}),
    };
  }
}

/**
 * The part of a note that is judged for intonation: from when the voice arrives within tolerance
 * (at most TRANSITION_MAX / 35% of the note after its start) to when it leaves for the next note
 * (at most RELEASE_MAX / 20% before its end). Indices into the note's body samples, and times.
 */
export function judgedSpan(a: { w: NoteWindow; bT: number[]; bD: number[]; bW: number[] }, tol: number, octaveTolerant: boolean): { k0: number; k1: number; from: number; to: number } {
  const w = a.w;
  const n = a.bT.length;
  const capStart = Math.max(w.bodyStart, Math.min(w.bodyEnd, w.start + Math.min(TRANSITION_MAX, 0.35 * w.note.dur)));
  // Arrived = three readings in a row within tolerance (~60 ms), not just passing through it.
  const ok = (k: number) => k >= n || Math.abs(a.bD[k]) <= tol;
  let k0 = 0;
  while (k0 < n && a.bT[k0] <= capStart && !(ok(k0) && ok(k0 + 1) && ok(k0 + 2))) k0++;
  // Silence or gliding before the arrival is excused, up to the cap.
  const from = k0 < n ? clamp(a.bT[k0] - a.bW[k0] / 2, w.bodyStart, capStart) : capStart;
  let k1 = n;
  let to = w.bodyEnd;
  if (w.legatoTo !== null) {
    const capEnd = Math.max(from, w.start + w.note.dur - Math.min(RELEASE_MAX, 0.2 * w.note.dur));
    if (capEnd < w.bodyEnd) {
      // Trailing samples heading for the next pitch (closer to it than to this one) are excused.
      const nextDev = 100 * (w.legatoTo - w.target);
      const towardNext = (d: number) => {
        let x = d;
        let y = d - nextDev;
        if (octaveTolerant) { x -= 1200 * Math.round(x / 1200); y -= 1200 * Math.round(y / 1200); }
        return Math.abs(y) < Math.abs(x) && Math.abs(x) > tol;
      };
      while (k1 > k0 && a.bT[k1 - 1] >= capEnd && towardNext(a.bD[k1 - 1])) k1--;
      // Excuse an early release / the next syllable's consonant up to the cap as well.
      const lastT = k1 > k0 ? a.bT[k1 - 1] + a.bW[k1 - 1] / 2 : from;
      to = clamp(lastT, capEnd, w.bodyEnd);
    }
  }
  return { k0, k1, from, to: Math.max(to, from + 1e-3) };
}

/**
 * Very short notes (fast passages). In ~0.1 s the voice rarely settles: it glides in, overshoots, and
 * the next syllable's consonant cuts it off, so only one or two readings fall in the body (after
 * the grace and tail), often mid-transition. What was sung for the note is better told by all of
 * its own readings from the written start to the written end (shortNoteDev: their median):
 * - leading readings still nearer the previous pitch and trailing ones already nearer the next
 *   pitch are the transitions and are left out, up to the same caps as in judgedSpan (so a singer
 *   who stays on the previous pitch through the note is not excused);
 * - readings more than SHORT_FAR from the note and from both neighbours are tracker errors and are
 *   left out — unless they are the majority (then that is what was sung, e.g. an octave off).
 * Readings outside the written note are not used: just after its end they may as well be a singer
 * one note behind. Returns the deviations (cents) in time order, and the seconds of the note they stand for.
 */
export function shortNoteReadings(a: { w: NoteWindow; nT: number[]; nD: number[]; nW?: number[]; nR?: number[] }, tol: number, octaveTolerant: boolean): { devs: number[]; cover: number; reach: boolean } {
  const w = a.w;
  const end = w.start + w.note.dur;
  const fold = (d: number) => (octaveTolerant ? d - 1200 * Math.round(d / 1200) : d);
  const away = (d: number, other: number | null) => fold(d - 100 * ((other ?? w.note.midi) - w.target));
  // Out of tolerance, and nearer the neighbour's pitch than this note's.
  const nearer = (d: number, other: number | null) => {
    if (other === null || other === w.note.midi) return false;
    const x = fold(d);
    return Math.abs(x) > tol && Math.abs(away(d, other)) < Math.abs(x);
  };
  const far = (d: number) => Math.abs(fold(d)) > SHORT_FAR && Math.abs(away(d, w.legatoFrom)) > SHORT_FAR && Math.abs(away(d, w.legatoTo)) > SHORT_FAR;
  let T = a.nT;
  let D = a.nD;
  let W = a.nW ?? a.nT.map(() => 0);
  let R = a.nR ?? a.nT.map(() => 0);
  const nFar = D.filter(far).length;
  if (nFar > 0 && 2 * nFar <= D.length) {
    const keep = D.map((d) => !far(d));
    T = T.filter((_, k) => keep[k]);
    W = W.filter((_, k) => keep[k]);
    R = R.filter((_, k) => keep[k]);
    D = D.filter((_, k) => keep[k]);
  }
  const capStart = w.start + Math.min(TRANSITION_MAX, 0.35 * w.note.dur);
  const capEnd = end - Math.min(RELEASE_MAX, 0.2 * w.note.dur);
  let k0 = 0;
  let k1 = T.length;
  while (k0 < k1 && T[k0] <= capStart && nearer(D[k0], w.legatoFrom)) k0++;
  while (k1 > k0 && T[k1 - 1] >= capEnd && nearer(D[k1 - 1], w.legatoTo)) k1--;
  // Sung, not a blip: two readings in a row without an unvoiced one between, reaching past SHORT_MIN_REACH.
  // Sung, not blips: a run of readings without an unvoiced one between that stands for at least
  // SHORT_MIN_COVER of the note and reaches past SHORT_MIN_REACH of it.
  let reach = false;
  for (let k = k0, runCover = 0; k < k1; k++) {
    runCover = (k > k0 && R[k] === R[k - 1] ? runCover : 0) + W[k];
    if (runCover >= SHORT_MIN_COVER * w.note.dur && T[k] >= w.start + SHORT_MIN_REACH * w.note.dur) reach = true;
  }
  return { devs: D.slice(k0, k1), cover: W.slice(k0, k1).reduce((x, y) => x + y, 0), reach };
}

/** Enough of a very short note's own readings to judge it on them (SHORT_MIN_READINGS, SHORT_MIN_COVER, SHORT_MIN_REACH). */
function enoughShortReadings(r: { devs: number[]; cover: number; reach: boolean }, w: NoteWindow): boolean {
  return r.devs.length >= SHORT_MIN_READINGS && r.cover >= SHORT_MIN_COVER * w.note.dur && r.reach;
}

/** Very short notes: the median deviation (cents) of the note's own readings (shortNoteReadings), or null when there are too few. */
export function shortNoteDev(a: { w: NoteWindow; nT: number[]; nD: number[]; nW?: number[]; nR?: number[] }, tol: number, octaveTolerant: boolean): number | null {
  const r = shortNoteReadings(a, tol, octaveTolerant);
  return enoughShortReadings(r, a.w) ? median(r.devs) : null;
}

/**
 * The voice swung evenly around the note: two consecutive readings on either side of it, each within
 * twice the tolerance, and neither more than SWING_RATIO times as far from the note as the other.
 * In a fast run the voice glides in, overshoots and rings, and with only two to four readings per
 * note the tracker often misses the moments it is on the note; the median then lands on whichever
 * side happened to be read more often. A voice centred off the note (flat, or on a neighbouring
 * note) swings around that pitch instead, so its readings rarely straddle the note evenly.
 */
export function swingsAround(devs: number[], tol: number): boolean {
  for (let k = 1; k < devs.length; k++) {
    const x = Math.abs(devs[k - 1]);
    const y = Math.abs(devs[k]);
    if (devs[k - 1] * devs[k] < 0 && Math.max(x, y) <= 2 * tol && Math.max(x, y) <= SWING_RATIO * Math.min(x, y)) return true;
  }
  return false;
}

/** Centred moving average whose window is shifted (not truncated) to stay inside the samples. */
function boxSmooth(T: number[], D: number[], win: number): number[] {
  const n = T.length;
  const out = new Array<number>(n);
  const first = T[0];
  const last = T[n - 1];
  const fits = last - first >= win;
  let i0 = 0;
  let i1 = 0;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    let lo = T[k] - win / 2;
    let hi = T[k] + win / 2;
    if (fits) {
      if (lo < first) { hi += first - lo; lo = first; }
      if (hi > last) { lo -= hi - last; hi = last; }
    }
    while (i1 < n && T[i1] <= hi + 1e-9) sum += D[i1++];
    while (i0 < i1 && T[i0] < lo - 1e-9) sum -= D[i0++];
    out[k] = i1 > i0 ? sum / (i1 - i0) : D[k];
  }
  return out;
}

/**
 * Vibrato-cancelling smoothing of a note's deviations. Two cascaded moving averages
 * (≈ one cycle at 5.5 Hz and at 4.5 Hz) cancel vibratos from about 4 to 8 Hz to within a few
 * percent of their width; a single window is used for medium notes. Returns null when the note
 * is too short for either (the caller then uses the median).
 */
export function vibratoSmoothed(T: number[], D: number[], win: number): number[] | null {
  if (!T.length) return null;
  if (win <= 0) return D.slice();
  const span = T[T.length - 1] - T[0];
  if (span >= 2.4 * win) return boxSmooth(T, boxSmooth(T, D, win), win * 1.22);
  if (span >= 1.5 * win) return boxSmooth(T, D, win);
  return null;
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
