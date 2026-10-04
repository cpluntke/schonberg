// QA round 1: end-to-end timing chain with a deterministic "singer".
// Everything the app sends to ctx.destination is also routed through a DelayNode(D) into a
// MediaStreamDestination that replaces getUserMedia — i.e. a perfect singer who sings exactly
// what they hear, D seconds late (models output+input latency). Then:
//  1) latency calibration (#/setup step 3) should report ≈ D (+ the loopback's own delay)
//  2) a Level-2 run (guide = own part audible, other parts muted) should score ~100 % when
//     profile.latencyMs = calibrated value, and lose accuracy when latencyMs = 0.
// Usage: node docs/qa/scripts/audio-loopback.mjs [delaySec=0.12]
import { launch, BASE, sleep } from './lib.mjs';
const D = Number(process.argv[2] ?? 0.12);

const init = (D) => {
  const Orig = window.AudioContext;
  window.AudioContext = class extends Orig {
    constructor(o) {
      super(o);
      window.__ctx = this;
      this.__dest = this.createMediaStreamDestination();
      this.__delay = this.createDelay(2);
      this.__delay.delayTime.value = D;
      this.__delay.connect(this.__dest);
    }
  };
  const oc = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dst, ...rest) {
    const r = oc.call(this, dst, ...rest);
    if (dst instanceof AudioDestinationNode && this.context.__delay) oc.call(this, this.context.__delay);
    return r;
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const c = window.__ctx || new window.AudioContext();
    return c.__dest.stream;
  };
};

async function setProfile(page, patch) {
  await page.evaluate((patch) => {
    const p = JSON.parse(localStorage.getItem('sh:profile') || '{}');
    localStorage.setItem('sh:profile', JSON.stringify({ ...p, onboarded: true, voice: 'S', strictness: 'standard', tuning: 'equal', ...patch }));
  }, patch);
}

const { browser, ctx, page, errors } = await launch({ desktop: true, viewport: { width: 900, height: 900 } });
await ctx.addInitScript(init, D);
await page.goto(BASE + '#/');
await sleep(1500);
await setProfile(page, {});
const out = { D };

// 1) calibration
await page.goto(BASE + '#/setup'); await sleep(800);
for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'Continue' }).first().click(); await sleep(400); }
await page.locator('button.btn.voice').click();
await sleep(9000);
out.calib = (await page.innerText('main')).match(/(\d+)\s*ms/)?.[0] ?? (await page.innerText('main')).slice(0, 200);
out.outputLatency = await page.evaluate(() => ({ out: window.__ctx.outputLatency, base: window.__ctx.baseLatency, sr: window.__ctx.sampleRate }));
const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile')));
out.latencyMs = prof.latencyMs;

// 2) play runs
const parts = await page.evaluate(async () => {
  const m = await import('/src/ui/library.ts');
  await m.ensureLoaded();
  const p = m.getPiece('warmup-chorale');
  return { parts: p.score.parts.map((x) => x.id), secs: p.sections.map((s) => [s.id, s.start, s.end]) };
});
out.parts = parts;
async function run(latencyMs, level, partIdx = 0) {
  await setProfile(page, { latencyMs });
  const partId = parts.parts[partIdx];
  const sec = parts.secs[0];
  await page.goto(BASE + `#/play/warmup-chorale/${encodeURIComponent(partId)}/${encodeURIComponent(sec[0])}?level=${level}`);
  await page.reload(); await sleep(1500);
  // mute all other parts
  const btns = page.locator('.mixer button');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    if ((await b.innerText()).includes('you')) continue;
    if ((await b.getAttribute('aria-pressed')) === 'true') await b.click();
  }
  await page.getByTestId('start').click();
  const t0 = Date.now();
  await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 120000 });
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:log') || '[]'));
  const last = log[log.length - 1];
  return { latencyMs, level, part: partId, secs: (Date.now() - t0) / 1000, accuracy: last?.accuracy, score: last?.score };
}
out.runs = [];
out.runs.push(await run(out.latencyMs, 2));
out.runs.push(await run(0, 2));
out.runs.push(await run(out.latencyMs + 100, 2));
out.runs.push(await run(out.latencyMs, 1)); // rate 0.7
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
