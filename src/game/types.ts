// Contracts between pitch tracking, scoring, analysis, progress and UI.

/** One pitch-tracker reading, already converted to score time. */
export interface PitchSample {
  /** Score seconds (tempo factor 1), latency-compensated. */
  time: number;
  /** Fractional MIDI pitch, or null when unvoiced / too quiet / unclear. */
  midi: number | null;
  /** 0..1 detector confidence. */
  clarity: number;
  /** Input RMS level 0..1. */
  rms: number;
}

export type Grade = 'perfect' | 'good' | 'ok' | 'miss';

export type TuningMode = 'equal' | 'just';

export interface ScoringOptions {
  /** Cents half-width that still counts as "in tune" (e.g. 25). perfect = within tol/2. */
  toleranceCents: number;
  tuning: TuningMode;
  /** If true, singing the right note in the wrong octave counts (with a penalty). */
  octaveTolerant: boolean;
  /** Seconds at the beginning of each note ignored for pitch (attack / consonants). Default 0.08. */
  onsetGrace?: number;
  /**
   * Seconds of moving average applied to the pitch before the in-tune test, so a vibrato centred
   * on the note counts as in tune. Default 0.18 (one cycle at ~5.5 Hz); 0 disables.
   */
  vibratoWindow?: number;
  /**
   * Tempo factor of the run (level 1: 0.7). Vibrato happens in real time, so the smoothing window
   * in score seconds is vibratoWindow × rate: one vibrato cycle whatever the tempo. Default 1.
   */
  rate?: number;
}

export interface NoteResult {
  /** Index into Part.notes. */
  index: number;
  grade: Grade;
  /** Median deviation in cents from the (tuning-adjusted) target over the note body; null if not sung. */
  cents: number | null;
  /** Fraction of the note body with a voiced sample within tolerance. 0..1 */
  hitRatio: number;
  /** Fraction of the note body with any voiced sample. 0..1 */
  voicedRatio: number;
  /** Milliseconds from the note start until the first in-tolerance sample (null if never). */
  onsetMs: number | null;
  /** Cents change from first third to last third of the note (negative = sagging). */
  drift: number | null;
  /** Approach from below/above by more than ~60 cents in the first 150ms. */
  scoop: 'below' | 'above' | null;
  /** Target adjustment in cents applied by just-intonation mode (0 in equal temperament). */
  targetOffset: number;
  points: number;
  /** True when most of the note was sung in tune but in the wrong octave. */
  octave?: boolean;
  /**
   * The scorer can't judge this note reliably (absent = it can): 'short' = a very short note (body
   * under 0.15 s of score time: the voice rarely settles and the tracker gets few readings, so it is
   * graded leniently), 'range' = the written pitch is outside the pitch tracker's range (60–1400 Hz),
   * 'octave' = a low note (under 200 Hz) read partly or wholly an octave up that is right once those
   * readings are folded down (the tracker's octave error on "oo"; never folded downward),
   * 'tracker' = a note right once a minority of subharmonic readings (18–46 semitones under it and
   * more than 6 semitones from both neighbours: the tracker locking onto a fraction of the pitch)
   * are replaced by the reading before them.
   * Level 1 forgives such a note below "good" unless `clearly` says it was wrong (docs/LEVELS.md).
   */
  unsure?: 'short' | 'range' | 'octave' | 'tracker';
  /**
   * An unsure note graded below "good" that was still clearly wrong: 'silent' = no sound at all
   * inside the written note (no voiced reading, every reading below the silence level; either kind
   * of unsure note); 'off' = a very short note graded miss, with enough of its own readings to judge
   * it (shortNoteDev) and their median at least CLEAR_OFF_TOL tolerances off (but within 6
   * semitones: further off is the tracker locking onto a fraction of the pitch).
   */
  clearly?: 'off' | 'silent';
}

export type InsightKind =
  | 'flat-long-notes'
  | 'sharp-long-notes'
  | 'flat-overall'
  | 'sharp-overall'
  | 'late-entries'
  | 'behind-beat'
  | 'early-entries'
  | 'scooping'
  | 'leaps'
  | 'missed-notes'
  | 'wrong-notes'
  | 'quiet'
  | 'octave'
  | 'tempo-drift'
  | 'great';

export interface Insight {
  kind: InsightKind;
  title: string;
  detail: string;
  /** Inclusive 0-based measure range this insight is about (for "loop these bars"). */
  measures?: [number, number];
  severity: 1 | 2 | 3;
}

export interface AttemptResult {
  /** 0..1 share of notes graded perfect/good/ok weighted (the main pass metric). */
  accuracy: number;
  /** 0..1 pitch accuracy (hitRatio averaged over notes). */
  pitch: number;
  /** 0..1 rhythm/timing (based on onset). */
  rhythm: number;
  score: number;
  maxCombo: number;
  counts: Record<Grade, number>;
  notes: NoteResult[];
  /** measure index -> 0..1 accuracy for measures containing target notes. */
  perMeasure: Record<number, number>;
  insights: Insight[];
}
