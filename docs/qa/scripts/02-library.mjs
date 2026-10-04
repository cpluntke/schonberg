import { launch, BASE, shot, waitHash, sleep } from './lib.mjs';
const { browser, page, errors } = await launch();
await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.setItem('sh:profile', JSON.stringify({name:'Q',voice:'S',notation:'letter',strictness:'standard',tuning:'equal',latencyMs:0,onboarded:true,leaderboardOptIn:false})));
await page.goto(BASE + '#/library'); await page.reload(); await sleep(4000);
await shot(page, '02-library');
const rows = page.locator('.list-row button.grow');
const n = await rows.count(); console.log('pieces', n, await rows.allInnerTexts());
for (let i = 0; i < n; i++) {
  await page.goto(BASE + '#/library'); await sleep(800);
  const t0 = Date.now();
  await page.locator('.list-row button.grow').nth(i).click(); await waitHash(page, 'piece/');
  await page.waitForSelector('.ladder-row, .muted', { timeout: 20000 }); await sleep(600);
  const id = await page.evaluate(() => location.hash);
  const parts = await page.locator('[aria-label="Part"] .chip').allInnerTexts();
  const secs = await page.locator('.ladder-row').evaluateAll(els => els.map(e => e.querySelector('.col.grow')?.innerText.replace(/\n/g,' | ')));
  console.log(`\n== ${id} (${Date.now()-t0}ms) parts=${JSON.stringify(parts)}\n  sections(${secs.length}):`, secs.slice(0, 30));
  await shot(page, '02-piece-' + id.split('/').pop());
  // per part sections count
  for (let p = 0; p < parts.length; p++) {
    await page.locator('[aria-label="Part"] .chip').nth(p).click(); await sleep(250);
    const c = await page.locator('.ladder-row').count();
    const first = await page.locator('.ladder-row .col.grow').first().innerText().catch(()=> 'NONE');
    const last = await page.locator('.ladder-row .col.grow').last().innerText().catch(()=> 'NONE');
    console.log(`   part ${parts[p]}: ${c} sections; first=${first.replace(/\n/g,' | ')}; last=${last.replace(/\n/g,' | ')}`);
  }
}
console.log('ERRORS', errors);
await browser.close();
