// Local persistence: small JSON in localStorage (keys prefixed `sh:`),
// imported scores in IndexedDB (idb-keyval) with an in-memory fallback.
// Loading never throws: corrupted keys are reset to defaults.
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval';
import type { Score, Section, VoiceType } from '../music/types';
import type { AttemptResult, TuningMode } from '../game/types';
import { MAX_LEVEL, OFF_BOOK_DAYS, attemptPasses, isDue, levelSpec, runOpensLevel, sectionChecks, sectionHeld, type Strictness } from './ladder';

/** Structurally identical to game/notation.ts NotationMode. */
export type NotationMode = 'letter' | 'fixed' | 'movable' | 'jianpu' | 'pc';

export const SCHEMA_VERSION = 1;
export const PREFIX = 'sh:';
const K = {
  schema: 'sh:schema',
  profile: 'sh:profile',
  cycle: 'sh:cycle',
  log: 'sh:log',
  // Readiness history. v2: readiness counts piece levels from full runs (docs/LEVELS.md), so the
  // history restarts (values under the old 'sh:readiness' key would show as a false drop).
  readiness: 'sh:readiness2',
  progress: (pieceId: string, partId: string) => `sh:progress:${pieceId}:${partId}`,
};
export const LOG_CAP = 2000;
const DAY_MS = 86_400_000;
/** Duration assumed for logged attempts without durationSec. */
const DEFAULT_ATTEMPT_SEC = 45;

export interface Profile {
  name: string;
  voice: VoiceType;
  notation: NotationMode;
  strictness: Strictness;
  tuning: TuningMode;
  /** Output→input round trip in ms; 0 = unknown / not measured. */
  latencyMs: number;
  /** Where latencyMs came from: the delay check / typed in ('measured') or learned from singing. */
  latencySource?: 'measured' | 'learned';
  /** Delay suggested by the last run (ms), waiting for a second run to agree before it's learned. */
  latencyHint?: number;
  /**
   * The answer to "Headphones on?" before a level-1 run (undefined = never asked). Level 1 counts
   * only with headphones (ladder.speakerPractice). It belongs to this phone, like the delay: not
   * part of the saved copy (sync.ts PROFILE_KEYS).
   */
  headphones?: boolean;
  /** Practice beat: never, only where you sing alone (default), or always. */
  beat?: 'off' | 'alone' | 'always';
  /** Keep the last run's recording in memory so it can be shared (default on). */
  keepRecording?: boolean;
  rangeLow?: number;
  rangeHigh?: number;
  /** The range check's wider reach (sung, but less steady or quiet) and when it was measured (ms). */
  rangeReachLow?: number;
  rangeReachHigh?: number;
  rangeAt?: number;
  onboarded: boolean;
  leaderboardOptIn: boolean;
  choirCode?: string;
  /** Share per-bar progress with the section lead (opt-in). */
  shareProgress?: boolean;
  /**
   * Practice screen (2D): the note highway or sheet music. Unset = Automatic: sheet music at every
   * level.
   */
  display?: 'highway' | 'score';
  /** The singer picked the display themselves (before a run or in Settings): no migration changes it. */
  displayChosen?: boolean;
  /** The first display migration ran (it gave singers who practised before the score view the highway). */
  displayMigrated?: boolean;
  /** Obsolete: the "New: sheet music view" card (cleared by the score-by-default migration). */
  scoreViewNews?: boolean;
  /** The score-by-default migration ran. */
  scoreDefaultMigrated?: boolean;
  /** Show the one-time note "Sheet music is now the default" on the practice screen. */
  scoreDefaultNote?: boolean;
  /**
   * Score view on a wide screen (laptop, tablet in landscape): your part only, all voices, or all
   * voices + accompaniment. Unset = all voices + accompaniment when that stays readable.
   */
  scoreStaves?: 'mine' | 'voices' | 'all';
  /**
   * Logged in to the choir: keep my progress with my account on the server (src/progress/sync.ts).
   * Unset = on; false = the singer turned it off.
   */
  sync?: boolean;
}

/** The practice display (the singer's choice, else sheet music at every level). */
export function practiceDisplay(p: Pick<Profile, 'display'>, _level?: number): 'highway' | 'score' {
  return p.display ?? 'score';
}

/**
 * Sheet music became the default at every level. Singers whose highway was set for them (by the
 * first migration, its card never answered) go back to Automatic; anyone who used to get the
 * highway automatically gets a one-time note. A highway the singer chose stays.
 */
function migrateScoreDefault(p: Partial<Profile>, log: () => AttemptLog[]): void {
  const v1 = !!p.displayMigrated;
  p.displayMigrated = true;
  p.scoreDefaultMigrated = true;
  if (p.display === 'highway' && !p.displayChosen) {
    // The first migration set the highway together with its card; picking a display (or "No
    // thanks" on the card) cleared the card. A highway with the card still pending wasn't chosen.
    if (v1 && p.scoreViewNews === true) {
      delete p.display;
      p.scoreDefaultNote = true;
    } else p.displayChosen = true;
  } else if (p.display === undefined) {
    const entries = log();
    // Before the score view everyone practised on the highway; after it, Automatic meant the
    // highway from level 3.
    if (entries.length && (!v1 || entries.some((e) => e.level >= 3))) p.scoreDefaultNote = true;
  }
  delete p.scoreViewNews;
}

export interface SectionProgress {
  /** Highest level passed (0 = none). */
  level: number;
  /** level → best accuracy (0..1). */
  best: Record<number, number>;
  /** level → best points score. */
  bestScore?: Record<number, number>;
  attempts: number;
  lastPracticed?: number;
  lastPassed?: number;
  /** Local dates (YYYY-MM-DD) of off-book (level 5) passes; level 5 needs two different days. */
  offBookDays?: string[];
}

