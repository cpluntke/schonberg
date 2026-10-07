// Your choir on the server: its programme (cycle) and its own scores, plus the calls for admins and
// section leads (personal accounts, created through invite links) and the super admin. Members only
// need the choir code; the programme and scores are synced to the phone (and work offline afterwards).

import { loadCycle, loadProfile, rawGet, rawRemove, rawSet, readJSON, saveCycle, saveProfile, writeJSON, type Cycle } from './store';
import type { BarMap } from './bars';
import type { SharedRange } from './insights';

export interface ChoirPiece {
  id: string; title: string; composer: string; filename: string; uploadedAt: number; size: number;
  /** Added from the choir library: the piece's library id (also its id on the phone). */
  libraryId?: string;
  /** Edition / licence credit (library pieces). */
  credit?: string;
  /** Key marks set by an admin: where the singers' do moves (see music/keymarks.ts). */
  keys?: { bar: number; fifths?: number; mode?: 'major' | 'minor' }[];
}
/** A choir's programme for a stretch of time: from `start` (YYYY-MM-DD) to `end` or the next cycle's start, whichever comes first. */
export type ChoirProgramme = Omit<Cycle, 'preset'> & { name: string };
export interface ChoirCycle extends ChoirProgramme {
  id: string; start: string; end?: string;
  /** When it was made (ms): of two starting the same day, the later made runs. Absent on older cycles. */
  createdAt?: number;
  /** Its own last change (ms): members' phones apply the running cycle again only when this changes. */
  updatedAt?: number;
}
export interface ChoirInfo {
  code: string;
  name: string;
  /** The cycle running today by the server's clock (UTC); apps choose from `cycles` by their own date. */
  cycle: ChoirProgramme | null;
  /** The running cycle and those to come (never a past one). Absent from servers before cycles. */
  cycles?: ChoirCycle[];
  pieces: ChoirPiece[];
  updatedAt: number;
  /** When an admin last published the programme (score uploads don't change it). */
  cycleUpdatedAt?: number;
  /** Voice parts that have a section lead. */
  leads: string[];
  /** The first version's shared admin / section-lead passwords can still become personal accounts. */
  legacyLogin?: boolean;
  /** Singers may make their own member account (an admin can close this). */
  signupsOpen?: boolean;
}

/** Cycles in order: by start, then by when they were made (older cycles without `createdAt` first). */
export const byStart = (a: ChoirCycle, b: ChoirCycle): number =>
  (a.start < b.start ? -1 : a.start > b.start ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0));
/**
 * The choir's cycle running on `today` (this phone's date): the latest started one, unless it has
 * ended (then none: an earlier cycle never comes back). The same rule as the server's.
 */
export function choirCycleNow(info: Pick<ChoirInfo, 'cycle' | 'cycles'> | null, today = localDay()): (ChoirProgramme & { id?: string; updatedAt?: number }) | null {
  if (!info) return null;
  if (!Array.isArray(info.cycles)) return info.cycle;
  const started = info.cycles.filter((c) => c.start <= today).sort(byStart);
  const cur = started[started.length - 1];
  return cur && !(cur.end && cur.end < today) ? cur : null;
}
/** The next cycle to start after `today`, if any (of two starting the same day, the one that will run). */
export function choirCycleNext(info: Pick<ChoirInfo, 'cycles'> | null, today = localDay()): ChoirCycle | null {
  const later = (info?.cycles ?? []).filter((c) => c.start > today).sort(byStart);
  return later.filter((c) => c.start === later[0]?.start).pop() ?? null;
}
function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class ChoirApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** API base (same origin when served from the app's own server). */
export function apiBase(): string | null {
  try {
    // Written as `import.meta.env` so Vite (and Vitest's stubEnv) can see it.
    const env = import.meta.env as Record<string, string | undefined> | undefined;
    // Only builds served next to the choir server set this (the plain leaderboard server has no choirs).
    const v = env?.VITE_CHOIR_URL;
    return v && v.trim() ? v.trim().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

/** Local id of a choir score (stable across phones). */
export const choirPieceId = (code: string, serverId: string) => `choir-${code}-${serverId}`;
const LIBRARY_ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
/**
 * Local id of one of the choir's scores: a piece from the choir library keeps its library id (the id
 * it had when it was built in, so earlier progress on it comes back); an uploaded score gets choirPieceId.
 */
export const localPieceId = (code: string, p: Pick<ChoirPiece, 'id' | 'libraryId'>) =>
  p.libraryId && LIBRARY_ID.test(p.libraryId) ? p.libraryId : choirPieceId(code, p.id);

/** Random id of this phone, so only this phone can update or withdraw the progress it shares. */
export function memberToken(): string {
  try {
    let t = localStorage.getItem('sh:memberToken');
    if (!t || t.length < 16) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      t = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('sh:memberToken', t);
    }
    return t;
  } catch {
    return 'no-storage-' + Math.random().toString(16).slice(2).padEnd(16, '0');
  }
}

/**
 * How a request proves who sends it: a session (an account's, or the super admin's: both are bearer
 * tokens), or the super-admin password itself (no longer sent by this app, kept for the API).
 */
export type Auth = { bearer: string } | { superAdmin: string };

async function call<T>(path: string, init: RequestInit & { auth?: Auth; member?: boolean } = {}): Promise<T> {
  const base = apiBase();
  if (!base) throw new ChoirApiError(0, 'Choirs need the online version of the app.');
  const { auth, member, ...rest } = init;
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string> | undefined) };
  if (auth && 'bearer' in auth) headers.Authorization = `Bearer ${auth.bearer}`;
  if (auth && 'superAdmin' in auth) headers['X-Super-Admin'] = auth.superAdmin;
  if (member) headers['X-Member-Token'] = memberToken();
  let res: Response;
  try {
    res = await fetch(base + path, { ...rest, headers });
  } catch {
    throw new ChoirApiError(0, 'No connection to the server.');
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    // The server ended this session (expired, logged out elsewhere, account removed): forget it here too.
    if (res.status === 401 && auth && 'bearer' in auth && loadSession()?.token === auth.bearer) {
      const b = body as { reason?: string; error?: string } | null;
      endSession(b?.reason, b?.error);
    }
    // The super-admin login ended (expired, logged out, the password was changed): ask for the password again.
    if (res.status === 401 && auth && 'bearer' in auth && loadSuperSession()?.token === auth.bearer) endSuperSession();
    throw new ChoirApiError(res.status, (body as { error?: string } | null)?.error ?? `Server error (${res.status})`);
  }
  return body as T;
}

