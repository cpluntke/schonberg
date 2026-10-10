// Your progress, kept with your choir account on the server, so it follows you to any phone.
//
// What's kept (aim: well under 8 KB for a singer with a handful of pieces): the settings, the
// programme, and per piece + part the section levels, best results, practice dates and off-book days,
// the full-run record with its to-fix lists, a rounded per-bar summary, the words stage and the latest
// readiness value. Never the attempt log, the readiness history or sound recordings.
//
// Any choir account keeps it: a member's own account (made with the choir code), a section lead's or
// an admin's. Sync: after runs (at most once a minute) and when the app starts or comes back, if
// something changed. Logging in on another phone pulls it first; when that phone already has progress
// under another name (or from another account) and the account keeps progress too, it asks before
// merging (a new, empty account just takes this phone's progress). Each save names the revision
// it builds on; when another phone of the same account saved in between, the server says so (409) and
// this phone merges that copy in first. Merging never lowers anything: higher levels and best results
// win, newer dates win.

import {
  allProgress, getProgress, keysWithPrefix, loadCycle, loadProfile, migrateToSteps, progressKey, rawGet, rawRemove, rawSet, reachLevel,
  readinessHistory, readJSON, saveCycle, saveProfile, snapshotReadiness, writeJSON, addSyncedDays, practiceDays,
  type Cycle, type FullRunProgress, type PieceProgress, type Profile, type SectionProgress,
} from './store';
import { barsKey, getBars, type BarMap, type BarStat } from './bars';
import { getWords, wordsKey, type WordsProgress } from './words';
import { accountMadeHere, apiBase, endSession, loadSession, onSessionChange, sessionFor, type Session } from './choir';
import { mergeSyncedPoints, pointsForSync, type CyclePoints } from './points';

/**
 * 2: levels have a slow and an in-tempo step (SectionC[6] = slow). A copy with v < 2 comes from an
 * older app, whose level 1 was the slow step: it's migrated (store.migrateToSteps) before merging, so
 * it never grants Level 1 in tempo.
 */
export const SNAPSHOT_VERSION = 2;
export const MAX_PIECES = 60;
export const MAX_SECTIONS = 120;
export const MAX_BARS = 400;
/** The whole upload, in UTF-8 bytes (the server takes 32 KB). Pieces fill what the rest leaves. */
export const TOTAL_BUDGET = 30 * 1024;
const DAY_MS = 86_400_000;
/** Uploaded at least this often even without changes, so the server never sees it as abandoned. */
const REFRESH_MS = 30 * 86_400_000;
/** Syncs at most this often (after a run it goes up within this time; closing the app sends it right away). */
export const MIN_GAP_MS = 10_000;

const META_KEY = 'schonberg:syncMeta';
const ASK_KEY = 'schonberg:syncAsk';
const TIP_KEY = 'sh:accountTip';

// ------------------------------------------------------------------ the compact format

// Times are whole minutes before the piece's latest time `h` (minutes since 1970), plus one: 1 = that
// minute, 0 = never. Rounded down, so a saved copy never looks newer than the phone it came from.

/**
 * A section: level (in tempo), last passed, last practised, attempts, best % per level 1…5, off-book
 * days, slow (the highest level whose slow step passed, when above the level; v2). Older apps read
 * the first six and ignore the rest.
 */
export type SectionC = [number, number, number, number, number[], string[]?, number?];
/** The full-run record; `pt` = last practised to the millisecond (it decides whose to-fix lists win). */
export interface FullC { l: number; b: number[]; a: number; lp: number; pr: number; pt?: number; ob?: string[]; fx?: Record<string, string[]>; fk?: number[]; cl?: number[] }
/**
 * Bars m, m+1, … one character each (0…63 → 0…1, '.' = not sung, `!n!` = n bars not sung): recent
 * accuracy, from memory, off book; `at` = when last sung.
 */
export interface BarsC { m: number; e: string; k?: string; o?: string; at: number }
export interface PieceC {
  /** The piece's latest time, in minutes since 1970. */
  h: number;
  s: Record<string, SectionC>;
  f?: FullC;
  b?: BarsC;
  /** Words: highest stage passed per section. */
  w?: Record<string, number>;
  /** Latest readiness: [day, 0…1]. */
  r?: [string, number];
  t?: number;
  bs?: number;
}
export interface ProgressSnapshot {
  v: number;
  /** When this copy was made (ms). */
  at: number;
  profile: Partial<Profile>;
  cycle?: Cycle;
  /** The built-in programme preset this phone applied. */
  cp?: string;
  /** Which part the singer sings in each piece, where they chose one. */
  parts?: Record<string, string>;
  /** `pieceId|partId` → progress. */
  p: Record<string, PieceC>;
  /** Cycle points (notes sung right this cycle). */
  pts?: CyclePoints;
  /** Days practised (YYYY-MM-DD, the last few months): the streak carries over to a new phone. */
  days?: string[];
}

