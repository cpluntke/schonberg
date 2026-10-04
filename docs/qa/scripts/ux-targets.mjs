// Lists interactive elements smaller than 44x44 CSS px on main screens; also screenshots a level-4 run.
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5179/?simulate=perfect';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
for (const h of ['/', '/piece/debussy-dieu', '/settings', '/ranks', '/expert', '/library']) {
  await page.goto(BASE + '#' + h); await page.waitForTimeout(1200);
  const small = await page.$$eval('button, a, input, select, [role=button]', els => els.map(e => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.innerText || e.tagName).replace(/\s+/g, ' ').slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.w > 0 && (x.w < 44 || x.h < 44)));
  console.log(h, JSON.stringify(small));
}
// level 4 (concert) of Debussy soprano section 1 via piece page
await page.goto(BASE + '#/piece/debussy-dieu'); await page.waitForTimeout(1200);
await page.locator('button:has-text("Concert")').first().click();
await page.waitForFunction(() => location.hash.startsWith('#/play'));
await page.waitForTimeout(800);
console.log('L4 READY:', (await page.innerText('body')).slice(0, 500));
await page.screenshot({ path: 'docs/qa/shots-ux/l4-ready.png' });
await page.locator('[data-testid=start]').click().catch(e => console.log('no start', e.message));
await page.waitForTimeout(5000);
await page.screenshot({ path: 'docs/qa/shots-ux/l4-run.png' });
// Listen (ear) button
await page.goto(BASE + '#/piece/debussy-dieu'); await page.waitForTimeout(1200);
await page.locator('button[aria-label^="Listen"]').first().click().catch(e => console.log('no listen', e.message));
await page.waitForTimeout(1500);
console.log('LISTEN hash', await page.evaluate(() => location.hash));
await page.screenshot({ path: 'docs/qa/shots-ux/listen.png' });
await browser.close();
