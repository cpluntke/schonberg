import { launch, ctxFor, nav, shot, text, run } from './r3a-lib.mjs';
const b = await launch();
const { page, save } = await ctxFor('sop', 0, 'perfect');
await nav(page, '#/setup');
await page.fill('input[type=text]', 'Mathilde');
await page.getByRole('button', { name: /^Soprano/ }).click();
await page.getByRole('button', { name: 'Skip' }).click(); await page.waitForTimeout(600);
await save();
for (const l of [1, 2]) {
  await nav(page, '#/piece/debussy-dieu');
  await page.getByRole('button', { name: `Bars 1–5, level ${l} ` , exact: false }).first().click(); await page.waitForTimeout(600);
  const r = await run(page, '#' + page.url().split('#')[1], `f-sop-L${l}`, { midShot: false });
  console.log('SOP', l, r.slice(0, 200));
  await save();
}
await b.close();
