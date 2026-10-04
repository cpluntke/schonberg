// Leaderboard client. Ranks by readiness / streak / most improved (not raw grinding).
// Backend is optional: HTTP if VITE_LEADERBOARD_URL is set, else a local (offline) store
// that holds your own entry plus entries imported from share codes.
import type { Section, VoiceType } from '../music/types';
import { pieceReadiness } from './ladder';
import {
  attemptLog, getProgress, loadProfile, readJSON, readinessHistory, snapshotReadiness,
  streakDays, writeJSON, dayKey,
} from './store';

export interface LeaderboardEntry {
  name: string;
  voice: VoiceType;
  pieceId: string;
  /** 0..1 piece readiness. */
  readiness: number;
  /** Sum of best score per section per level over the last 7 days. */
  weeklyScore: number;
  streak: number;
  /** Readiness gain over the last 7 days (0..1, may be negative). */
  improved: number;
  updatedAt: number;
}

export type RankBy = 'readiness' | 'streak' | 'improved' | 'weekly';

const DAY_MS = 86_400_000;
const VOICES: VoiceType[] = ['S', 'A', 'T', 'B', 'other'];

/** Build my entry for one piece/part from local data. Also snapshots today's readiness. */
export function computeMyEntry(
  pieceId: string,
  partId: string,
  sections: Section[],
  now: number = Date.now(),
): LeaderboardEntry {
  const profile = loadProfile();
  const readiness = pieceReadiness(sections, getProgress(pieceId, partId)).pct;
  snapshotReadiness(pieceId, partId, readiness, now);

  const since = now - 7 * DAY_MS;
  const best = new Map<string, number>();
  for (const e of attemptLog()) {
    if (e.pieceId !== pieceId || e.partId !== partId || e.at <= since || e.at > now || e.level < 1) continue;
    const k = `${e.sectionId}|${e.level}`;
    best.set(k, Math.max(best.get(k) ?? 0, e.score || 0));
  }
  let weeklyScore = 0;
  for (const v of best.values()) weeklyScore += v;

  // Baseline: latest snapshot at or before 7 days ago, else the earliest one we have.
  const hist = readinessHistory(pieceId, partId);
  const cutoff = dayKey(since);
  let base: number | undefined;
  for (const h of hist) if (h.day <= cutoff) base = h.pct;
  if (base === undefined) base = hist.length ? hist[0].pct : readiness;
  const improved = readiness - base;

  return {
    name: profile.name || 'Me',
    voice: profile.voice,
    pieceId,
    readiness,
    weeklyScore: Math.round(weeklyScore),
    streak: streakDays(new Date(now)),
    improved: Math.round(improved * 1000) / 1000,
    updatedAt: now,
  };
}

