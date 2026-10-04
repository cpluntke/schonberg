// QA round 4 — real-audio end-to-end scoring through the microphone pipeline.
//
// Method: navigator.mediaDevices.getUserMedia is replaced (in the page) by a MediaStream coming
// from a MediaStreamAudioDestinationNode on the app's own AudioContext. A synthetic, vocal-like
// voice (8 harmonics, ±40 c vibrato at 5.5 Hz, breath noise, 40 ms attack/release, room-noise floor)
// is scheduled into that stream relative to the app's ScorePlayer start time, which is read by
// wrapping ScorePlayer.prototype.play (read-only observation of `this.s.startCtx`).
// Everything after getUserMedia is the real app: MediaStreamSource → AnalyserNode → pitchy →
// PitchSmoother → PracticeSession.onPitch (latency compensation) → LiveScorer → analysis → Results.
//
// Usage: node docs/qa/scripts/r4audio-run.mjs [filter]   (writes docs/qa/r4audio/results.json)
import { chromium } from '@playwright/test';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const BASE = 'http://localhost:5179/';
const OUT = '/home/user/schonberg/docs/qa/r4audio/';
const filter = process.argv[2] ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = [
  { piece: 'warmup-chorale', part: 'P2', voice: 'A', section: 's1-m7-12' },
  { piece: 'debussy-dieu', part: 'P3', voice: 'T', section: 's1-m5-12' },
];
const CAL = 60; // calibrated round-trip latency stored in the profile; the voice is delayed by the same amount
const CASES = [
  { id: 'ok', latencyMs: CAL, voice: { offsetMs: CAL, cents: 0 } },
  { id: 'flat30', latencyMs: CAL, voice: { offsetMs: CAL, cents: -30 } },
  { id: 'late150', latencyMs: CAL, voice: { offsetMs: CAL + 150, cents: 0 } },
  { id: 'late150-uncal', latencyMs: 0, voice: { offsetMs: 150, cents: 0 } },
  { id: 'wrong', latencyMs: CAL, voice: { offsetMs: CAL, cents: 0, wrongEvery: 2 } },
  { id: 'silence', latencyMs: CAL, voice: null },
  // extra sweep (run with filter "x-")
  { id: 'x-late100', latencyMs: CAL, voice: { offsetMs: CAL + 100, cents: 0 } },
  { id: 'x-early100', latencyMs: CAL, voice: { offsetMs: CAL - 100, cents: 0 } },
  { id: 'x-late250-uncal', latencyMs: 0, voice: { offsetMs: 250, cents: 0 } },
  { id: 'x-late350-uncal', latencyMs: 0, voice: { offsetMs: 350, cents: 0 } },
];

const INIT = `
(() => {
  const V = (window.__r4 = { gum: 0, plays: [], scheduled: 0, plan: null });
  // Vite serves HMR-updated modules with ?t=…; import the exact URL the app loaded so we share its instances.
  V.url = (name) => {
    const e = performance.getEntriesByType('resource').map((x) => x.name).find((n) => new URL(n).pathname === '/src/' + name);
    return e ?? '/src/' + name;
  };
  const HARM = [1, 0.55, 0.35, 0.22, 0.14, 0.09, 0.05, 0.03];
  let dest = null, ctxRef = null;
  function noiseBuf(ctx, sec) {
    const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 2 ** 32) * 2 - 1; }
    return b;
  }
  function voiceNote(ctx, out, midi, at, dur, k) {
    const real = new Float32Array(HARM.length + 1), imag = new Float32Array(HARM.length + 1);
    HARM.forEach((h, i) => (imag[i + 1] = h));
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
    const depth = ctx.createGain();
    // vibrato fades in after 0.25 s to ±40 cents (like a real singer)
    depth.gain.setValueAtTime(0, at); depth.gain.setValueAtTime(0, at + 0.25);
    depth.gain.linearRampToValueAtTime(40, at + Math.max(0.3, Math.min(0.6, dur - 0.05)));
    lfo.connect(depth).connect(osc.detune);
    const env = ctx.createGain();
    const A = 0.04, R = 0.04, top = 0.25;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(top, at + A);
    env.gain.setValueAtTime(top, Math.max(at + A, at + dur - R));
    env.gain.linearRampToValueAtTime(0, at + dur);
    osc.connect(env);
    const nz = ctx.createBufferSource(); nz.buffer = V.noise;
    const ng = ctx.createGain(); ng.gain.value = 0.025;
    nz.connect(ng).connect(env);
    env.connect(out);
    osc.start(at); lfo.start(at); nz.start(at, (k * 0.37) % 1.5);
    osc.stop(at + dur + 0.01); lfo.stop(at + dur + 0.01); nz.stop(at + dur + 0.01);
  }
  async function getDest() {
    const { getAudioContext } = await import(V.url('audio/context.ts'));
    const ctx = getAudioContext();
    if (dest && ctxRef === ctx) return dest;
    ctxRef = ctx;
    dest = ctx.createMediaStreamDestination();
    dest.channelCount = 1;
    V.noise = noiseBuf(ctx, 2);
    const floor = ctx.createBufferSource(); floor.buffer = V.noise; floor.loop = true;
    const fg = ctx.createGain(); fg.gain.value = 0.002; // room noise
    floor.connect(fg).connect(dest); floor.start();
    V.ctx = ctx;
    return dest;
  }
  const md = navigator.mediaDevices;
  md.getUserMedia = async (c) => { V.gum++; return (await getDest()).stream; };
  V.install = () => import(V.url('audio/player.ts')).then((m) => {
    const orig = m.ScorePlayer.prototype.play;
    m.ScorePlayer.prototype.play = function (opts) {
      const r = orig.call(this, opts);
      const s = this.s;
      if (s) {
        V.plays.push({ startCtx: s.startCtx, from: s.from, to: s.to, rate: s.rate, now: this.ctx.currentTime, countIn: opts.countInBeats });
        if (V.plan && !V.done && dest) {
          V.done = true;
          const p = V.plan;
          let k = 0;
          for (const n of p.notes) {
            if (n.start < s.from - 1e-6 || n.start >= s.to - 1e-6) continue;
            const wrong = p.wrongEvery && k % p.wrongEvery === 1;
            const midi = n.midi + (p.cents || 0) / 100 + (wrong ? 1 : 0);
            const at = s.startCtx + (n.start - s.from) / s.rate + p.offsetMs / 1000;
            voiceNote(this.ctx, dest, midi, at, Math.max(0.08, Math.min(n.start + n.dur, s.to) - n.start) / s.rate, k);
            k++;
          }
          V.scheduled = k;
        }
      }
      return r;
    };
    V.patched = true;
  });
})();
`;

