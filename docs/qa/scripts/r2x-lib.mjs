import { chromium } from '@playwright/test';
import fs from 'fs';
export const BASE = 'http://localhost:5179/';
export const SHOTS = 'docs/qa/shots-r2x/';
const axeSrc = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
export async function launch(opts = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'], ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|CERT|net::/.test(m.text())) console.log('CONSOLE', m.text()); });
  return { browser, ctx, page };
}
export async function nav(page, hash, query = '') {
  await page.evaluate(([h]) => { location.hash = h; }, [hash]);
  await page.waitForFunction((h) => location.hash === h, hash);
  await page.waitForTimeout(600);
}
export async function shot(page, name, full = false) { await page.screenshot({ path: SHOTS + name + '.png', fullPage: full }); }
export async function axe(page, label) {
  await page.addScriptTag({ content: axeSrc }).catch(() => {});
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 3).map((x) => x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\n').slice(1,2).join('').slice(0, 140)) }));
  });
  console.log(`AXE[${label}]`, JSON.stringify(r, null, 0));
  return r;
}
export async function targets(page, label) {
  const small = await page.evaluate(() => [...document.querySelectorAll('button, a, input, select, [role=button], [tabindex]')]
    .filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.w < 44 || x.h < 44));
  console.log(`SMALL[${label}]`, JSON.stringify(small));
}
