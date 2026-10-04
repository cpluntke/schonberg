// QA round 1: tuner / range finder / latency calibration with WAV fake-mic input.
// Usage: node docs/qa/scripts/fakemic-wav.mjs
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5179/';
const W = '/home/user/schonberg/docs/qa/wav/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withWav(wav, fn) {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  if (wav) args.push(`--use-file-for-fake-audio-capture=${W}${wav}`);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  await page.goto(BASE + '#/'); await sleep(1200);
  await page.evaluate(() => localStorage.setItem('sh:profile', JSON.stringify({ ...(JSON.parse(localStorage.getItem('sh:profile') || '{}')), onboarded: true, voice: 'S', latencyMs: 0 })));
  try { return await fn(page); } finally { await browser.close(); }
}
const res = {};
for (const wav of ['sustain-a3.wav', 'sustain-e5.wav', 'sustain-a3-plus30c.wav']) {
  res['tuner ' + wav] = await withWav(wav, async (page) => {
    await page.goto(BASE + '#/tuner'); await sleep(800);
    await page.getByTestId('mic-start').click();
    const reads = [];
    for (let i = 0; i < 8; i++) { await sleep(400); reads.push((await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 80)); }
    return reads.filter((x, i, a) => a.indexOf(x) === i).slice(0, 4);
  });
}
res['range finder sustain-e5'] = await withWav('sustain-e5.wav', async (page) => {
  await page.goto(BASE + '#/setup'); await sleep(800);
  await page.getByRole('button', { name: 'Continue' }).first().click(); await sleep(500);
  const mic = page.getByTestId('mic-start'); if (await mic.count()) await mic.click();
  await sleep(5000);
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300);
});
for (const wav of [null, 'sustain-a3.wav', 'ta-90bpm.wav', 'ta-90bpm.wav']) {
  res['latency calib ' + (wav ?? 'default-fake-beep')] = await withWav(wav, async (page) => {
    await page.goto(BASE + '#/setup'); await sleep(800);
    for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'Continue' }).first().click(); await sleep(400); }
    await page.locator('button.btn.voice').click();
    await sleep(9000);
    const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile')).latencyMs);
    return { text: (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 220), savedLatencyMs: prof };
  });
}
console.log(JSON.stringify(res, null, 1));