const PROFILE_KEYS = [
  'name', 'voice', 'notation', 'strictness', 'tuning', 'latencyMs', 'beat', 'keepRecording', 'rangeLow', 'rangeHigh',
  'onboarded', 'leaderboardOptIn', 'choirCode', 'shareProgress', 'display', 'displayChosen', 'scoreStaves', 'scorePages',
  'boardHidden', 'presenceHidden', 'shareOptOut',
] as const;

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const UNIT = 60_000; // a minute
const units = (ms: number | undefined) => (ms ? Math.floor(ms / UNIT) : 0);
/** A time as hours before `h`, plus one (0 = never). */
const ago = (ms: number | undefined, h: number) => (ms ? Math.max(1, h - units(ms) + 1) : 0);
/** No time from a saved copy lies more than a day ahead (a wrong clock on another phone can't pin "newest"). */
const capTime = (t: number) => Math.min(t, Date.now() + DAY_MS);
const fromAgo = (a: number, h: number) => (a > 0 && h > 0 ? capTime((h - a + 1) * UNIT) : undefined);
const utf8 = (s: string) => new TextEncoder().encode(s).length;
/** Runs of 3 or more '.' as `!n!`. */
const squeeze = (s: string) => s.replace(/\.+$/, '').replace(/\.{3,}/g, (m) => `!${m.length}!`);
const unsqueeze = (s: string) => s.replace(/!(\d{1,4})!/g, (_, n) => '.'.repeat(Math.min(MAX_BARS, Number(n))));
const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);
const q64 = (v: number | undefined) => (v == null || !Number.isFinite(v) ? '.' : B64[Math.round(Math.max(0, Math.min(1, v)) * 63)]);
const dq64 = (ch: string | undefined) => {
  const i = ch == null ? -1 : B64.indexOf(ch);
  return i < 0 ? undefined : Math.round((i / 63) * 100) / 100;
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function bestArr(best: Record<number, number> | undefined): number[] {
  const out: number[] = [];
  for (let l = 1; l <= 5; l++) out.push(pct(best?.[l] ?? 0));
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}
function bestRec(arr: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (Array.isArray(arr)) arr.slice(0, 5).forEach((v, i) => { if (num(v) > 0) out[i + 1] = Math.min(100, num(v)) / 100; });
  return out;
}
const days = (v: unknown): string[] | undefined => {
  const d = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)).slice(-5) : [];
  return d.length ? d : undefined;
};

export function encodeSection(sp: SectionProgress, h: number): SectionC {
  const out: SectionC = [sp.level ?? 0, ago(sp.lastPassed, h), ago(sp.lastPracticed, h), sp.attempts ?? 0, bestArr(sp.best)];
  const slow = Math.round(num(sp.slow));
  const withSlow = slow > (sp.level ?? 0) && slow <= 5;
  if (sp.offBookDays?.length || withSlow) out.push(sp.offBookDays?.length ? sp.offBookDays.slice(-5) : []);
  if (withSlow) out.push(slow);
  return out;
}
export function decodeSection(c: unknown, h: number): SectionProgress | null {
  if (!Array.isArray(c)) return null;
  const sp: SectionProgress = { level: Math.max(0, Math.min(5, Math.round(num(c[0])))), best: bestRec(c[4]), attempts: Math.max(0, Math.round(num(c[3]))) };
  const lp = fromAgo(num(c[1]), h), pr = fromAgo(num(c[2]), h);
  if (lp) sp.lastPassed = lp;
  if (pr) sp.lastPracticed = pr;
  const ob = days(c[5]);
  if (ob) sp.offBookDays = ob;
  const slow = Math.round(num(c[6]));
  if (slow > sp.level && slow <= 5) sp.slow = slow;
  return sp;
}

function encodeFull(f: FullRunProgress, h: number): FullC {
  const out: FullC = { l: f.level ?? 0, b: bestArr(f.best), a: f.attempts ?? 0, lp: ago(f.lastPassed, h), pr: ago(f.lastPracticed, h) };
  if (f.lastPracticed) out.pt = Math.floor(f.lastPracticed);
  if (f.offBookDays?.length) out.ob = f.offBookDays.slice(-5);
  if (f.toFix && Object.keys(f.toFix).length) out.fx = Object.fromEntries(Object.entries(f.toFix).map(([k, ids]) => [k, ids.slice(0, MAX_SECTIONS)]));
  const locks = Object.keys(f.toFixLocks ?? {}).filter((k) => f.toFixLocks![Number(k)]).map(Number);
  if (locks.length) out.fk = locks;
  // Clean-run stars (kept even when empty: it marks a record already under the current rules).
  if (Array.isArray(f.clean)) out.cl = f.clean.filter((l) => Number.isInteger(l) && l >= 1 && l <= 5);
  return out;
}
function decodeFull(c: unknown, h: number): FullRunProgress | undefined {
  if (!isObj(c)) return undefined;
  const f: FullRunProgress = { level: Math.max(0, Math.min(5, Math.round(num(c.l)))), best: bestRec(c.b), attempts: Math.max(0, Math.round(num(c.a))) };
  const lp = fromAgo(num(c.lp), h), pr = fromAgo(num(c.pr), h);
  if (lp) f.lastPassed = lp;
  if (pr) f.lastPracticed = pr;
  if (num(c.pt) > 0) f.lastPracticed = capTime(num(c.pt));
  const ob = days(c.ob);
  if (ob) f.offBookDays = ob;
  if (isObj(c.fx)) {
    const fx: Record<number, string[]> = {};
    for (const [k, ids] of Object.entries(c.fx)) {
      const lvl = Number(k);
      const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
      if (lvl >= 1 && lvl <= 5 && list.length) fx[lvl] = list;
    }
    if (Object.keys(fx).length) f.toFix = fx;
  }
  if (Array.isArray(c.fk) && f.toFix) {
    const locks: Record<number, boolean> = {};
    for (const k of c.fk) if (typeof k === 'number' && f.toFix[k]) locks[k] = true;
    if (Object.keys(locks).length) f.toFixLocks = locks;
  }
  if (Array.isArray(c.cl)) f.clean = [...new Set(c.cl.filter((l): l is number => Number.isInteger(l) && l >= 1 && l <= 5))].sort((a, b) => a - b);
  return f;
}

export function encodeBars(bars: BarMap, h: number): BarsC | undefined {
  const ms = Object.keys(bars).map(Number).filter((m) => Number.isInteger(m) && m >= 0 && bars[m]).sort((a, b) => a - b);
  if (!ms.length) return undefined;
  const m0 = ms[0];
  const last = Math.min(ms[ms.length - 1], m0 + MAX_BARS - 1);
  let e = '', k = '', o = '', at = 0;
  for (let m = m0; m <= last; m++) {
    const s = bars[m];
    e += q64(s?.ema);
    k += q64(s?.mem);
    o += q64(s?.off);
    if (s) at = Math.max(at, num(s.at));
  }
  const out: BarsC = { m: m0, e: squeeze(e), at: ago(at, h) };
  if (/[^.]/.test(k)) out.k = squeeze(k);
  if (/[^.]/.test(o)) out.o = squeeze(o);
  return out;
}
export function decodeBars(c: unknown, h: number): BarMap {
  const out: BarMap = {};
  if (!isObj(c) || typeof c.e !== 'string') return out;
  const m0 = Math.max(0, Math.round(num(c.m)));
  const at = fromAgo(num(c.at), h) ?? 0;
  const e = unsqueeze(c.e);
  const k = typeof c.k === 'string' ? unsqueeze(c.k) : '', o = typeof c.o === 'string' ? unsqueeze(c.o) : '';
  for (let i = 0; i < Math.min(e.length, MAX_BARS); i++) {
    const ema = dq64(e[i]);
    if (ema == null) continue;
    const s: BarStat = { ema, n: 1, at };
    const mem = dq64(k[i]), off = dq64(o[i]);
    if (mem != null) s.mem = mem;
    if (off != null) s.off = off;
    out[m0 + i] = s;
  }
  return out;
}