/**
 * Full run-throughs of the whole piece (docs/LEVELS.md). The piece's level is earned only here.
 * Optional: progress saved before piece levels existed has none (piece level 0).
 */
export interface FullRunProgress {
  /**
   * Highest piece level reached (0 = none): a counted full run at that level opened it and every
   * section that slipped in it has since passed the level on its own.
   */
  level: number;
  /** level → best accuracy of counted full runs (0..1). */
  best: Record<number, number>;
  /** level → best points score. */
  bestScore?: Record<number, number>;
  /** Counted full runs. */
  attempts: number;
  lastPracticed?: number;
  lastPassed?: number;
  /** Local dates on which level 5 (off book) was reached for the whole piece; piece level 5 needs two different days. */
  offBookDays?: string[];
  /**
   * level → open fix list: sections that slipped in the latest counted full run that opened that
   * level and haven't passed at that level (or above) on their own since. When the last one passes,
   * the piece reaches the level. A new run that opens the level replaces the list with its own slips.
   */
  toFix?: Record<number, string[]>;
  /**
   * level → that fix list came from a run that opened the level (ladder.runOpensLevel); only such
   * lists count (are shown, lead Next up, and grant the level when done). Earlier versions set it
   * for a run that "held" (a subset); their other lists are checked once by upgradeFullRuns.
   */
  toFixLocks?: Record<number, boolean>;
  /**
   * Levels with a clean-run star: a counted full run at that level in which every section held.
   * Set (possibly empty) on every record this version writes; absent = saved by an earlier version,
   * whose stars upgradeFullRuns works out from the history.
   */
  clean?: number[];
}

export interface PieceProgress {
  pieceId: string;
  partId: string;
  sections: Record<string, SectionProgress>;
  totalAttempts: number;
  bestScore: number;
  /** Full run-throughs (absent in data saved before piece levels). */
  full?: FullRunProgress;
}

export interface AttemptLog {
  at: number;
  pieceId: string;
  partId: string;
  sectionId: string;
  level: number;
  accuracy: number;
  score: number;
  passed: boolean;
  durationSec?: number;
}

/** A programme piece the app can't ship (e.g. still in copyright): shown as an "import your score" slot. */
export interface WantedPiece { title: string; composer: string; note?: string; focus?: boolean }

/** Loose title match so an imported "Vinea mea electa" fills the "Vinea mea electa" slot. */
export function sameWork(a: string, b: string): boolean {
  const n = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const A = n(a), B = n(b);
  return !!A && !!B && (A.includes(B) || B.includes(A));
}

/** When an imported score fills a programme slot, put it in the cycle (and in the next rehearsal's focus if the slot was). */
export function fillWantedSlot(pieceId: string, title: string): WantedPiece | null {
  const c = loadCycle();
  const slot = (c.wanted ?? []).find((w) => sameWork(title, w.title));
  if (!slot) return null;
  if (!c.pieceIds.includes(pieceId)) c.pieceIds = [...c.pieceIds, pieceId];
  if (slot.focus && !(c.focusPieceIds ?? []).includes(pieceId)) c.focusPieceIds = [...(c.focusPieceIds ?? []), pieceId];
  saveCycle(c);
  return slot;
}
export interface Cycle {
  name: string;
  concertDate?: string;
  /** A one-off next rehearsal (YYYY-MM-DD). Ignored when a weekly rehearsal is set. */
  rehearsalDate?: string;
  pieceIds: string[];
  /** Weekly rehearsal: 0 = Sunday … 6 = Saturday, with a local time "HH:MM". */
  rehearsalWeekday?: number;
  rehearsalTime?: string;
  /** Pieces the next rehearsal works on (Home puts them first). */
  focusPieceIds?: string[];
  /** Pieces in the programme that aren't in the app yet (e.g. still in copyright): import your own score. */
  wanted?: WantedPiece[];
  /** Id of the built-in programme preset this cycle came from (if any). */
  preset?: string;
}

export const DEFAULT_PROFILE: Profile = {
  name: '',
  voice: 'S',
  notation: 'letter',
  strictness: 'standard',
  tuning: 'equal',
  latencyMs: 0,
  onboarded: false,
  leaderboardOptIn: false,
};

// ---------------------------------------------------------------- storage

const memStorage = new Map<string, string>();