const enc = encodeURIComponent;
const json = (o: unknown): RequestInit => ({ body: JSON.stringify(o), headers: { 'Content-Type': 'application/json' } });

// ------------------------------------------------------------------ members

export function fetchChoir(code: string): Promise<ChoirInfo> {
  return call<ChoirInfo>(`/choirs/${enc(code.toLowerCase())}`);
}

const CACHE = 'sh:choir';
export function cachedChoir(): ChoirInfo | null {
  return readJSON<ChoirInfo | null>(CACHE, null, (v) => typeof v === 'object' && v !== null && 'code' in (v as object));
}

/** Join a choir: remember the code (also used for the leaderboard). */
export async function joinChoir(code: string): Promise<ChoirInfo> {
  const info = await fetchChoir(code);
  const p = loadProfile();
  saveProfile({ ...p, choirCode: info.code, leaderboardOptIn: true, shareProgress: true });
  rawRemove(SHARE_OFF_KEY);
  writeJSON(CACHE, info);
  return info;
}

/**
 * Sharing progress with the section lead is part of being in a choir, like the leaderboard (no
 * opt-out). Once per phone: a member who joined while it was optional starts sharing. Later, only a
 * removed or deleted account turns it off (endSession), and that stays.
 */
const SHARE_OFF_KEY = 'schonberg:shareOff';

export function ensureChoirSharing(): void {
  if (rawGet('schonberg:shareMandatory')) return;
  const p = loadProfile();
  // Switched on silently only where it is safe: a member logged in to the choir (so not removed or
  // deleted). Everyone else from before this version (switched off, never chose, or an account removed or
  // deleted then, which the phone can't tell apart) is asked: Home and Settings offer "Start sharing".
  // A login or rejoining switches it on too.
  const ended = rawGet(SHARE_OFF_KEY) || lastLogout()?.reason === 'removed';
  const safe = !!sessionFor(p.choirCode);
  if (p.choirCode && !p.shareProgress && !ended && safe) saveProfile({ ...p, shareProgress: true });
  rawSet('schonberg:shareMandatory', '1');
}
/** A choir member who isn't sharing (switched off before sharing became part of the choir): offer to start. */
export const sharingNeedsOk = (): boolean => {
  const p = loadProfile();
  return !!p.choirCode && !p.shareProgress && !rawGet(SHARE_OFF_KEY);
};
/** The member's own "Start sharing". */
export function startSharing(): void {
  const p = loadProfile();
  if (p.choirCode) saveProfile({ ...p, shareProgress: true });
}
/** Sharing was ended by the choir removing this phone's account, or by deleting it (cleared by a new login or leaving). */
export const sharingEnded = (): boolean => !!rawGet(SHARE_OFF_KEY);

export function leaveChoir(): void {
  const p = loadProfile();
  if (p.choirCode && p.shareProgress && p.name.trim()) withdrawProgress(p.choirCode, p.name.trim()).catch(() => {});
  saveProfile({ ...p, choirCode: undefined, shareProgress: false });
  rawRemove(SHARE_OFF_KEY);
  writeJSON(CACHE, null);
  try { localStorage.removeItem('sh:choirApplied'); } catch { /* ignore */ }
  // An admin's or section lead's login belongs to that choir.
  if (p.choirCode && loadSession()?.code === p.choirCode) void logout();
  // The programme stays as the singer's own (no longer tied to the choir).
  const c = loadCycle();
  if (c.preset?.startsWith('choir:')) saveCycle({ ...c, preset: undefined });
}