export interface DecodedPiece { progress: PieceProgress; bars: BarMap; words: Record<string, number>; readiness?: [string, number] }

export function encodePiece(prog: PieceProgress | undefined, bars: BarMap, words: Record<string, WordsProgress>, readiness?: [string, number],
  withBars = true): PieceC {
  const s: Record<string, SectionC> = {};
  const secs = Object.entries(prog?.sections ?? {})
    .sort((a, b) => (b[1].lastPracticed ?? 0) - (a[1].lastPracticed ?? 0)).slice(0, MAX_SECTIONS);
  const times = [prog?.full?.lastPracticed, prog?.full?.lastPassed, ...secs.flatMap(([, sp]) => [sp.lastPracticed, sp.lastPassed]),
    ...Object.values(bars).map((b) => b?.at)];
  const h = units(Math.max(0, ...times.map((t) => num(t))));
  for (const [id, sp] of secs) s[id] = encodeSection(sp, h);
  const out: PieceC = { h, s };
  if (prog?.full) out.f = encodeFull(prog.full, h);
  const b = withBars ? encodeBars(bars, h) : undefined;
  if (b) out.b = b;
  const w: Record<string, number> = {};
  for (const [id, wp] of Object.entries(words).slice(0, MAX_SECTIONS)) if (num(wp?.passed, -1) >= 0) w[id] = wp.passed;
  if (Object.keys(w).length) out.w = w;
  if (readiness) out.r = [readiness[0], Math.round(readiness[1] * 1000) / 1000];
  if (prog?.totalAttempts) out.t = prog.totalAttempts;
  if (prog?.bestScore) out.bs = Math.round(prog.bestScore);
  return out;
}

export function decodePiece(pieceId: string, partId: string, c: unknown): DecodedPiece | null {
  if (!isObj(c) || !isObj(c.s)) return null;
  const h = Math.max(0, Math.round(num(c.h)));
  const sections: Record<string, SectionProgress> = {};
  for (const [id, sc] of Object.entries(c.s).slice(0, MAX_SECTIONS)) {
    const sp = decodeSection(sc, h);
    if (sp) sections[id] = sp;
  }
  const progress: PieceProgress = { pieceId, partId, sections, totalAttempts: Math.round(num(c.t)), bestScore: num(c.bs) };
  const full = decodeFull(c.f, h);
  if (full) progress.full = full;
  const words: Record<string, number> = {};
  if (isObj(c.w)) for (const [id, v] of Object.entries(c.w)) if (typeof v === 'number' && v >= 0 && v <= 9) words[id] = Math.round(v);
  const r = Array.isArray(c.r) && typeof c.r[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.r[0]) && typeof c.r[1] === 'number'
    ? [c.r[0], Math.max(0, Math.min(1, c.r[1]))] as [string, number] : undefined;
  return { progress, bars: decodeBars(c.b, h), words, ...(r ? { readiness: r } : {}) };
}

// ------------------------------------------------------------------ merging (never lowers anything)

const maxOpt = (a: number | undefined, b: number | undefined) => (a == null ? b : b == null ? a : Math.max(a, b));
function maxRec(a: Record<number, number> | undefined, b: Record<number, number> | undefined): Record<number, number> {
  const out: Record<number, number> = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) out[Number(k)] = Math.max(out[Number(k)] ?? 0, v);
  return out;
}
const unionDays = (a?: string[], b?: string[]) => {
  const d = [...new Set([...(a ?? []), ...(b ?? [])])].sort().slice(-5);
  return d.length ? d : undefined;
};
function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export function mergeSection(l: SectionProgress | undefined, r: SectionProgress | undefined): SectionProgress | undefined {
  if (!l || !r) return l ?? r;
  const level = Math.max(l.level ?? 0, r.level ?? 0);
  const slow = Math.max(l.slow ?? 0, r.slow ?? 0);
  return clean({
    level,
    // (kept only while above the in-tempo level)
    slow: slow > level ? slow : undefined,
    best: maxRec(l.best, r.best),
    bestScore: l.bestScore || r.bestScore ? maxRec(l.bestScore, r.bestScore) : undefined,
    attempts: Math.max(l.attempts ?? 0, r.attempts ?? 0),
    lastPracticed: maxOpt(l.lastPracticed, r.lastPracticed),
    lastPassed: maxOpt(l.lastPassed, r.lastPassed),
    offBookDays: unionDays(l.offBookDays, r.offBookDays),
  });
}

/**
 * The to-fix lists come from whichever phone sang the latest full run; a section that passed on its
 * own (at that level or above) after that run is off the list, as it would be on one phone.
 */
