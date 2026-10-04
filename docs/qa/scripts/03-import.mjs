import { launch, BASE, shot, waitHash, sleep } from './lib.mjs';
const F = '/home/user/schonberg/docs/qa/fixtures/';
const { browser, page, errors } = await launch();
await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.setItem('sh:profile', JSON.stringify({name:'Q',voice:'S',notation:'letter',strictness:'standard',tuning:'equal',latencyMs:0,onboarded:true})));
async function imp(path, tag) {
  await page.goto(BASE + '#/library'); await sleep(1200);
  errors.length = 0;
  await page.setInputFiles('input[type=file]', path);
  await sleep(4000);
  const hash = await page.evaluate(() => location.hash);
  const alert = await page.locator('[role=alert]').allInnerTexts();
  const toast = await page.locator('.toast, [role=status]').allInnerTexts().catch(()=>[]);
  console.log(`\n[${tag}] hash=${hash} alert=${JSON.stringify(alert)} toast=${JSON.stringify(toast)} errs=${JSON.stringify(errors)}`);
  if (hash.includes('piece/')) {
    const parts = await page.locator('[aria-label="Part"] .chip').allInnerTexts();
    const secs = await page.locator('.ladder-row .col.grow').allInnerTexts();
    console.log('  title', await page.locator('h1').first().innerText(), 'parts', parts, 'secs', secs.map(s=>s.split('\n')[0]));
  }
  await shot(page, '03-import-' + tag);
}
await imp('/home/user/schonberg/public/pieces/warmup-chorale.musicxml', 'warmup');
await imp('/home/user/schonberg/content/raw/elgar_there-is-sweet-music_op53-1.mxl', 'elgar');
await imp('/home/user/schonberg/content/raw/reger_nachtlied_op138-3.mxl', 'reger');
await imp(F + 'qa-test-song.mid', 'midi');
await imp(F + 'random.mxl', 'random-mxl');
await imp(F + 'random.mid', 'random-mid');
await imp(F + 'notes.txt', 'txt');
await imp(F + 'fake.musicxml', 'fake-xml');
await imp(F + 'empty.xml', 'empty');
await imp(F + 'rests-only.musicxml', 'rests');
await imp('/home/user/schonberg/public/pieces/warmup-chorale.musicxml', 'warmup-again');
await page.goto(BASE + '#/library'); await sleep(1000);
const titles = await page.locator('.list-row button.grow span.ellipsis:first-child').allInnerTexts();
console.log('\nLIBRARY NOW', titles);
await page.evaluate(() => window.scrollTo(0, 99999)); await sleep(300);
await shot(page, '03-library-after-imports');
// persistence of imports across reload
await page.reload(); await sleep(3000);
console.log('after reload count', await page.locator('.list-row').count());
// delete an imported piece
const del = page.locator('button[aria-label^="Delete"]');
console.log('delete buttons', await del.evaluateAll(b => b.map(x => x.getAttribute('aria-label'))));
page.on('dialog', d => { console.log('DIALOG', d.message()); d.accept(); });
await del.first().click(); await sleep(1000);
console.log('after delete count', await page.locator('.list-row').count());
// cycle toggling
const tiles = page.locator('.mono-tile');
console.log('cycle tiles', await tiles.evaluateAll(b => b.map(x => x.getAttribute('aria-label'))));
await tiles.nth(0).click(); await sleep(300);
await tiles.nth(2).click(); await sleep(300);
console.log('cycle', await page.evaluate(() => localStorage.getItem('sh:cycle')));
await page.goto(BASE + '#/'); await sleep(1500);
console.log('HOME repertoire', (await page.locator('.list-row').allInnerTexts()).map(s=>s.split('\n')[1]));
await shot(page, '03-home-after-cycle');
console.log('ERR', errors);
await browser.close();
