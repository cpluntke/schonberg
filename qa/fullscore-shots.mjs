// Screenshots of the score view (full score on wide screens, single staff on a phone) mid-run with
// the synthetic flat singer, plus per-frame draw cost. Usage:
//   node qa/fullscore-shots.mjs [baseURL] [outDir]   (ONLY=<name part> runs a subset)
// Needs a dev server (npx vite); the draw times come from a dev-only hook in fullscore2d.ts.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5179';
const out = process.argv[3] ?? 'fullscore-shots';
mkdirSync(out, { recursive: true });

const profile = {
  name: 'QA', voice: 'A', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120,
  latencySource: 'measured', onboarded: true, leaderboardOptIn: false, scoreDefaultMigrated: true, displayMigrated: true,
};

const runs = [
  // Draw-cost check at a retina laptop's resolution (also the start card with the staff choice).
  { name: 'kyrie-1280x800', w: 1280, h: 800, piece: 'vierne-kyrie', part: 'P2', from: 44, to: 160, wait: 19500 },
  { name: 'kyrie-1280x800-dpr2', w: 1280, h: 800, piece: 'vierne-kyrie', part: 'P2', from: 44, to: 160, wait: 19500, dpr: 2, card: true },
  { name: 'kyrie-1440x900', w: 1440, h: 900, piece: 'vierne-kyrie', part: 'P2', from: 44, to: 160, wait: 19500 },
  { name: 'kyrie-1024x768', w: 1024, h: 768, piece: 'vierne-kyrie', part: 'P2', from: 44, to: 160, wait: 19500 },
  { name: 'kyrie-offbook-1280x800', w: 1280, h: 800, piece: 'vierne-kyrie', part: 'P2', from: 44, to: 160, wait: 19500, level: 5, offbookTest: true },
  { name: 'dieu-1280x800', w: 1280, h: 800, piece: 'debussy-dieu', part: 'P2', from: 0, to: 60, wait: 6000 },
  { name: 'kyrie-highway-1280x800', w: 1280, h: 800, piece: 'vierne-kyrie', part: 'P2', from: 44, to: 160, wait: 19500, profile: { display: 'highway', displayChosen: true } },
  { name: 'tabourin-1280x800', w: 1280, h: 800, piece: 'debussy-tabourin', part: 'P3-2', from: 0, to: 120, wait: 16000 },
  { name: 'chorale-1280x800', w: 1280, h: 800, piece: 'warmup-chorale', part: 'P2', from: 0, to: 60, wait: 9000 },
  { name: 'chorale-offbook-1280x800', w: 1280, h: 800, piece: 'warmup-chorale', part: 'P3', from: 0, to: 60, wait: 9000, level: 5, offbookTest: true },
  { name: 'kyrie-mypart-1280x800', w: 1280, h: 800, piece: 'vierne-kyrie', part: 'P2', from: 44, to: 160, wait: 19500, profile: { scoreStaves: 'mine' } },
  { name: 'kyrie-phone-390x844', w: 390, h: 844, piece: 'vierne-kyrie', part: 'P2', from: 44, to: 160, wait: 19500, mobile: true },
];
const only = process.env.ONLY;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
for (const r of runs) {
  if (only && !r.name.includes(only)) continue;
  const ctx = await browser.newContext({
    viewport: { width: r.w, height: r.h }, deviceScaleFactor: r.dpr ?? (r.mobile ? 3 : 1), isMobile: !!r.mobile, hasTouch: !!r.mobile,
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/?simulate=flat#/`);
  await page.evaluate(([p, card]) => {
    localStorage.setItem('sh:profile', JSON.stringify(p));
    if (!card) localStorage.setItem('sh:seenHowto:score', '1');
  }, [{ ...profile, ...(r.profile ?? {}) }, !!r.card]);
  await page.goto(`${base}/?simulate=flat#/play/${r.piece}/${r.part}/all?level=${r.level ?? 3}&from=${r.from}&to=${r.to}`);
  await page.getByTestId('start').waitFor({ timeout: 20000 });
  if (r.offbookTest) await page.getByRole('button', { name: 'Test: all hidden' }).click();
  if (r.card) await page.screenshot({ path: `${out}/${r.name}-card.png` });
  await page.getByTestId('start').click();
  await page.waitForTimeout(r.wait);
  // Draw cost: time the canvas draw calls over ~2 s of frames.
  const perf = await page.evaluate(async () => {
    const proto = CanvasRenderingContext2D.prototype;
    const times = [];
    const raf = window.requestAnimationFrame.bind(window);
    // Wrap rAF callbacks to measure each frame's work.
    window.requestAnimationFrame = (cb) => raf((t) => { const a = performance.now(); cb(t); times.push(performance.now() - a); });
    await new Promise((res) => setTimeout(res, 2000));
    window.requestAnimationFrame = raf;
    void proto;
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)] ?? 0;
    const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
    return { frames: times.length, median: +med.toFixed(2), p95: +p95.toFixed(2) };
  });
  const draw = await page.evaluate(async () => {
    globalThis.__scoreDrawMs = [];
    await new Promise((res) => setTimeout(res, 2000));
    const t = [...globalThis.__scoreDrawMs].sort((a, b) => a - b);
    return { frames: t.length, median: +(t[t.length >> 1] ?? 0).toFixed(2), p95: +(t[Math.floor(t.length * 0.95)] ?? 0).toFixed(2), max: +(t[t.length - 1] ?? 0).toFixed(2) };
  });
  const staves = await page.locator('canvas').getAttribute('data-staves');
  await page.screenshot({ path: `${out}/${r.name}.png` });
  console.log(r.name, 'staves', staves, 'frame ms', JSON.stringify(perf), 'draw ms', JSON.stringify(draw), errors.length ? errors : '');
  await ctx.close();
}
// Settings on a wide screen and on a phone.
for (const [w, h, nm] of [[1280, 800, 'settings-1280x800'], [390, 844, 'settings-phone-390x844']]) {
  if (only && !nm.includes(only)) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`${base}/#/`);
  await page.evaluate((p) => localStorage.setItem('sh:profile', JSON.stringify(p)), profile);
  await page.goto(`${base}/#/settings`);
  await page.getByTestId('settings-display').waitFor();
  await page.getByTestId('settings-display').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${nm}.png` });
  await ctx.close();
}
await browser.close();
