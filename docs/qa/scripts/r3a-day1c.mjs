import { launch, ctxFor, nav, shot, text, run } from './r3a-lib.mjs';
const b = await launch();
const { page, save } = await ctxFor('alto', 0, 'sloppy');
const t0 = Date.now();
// Home "Practise now"
await page.getByRole('button', { name: /Practise now/ }).click(); await page.waitForTimeout(800);
console.log('URL', page.url()); await shot(page, 'd1-c1-play-ready'); console.log('READY', await text(page));
await save();
let r = await run(page, page.url().split('#')[1] ? '#' + page.url().split('#')[1] : '', 'd1-c2-warm-s1-L1');
console.log('RES1', r, (Date.now() - t0) / 1000);
await save();
// listen debussy bars 1-5
r = await run(page, '#/play/debussy-dieu/' + 'ALTO' + '/x?level=0', 'd1-c3-bad', { maxMs: 3000, midShot: false });
await b.close();
