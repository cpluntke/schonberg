import { chromium } from '@playwright/test';
import fs from 'fs';
export const BASE = 'http://localhost:5179/';
export const SHOTS = 'docs/qa/shots-r3a/';
export const STATE = '/tmp/claude-0/-home-user-schonberg/325dd8f1-16f4-5a5c-81bd-5387e27256c6/scratchpad/';
let browser;
export async function launch() {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  return browser;
}
/** who: 'alto'|'sop'; dayOffset in days from real today; restores ls from STATE/<who>.json */
export async function ctxFor(who, dayOffset = 0, sim = 'perfect') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  const f = STATE + who + '.json';
  const ls = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  await ctx.addInitScript(([off, ls]) => {
    if (!sessionStorage.getItem('r3a-init')) { sessionStorage.setItem('r3a-init', '1'); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }
    const RD = Date; const o = off * 864e5;
    class D extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + o); else super(...a); } static now() { return RD.now() + o; } }
    window.Date = D;
  }, [dayOffset, ls]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|CERT|net::/.test(m.text())) console.log('CONSOLE', m.text()); });
  await page.goto(BASE + (sim ? `?simulate=${sim}` : '') + '#/');
  await page.waitForTimeout(800);
  return { ctx, page, save: async () => { const d = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('sh:')).map(k => [k, localStorage.getItem(k)]))); fs.writeFileSync(f, JSON.stringify(d)); } };
}
export async function nav(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(700);
}
export async function shot(page, name, full = false) { await page.screenshot({ path: SHOTS + name + '.png', fullPage: full }); }
export async function text(page) { return (await page.locator('body').innerText()).replace(/\n+/g, ' | '); }
/** start a play screen run and wait for results (or timeout) */
export async function run(page, hash, name, { maxMs = 240000, midShot = true } = {}) {
  await nav(page, hash);
  await shot(page, name + '-ready');
  const st = page.getByTestId('start');
  if (await st.count()) await st.click(); else await page.getByRole('button', { name: 'Start' }).click();
  if (midShot) { await page.waitForTimeout(7000); await shot(page, name + '-mid'); }
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (/#\/results/.test(page.url())) break;
    if (!/#\/(play|arcade)/.test(page.url())) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(800);
  await shot(page, name + '-result', true);
  return await text(page);
}
