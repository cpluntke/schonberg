// A compact server copy of the singer's progress, so a lost or new phone can get it back.
//
// What goes up (aim: well under 8 KB for a singer with a handful of pieces): the settings, the
// programme, and per piece + part the section levels, best results, review dates and off-book days,
// the full-run record with its to-fix lists, a rounded per-bar summary, the words stage and the latest
// readiness value. Never the attempt log, the readiness history or recordings.
//
// Identity: a random backup key made on this phone (src/progress/backupCode.ts), separate from the
// member token used for shared progress. The server stores only a hash of it. The restore code shown
// in Settings carries the key to another phone.
//
// Sync: after runs (at most once a minute) and when the app starts or comes back, if something
// changed. Each write names the revision it builds on; when another phone with the same key wrote in
// between, the server says so (409) and this phone merges that copy in first. Merging never lowers
// anything: higher levels and best results win, newer dates win.

import {
  allProgress, getProgress, keysWithPrefix, loadCycle, loadProfile, progressKey, rawGet, rawRemove, rawSet,
  readinessHistory, readJSON, saveCycle, saveProfile, snapshotReadiness, writeJSON,
  type Cycle, type FullRunProgress, type PieceProgress, type Profile, type SectionProgress,
} from './store';
import { barsKey, getBars, type BarMap, type BarStat } from './bars';
import { getWords, wordsKey, type WordsProgress } from './words';
import { apiBase } from './choir';
import { decodeRestoreCode, isBackupKey, newBackupKey } from './backupCode';

export const BACKUP_VERSION = 1;
export const MAX_PIECES = 60;
export const MAX_SECTIONS = 120;
export const MAX_BARS = 400;
/** Bytes for the pieces (the server takes 32 KB in all). */
export const BUDGET = 24 * 1024;
/** Uploaded at least this often even without changes, so the server never sees the backup as abandoned. */
const REFRESH_MS = 30 * 86_400_000;
export const MIN_GAP_MS = 60_000;

// Kept outside the `sh:` keys, so the key never ends up in a backup file someone shares.
const KEY_KEY = 'schonberg:backupKey';
const META_KEY = 'schonberg:backupMeta';
const TIP_KEY = 'sh:backupTip';

// ------------------------------------------------------------------ the compact format

// Times are whole hours before the piece's latest time `h` (hours since 1970), plus one: 1 = that
// hour, 0 = never. Rounded down, so a backup never looks newer than the phone it came from.

/** A section: level, last passed, last practised, attempts, best % per level 1…5, off-book days. */
export type SectionC = [number, number, number, number, number[], string[]?];
export interface FullC { l: number; b: number[]; a: number; lp: number; pr: number; ob?: string[]; fx?: Record<string, string[]>; fk?: number[] }
/**
 * Bars m, m+1, … one character each (0…63 → 0…1, '.' = not sung, `!n!` = n bars not sung): recent
 * accuracy, from memory, off book; `at` = when last sung.
 */
export interface BarsC { m: number; e: string; k?: string; o?: string; at: number }
export interface PieceC {
  /** The piece's latest time, in hours since 1970. */
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
export interface BackupData {
  v: number;
  /** When this copy was made (ms). */
  at: number;
  profile: Partial<Profile>;
  cycle?: Cycle;
  /** The built-in programme preset this phone applied. */
  cp?: string;
  /** Which part the singer sings in each piece, where they chose one. */
  parts?: Record<string, string>;
  /** The member token that guards the progress shared with the choir (so a new phone can keep sharing under the same name). */
  mt?: string;
  /** `pieceId|partId` → progress. */
  p: Record<string, PieceC>;
}

const PROFILE_KEYS = [
  'name', 'voice', 'notation', 'strictness', 'tuning', 'latencyMs', 'beat', 'keepRecording', 'rangeLow', 'rangeHigh',
  'onboarded', 'leaderboardOptIn', 'choirCode', 'shareProgress', 'display', 'displayChosen', 'scoreStaves',
] as const;

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const HOUR = 3_600_000;
const hours = (ms: number | undefined) => (ms ? Math.floor(ms / HOUR) : 0);
/** A time as hours before `h`, plus one (0 = never). */
const ago = (ms: number | undefined, h: number) => (ms ? Math.max(1, h - hours(ms) + 1) : 0);
const fromAgo = (a: number, h: number) => (a > 0 && h > 0 ? (h - a + 1) * HOUR : undefined);
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
  if (sp.offBookDays?.length) out.push(sp.offBookDays.slice(-5));
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
  return sp;
}

