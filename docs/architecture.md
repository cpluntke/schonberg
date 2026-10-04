# Architecture & module contracts

Vite + React 18 + TypeScript PWA. No backend required (leaderboard optional, see below).
Everything runs on the device: MusicXML/MIDI parsing, pitch detection (McLeod via `pitchy`),
synthesis (WebAudio), scoring, progress (localStorage + IndexedDB).

Shared types: `src/music/types.ts` (Score, Part, ScoreNote, Section…) and
`src/game/types.ts` (PitchSample, NoteResult, AttemptResult, Insight…).
**Do not change these types without coordinating** — add optional fields only.

## music/ (import)

```ts
// music/musicxml.ts
export function parseMusicXML(xml: string, opts?: { id?: string }): Score;
// music/midi.ts
export function parseMidi(data: ArrayBuffer | Uint8Array, opts?: { id?: string; title?: string }): Score;
// music/import.ts — dispatch by extension (.musicxml/.xml/.mxl/.mid/.midi); .mxl = zip (fflate)
export async function importScoreFile(name: string, data: ArrayBuffer): Promise<Score>;
// music/sections.ts
export function computeSections(score: Score, opts?: { targetBars?: number }): Section[];
// music/time.ts
export function measureAtTime(score: Score, time: number): number;      // measure index
export function keyAtTime(score: Score, time: number): KeySig;
export function tempoAtTime(score: Score, time: number): number;         // bpm
export function soundingAt(score: Score, time: number, excludePartId?: string): number[]; // midis
export function beatTimes(score: Score, from: number, to: number): { time: number; downbeat: boolean }[];
// Built-in pieces: public/pieces/manifest.json → [{ id, file, title, composer, level, description }]
```

Parser rules: sounding pitch (apply `<transpose>`), merge ties, split a part that has
multiple `<voice>`s or chords into separate singable parts (e.g. "Soprano 1/2"),
first-verse lyrics with syllabic info, tempo from `<sound tempo>` / metronome (default 90),
key + mode, time signatures, rehearsal marks, double bars, voiceType guessed from
part name and range.

## audio/

```ts
// audio/context.ts
export function getAudioContext(): AudioContext;            // singleton
export async function unlockAudio(): Promise<void>;          // call from a user gesture
// audio/pitch.ts
export interface RawPitch { ctxTime: number; hz: number | null; midi: number | null; clarity: number; rms: number }
export class PitchTracker {
  static create(ctx: AudioContext, opts?: { deviceId?: string }): Promise<PitchTracker>; // raw mic (no AEC/NS/AGC)
  onPitch(cb: (p: RawPitch) => void): () => void;            // ~every 20 ms
  latest(): RawPitch | null;
  stop(): void;
}
export function hzToMidi(hz: number): number;
export function midiToHz(midi: number): number;
// audio/player.ts
export interface PlayOptions {
  from: number; to?: number; rate: number;                   // score seconds; rate 0.5..1.25
  partGains: Record<string, number>;                         // 0..1 per part id
  countInBeats?: number; click?: boolean;
  cuePartId?: string; cue?: 'note' | 'chord' | 'none';       // starting-pitch cue during count-in
}
export class ScorePlayer {
  constructor(ctx: AudioContext, score: Score);
  play(opts: PlayOptions): void;
  stop(): void;
  readonly playing: boolean;
  get position(): number;                                     // score seconds now (negative in count-in)
  scoreTimeAt(ctxTime: number): number;                       // map an AudioContext time to score time
  setPartGain(partId: string, gain: number): void;
  onEnded(cb: () => void): () => void;
}
export function playTone(ctx: AudioContext, midi: number, dur: number, when?: number): void;
export function playChord(ctx: AudioContext, midis: number[], dur: number, when?: number): void;
// audio/latency.ts
export async function measureLatency(ctx: AudioContext, tracker: PitchTracker,
  onBeat?: (i: number, n: number) => void): Promise<{ latencyMs: number; ok: boolean }>;
```

## game/

