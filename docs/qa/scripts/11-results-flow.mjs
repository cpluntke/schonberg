import { launch, BASE, shot, sleep, waitHash } from './lib.mjs';
import { setProfile } from './playlib.mjs';
const { browser, page, errors } = await launch();
await setProfile(page);
const H = () => page.evaluate(() => location.hash);
const waitResults = () => page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 120000, polling: 500 });
const prog = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('sh:progress:bach')).map(([k,v]) => [k, Object.fromEntries(Object.entries(JSON.parse(v).sections).map(([s,x]) => [s, x.level]))])));
// Natural flow: piece -> play L1 -> results -> Again -> Quit
await page.goto(BASE + '?simulate=perfect#/'); await sleep(2000);
await page.goto(BASE + '?simulate=perfect#/piece/bach-bwv315'); await sleep(1500);
await page.locator('[aria-label="Part"] .chip').nth(1).click();
// slow-tempo test first: L1 at 40% should not count
await page.locator('.ladder-row').first().locator('button[aria-label*="level 1 "]').click(); await waitHash(page, 'play/'); await sleep(800);
await page.locator('input[type=range]').fill('100'); await sleep(200);
console.log('slider label at 100:', await page.locator('label.field span').innerText());
await page.locator('input[type=range]').evaluate((el) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, '40'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(300);
console.log('slider label:', await page.locator('label.field span').innerText());
await shot(page, '11-slow-tempo');
const t0 = Date.now();
await page.getByTestId('start').click(); await waitResults(); await sleep(800);
console.log('slow run took', ((Date.now()-t0)/1000).toFixed(0), 's; results:', (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 160));
console.log('progress after 40% run', JSON.stringify(await prog()));
await shot(page, '11-slow-results');
// Again -> then Quit
await page.getByRole('button', { name: 'Again' }).click(); await waitHash(page, 'play/'); await sleep(800);
await page.getByTestId('start').click(); await sleep(3000);
await page.getByRole('button', { name: 'Pause' }).click(); await sleep(400);
await page.getByRole('button', { name: 'Quit' }).click(); await sleep(1500);
console.log('Quit after Again ->', await H());
await shot(page, '11-quit-after-again');
// heat strip tap
await page.goto(BASE + '?simulate=perfect#/piece/bach-bwv315'); await sleep(1500);
await page.locator('.ladder-row').first().locator('button[aria-label*="level 2 "]').click(); await waitHash(page, 'play/'); await sleep(800);
await page.getByTestId('start').click(); await waitResults(); await sleep(800);
console.log('L2 result', (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 120));
const bars = page.locator('button[aria-label^="Bar "]');
console.log('heat bars', await bars.evaluateAll(b => b.map(x => x.getAttribute('aria-label'))));
const box = await bars.first().boundingBox(); console.log('heat bar size', box);
await bars.nth(2).click(); await sleep(1000);
console.log('heat tap ->', await H()); await shot(page, '11-heat-drill-ready');
console.log('drill overlay', (await page.locator('.overlay').innerText()).replace(/\n+/g,' | '));
await page.getByTestId('start').click(); await waitResults(); await sleep(800);
console.log('drill results', (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 500));
await shot(page, '11-drill-results');
// Arcade unlocked? go to piece
await page.goto(BASE + '?simulate=perfect#/piece/bach-bwv315'); await sleep(1500);
const arc = page.locator('.ladder-row').first().locator('button[aria-label^="Arcade"]');
console.log('arcade disabled?', await arc.isDisabled(), await arc.getAttribute('aria-label'));
await shot(page, '11-piece-after-L2');
await arc.click(); await waitHash(page, 'arcade/'); await sleep(800);
await shot(page, '11-arcade-ready');
await page.getByTestId('start').click(); await sleep(6000); await shot(page, '11-arcade-run1'); await sleep(4000); await shot(page, '11-arcade-run2');
await waitResults(); await sleep(800);
console.log('arcade results', (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 300));
await shot(page, '11-arcade-results');
console.log('progress', JSON.stringify(await prog()));
console.log('ERR', errors);
await browser.close();
