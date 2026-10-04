// QA round 2: what happens to existing Bach progress now that the Bach piece was removed (9c52b25)?
import { launch, BASE, sleep } from './r2-rerun/lib.mjs';
import { setProfile } from './r2-rerun/playlib.mjs';
const { browser, page, errors } = await launch();
await setProfile(page); await sleep(1500);
await page.evaluate(() => {
  const c = JSON.parse(localStorage.getItem('sh:cycle') || '{}');
  c.pieceIds = ['bach-bwv315', ...(c.pieceIds || [])];
  localStorage.setItem('sh:cycle', JSON.stringify(c));
  localStorage.setItem('sh:progress:bach-bwv315:P1', JSON.stringify({ pieceId: 'bach-bwv315', partId: 'P1', sections: { 's0-m0-5': { level: 3, best: { 1: 1, 2: 1, 3: 1 }, attempts: 3, lastPracticed: Date.now(), lastPassed: Date.now() } }, totalAttempts: 3, bestScore: 5000 }));
});
await page.reload(); await sleep(2500);
console.log('HOME', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 700));
console.log('cycle', await page.evaluate(() => JSON.parse(localStorage.getItem('sh:cycle')).pieceIds));
await page.screenshot({ path: '/home/user/schonberg/docs/qa/shots-r2/r2-bach-removed-home.png' });
await page.goto(BASE + '#/piece/bach-bwv315'); await sleep(1500);
console.log('LINK', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 200));
await page.goto(BASE + '#/settings'); await sleep(1000);
await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('sh:cycle')); c.rehearsalDate = '2026-10-10'; c.concertDate = '2026-10-06'; localStorage.setItem('sh:cycle', JSON.stringify(c)); });
await page.reload(); await sleep(1200);
console.log('SETTINGS date warn', await page.locator('[role=alert]').allInnerTexts());
await page.goto(BASE + '#/'); await sleep(1000);
console.log('Edit dates box', await page.getByRole('button', { name: 'Edit dates' }).boundingBox().catch(() => null));
console.log('ERR', errors);
await browser.close();
