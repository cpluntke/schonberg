// Your choir on the server: its programme (cycle) and its own scores, plus the admin, section-lead
// and super-admin calls. Members only need the choir code; the programme and scores are synced to
// the phone (and work offline afterwards).

import { loadCycle, loadProfile, readJSON, saveCycle, saveProfile, writeJSON, type Cycle } from './store';
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
  leads: string[];
}

export class ChoirApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** API base (same origin when served from the app's own server). */
export function apiBase(): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
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

async function call<T>(path: string, init: RequestInit & { admin?: string; superAdmin?: string; lead?: string; member?: boolean } = {}): Promise<T> {
  const base = apiBase();
  if (!base) throw new ChoirApiError(0, 'Choirs need the online version of the app.');
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.admin) headers['X-Choir-Admin'] = init.admin;
  if (init.superAdmin) headers['X-Super-Admin'] = init.superAdmin;
  if (init.lead) headers['X-Section-Lead'] = init.lead;
  if (init.member) headers['X-Member-Token'] = memberToken();
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers });
  } catch {
    throw new ChoirApiError(0, 'No connection to the server.');
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new ChoirApiError(res.status, (body as { error?: string } | null)?.error ?? `Server error (${res.status})`);
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

export const checkAdmin = (code: string, admin: string) => call<{ ok: true }>(`/choirs/${enc(code)}/admin`, { method: 'POST', admin });
export const saveChoirCycle = (code: string, admin: string, cycle: unknown) => call<ChoirInfo>(`/choirs/${enc(code)}/cycle`, { method: 'PUT', admin, ...json(cycle) });
export async function uploadChoirPiece(code: string, admin: string, file: File, title: string, composer: string): Promise<{ piece: ChoirPiece }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('title', title);
  fd.append('composer', composer);
  return call(`/choirs/${enc(code)}/pieces`, { method: 'POST', admin, body: fd });
}
export const deleteChoirPiece = (code: string, admin: string, id: string) => call(`/choirs/${enc(code)}/pieces/${enc(id)}`, { method: 'DELETE', admin });
export const setSectionLead = (code: string, admin: string, voice: string, password: string | null) =>
  call<{ leads: string[] }>(`/choirs/${enc(code)}/leads/${voice}`, password == null ? { method: 'DELETE', admin } : { method: 'PUT', admin, ...json({ password }) });

// ------------------------------------------------------------------ section leads

export interface SectionView {
  voice: string;
  members: { name: string; updatedAt: number; pieces: Record<string, { readiness: number; level: number }> }[];
  pieces: Record<string, { singers: number; bars: Record<string, { n: number; mean: number; weak: number }> }>;
}
export const checkLead = (code: string, voice: string, lead: string) => call<{ ok: true }>(`/choirs/${enc(code)}/lead/${voice}`, { method: 'POST', lead });
export const fetchSection = (code: string, voice: string, auth: { lead?: string; admin?: string }) =>
  call<SectionView>(`/choirs/${enc(code)}/section/${voice}`, { ...auth });

/** Share my per-bar progress with my section lead (opt-in). */
export function shareProgress(code: string, name: string, voice: string, pieces: Record<string, { readiness: number; level: number; bars: BarMap }>) {
  const body: Record<string, { readiness: number; level: number; bars: Record<string, number> }> = {};
  for (const [id, p] of Object.entries(pieces)) {
    const bars: Record<string, number> = {};
    for (const [m, s] of Object.entries(p.bars)) bars[m] = Math.round(s.ema * 100) / 100;
    body[id] = { readiness: p.readiness, level: p.level, bars };
  }
  return call(`/choirs/${enc(code)}/progress/${enc(name)}`, { method: 'PUT', member: true, ...json({ voice, pieces: body }) });
}
export const withdrawProgress = (code: string, name: string) => call(`/choirs/${enc(code)}/progress/${enc(name)}`, { method: 'DELETE', member: true });

// ------------------------------------------------------------------ super admin

export interface ChoirSummary { code: string; name: string; pieces: number; createdAt: number; hasAdmin: boolean; programme: string | null; leads: string[]; members: number }
export const superList = (pw: string) => call<{ choirs: ChoirSummary[] }>('/super/choirs', { superAdmin: pw });
export const superCreate = (pw: string, code: string, name: string, adminPassword: string) =>
  call('/super/choirs', { method: 'POST', superAdmin: pw, ...json({ code, name, adminPassword }) });
export const superUpdate = (pw: string, code: string, patch: { name?: string; adminPassword?: string }) =>
  call(`/super/choirs/${enc(code)}`, { method: 'PUT', superAdmin: pw, ...json(patch) });
export const superDelete = (pw: string, code: string) => call(`/super/choirs/${enc(code)}`, { method: 'DELETE', superAdmin: pw });

// ------------------------------------------------------------------ remembered passwords (this tab only)

export function sessionSecret(key: 'admin' | 'super' | 'lead' | 'leadVoice', value?: string | null): string | null {
  try {
    if (value === null) sessionStorage.removeItem(`sh:pw:${key}`);
    else if (value !== undefined) sessionStorage.setItem(`sh:pw:${key}`, value);
    return sessionStorage.getItem(`sh:pw:${key}`);
  } catch {
    return null;
  }
}
