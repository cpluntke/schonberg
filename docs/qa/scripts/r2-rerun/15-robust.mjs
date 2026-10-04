import { launch, BASE, shot, sleep, waitHash } from './lib.mjs';
import { setProfile } from './playlib.mjs';
const { browser, ctx, page, errors } = await launch();
await setProfile(page);
const T = async (n=200) => (await page.innerText('body')).replace(/\n+/g,' | ').slice(0, n);
const links = ['#/piece/nope', '#/play/nope/P1/s0?level=1', '#/play/bach-bwv315/P9/s0-m0-5?level=1', '#/play/bach-bwv315/P1/nosection?level=1',
  '#/play/bach-bwv315/P1/s0-m0-5?level=9', '#/play/bach-bwv315/P1/s0-m0-5?level=abc', '#/play/bach-bwv315/P1/drill?level=1&from=30&to=5', '#/play/bach-bwv315/P1/drill?level=1&from=NaN',
  '#/results', '#/zzz', '#/arcade/bach-bwv315/P1/s0-m0-5?level=1', '#/piece/%E0%A4%A'];
for (const l of links) {
  errors.length = 0;
  await page.goto(BASE + '?simulate=perfect' + l); await sleep(1800);
  const t = await T(220);
  let extra = '';
  const st = page.getByTestId('start');
  if (await st.count()) { await st.click(); await sleep(3500); extra = ' | after start: ' + (await T(160)) + ' hash=' + await page.evaluate(() => location.hash); }
  console.log(`\n${l} => ${t}${extra}\n  ERR ${JSON.stringify(errors).slice(0, 400)}`);
  await shot(page, '15-deeplink-' + l.replace(/[^a-z0-9]+/gi, '_').slice(0, 40));
}
// reload mid session
await page.goto(BASE + '?simulate=perfect#/play/bach-bwv315/P1/s0-m0-5?level=1'); await sleep(1500);
await page.getByTestId('start').click(); await sleep(4000); await page.reload(); await sleep(2500);
console.log('\nreload mid-session ->', await T(200));
// localStorage cleared mid-session
await page.getByTestId('start').click(); await sleep(3000);
await page.evaluate(() => localStorage.clear());
await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 90000 }).catch(() => {});
await sleep(800); console.log('\nafter LS clear mid-run ->', await T(300), 'ERR', errors);
await page.goto(BASE + '#/'); await sleep(1500); console.log('home after clear ->', await T(200));
// back button flows
await setProfile(page);
await page.goto(BASE + '?simulate=perfect#/'); await sleep(1500);
await page.locator('.nav button', { hasText: 'Library' }).click(); await sleep(400);
await page.locator('.list-row button.grow').nth(1).click(); await sleep(600);
await page.locator('.ladder-row').first().locator('button[aria-label*="level 1 "]').click(); await sleep(600);
for (let i = 0; i < 4; i++) { await page.goBack(); await sleep(600); console.log('goBack', i, await page.evaluate(() => location.hash)); }
// landscape
await page.setViewportSize({ width: 844, height: 390 });
for (const [u, n] of [['#/', 'home'], ['#/piece/bach-bwv315', 'piece'], ['#/play/bach-bwv315/P1/s0-m0-5?level=1', 'play'], ['#/arcade/bach-bwv315/P1/s0-m0-5?level=2', 'arcade'], ['#/expert','expert']]) {
  await page.goto(BASE + '?simulate=perfect' + u); await sleep(1500);
  if (n === 'play' || n === 'arcade') { await shot(page, '15-land-' + n + '-ready'); await page.getByTestId('start').click(); await sleep(6000); }
  await shot(page, '15-land-' + n);
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log('landscape', n, ov);
}
// rotate mid-run back to portrait
await page.setViewportSize({ width: 390, height: 844 }); await sleep(1500); await shot(page, '15-rotate-back-arcade');
// narrow 320
await page.setViewportSize({ width: 320, height: 640 });
for (const [u, n] of [['#/', 'home'], ['#/piece/brahms-schaffe', 'piece'], ['#/settings', 'settings'], ['#/ranks', 'ranks']]) {
  await page.goto(BASE + u); await sleep(1500); await shot(page, '15-320-' + n);
  console.log('320', n, await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })));
}
// portrait widths overflow check at 390
await page.setViewportSize({ width: 390, height: 844 });
for (const u of ['#/', '#/library', '#/piece/debussy-yver', '#/settings', '#/ranks', '#/expert', '#/setup', '#/tuner']) {
  await page.goto(BASE + u); await sleep(1200);
  console.log('390', u, await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })));
}
console.log('ERR', errors);
await browser.close();
