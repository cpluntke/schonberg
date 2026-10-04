// QA round 4 helpers.
import { chromium } from '@playwright/test';
export const BASE = 'http://localhost:5179/';
export const SHOTS = '/home/user/schonberg/docs/qa/shots-r4/';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Fresh context; `ls` is written to localStorage before the app loads (first load only). */
export async function fresh({ viewport = { width: 390, height: 844 }, ls = { 'sh:profile': JSON.stringify({ onboarded: true, voice: 'A' }) }, sim = 'perfect' } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript((ls) => {
    if (!sessionStorage.getItem('r4-init')) { sessionStorage.setItem('r4-init', '1'); if (ls) for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }
    window.__shared = [];
    try { Object.defineProperty(navigator, 'share', { value: async (d) => { window.__shared.push(d.text); }, configurable: true }); } catch {}
  }, ls);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|CERT|net::/.test(m.text())) errors.push('CONSOLE ' + m.text().slice(0, 200)); });
  const q = sim ? `?simulate=${sim}` : '';
  return { browser, ctx, page, errors, q };
}
export async function nav(page, hash) { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(800); }
export const shot = (page, name, fullPage = false) => page.screenshot({ path: SHOTS + name + '.png', fullPage });
export const text = async (page) => (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
export async function runToResults(page, maxMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (/#\/results/.test(page.url())) break; if (!/#\/(play|arcade)/.test(page.url())) break; await sleep(500); }
  await sleep(800);
}
