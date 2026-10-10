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
// Built-in pieces: public/pieces/manifest.json → [{ id, file, title, composer, level, description }] (the Abendlied only)
// Choir library (admins only, not in the public build): library/index.json → same fields + credit; the server
// (messiermarathon utils/schonberg_library.py) copies a piece into a choir's scores, keeping its id as libraryId,
// which phones use as the piece id (progress/choir.ts localPieceId).
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
export function keyHint(mode: NotationMode, key: KeySig): string | null; // "Do = E", "1 = E", "C♯ minor"
export function intervalName(semitones: number): string;    // "m3", "P4", "TT", "M9"…
// music/keymarks.ts + progress/keymarks.ts: key marks ("from bar 41, G major") where a score changes key
// without a new key signature. Note names (movable do, jianpu) and the "Do = …" hints follow
// nameKeysOf(score): the key signatures with the marks laid over them; the staff keeps the printed
// signature. A choir piece's marks come with the choir's details (admins set them: PATCH
// /choirs/<code>/pieces/<id> {keys}); a singer's own import keeps them on the phone.
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
// progress/sync.ts  (progress kept with a choir account on the server, ≤ ~8 KB: levels, bests, dates,
// to-fix lists, off-book days, a 6-bit-per-bar summary, settings, programme; never the attempt log or
// recordings. Any account syncs: members sign up with the choir code (choir.ts signUp), leads/admins via
// invites. Start/focus: a revision check picks up other phones' saves; after runs within 10 s, on page
// hide with keepalive. Merging never lowers anything; a phone with progress under another name asks first.)
export function buildSnapshot(): { data: ProgressSnapshot; hash: string; bytes: number };
export function applySnapshot(d: unknown): ApplyResult;
export function uploadProgress(force?: boolean, auto?: boolean): Promise<…>; export function syncProgressSoon(): void;
```

## ui/ navigation (`src/ui/nav.ts`, `App.tsx`)

Tabs **Today · Pieces · Train · Choir** (`#/`, `#/pieces`, `#/train`, `#/choir`), plus the staff tab
("Admin" / "Section") for a staff login on this phone. Settings is behind the round avatar at the top
right of every tab: it opens the **You** sheet (`components/YouSheet.tsx`), whose rows open Settings on
their part (`openAt(settings, id)`: `settings-voice`, `settings-practice`, `settings-choir`,
`settings-display-block`, `settings-privacy`, `settings-help`, `settings-data`) or Your progress.
Staff rows (Choir admin, Sections, Super admin) only for staff logins; the super-admin login itself is
at the bottom of Diagnostics (and `#/superadmin`).

- **Tab bar**: on phones only under the four tabs and the staff screens; every other screen is a
  sub-screen with its own back arrow. Wide screens keep the sidebar on sub-screens too. Practice
  screens (Play, Results, the words, the lyrics quiz, the memory map), voice setup and a course's
  steps and quick check have neither.
- **The lit tab** (`tabOf`): Ranks → Choir; Expert, the tuner, the drone, the courses → Train.
  A piece, Settings, Diagnostics and Your progress light the tab they were opened from (remembered per browser tab in
  `sessionStorage['sh:fromTab']`); opened straight from a link: Pieces (a piece) or Today.
- **Old addresses**: `#/library` is the Pieces tab; `#/ranks` and `#/settings` are still screens of
  their own (reached from the Choir tab's "See all" and the You sheet).
- **Pieces** (`screens/Pieces.tsx`, `pieces.ts`): the programme's pieces (the singer's own imports
  apart), what's still to come (`Cycle.wanted`), your own imports, the rest on this phone, importing;
  "Choose the programme's pieces" toggles pieces in and out and deletes imports.
- **Train** (`screens/Train.tsx`): today's warm-up (the active course's next step), the tools (Check
  a note = the tuner, the Drone `#/drone`), the intonation courses (the active one, one suggestion, All
  courses `#/courses`; `game/courses.ts`, the course screens in `screens/IntonationLab.tsx`:
  `#/intonation/<interval>[/<rung>|/done|/check]`), drills from your music (the leap drill, whose Results
  are `screens/LeapResults.tsx`) and the Zwölfton row. docs/INTONATION.md.
