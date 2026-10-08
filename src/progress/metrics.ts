// Anonymous usage statistics (docs/PRIVACY.md): daily counters sent once a day, plus hourly ones for the last 24 hours.
//
// - A random install id made for this alone (never the member token, the account or the name). It is
//   stored outside the app's `sh:` keys, so backups and synced progress never carry it.
// - Today's counters pile up on this phone; the first time the app is opened (or hidden) on a later
//   day, the finished days go to POST /schonberg/api/metrics in one small request. Days that can't be
//   sent within a week are dropped.
// - For the super admin's "last 24 hours" view, the same counters are also kept per UTC hour and, while
//   the app is in use, what was counted since the last send goes to POST /schonberg/api/metrics/live
//   (every few minutes at most, and when the app is hidden). The server keeps those hours for two days.
// - On by default, off when the browser asks not to be tracked (Do Not Track / Global Privacy Control)
//   unless the singer turns it on; the switch is in Settings. Turning it off deletes what's pending.

import { apiBase } from './choir';

const ID_KEY = 'shm:anonId';
const OPT_KEY = 'shm:usageStats';
const DATA_KEY = 'shm:usage';
/** The server takes days up to a week old; older ones are dropped here too. */
const KEEP_DAYS = 7;
const MAX_KEYS_PER_DAY = 250;
const MAX_JS_ERRORS_PER_DAY = 10;
const MAX_TRIES = 300;
/** Live (hourly) counts: sent at most this often, kept on the phone at most this long. */
export const LIVE_EVERY = 5 * 60_000;
const LIVE_KEEP_H = 47;
const MAX_LIVE_HOURS = 8;

export interface UsageData {
  /** local day (YYYY-MM-DD) → counter → count */
  days: Record<string, Record<string, number>>;
  /** The day of the last send attempt (at most one a day). */
  sentOn?: string;
  /** One-time onboarding steps already counted on this install. */
  onb?: string[];
  /** Attempts so far at a section and level not yet passed (for attempts-to-pass). */
  tries?: Record<string, number>;
  /** UTC hour (YYYY-MM-DDTHH) → counter → count, counted since the last live send. */
  live?: Record<string, Record<string, number>>;
  /** A live send not yet answered: sent again as it is (same batch), so the server counts it once. */
  liveOut?: { batch: string; hours: { hour: string; c: Record<string, number> }[] };
  /** When the last live send was tried (ms). */
  liveAt?: number;
}

// ------------------------------------------------------------------ storage (never throws)

