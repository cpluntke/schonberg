// Schönberg Hero – optional leaderboard server. Node 22+, zero dependencies.
//   GET  /health
//   GET  /choirs/:code/entries[?pieceId=…]   → { entries: LeaderboardEntry[] }
//   PUT  /choirs/:code/entries/:name          body: LeaderboardEntry (name must match)
// Data: one JSON file (DATA_FILE, default ./data/leaderboard.json), written atomically.
import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PORT = Number(process.env.PORT) || 8787;
const DATA_FILE = resolve(process.env.DATA_FILE || './data/leaderboard.json');
const MAX_BODY = 4 * 1024;            // bytes per request
const MAX_ENTRIES_PER_CHOIR = 2000;
const MAX_CHOIRS = 500;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;                  // requests per IP per window
const VOICES = ['S', 'A', 'T', 'B', 'other'];
const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof']);
const validCode = (c) => CODE_RE.test(c || '') && !RESERVED.has(String(c).toLowerCase());
// Behind a proxy (Render, Fly…) set TRUST_PROXY=1: the client IP is then the LAST
// X-Forwarded-For hop (added by the proxy itself), not the client-controlled first one.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

/** @type {Record<string, Record<string, object>>} choir → (name|pieceId) → entry */
let db = Object.create(null);
try {
  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8')) || {};
  for (const [k, v] of Object.entries(raw)) {
    if (!validCode(k) || !v || typeof v !== 'object') continue;
    db[k] = Object.assign(Object.create(null), v);
  }
} catch { db = Object.create(null); }

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    // Asynchronous, debounced write so a burst of requests never blocks the event loop.
    (async () => {
      try {
        mkdirSync(dirname(DATA_FILE), { recursive: true });
        await writeFile(DATA_FILE + '.tmp', JSON.stringify(db));
        await rename(DATA_FILE + '.tmp', DATA_FILE);
      } catch (e) { console.error('save failed', e); }
    })();
  }, 2000);
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > RATE_WINDOW_MS) { hits.set(ip, { start: now, n: 1 }); return false; }
  return ++h.n > RATE_MAX;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (now - h.start > RATE_WINDOW_MS) hits.delete(ip);
}, RATE_WINDOW_MS).unref();

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

function validate(o, nameFromUrl) {
  if (!o || typeof o !== 'object') return null;
  const e = {
    name: str(o.name, 40), voice: VOICES.includes(o.voice) ? o.voice : 'other', pieceId: str(o.pieceId, 120),
    readiness: num(o.readiness, 0, 1), weeklyScore: num(o.weeklyScore, 0, 1e9), streak: num(o.streak, 0, 10000),
    improved: num(o.improved, -1, 1), updatedAt: Date.now(),
  };
  if (Object.values(e).some((v) => v === null)) return null;
  if (e.name !== nameFromUrl.trim().slice(0, 40)) return null;
  if (o.v === 2) e.v = 2; // readiness formula (piece levels from full runs); absent = older app
  e.weeklyScore = Math.round(e.weeklyScore); e.streak = Math.round(e.streak);
  return e;
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { fail(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const xff = TRUST_PROXY ? (req.headers['x-forwarded-for'] || '').toString().split(',').map((x) => x.trim()).filter(Boolean) : [];
  const ip = xff[xff.length - 1] || req.socket.remoteAddress || '?';
  if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests' });

  const url = new URL(req.url || '/', 'http://x');
  const parts = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return null; } });
  if (parts.includes(null)) return send(res, 400, { error: 'Bad path' });

  if (req.method === 'GET' && (parts.length === 0 || parts[0] === 'health')) return send(res, 200, { ok: true });
  if (parts[0] !== 'choirs' || parts[2] !== 'entries' || !validCode(parts[1])) {
    return send(res, 404, { error: 'Not found' });
  }
  const code = parts[1].toLowerCase();

  if (req.method === 'GET' && parts.length === 3) {
    const pieceId = url.searchParams.get('pieceId');
    const entries = Object.values(db[code] || {}).filter((e) => !pieceId || e.pieceId === pieceId);
    return send(res, 200, { entries });
  }
  if (req.method === 'PUT' && parts.length === 4) {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) {
      return send(res, e.message === 'too large' ? 413 : 400, { error: 'Bad body' });
    }
    const entry = validate(body, parts[3]);
    if (!entry) return send(res, 400, { error: 'Invalid entry' });
    if (!db[code]) {
      if (Object.keys(db).length >= MAX_CHOIRS) return send(res, 507, { error: 'Server full' });
      db[code] = Object.create(null);
    }
    const key = `${entry.name.toLowerCase()}|${entry.pieceId}`;
    if (!db[code][key] && Object.keys(db[code]).length >= MAX_ENTRIES_PER_CHOIR) {
      return send(res, 507, { error: 'Choir full' });
    }
    db[code][key] = entry;
    scheduleSave();
    return send(res, 200, { ok: true, entry });
  }
  send(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, () => console.log(`Leaderboard on :${PORT}, data in ${DATA_FILE}`));
