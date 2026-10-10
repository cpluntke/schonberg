/* Schönberg Hero: the daily practice reminder in the service worker (imported by the generated sw.js,
   see vite.config.ts). The server sends {title, body, url, tag} (utils/schonberg_reminders.py). */
/* eslint-env serviceworker */
'use strict';

self.addEventListener('push', (event) => {
  let d = {};
  try { d = (event.data && event.data.json()) || {}; } catch (e) { d = {}; }
  const scope = self.registration.scope;
  const str = (v, fallback, n) => (typeof v === 'string' && v.trim() ? v.slice(0, n) : fallback);
  // Only a page of this app opens (never another site).
  let url = scope;
  try {
    const u = new URL(str(d.url, '#/', 300), scope);
    if (u.origin === self.location.origin) url = u.href;
  } catch (e) { /* keep the scope */ }
  event.waitUntil(self.registration.showNotification(str(d.title, "Time for today's practice", 80), {
    body: str(d.body, 'Your plan is ready.', 200),
    icon: new URL('apple-touch-icon.png', scope).href,
    tag: str(d.tag, 'practice-reminder', 40),
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // The app already open: bring it to the front (it shows Today on its own).
    const open = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus();
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

// The browser renewed the subscription (its push service changed it): tell the server, which keeps the
// time and zone of the old one. Without the old one the app does it on its next start.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const api = new URL('api/reminders', self.registration.scope).href;
    let sub = event.newSubscription;
    if (!sub) {
      let key = old && old.options && old.options.applicationServerKey;
      if (!key) {
        const r = await fetch(api + '/key');
        const k = (await r.json()).publicKey.replace(/-/g, '+').replace(/_/g, '/');
        key = Uint8Array.from(atob(k + '='.repeat((4 - (k.length % 4)) % 4)), (c) => c.charCodeAt(0));
      }
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    if (!old || !sub || old.endpoint === sub.endpoint) return;
    await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), replaces: old.endpoint }),
    });
  })().catch(() => { /* offline or no server: the app re-asserts on its next start */ }));
});
