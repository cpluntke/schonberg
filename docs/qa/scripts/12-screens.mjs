import { launch, BASE, shot, sleep, waitHash } from './lib.mjs';
import { setProfile } from './playlib.mjs';
const { browser, page, errors } = await launch();
page.on('dialog', d => { console.log('DIALOG', d.type(), d.message().slice(0,100)); d.accept(); });
await setProfile(page);
const H = () => page.evaluate(() => location.hash);
const T = async (n=500) => (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, n);
const waitResults = () => page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 200000, polling: 500 });
// EXPERT
await page.goto(BASE + '?simulate=perfect#/'); await sleep(2000);
await page.locator('button.card.expert').click(); await waitHash(page, 'expert'); await sleep(800);
await shot(page, '12-expert'); console.log('EXPERT', await T(900));
for (const f of ['R0', 'I0', 'RI0', 'P0']) { await page.locator('[aria-label="Row form"] button', { hasText: new RegExp(`^${f}$`) }).click(); await sleep(200); console.log(' form', f, (await page.locator('main').innerText()).match(/(\d|t|e)( \| [^|]+ \| (\d|t|e)){3}/)?.[0] ?? (await T(200))); }
await shot(page, '12-expert-P');
await page.getByRole('button', { name: 'With guide tone' }).click(); await sleep(1500); console.log('row guide ->', await H()); await shot(page, '12-row-ready');
await page.getByTestId('start').click(); await sleep(5000); await shot(page, '12-row-run');
await waitResults(); await sleep(800); console.log('row results', await T(400)); await shot(page, '12-row-results');
await page.goto(BASE + '?simulate=perfect#/expert'); await sleep(1500);
await page.getByRole('button', { name: 'No help' }).click(); await sleep(1200); console.log('no help ->', await H());
await page.goto(BASE + '?simulate=perfect#/expert'); await sleep(1500);
await page.getByRole('button', { name: /Arcade/ }).first().click(); await sleep(1200); console.log('row arcade ->', await H()); await shot(page, '12-row-arcade-ready');
await page.goto(BASE + '?simulate=perfect#/expert'); await sleep(1500);
const leap = page.getByRole('button', { name: /Slow, with guide/ });
if (await leap.count()) { await leap.click(); await sleep(1200); console.log('leap ->', await H()); await shot(page, '12-leap-ready');
  await page.getByTestId('start').click(); await sleep(5000); await shot(page, '12-leap-run'); await waitResults(); await sleep(600); console.log('leap results', await T(300)); }
else console.log('NO LEAP DRILL BUTTON', await T(1500));
// reload on a generated row play route
await page.goto(BASE + '?simulate=perfect#/expert'); await sleep(1500);
await page.getByRole('button', { name: 'With guide tone' }).click(); await sleep(1200);
await page.reload(); await sleep(2500); console.log('reload on row play:', await H(), await T(150));
// WHOLE PIECE
await page.goto(BASE + '?simulate=perfect#/piece/bach-bwv315'); await sleep(1500);
await page.evaluate(() => window.scrollTo(0, 99999)); await sleep(300); await shot(page, '12-piece-bottom');
await page.getByRole('button', { name: 'Concert mode' }).click(); await sleep(1200); console.log('whole ->', await H()); await shot(page, '12-whole-ready');
const t0 = Date.now(); await page.getByTestId('start').click(); await sleep(8000); await shot(page, '12-whole-run');
await waitResults(); await sleep(800); console.log('whole took', ((Date.now()-t0)/1000)|0, 's', await T(500)); await shot(page, '12-whole-results');
console.log('ERR', errors);
await browser.close();