function get(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function set(key: string, v: string | null): void {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch { /* storage blocked: nothing is collected */ }
}

function load(): UsageData {
  try {
    const d = JSON.parse(get(DATA_KEY) || 'null');
    if (d && typeof d === 'object' && d.days && typeof d.days === 'object') return d as UsageData;
  } catch { /* fresh start */ }
  return { days: {} };
}
function save(d: UsageData): void { set(DATA_KEY, JSON.stringify(d)); }

export function localDay(t: number | Date = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The UTC hour of a time, as the server files it. */
export function utcHour(t: number = Date.now()): string {
  return new Date(t).toISOString().slice(0, 13);
}

/** Also count in this hour's live bucket (inside a load/save). */
function addLive(d: UsageData, key: string, n: number, now: number, replaceFamily?: string): void {
  const h = (d.live ??= {})[utcHour(now)] ??= {};
  if (replaceFamily) for (const k of Object.keys(h)) if (k.startsWith(replaceFamily) && k !== key) delete h[k];
  if (!(key in h) && Object.keys(h).length >= MAX_KEYS_PER_DAY) return;
  h[key] = replaceFamily ? 1 : Math.round((h[key] ?? 0) + n);
}

// ------------------------------------------------------------------ consent

/** The browser asks sites not to track (Do Not Track or Global Privacy Control). */
export function browserSaysDoNotTrack(): boolean {
  try {
    const n = navigator as Navigator & { doNotTrack?: string | null; msDoNotTrack?: string; globalPrivacyControl?: boolean };
    const w = window as Window & { doNotTrack?: string };
    return n.doNotTrack === '1' || n.doNotTrack === 'yes' || w.doNotTrack === '1' || n.msDoNotTrack === '1' || n.globalPrivacyControl === true;
  } catch {
    return false;
  }
}

/** On unless switched off; with Do Not Track, off unless switched on. */
export function usageStatsOn(): boolean {
  const v = get(OPT_KEY);
  if (v === 'on') return true;
  if (v === 'off') return false;
  return !browserSaysDoNotTrack();
}

/** True when the setting is the default (nobody chose yet). */
export function usageStatsDefault(): boolean { return get(OPT_KEY) == null; }

export function setUsageStats(on: boolean): void {
  set(OPT_KEY, on ? 'on' : 'off');
  if (!on) set(DATA_KEY, null);
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();
export function onUsageStatsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The random id of this install (only for counting it once a day on the server). */
export function installId(): string {
  let id = get(ID_KEY);
  if (!id || !/^[0-9a-f]{32}$/.test(id)) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    id = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    set(ID_KEY, id);
  }
  return id;
}

// ------------------------------------------------------------------ counting

/** Add to today's counter (nothing when switched off). */
export function track(key: string, n = 1, now: number = Date.now()): void {
  if (!usageStatsOn() || !(n > 0) || !Number.isFinite(n)) return;
  const d = load();
  const day = localDay(now);
  const c = (d.days[day] ??= {});
  if (!(key in c)) {
    if (Object.keys(c).length >= MAX_KEYS_PER_DAY) return;
    if (key.startsWith('jserr.') && Object.keys(c).filter((k) => k.startsWith('jserr.')).length >= MAX_JS_ERRORS_PER_DAY) return;
  }
  c[key] = Math.round((c[key] ?? 0) + n);
  addLive(d, key, n, now);
  save(d);
}

/** Set a once-a-day fact (e.g. this install's delay bucket today), replacing others of its family. */
export function trackOnce(family: string, key: string, now: number = Date.now()): void {
  if (!usageStatsOn()) return;
  const d = load();
  const c = (d.days[localDay(now)] ??= {});
  for (const k of Object.keys(c)) if (k.startsWith(family) && k !== key) delete c[k];
  c[key] = 1;
  addLive(d, key, 1, now, family);
  save(d);
}

/** A first-time onboarding step (counted once per install). */
export function trackStep(step: 'setup_started' | 'choir_step' | 'range_done' | 'range_skipped' | 'delay_done' | 'delay_skipped' | 'first_run' | 'first_pass', now: number = Date.now()): void {
  if (!usageStatsOn()) return;
  const d = load();
  if (d.onb?.includes(step)) return;
  d.onb = [...(d.onb ?? []), step];
  save(d);
  track(`onb.${step}`, 1, now);
}

/** Short stable hash of an error message (the message itself never leaves the phone). */
export function errorHash(msg: string): string {
  const s = String(msg).split('\n')[0].replace(/\d+/g, '#').slice(0, 200);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function trackError(msg: unknown): void {
  track('err.js');
  track(`jserr.${errorHash(msg instanceof Error ? `${msg.name}: ${msg.message}` : String(msg))}`);
}

const DUR_BUCKETS: [number, string][] = [[0.25, 'xs'], [0.6, 's'], [1.5, 'm'], [Infinity, 'l']];
const LAT_BUCKETS = [300, 200, 150, 100, 50, 0];
const ATT_BUCKETS: [number, string][] = [[1, '1'], [2, '2'], [3, '3'], [5, '4_5'], [10, '6_10'], [Infinity, '11p']];
const DAY_BUCKETS: [number, string][] = [[1, 'd0_1'], [3, 'd2_3'], [7, 'd4_7'], [14, 'd8_14'], [30, 'd15_30'], [Infinity, 'd31p']];
const bucket = <T>(v: number, list: [number, T][]): T => list.find(([max]) => v <= max)![1];
export const durationBucket = (sec: number) => DUR_BUCKETS.find(([max]) => sec < max)![1];
export const latencyBucket = (ms: number) => String(LAT_BUCKETS.find((b) => ms >= b) ?? 0);
export const attemptsBucket = (n: number) => bucket(n, ATT_BUCKETS);
export const daysBucket = (d: number) => bucket(Math.max(0, d), DAY_BUCKETS);

export type RunKind = 'section' | 'full' | 'drill' | 'arcade' | 'words' | 'cold' | 'listen' | 'practice';

export interface RunFacts {
  kind: RunKind;
  level: number;
  passed: boolean;
  /** Counted toward a level (section ladder, counted full run, counted words stage). */
  counted: boolean;
  seconds: number;
  /** Section / level key for attempts-to-pass (counted runs only). */
  triesKey?: string;
  display?: 'score' | 'highway' | 'fullscore';
  /** Per note: its real duration (s) and whether it was hit. */
  notes?: { sec: number; hit: boolean }[];
  delaySuggested?: boolean;
  timingUnsure?: boolean;
  timingFail?: boolean;
  aligned?: boolean;
  latency?: { ms: number; source: 'measured' | 'learned' | 'est' };
  /** counted = the run opened its level; tooMuch = more than half slipped (practice); blocked = earlier rules (a fix list locked the run). */
  full?: { counted: boolean; toFix: number; tooMuch?: boolean; blocked?: boolean };
  /** The piece became rehearsal-ready in this run: calendar days since it was first practised. */
  rehearsalReadyAfterDays?: number;
}

/** Everything one finished run tells the statistics. */
export function trackRun(f: RunFacts, now: number = Date.now()): void {
  if (!usageStatsOn()) return;
  const L = `L${Math.max(0, Math.min(5, Math.round(f.level)))}`;
  track(`run.${f.kind}.${L}`, 1, now);
  if (f.passed && f.kind !== 'listen' && f.kind !== 'practice') track(`pass.${f.kind}.${L}`, 1, now);
  if (f.seconds > 0) track('sec.practice', Math.round(f.seconds), now);
  trackStep('first_run', now);
  if (f.passed && f.counted) trackStep('first_pass', now);
  if (f.display) track(`feat.${f.display}`, 1, now);
  if (f.kind === 'arcade') track('feat.arcade', 1, now);
  if (f.kind === 'cold') track('feat.cold', 1, now);
  if (f.kind === 'words') track('feat.words', 1, now);
  if (f.level >= 5 && f.kind !== 'listen') track('feat.l5', 1, now);
  if (f.kind !== 'listen' && f.kind !== 'words') {
    track('q.runs', 1, now);
    if (f.delaySuggested) track('q.delay_suggested', 1, now);
    if (f.timingUnsure) track('q.timing_unsure', 1, now);
    if (f.timingFail) track('q.timing_fail', 1, now);
    if (f.aligned) track('q.aligned', 1, now);
  }
  if (f.notes?.length) {
    const n: Record<string, number> = {};
    for (const x of f.notes) {
      const b = durationBucket(x.sec);
      n[`acc.${b}.n`] = (n[`acc.${b}.n`] ?? 0) + 1;
      if (x.hit) n[`acc.${b}.hit`] = (n[`acc.${b}.hit`] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(n)) track(k, v, now);
  }
  if (f.latency) trackOnce('lat.', `lat.${f.latency.source}.${latencyBucket(f.latency.ms)}`, now);
  if (f.full) {
    if (f.full.blocked) track('full.blocked', 1, now);
    else if (f.full.tooMuch) track('full.toomuch', 1, now);
    else if (f.full.counted) track(f.full.toFix ? 'full.tofix' : 'full.clean', 1, now);
  }
  if (f.rehearsalReadyAfterDays != null) track(`t2rr.${daysBucket(f.rehearsalReadyAfterDays)}`, 1, now);
  if (f.counted && f.triesKey && f.level >= 1) {
    const d = load();
    const tries = (d.tries ??= {});
    const k = `${f.triesKey}|${L}`;
    tries[k] = (tries[k] ?? 0) + 1;
    if (f.passed) {
      const n = tries[k];
      delete tries[k];
      save(d);
      track(`att2pass.${L}.${attemptsBucket(n)}`, 1, now);
      return;
    }
    const keys = Object.keys(tries);
    if (keys.length > MAX_TRIES) for (const x of keys.slice(0, keys.length - MAX_TRIES)) delete tries[x];
    save(d);
  }
}

// ------------------------------------------------------------------ sending

/** The finished days waiting to be sent (oldest first, at most a week back). */
export function pendingDays(now: number = Date.now()): { day: string; c: Record<string, number> }[] {
  const d = load();
  const today = localDay(now);
  const oldest = localDay(now - KEEP_DAYS * 86_400_000);
  return Object.keys(d.days).sort().filter((k) => k < today && k >= oldest && Object.keys(d.days[k]).length)
    .map((k) => ({ day: k, c: d.days[k] }));
}

let sending = false;

/**
 * Send the finished days, at most once a day (the first call on a new day). Called when the app
 * starts and when it's hidden. Never throws.
 */
export async function flushUsage(now: number = Date.now(), base: string | null = apiBase()): Promise<boolean> {
  if (sending) return false;
  const d = load();
  const today = localDay(now);
  const oldest = localDay(now - KEEP_DAYS * 86_400_000);
  // Forget days too old to be taken.
  let pruned = false;
  for (const k of Object.keys(d.days)) if (k < oldest) { delete d.days[k]; pruned = true; }
  if (pruned) save(d);
  if (!usageStatsOn() || !base || d.sentOn === today) return false;
  const days = pendingDays(now);
  if (!days.length) return false;
  d.sentOn = today;
  save(d);
  sending = true;
  try {
    const res = await fetch(`${base}/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, id: installId(), days: days.slice(-8) }),
      keepalive: true,
    });
    if (!res.ok && res.status !== 400) return false; // try again tomorrow
    const after = load();
    for (const x of days) delete after.days[x.day];
    save(after);
    return true;
  } catch {
    return false;
  } finally {
    sending = false;
  }
}

let sendingLive = false;

function batchId(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Send what was counted since the last live send (for the "last 24 hours" view), at most every
 * LIVE_EVERY. A send whose answer was lost goes again as the same batch. Never throws.
 */
export async function flushLive(now: number = Date.now(), base: string | null = apiBase()): Promise<boolean> {
  if (sendingLive || !usageStatsOn() || !base) return false;
  const d = load();
  const oldest = utcHour(now - LIVE_KEEP_H * 3_600_000);
  if (d.liveOut) d.liveOut.hours = d.liveOut.hours.filter((x) => x.hour >= oldest);
  if (d.liveOut && !d.liveOut.hours.length) delete d.liveOut;
  for (const h of Object.keys(d.live ?? {})) if (h < oldest || !Object.keys(d.live![h]).length) delete d.live![h];
  if (d.liveAt != null && now - d.liveAt < LIVE_EVERY && d.liveAt <= now) { save(d); return false; }
  if (!d.liveOut) {
    const hours = Object.keys(d.live ?? {}).sort().slice(-MAX_LIVE_HOURS).map((hour) => ({ hour, c: d.live![hour] }));
    if (!hours.length) { save(d); return false; }
    d.liveOut = { batch: batchId(), hours };
    d.live = {};
  }
  d.liveAt = now;
  save(d);
  const out = d.liveOut;
  sendingLive = true;
  try {
    const res = await fetch(`${base}/metrics/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, id: installId(), batch: out.batch, hours: out.hours }),
      keepalive: true,
    });
    if (!res.ok && res.status !== 400) return false; // the same batch goes again next time
    const after = load();
    if (after.liveOut?.batch === out.batch) delete after.liveOut;
    save(after);
    return true;
  } catch {
    return false;
  } finally {
    sendingLive = false;
  }
}

/** For Settings and the tests: what would be sent (finished days) and today's running counters. */
export function usageSnapshot(now: number = Date.now()): { pending: number; today: Record<string, number> } {
  return { pending: pendingDays(now).length, today: load().days[localDay(now)] ?? {} };
}

let installed = false;
/** Start: send yesterday's summary if due, count JS errors, send again when the app is hidden on a new day. */
export function installUsageStats(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  void flushUsage();
  void flushLive();
  setInterval(() => { if (document.visibilityState === 'visible') void flushLive(); }, LIVE_EVERY + 1000);
  window.addEventListener('error', (e) => { try { trackError(e.error ?? e.message); } catch { /* ignore */ } });
  window.addEventListener('unhandledrejection', (e) => { try { trackError(e.reason); } catch { /* ignore */ } });
  const onHide = () => { if (document.visibilityState === 'hidden') { void flushUsage(); void flushLive(); } };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', () => { void flushUsage(); void flushLive(); });
}

/** Test helper. */
export function _resetUsageForTests(): void {
  for (const k of [ID_KEY, OPT_KEY, DATA_KEY]) set(k, null);
  sending = false;
  sendingLive = false;
}
