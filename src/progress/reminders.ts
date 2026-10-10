// A daily practice reminder by Web Push (You → Practice → Daily reminder; docs/PRIVACY.md).
// The browser makes a push subscription for the choir server's key; the app sends it with the time
// and the phone's time zone, and tells the server the day the singer first practised, so the reminder
// only comes on days without practice. No name, no account: the server knows only the subscription
// (utils/schonberg_reminders.py in the server repo).

import { apiBase } from './choir';
import { dayKey, practiceDays, subscribe as onStoreChange } from './store';

// This phone only: outside the sh: keys, so backups and synced progress never carry it (a restored
// backup on a new phone must not believe it has a reminder).
const KEY = 'shr:reminder';
export const DEFAULT_TIME = '18:00';
/** Re-sent to the server at most this often when nothing changed (the app start re-asserts it). */
export const REASSERT_MS = 6 * 3600_000;
/** After the day's first practice, the "practised today" goes out this long after the last change. */
export const PRACTISED_DEBOUNCE_MS = 3000;
const RETRY_MS = 60_000;

export interface ReminderState {
  on: boolean;
  time: string; // 'HH:MM', local
  endpoint?: string; // the subscription the server knows
  assertedAt?: number; // when it was last sent to the server
  practisedSent?: string; // the last day posted as practised
  offered?: boolean; // the Today-done card offered it once
  pendingOff?: string; // an endpoint whose removal the server didn't confirm yet
}

export type ReminderSupport = 'ok' | 'ios-home-screen' | 'ios-too-old' | 'unsupported' | 'denied' | 'no-server';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const listeners = new Set<() => void>();

export function loadReminder(): ReminderState {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ReminderState> | null;
    if (o && typeof o === 'object') {
      return {
        ...o,
        on: o.on === true,
        time: typeof o.time === 'string' && TIME_RE.test(o.time) ? o.time : DEFAULT_TIME,
      };
    }
  } catch { /* storage blocked or damaged */ }
  return { on: false, time: DEFAULT_TIME };
}

function saveReminder(patch: Partial<ReminderState>): ReminderState {
  const next = { ...loadReminder(), ...patch };
  for (const k of Object.keys(next) as (keyof ReminderState)[]) if (next[k] === undefined) delete next[k];
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  for (const cb of [...listeners]) { try { cb(); } catch { /* ignore */ } }
  return next;
}

export function onReminderChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The choir server's API (dev server only: an e2e test may set one, as the dev build has none). */
function base(): string | null {
  const b = apiBase();
  if (b) return b;
  if (import.meta.env.DEV) {
    try { return localStorage.getItem('shr:devApi'); } catch { return null; }
  }
  return null;
}

// ---------------------------------------------------------------- support

/** What the browser offers (globals passed in for tests). */
export function reminderSupport(g: typeof globalThis = globalThis): ReminderSupport {
  const nav = g.navigator as (Navigator & { standalone?: boolean }) | undefined;
  if (!nav) return 'unsupported';
  const ua = nav.userAgent ?? '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  let standalone = nav.standalone === true;
  try { standalone ||= !!g.matchMedia?.('(display-mode: standalone)').matches; } catch { /* ignore */ }
  const push = 'serviceWorker' in nav && 'PushManager' in g && 'Notification' in g;
  // iPhone and iPad: web push only for an app added to the Home Screen (iOS 16.4 and later).
  if (ios && !standalone) return 'ios-home-screen';
  if (!push) return ios ? 'ios-too-old' : 'unsupported';
  if (!base()) return 'no-server';
  if ((g as unknown as { Notification: { permission?: string } }).Notification.permission === 'denied') return 'denied';
  return 'ok';
}

/** What to tell the singer when reminders can't be switched on ('' when they can). */
export function supportNote(s: ReminderSupport): string {
  switch (s) {
    case 'ios-home-screen': return 'On iPhone, add Schönberg Hero to your Home Screen first (Share → Add to Home Screen), then open it from there.';
    case 'ios-too-old': return 'Reminders need iOS 16.4 or later.';
    case 'unsupported': return "Your browser doesn't support reminders.";
    case 'denied': return "Notifications are blocked for Schönberg Hero. Allow them in your browser's or phone's settings, then switch the reminder on.";
    case 'no-server': return 'Reminders need the choir server: this copy of the app runs without one.';
    default: return '';
  }
}

/** Offer the reminder once on Today done: only when it can work and isn't on. */
export function shouldOfferReminder(): boolean {
  const st = loadReminder();
  return !st.on && !st.offered && reminderSupport() === 'ok';
}
export function markReminderOffered(): void { saveReminder({ offered: true }); }

// ---------------------------------------------------------------- payloads

export function timeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function practisedToday(now = Date.now()): string | undefined {
  const today = dayKey(now);
  return practiceDays(3).includes(today) ? today : undefined;
}

