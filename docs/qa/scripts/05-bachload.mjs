import { launch, BASE, sleep } from './lib.mjs';
const { browser, page, errors } = await launch();
for (let i = 0; i < 4; i++) {
  await page.goto(BASE + (i%2 ? '?simulate=perfect' : '') + '#/piece/bach-bwv512'); await sleep(3000);
  console.log(i, (await page.innerText('main')).slice(0, 60).replace(/\n/g,' | '), 'cycle', await page.evaluate(() => localStorage.getItem('sh:cycle')));
}
console.log(errors);
await browser.close();