/**
 * Bring the phone up to date with the choir: download new scores (via `importFile`) and apply the
 * programme when the choir changed it. Returns what happened. Never throws on a bad connection.
 */
export async function syncChoir(importFile: (name: string, data: ArrayBuffer, meta: { id: string; title: string; composer: string; credit?: string; choir: string }) => Promise<void>,
  hasPiece: (id: string) => boolean,
  /** Pieces the singer imported on this phone: they stay in the cycle when the choir's programme arrives. */
  isOwnPiece: (id: string) => boolean = () => false,
  /** Pieces stored by an older importer: downloaded and imported again (not counted as new). */
  isOutdated: (id: string) => boolean = () => false): Promise<{ ok: boolean; newPieces: number; programme: boolean; error?: string }> {
  const code = loadProfile().choirCode;
  if (!code || !apiBase()) return { ok: false, newPieces: 0, programme: false };
  let info: ChoirInfo;
  try {
    info = await fetchChoir(code);
  } catch (e) {
    return { ok: false, newPieces: 0, programme: false, error: (e as Error).message };
  }
  writeJSON(CACHE, info);
  let newPieces = 0;
  // Scores that downloaded but couldn't be read: not downloaded again on every start, but retried
  // after a day (the app may have learned to read them). A failed download (offline, the page
  // reloading mid-way) is never remembered: the next sync simply tries again.
  const RETRY_MS = 86_400_000;
  let failed: { id: string; at: number }[] = [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem('sh:choirBadScores') ?? '[]');
    // (older versions stored bare ids, also after a mere network error: forget those)
    failed = Array.isArray(raw) ? raw.filter((x): x is { id: string; at: number } => !!x && typeof x.id === 'string' && typeof x.at === 'number') : [];
  } catch { /* ignore */ }
  failed = failed.filter((f) => Date.now() - f.at < RETRY_MS);
  for (const p of info.pieces) {
    const id = localPieceId(info.code, p);
    const had = hasPiece(id);
    if ((had && !isOutdated(id)) || failed.some((f) => f.id === id)) continue;
    let data: ArrayBuffer;
    try {
      const res = await fetch(`${apiBase()}/choirs/${enc(info.code)}/pieces/${enc(p.id)}/file`);
      if (!res.ok) continue;
      data = await res.arrayBuffer();
    } catch (e) {
      console.warn('choir score download', p.id, e);
      continue;
    }
    try {
      await importFile(p.filename || `${p.id}.musicxml`, data, { id, title: p.title, composer: p.composer, credit: p.credit, choir: info.code });
      if (!had) newPieces++;
    } catch (e) {
      console.warn('choir score', p.id, e);
      failed = [...failed, { id, at: Date.now() }].slice(-50);
    }
  }
  try { localStorage.setItem('sh:choirBadScores', JSON.stringify(failed)); } catch { /* ignore */ }
  // The programme: applied when another cycle starts running (by this phone's date) or an admin
  // changes the running one (local tweaks last until then). Changes to other cycles don't count.
  let programme = false;
  const now = choirCycleNow(info);
  const dated = Array.isArray(info.cycles);
  const stamp = dated ? `${info.code}:${now?.id ?? 'none'}${now ? `:${now.updatedAt ?? 0}` : ''}` : `${info.code}:${info.cycleUpdatedAt ?? info.updatedAt}`;
  let applied: string | null = null;
  try { applied = localStorage.getItem('sh:choirApplied'); } catch { /* ignore */ }
  // (a phone that applied the programme before cycles had dates, when the choir last changed it: it
  // has the running cycle already if that one had started by then)
  // (its stamp was the choir's change time, which is the running cycle's own change time while
  // nobody has edited that cycle since)
  if (now && dated && now.updatedAt && applied === `${info.code}:${now.updatedAt}`) applied = stamp;
  // (joined from another choir: its programme isn't this choir's)
  const otherChoir = !!loadCycle().preset?.startsWith('choir:') && loadCycle().preset !== `choir:${info.code}`;
  if (!now && applied !== stamp && ((dated && applied?.startsWith(`${info.code}:`)) || otherChoir)) {
    // The cycle ended and the next hasn't started (or this choir has none): its programme goes (the
    // singer's own pieces stay).
    const own = loadCycle().pieceIds.filter((id) => isOwnPiece(id));
    saveCycle({ ...loadCycle(), name: '', pieceIds: own, focusPieceIds: [], rehearsalWeekday: undefined, rehearsalTime: undefined,
      rehearsalDate: undefined, concertDate: undefined, wanted: [], preset: `choir:${info.code}` });
    programme = true;
  }
  if (now && applied !== stamp) {
    const c = now;
    const own = loadCycle().pieceIds.filter((id) => isOwnPiece(id) && !c.pieceIds.includes(id));
    saveCycle({
      ...loadCycle(), name: c.name, pieceIds: [...c.pieceIds, ...own], focusPieceIds: c.focusPieceIds ?? [],
      rehearsalWeekday: c.rehearsalWeekday, rehearsalTime: c.rehearsalTime, rehearsalDate: c.rehearsalDate,
      concertDate: c.concertDate, wanted: c.wanted ?? [], preset: `choir:${info.code}`,
    });
    programme = true;
  }
  try { localStorage.setItem('sh:choirApplied', stamp); } catch { /* ignore */ }
  return { ok: true, newPieces, programme };
}

