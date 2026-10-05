// Your choir on the server: its programme (cycle) and its own scores, plus the calls for admins and
// section leads (personal accounts, created through invite links) and the super admin. Members only
// need the choir code; the programme and scores are synced to the phone (and work offline afterwards).

import { loadCycle, loadProfile, rawGet, rawRemove, rawSet, readJSON, saveCycle, saveProfile, writeJSON, type Cycle } from './store';
import type { BarMap } from './bars';

export interface ChoirPiece { id: string; title: string; composer: string; filename: string; uploadedAt: number; size: number }
export interface ChoirInfo {
  code: string;
  name: string;
  cycle: (Omit<Cycle, 'preset'> & { name: string }) | null;
  pieces: ChoirPiece[];
  updatedAt: number;
  /** When an admin last published the programme (score uploads don't change it). */
  cycleUpdatedAt?: number;
  /** Voice parts that have a section lead. */
  leads: string[];
  /** The first version's shared admin / section-lead passwords can still become personal accounts. */
  legacyLogin?: boolean;
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

/** How a request proves who sends it: a logged-in account's session, or the super-admin password. */
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
    if (res.status === 401 && auth && 'bearer' in auth && loadSession()?.token === auth.bearer) endSession();
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
  saveProfile({ ...p, choirCode: info.code, leaderboardOptIn: true });
  writeJSON(CACHE, info);
  return info;
}