```ts
// game/notation.ts
export type NotationMode = 'letter' | 'fixed' | 'movable' | 'jianpu' | 'pc';
export interface NoteLabel { text: string; dotsAbove: number; dotsBelow: number }
export function noteLabel(midi: number, mode: NotationMode, key: KeySig): NoteLabel;
export function intervalName(semitones: number): string;    // "m3", "P4", "TT", "M9"…
// game/scoring.ts
export interface ScoringContext { score: Score; part: Part; range: [number, number] } // note index range, inclusive
export function scoreAttempt(ctx: ScoringContext, samples: PitchSample[], opts: ScoringOptions): AttemptResult;
export class LiveScorer {
  constructor(ctx: ScoringContext, opts: ScoringOptions);
  push(s: PitchSample): void;
  noteFill(i: number): number;                              // 0..1 for drawing
  noteGrade(i: number): Grade | undefined;                  // once the note is over
  readonly combo: number; readonly score: number;
  finish(samplesSoFar?: PitchSample[]): AttemptResult;
}
export function justOffsetCents(targetMidi: number, sounding: number[]): number;
// game/analysis.ts
export function analyze(ctx: ScoringContext, notes: NoteResult[]): Insight[];
// game/drills.ts
export function hardestIntervals(part: Part, n: number): { index: number; semitones: number; measure: number }[];
export function entryNotes(part: Part, minRestSec?: number): number[];  // note indices after rests
// game/twelvetone.ts
export function rowOfTheDay(date: Date): number[];          // 12 pitch classes
export function rowForms(row: number[]): Record<string, number[]>;   // P0 R0 I0 RI0 …
export function rowToScore(row: number[], opts: { low: number; high: number; bpm?: number; seed?: number }): Score;
```

## progress/

```ts
// progress/ladder.ts
export interface LevelSpec { level: 1|2|3|4; name: string; rate: number; guide: boolean; showNames: boolean;
  cue: 'note' | 'chord'; tolerance: number; pass: number; description: string }
export const LEVELS: LevelSpec[];
export function pieceReadiness(sections: Section[], prog: PieceProgress | undefined): { pct: number; minLevel: number; rehearsalReady: boolean; concertReady: boolean };
export function nextStep(sections: Section[], prog: PieceProgress | undefined): { sectionId: string; level: number; reason: string } | null;
// progress/store.ts  (localStorage for small JSON, IndexedDB for imported scores)
export interface Profile { name: string; voice: VoiceType; notation: NotationMode; strictness: 'forgiving'|'standard'|'strict';
  tuning: TuningMode; latencyMs: number; rangeLow?: number; rangeHigh?: number; onboarded: boolean; leaderboardOptIn: boolean; choirCode?: string }
export interface SectionProgress { level: number; best: Record<number, number>; attempts: number; lastPracticed?: number; lastPassed?: number }
export interface PieceProgress { pieceId: string; partId: string; sections: Record<string, SectionProgress>; totalAttempts: number; bestScore: number }
export interface AttemptLog { at: number; pieceId: string; partId: string; sectionId: string; level: number; accuracy: number; score: number; passed: boolean }
export interface Cycle { name: string; concertDate?: string; rehearsalDate?: string; pieceIds: string[] }
export function loadProfile(): Profile; export function saveProfile(p: Profile): void;
export function getProgress(pieceId: string, partId: string): PieceProgress | undefined;
export function recordAttempt(pieceId: string, partId: string, sectionId: string, level: number, r: AttemptResult): { passed: boolean; newLevel: number; prevLevel: number };
export function attemptLog(): AttemptLog[]; export function streakDays(now?: Date): number;
export function dueForReview(...): …;
export function loadCycle(): Cycle; export function saveCycle(c: Cycle): void;
export async function saveImportedScore(s: Score): Promise<void>;
export async function loadImportedScores(): Promise<Score[]>;
export async function deleteImportedScore(id: string): Promise<void>;
export function exportBackup(): string; export function importBackup(json: string): void;
```