function ls(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function rawGet(key: string): string | null {
  // A value kept in memory after a failed write is newer than any copy on disk.
  const m = memStorage.get(key);
  if (m !== undefined) return m;
  const s = ls();
  if (s) {
    try { return s.getItem(key); } catch { /* fall through */ }
  }
  return null;
}

let storageFull = false;
const storageFullListeners = new Set<() => void>();
/** True once a write could not be saved on this device (storage full or disabled) this session. */
export function storageSaveFailed(): boolean { return storageFull; }
/** Called once, the first time a write can't be saved on this device. */
export function onStorageSaveFailed(cb: () => void): () => void {
  storageFullListeners.add(cb);
  return () => { storageFullListeners.delete(cb); };
}
function markStorageFull(): void {
  if (storageFull) return;
  storageFull = true;
  for (const cb of [...storageFullListeners]) {
    try { cb(); } catch (e) { console.error(e); }
  }
}

/** Entries of the attempt log kept when storage is full (the oldest are only used for long-term stats). */
const LOG_KEEP_WHEN_FULL = 300;

/** Make room on a full device without touching progress: drop the diagnostics log, trim the attempt log. */
function freeSpace(s: Storage, except: string): boolean {
  let freed = false;
  try {
    if (except !== 'sh:errors' && s.getItem('sh:errors') != null) { s.removeItem('sh:errors'); freed = true; }
  } catch { /* ignore */ }
  if (except !== K.log) {
    try {
      const raw = memStorage.get(K.log) ?? s.getItem(K.log);
      const log = raw ? JSON.parse(raw) : null;
      if (Array.isArray(log) && log.length > LOG_KEEP_WHEN_FULL) {
        const v = JSON.stringify(log.slice(log.length - LOG_KEEP_WHEN_FULL));
        s.setItem(K.log, v);
        memStorage.delete(K.log);
        freed = true;
      }
    } catch { /* ignore */ }
  }
  return freed;
}

export function rawSet(key: string, value: string): void {
  const s = ls();
  if (s) {
    try { s.setItem(key, value); memStorage.delete(key); return; } catch { /* quota / disabled */ }
    try {
      if (freeSpace(s, key)) { s.setItem(key, value); memStorage.delete(key); return; }
    } catch { /* still full */ }
    if (key === K.log) {
      // The attempt log itself: keep its newest entries.
      try {
        const log = JSON.parse(value);
        if (Array.isArray(log) && log.length > LOG_KEEP_WHEN_FULL) {
          s.setItem(key, JSON.stringify(log.slice(log.length - LOG_KEEP_WHEN_FULL)));
          memStorage.delete(key);
          return;
        }
      } catch { /* still full */ }
    }
  }
  // Kept in memory (read first by rawGet), so this session sees the newest value; the older copy on
  // disk (if any) stays as the best thing to come back to after a reload.
  memStorage.set(key, value);
  if (s) markStorageFull();
}

export function rawRemove(key: string): void {
  const s = ls();
  if (s) { try { s.removeItem(key); } catch { /* ignore */ } }
  memStorage.delete(key);
}

/** Storage keys starting with `prefix` (e.g. 'sh:words:'). */
export function keysWithPrefix(prefix: string): string[] {
  return allKeys().filter((k) => k.startsWith(prefix));
}

function allKeys(): string[] {
  const out = new Set<string>(memStorage.keys());
  const s = ls();
  if (s) {
    try {
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k) out.add(k); }
    } catch { /* ignore */ }
  }
  return [...out];
}

