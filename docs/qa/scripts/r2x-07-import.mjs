import { launch, BASE, nav, shot } from './r2x-lib.mjs';
import fs from 'fs';
const { browser, page } = await launch();
await page.goto(BASE + '#/library'); await page.waitForSelector('main'); await page.waitForTimeout(500);
const files = fs.readdirSync('content/raw').filter((f) => f.endsWith('.mxl'));
for (const f of files) {
  await nav(page, '#/library');
  const t = Date.now();
  await page.setInputFiles('input[type=file]', 'content/raw/' + f);
  await page.waitForFunction(() => location.hash.startsWith('#/piece') || document.querySelector('[role=alert]'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  const hash = await page.evaluate(() => location.hash);
  const tag = f.split('_')[0] + '-' + f.split('_')[1].slice(0, 10);
  console.log(`\n=== ${f} (${Date.now() - t}ms) -> ${hash}`);
  if (!hash.startsWith('#/piece')) { console.log('ERR', await page.innerText('main').then((s) => s.slice(0, 400))); continue; }
  const chips = await page.$$eval('button.chip', (b) => b.map((x) => x.textContent));
  console.log('header', (await page.innerText('main')).split('\n').slice(0, 3).join(' | '), '| parts:', chips.join(', '));
  for (let i = 0; i < chips.length; i++) {
    await page.locator('button.chip').nth(i).click(); await page.waitForTimeout(250);
    const txt = await page.innerText('main');
    const secs = [...txt.matchAll(/(Bars? [\d–]+|Whole piece)\n(“[^”]*”)?/g)].map((m) => `${m[1]} ${m[2] || '(no lyric)'}`);
    console.log(`  [${chips[i]}] ${secs.length} sections: ${secs.join(' ; ').slice(0, 600)}`);
    if (i === 0) await shot(page, `07-import-${tag}`, true);
  }
}
console.log('\nLIBRARY', (await nav(page, '#/library'), (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 3000)));
await shot(page, '07-library-after', true);
await browser.close();