// ------------------------------------------------------------------ choir admins

export const saveChoirCycle = (code: string, auth: Auth, cycle: unknown) => call<ChoirInfo>(`/choirs/${enc(code)}/cycle`, { method: 'PUT', auth, ...json(cycle) });

/** All of a choir's cycles (admins): past, running and to come. */
export interface CyclesReply { choir: ChoirInfo; cycles: ChoirCycle[]; current: string | null; cycleUpdatedAt: number }
export type CycleFields = Partial<ChoirProgramme> & { start?: string; end?: string | null; base?: number };
export const fetchCycles = (code: string, auth: Auth) => call<CyclesReply>(`/choirs/${enc(code)}/cycles`, { auth });
export const createCycle = (code: string, auth: Auth, body: CycleFields & { start: string }) =>
  call<CyclesReply>(`/choirs/${enc(code)}/cycles`, { method: 'POST', auth, ...json(body) });
export const updateCycle = (code: string, auth: Auth, id: string, body: CycleFields) =>
  call<CyclesReply>(`/choirs/${enc(code)}/cycles/${enc(id)}`, { method: 'PUT', auth, ...json(body) });
export const deleteCycle = (code: string, auth: Auth, id: string, base?: number) =>
  call<CyclesReply>(`/choirs/${enc(code)}/cycles/${enc(id)}`, { method: 'DELETE', auth, ...json(base != null ? { base } : {}) });
export async function uploadChoirPiece(code: string, auth: Auth, file: File, title: string, composer: string): Promise<{ piece: ChoirPiece }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('title', title);
  fd.append('composer', composer);
  return call(`/choirs/${enc(code)}/pieces`, { method: 'POST', auth, body: fd });
}
export const deleteChoirPiece = (code: string, auth: Auth, id: string) => call(`/choirs/${enc(code)}/pieces/${enc(id)}`, { method: 'DELETE', auth });
/** Save a piece's key marks (admins); the cached choir details get them at once. */
export async function setChoirPieceKeys(code: string, auth: Auth, id: string, keys: NonNullable<ChoirPiece['keys']>): Promise<void> {
  const r = await call<{ keys: ChoirPiece['keys'] }>(`/choirs/${enc(code)}/pieces/${enc(id)}`, { method: 'PATCH', auth, ...json({ keys }) });
  const info = cachedChoir();
  if (info && info.code === code) {
    writeJSON(CACHE, { ...info, pieces: info.pieces.map((p) => (p.id === id ? { ...p, keys: r.keys?.length ? r.keys : undefined } : p)) });
  }
}

// ------------------------------------------------------------------ the choir library (admins and the super admin)

/** A piece in the choir library (kept on the server, not in the public app). */
export interface LibraryPiece {
  id: string; title: string; composer: string; level?: string; description?: string; credit?: string; size: number;
  /** The choir's score made from it, if the choir has added it. */
  scoreId: string | null;
  /** In the choir's published programme. */
  inProgramme: boolean;
}
export const fetchLibrary = (code: string, auth: Auth) => call<{ pieces: LibraryPiece[] }>(`/choirs/${enc(code)}/library`, { auth });
/**
 * Add a library piece to the choir's scores (the server copies the file; nothing is uploaded from
 * here). `programme`: also put it into a cycle's programme: `cycleId` (the one being edited), else
 * the running one, else the next to come. The reply's `programme`: whether it is in that cycle now.
 * Adding it twice is harmless.
 */
export const addLibraryPiece = (code: string, auth: Auth, id: string, programme: boolean, cycleId?: string) =>
  call<{ ok: boolean; added: boolean; programme: boolean; piece: ChoirPiece; choir: ChoirInfo }>(
    `/choirs/${enc(code)}/library/${enc(id)}`, { method: 'POST', auth, ...json(cycleId ? { programme, cycleId } : { programme }) });

// ------------------------------------------------------------------ section leads

export interface SectionView {
  voice: string;
  members: { name: string; updatedAt: number; pieces: Record<string, { readiness: number; level: number }> }[];
  pieces: Record<string, { singers: number; bars: Record<string, { n: number; mean: number; weak: number }> }>;
}
export const fetchSection = (code: string, voice: string, auth: Auth) => call<SectionView>(`/choirs/${enc(code)}/section/${voice}`, { auth });

/**
 * Share my per-bar progress with my section lead (opt-in). Logged in to the choir, the entry is the
 * account's (under its name, from any phone); this phone's anonymous entry moves to it.
 */
