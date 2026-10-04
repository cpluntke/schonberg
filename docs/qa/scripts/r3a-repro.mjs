import { launch, ctxFor, nav, shot, text } from './r3a-lib.mjs';
const b = await launch();
const { page } = await ctxFor('phone2', 3, 'perfect');
await nav(page, '#/piece/debussy-dieu');
await page.getByRole('button', { name: 'Listen to Bars 1–5' }).click(); await page.waitForTimeout(800);
await page.getByTestId('start').click();
const t0 = Date.now();
for (let i = 0; i < 40; i++) { await page.waitForTimeout(2000); if (await page.getByTestId('start').count()) break; }
console.log('listen ended after', (Date.now() - t0) / 1000, 's');
await page.getByRole('button', { name: 'Back' }).first().click(); await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Bars 1–5, level 1 Note-learning' }).click(); await page.waitForTimeout(800);
await page.getByTestId('start').click(); const t1 = Date.now();
for (let i = 0; i < 40; i++) { await page.waitForTimeout(2000); if (/results/.test(page.url())) break; }
console.log('L1 after listen: url', page.url().split('#')[1], (Date.now() - t1) / 1000, 's');
await shot(page, 'f-16-after-listen-L1');
await b.close();