/** Read JSON; on missing → fallback; on corrupt or invalid → remove key and return fallback. */
export function readJSON<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T {
  ensureSchema();
  const raw = rawGet(key);
  if (raw == null) return fallback;
  try {
    const v = JSON.parse(raw);
    if (v === null || (valid && !valid(v))) throw new Error('invalid');
    return v as T;
  } catch {
    rawRemove(key);
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown, notify = true): void {
  ensureSchema();
  rawSet(key, JSON.stringify(value));
  if (notify) emit();
}

let schemaChecked = false;
function ensureSchema(): void {
  if (schemaChecked) return;
  schemaChecked = true;
  const v = Number(rawGet(K.schema));
  if (v !== SCHEMA_VERSION) {
    // Future migrations go here (v < SCHEMA_VERSION). Unknown/newer: keep data, stamp version.
    rawSet(K.schema, String(SCHEMA_VERSION));
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- pub/sub

const listeners = new Set<() => void>();
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function emit(): void {
  for (const cb of [...listeners]) {
    try { cb(); } catch (e) { console.error(e); }
  }
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => { if (!e.key || e.key.startsWith(PREFIX)) emit(); });
}

// ---------------------------------------------------------------- profile

export function loadProfile(): Profile {
  const p = readJSON<Partial<Profile>>(K.profile, {}, isObj);
  // Delays saved before the source was recorded may have been measured or learned: treat them as
  // learned (kept, refined when two runs agree, never used to fail a run on timing).
  if (typeof p.latencyMs === 'number' && p.latencyMs > 0 && !p.latencySource) p.latencySource = 'learned';
  // Once: sheet music is the default (see migrateScoreDefault).
  if (p.onboarded && !p.scoreDefaultMigrated) {
    migrateScoreDefault(p, attemptLog);
    writeJSON(K.profile, p, false);
  }
  return { ...DEFAULT_PROFILE, ...p };
}
export function saveProfile(p: Profile): void { writeJSON(K.profile, p); }

/** The storage key of one piece/part's progress (for the copy kept with a choir account). */
export const progressKey = K.progress;

// ---------------------------------------------------------------- progress

const isProgress = (v: unknown) => isObj(v) && isObj(v.sections);

export function getProgress(pieceId: string, partId: string): PieceProgress | undefined {
  const p = readJSON<PieceProgress | undefined>(K.progress(pieceId, partId), undefined, isProgress);
  return p ? { ...p, pieceId, partId } : undefined;
}

/** All stored piece/part progress records. */
export function allProgress(): PieceProgress[] {
  const out: PieceProgress[] = [];
  for (const k of allKeys()) {
    if (!k.startsWith('sh:progress:')) continue;
    const p = readJSON<PieceProgress | undefined>(k, undefined, isProgress);
    if (p) out.push(p);
  }
  return out;
}

export function resetProgress(pieceId: string, partId: string): void {
  rawRemove(K.progress(pieceId, partId));
  emit();
}

export interface RecordResult {
  passed: boolean;
  newLevel: number;
  prevLevel: number;
  /** Level 5: different days passed off book so far (memorised at OFF_BOOK_DAYS). */
  offBookDays?: number;
  /** This pass cleared the section from the full run's to-fix list at these levels (with how many are left). */
  fixed?: { level: number; remaining: number }[];
  /** The last fix at a level: the piece reached it (piece level before and after; level 5 on a first day gives 4). */
  reached?: PieceReach;
}

/** A level the whole piece reached: the fix list's (or run's) level, and the piece level before and after. */
export interface PieceReach { level: number; prevLevel: number; newLevel: number; offBookDays?: number }

function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Remove a section from the to-fix lists of levels ≤ `level`; returns what was cleared. A list that
 * becomes empty is done: the caller grants its level (reachLevel).
 */
function clearFix(full: FullRunProgress | undefined, sectionId: string, level: number): { level: number; remaining: number; open: boolean }[] {
  const out: { level: number; remaining: number; open: boolean }[] = [];
  if (!full?.toFix) return out;
  for (const k of Object.keys(full.toFix).map(Number).sort((a, b) => a - b)) {
    const ids = full.toFix[k] ?? [];
    if (k > level || !ids.includes(sectionId)) continue;
    // Only a list from a run that opened the level can grant it (a stale one just shrinks).
    const open = full.toFixLocks?.[k] === true;
    const rest = ids.filter((x) => x !== sectionId);
    if (rest.length) full.toFix[k] = rest;
    else { delete full.toFix[k]; if (full.toFixLocks) delete full.toFixLocks[k]; }
    out.push({ level: k, remaining: rest.length, open });
  }
  if (!Object.keys(full.toFix).length) delete full.toFix;
  if (full.toFixLocks && !Object.keys(full.toFixLocks).length) delete full.toFixLocks;
  return out;
}

/**
 * The whole piece reached level `lvl` (a clean run, or the last fix of the run that opened it).
 * Level 5 counts once it was reached on OFF_BOOK_DAYS different days; until then the piece is
 * concert-ready (4). Lists below the level are settled. Never lowers the piece level.
 */
export function reachLevel(full: FullRunProgress, lvl: number, now: number): PieceReach {
  const prevLevel = full.level ?? 0;
  let reach = lvl;
  if (lvl === 5) {
    full.offBookDays = [...new Set([...(full.offBookDays ?? []), localDay(now)])].slice(-5);
    if (full.offBookDays.length < OFF_BOOK_DAYS) reach = 4;
  }
  full.level = Math.max(prevLevel, reach);
  if (lvl >= prevLevel) full.lastPassed = now;
  if (full.toFix) {
    for (const k of Object.keys(full.toFix).map(Number)) if (k <= lvl) delete full.toFix[k];
    if (!Object.keys(full.toFix).length) delete full.toFix;
  }
  if (full.toFixLocks) {
    for (const k of Object.keys(full.toFixLocks).map(Number)) if (k <= lvl || !full.toFix?.[k]) delete full.toFixLocks[k];
    if (!Object.keys(full.toFixLocks).length) delete full.toFixLocks;
  }
  return { level: lvl, prevLevel, newLevel: full.level, ...(lvl === 5 ? { offBookDays: full.offBookDays?.length ?? 0 } : {}) };
}

/** Fold a section pass at `lvl` into its progress (level, best, review time, off-book days). */
function passSection(sp: SectionProgress, lvl: number, accuracy: number, now: number): void {
  const prevLevel = sp.level ?? 0;
  sp.best = { ...(sp.best ?? {}) };
  sp.best[lvl] = Math.max(sp.best[lvl] ?? 0, accuracy);
  sp.lastPracticed = now;
  let reach = lvl;
  if (lvl === 5) {
    sp.offBookDays = [...new Set([...(sp.offBookDays ?? []), localDay(now)])].slice(-5);
    // Memorised only once it held on a second day; until then it stays concert-ready.
    if (sp.offBookDays.length < OFF_BOOK_DAYS) reach = 4;
  }
  sp.level = Math.max(prevLevel, reach);
  // Passing at (or above) the current level counts as a review.
  if (lvl >= prevLevel) sp.lastPassed = now;
}

/**
 * Record one attempt. Level 0 (listen) only updates lastPracticed (and the log).
 * Any level 1..5 may be attempted (skip-ahead allowed); passing sets level = max(current, level).
 * Level 5 (off book) is only reached after passes on OFF_BOOK_DAYS different days.
 */
export function recordAttempt(
  pieceId: string,
  partId: string,
  sectionId: string,
  level: number,
  result: AttemptResult,
  durationSec?: number,
  now: number = Date.now(),
  extra: { timingFail?: boolean } = {},
): RecordResult {
  const prog: PieceProgress = getProgress(pieceId, partId) ?? {
    pieceId, partId, sections: {}, totalAttempts: 0, bestScore: 0,
  };
  const sp: SectionProgress = prog.sections[sectionId] ?? { level: 0, best: {}, attempts: 0 };
  sp.best ??= {};
  const prevLevel = sp.level ?? 0;
  const lvl = Math.max(0, Math.min(MAX_LEVEL, Math.round(level)));
  const accuracy = Number.isFinite(result.accuracy) ? result.accuracy : 0;
  const score = Number.isFinite(result.score) ? result.score : 0;

  let passed = false;
  let fixed: { level: number; remaining: number }[] = [];
  let reached: PieceReach | undefined;
  if (lvl === 0) {
    sp.lastPracticed = now;
  } else {
    // The level's mark (level 1: every note right, see ladder.attemptPasses).
    passed = attemptPasses(lvl, { accuracy, notes: result.notes ?? [] }) && !extra.timingFail;
    sp.attempts = (sp.attempts ?? 0) + 1;
    sp.best[lvl] = Math.max(sp.best[lvl] ?? 0, accuracy);
    sp.bestScore = { ...(sp.bestScore ?? {}) };
    sp.bestScore[lvl] = Math.max(sp.bestScore[lvl] ?? 0, score);
    sp.lastPracticed = now;
    if (passed) {
      passSection(sp, lvl, accuracy, now);
      // Passing a section on its own clears it from the full run's to-fix list (at this level and
      // below). The last one to fix at a level: the piece reaches that level.
      const cleared = clearFix(prog.full, sectionId, lvl).filter((f) => f.open);
      fixed = cleared.map(({ level, remaining }) => ({ level, remaining }));
      for (const f of cleared) {
        if (f.remaining !== 0 || !prog.full) continue;
        prog.full.clean ??= [];
        const r = reachLevel(prog.full, f.level, now);
        reached = reached ? { ...r, prevLevel: reached.prevLevel } : r;
      }
    }
    prog.totalAttempts = (prog.totalAttempts ?? 0) + 1;
    prog.bestScore = Math.max(prog.bestScore ?? 0, score);
  }
  prog.sections[sectionId] = sp;
  writeJSON(K.progress(pieceId, partId), prog, false);

  const entry: AttemptLog = { at: now, pieceId, partId, sectionId, level: lvl, accuracy, score, passed };
  if (durationSec != null && Number.isFinite(durationSec)) entry.durationSec = durationSec;
  const log = attemptLog();
  log.push(entry);
  writeJSON(K.log, log.length > LOG_CAP ? log.slice(log.length - LOG_CAP) : log, false);
  emit();
  return {
    passed, newLevel: sp.level, prevLevel,
    ...(lvl === 5 ? { offBookDays: sp.offBookDays?.length ?? 0 } : {}),
    ...(fixed.length ? { fixed } : {}),
    ...(reached ? { reached } : {}),
  };
}

export interface FullRunSection {
  id: string;
  accuracy: number;
  passed: boolean;
  /** Notes in the section that weren't right (ladder.noteVerdict; indices into the part's notes). */
  wrong?: number[];
}

export interface FullRunRecord {
  /** The run counted: in one go, at the level's tempo (and, level 1, with headphones on). */
  counted: boolean;
  /** Overall accuracy reached the pass mark (and the timing was fine). */
  overallPassed: boolean;
  /**
   * The run opened its level (counted, timing fine, at most half of the sections slipped): what
   * slipped is the new fix list, and the piece reaches the level once each of them passes on its own.
   */
  opened: boolean;
  /** Counted, but more than half of the sections slipped or the run was more than 10 points under the mark: practice (ladder.runOpensLevel). */
  tooMuch?: boolean;
  /** Clean run: opened with every section held and the run passed overall (a ★ for this level). */
  clean: boolean;
  /** The piece reached (or confirmed) the level in this run: a clean run. */
  passed: boolean;
  prevLevel: number;
  newLevel: number;
  /** Each section's accuracy within the run, in score order (sections the run didn't reach are left out). */
  sections: FullRunSection[];
  /** Sections to fix at this level after the run (the open fix list; empty unless the run opened the level). */
  toFix: string[];
  /** Level 5: different days the whole piece reached level 5 off book. */
  offBookDays?: number;
  /** This run's held sections finished an open fix list at a lower level: the piece reached it. */
  reached?: PieceReach;
}

/**
 * Record a run-through of the whole piece at `level` (docs/LEVELS.md).
 *
 * A counted run (`counted`: in one go, at the level's tempo, level 1 with headphones, level 5 with
 * everything hidden) opens level N when at most half of the sections slipped and the run came within
 * 10 points of the pass mark (ladder.runOpensLevel), and the timing was fine. Then the sections that held are credited as section passes, the ones that
 * slipped become the fix list at N (replacing any earlier list at N), and the piece reaches N as
 * soon as each of them passes N on its own (recordAttempt). Nothing slipped and the run passed
 * overall: the piece reaches N at once, with a clean-run star. More than half slipped, or the run
 * more than 10 points under the pass mark: practice, nothing changes. Level 5 counts once reached on OFF_BOOK_DAYS different days (reachLevel).
 * Uncounted runs are logged as practice and change nothing.
 */
export function recordFullRun(
  pieceId: string,
  partId: string,
  level: number,
  result: AttemptResult,
  sections: Section[],
  noteStart: (index: number) => number | undefined,
  opts: { counted: boolean; timingFail?: boolean; durationSec?: number; now?: number },
): FullRunRecord {
  const now = opts.now ?? Date.now();
  const prog: PieceProgress = getProgress(pieceId, partId) ?? {
    pieceId, partId, sections: {}, totalAttempts: 0, bestScore: 0,
  };
  const full: FullRunProgress = prog.full ?? { level: 0, best: {}, attempts: 0 };
  full.best ??= {};
  full.clean ??= [];
  const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.round(level) || 1));
  const accuracy = Number.isFinite(result.accuracy) ? result.accuracy : 0;
  const score = Number.isFinite(result.score) ? result.score : 0;
  const prevLevel = full.level ?? 0;
  const checks = sectionChecks(sections, noteStart, result, lvl);
  const runSections: FullRunSection[] = [...sections].sort((a, b) => a.index - b.index)
    .filter((s) => checks[s.id] != null)
    .map((s) => ({
      id: s.id, accuracy: checks[s.id].accuracy, passed: sectionHeld(lvl, checks[s.id]),
      ...(checks[s.id].wrong.length ? { wrong: checks[s.id].wrong } : {}),
    }));
  // Level 1: every note of the whole run right (each section's wrong notes make it "to fix").
  const overallPassed = attemptPasses(lvl, { accuracy, notes: result.notes ?? [] }) && !opts.timingFail;
  const slipped = runSections.filter((rs) => !rs.passed).map((rs) => rs.id);
  const tooMuch = opts.counted && !opts.timingFail && runSections.length > 0
    && !runOpensLevel({ level: lvl, sections: runSections.length, slipped: slipped.length, accuracy });
  const opened = opts.counted && !opts.timingFail && runSections.length > 0 && !tooMuch;

  let passed = false;
  let clean = false;
  let reached: PieceReach | undefined;
  full.lastPracticed = now;
  if (opened) {
    full.attempts = (full.attempts ?? 0) + 1;
    full.best[lvl] = Math.max(full.best[lvl] ?? 0, accuracy);
    full.bestScore = { ...(full.bestScore ?? {}) };
    full.bestScore[lvl] = Math.max(full.bestScore[lvl] ?? 0, score);
    // Each section that held within the run counts as a pass of that section, and comes off the
    // fix lists at this level and below (finishing a lower list reaches that level).
    for (const rs of runSections) {
      if (!rs.passed) continue;
      const sp: SectionProgress = prog.sections[rs.id] ?? { level: 0, best: {}, attempts: 0 };
      passSection(sp, lvl, rs.accuracy, now);
      // Held in a counted run of the whole piece: that's a review of the section, whatever its level.
      sp.lastPassed = now;
      prog.sections[rs.id] = sp;
      for (const f of clearFix(full, rs.id, lvl - 1)) {
        if (f.remaining === 0 && f.open) reached = reachLevel(full, f.level, now);
      }
    }
    // This run's slips replace the fix list at its level: a section fixed since the last run stays
    // off only if it held again.
    full.toFix = { ...(full.toFix ?? {}) };
    full.toFixLocks = { ...(full.toFixLocks ?? {}) };
    delete full.toFixLocks[lvl];
    if (slipped.length) { full.toFix[lvl] = slipped; full.toFixLocks[lvl] = true; }
    else {
      delete full.toFix[lvl];
      reachLevel(full, lvl, now);
      passed = true;
      clean = overallPassed;
      if (clean && !full.clean.includes(lvl)) full.clean = [...full.clean, lvl].sort((a, b) => a - b);
    }
    if (full.toFix && !Object.keys(full.toFix).length) delete full.toFix;
    if (full.toFixLocks && !Object.keys(full.toFixLocks).length) delete full.toFixLocks;
  }
  prog.full = full;
  prog.totalAttempts = (prog.totalAttempts ?? 0) + 1;
  prog.bestScore = Math.max(prog.bestScore ?? 0, score);
  writeJSON(K.progress(pieceId, partId), prog, false);

  // Only runs that opened their level are logged as full runs ('all'); the rest is practice.
  const entry: AttemptLog = { at: now, pieceId, partId, sectionId: opened ? 'all' : 'practice', level: lvl, accuracy, score, passed };
  if (opts.durationSec != null && Number.isFinite(opts.durationSec)) entry.durationSec = opts.durationSec;
  const log = attemptLog();
  log.push(entry);
  writeJSON(K.log, log.length > LOG_CAP ? log.slice(log.length - LOG_CAP) : log, false);
  emit();
  return {
    counted: opts.counted, overallPassed, opened, clean, passed, prevLevel, newLevel: full.level ?? 0,
    sections: runSections, toFix: opened ? slipped : [],
    ...(tooMuch ? { tooMuch } : {}),
    ...(lvl === 5 ? { offBookDays: full.offBookDays?.length ?? 0 } : {}),
    ...(reached && reached.level < lvl ? { reached } : {}),
  };
}

