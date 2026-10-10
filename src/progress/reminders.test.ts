import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { _resetAllForTests, dayKey, writeJSON } from './store';
import {
  PRACTISED_DEBOUNCE_MS, _resetRemindersForTests, disableReminders, enableReminders, keyBytes, loadReminder, notePractised,
  reassertReminder, reminderSupport, setReminderTime, shouldOfferReminder, startReminders, subscribePayload, supportNote,
} from './reminders';

// A server key (65 bytes, base64url) and what the browser's PushManager hands back.
const KEY = 'BCVKb5S53gMoTXKXvOEGK1B1mr_kCS5TeJ3C5wwxVnugxeoPNFl-o8jtEjdcgabL8BU6X4SpzvMYPWKHrNH2G0A';
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let answer: (url: string, method: string) => { status: number; body?: unknown } = () => ({ status: 200, body: { ok: true } });
let n = 0;

function fakeSub(endpoint = `https://fcm.googleapis.com/fcm/send/e${++n}`) {
  return {
    endpoint,
    options: { applicationServerKey: keyBytes(KEY).buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: 'BP' + 'x'.repeat(85), auth: 'a'.repeat(22) } }),
    unsubscribe: vi.fn(async () => true),
  };
}
let current: ReturnType<typeof fakeSub> | null = null;
const pushManager = {
  getSubscription: vi.fn(async () => current),
  subscribe: vi.fn(async (_o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => (current = fakeSub())),
};
const Notification = { permission: 'default' as string, requestPermission: vi.fn(async () => 'granted') };

function browser({ ua = CHROME_UA, push = true, standalone = false } = {}) {
  vi.stubGlobal('navigator', {
    userAgent: ua, platform: 'Linux armv8l', maxTouchPoints: 5, standalone,
    ...(push ? { serviceWorker: { ready: Promise.resolve({ pushManager }) } } : {}),
  });
  if (push) {
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('Notification', Notification);
  } else {
    vi.stubGlobal('PushManager', undefined);
    delete (globalThis as Record<string, unknown>).PushManager;
    delete (globalThis as Record<string, unknown>).Notification;
  }
}

beforeEach(() => {
  localStorage.clear();
  _resetAllForTests();
  _resetRemindersForTests();
  vi.stubEnv('VITE_CHOIR_URL', '/schonberg/api');
  calls = [];
  current = null;
  Notification.permission = 'default';
  Notification.requestPermission.mockClear();
  Notification.requestPermission.mockImplementation(async () => (Notification.permission = 'granted'));
  pushManager.subscribe.mockClear();
  pushManager.getSubscription.mockClear();
  answer = (url, method) => (url.endsWith('/key') && method === 'GET' ? { status: 200, body: { publicKey: KEY } } : { status: 200, body: { ok: true } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
    const a = answer(url, method);
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status, headers: { 'Content-Type': 'application/json' } });
  }));
  browser();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const writes = () => calls.filter((c) => c.method !== 'GET');
const practiseToday = () => writeJSON('sh:log', [{ at: Date.now(), pieceId: 'p', partId: 'S', sectionId: 's0', level: 1, accuracy: 0.9, score: 1, passed: true }]);

describe('support', () => {
  it('tells which browsers can have a reminder, honestly', () => {
    expect(reminderSupport()).toBe('ok');
    browser({ ua: IPHONE_UA, push: false });
    expect(reminderSupport()).toBe('ios-home-screen');
    expect(supportNote('ios-home-screen')).toMatch(/On iPhone, add Schönberg Hero to your Home Screen first/);
    browser({ ua: IPHONE_UA, push: true });
    expect(reminderSupport()).toBe('ios-home-screen'); // (Safari's tab: only the Home Screen app gets push)
    browser({ ua: IPHONE_UA, push: true, standalone: true });
    expect(reminderSupport()).toBe('ok');
    browser({ ua: IPHONE_UA, push: false, standalone: true });
    expect(reminderSupport()).toBe('ios-too-old');
    browser({ push: false });
    expect(reminderSupport()).toBe('unsupported');
    expect(supportNote('unsupported')).toBe("Your browser doesn't support reminders.");
    browser();
    Notification.permission = 'denied';
    expect(reminderSupport()).toBe('denied');
    Notification.permission = 'default';
    vi.stubEnv('VITE_CHOIR_URL', '');
    expect(reminderSupport()).toBe('no-server');
  });

  it('an iPad that says it is a Mac counts as iOS', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', platform: 'MacIntel', maxTouchPoints: 5 });
    expect(reminderSupport()).toBe('ios-home-screen');
  });
});

