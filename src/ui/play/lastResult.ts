import type { AttemptResult } from '../../game/types';
import type { WordsResult, WordsStage } from '../../game/textrhythm';
import type { FullRunRecord, PieceReach } from '../../progress/store';
import type { InputQuality } from '../../audio/inputQuality';
import type { EntriesCheck } from '../../progress/ladder';

export interface LastResult {
  pieceId: string;
  partId: string;
  sectionId: string;
  level: number;
  /** The level's step (absent in results saved before the steps: Level 1 was slow, the rest in tempo). */
  step?: 'slow' | 'tempo';
  /** A section run: slow steps passed above its in-tempo level before and after (store.RecordResult). */
  prevSlow?: number;
  newSlow?: number;
  /** A slow pass that raised the passage's slow step: now try that level in tempo. */
  stepUp?: boolean;
  /** Level 1 in tempo: whether the entries were sung and on time (ladder.entriesOnTime). */
  entries?: EntriesCheck;
  /** The part of the delay taken off every entry's onset when judging the entries (ms). */
  entriesOffsetMs?: number;
  /** The piece's level before and after this run (a milestone when it crossed 3, 4 or 5). */
  pieceBefore?: number;
  pieceAfter?: number;
  /** A loop: the passage step it came from (Route.back), to sing whole again after it. */
  back?: { sectionId: string; level: number; step: 'slow' | 'tempo' };
  mode: '2d' | '3d';
  from: number;
  to: number;
  result: AttemptResult;
  passed: boolean;
  prevLevel: number;
  newLevel: number;
  /** True when the attempt counted toward the section ladder. */
  ladder: boolean;
  /** Judged note by note (Level 1 slow: every note right); absent in results saved by older versions. */
  everyNote?: boolean;
  /** Tolerance (cents) the run was scored with (the level's, after the strictness factor). */
  tolerance?: number;
  /** Best score at this section+level before this attempt (null if first). */
  prevBest?: number | null;
  /** Why a run of a real section didn't count toward its level. */
  notCounted?: string;
  /** Notes sung right in this run, and the cycle's total after it. */
  points?: { gained: number; total: number };
  /** The practice streak after this run, and whether this run started today's day of it. */
  streak?: { days: number; extended: boolean };
  /** Sung slower than the step's tempo ("practise slowly"): the tempo, as a factor. Practice only. */
  slow?: number;
  /** Level 1 slow sung without headphones (the singer's answer): practice, see ladder.speakerPractice. */
  speaker?: boolean;
  /** Headphone/mic delay learned from this run (ms), if any. */
  latencyAdjusted?: number;
  /** The voice was lined up with the music by this many ms before scoring (device delay). */
  alignedMs?: number;
  /** Without a measured delay the entries came this late (ms): the run didn't count, the delay check is needed. */
  timingUnsure?: number;
  /** A words-in-rhythm run (text only, no pitch). */
  words?: { stage: WordsStage; result: WordsResult; counted: boolean; newStage: boolean; calibrated: boolean };
  /** Level 5: different days passed off book so far. */
  offBookDays?: number;
  /** Delay the app applied during the run (ms). */
  latencyUsedMs?: number;
  /** The measured delay looks off: suggest redoing the delay check. */
  suggestDelayCheck?: boolean;
  /** The notes were right but entries came this many ms late (median), which failed the run. */
  timingFail?: number;
  /** A run-through of the whole piece (docs/LEVELS.md): each section's score and what's left to fix. */
  full?: FullRunRecord;
  /** A section pass that cleared it from a full run's to-fix list (level, sections left to fix there). */
  fixed?: { level: number; remaining: number }[];
  /** How good the microphone input was (Results gives advice when it found a problem). */
  inputQuality?: InputQuality | null;
  /** That section pass was the last fix at a level: the whole piece reached it. */
  reached?: PieceReach;
}

let last: LastResult | null = null;

export function setLastResult(r: LastResult) {
  last = r;
  try { sessionStorage.setItem('sh:lastResult', JSON.stringify(r)); } catch { /* quota */ }
  // Which piece the last run was (kept when the app is closed: Results can then lead back to it).
  try { localStorage.setItem(LAST_PIECE_KEY, JSON.stringify({ pieceId: r.pieceId, at: Date.now() })); } catch { /* storage blocked */ }
}

const LAST_PIECE_KEY = 'sh:lastRunPiece';

/** The piece of the last run on this device, also after the app was closed (no result details). */
export function lastRunPiece(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_PIECE_KEY) ?? 'null') as { pieceId?: unknown } | null;
    return typeof v?.pieceId === 'string' ? v.pieceId : null;
  } catch { return null; }
}

export function getLastResult(): LastResult | null {
  if (last) return last;
  try {
    const s = sessionStorage.getItem('sh:lastResult');
    if (s) last = JSON.parse(s);
  } catch { /* ignore */ }
  return last;
}
