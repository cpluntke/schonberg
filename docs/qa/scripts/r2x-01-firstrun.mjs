import { launch, BASE, nav, shot, axe, targets } from './r2x-lib.mjs';
const { browser, page } = await launch();
const t0 = Date.now();
await page.goto(BASE + '#/');
await page.waitForSelector('main', { timeout: 20000 });
console.log('home load ms', Date.now() - t0);
await page.waitForTimeout(1500);
await shot(page, '01-home-first');
await shot(page, '01-home-first-full', true);
console.log('TEXT', (await page.innerText('body')).slice(0, 1500));
await axe(page, 'home'); await targets(page, 'home');
for (const r of ['#/library', '#/setup', '#/settings', '#/ranks', '#/expert', '#/tuner']) {
  await nav(page, r);
  const n = r.slice(2);
  await shot(page, `01-${n}`, true);
  console.log('TEXT', n, (await page.innerText('body')).slice(0, 1200).replace(/\n+/g, ' | '));
  await axe(page, n); await targets(page, n);
}
console.log('LS', await page.evaluate(() => JSON.stringify(Object.keys(localStorage))));
await browser.close();