export function shareProgress(code: string, name: string, voice: string, pieces: Record<string, { readiness: number; level: number; bars: BarMap }>,
  range?: SharedRange) {
  const body: Record<string, { readiness: number; level: number; bars: Record<string, number> }> = {};
  for (const [id, p] of Object.entries(pieces)) {
    const bars: Record<string, number> = {};
    for (const [m, s] of Object.entries(p.bars)) bars[m] = Math.round(s.ema * 100) / 100;
    body[id] = { readiness: p.readiness, level: p.level, bars };
  }
  const s = sessionFor(code);
  return call<{ ok: boolean; name?: string }>(`/choirs/${enc(code)}/progress/${enc(s?.account.name ?? name)}`,
    { method: 'PUT', member: true, ...(s ? { auth: sessionAuth(s) } : {}), ...json({ voice, pieces: body, ...(range ? { range } : {}) }) });
}
export function withdrawProgress(code: string, name: string) {
  const s = sessionFor(code);
  return call(`/choirs/${enc(code)}/progress/${enc(s?.account.name ?? name)}`, { method: 'DELETE', member: true, ...(s ? { auth: sessionAuth(s) } : {}) });
}

// ------------------------------------------------------------------ accounts (admins and section leads)

/** admin and lead come from invite links; member = a singer's own account (made with the choir code). */
export type Role = 'admin' | 'lead' | 'member';
export interface Account {
  id: string; name: string; role: Role; voices: string[]; createdAt: number; lastLoginAt?: number | null;
  /** How the account was made. */
  invitedBy?: 'invite' | 'super admin' | 'old password' | 'sign-up';
}
export interface Session { token: string; code: string; choirName: string; account: Account; expiresAt: number }
export interface InviteInfo {
  id: string; role: Role; voices: string[]; note: string; createdAt: number; expiresAt: number; by: string;
  /** A new-password link for an existing account. */
  reset?: boolean; accountName?: string | null;
}
export interface People {
  accounts: Account[];
  invites: InviteInfo[];
  legacy: { active: boolean; admin: boolean; leads: string[]; until: number | null };
  you: string | null;
  signupsOpen?: boolean;
  maxMembers?: number;
}

// Kept outside the `sh:` keys, so a login never ends up in a backup file someone shares.
const SESSION_KEY = 'schonberg:session';
const INVITES_KEY = 'schonberg:inviteLinks';
const sessionListeners = new Set<() => void>();
export const LOGGED_OUT_ELSEWHERE = 'You were logged out. Log in again.';
/** Why this phone's login ended (kept until the next login, so Home and Settings can say so after a reload). */
export interface LoggedOut { reason: string; message: string; code: string; name: string }
const LOGGED_OUT_KEY = 'schonberg:loggedOut';
function setLoggedOut(v: LoggedOut | null): void {
  if (v) rawSet(LOGGED_OUT_KEY, JSON.stringify(v));
  else rawRemove(LOGGED_OUT_KEY);
}
export function lastLogout(): LoggedOut | null {
  try {
    const v = JSON.parse(rawGet(LOGGED_OUT_KEY) ?? 'null');
    return v && typeof v.message === 'string' && typeof v.code === 'string' ? v as LoggedOut : null;
  } catch {
    return null;
  }
}
/** Why this phone's login ended without the person logging out here (shown until they log in again). */
export const loggedOutNotice = () => lastLogout()?.message ?? null;
/** The singer read why they were logged out. */
export function dismissLogout(): void {
  setLoggedOut(null);
  sessionListeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
}
export function onSessionChange(cb: () => void): () => void {
  sessionListeners.add(cb);
  return () => { sessionListeners.delete(cb); };
}

const isSession = (v: unknown): v is Session => {
  const s = v as Session | null;
  return !!s && typeof s.token === 'string' && typeof s.code === 'string' && typeof s.expiresAt === 'number'
    && !!s.account && typeof s.account.name === 'string' && (s.account.role === 'admin' || s.account.role === 'lead' || s.account.role === 'member') && Array.isArray(s.account.voices);
};

