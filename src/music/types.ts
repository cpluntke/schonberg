// Core data model shared by parser, audio, scoring and UI.
// All times are in seconds at tempo factor 1.0 ("score time"); beats are quarter notes.

export type VoiceType = 'S' | 'A' | 'T' | 'B' | 'other';

export interface ScoreNote {
  /** Sounding MIDI pitch (60 = middle C). Tied notes are merged into one ScoreNote. */
  midi: number;
  /** Start in score seconds. */
  start: number;
  /** Duration in score seconds. */
  dur: number;
  /** Start in quarter-note beats from the beginning of the score. */
  startBeat: number;
  durBeats: number;
  /** 0-based index into Score.measures. */
  measure: number;
  /** Lyric syllable (first verse), without hyphen. */
  lyric?: string;
  syllabic?: 'single' | 'begin' | 'middle' | 'end';
}

export interface Part {
  id: string;
  /** Display name, e.g. "Soprano", "Tenor 1". */
  name: string;
  voiceType: VoiceType;
  notes: ScoreNote[];
  /** Lowest / highest MIDI pitch in the part (0 if empty). */
  low: number;
  high: number;
}

export interface KeySig {
  beat: number;
  time: number;
  /** -7..7, number of sharps (positive) or flats (negative). */
  fifths: number;
  mode: 'major' | 'minor';
}

export interface TempoEvent {
  beat: number;
  time: number;
  /** Quarter notes per minute. */
  bpm: number;
}

export interface Measure {
  /** 0-based sequential index. */
  index: number;
  /** Printed measure number/label from the source ("1", "12a"...). */
  number: string;
  startBeat: number;
  durBeats: number;
  start: number;
  dur: number;
  timeSig: [number, number];
  rehearsalMark?: string;
  /** True when the measure ends with a double/final barline (useful for sectioning). */
  doubleBar?: boolean;
}

export interface Score {
  id: string;
  title: string;
  composer: string;
  source: 'musicxml' | 'midi' | 'builtin';
  parts: Part[];
  measures: Measure[];
  keys: KeySig[];
  tempos: TempoEvent[];
  /** Total length in score seconds. */
  duration: number;
}

/** A practice unit: a phrase / group of measures with its own mastery level. */
export interface Section {
  id: string;
  index: number;
  label: string;
  /** Inclusive 0-based measure indices. */
  startMeasure: number;
  endMeasure: number;
  start: number;
  end: number;
}
