// QA round 3 code review: leaderboard server probes (CR-06 prototype keys, CR-07 XFF rate-limit bypass).
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r3cr-server --silent=false
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 18787 + Math.floor(Math.random() * 1000);
const dir = mkdtempSync(join(tmpdir(), 'r3cr-'));
const DATA = join(dir, 'lb.json');
let proc: ChildProcess;
const base = `http://127.0.0.1:${PORT}`;
const entry = (name: string) => ({ name, voice: 'S', pieceId: 'p1', readiness: 0.5, weeklyScore: 10, streak: 1, improved: 0 });
const put = (code: string, name: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/choirs/${code}/entries/${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(entry(name)) });

beforeAll(async () => {
  proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT), DATA_FILE: DATA }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`${base}/health`); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
afterAll(() => proc?.kill());

describe('CR-06 choir codes that are Object.prototype keys', () => {
  it('__proto__ / constructor are accepted, written outside db, never persisted, and leak across choirs', async () => {
    const a = await put('__proto__', 'mallory');
    const b = await put('constructor', 'eve');
    const ga = await (await fetch(`${base}/choirs/__proto__/entries`)).json();
    const gb = await (await fetch(`${base}/choirs/constructor/entries`)).json();
    await put('realchoir', 'alice');
    await new Promise((r) => setTimeout(r, 900));
    const file = existsSync(DATA) ? readFileSync(DATA, 'utf8') : '';
    console.log('CR-06', JSON.stringify({ putProto: a.status, putCtor: b.status, getProto: ga.entries?.length, getCtor: gb.entries?.length, persistedProto: file.includes('mallory'), persistedCtor: file.includes('eve'), file: file.slice(0, 200) }));
    expect(a.status).not.toBe(200);
  });
});

describe('CR-07 rate limit keyed on client-supplied X-Forwarded-For', () => {
  it('70 PUTs from one client with rotating XFF are all accepted', async () => {
    let ok = 0;
    for (let i = 0; i < 70; i++) if ((await put(`flood${i}`, 'x', { 'x-forwarded-for': `10.0.${i}.1` })).status === 200) ok++;
    let okSame = 0;
    for (let i = 0; i < 70; i++) if ((await put('same', `n${i}`, { 'x-forwarded-for': '9.9.9.9' })).status === 200) okSame++;
    console.log('CR-07', JSON.stringify({ rotatingXffAccepted: ok, sameIpAccepted: okSame }));
    expect(ok).toBeLessThanOrEqual(60);
  });
});
