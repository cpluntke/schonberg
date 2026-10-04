// QA round 3 code review (CR-13): first-run "How to read the screen" tip under React.StrictMode (dev server).
// Run: node docs/qa/scripts/r3cr-howto-strictmode.mjs   (dev server on :5179)
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:5179/#/');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('sh:profile', JSON.stringify({ onboarded: true, voice: 'S' })); });
await page.goto('http://localhost:5179/#/play/warmup-chorale/P1/s0-m0-6?level=1'); await page.reload();
await page.waitForSelector('[data-testid=start]', { timeout: 15000 });
const howto = await page.locator('[data-testid=howto]').count();
const seen = await page.evaluate(() => localStorage.getItem('sh:seenHowto'));
console.log('CR-13', JSON.stringify({ howtoShown: howto > 0, seenFlag: seen }));
await browser.close();
