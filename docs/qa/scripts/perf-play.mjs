// QA round 1: play-screen frame times under CPU throttling, long tasks, heap/DOM after restarts.
// Usage: node docs/qa/scripts/perf-play.mjs
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5179/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const initHooks = () => {
  window.__stats = { gum: 0, nodes: 0, srcStarted: 0 };
  const od = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => { window.__stats.gum++; const s = await od(c); (window.__streams ||= []).push(s); return s; };
  for (const fn of ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createAnalyser', 'createMediaStreamSource']) {
    const o = BaseAudioContext.prototype[fn] || AudioContext.prototype[fn];
    if (!o) continue;
    BaseAudioContext.prototype[fn] = function (...a) { window.__stats.nodes++; return o.apply(this, a); };
  }
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
};
async function measure(page, ms) {
  return page.evaluate(async (ms) => {
    window.__lt = [];
    const ft = [];
    let last = performance.now();
    let commits = 0;
    const el = document.querySelector('[data-testid=score]');
    const mo = new MutationObserver((m) => { commits += m.length; });
    mo.observe(document.querySelector('main'), { subtree: true, childList: true, characterData: true, attributes: true });
    await new Promise((res) => {
      const end = last + ms;
      const f = (t) => { ft.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(); };
      requestAnimationFrame(f);
    });
    mo.disconnect();
    ft.sort((a, b) => a - b);
    const q = (p) => ft[Math.min(ft.length - 1, Math.floor(p * ft.length))];
    const sess = null;
    return { frames: ft.length, fps: +(ft.length / (ms / 1000)).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +ft[ft.length - 1].toFixed(1),
      over33ms: ft.filter((x) => x > 33.4).length, longTasks: window.__lt.length, longTaskMax: Math.round(Math.max(0, ...window.__lt)), domMutationsPerSec: Math.round(commits / (ms / 1000)) };
  }, ms);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
await ctx.addInitScript(initHooks);
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await page.goto(BASE + '#/'); await sleep(1200);
await page.evaluate(() => localStorage.setItem('sh:profile', JSON.stringify({ ...(JSON.parse(localStorage.getItem('sh:profile') || '{}')), onboarded: true, voice: 'S', latencyMs: 100 })));
const info = await page.evaluate(async () => { const m = await import('/src/ui/library.ts'); await m.ensureLoaded(); const p = m.getPiece('brahms-schaffe'); return { parts: p.score.parts.map((x) => x.id), dur: p.score.duration }; });
const out = { info, runs: [] };
for (const mode of ['play', 'arcade']) {
  for (const rate of [1, 4, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.goto(BASE + `?simulate=perfect#/${mode}/brahms-schaffe/${info.parts[0]}/all?level=2`); await page.reload(); await sleep(1500);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.getByTestId('start').click();
    await sleep(6000); // past count-in, samples accumulate
    const m = await measure(page, 8000);
    const samples = await page.evaluate(async () => (await import('/src/ui/play/session.ts')) && null);
    out.runs.push({ mode, cpuThrottle: rate, ...m });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
}
// restarts with the (fake) real mic, 10 cycles
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await page.goto(BASE + `#/play/bach-bwv512/P1/all?level=2`); await page.reload(); await sleep(1500);
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const h = await cdp.send('Runtime.getHeapUsage'); const d = await cdp.send('Memory.getDOMCounters'); const s = await page.evaluate(() => ({ ...window.__stats, liveTracks: (window.__streams || []).flatMap((x) => x.getTracks()).filter((t) => t.readyState === 'live').length })); return { heapMB: +(h.usedSize / 1e6).toFixed(2), nodes: d.nodes, listeners: d.jsEventListeners, ...s }; };
out.restart = [await heap()];
await page.getByTestId('start').click(); await sleep(4000);
for (let i = 0; i < 10; i++) {
  await page.getByRole('button', { name: /Restart/ }).first().click();
  await sleep(3000);
  if (i % 3 === 2) out.restart.push(await heap());
}
out.restart.push(await heap());
// navigate away & back, check mic still open
await page.getByRole('button', { name: 'Back' }).first().click(); await sleep(1500);
out.afterLeave = await heap();
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