export function mergeFull(l: FullRunProgress | undefined, r: FullRunProgress | undefined,
  sections: Record<string, SectionProgress>): FullRunProgress | undefined {
  if (!l || !r) return l ?? r;
  const newer = (r.lastPracticed ?? 0) > (l.lastPracticed ?? 0) ? r : l;
  const out: FullRunProgress = clean({
    level: Math.max(l.level ?? 0, r.level ?? 0),
    best: maxRec(l.best, r.best),
    bestScore: l.bestScore || r.bestScore ? maxRec(l.bestScore, r.bestScore) : undefined,
    attempts: Math.max(l.attempts ?? 0, r.attempts ?? 0),
    lastPracticed: maxOpt(l.lastPracticed, r.lastPracticed),
    lastPassed: maxOpt(l.lastPassed, r.lastPassed),
    offBookDays: unionDays(l.offBookDays, r.offBookDays),
    // Stars are only ever earned: the union (absent on both = saved by an earlier version).
    clean: l.clean || r.clean ? [...new Set([...(l.clean ?? []), ...(r.clean ?? [])])].sort((a, b) => a - b) : undefined,
  });
  const runAt = newer.lastPracticed ?? 0;
  // Both phones know the same latest run: its lists only ever shrink (a section passed on its own),
  // so a section cleared on either phone stays cleared.
  const same = (l.lastPracticed ?? 0) === (r.lastPracticed ?? 0);
  const olderFix = newer === l ? r.toFix : l.toFix;
  const toFix: Record<number, string[]> = {};
  const locks: Record<number, boolean> = {};
  const done: { lvl: number; at: number }[] = [];
  for (const [k, ids] of Object.entries(newer.toFix ?? {})) {
    const lvl = Number(k);
    const left = ids.filter((id) => {
      if (same && !(olderFix?.[lvl] ?? []).includes(id)) return false;
      const sp = sections[id];
      return !(sp && sp.level >= lvl && (sp.lastPassed ?? 0) > runAt);
    });
    if (left.length) {
      toFix[lvl] = left;
      if (newer.toFixLocks?.[lvl]) locks[lvl] = true;
    } else if (ids.length && newer.toFixLocks?.[lvl]) done.push({ lvl, at: Math.max(...ids.map((id) => sections[id]?.lastPassed ?? 0)) });
  }
  if (Object.keys(toFix).length) out.toFix = toFix;
  if (Object.keys(locks).length) out.toFixLocks = locks;
  // A list (from a run that opened its level) whose last sections were fixed on the other phone:
  // the piece reaches its level, as it would on one phone (docs/LEVELS.md).
  for (const d of done.sort((a, b) => a.lvl - b.lvl)) { out.clean ??= []; reachLevel(out, d.lvl, d.at); }
  return out;
}

export function mergeProgress(l: PieceProgress | undefined, r: PieceProgress): PieceProgress {
  if (!l) return r;
  const sections: Record<string, SectionProgress> = {};
  for (const id of new Set([...Object.keys(l.sections ?? {}), ...Object.keys(r.sections ?? {})])) {
    const m = mergeSection(l.sections?.[id], r.sections?.[id]);
    if (m) sections[id] = m;
  }
  const out: PieceProgress = {
    pieceId: l.pieceId, partId: l.partId, sections,
    totalAttempts: Math.max(l.totalAttempts ?? 0, r.totalAttempts ?? 0),
    bestScore: Math.max(l.bestScore ?? 0, r.bestScore ?? 0),
  };
  const full = mergeFull(l.full, r.full, sections);
  if (full) out.full = full;
  return out;
}

/** Per bar, the more recently sung copy wins (the saved copy's bars all carry the time of its latest run). */
export function mergeBars(l: BarMap, r: BarMap): BarMap {
  const out: BarMap = { ...l };
  for (const [ms, rs] of Object.entries(r)) {
    const m = Number(ms);
    const ls = l[m];
    if (!ls) out[m] = rs;
    else if ((rs.at ?? 0) > (ls.at ?? 0)) out[m] = { ...rs, n: Math.max(ls.n ?? 0, rs.n ?? 0) };
  }
  return out;
}

/**
 * The settings: a phone that was never set up takes the saved copy's (its delay as "learned", since the
 * new phone and headphones may differ). A phone already set up keeps its own and only fills in what it
 * lacks (name, choir).
 */
