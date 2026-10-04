// Local persistence: small JSON in localStorage (keys prefixed `sh:`),
// imported scores in IndexedDB (idb-keyval) with an in-memory fallback.
// Loading never throws: corrupted keys are reset to defaults.
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval';
import type { Score, Section, VoiceType } from '../music/types';
import type { AttemptResult, TuningMode } from '../game/types';
import { LEVELS, isDue, type Strictness } from './ladder';

/** Structurally identical to game/notation.ts NotationMode. */
export type NotationMode = 'letter' | 'fixed' | 'movable' | 'jianpu' | 'pc';

export const SCHEMA_VERSION = 1;
export const PREFIX = 'sh:';
const K = {
  schema: 'sh:schema',
  profile: 'sh:profile',
  cycle: 'sh:cycle',
  log: 'sh:log',
  readiness: 'sh:readiness',
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
  /** Keep the last run's recording in memory so it can be shared (default on). */
  keepRecording?: boolean;
  rangeLow?: number;
  rangeHigh?: number;
  onboarded: boolean;
  leaderboardOptIn: boolean;
  choirCode?: string;
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
}

export interface PieceProgress {
  pieceId: string;
  partId: string;
  sections: Record<string, SectionProgress>;
  totalAttempts: number;
  bestScore: number;
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
  const s = ls();
  if (s) {
    try { return s.getItem(key); } catch { /* fall through */ }
  }
  return memStorage.get(key) ?? null;
}

export function rawSet(key: string, value: string): void {
  const s = ls();
  if (s) {
    try { s.setItem(key, value); return; } catch { /* quota / disabled */ }
  }
  memStorage.set(key, value);
}

export function rawRemove(key: string): void {
  const s = ls();
  if (s) { try { s.removeItem(key); } catch { /* ignore */ } }
  memStorage.delete(key);
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
  // Delays saved before the source was recorded came from the delay check (or a typed value).
  if (typeof p.latencyMs === 'number' && p.latencyMs > 0 && !p.latencySource) p.latencySource = 'measured';
  return { ...DEFAULT_PROFILE, ...p };
}
export function saveProfile(p: Profile): void { writeJSON(K.profile, p); }

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

export interface RecordResult { passed: boolean; newLevel: number; prevLevel: number }

/**
 * Record one attempt. Level 0 (listen) only updates lastPracticed (and the log).
 * Any level 1..4 may be attempted (skip-ahead allowed); passing sets level = max(current, level).
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
  const lvl = Math.max(0, Math.min(4, Math.round(level)));
  const accuracy = Number.isFinite(result.accuracy) ? result.accuracy : 0;
  const score = Number.isFinite(result.score) ? result.score : 0;

  let passed = false;
  if (lvl === 0) {
    sp.lastPracticed = now;
  } else {
    passed = accuracy >= LEVELS[lvl - 1].pass && !extra.timingFail;
    sp.attempts = (sp.attempts ?? 0) + 1;
    sp.best[lvl] = Math.max(sp.best[lvl] ?? 0, accuracy);
    sp.bestScore = { ...(sp.bestScore ?? {}) };
    sp.bestScore[lvl] = Math.max(sp.bestScore[lvl] ?? 0, score);
    sp.lastPracticed = now;
    if (passed) {
      sp.level = Math.max(prevLevel, lvl);
      // Passing at (or above) the current level counts as a review.
      if (lvl >= prevLevel) sp.lastPassed = now;
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
  return { passed, newLevel: sp.level, prevLevel };
}

export function personalBest(
  pieceId: string, partId: string, sectionId: string, level: number,
): { accuracy: number; score: number } | null {
  const sp = getProgress(pieceId, partId)?.sections[sectionId];
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

export function loadCycle(): Cycle {
  const c = readJSON<Partial<Cycle>>(K.cycle, {}, isObj);
  return { ...DEFAULT_CYCLE, ...c, pieceIds: Array.isArray(c.pieceIds) ? c.pieceIds : [] };
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
}
