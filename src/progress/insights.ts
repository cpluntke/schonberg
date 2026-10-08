// What section leads and choir admins see of the progress members share (server:
// utils/schonberg_insights.py in the messiermarathon repo): progress only as aggregates (no names),
// distributions only from MIN_GROUP singers on; plus each sharing singer's voice range by name.
// Also the super admin's anonymous usage statistics (utils/schonberg_metrics.py).

import type { Profile } from './store';
import { apiBase, ChoirApiError, endSession, endSuperSession, loadSession, loadSuperSession, type Auth } from './choir';

export const VOICE_ORDER = ['S', 'A', 'T', 'B'] as const;

export interface BarAgg { n: number; weak: number; mean: number }
/** A note at least two singers of the section keep getting wrong: how many (n), and their usual faults. */
export interface NoteAgg { i: number; n: number; kinds: Record<string, number> }
export interface PieceTrend { state: 'improving' | 'stalling' | 'slipping'; since: string; readiness: [number, number]; ready: [number, number] }
export interface PieceAgg {
  singers: number;
  active: number;
  /** Fewer than minGroup singers: counts only. */
  hidden?: boolean;
  /** Singers at piece level 0..5. */
  levels?: number[];
  rehearsalReady?: number;
  concertReady?: number;
  readiness?: number;
  bars?: Record<string, BarAgg>;
  hardest?: (BarAgg & { bar: number })[];
  /** The rehearsal cheat sheet, per part (divisi parts number their notes apart; "": not said), most struggled first. */
  noteParts?: Record<string, NoteAgg[]>;
  trend?: PieceTrend;
}
export interface SingerRange { name: string; measured: boolean; lo?: number; hi?: number; reachLo?: number; reachHi?: number; at?: number }
export interface SectionInsightsView {
  voice: string;
  sharing: number;
  activeWeek: number;
  minGroup: number;
  pieces: Record<string, PieceAgg>;
  ranges: SingerRange[];
}
/** Admins: who uses the app (sharing or on the leaderboard); lastAt: their leaderboard entry's last change (0: not on it). */
export interface ChoirSinger { name: string; voice: string; lastAt: number }
export interface ChoirInsightsView { minGroup: number; sections: Record<string, SectionInsightsView>; singers?: ChoirSinger[] }

async function get<T>(path: string, auth: Auth): Promise<T> {
  const base = apiBase();
  if (!base) throw new ChoirApiError(0, 'Choirs need the online version of the app.');
  const headers: Record<string, string> = {};
  if ('bearer' in auth) headers.Authorization = `Bearer ${auth.bearer}`;
  else headers['X-Super-Admin'] = auth.superAdmin;
  let res: Response;
  try { res = await fetch(base + path, { headers }); } catch { throw new ChoirApiError(0, 'No connection to the server.'); }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    // The server ended this session (expired, logged out elsewhere, account removed): forget it here too.
    if (res.status === 401 && 'bearer' in auth && loadSession()?.token === auth.bearer) endSession();
    if (res.status === 401 && 'bearer' in auth && loadSuperSession()?.token === auth.bearer) endSuperSession();
    throw new ChoirApiError(res.status, (body as { error?: string } | null)?.error ?? `Server error (${res.status})`);
  }
  return body as T;
}

const enc = encodeURIComponent;
export const fetchSectionInsights = (code: string, voice: string, auth: Auth) =>
  get<SectionInsightsView>(`/choirs/${enc(code)}/insights/${enc(voice)}`, auth);
export const fetchChoirInsights = (code: string, auth: Auth) => get<ChoirInsightsView>(`/choirs/${enc(code)}/insights`, auth);

// ------------------------------------------------------------------ voice ranges

export interface SharedRange { lo: number; hi: number; reachLo?: number; reachHi?: number; at?: number }