const oneOf = <T extends string>(...xs: T[]) => (v: unknown): v is T => typeof v === 'string' && (xs as string[]).includes(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const inRange = (lo: number, hi: number) => (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const PROFILE_CHECKS: Record<(typeof PROFILE_KEYS)[number], (v: unknown) => boolean> = {
  name: (v) => typeof v === 'string' && v.length <= 80,
  voice: oneOf('S', 'A', 'T', 'B', 'other'),
  notation: oneOf('letter', 'fixed', 'movable', 'jianpu', 'pc'),
  strictness: oneOf('forgiving', 'standard', 'strict'),
  tuning: oneOf('equal', 'just'),
  latencyMs: inRange(0, 600),
  beat: oneOf('off', 'alone', 'always'),
  keepRecording: isBool,
  rangeLow: inRange(20, 110),
  rangeHigh: inRange(20, 110),
  onboarded: isBool,
  leaderboardOptIn: isBool,
  choirCode: (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(v),
  shareProgress: isBool,
  display: oneOf('highway', 'score'),
  displayChosen: isBool,
  scoreStaves: oneOf('mine', 'voices', 'all'),
  scorePages: isBool,
  boardHidden: isBool,
  presenceHidden: isBool,
  shareOptOut: isBool,
};

/** Only the settings the app knows, each of the right type (anything else in a saved copy is ignored). */
export function cleanProfile(remote: unknown): Partial<Profile> {
  const r: Record<string, unknown> = {};
  if (!isObj(remote)) return r;
  for (const k of PROFILE_KEYS) if (remote[k] !== undefined && PROFILE_CHECKS[k](remote[k])) r[k] = remote[k];
  return r as Partial<Profile>;
}

export function mergeProfile(local: Profile, remote: unknown, setUp: boolean): Profile {
  const r = cleanProfile(remote);
  if (!setUp) {
    const out: Profile = { ...local, ...r, displayMigrated: true, scoreDefaultMigrated: true };
    if (local.latencyMs > 0) { out.latencyMs = local.latencyMs; out.latencySource = local.latencySource; }
    else if (num(r.latencyMs) > 0) out.latencySource = 'learned';
    else out.latencyMs = 0;
    return out;
  }
  const out: Profile = { ...local };
  if (!local.name.trim() && typeof r.name === 'string') out.name = r.name;
  if (!local.choirCode && r.choirCode) {
    out.choirCode = r.choirCode;
    out.leaderboardOptIn = r.leaderboardOptIn ?? local.leaderboardOptIn;
    out.shareProgress = r.shareProgress ?? local.shareProgress;
  }
  // A privacy choice made on another phone holds here too (the stricter one wins).
  for (const k of ['boardHidden', 'presenceHidden', 'shareOptOut'] as const) if (r[k] === true) out[k] = true;
  if (out.shareOptOut) out.shareProgress = false;
  return out;
}

// ------------------------------------------------------------------ building and applying a snapshot

function splitKey(key: string, prefix: string): [string, string] | null {
  const rest = key.slice(prefix.length);
  const i = rest.lastIndexOf(':');
  return i > 0 ? [rest.slice(0, i), rest.slice(i + 1)] : null;
}

/** JSON with object keys sorted (the same content always gives the same text). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/**
 * Fingerprint of what a snapshot says about the singer's progress and settings: the same on two phones
 * that hold the same progress. Leaves out what belongs to one phone or isn't progress: when it was made,
 * the headphone delay, part choices, the built-in preset and the per-day readiness value.
 */
export function contentHash(d: unknown): string {
  if (!isObj(d)) return '';
  const { at: _at, parts: _parts, cp: _cp, ...rest } = d;
  const profile = isObj(rest.profile) ? { ...rest.profile } : {};
  delete profile.latencyMs;
  const p: Record<string, unknown> = {};
  if (isObj(rest.p)) for (const [k, pc] of Object.entries(rest.p)) p[k] = isObj(pc) ? { ...pc, r: undefined } : pc;
  return fnv(canonical({ ...rest, profile, p }));
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + s.length;
}

/**
 * This phone's progress in the compact format, a fingerprint of it (without the time it was made) and
 * its size as uploaded (UTF-8).
 */
export function buildSnapshot(now = Date.now()): { data: ProgressSnapshot; hash: string; bytes: number } {
  // Everything but the pieces first: the pieces fill what it leaves of TOTAL_BUDGET.
  const prof = loadProfile();
  const profile = cleanProfile(prof);
  const c = loadCycle();
  const cycle: Cycle = clean({
    ...c, name: c.name.slice(0, 80), pieceIds: c.pieceIds.slice(0, 100).map((id) => id.slice(0, 120)),
    focusPieceIds: c.focusPieceIds?.slice(0, 60).map((id) => id.slice(0, 120)), preset: c.preset?.slice(0, 120),
    wanted: c.wanted?.slice(0, 30).map((w) => clean({ title: w.title.slice(0, 160), composer: (w.composer ?? '').slice(0, 160), note: w.note?.slice(0, 160), focus: w.focus })),
  });
  const parts: Record<string, string> = {};
  for (const k of keysWithPrefix('sh:part:').slice(0, 100)) { const v = rawGet(k); if (v && v.length < 60 && k.length < 130) parts[k.slice(8)] = v; }
  const data: ProgressSnapshot = { v: SNAPSHOT_VERSION, at: 0, profile, cycle, p: {} };
  const cp = rawGet('sh:cyclePreset');
  if (cp && cp.length < 120) data.cp = cp;
  if (Object.keys(parts).length) data.parts = parts;
  const pts = pointsForSync();
  if (pts) data.pts = { k: pts.k.slice(0, 200), n: pts.n, since: pts.since };
  const days = practiceDays(120);
  if (days.length) data.days = days;
  // The envelope the server receives: {"baseRev":…,"data":{…,"at":…}}.
  const rest = utf8(JSON.stringify({ baseRev: 1e12, data: { ...data, at: now } }));
  const budget = TOTAL_BUDGET - rest;

  const ids = new Map<string, { pieceId: string; partId: string; prog?: PieceProgress }>();
  for (const p of allProgress()) if (p.pieceId && p.partId) ids.set(`${p.pieceId}|${p.partId}`, { pieceId: p.pieceId, partId: p.partId, prog: p });
  for (const k of keysWithPrefix('sh:words:')) {
    const s = splitKey(k, 'sh:words:');
    if (s && !ids.has(`${s[0]}|${s[1]}`)) ids.set(`${s[0]}|${s[1]}`, { pieceId: s[0], partId: s[1] });
  }
  const latest = (p?: PieceProgress) => Math.max(p?.full?.lastPracticed ?? 0, ...Object.values(p?.sections ?? {}).map((s) => s.lastPracticed ?? 0));
  const pieces = [...ids.entries()].filter(([k]) => k.length <= 240).sort((a, b) => latest(b[1].prog) - latest(a[1].prog)).slice(0, MAX_PIECES);
  // Most recent pieces first. Levels and dates come first: past the size budget, the older pieces
  // go without their bars, and past it without bars, the oldest pieces are left out.
  const enc = new Map<string, { slim: PieceC; full: PieceC }>();
  let size = 0;
  for (const [k, { pieceId, partId, prog }] of pieces) {
    const hist = readinessHistory(pieceId, partId);
    const last = hist[hist.length - 1];
    const make = (withBars: boolean) => encodePiece(prog, getBars(pieceId, partId), getWords(pieceId, partId), last ? [last.day, last.pct] : undefined, withBars);
    const full = make(true);
    if (!(Object.keys(full.s).length || full.f || full.b || full.w)) continue;
    const slim = full.b ? make(false) : full;
    const n = utf8(JSON.stringify({ [k]: slim })) - 1; // "key":{…} plus a comma
    if (size + n > budget) break;
    enc.set(k, { slim, full });
    size += n;
  }
  for (const [k, { slim, full }] of enc) {
    const extra = utf8(JSON.stringify(full)) - utf8(JSON.stringify(slim));
    if (full !== slim && size + extra <= budget) { data.p[k] = full; size += extra; } else data.p[k] = slim;
  }
  const hash = contentHash(data);
  data.at = now;
  return { data, hash, bytes: utf8(JSON.stringify(data)) };
}

export interface ApplyResult { pieces: number; profile: boolean; cycle: boolean }

const isStr = (v: unknown): v is string => typeof v === 'string';
const optional = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || ok(v);
const strings = (v: unknown) => Array.isArray(v) && v.every(isStr);

/** A saved programme of the right shape (buildSnapshot and the screens rely on it), else null. */
export function validCycle(v: unknown): Cycle | null {
  if (!isObj(v) || !isStr(v.name) || !strings(v.pieceIds)) return null;
  const ok = optional(v.focusPieceIds, strings)
    && [v.concertDate, v.rehearsalDate, v.rehearsalTime, v.preset].every((x) => optional(x, isStr))
    && optional(v.rehearsalWeekday, inRange(0, 6))
    && optional(v.wanted, (w) => Array.isArray(w) && w.every((x) => isObj(x) && isStr(x.title)
      && optional(x.composer, isStr) && optional(x.note, isStr) && optional(x.focus, isBool)));
  return ok ? (v as unknown as Cycle) : null;
}

/** Merge a saved copy into this phone (see the merge rules above). */
/**
 * `adoptSettings`: this phone already syncs with the account and the copy is newer (another phone of
 * the singer changed it): take its settings and programme too (not the headphone delay, which is this
 * phone's own), so two phones settle on the same copy instead of re-saving each other's differences.
 */
export function applySnapshot(d: unknown, opts: { adoptSettings?: boolean } = {}): ApplyResult {
  if (!isObj(d) || !isObj(d.p)) throw new Error('This saved progress is damaged.');
  const before = allProgress().length;
  const local = loadProfile();
  const setUp = local.onboarded || before > 0;
  let pieces = 0;
  for (const [k, pc] of Object.entries(d.p).slice(0, MAX_PIECES)) {
    const i = k.lastIndexOf('|');
    if (i <= 0) continue;
    const pieceId = k.slice(0, i), partId = k.slice(i + 1);
    const dec = decodePiece(pieceId, partId, pc);
    if (!dec) continue;
    // A copy from an older app: its level 1 was the slow step (never Level 1 in tempo).
    if (!(num(d.v) >= 2)) dec.progress = migrateToSteps(dec.progress);
    pieces++;
    writeJSON(progressKey(pieceId, partId), mergeProgress(getProgress(pieceId, partId), dec.progress), false);
    if (Object.keys(dec.bars).length) writeJSON(barsKey(pieceId, partId), mergeBars(getBars(pieceId, partId), dec.bars), false);
    if (Object.keys(dec.words).length) {
      const w = { ...getWords(pieceId, partId) };
      for (const [sid, stage] of Object.entries(dec.words)) {
        const cur = w[sid];
        if (!cur) w[sid] = { passed: stage, best: {}, at: dec.progress.full?.lastPracticed ?? 0 };
        else if (stage > cur.passed) w[sid] = { ...cur, passed: stage };
      }
      writeJSON(wordsKey(pieceId, partId), w, false);
    }
    if (dec.readiness && !readinessHistory(pieceId, partId).length) {
      snapshotReadiness(pieceId, partId, dec.readiness[1], new Date(`${dec.readiness[0]}T12:00:00`).getTime());
    }
  }
  if (isObj(d.parts)) for (const [id, part] of Object.entries(d.parts)) if (typeof part === 'string' && !rawGet(`sh:part:${id}`)) rawSet(`sh:part:${id}`, part);
  let cycle = false;
  const remoteCycle = validCycle(d.cycle);
  if ((!setUp || opts.adoptSettings) && remoteCycle) {
    saveCycle({ ...loadCycle(), ...remoteCycle });
    if (typeof d.cp === 'string') rawSet('sh:cyclePreset', d.cp);
    rawSet('sh:cycleSeeded', '1');
    cycle = true;
  }
  addSyncedDays(d.days);
  mergeSyncedPoints(d.pts);
  const profile = isObj(d.profile);
  if (opts.adoptSettings) {
    const here = loadProfile();
    const { latencyMs: _l, ...remote } = cleanProfile(d.profile);
    // A copy from a phone that was never set up (just logged in) holds that phone's defaults (voice,
    // no range, onboarded false): a set-up phone keeps its own settings and only fills in what it
    // lacks. A phone not set up takes the copy's. Setup is never undone, a name never blanked.
    const out: Profile = here.onboarded && remote.onboarded !== true ? mergeProfile(here, d.profile, true) : { ...here, ...remote };
    out.onboarded = here.onboarded || remote.onboarded === true;
    if (!out.name.trim() && here.name.trim()) out.name = here.name;
    // Not sharing is the singer's choice: a copy that only says "sharing" (from a phone that never saw
    // the switch, or an older app) doesn't switch it back on; only an explicit shareOptOut: false does.
    if (out.shareOptOut) out.shareProgress = false;
    saveProfile(out); // also tells the screens
  } else {
    saveProfile(mergeProfile(loadProfile(), d.profile, setUp)); // also tells the screens
  }
  return { pieces, profile, cycle };
}

// ------------------------------------------------------------------ this phone and the account

export interface SyncMeta {
  /** The account this phone syncs with (set once its saved progress was pulled and merged). */
  account?: string;
  /** The server's revision this phone last saw. */
  rev?: number;
  /** When the server last saved this phone's progress (ms). */
  savedAt?: number;
  /** Fingerprint of what was last saved. */
  hash?: string;
  bytes?: number;
  error?: string | null;
}
/** Logging in on a phone that has progress under another name: merge only when the singer says so. */
export interface MergeQuestion { account: string; accountName: string; here: string; pieces: number; updatedAt: number }

export function loadMeta(): SyncMeta {
  try {
    const m = JSON.parse(rawGet(META_KEY) ?? '{}');
    return isObj(m) ? (m as SyncMeta) : {};
  } catch {
    return {};
  }
}
function saveMeta(m: SyncMeta | null): void {
  if (m) rawSet(META_KEY, JSON.stringify(m));
  else rawRemove(META_KEY);
  // Screens showing the sync status redraw.
  writeJSON('sh:syncState', Date.now());
}
export function pendingQuestion(): MergeQuestion | null {
  try {
    const q = JSON.parse(rawGet(ASK_KEY) ?? 'null');
    const s = loadSession();
    return isObj(q) && s && q.account === s.account.id ? (q as unknown as MergeQuestion) : null;
  } catch {
    return null;
  }
}
function setQuestion(q: MergeQuestion | null): void {
  if (q) rawSet(ASK_KEY, JSON.stringify(q));
  else rawRemove(ASK_KEY);
  writeJSON('sh:syncState', Date.now());
}

/** The account this phone's progress goes with: a login to the singer's current choir. */
export function syncSession(p: Profile = loadProfile()): Session | null {
  return sessionFor(p.choirCode);
}
/**
 * On while logged in to the choir: members made their account for it (on unless they turn it off);
 * admins and section leads are asked first (staffSyncQuestion), and nothing goes up before they say yes.
 */
export function syncEnabled(p: Profile = loadProfile()): boolean {
  const s = syncSession(p);
  return !!s && (p.sync ?? s.account.role === 'member');
}
/** An admin or section lead logged in: keep their progress with the account? (asked once, before anything is saved) */
export function staffSyncQuestion(p: Profile = loadProfile()): boolean {
  const s = syncSession(p);
  return !!s && s.account.role !== 'member' && p.sync === undefined && !!apiBase();
}

// Called once this phone's progress is known to go with the logged-in account (pulled and merged,
// or the singer said "merge"): only then does shared progress move to the account.
const confirmedListeners = new Set<() => void>();
export function onAccountConfirmed(cb: () => void): () => void {
  confirmedListeners.add(cb);
  return () => { confirmedListeners.delete(cb); };
}
function confirmed(): void {
  confirmedListeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
}
/** This phone's progress goes with the logged-in account (no open merge question). */
export function accountConfirmed(): boolean {
  const s = syncSession();
  return !!s && loadMeta().account === s.account.id && !pendingQuestion();
}

export class SyncError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function api(method: 'GET' | 'PUT', s: Session, body?: unknown, opts: { meta?: boolean; keepalive?: boolean } = {}): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const base = apiBase();
  if (!base) throw new SyncError(0, 'Your account needs the online version of the app.');
  let res: Response;
  try {
    res = await fetch(`${base}/session/progress${opts.meta ? '?meta=1' : ''}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(opts.keepalive ? { keepalive: true } : {}),
    });
  } catch {
    throw new SyncError(0, 'No connection to the server.');
  }
  let json: Record<string, unknown> | null = null;
  try { json = await res.json(); } catch { /* not json */ }
  // The server ended this login (logged out elsewhere, account removed): forget it here too.
  if (res.status === 401 && loadSession()?.token === s.token) endSession(json?.reason as string | undefined, json?.error as string | undefined);
  return { status: res.status, json };
}
const errText = (r: { status: number; json: Record<string, unknown> | null }) =>
  (typeof r.json?.error === 'string' ? r.json.error : '') || `Server error (${r.status})`;

const nameKey = (x: string) => x.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * First sync of this phone with an account: pull what the account kept and merge it in, unless this
 * phone has progress that may be someone else's (another name, or another account before): then ask.
 */
export async function pullForAccount(s: Session, merge = false): Promise<'merged' | 'empty' | 'ask'> {
  const r = await api('GET', s);
  const empty = r.status === 200 && !!r.json && !r.json.data && !num(r.json.rev);
  if (!empty && (r.status !== 200 || !r.json || !isObj(r.json.data) || !isObj(r.json.data.p))) {
    throw new SyncError(r.status, r.status === 200 ? 'The progress saved with your account is damaged.' : errText(r));
  }
  // This phone's progress may be someone else's (another account before, another name, or no name):
  // ask before merging. An account just made on this phone that keeps no progress yet has nothing to
  // merge: this phone's progress simply becomes its own, unless it already went with another
  // singer's account. (An empty account made elsewhere still asks: someone may be logging in on a
  // friend's phone.)
  const meta = loadMeta();
  const here = loadProfile().name.trim();
  const sameName = !!here && nameKey(here) === nameKey(s.account.name);
  const mine = meta.account ? meta.account === s.account.id : sameName;
  const pieces = empty ? 0 : Object.keys((r.json!.data as Record<string, object>).p).length;
  const othersAccount = !!meta.account && meta.account !== s.account.id && !sameName;
  const madeHere = accountMadeHere() === s.account.id;
  if (!merge && !mine && allProgress().length > 0 && (pieces > 0 || othersAccount || (!madeHere && !sameName))) {
    setQuestion({ account: s.account.id, accountName: s.account.name, here: here || 'no name', pieces, updatedAt: num(r.json?.updatedAt) });
    return 'ask';
  }
  if (empty) {
    saveMeta({ account: s.account.id, rev: 0 });
  } else {
    applySnapshot(r.json!.data);
    saveMeta({ account: s.account.id, rev: num(r.json!.rev), savedAt: num(r.json!.updatedAt), hash: contentHash(r.json!.data) });
  }
  // Merged into this account: the phone goes by the account's name from now on.
  const p = loadProfile();
  if (p.name.trim() !== s.account.name) saveProfile({ ...p, name: s.account.name });
  setQuestion(null);
  confirmed();
  return empty ? 'empty' : 'merged';
}

/**
 * Save this phone's progress with the account if it changed (or `force`). The first time on this
 * phone, the account's saved progress is pulled first. `auto` = a background sync (the first one
 * shows a one-time notice). Never throws.
 */
export async function uploadProgress(force = false, auto = false): Promise<{ ok: boolean; skipped?: boolean; ask?: boolean; error?: string }> {
  const s = syncSession();
  if (!s || !apiBase()) return { ok: false, error: 'Log in to your choir first.' };
  if (!syncEnabled()) return { ok: false, error: 'Keeping your progress with your account is off.' };
  let meta = loadMeta();
  try {
    if (meta.account !== s.account.id) {
      if ((await pullForAccount(s)) === 'ask') return { ok: false, ask: true };
      meta = loadMeta();
    }
  } catch (e) {
    saveMeta({ ...meta, error: (e as Error).message });
    return { ok: false, error: (e as Error).message };
  }
  const switched = { ok: false, error: 'This phone logged in to another account meanwhile.' };
  try {
    // Another phone of this account may have saved since: pick that up first (a cheap revision check).
    const m = await api('GET', s, undefined, { meta: true });
    if (syncSession()?.token !== s.token) return switched;
    if (m.status === 200 && num(m.json?.rev) > (meta.rev ?? 0)) {
      const full = await api('GET', s);
      if (syncSession()?.token !== s.token) return switched;
      if (full.status === 200 && isObj(full.json?.data)) {
        applySnapshot(full.json!.data, { adoptSettings: true });
        // What the server holds now: only a phone that knows more uploads.
        meta = { ...meta, rev: num(full.json!.rev), hash: contentHash(full.json!.data), savedAt: num(full.json!.updatedAt, Date.now()), error: null };
        saveMeta(meta);
      }
    }
  } catch (e) {
    saveMeta({ ...meta, error: (e as Error).message });
    return { ok: false, error: (e as Error).message };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, hash, bytes } = buildSnapshot();
    // Upload only when this phone's merged copy differs from the server's (or, rarely, to keep it fresh).
    if (meta.hash === hash && meta.savedAt && Date.now() - meta.savedAt < REFRESH_MS && !meta.error) {
      return { ok: true, skipped: true };
    }
    // Nothing on the server until the singer passed something (no data for members who never practise).
    if (!meta.rev && !hasPassed()) return { ok: true, skipped: true };
    let r: Awaited<ReturnType<typeof api>>;
    try {
      r = await api('PUT', s, { ...(meta.rev != null ? { baseRev: meta.rev } : {}), data });
    } catch (e) {
      if (syncSession()?.token !== s.token) return switched;
      saveMeta({ ...loadMeta(), error: (e as Error).message });
      return { ok: false, error: (e as Error).message };
    }
    // Logged out or into another account while this save was on its way: drop the answer.
    if (syncSession()?.token !== s.token) return switched;
    const other = r.json?.progress as { rev?: number; data?: unknown } | undefined;
    if (r.status === 409 && other && attempt === 0) {
      try { applySnapshot(other.data, { adoptSettings: true }); } catch { /* a damaged copy is replaced by this phone's */ }
      meta = { ...meta, rev: num(other.rev), hash: contentHash(other.data) };
      continue;
    }
    if (r.status < 200 || r.status >= 300) {
      const error = errText(r);
      saveMeta({ ...meta, error });
      return { ok: false, error };
    }
    saveMeta({ account: s.account.id, rev: num(r.json?.rev), savedAt: num(r.json?.updatedAt, Date.now()), hash, bytes, error: null });
    return { ok: true };
  }
  return { ok: false, error: 'Your progress kept changing on another phone. Try again.' };
}

function hasPassed(): boolean {
  return allProgress().some((p) => (p.full?.level ?? 0) > 0
    || Object.values(p.sections ?? {}).some((sp) => (sp.level ?? 0) > 0 || (sp.slow ?? 0) > 0));
}

/** Closing or hiding the app: send unsaved progress right away (keepalive, so the page may go). */
export function flushProgress(): void {
  const s = syncSession();
  const meta = loadMeta();
  if (!s || !syncEnabled() || !apiBase() || meta.account !== s.account.id || pendingQuestion()) return;
  const { data, hash } = buildSnapshot();
  if (hash === meta.hash || (!meta.rev && !hasPassed())) return;
  void api('PUT', s, { ...(meta.rev != null ? { baseRev: meta.rev } : {}), data }, { keepalive: true }).then((r) => {
    if (r.status === 200 && syncSession()?.token === s.token) {
      saveMeta({ account: s.account.id, rev: num(r.json?.rev), savedAt: num(r.json?.updatedAt, Date.now()), hash, error: null });
    }
  }).catch(() => { /* the next start syncs */ });
}

/** The singer said yes: merge this phone's progress with the account's. */
export async function confirmMerge(): Promise<void> {
  const s = syncSession();
  if (!s) throw new SyncError(401, 'Log in first');
  await pullForAccount(s, true);
  void uploadProgress(true);
}

/** An admin or section lead answers whether to keep their progress with the account. */
export function answerStaffSync(yes: boolean): void {
  saveProfile({ ...loadProfile(), sync: yes });
  if (yes) syncProgressSoon();
}

// ------------------------------------------------------------------ when to sync

/** Run `fn` soon, but at most once per `gapMs`: calls in between collapse into one trailing run. */
export function throttle(fn: () => unknown, gapMs: number, clock: () => number = Date.now): () => void {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) return;
    const wait = Math.max(0, last + gapMs - clock());
    timer = setTimeout(() => {
      timer = null;
      last = clock();
      void fn();
    }, wait);
  };
}

const syncSoon = throttle(() => (syncEnabled() && apiBase() ? uploadProgress(false, true) : null), MIN_GAP_MS);

/** After a run, on start, when the app comes back and after logging in: sync if on and something changed. */
export function syncProgressSoon(): void {
  if (syncEnabled() && apiBase()) syncSoon();
}

/** Once, after the first level a choir singer passes without an account: suggest making one (on Results). */
export function suggestAccount(passed: boolean): boolean {
  const p = loadProfile();
  if (!passed || !p.choirCode || syncSession(p) || !apiBase() || readJSON(TIP_KEY, null) != null) return false;
  writeJSON(TIP_KEY, 'show', false);
  return true;
}
export const accountTipPending = () => readJSON(TIP_KEY, null) === 'show';
export function dismissAccountTip(): void { writeJSON(TIP_KEY, 'seen', false); }

// A login on this phone (or a logout) starts or stops syncing.
let lastAccount: string | null = null;
if (typeof window !== 'undefined') {
  onSessionChange(() => {
    const s = loadSession();
    const id = s?.account.id ?? null;
    if (id !== lastAccount) {
      lastAccount = id;
      if (!s) setQuestion(null);
      else syncProgressSoon();
    }
  });
}