function encodeFull(f: FullRunProgress, h: number): FullC {
  const out: FullC = { l: f.level ?? 0, b: bestArr(f.best), a: f.attempts ?? 0, lp: ago(f.lastPassed, h), pr: ago(f.lastPracticed, h) };
  if (f.offBookDays?.length) out.ob = f.offBookDays.slice(-5);
  if (f.toFix && Object.keys(f.toFix).length) out.fx = Object.fromEntries(Object.entries(f.toFix).map(([k, ids]) => [k, ids.slice(0, MAX_SECTIONS)]));
  const locks = Object.keys(f.toFixLocks ?? {}).filter((k) => f.toFixLocks![Number(k)]).map(Number);
  if (locks.length) out.fk = locks;
  return out;
}
function decodeFull(c: unknown, h: number): FullRunProgress | undefined {
  if (!isObj(c)) return undefined;
  const f: FullRunProgress = { level: Math.max(0, Math.min(5, Math.round(num(c.l)))), best: bestRec(c.b), attempts: Math.max(0, Math.round(num(c.a))) };
  const lp = fromAgo(num(c.lp), h), pr = fromAgo(num(c.pr), h);
  if (lp) f.lastPassed = lp;
  if (pr) f.lastPracticed = pr;
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
  const h = hours(Math.max(0, ...times.map((t) => num(t))));
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
  return clean({
    level: Math.max(l.level ?? 0, r.level ?? 0),
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
  });
  const runAt = newer.lastPracticed ?? 0;
  const toFix: Record<number, string[]> = {};
  const locks: Record<number, boolean> = {};
  for (const [k, ids] of Object.entries(newer.toFix ?? {})) {
    const lvl = Number(k);
    const left = ids.filter((id) => { const sp = sections[id]; return !(sp && sp.level >= lvl && (sp.lastPassed ?? 0) > runAt); });
    if (left.length) {
      toFix[lvl] = left;
      if (newer.toFixLocks?.[lvl]) locks[lvl] = true;
    }
  }
  if (Object.keys(toFix).length) out.toFix = toFix;
  if (Object.keys(locks).length) out.toFixLocks = locks;
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

/** Per bar, the more recently sung copy wins (the backup's bars all carry the time of its latest run). */
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
 * The settings: a phone that was never set up takes the backup's (its delay as "learned", since the
 * new phone and headphones may differ). A phone already set up keeps its own and only fills in what it
 * lacks (name, choir).
 */
export function mergeProfile(local: Profile, remote: Partial<Profile>, setUp: boolean): Profile {
  const r: Partial<Profile> = {};
  for (const k of PROFILE_KEYS) if (remote[k] !== undefined) (r as Record<string, unknown>)[k] = remote[k];
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
  return out;
}

// ------------------------------------------------------------------ building and applying a backup

function splitKey(key: string, prefix: string): [string, string] | null {
  const rest = key.slice(prefix.length);
  const i = rest.lastIndexOf(':');
  return i > 0 ? [rest.slice(0, i), rest.slice(i + 1)] : null;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + s.length;
}