export function leaveChoir(): void {
  const p = loadProfile();
  if (p.choirCode && p.shareProgress && p.name.trim()) withdrawProgress(p.choirCode, p.name.trim()).catch(() => {});
  saveProfile({ ...p, choirCode: undefined, shareProgress: false });
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
export async function syncChoir(importFile: (name: string, data: ArrayBuffer, meta: { id: string; title: string; composer: string }) => Promise<void>,
  hasPiece: (id: string) => boolean,
  /** Pieces the singer imported on this phone: they stay in the cycle when the choir's programme arrives. */
  isOwnPiece: (id: string) => boolean = () => false): Promise<{ ok: boolean; newPieces: number; programme: boolean; error?: string }> {
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
  let failed: string[] = [];
  try { failed = JSON.parse(localStorage.getItem('sh:choirBadScores') ?? '[]'); } catch { /* ignore */ }
  for (const p of info.pieces) {
    const id = choirPieceId(info.code, p.id);
    // A score that didn't import once isn't downloaded again on every start.
    if (hasPiece(id) || failed.includes(id)) continue;
    try {
      const res = await fetch(`${apiBase()}/choirs/${enc(info.code)}/pieces/${enc(p.id)}/file`);
      if (!res.ok) continue;
      await importFile(p.filename || `${p.id}.musicxml`, await res.arrayBuffer(), { id, title: p.title, composer: p.composer });
      newPieces++;
    } catch (e) {
      console.warn('choir score', p.id, e);
      failed = [...failed, id].slice(-50);
      try { localStorage.setItem('sh:choirBadScores', JSON.stringify(failed)); } catch { /* ignore */ }
    }
  }
  // The programme: applied when the choir published a new version (local tweaks last until then).
  let programme = false;
  const stamp = `${info.code}:${info.cycleUpdatedAt ?? info.updatedAt}`;
  let applied: string | null = null;
  try { applied = localStorage.getItem('sh:choirApplied'); } catch { /* ignore */ }
  if (info.cycle && applied !== stamp) {
    const c = info.cycle;
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
export async function uploadChoirPiece(code: string, auth: Auth, file: File, title: string, composer: string): Promise<{ piece: ChoirPiece }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('title', title);
  fd.append('composer', composer);
  return call(`/choirs/${enc(code)}/pieces`, { method: 'POST', auth, body: fd });
}
export const deleteChoirPiece = (code: string, auth: Auth, id: string) => call(`/choirs/${enc(code)}/pieces/${enc(id)}`, { method: 'DELETE', auth });

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
export function shareProgress(code: string, name: string, voice: string, pieces: Record<string, { readiness: number; level: number; bars: BarMap }>) {
  const body: Record<string, { readiness: number; level: number; bars: Record<string, number> }> = {};
  for (const [id, p] of Object.entries(pieces)) {
    const bars: Record<string, number> = {};
    for (const [m, s] of Object.entries(p.bars)) bars[m] = Math.round(s.ema * 100) / 100;
    body[id] = { readiness: p.readiness, level: p.level, bars };
  }
  const s = sessionFor(code);
  return call<{ ok: boolean; name?: string }>(`/choirs/${enc(code)}/progress/${enc(s?.account.name ?? name)}`,
    { method: 'PUT', member: true, ...(s ? { auth: sessionAuth(s) } : {}), ...json({ voice, pieces: body }) });
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
}

// Kept outside the `sh:` keys, so a login never ends up in a backup file someone shares.
const SESSION_KEY = 'schonberg:session';
const INVITES_KEY = 'schonberg:inviteLinks';
const sessionListeners = new Set<() => void>();
export const LOGGED_OUT_ELSEWHERE = 'You were logged out (password changed or account removed). Log in again.';
let logoutNotice: string | null = null;
/** Why this phone's login ended without the person logging out here (shown until they log in again). */
export const loggedOutNotice = () => logoutNotice;
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
 * The server ended this phone's login (logged out elsewhere, password changed, account removed).
 * Sharing stops too, so a removed member's phone doesn't quietly share again without the account.
 */
export function endSession(): void {
  logoutNotice = LOGGED_OUT_ELSEWHERE;
  const p = loadProfile();
  if (p.shareProgress) saveProfile({ ...p, shareProgress: false });
  saveSession(null);
}

/** Use a new login; a different one this phone had (maybe another choir) is ended on the server too. */
function adoptSession(s: Session): void {
  const old = loadSession();
  logoutNotice = null;
  saveSession(s);
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
  logoutNotice = null;
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
export function _resetSessionStateForTests(): void { lastRefresh = 0; logoutNotice = null; }
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
  saveSession(null);
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
export const superList = (pw: string) => call<{ choirs: ChoirSummary[]; usage?: ServerUsage }>('/super/choirs', { auth: { superAdmin: pw } });
export const fetchChoirUsage = (code: string, auth: Auth) => call<ChoirUsage>(`/choirs/${enc(code)}/usage`, { auth });
/** "740 KB" below 1 MB, else "12.3 MB" (one decimal below 10 MB). */
export function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  const v = bytes / (1024 * 1024);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} MB`;
}
/** Creates the choir and an invite link for its first admin. */
export async function superCreate(pw: string, code: string, name: string, adminNote: string): Promise<{ code: string; name: string; token: string; invite: InviteInfo }> {
  const r = await call<{ code: string; name: string; token: string; invite: InviteInfo }>('/super/choirs', { method: 'POST', auth: { superAdmin: pw }, ...json({ code, name, adminNote }) });
  rememberInvite(r.invite, r.token);
  return r;
}
export const superRename = (pw: string, code: string, name: string) =>
  call(`/super/choirs/${enc(code)}`, { method: 'PUT', auth: { superAdmin: pw }, ...json({ name }) });
export const superDelete = (pw: string, code: string) => call(`/super/choirs/${enc(code)}`, { method: 'DELETE', auth: { superAdmin: pw } });
/** Remove a choir's member accounts nobody used for `days` days (with the progress they kept). */
export const superPurgeMembers = (pw: string, code: string, days: number) =>
  call<{ removed: number }>(`/super/choirs/${enc(code)}/purge-members`, { method: 'POST', auth: { superAdmin: pw }, ...json({ days }) });

// ------------------------------------------------------------------ the super-admin password (this tab only)

export function sessionSecret(key: 'super', value?: string | null): string | null {
  try {
    if (value === null) sessionStorage.removeItem(`sh:pw:${key}`);
    else if (value !== undefined) sessionStorage.setItem(`sh:pw:${key}`, value);
    return sessionStorage.getItem(`sh:pw:${key}`);
  } catch {
    return null;
  }
}