export function rankEntries(entries: LeaderboardEntry[], by: RankBy): LeaderboardEntry[] {
  const key = (e: LeaderboardEntry) =>
    by === 'readiness' ? e.readiness : by === 'streak' ? e.streak : by === 'improved' ? e.improved : e.weeklyScore;
  return [...entries].sort((a, b) => key(b) - key(a) || b.readiness - a.readiness || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- validation

function clampStr(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null;
}
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;

export function sanitizeEntry(v: unknown): LeaderboardEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const name = clampStr(o.name, 40);
  const pieceId = clampStr(o.pieceId, 120);
  const voice = VOICES.includes(o.voice as VoiceType) ? (o.voice as VoiceType) : 'other';
  const readiness = num(o.readiness, 0, 1);
  // Plausibility limits (a share code can be hand-crafted): a week of practice can't exceed a few
  // hundred thousand points, streaks are capped at ~3 years, and timestamps can't be in the future.
  const weeklyScore = num(o.weeklyScore, 0, 500_000);
  const streak = num(o.streak, 0, 1000);
  const improved = num(o.improved, -1, 1);
  const updatedAt = num(o.updatedAt, 0, Date.now() + 86_400_000);
  if (!name || !pieceId || readiness == null || weeklyScore == null || streak == null || improved == null || updatedAt == null) {
    return null;
  }
  return { name, voice, pieceId, readiness, weeklyScore: Math.round(weeklyScore), streak: Math.round(streak), improved, updatedAt };
}

// ---------------------------------------------------------------- share codes

const SHARE_PREFIX = 'SH1.';

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Compact "SH1.<base64url>" code to paste into a group chat. */
export function encodeShareCode(e: LeaderboardEntry): string {
  const arr = [
    e.name, e.voice, e.pieceId, Math.round(e.readiness * 1000), Math.round(e.weeklyScore),
    e.streak, Math.round(e.improved * 1000), Math.round(e.updatedAt / 1000),
  ];
  return SHARE_PREFIX + b64urlEncode(JSON.stringify(arr));
}

/** Decode a share code (tolerates whitespace, surrounding text). Returns null if invalid. */
export function decodeShareCode(str: string): LeaderboardEntry | null {
  const m = /SH1\.([A-Za-z0-9_-]+)/.exec(str.replace(/\s+/g, ''));
  if (!m) return null;
  try {
    const a = JSON.parse(b64urlDecode(m[1]));
    if (!Array.isArray(a) || a.length < 8) return null;
    return sanitizeEntry({
      name: a[0], voice: a[1], pieceId: a[2], readiness: a[3] / 1000, weeklyScore: a[4],
      streak: a[5], improved: a[6] / 1000, updatedAt: a[7] * 1000,
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- local entries

const localKey = (choirCode: string) => `sh:leaderboard:${choirCode || 'local'}`;
const entryId = (e: LeaderboardEntry) => `${e.name.toLowerCase()}|${e.pieceId}`;

export function localEntries(choirCode: string): LeaderboardEntry[] {
  const v = readJSON<unknown[]>(localKey(choirCode), [], Array.isArray);
  return v.map(sanitizeEntry).filter((e): e is LeaderboardEntry => e !== null);
}

/** Merge entries into the local store (newer updatedAt wins per name+piece). */
export function mergeLocalEntries(choirCode: string, entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const map = new Map(localEntries(choirCode).map((e) => [entryId(e), e]));
  for (const raw of entries) {
    const e = sanitizeEntry(raw);
    if (!e) continue;
    const prev = map.get(entryId(e));
    if (!prev || prev.updatedAt <= e.updatedAt) map.set(entryId(e), e);
  }
  const out = [...map.values()];
  writeJSON(localKey(choirCode), out);
  return out;
}

/** Remove an entry that was added from a share code. */
export function removeLocalEntry(choirCode: string, name: string, pieceId: string): void {
  const rest = localEntries(choirCode).filter((e) => !(e.name === name && e.pieceId === pieceId));
  writeJSON(localKey(choirCode), rest);
}

/** Paste handler for "Add a ranking code": merges every SH1 code found in the text. Returns how many were added. */
export function importShareCodes(choirCode: string, text: string): number {
  const found = (text.match(/SH1\.[A-Za-z0-9_-]+/g) ?? [])
    .map(decodeShareCode)
    .filter((e): e is LeaderboardEntry => e !== null);
  if (found.length) mergeLocalEntries(choirCode, found);
  return found.length;
}

// ---------------------------------------------------------------- backends

export interface LeaderboardBackend {
  kind: 'http' | 'local';
  list(choirCode: string, pieceId?: string): Promise<LeaderboardEntry[]>;
  put(choirCode: string, entry: LeaderboardEntry): Promise<void>;
}

export const localBackend: LeaderboardBackend = {
  kind: 'local',
  async list(code, pieceId) {
    const all = localEntries(code);
    return pieceId ? all.filter((e) => e.pieceId === pieceId) : all;
  },
  async put(code, entry) {
    mergeLocalEntries(code, [entry]);
  },
};

export function httpBackend(baseUrl: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): LeaderboardBackend {
  const base = baseUrl.replace(/\/+$/, '');
  const choirUrl = (code: string) => `${base}/choirs/${encodeURIComponent(code)}/entries`;
  return {
    kind: 'http',
    async list(code, pieceId) {
      const url = choirUrl(code) + (pieceId ? `?pieceId=${encodeURIComponent(pieceId)}` : '');
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`Leaderboard unavailable (${res.status})`);
      const body = await res.json();
      const arr: unknown[] = Array.isArray(body) ? body : Array.isArray(body?.entries) ? body.entries : [];
      const entries = arr.map(sanitizeEntry).filter((e): e is LeaderboardEntry => e !== null);
      // Keep imported share-code entries visible alongside server ones.
      const merged = new Map(localEntries(code).filter((e) => !pieceId || e.pieceId === pieceId).map((e) => [entryId(e), e]));
      for (const e of entries) {
        const p = merged.get(entryId(e));
        if (!p || p.updatedAt <= e.updatedAt) merged.set(entryId(e), e);
      }
      return [...merged.values()];
    },
    async put(code, entry) {
      const res = await fetchImpl(`${choirUrl(code)}/${encodeURIComponent(entry.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error(`Could not post to leaderboard (${res.status})`);
    },
  };
}

function envUrl(): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const v = env?.VITE_LEADERBOARD_URL;
    return v && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** HTTP backend when VITE_LEADERBOARD_URL is set, otherwise the offline local backend. */
export function getLeaderboardBackend(): LeaderboardBackend {
  const url = envUrl();
  return url ? httpBackend(url) : localBackend;
}
