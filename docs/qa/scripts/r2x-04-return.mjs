import { launch, BASE, nav, shot, axe, targets } from './r2x-lib.mjs';
const { browser, page } = await launch();
await page.goto(BASE + '?simulate=perfect#/');
await page.waitForSelector('main');
async function run(hash, label, maxMs = 90000) {
  await nav(page, hash);
  await page.getByRole('button', { name: /Start singing|Listen|Start/ }).first().click();
  await page.waitForTimeout(2500);
  await shot(page, label + '-mid');
  await page.waitForFunction(() => location.hash.includes('results') || location.hash.includes('piece'), null, { timeout: maxMs }).catch(() => console.log('timeout', label));
  await page.waitForTimeout(800);
  await shot(page, label + '-end', true);
  console.log(label, await page.evaluate(() => location.hash), (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 400));
}
await run('#/play/bach-bwv315/P1/s0-m0-5?level=1', '04-s0-l1');
await run('#/play/bach-bwv315/P1/s0-m0-5?level=2', '04-s0-l2');
await run('#/play/bach-bwv315/P1/s0-m0-5?level=3', '04-s0-l3');
await nav(page, '#/piece/bach-bwv315');
await shot(page, '04-piece-after', true);
console.log('PIECE', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 1500));
await axe(page, 'piece'); await targets(page, 'piece');
// shift time back 1 day
async function shift(days) {
  await page.evaluate((ms) => {
    for (const k of Object.keys(localStorage)) { if (!k.startsWith('sh:')) continue;
      const v = localStorage.getItem(k); localStorage.setItem(k, v.replace(/\b(1[7-9]\d{11})\b/g, (m) => String(Number(m) - ms))); }
  }, days * 86400000);
  await page.reload(); await page.waitForSelector('main'); await page.waitForTimeout(800);
}
await shift(1);
await nav(page, '#/'); await page.waitForTimeout(300);
await shot(page, '04-home-nextday', true);
console.log('HOME+1', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 700));
await shift(8);
await nav(page, '#/library'); await nav(page, '#/');
await shot(page, '04-home-9days', true);
console.log('HOME+9', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 700));
await nav(page, '#/piece/bach-bwv315');
await shot(page, '04-piece-9days', true);
console.log('PIECE+9', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 700));
await browser.close();
