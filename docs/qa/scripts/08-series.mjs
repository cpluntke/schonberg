import { launch, BASE, shot, sleep } from './lib.mjs';
import { setProfile } from './playlib.mjs';
const [,, url, tag, n = '6', every = '2500', notation = 'letter'] = process.argv;
const { browser, page, errors } = await launch();
await setProfile(page, { notation });
await page.goto(BASE + url); await sleep(1500);
await shot(page, tag + '-ready');
await page.getByTestId('start').click();
for (let i = 0; i < +n; i++) { await sleep(+every); await shot(page, `${tag}-${i}`); }
console.log('score', await page.getByTestId('score').innerText().catch(()=>'-'), 'ERR', errors);
await browser.close();