async function runCase(t, level, c) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|CERT/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.addInitScript(INIT);
  try {
    await page.goto(BASE + '#/');
    await sleep(1500);
    await page.evaluate(({ voice, latencyMs }) => {
      localStorage.setItem('sh:profile', JSON.stringify({ name: 'QA', voice, notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs, onboarded: true, leaderboardOptIn: false }));
      localStorage.setItem('sh:seenHowto', '1');
    }, { voice: t.voice, latencyMs: c.latencyMs });
    await page.reload();
    await sleep(1500);
    await page.evaluate((h) => (location.hash = h), `#/play/${t.piece}/${t.part}/${t.section}?level=${level}`);
    await page.getByTestId('start').waitFor({ timeout: 15000 });
    await page.evaluate(() => window.__r4.install());
    const notes = await page.evaluate(async ({ piece, part }) => {
      const lib = await import(window.__r4.url('ui/library.ts'));
      return lib.getPiece(piece).score.parts.find((p) => p.id === part).notes.map((n) => ({ start: n.start, dur: n.dur, midi: n.midi }));
    }, t);
    await page.evaluate(({ notes, voice }) => { if (voice) window.__r4.plan = { notes, ...voice }; }, { notes, voice: c.voice });
    const t0 = Date.now();
    await page.getByTestId('start').click();
    await page.waitForFunction(() => location.hash.startsWith('#/results'), null, { timeout: 120000 });
    await sleep(800);
    const out = await page.evaluate(() => ({
      last: JSON.parse(sessionStorage.getItem('sh:lastResult')),
      profileLatency: JSON.parse(localStorage.getItem('sh:profile')).latencyMs,
      r4: { gum: window.__r4.gum, plays: window.__r4.plays, scheduled: window.__r4.scheduled, sampleRate: window.__r4.ctx?.sampleRate, outputLatency: window.__r4.ctx?.outputLatency, baseLatency: window.__r4.ctx?.baseLatency },
      scoreText: document.querySelector('[data-testid="result-score"]')?.textContent,
      banner: document.querySelector('[data-testid="pass-banner"]')?.textContent,
      main: document.querySelector('main')?.innerText.replace(/\s+/g, ' ').slice(0, 1500),
    }));
    await page.screenshot({ path: `${OUT}${t.piece}-L${level}-${c.id}.png`, fullPage: false });
    const r = out.last?.result;
    const onsets = r?.notes.filter((n) => n.onsetMs != null).map((n) => n.onsetMs).sort((a, b) => a - b) ?? [];
    const cents = r?.notes.filter((n) => n.cents != null).map((n) => n.cents).sort((a, b) => a - b) ?? [];
    return {
      piece: t.piece, part: t.part, section: t.section, level, case: c.id, wallSec: (Date.now() - t0) / 1000,
      passed: out.last?.passed, accuracy: r?.accuracy, pitch: r?.pitch, rhythm: r?.rhythm, score: r?.score, counts: r?.counts,
      nNotes: r?.notes.length, scheduled: out.r4.scheduled,
      medOnsetMs: onsets[Math.floor(onsets.length / 2)] ?? null, medCents: cents[Math.floor(cents.length / 2)] ?? null,
      insights: r?.insights.map((i) => `${i.kind}: ${i.title}`),
      latencyAdjusted: out.last?.latencyAdjusted ?? null, profileLatencyAfter: out.profileLatency,
      banner: out.banner, scoreText: out.scoreText, r4: out.r4, main: out.main, errors,
      noteDetail: r?.notes.map((n) => [n.index, n.grade, n.cents == null ? null : Math.round(n.cents), n.onsetMs == null ? null : Math.round(n.onsetMs), +n.hitRatio.toFixed(2)]),
    };
  } catch (e) {
    return { piece: t.piece, level, case: c.id, error: String(e), errors };
  } finally {
    await browser.close();
  }
}

const file = OUT + 'results.json';
const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const jobs = [];
for (const t of TARGETS) for (const level of [2, 3]) for (const c of CASES) {
  const key = `${t.piece}|L${level}|${c.id}`;
  if (filter && !key.includes(filter)) continue;
  jobs.push({ key, t, level, c });
}
const PAR = Number(process.env.PAR || 2);
let i = 0;
await Promise.all(Array.from({ length: PAR }, async () => {
  while (i < jobs.length) {
    const j = jobs[i++];
    const res = await runCase(j.t, j.level, j.c);
    all[j.key] = res;
    writeFileSync(file, JSON.stringify(all, null, 1));
    const { main, noteDetail, r4, ...brief } = res;
    console.log(j.key, JSON.stringify(brief));
  }
}));
