const { chromium } = require('/home/user/schonberg/node_modules/@playwright/test');
const path = require('path');
// Phone/laptop screenshots for the onboarding video, taken from the dev server (`npx vite --port 5191`).
// Run from the render dir (they write into ./img/): see ../README.md, step 3.
const base = process.env.BASE || 'http://localhost:5191';
const SC = path.resolve(__dirname, '../../../library/scores') + '/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open({ w = 390, h = 844, dpr = 2, voice = 'A', extra = {}, initScript } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const phone = w < 600;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone, permissions: ['microphone'] });
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  const prof = { name: 'Clara', voice, notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 40, latencySource: 'measured', rangeLow: 53, rangeHigh: 74, onboarded: true, leaderboardOptIn: false, scoreDefaultMigrated: true, displayMigrated: true, headphones: true, ...extra };
  await page.goto(`${base}/#/library`);
  await page.evaluate((p) => { localStorage.clear(); localStorage.setItem('sh:profile', JSON.stringify(p)); for (const k of ['sh:seenHowto', 'sh:seenHowto:score', 'sh:seenHowto:highway', 'sh:persistAsked', 'sh:demoDatesCleared']) localStorage.setItem(k, '1'); }, prof);
  return { browser, ctx, page, errs };
}
async function importPieces(page, files) {
  const ids = [];
  for (const f of files) {
    await page.goto(`${base}/#/library`); await sleep(1200);
    await page.getByLabel('Choose score files').setInputFiles(path.join(SC, f));
    await page.waitForURL(/#\/piece\//, { timeout: 20000 });
    ids.push(decodeURIComponent(page.url().split('#/piece/')[1]));
    await sleep(800);
  }
  return ids;
}
async function setCycle(page, ids) {
  await page.evaluate((ids) => localStorage.setItem('sh:cycle', JSON.stringify({ name: 'Advent 2026', pieceIds: ids, rehearsalWeekday: 4, rehearsalTime: '19:30', concertDate: '2026-12-13', focusPieceIds: [ids[0]] })), ids);
}
module.exports = { open, importPieces, setCycle, sleep, base };