/**
 * Bring a piece's progress saved under the earlier level rules up to date (docs/LEVELS.md,
 * "Progress saved under the earlier rules"). Idempotent; never lowers a level. Returns true when it
 * changed something (and saved it). Every grant needs a run that would open the level under the
 * current rule (ladder.runOpensLevel: at most half of the sections slipped, within 10 points of the
 * pass mark).
 *
 * - Clean-run stars: under the earlier rules a counted full run passed only when every section held,
 *   so each passed full run in the attempt log is a clean run at its level. Without a log entry (the
 *   log is trimmed, and isn't kept with a choir account), the piece level itself shows one: a clean
 *   run at that level, or at level 5 when the piece was passed off book.
 * - Fix lists still open: earlier versions wrote one for every counted run, also a beginner's run
 *   far above their level where everything slipped. A list counts only when its run would open the
 *   level now: marked as held then (`toFixLocks`), or the latest counted run at that level in the log
 *   came within 10 points of the mark and the list names at most half of the sections. Any other
 *   list is dropped (practice, as that run would be now).
 * - Fix lists already done: the earlier rules asked for a second full run after the fixes. When the
 *   latest counted full run at N (in the log) would open N now (within 10 points; the sections that
 *   needed a pass of their own afterwards at most half), and every section has passed N since, on
 *   its own or held within that run, the piece reaches N. A run that failed on timing credited no
 *   section, so all of them needed a pass afterwards: it doesn't grant.
 */
