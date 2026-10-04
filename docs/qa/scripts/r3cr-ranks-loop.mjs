// QA round 3 code review (CR-09): Ranks screen with the local backend and leaderboardOptIn=true
// re-runs its effect forever (put → writeJSON emits → store version bump → effect → put …).
// Run: node docs/qa/scripts/r3cr-ranks-loop.mjs   (dev server on :5179)
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:5179/#/');
await page.evaluate(() => {
  localStorage.setItem('sh:profile', JSON.stringify({ name: 'Ann', voice: 'S', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 0, onboarded: true, leaderboardOptIn: true }));
});
await page.addInitScript(() => {
  const orig = Storage.prototype.setItem;
  window.__writes = 0;
  Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('sh:leaderboard')) window.__writes++; return orig.call(this, k, v); };
});
await page.goto('http://localhost:5179/#/ranks'); await page.reload();
await page.waitForTimeout(1500);
const a = await page.evaluate(() => window.__writes);
await page.waitForTimeout(2000);
const b = await page.evaluate(() => window.__writes);
console.log('CR-09', JSON.stringify({ writesAfter1_5s: a, writesAfter3_5s: b, perSecond: Math.round((b - a) / 2) }));
await browser.close();