/** This phone's progress in the compact format, and a fingerprint of it (without the time it was made). */
export function buildBackup(now = Date.now()): { data: BackupData; hash: string; bytes: number } {
  const ids = new Map<string, { pieceId: string; partId: string; prog?: PieceProgress }>();
  for (const p of allProgress()) if (p.pieceId && p.partId) ids.set(`${p.pieceId}|${p.partId}`, { pieceId: p.pieceId, partId: p.partId, prog: p });
  for (const k of keysWithPrefix('sh:words:')) {
    const s = splitKey(k, 'sh:words:');
    if (s && !ids.has(`${s[0]}|${s[1]}`)) ids.set(`${s[0]}|${s[1]}`, { pieceId: s[0], partId: s[1] });
  }
  const latest = (p?: PieceProgress) => Math.max(p?.full?.lastPracticed ?? 0, ...Object.values(p?.sections ?? {}).map((s) => s.lastPracticed ?? 0));
  const pieces = [...ids.entries()].sort((a, b) => latest(b[1].prog) - latest(a[1].prog)).slice(0, MAX_PIECES);
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
    const n = JSON.stringify(slim).length + k.length + 4;
    if (size + n > BUDGET) break;
    enc.set(k, { slim, full });
    size += n;
  }
  const p: Record<string, PieceC> = {};
  for (const [k, { slim, full }] of enc) {
    const extra = JSON.stringify(full).length - JSON.stringify(slim).length;
    if (full !== slim && size + extra <= BUDGET) { p[k] = full; size += extra; } else p[k] = slim;
  }
  const prof = loadProfile();
  const profile: Partial<Profile> = {};
  for (const k of PROFILE_KEYS) if (prof[k] !== undefined && prof[k] !== '') (profile as Record<string, unknown>)[k] = prof[k];
  const c = loadCycle();
  const cycle: Cycle = clean({
    ...c, pieceIds: c.pieceIds.slice(0, 100), focusPieceIds: c.focusPieceIds?.slice(0, 60),
    wanted: c.wanted?.slice(0, 30).map((w) => clean({ title: w.title.slice(0, 160), composer: (w.composer ?? '').slice(0, 160), note: w.note?.slice(0, 160), focus: w.focus })),
  });
  const parts: Record<string, string> = {};
  for (const k of keysWithPrefix('sh:part:').slice(0, 100)) { const v = rawGet(k); if (v && v.length < 60) parts[k.slice(8)] = v; }
  const data: BackupData = { v: BACKUP_VERSION, at: 0, profile, cycle, p };
  const cp = rawGet('sh:cyclePreset');
  if (cp) data.cp = cp;
  if (Object.keys(parts).length) data.parts = parts;
  const mt = rawGet('sh:memberToken');
  if (mt && mt.length >= 16 && mt.length <= 128 && !mt.startsWith('no-storage')) data.mt = mt;
  const hash = fnv(JSON.stringify(data));
  data.at = now;
  return { data, hash, bytes: JSON.stringify(data).length };
}

export interface ApplyResult { pieces: number; profile: boolean; cycle: boolean }

/** Merge a backup into this phone (see the merge rules above). */
export function applyBackup(d: unknown): ApplyResult {
  if (!isObj(d) || !isObj(d.p)) throw new Error('This backup is damaged.');
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
  if (typeof d.mt === 'string' && d.mt.length >= 16 && d.mt.length <= 128 && !local.shareProgress) rawSet('sh:memberToken', d.mt);
  let cycle = false;
  if (!setUp && isObj(d.cycle) && Array.isArray(d.cycle.pieceIds)) {
    saveCycle({ ...loadCycle(), ...(d.cycle as unknown as Cycle) });
    if (typeof d.cp === 'string') rawSet('sh:cyclePreset', d.cp);
    rawSet('sh:cycleSeeded', '1');
    cycle = true;
  }
  const profile = isObj(d.profile);
  saveProfile(mergeProfile(loadProfile(), profile ? (d.profile as Partial<Profile>) : {}, setUp)); // also tells the screens
  return { pieces, profile, cycle };
}

// ------------------------------------------------------------------ this phone's key and sync state

export interface BackupMeta {
  /** The server's revision this phone last saw. */
  rev?: number;
  /** When the server last stored this phone's backup (ms). */
  savedAt?: number;
  /** Fingerprint of what was last uploaded. */
  hash?: string;
  bytes?: number;
  error?: string | null;
}

export function backupKey(create = false): string | null {
  const k = rawGet(KEY_KEY);
  if (isBackupKey(k)) return k;
  if (!create) return null;
  const n = newBackupKey();
  rawSet(KEY_KEY, n);
  return n;
}
export function loadMeta(): BackupMeta {
  try {
    const m = JSON.parse(rawGet(META_KEY) ?? '{}');
    return isObj(m) ? (m as BackupMeta) : {};
  } catch {
    return {};
  }
}
function saveMeta(m: BackupMeta | null): void {
  if (m) rawSet(META_KEY, JSON.stringify(m));
  else rawRemove(META_KEY);
  // Screens showing the backup status redraw.
  writeJSON('sh:backupState', Date.now());
}