export function upgradeFullRuns(pieceId: string, partId: string, sections: Section[]): boolean {
  const prog = getProgress(pieceId, partId);
  const full = prog?.full;
  if (!prog || !full) return false;
  let changed = false;
  const log = attemptLog().filter((e) => e.pieceId === pieceId && e.partId === partId);
  const lastRun = (n: number) => { const runs = log.filter((e) => e.sectionId === 'all' && e.level === n); return runs[runs.length - 1]; };
  if (!Array.isArray(full.clean)) {
    const stars = new Set<number>();
    for (const e of log) if (e.sectionId === 'all' && e.passed && e.level >= 1 && e.level <= MAX_LEVEL) stars.add(e.level);
    if (!stars.size && (full.level ?? 0) > 0) stars.add(full.offBookDays?.length ? 5 : Math.min(MAX_LEVEL, full.level));
    full.clean = [...stars].sort((a, b) => a - b);
    changed = true;
  }
  if (sections.length > 1) {
    const ids = new Set(sections.map((x) => x.id));
    // Stored fix lists: keep only those from a run that would open the level now.
    for (const k of Object.keys(full.toFix ?? {}).map(Number)) {
      const list = (full.toFix![k] ?? []).filter((id) => ids.has(id));
      if (!list.length) continue; // another part's sections, or empty: leave alone
      const run = lastRun(k);
      const ok = list.length * 2 <= sections.length && (full.toFixLocks?.[k] === true
        || (!!run && !run.passed && runOpensLevel({ level: k, sections: sections.length, slipped: list.length, accuracy: run.accuracy })));
      if (ok && full.toFixLocks?.[k] === true) continue;
      if (ok) full.toFixLocks = { ...(full.toFixLocks ?? {}), [k]: true };
      else {
        delete full.toFix![k];
        if (full.toFixLocks) delete full.toFixLocks[k];
      }
      changed = true;
    }
    if (full.toFix && !Object.keys(full.toFix).length) delete full.toFix;
    if (full.toFixLocks && !Object.keys(full.toFixLocks).length) delete full.toFixLocks;
    for (let n = 1; n <= MAX_LEVEL; n++) {
      if ((full.level ?? 0) >= (n === 5 ? 4 : n) || full.toFix?.[n]?.length) continue;
      const run = lastRun(n);
      if (!run || run.passed || full.best?.[n] == null) continue;
      // When each section passed level n after that run (fixed), or held within it (credited then).
      let doneAt = run.at;
      let fixedAfter = 0;
      const ok = sections.every((sec) => {
        const sp = prog.sections[sec.id];
        const pass = log.find((e) => e.sectionId === sec.id && e.passed && e.level >= n && e.at > run.at);
        if (pass) { doneAt = Math.max(doneAt, pass.at); fixedAfter++; return true; }
        return !!sp && sp.level >= Math.min(n, 4) && (sp.lastPassed ?? 0) >= run.at;
      });
      if (!ok || !runOpensLevel({ level: n, sections: sections.length, slipped: fixedAfter, accuracy: run.accuracy })) continue;
      reachLevel(full, n, doneAt);
      changed = true;
    }
  }
  if (changed) writeJSON(K.progress(pieceId, partId), prog);
  return changed;
}

