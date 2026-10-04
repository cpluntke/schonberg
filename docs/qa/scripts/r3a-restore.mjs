import { launch, ctxFor, nav, shot, text } from './r3a-lib.mjs';
const b = await launch();
const A = await ctxFor('alto', 3, 'perfect'); const pa = A.page;
await nav(pa, '#/settings');
const [dl] = await Promise.all([pa.waitForEvent('download'), pa.getByRole('button', { name: 'Save backup file' }).click()]);
const path = await dl.path();
const before = await pa.evaluate(() => localStorage.getItem('sh:progress:debussy-dieu:P2'));
const P = await ctxFor('phone2', 3, null); const pp = P.page;
let msg = ''; pp.on('dialog', (d) => { msg = d.message(); d.accept(); });
await nav(pp, '#/settings'); await pp.locator('input[type=file]').setInputFiles(path); await pp.waitForTimeout(1500);
console.log('DIALOG', msg); await shot(pp, 'f-13-restore-accepted');
const after = await pp.evaluate(() => localStorage.getItem('sh:progress:debussy-dieu:P2'));
console.log('PROGRESS SAME', before === after);
await nav(pp, '#/'); await shot(pp, 'f-14-phone-home-restored', true); console.log('PHONEHOME', (await text(pp)).slice(0, 700));
// ranks: does ranks remember piece? select Debussy
await nav(pa, '#/ranks'); await pa.selectOption('select[aria-label=Piece]', { label: "Dieu! qu'il la fait bon regarder!" }).catch(e => console.log('SEL', e.message));
await pa.waitForTimeout(500); await shot(pa, 'f-15-ranks-debussy', true); console.log('RANKS-DEB', (await text(pa)).slice(0, 900));
await b.close();
