// Who in the choir is practising right now, as counts per voice part (no names). While the singing
// screen is open the phone sends a heartbeat; Home asks for the counts every few seconds. The server
// keeps the heartbeats in memory only (utils/schonberg_presence.py in the server repo).

import { useEffect, useState } from 'react';
import { apiBase } from './choir';
import { loadProfile } from './store';

export const PRESENCE_BEAT = 20_000; // ms between heartbeats (the server counts one for 50 s)
export const PRESENCE_POLL = 5_000; // ms between Home's looks at the counts
const ID_KEY = 'sh:presenceId';

export type Satb = 'S' | 'A' | 'T' | 'B';
export type PresenceCounts = Record<Satb, number>;

/** A random id for this purpose only (not the member token, not the account). */
function presenceId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id || !/^[0-9a-f]{32}$/.test(id)) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      id = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/** The choir this phone belongs to, when the app talks to a choir server. */
function choirUrl(): string | null {
  const base = apiBase();
  const code = loadProfile().choirCode;
  return base && code ? `${base}/choirs/${encodeURIComponent(code)}/presence` : null;
}

let lastSeq = 0;
function send(url: string, voice: Satb, on: boolean): void {
  const id = presenceId();
  if (!id) return;
  // (orders this phone's messages: after a reload the old page's goodbye may arrive after the new hello)
  const seq = lastSeq = Math.max(Date.now(), lastSeq + 1);
  // (keepalive: the "I left" still goes out when the page is closing)
  fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, voice, on, seq }) })
    .catch(() => { /* offline: the server forgets this phone on its own */ });
}

/** While the singing screen is open: counted as practising (paused while the app is in the background). Returns the stop. */
export function startPresence(voice: string): () => void {
  const url = choirUrl();
  if (!url || !['S', 'A', 'T', 'B'].includes(voice)) return () => {};
  const v = voice as Satb;
  let timer: ReturnType<typeof setInterval> | null = null;
  const on = () => {
    if (timer) return;
    send(url, v, true);
    timer = setInterval(() => send(url, v, true), PRESENCE_BEAT);
  };
  const off = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    send(url, v, false);
  };
  const vis = () => (document.visibilityState === 'hidden' ? off() : on());
  document.addEventListener('visibilitychange', vis);
  if (document.visibilityState !== 'hidden') on();
  return () => {
    document.removeEventListener('visibilitychange', vis);
    off();
  };
}

export async function fetchPresence(): Promise<PresenceCounts | null> {
  const url = choirUrl();
  if (!url) return null;
  try {
    const r = await fetch(`${url}?me=${presenceId()}`);
    if (!r.ok) return null;
    const c = ((await r.json()) as { counts?: Partial<PresenceCounts> }).counts ?? {};
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    return { S: n(c.S), A: n(c.A), T: n(c.T), B: n(c.B) };
  } catch {
    return null;
  }
}

/** The counts, refreshed every few seconds while the screen is visible (null: no choir or no answer). */
export function usePresence(): PresenceCounts | null {
  const [counts, setCounts] = useState<PresenceCounts | null>(null);
  useEffect(() => {
    if (!choirUrl()) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const look = () => { void fetchPresence().then((c) => { if (alive && c) setCounts(c); }); };
    const start = () => { if (!timer) { look(); timer = setInterval(look, PRESENCE_POLL); } };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const vis = () => (document.visibilityState === 'hidden' ? stop() : start());
    document.addEventListener('visibilitychange', vis);
    vis();
    return () => { alive = false; stop(); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return counts;
}