export function personalBest(
  pieceId: string, partId: string, sectionId: string, level: number,
): { accuracy: number; score: number } | null {
  const prog = getProgress(pieceId, partId);
  // The whole piece: counted full runs (the old 'all' record mixed in practice runs).
  const sp = sectionId === 'all' ? prog?.full : prog?.sections[sectionId];
  if (!sp || sp.best?.[level] == null) return null;
  return { accuracy: sp.best[level], score: sp.bestScore?.[level] ?? 0 };
}

export function dueForReview(pieceId: string, partId: string, sections: Section[], now: number = Date.now()): string[] {
  const prog = getProgress(pieceId, partId);
  if (!prog) return [];
  return sections.filter((s) => isDue(prog.sections[s.id], now)).map((s) => s.id);
}

// ---------------------------------------------------------------- log & stats

export function attemptLog(): AttemptLog[] {
  const v = readJSON<AttemptLog[]>(K.log, [], Array.isArray);
  return v.filter((e) => isObj(e) && typeof e.at === 'number');
}

/** Local-time day key 'YYYY-MM-DD'. */
export function dayKey(t: number | Date): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prevDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12); }

/** Consecutive local days with ≥1 attempt, ending today or yesterday. */
export function streakDays(now: Date = new Date()): number {
  const days = new Set(attemptLog().map((e) => dayKey(e.at)));
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (!days.has(dayKey(d))) {
    d = prevDay(d);
    if (!days.has(dayKey(d))) return 0;
  }
  let n = 0;
  while (days.has(dayKey(d))) { n++; d = prevDay(d); }
  return n;
}

/** Minutes practised in the last `days` days (from the attempt log). */
export function practiceMinutes(days: number, now: number = Date.now()): number {
  const since = now - days * DAY_MS;
  let sec = 0;
  for (const e of attemptLog()) if (e.at > since && e.at <= now) sec += e.durationSec ?? DEFAULT_ATTEMPT_SEC;
  return Math.round(sec / 60);
}

// ---------------------------------------------------------------- readiness history

type ReadinessHistory = Record<string, Record<string, number>>;
const READINESS_DAYS_KEPT = 120;

/** Store today's readiness for a piece/part (one value per day). Does NOT notify subscribers. */
export function snapshotReadiness(pieceId: string, partId: string, pct: number, now: number = Date.now()): void {
  const all = readJSON<ReadinessHistory>(K.readiness, {}, isObj);
  const id = `${pieceId}|${partId}`;
  const h = isObj(all[id]) ? all[id] : {};
  const day = dayKey(now);
  if (h[day] === pct) return;
  h[day] = pct;
  const ks = Object.keys(h).sort();
  for (const k of ks.slice(0, Math.max(0, ks.length - READINESS_DAYS_KEPT))) delete h[k];
  all[id] = h;
  writeJSON(K.readiness, all, false);
}