/** On for singers in a choir unless they turned it off; off for others until they turn it on. */
export function backupEnabled(p: Profile = loadProfile()): boolean {
  return p.backup ?? !!p.choirCode;
}

export class BackupError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function api(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const base = apiBase();
  if (!base) throw new BackupError(0, 'Backups need the online version of the app.');
  let res: Response;
  try {
    res = await fetch(`${base}/backup`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new BackupError(0, 'No connection to the server.');
  }
  let json: Record<string, unknown> | null = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}
const errText = (r: { status: number; json: Record<string, unknown> | null }) =>
  (typeof r.json?.error === 'string' ? r.json.error : '') || `Server error (${r.status})`;

/**
 * Send this phone's progress to the server if it changed (or `force`). When another phone with the
 * same key wrote meanwhile, its copy is merged in first. Never throws.
 */
export async function uploadBackup(force = false): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (!apiBase()) return { ok: false, error: 'Backups need the online version of the app.' };
  const key = backupKey(true)!;
  let meta = loadMeta();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, hash, bytes } = buildBackup();
    if (!force && attempt === 0 && meta.hash === hash && meta.savedAt && Date.now() - meta.savedAt < REFRESH_MS && !meta.error) {
      return { ok: true, skipped: true };
    }
    let r: Awaited<ReturnType<typeof api>>;
    try {
      r = await api('PUT', key, { ...(meta.rev != null ? { baseRev: meta.rev } : {}), data });
    } catch (e) {
      saveMeta({ ...meta, error: (e as Error).message });
      return { ok: false, error: (e as Error).message };
    }
    const other = r.json?.backup as { rev?: number; data?: unknown } | undefined;
    if (r.status === 409 && other && attempt === 0) {
      try { applyBackup(other.data); } catch { /* a damaged copy is replaced by this phone's */ }
      meta = { ...meta, rev: num(other.rev) };
      continue;
    }
    if (r.status < 200 || r.status >= 300) {
      const error = errText(r);
      saveMeta({ ...meta, error });
      return { ok: false, error };
    }
    saveMeta({ rev: num(r.json?.rev), savedAt: num(r.json?.updatedAt, Date.now()), hash, bytes, error: null });
    return { ok: true };
  }
  return { ok: false, error: 'The backup kept changing on another phone. Try again.' };
}

/** Pull the backup a restore code points to and merge it into this phone; this phone then uses that backup. */
export async function restoreFromCode(code: string): Promise<ApplyResult> {
  const dec = decodeRestoreCode(code);
  if (!dec.ok) throw new BackupError(400, dec.error);
  const r = await api('GET', dec.key);
  if (r.status === 404) throw new BackupError(404, 'No backup found for this code. Check it, or back up again on your other phone.');
  if (r.status !== 200 || !r.json) throw new BackupError(r.status, errText(r));
  const res = applyBackup(r.json.data);
  const old = backupKey();
  // This phone's own backup is merged in above and goes up under the restored key from now on.
  if (old && old !== dec.key) void api('DELETE', old).catch(() => {});
  rawSet(KEY_KEY, dec.key);
  saveMeta({ rev: num(r.json.rev), savedAt: num(r.json.updatedAt) });
  saveProfile({ ...loadProfile(), backup: true });
  void uploadBackup(true);
  return res;
}

/** Delete the server copy and stop backing up (the progress on this phone stays). */
export async function deleteBackup(): Promise<void> {
  const key = backupKey();
  saveProfile({ ...loadProfile(), backup: false });
  if (!key) { saveMeta(null); return; }
  const r = await api('DELETE', key);
  if (r.status !== 200) throw new BackupError(r.status, errText(r));
  saveMeta(null);
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

const syncSoon = throttle(() => (backupEnabled() && apiBase() ? uploadBackup() : null), MIN_GAP_MS);

/** After a run, on start and when the app comes back: back up if on and something changed. */
export function backupSoon(): void {
  if (backupEnabled() && apiBase()) syncSoon();
}

/** Once, after the first level a singer passes without a choir: suggest turning backups on. */
export function shouldSuggestBackup(passed: boolean): boolean {
  const p = loadProfile();
  if (!passed || p.backup !== undefined || p.choirCode || !apiBase() || readJSON(TIP_KEY, false)) return false;
  writeJSON(TIP_KEY, true, false);
  return true;
}
