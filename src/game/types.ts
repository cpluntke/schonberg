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
}

export type InsightKind =
  | 'flat-long-notes'
  | 'sharp-long-notes'
  | 'flat-overall'
  | 'sharp-overall'
  | 'late-entries'
  | 'early-entries'
  | 'scooping'
  | 'leaps'
  | 'missed-notes'
  | 'wrong-notes'
  | 'quiet'
  | 'octave'
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