/** This phone's login (an admin's or section lead's session token, never the password). */
export function loadSession(): Session | null {
  try {
    const raw = rawGet(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return isSession(s) && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session | null): void {
  if (s) rawSet(SESSION_KEY, JSON.stringify(s));
  else rawRemove(SESSION_KEY);
  sessionListeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
}
/** The session when it belongs to this choir. */
export function sessionFor(code: string | undefined | null): Session | null {
  const s = loadSession();
  return s && code && s.code === code.toLowerCase() ? s : null;
}
export const sessionAuth = (s: Session): Auth => ({ bearer: s.token });

/**
 * The server ended this phone's login. `reason` (from the server): 'expired', 'password', 'replaced',
 * 'logout' — the singer just logs in again, and sharing and progress sync resume with the account
 * (until then sharing pauses rather than going anonymous); 'removed' (by an admin) or 'deleted' (by
 * the singer) — the account is gone, so sharing stops and this phone forgets the account.
 */
export function endSession(reason?: string, message?: string): void {
  const gone = reason === 'removed' || reason === 'deleted';
  const s = loadSession();
  setLoggedOut(reason === 'deleted' || !s ? null
    : { reason: reason || 'expired', message: message || LOGGED_OUT_ELSEWHERE, code: s.code, name: s.account.name });
  if (gone) {
    const p = loadProfile();
    if (p.shareProgress) saveProfile({ ...p, shareProgress: false });
    rawSet(SHARE_OFF_KEY, p.choirCode ?? '1');
    // The account this phone's progress went with (src/progress/sync.ts): forgotten.
    rawRemove('schonberg:syncMeta');
    rawRemove('schonberg:syncAsk');
  }
  saveSession(null);
}

/** Use a new login; a different one this phone had (maybe another choir) is ended on the server too. */
function adoptSession(s: Session): void {
  const old = loadSession();
  setLoggedOut(null);
  saveSession(s);
  // Logged in to the choir: sharing with the section lead is part of being in it (again, after a removal).
  rawRemove(SHARE_OFF_KEY);
  const p = loadProfile();
  if (p.choirCode === s.code && !p.shareProgress) saveProfile({ ...p, shareProgress: true });
  if (old && old.token !== s.token) void call('/session', { method: 'DELETE', auth: { bearer: old.token } }).catch(() => {});
}

export async function login(code: string, name: string, password: string): Promise<Session> {
  const s = await call<Session>(`/choirs/${enc(code.toLowerCase())}/login`, { method: 'POST', ...json({ name, password }) });
  adoptSession(s);
  return s;
}
/** Log out on this phone (the server forgets the session too). */
export async function logout(): Promise<void> {
  const s = loadSession();
  setLoggedOut(null);
  saveSession(null);
  if (s) await call('/session', { method: 'DELETE', auth: { bearer: s.token } }).catch(() => {});
}
/** Pick up role or voice changes an admin made; forgets a session the server ended. */
export async function refreshSession(): Promise<Session | null> {
  const s = loadSession();
  if (!s) return null;
  try {
    const fresh = await call<Omit<Session, 'token'>>('/session', { auth: { bearer: s.token } });
    const next: Session = { ...s, ...fresh, token: s.token };
    if (JSON.stringify(next) !== JSON.stringify(s)) saveSession(next);
    return next;
  } catch (e) {
    return e instanceof ChoirApiError && e.status === 401 ? null : s;
  }
}
let lastRefresh = 0;
export function _resetSessionStateForTests(): void { lastRefresh = 0; setLoggedOut(null); }
/** refreshSession at most every 20 s (on opening an admin or section screen, and when the app comes back). */
export function refreshSessionSoon(): void {
  const now = Date.now();
  if (!loadSession() || now - lastRefresh < 20_000) return;
  lastRefresh = now;
  void refreshSession();
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSessionSoon(); });
  window.addEventListener('focus', () => refreshSessionSoon());
}

export function changePassword(password: string, newPassword: string): Promise<unknown> {
  const s = loadSession();
  if (!s) return Promise.reject(new ChoirApiError(401, 'Log in first'));
  return call('/session/password', { method: 'PUT', auth: { bearer: s.token }, ...json({ password, newPassword }) });
}

/** The link someone opens to accept an invite (the token stays in the #fragment, so no server logs it). */
export function inviteLink(token: string): string {
  const here = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '';
  return `${here}#/invite/${token}`;
}
export const lookupInvite = (token: string) =>
  call<{ code: string; choirName: string; invite: InviteInfo }>('/invites/lookup', { method: 'POST', ...json({ token }) });
export async function acceptInvite(token: string, name: string, password: string): Promise<Session> {
  const s = await call<Session>('/invites/accept', { method: 'POST', ...json({ token, name, password }) });
  adoptSession(s);
  return s;
}
/** A singer makes their own account in their choir (the choir code is enough, no invite). */
export async function signUp(code: string, name: string, password: string): Promise<Session> {
  const s = await call<Session>(`/choirs/${enc(code.toLowerCase())}/members`, { method: 'POST', ...json({ name, password }) });
  adoptSession(s);
  return s;
}
/** A member deletes their own account and the progress it kept. */
export async function deleteMyAccount(password: string): Promise<void> {
  const s = loadSession();
  if (!s) throw new ChoirApiError(401, 'Log in first');
  await call('/session/account', { method: 'DELETE', auth: { bearer: s.token }, ...json({ password }) });
  endSession('deleted');
  // An anonymous entry this phone shared before the account (if any) goes too.
  const p = loadProfile();
  if (p.choirCode && p.name.trim()) void withdrawProgress(p.choirCode, p.name.trim()).catch(() => {});
}
/** Turn the first version's shared admin or section-lead password into my own account. */
export async function claimAccount(code: string, oldPassword: string, name: string, password: string): Promise<Session> {
  const s = await call<Session>(`/choirs/${enc(code.toLowerCase())}/claim`, { method: 'POST', ...json({ oldPassword, name, password }) });
  adoptSession(s);
  return s;
}

