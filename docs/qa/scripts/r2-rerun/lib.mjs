import { chromium } from '@playwright/test';
export const BASE = 'http://localhost:5179/';
export const SHOTS = '/home/user/schonberg/docs/qa/shots-r2/';
export async function launch(opts = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required', ...(opts.args||[])] });
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: !opts.desktop, permissions: ['microphone','clipboard-read','clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_CERT|fonts\.googleapis|gstatic/.test(m.text() + (m.location()?.url||''))) errors.push('CONSOLE ' + m.text().slice(0,300)); });
  return { browser, ctx, page, errors };
}
export const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.png' });
export const waitHash = (page, s) => page.waitForFunction((s) => location.hash.includes(s), s, { timeout: 15000 });
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