- **Choir** (`screens/Choir.tsx` ChoirScreen, `components/ChoirOverview.tsx`, `choirTab.ts`): the
  next rehearsal with its focus and one action (the first focus piece not yet rehearsal-ready, its next
  step), the programme, this week in your section (singers of your voice on the choir's board with
  points this week), live "practising now", this week's points (top three and you; all of Ranks behind
  "See all"), what's shared; then the membership (sync, leave, sharing) and the staff login. Without a
  choir: joining.

## ui/ display: themes, text size, the singing view (`src/ui/theme.ts`, `play/palette.ts`)

**Settings → Display** (`settings-display-block`) sets *Appearance* (Dark / Light / Match the phone)
and *Text size* (Standard / Large / Larger), stored in the profile (`appearance`, `textSize`; unset =
dark, standard) and kept with a choir account (`sync.ts` `PROFILE_KEYS`, type-checked; like the other
settings a new phone takes them, a set-up phone keeps its own).

- **Default dark.** The app has always been dark (and the intro video shows it dark); nobody's look
  changes on update. Light and "Match the phone" are one tap away.
- **Colours** are CSS tokens on `:root` in `styles.css`, with a light value for every token under
  `:root[data-theme='light']`. No screen or component writes a hex colour of its own (charts use
  `--lv0…--lv5`, tints use `mix()` = `color-mix`). `theme.test.ts` checks every text colour against
  every ground it sits on (≥ 4.5:1) in both themes, and that each token has a light value.
- **Text size**: every font size in the CSS (and in inline styles) is in `rem`; `<html data-text="large|larger">`
  sets the root to 115 % / 130 %. Running text and labels are at least 14 px at Standard (eyebrows,
  badges and tab labels 13 px); touch targets at least 44 px. A few labels that must fit a fifth or a
  quarter of a phone's width (the level meter's names, the mixer) are capped with `min(…rem, …vw)`.
- **Applying**: `applyDisplay()` sets `data-theme` / `data-text` on `<html>`, the `theme-color` meta
  (status bar) and iOS's status-bar style, and the canvas palette. `main.tsx` calls it before the first
  render (no flash); `App`'s `DisplaySync` keeps it in step with the profile and, for "Match the phone",
  with `prefers-color-scheme`. The manifest's `theme_color`/`background_color` (splash screen) stay dark.
- **Canvases** (highway, score view, full score, mistake score, the words lane) read their colours
  from `play/palette.ts` (`COLORS`, `INK`, `STAFF_GRADE`, `TRACE_COLORS`): objects changed in place by
  `setCanvasTheme`, so the render loop allocates nothing and keeps no copies. Font sizes go through
  `fpx(px)` (× the text scale). `canvasGeneration()` is part of the layout and static-layer cache keys
  (via `staff2d.fontGeneration()`); canvases drawn once (the mistake score) re-draw on
  `useCanvasGeneration()`. The arcade (3D) keeps its own night scene in both themes. SVG charts use
  CSS variables.

**The singing view** (`screens/Play.tsx`, `play/staff2d.ts`, `play/readout.ts`):

- On an upright phone (`uprightView`) the score view uses a 15 px staff space (a 60 px staff on a
  390 px phone; at least 12 px, else one larger system), so note names are 15 px+ and words 16 px+.
  Turning pages shows two systems; the scrolling line goes on in a second row underneath (what comes
  after the right edge, both rows gliding together), so the next bars stay in view.
- **Live readout** above the music (score view on a phone, not in landscape): the note being sung
  (its name where the level shows names), the word scale (`pitchReadout`: "C♯ · a touch flat ↓"; the
  arrow shows where the voice is, ↓ flat, ↑ sharp, as in Results and the bubble) in teal when within
  the level's tolerance, light orange outside.
  Computed in the HUD tick (~11×/s, `liveReading`, the same reading as the bubble); the canvas then
  draws only the voice dot. Landscape phones and the laptop's full score keep the small bubble.
- **Progress strip** for a run over more than one passage (`runProgress`): a segment per passage,
  filled bar by bar, "n/29 bars".
- While singing the controls are Restart (an icon on a phone), **Stop** (finish and see results) and
  **Pause**, equal and plain; orange is kept for the one thing to tap when not singing.