// Invite links this phone created, so "Copy link" works until they expire (the server keeps only a hash).
type Remembered = Record<string, { t: string; exp: number }>;
function remembered(): Remembered {
  try {
    const o = JSON.parse(rawGet(INVITES_KEY) ?? '{}');
    return typeof o === 'object' && o && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}
export function rememberInvite(inv: InviteInfo, token: string): void {
  const now = Date.now();
  const all = Object.fromEntries(Object.entries(remembered()).filter(([, v]) => v && v.exp > now));
  all[inv.id] = { t: token, exp: inv.expiresAt };
  rawSet(INVITES_KEY, JSON.stringify(all));
}
export function rememberedInvite(id: string): string | null {
  const v = remembered()[id];
  return v && typeof v.t === 'string' && v.exp > Date.now() ? v.t : null;
}

export const fetchPeople = (code: string, auth: Auth) => call<People>(`/choirs/${enc(code)}/people`, { auth });
export async function createInvite(code: string, auth: Auth, role: Role, voices: string[], note: string): Promise<{ token: string; invite: InviteInfo }> {
  const r = await call<{ token: string; invite: InviteInfo }>(`/choirs/${enc(code)}/invites`, { method: 'POST', auth, ...json({ role, voices, note }) });
  rememberInvite(r.invite, r.token);
  return r;
}
export const revokeInvite = (code: string, auth: Auth, id: string) => call<People>(`/choirs/${enc(code)}/invites/${enc(id)}`, { method: 'DELETE', auth });
export const updatePerson = (code: string, auth: Auth, id: string, patch: { role?: Role; voices?: string[] }) =>
  call<People>(`/choirs/${enc(code)}/people/${enc(id)}`, { method: 'PUT', auth, ...json(patch) });
export const removePerson = (code: string, auth: Auth, id: string) => call<People>(`/choirs/${enc(code)}/people/${enc(id)}`, { method: 'DELETE', auth });
/** A new-password link for someone who lost theirs. */
export async function resetPerson(code: string, auth: Auth, id: string): Promise<{ token: string; invite: InviteInfo }> {
  const r = await call<{ token: string; invite: InviteInfo }>(`/choirs/${enc(code)}/people/${enc(id)}/reset`, { method: 'POST', auth });
  rememberInvite(r.invite, r.token);
  return r;
}
/** Open or close self sign-up of member accounts. */
export const setSignupsOpen = (code: string, auth: Auth, open: boolean) =>
  call<People>(`/choirs/${enc(code)}/members/settings`, { method: 'PUT', auth, ...json({ open }) });
/** Remove the member accounts made since `since` (ms), with their progress (a flood of fake sign-ups). */
export const removeMembersSince = (code: string, auth: Auth, since: number) =>
  call<People & { removed: number }>(`/choirs/${enc(code)}/members?since=${since}`, { method: 'DELETE', auth });
export const retireOldPasswords = (code: string, auth: Auth) => call<People>(`/choirs/${enc(code)}/legacy`, { method: 'DELETE', auth });

// ------------------------------------------------------------------ super admin

/** One choir's storage (scores against the per-choir cap, shared progress, members sharing it). */
export interface ChoirUsage {
  scoresBytes: number; progressBytes: number; accountProgressBytes?: number; bytes: number; capBytes: number; pieces: number; maxPieces: number;
  /** Singers sharing progress with their section lead. */
  members: number;
  accounts?: number; memberAccounts?: number; savedProgress?: number;
  /** All Schönberg data on the server (admins' view). */
  server?: { totalBytes: number; capBytes: number };
}
/** All Schönberg data on the server, and the progress kept with accounts. */
export interface ServerUsage {
  totalBytes: number; capBytes: number;
  accountProgress: { count: number; bytes: number; capBytes: number };
}
export interface ChoirSummary {
  code: string; name: string; pieces: number; createdAt: number; hasAdmin: boolean; programme: string | null; leads: string[]; members: number;
  admins: string[]; people: number; invites: number; legacy: boolean;
  usage?: ChoirUsage;
}
export const superList = (auth: Auth) => call<{ choirs: ChoirSummary[]; usage?: ServerUsage }>('/super/choirs', { auth });
export const fetchChoirUsage = (code: string, auth: Auth) => call<ChoirUsage>(`/choirs/${enc(code)}/usage`, { auth });
/** "740 KB" below 1 MB, else "12.3 MB" (one decimal below 10 MB). */
export function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  const v = bytes / (1024 * 1024);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} MB`;
}
/** Creates the choir and an invite link for its first admin. */
export async function superCreate(auth: Auth, code: string, name: string, adminNote: string): Promise<{ code: string; name: string; token: string; invite: InviteInfo }> {
  const r = await call<{ code: string; name: string; token: string; invite: InviteInfo }>('/super/choirs', { method: 'POST', auth, ...json({ code, name, adminNote }) });
  rememberInvite(r.invite, r.token);
  return r;
}
export const superRename = (auth: Auth, code: string, name: string) =>
  call(`/super/choirs/${enc(code)}`, { method: 'PUT', auth, ...json({ name }) });
export const superDelete = (auth: Auth, code: string) => call(`/super/choirs/${enc(code)}`, { method: 'DELETE', auth });
/** Remove a choir's member accounts nobody used for `days` days (with the progress they kept). */
export const superPurgeMembers = (auth: Auth, code: string, days: number, dryRun = false) =>
  call<{ removed: number; names: string[] }>(`/super/choirs/${enc(code)}/purge-members`, { method: 'POST', auth, ...json({ days, dryRun }) });

// ------------------------------------------------------------------ the super admin's login

/**
 * The super admin's session on this phone: a token from POST /super/login (the password itself is
 * never kept). Stored outside the `sh:` keys, so it is never in a backup file, and never part of the
 * progress kept with an account (src/progress/sync.ts sends only practice data).
 */
export interface SuperSession { token: string; expiresAt: number }
const SUPER_KEY = 'schonberg:superSession';
let superEnded: string | null = null;

export function loadSuperSession(): SuperSession | null {
  try {
    const s = JSON.parse(rawGet(SUPER_KEY) ?? 'null') as SuperSession | null;
    return s && typeof s.token === 'string' && typeof s.expiresAt === 'number' && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}
function saveSuperSession(s: SuperSession | null): void {
  if (s) rawSet(SUPER_KEY, JSON.stringify(s));
  else rawRemove(SUPER_KEY);
  sessionListeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
}
/** The super admin's session as request auth, or null. */
export function superAuth(): Auth | null {
  const s = loadSuperSession();
  return s ? { bearer: s.token } : null;
}
/** Why the super-admin login ended without logging out here (shown above the password prompt). */
export const superLoggedOutNotice = () => superEnded;
/** The server no longer accepts this phone's super-admin login: forget it (the password prompt shows again). */
export function endSuperSession(message = 'Your super-admin login has ended. Log in again.'): void {
  if (!loadSuperSession()) return;
  superEnded = message;
  saveSuperSession(null);
}
export async function superLogin(password: string): Promise<SuperSession> {
  const r = await call<SuperSession>('/super/login', { method: 'POST', ...json({ password }) });
  const old = loadSuperSession();
  superEnded = null;
  saveSuperSession({ token: r.token, expiresAt: r.expiresAt });
  if (old && old.token !== r.token) void call('/super/session', { method: 'DELETE', auth: { bearer: old.token } }).catch(() => {});
  return r;
}
/** Log out of super admin on this phone (the server forgets the session too). */
export async function superLogout(): Promise<void> {
  const s = loadSuperSession();
  superEnded = null;
  saveSuperSession(null);
  if (s) await call('/super/session', { method: 'DELETE', auth: { bearer: s.token } }).catch(() => {});
}
/** Is the super-admin login still valid? (Renews it; a rejected one is forgotten.) */
export async function refreshSuperSession(): Promise<SuperSession | null> {
  const s = loadSuperSession();
  if (!s) return null;
  try {
    const r = await call<{ expiresAt: number }>('/super/session', { auth: { bearer: s.token } });
    if (loadSuperSession()?.token === s.token && r.expiresAt !== s.expiresAt) saveSuperSession({ ...s, expiresAt: r.expiresAt });
    return loadSuperSession();
  } catch (e) {
    return e instanceof ChoirApiError && e.status === 401 ? null : s;
  }
}
let lastSuperRefresh = 0;
/** refreshSuperSession at most every 20 s (on start, on opening the admin screen, when the app comes back). */
export function refreshSuperSessionSoon(): void {
  const now = Date.now();
  if (!loadSuperSession() || !apiBase() || now - lastSuperRefresh < 20_000) return;
  lastSuperRefresh = now;
  void refreshSuperSession();
}
export function _resetSuperStateForTests(): void { lastSuperRefresh = 0; superEnded = null; }
// The first versions kept the super-admin password itself for the browser tab: no longer.
try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('sh:pw:super'); } catch { /* storage blocked */ }

// ------------------------------------------------------------------ who may open the Admin tab

export type AdminTab = 'choir' | 'sections' | 'choirs' | 'usage';
/**
 * This phone's staff logins: a choir admin's or section lead's session for the current choir, and/or
 * the super admin's. Members and singers without an account have none (and see no Admin tab).
 */
export interface Staff { admin: boolean; lead: boolean; superAdmin: boolean; tabs: AdminTab[]; label: 'Admin' | 'Section' | null }
export function staffRoles(choirCode: string | undefined | null): Staff {
  const s = sessionFor(choirCode);
  const admin = s?.account.role === 'admin';
  const lead = s?.account.role === 'lead';
  const superAdmin = !!loadSuperSession();
  const tabs: AdminTab[] = [
    ...(admin ? ['choir' as const] : []),
    ...(admin || lead ? ['sections' as const] : []),
    ...(superAdmin ? ['choirs' as const, 'usage' as const] : []),
  ];
  return { admin, lead, superAdmin, tabs, label: admin || superAdmin ? 'Admin' : lead ? 'Section' : null };
}