describe('switching on and off', () => {
  it('asks for permission on the tap, subscribes with the server key and posts subscription, time and zone', async () => {
    const r = await enableReminders('07:30');
    expect(r).toEqual({ ok: true });
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    const opts = pushManager.subscribe.mock.calls[0][0];
    expect(opts.userVisibleOnly).toBe(true);
    expect([...opts.applicationServerKey]).toEqual([...keyBytes(KEY)]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /schonberg/api/reminders/key', 'POST /schonberg/api/reminders']);
    const body = calls[1].body!;
    expect(body).toEqual({
      subscription: { endpoint: current!.endpoint, keys: { p256dh: expect.any(String), auth: expect.any(String) } },
      time: '07:30',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(JSON.stringify(body)).not.toMatch(/name|voice|choir/i);
    const st = loadReminder();
    expect(st).toMatchObject({ on: true, time: '07:30', endpoint: current!.endpoint, offered: true });
    expect(localStorage.getItem('sh:reminder')).toBeNull(); // (not a sh: key: never in backups or the account copy)
  });

  it('says so when permission is refused, and sends nothing', async () => {
    Notification.requestPermission.mockImplementation(async () => (Notification.permission = 'denied'));
    const r = await enableReminders();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/blocked/);
    expect(calls).toHaveLength(0);
    expect(loadReminder().on).toBe(false);
    expect(reminderSupport()).toBe('denied');
  });

  it('stays off when the server is unreachable', async () => {
    answer = () => ({ status: 503 });
    const r = await enableReminders();
    expect(r.ok).toBe(false);
    expect(loadReminder().on).toBe(false);
  });

  it('includes today when the singer already practised', async () => {
    practiseToday();
    await enableReminders();
    expect(calls[1].body!.practised).toBe(dayKey(Date.now()));
    expect(loadReminder().practisedSent).toBe(dayKey(Date.now()));
  });

  it('switching off deletes it on the server and in the browser; offline, the delete is retried on the next start', async () => {
    await enableReminders();
    const sub = current!;
    calls = [];
    await disableReminders();
    expect(calls).toEqual([{ url: '/schonberg/api/reminders', method: 'DELETE', body: { endpoint: sub.endpoint } }]);
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(loadReminder()).toMatchObject({ on: false });
    expect(loadReminder().endpoint).toBeUndefined();

    current = null;
    await enableReminders();
    const sub2 = current!;
    answer = () => ({ status: 500 });
    calls = [];
    await disableReminders();
    expect(loadReminder().pendingOff).toBe(sub2.endpoint);
    answer = () => ({ status: 200, body: { ok: true } });
    calls = [];
    await reassertReminder();
    expect(calls).toEqual([{ url: '/schonberg/api/reminders', method: 'DELETE', body: { endpoint: sub2.endpoint } }]);
    expect(loadReminder().pendingOff).toBeUndefined();
  });

  it('a new time is sent when on, only kept when off', async () => {
    await setReminderTime('06:15');
    expect(calls).toHaveLength(0);
    expect(loadReminder().time).toBe('06:15');
    await enableReminders();
    calls = [];
    // (typed field by field: one post, with the last time)
    void setReminderTime('21:00');
    void setReminderTime('21:05');
    expect(await setReminderTime('21:15')).toBe(true);
    expect(writes().map((c) => c.body!.time)).toEqual(['21:15']);
    expect(loadReminder().time).toBe('21:15');
    expect(await setReminderTime('25:00')).toBe(false);
  });
});

describe('re-asserting on start', () => {
  it('posts again only when due or when the endpoint changed (with the old one to replace)', async () => {
    await enableReminders();
    const first = current!.endpoint;
    calls = [];
    await reassertReminder();
    expect(calls).toHaveLength(0); // (just sent)
    current = fakeSub(); // the browser rotated the subscription
    await reassertReminder();
    expect(writes()).toHaveLength(1);
    expect(writes()[0].body).toMatchObject({ replaces: first, subscription: { endpoint: current.endpoint } });
    expect(loadReminder().endpoint).toBe(current.endpoint);
  });

  it('a subscription made for another server key is replaced', async () => {
    current = { ...fakeSub(), options: { applicationServerKey: new Uint8Array(65).buffer } };
    const old = current;
    await enableReminders();
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it('permission taken back in the browser switches the reminder off', async () => {
    await enableReminders();
    Notification.permission = 'denied';
    calls = [];
    await reassertReminder(true);
    expect(loadReminder().on).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(['DELETE']);
  });
});

describe('practised today', () => {
  it('is posted once a day after a run, debounced, with the date only', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 10, 9, 0));
    await enableReminders();
    calls = [];
    const stop = startReminders();
    await vi.advanceTimersByTimeAsync(10);
    calls = [];
    practiseToday();
    practiseToday();
    notePractised();
    await vi.advanceTimersByTimeAsync(PRACTISED_DEBOUNCE_MS - 100);
    expect(writes()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(writes()).toEqual([{ url: '/schonberg/api/reminders/practised', method: 'POST', body: { endpoint: current!.endpoint, day: '2026-10-10' } }]);
    practiseToday();
    await vi.advanceTimersByTimeAsync(PRACTISED_DEBOUNCE_MS * 3);
    expect(writes()).toHaveLength(1); // (once a day)
    // The next day, the next run.
    vi.setSystemTime(new Date(2026, 9, 11, 19, 0));
    practiseToday();
    await vi.advanceTimersByTimeAsync(PRACTISED_DEBOUNCE_MS + 10);
    expect(writes().map((c) => c.body!.day)).toEqual(['2026-10-10', '2026-10-11']);
    stop();
  });

  it('nothing is posted while the reminder is off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stop = startReminders();
    practiseToday();
    await vi.advanceTimersByTimeAsync(PRACTISED_DEBOUNCE_MS * 2);
    expect(calls).toHaveLength(0);
    stop();
  });

  it('a server that forgot the subscription gets it again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await enableReminders();
    calls = [];
    answer = (url, method) => (url.endsWith('/practised') ? { status: 404 } : url.endsWith('/key') && method === 'GET' ? { status: 200, body: { publicKey: KEY } } : { status: 200 });
    practiseToday();
    notePractised();
    await vi.advanceTimersByTimeAsync(PRACTISED_DEBOUNCE_MS + 10);
    await vi.waitFor(() => expect(writes().map((c) => c.url)).toEqual(['/schonberg/api/reminders/practised', '/schonberg/api/reminders']));
    expect(writes()[1].body!.practised).toBe(dayKey(Date.now()));
  });
});

