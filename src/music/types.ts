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
  /** How the source wrote the note (MusicXML); without it the note is spelled from the key. */
  spelling?: NoteSpelling;
}

/**
 * Spelling of a note at sounding pitch: its letter and alteration (a B♯ stays a B♯, not a C).
 * `midi - alter` is the letter's natural pitch, which gives the octave.
 */
export interface NoteSpelling {
  /** 0..6 = C D E F G A B. */
  letter: number;
  /** Semitones, -2..2 (1 = sharp, -1 = flat). */
  alter: number;
  /** The accidental the source printed on the note, as an alteration (0 = natural), if any. */
  acc?: number;
  /** That accidental is a cautionary / editorial one (in parentheses or brackets in the source). */
  courtesy?: boolean;
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
  /** Performance directions for this part (dynamics, tempo words, "cresc.", "doux"…). */
  directions?: Direction[];
}

export interface Direction {
  time: number;
  text: string;
  kind: 'dynamic' | 'words';
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
  /** Edition / licence credit (scores from the choir library carry one). */
  credit?: string;
  /** Code of the choir this score came from (choir scores only). */
  choir?: string;
  parts: Part[];
  measures: Measure[];
  keys: KeySig[];
  tempos: TempoEvent[];
  /** Total length in score seconds. */
  duration: number;
  /**
   * Version of the importer that made this score (see PARSE_VERSION in import.ts). Scores stored
   * by an older version lack newer details (e.g. note spellings); choir scores are downloaded again.
   */
  parseVersion?: number;
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