export function readinessHistory(pieceId: string, partId: string): { day: string; pct: number }[] {
  const all = readJSON<ReadinessHistory>(K.readiness, {}, isObj);
  const h = all[`${pieceId}|${partId}`];
  if (!isObj(h)) return [];
  return Object.keys(h).sort().map((day) => ({ day, pct: Number(h[day]) || 0 }));
}

// ---------------------------------------------------------------- cycle

export const DEFAULT_CYCLE: Cycle = { name: 'This cycle', pieceIds: [] };

const isStr = (v: unknown): v is string => typeof v === 'string';
const strIds = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter(isStr) : undefined);

/** The cycle, with each field checked (a bad field from an old version, a backup or a sync falls back, the rest is kept). */
export function loadCycle(): Cycle {
  const c = readJSON<Record<string, unknown>>(K.cycle, {}, isObj);
  const out: Cycle = { ...DEFAULT_CYCLE, pieceIds: strIds(c.pieceIds) ?? [] };
  if (isStr(c.name)) out.name = c.name;
  if (isStr(c.concertDate)) out.concertDate = c.concertDate;
  if (isStr(c.rehearsalDate)) out.rehearsalDate = c.rehearsalDate;
  if (Number.isInteger(c.rehearsalWeekday) && (c.rehearsalWeekday as number) >= 0 && (c.rehearsalWeekday as number) <= 6) out.rehearsalWeekday = c.rehearsalWeekday as number;
  if (isStr(c.rehearsalTime)) out.rehearsalTime = c.rehearsalTime;
  const focus = strIds(c.focusPieceIds);
  if (focus) out.focusPieceIds = focus;
  if (Array.isArray(c.wanted)) {
    out.wanted = c.wanted.filter((w): w is Record<string, unknown> & { title: string } => isObj(w) && isStr(w.title)).map((w) => {
      const x: WantedPiece = { title: w.title, composer: isStr(w.composer) ? w.composer : '' };
      if (isStr(w.note)) x.note = w.note;
      if (w.focus === true) x.focus = true;
      return x;
    });
  }
  if (isStr(c.preset)) out.preset = c.preset;
  return out;
}
export function saveCycle(c: Cycle): void { writeJSON(K.cycle, c); }

// ---------------------------------------------------------------- imported scores (IndexedDB)

const memScores = new Map<string, Score>();
const SCORE_PREFIX = 'score:';

function idbAvailable(): boolean {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

async function tryIdb<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (!idbAvailable()) return undefined;
  try {
    // Guard against a hung open (some private modes never resolve).
    return await Promise.race([
      fn(),
      new Promise<undefined>((res) => setTimeout(() => res(undefined), 3000)),
    ]);
  } catch {
    return undefined;
  }
}

/** Save an imported score. Resolves false when it could only be kept in memory (lost on reload). */
export async function saveImportedScore(s: Score): Promise<boolean> {
  memScores.set(s.id, s);
  const ok = (await tryIdb(async () => { await idbSet(SCORE_PREFIX + s.id, s); return true; })) === true;
  emit();
  return ok;
}

export async function loadImportedScores(): Promise<Score[]> {
  const out = new Map(memScores);
  const ks = await tryIdb(() => idbKeys());
  if (ks) {
    for (const k of ks) {
      if (typeof k !== 'string' || !k.startsWith(SCORE_PREFIX)) continue;
      const s = await tryIdb(() => idbGet<Score>(k));
      if (s && isObj(s) && Array.isArray((s as Score).parts)) {
        out.set(s.id, s);
        memScores.set(s.id, s);
      }
    }
  }
  return [...out.values()];
}

export async function deleteImportedScore(id: string): Promise<void> {
  memScores.delete(id);
  await tryIdb(() => idbDel(SCORE_PREFIX + id));
  emit();
}

// ---------------------------------------------------------------- backup

interface Backup { app: 'schonberg-hero'; schema: number; exportedAt: number; data: Record<string, string> }

/** All `sh:` localStorage keys as JSON (imported scores are not included). */
export function exportBackup(): string {
  const data: Record<string, string> = {};
  for (const k of allKeys().sort()) {
    if (!k.startsWith(PREFIX)) continue;
    const v = rawGet(k);
    if (v != null) data[k] = v;
  }
  const b: Backup = { app: 'schonberg-hero', schema: SCHEMA_VERSION, exportedAt: Date.now(), data };
  return JSON.stringify(b);
}

/** Restore a backup (replaces existing `sh:` keys). Throws a readable Error on invalid input. */
export function importBackup(json: string): void {
  let b: unknown;
  try { b = JSON.parse(json); } catch { throw new Error('This is not a valid backup file (bad JSON).'); }
  if (!isObj(b) || b.app !== 'schonberg-hero' || !isObj(b.data)) {
    throw new Error('This is not a Schönberg Hero backup.');
  }
  const entries = Object.entries(b.data).filter(([k, v]) => k.startsWith(PREFIX) && typeof v === 'string');
  for (const k of allKeys()) if (k.startsWith(PREFIX)) rawRemove(k);
  for (const [k, v] of entries) rawSet(k, v as string);
  schemaChecked = false;
  ensureSchema();
  emit();
}

/** Test helper: wipe all `sh:` keys and in-memory state. */
export function _resetAllForTests(): void {
  for (const k of allKeys()) if (k.startsWith(PREFIX)) rawRemove(k);
  memStorage.clear();
  memScores.clear();
  schemaChecked = false;
  storageFull = false;
}