describe('the Today-done offer', () => {
  it('only where reminders work, while off, and once', () => {
    expect(shouldOfferReminder()).toBe(true);
    browser({ ua: IPHONE_UA });
    expect(shouldOfferReminder()).toBe(false);
    browser();
    localStorage.setItem('shr:reminder', JSON.stringify({ on: false, time: '18:00', offered: true }));
    expect(shouldOfferReminder()).toBe(false);
    localStorage.setItem('shr:reminder', JSON.stringify({ on: true, time: '18:00' }));
    expect(shouldOfferReminder()).toBe(false);
  });
});

describe('payloads', () => {
  it('the subscribe payload carries the subscription, time and zone, and nothing else', () => {
    const p = subscribePayload({ endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' } }, '18:00', 'Europe/Berlin');
    expect(p).toEqual({ subscription: { endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' } }, time: '18:00', tz: 'Europe/Berlin' });
    expect(subscribePayload({ endpoint: 'https://e', keys: {} }, '18:00', 'UTC', '2026-10-10', 'https://old')).toMatchObject({ practised: '2026-10-10', replaces: 'https://old' });
    expect(keyBytes(KEY)).toHaveLength(65);
  });
});

// ---------------------------------------------------------------- the service worker's handlers

describe('service worker (public/push-sw.js)', () => {
  function loadSw(windows: { url: string; focus: () => Promise<void> }[] = []) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const shown: { title: string; opts: { body: string; icon: string; tag: string; data: { url: string } } }[] = [];
    const opened: string[] = [];
    const self = {
      location: new URL('https://choir.example/schonberg/sw.js'),
      registration: { scope: 'https://choir.example/schonberg/', showNotification: async (title: string, opts: never) => { shown.push({ title, opts }); } },
      clients: { matchAll: async () => windows, openWindow: async (u: string) => { opened.push(u); } },
      addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; },
    };
    const src = readFileSync(resolve(process.cwd(), 'public/push-sw.js'), 'utf8');
    new Function('self', src)(self);
    const fire = async (type: string, e: Record<string, unknown>) => {
      let p: Promise<unknown> = Promise.resolve();
      handlers[type]({ ...e, waitUntil: (x: Promise<unknown>) => { p = x; } });
      await p;
    };
    return { fire, shown, opened };
  }

  it('shows the notification with the app icon and opens this app only', async () => {
    const sw = loadSw();
    await sw.fire('push', { data: { json: () => ({ title: "Time for today's practice", body: 'About 10 minutes: your plan is ready.', url: '/schonberg/#/', tag: 'practice-reminder' }) } });
    expect(sw.shown).toEqual([{ title: "Time for today's practice", opts: {
      body: 'About 10 minutes: your plan is ready.', icon: 'https://choir.example/schonberg/apple-touch-icon.png', tag: 'practice-reminder',
      data: { url: 'https://choir.example/schonberg/#/' },
    } }]);
    await sw.fire('push', { data: { json: () => ({ url: 'https://evil.example/' }) } });
    expect(sw.shown[1].opts.data.url).toBe('https://choir.example/schonberg/');
    await sw.fire('push', { data: { json: () => { throw new Error('not json'); } } });
    expect(sw.shown[2].title).toBe("Time for today's practice");
  });

  it('a tap focuses the open app, or opens it', async () => {
    const focus = vi.fn(async () => {});
    const open = loadSw([{ url: 'https://choir.example/schonberg/#/pieces', focus }]);
    const close = vi.fn();
    await open.fire('notificationclick', { notification: { close, data: { url: 'https://choir.example/schonberg/#/' } } });
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(open.opened).toEqual([]);
    const none = loadSw([]);
    await none.fire('notificationclick', { notification: { close, data: { url: 'https://choir.example/schonberg/#/' } } });
    expect(none.opened).toEqual(['https://choir.example/schonberg/#/']);
  });
});
