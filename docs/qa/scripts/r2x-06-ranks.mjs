import { launch, BASE, nav, shot } from './r2x-lib.mjs';
const { browser, page } = await launch();
await page.goto(BASE + '#/ranks'); await page.waitForSelector('main'); await page.waitForTimeout(500);
const now = Math.floor(Date.now() / 1000);
const enc = (a) => 'SH1.' + Buffer.from(JSON.stringify(a)).toString('base64').replace(/=+$/, '');
const codes = [
  `My Schönberg Hero ranking for “Gib dich zufrieden, BWV 315”: 50% ready. ${enc(['Anna Schmidt', 'A', 'bach-bwv315', 0.5, 3000, 4, 0.2, now])}`,
  `${enc(['Ben', 'T', 'bach-bwv315', 0.75, 9000, 12, 0.3, now])}`,
  `${enc(['<img src=x onerror=alert(1)>', 'B', 'bach-bwv315', 5, 1e12, 9999, 9, now])}`,
  `${enc(['Old Tom', 'B', 'debussy-dieu', 0.2, 100, 1, 0, now - 86400 * 60])}`,
].join('\n');
await page.locator('textarea').fill(codes);
await page.getByRole('button', { name: /Add rankings/ }).click();
await page.waitForTimeout(700);
await shot(page, '06-ranks-others', true);
console.log((await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 1200));
for (const t of ['Climbers', 'Streaks', 'Points']) { await page.getByRole('button', { name: new RegExp(t) }).click().catch(()=>page.getByText(t).click()); await page.waitForTimeout(300); console.log(t, (await page.innerText('main')).replace(/\n+/g, ' | ').slice(200, 700)); }
await shot(page, '06-ranks-points', true);
await page.reload(); await page.waitForTimeout(800);
console.log('after reload', (await page.innerText('main')).includes('Anna'));
await browser.close();
