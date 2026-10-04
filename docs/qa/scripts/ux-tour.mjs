import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5179/';
const OUT = 'docs/qa/shots-ux/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error' && !/CERT|fonts/.test(m.text())) logs.push(m.text()); });
page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
async function nav(hash, q = '') {
  await page.goto(BASE + q + '#' + hash);
  await page.waitForTimeout(1800);
}
const shot = async (n, full = true) => page.screenshot({ path: OUT + n + '.png', fullPage: full });
const step = process.argv[2] || 'screens';
if (step === 'screens') {
  await nav('/'); await shot('01-home-first');
  // click through anything that looks like onboarding
  const txt = await page.innerText('body'); console.log('HOME:', txt.slice(0, 1500));
  for (const h of ['/library','/setup','/settings','/ranks','/expert','/tuner']) { await nav(h); await shot('02' + h.replace('/','-')); console.log('==', h, (await page.innerText('body')).slice(0, 1200)); }
  for (const p of ['bach-bwv512','bruckner-locus-iste','debussy-dieu','debussy-yver','ravel-nicolette','brahms-schaffe','warmup-chorale']) { await nav('/piece/' + p); await shot('03-piece-' + p); console.log('== piece', p, (await page.innerText('body')).slice(0, 1500)); }
}
console.log('ERRORS', logs);
await browser.close();