/** My range for the shared progress (steady range; the reach only when it contains it). */
export function sharedRange(p: Pick<Profile, 'rangeLow' | 'rangeHigh' | 'rangeReachLow' | 'rangeReachHigh' | 'rangeAt'>): SharedRange | undefined {
  const lo = p.rangeLow, hi = p.rangeHigh;
  if (lo == null || hi == null || !(lo < hi) || lo < 24 || hi > 108) return undefined;
  const r: SharedRange = { lo: Math.round(lo), hi: Math.round(hi) };
  const rl = p.rangeReachLow, rh = p.rangeReachHigh;
  if (rl != null && rh != null && rl <= lo && rh >= hi && rl < rh) { r.reachLo = Math.round(rl); r.reachHi = Math.round(rh); }
  if (p.rangeAt && p.rangeAt > 0) r.at = p.rangeAt;
  return r;
}

/** Usual range of each voice type (as in Voice setup). */
export const USUAL_RANGE: Record<string, [number, number]> = { S: [60, 81], A: [55, 74], T: [48, 69], B: [40, 62] };

const LETTERS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export function noteName(midi: number): string {
  const m = Math.round(midi);
  return `${LETTERS[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** Where a singer's steady range doesn't cover the notes the section sings ("top A4 above steady range"). */
export function rangeFlags(r: SingerRange, part: [number, number] | null): string[] {
  if (!r.measured || r.lo == null || r.hi == null || !part) return [];
  const out: string[] = [];
  if (part[1] > r.hi) out.push(`top ${noteName(part[1])} above steady range${r.reachHi != null && r.reachHi >= part[1] ? ' (within reach)' : ''}`);
  if (part[0] < r.lo) out.push(`bottom ${noteName(part[0])} below steady range${r.reachLo != null && r.reachLo <= part[0] ? ' (within reach)' : ''}`);
  return out;
}

// ------------------------------------------------------------------ usage statistics (super admin)

export interface MetricsDay {
  day: string;
  installs: number;
  c: Record<string, number>;
  u: Record<string, number>;
  tech: Record<string, number>;
  jserr: Record<string, number>;
  wau?: number;
  mau?: number;
  ret?: { base: number; back: number };
  frozen?: boolean;
  live?: boolean;
}
export interface MetricsView { days: MetricsDay[]; today: string; acceptDays: number }
export const fetchMetrics = (auth: Auth, days: number) => get<MetricsView>(`/super/metrics?days=${days}`, auth);
/** The last 24 hours (UTC hours, the current one so far last); `total` counts each install once. */
export interface LiveHour { hour: string; installs: number; c: Record<string, number>; jserr: Record<string, number> }
export interface LiveView { hours: LiveHour[]; total: MetricsDay; now: string }
export const fetchLiveMetrics = (auth: Auth) => get<LiveView>('/super/metrics/live', auth);

/** Sum of the counters whose key matches. */
export function sumKeys(days: MetricsDay[], match: (k: string) => boolean, field: 'c' | 'u' | 'tech' = 'c'): number {
  let t = 0;
  for (const d of days) for (const [k, v] of Object.entries(d[field] ?? {})) if (match(k)) t += v;
  return t;
}

/** One row per day, one column per counter (CSV for a spreadsheet). */
export function metricsCsv(days: MetricsDay[]): string {
  const keys = new Set<string>();
  for (const d of days) {
    for (const k of Object.keys(d.c ?? {})) keys.add(`c:${k}`);
    for (const k of Object.keys(d.u ?? {})) keys.add(`installs_using:${k}`);
    for (const k of Object.keys(d.tech ?? {})) keys.add(`tech:${k}`);
  }
  const cols = [...keys].sort();
  const head = ['day', 'installs', 'wau', 'mau', 'return_base', 'return_back', ...cols];
  const rows = days.map((d) => [
    d.day, d.installs ?? 0, d.wau ?? '', d.mau ?? '', d.ret?.base ?? '', d.ret?.back ?? '',
    ...cols.map((k) => {
      const [f, key] = k.split(/:(.*)/s);
      const src = f === 'c' ? d.c : f === 'tech' ? d.tech : d.u;
      return src?.[key] ?? 0;
    }),
  ]);
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