/** What POST /reminders gets: the subscription, the time and zone, and today if already practised. */
export function subscribePayload(sub: PushSubscriptionJSON, time: string, tz: string, practised?: string, replaces?: string) {
  return {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } },
    time,
    tz,
    ...(practised ? { practised } : {}),
    ...(replaces ? { replaces } : {}),
  };
}

export function keyBytes(b64url: string): Uint8Array {
  const s = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // (not exposed: assume it is ours)
  const a = new Uint8Array(k);
  return a.length === key.length && a.every((x, i) => x === key[i]);
}

// ---------------------------------------------------------------- the server

async function call(path: string, method: string, body?: unknown): Promise<Response | null> {
  const b = base();
  if (!b) return null;
  try {
    return await fetch(`${b}/reminders${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return null; // offline
  }
}

async function serverKey(): Promise<Uint8Array | null> {
  const r = await call('/key', 'GET');
  if (!r?.ok) return null;
  try {
    const k = (await r.json() as { publicKey?: unknown }).publicKey;
    return typeof k === 'string' && k.length > 40 ? keyBytes(k) : null;
  } catch {
    return null;
  }
}

async function registration(ms = 10_000): Promise<ServiceWorkerRegistration | null> {
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((res) => setTimeout(() => res(null), ms)),
    ]);
  } catch {
    return null;
  }
}

/** This phone's subscription for the server's key: the current one, or a new one (replacing one made for another key). */
async function ensureSubscription(reg: ServiceWorkerRegistration, key: Uint8Array): Promise<PushSubscription | null> {
  try {
    let s = await reg.pushManager.getSubscription();
    if (s && !sameKey(s, key)) {
      await s.unsubscribe().catch(() => false);
      s = null;
    }
    return s ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
  } catch {
    return null;
  }
}

async function postSubscription(sub: PushSubscription, time: string, replaces?: string): Promise<boolean> {
  const practised = practisedToday();
  const r = await call('', 'POST', subscribePayload(sub.toJSON(), time, timeZone(), practised, replaces !== sub.endpoint ? replaces : undefined));
  if (!r?.ok) return false;
  saveReminder({ endpoint: sub.endpoint, assertedAt: Date.now(), ...(practised ? { practisedSent: practised } : {}) });
  rememberTz();
  return true;
}

export type EnableResult = { ok: true } | { ok: false; reason: string };

/** Switch the reminder on (asks for notification permission: call it from the singer's tap only). */
export async function enableReminders(time: string = loadReminder().time): Promise<EnableResult> {
  const t = TIME_RE.test(time) ? time : DEFAULT_TIME;
  const s = reminderSupport();
  if (s !== 'ok') return { ok: false, reason: supportNote(s) };
  let perm = Notification.permission;
  if (perm !== 'granted') {
    try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; }
  }
  if (perm !== 'granted') {
    return { ok: false, reason: perm === 'denied' ? supportNote('denied') : 'Reminders need permission to show a notification.' };
  }
  const reg = await registration();
  if (!reg?.pushManager) return { ok: false, reason: "The app isn't fully installed yet. Reload it once and try again." };
  const key = await serverKey();
  if (!key) return { ok: false, reason: "Couldn't reach the choir server. Try again when you're online." };
  const sub = await ensureSubscription(reg, key);
  if (!sub) return { ok: false, reason: "Your browser couldn't set up notifications. Try again later." };
  const prev = loadReminder().endpoint;
  if (!(await postSubscription(sub, t, prev))) return { ok: false, reason: "Couldn't reach the choir server. Try again when you're online." };
  saveReminder({ on: true, time: t, offered: true, pendingOff: undefined });
  return { ok: true };
}

/** Switch it off: the server forgets the subscription (retried on the next start if offline), and so does the browser. */
export async function disableReminders(): Promise<void> {
  const st = loadReminder();
  saveReminder({ on: false, endpoint: undefined, assertedAt: undefined });
  let sub: PushSubscription | null = null;
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const reg = await registration(3000);
    sub = await reg?.pushManager?.getSubscription().catch(() => null) ?? null;
  }
  const endpoint = st.endpoint ?? sub?.endpoint;
  if (endpoint) {
    const r = await call('', 'DELETE', { endpoint });
    if (!r?.ok) saveReminder({ pendingOff: endpoint });
  }
  await sub?.unsubscribe().catch(() => false);
}

/** A new time: kept, and sent to the server when the reminder is on. */
/** A time picker may report each field as it is typed: the server hears the time once it settles. */
export const TIME_DEBOUNCE_MS = 800;
let timeTimer: ReturnType<typeof setTimeout> | null = null;
let timeWaiters: ((ok: boolean) => void)[] = [];

/** A new time: kept, and sent to the server (debounced) when the reminder is on. */
export function setReminderTime(time: string): Promise<boolean> {
  if (!TIME_RE.test(time)) return Promise.resolve(false);
  // (not yet told to the server: the next start, or coming back online, sends it if this send fails)
  const st = saveReminder({ time, assertedAt: undefined });
  if (!st.on) return Promise.resolve(true);
  if (timeTimer) clearTimeout(timeTimer);
  return new Promise<boolean>((resolve) => {
    timeWaiters.push(resolve);
    timeTimer = setTimeout(() => {
      timeTimer = null;
      const waiting = timeWaiters;
      timeWaiters = [];
      void reassertReminder(true).then((ok) => waiting.forEach((w) => w(ok)));
    }, TIME_DEBOUNCE_MS);
  });
}

let asserting: Promise<boolean> | null = null;
/**
 * On app start: the server hears about the subscription again (its endpoint may have changed, the
 * phone may be in another time zone), at most every REASSERT_MS unless something changed. A
 * permission taken back in the browser's settings switches the reminder off.
 */
export function reassertReminder(force = false): Promise<boolean> {
  // (one at a time; a forced one waits for the one under way, which may carry an older time)
  if (asserting) return force ? asserting.then(() => reassertReminder(true)) : asserting;
  asserting = (async () => {
    const st = loadReminder();
    if (st.pendingOff && !st.on) {
      const r = await call('', 'DELETE', { endpoint: st.pendingOff });
      if (r?.ok) saveReminder({ pendingOff: undefined });
    }
    if (!st.on) return false;
    const s = reminderSupport();
    if (s === 'denied' || s === 'unsupported' || s === 'ios-home-screen' || s === 'ios-too-old') {
      await disableReminders();
      return false;
    }
    if (s !== 'ok' || Notification.permission !== 'granted') return false;
    const reg = await registration();
    if (!reg?.pushManager) return false;
    const cur = await reg.pushManager.getSubscription().catch(() => null);
    const tzChanged = st.endpoint != null && lastTz() !== timeZone();
    if (!force && cur && cur.endpoint === st.endpoint && !tzChanged && Date.now() - (st.assertedAt ?? 0) < REASSERT_MS) return true;
    const key = await serverKey();
    if (!key) return false;
    const sub = await ensureSubscription(reg, key);
    if (!sub) return false;
    return postSubscription(sub, st.time, st.endpoint);
  })().finally(() => { asserting = null; });
  return asserting;
}

const TZ_KEY = 'shr:reminderTz';
function lastTz(): string | null { try { return localStorage.getItem(TZ_KEY); } catch { return null; } }
function rememberTz(): void { try { localStorage.setItem(TZ_KEY, timeZone()); } catch { /* ignore */ } }

// ---------------------------------------------------------------- practised today

let practisedTimer: ReturnType<typeof setTimeout> | null = null;
let lastTry = 0;

/**
 * After a run (any change of the store): once the singer has practised today, tell the server (the
 * date only), debounced and at most once a day.
 */
export function notePractised(now = Date.now()): void {
  const st = loadReminder();
  if (!st.on || !st.endpoint) return;
  const today = dayKey(now);
  if (st.practisedSent === today || practisedToday(now) !== today) return;
  if (practisedTimer) clearTimeout(practisedTimer);
  practisedTimer = setTimeout(() => { practisedTimer = null; void sendPractised(today); }, PRACTISED_DEBOUNCE_MS);
}

async function sendPractised(day: string): Promise<void> {
  const st = loadReminder();
  if (!st.on || !st.endpoint || st.practisedSent === day || Date.now() - lastTry < RETRY_MS) return;
  lastTry = Date.now();
  const r = await call('/practised', 'POST', { endpoint: st.endpoint, day });
  if (!r) lastTry = 0; // offline: tried again when the phone is back online or the app comes back
  else if (r.ok) saveReminder({ practisedSent: day });
  else if (r?.status === 404) {
    // The server lost it (expired, removed after an error): subscribe again (the post carries today).
    await reassertReminder(true);
  }
}

/**
 * On app start: re-assert the subscription, and report practice when the store changes. Back online or
 * back in the foreground: what didn't reach the server (a new time, "practised today") goes again.
 */
export function startReminders(): () => void {
  void reassertReminder();
  notePractised();
  const off = onStoreChange(() => notePractised());
  const again = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!loadReminder().on) return;
    void reassertReminder(); // (only sends when something wasn't sent yet, or every REASSERT_MS)
    notePractised();
  };
  const hasWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (hasWindow) {
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
  }
  return () => {
    off();
    if (hasWindow) {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
    }
    if (practisedTimer) clearTimeout(practisedTimer);
    practisedTimer = null;
  };
}

/** Tests only. */
export function _resetRemindersForTests(): void {
  if (practisedTimer) clearTimeout(practisedTimer);
  practisedTimer = null;
  if (timeTimer) clearTimeout(timeTimer);
  timeTimer = null;
  timeWaiters = [];
  lastTry = 0;
  asserting = null;
  listeners.clear();
}
