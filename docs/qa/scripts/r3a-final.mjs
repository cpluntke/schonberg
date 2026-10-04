import { launch, ctxFor, nav, shot, text } from './r3a-lib.mjs';
const b = await launch();
const A = await ctxFor('alto', 3, 'perfect');
const F = await ctxFor('sop', 3, 'perfect');
const pa = A.page, pf = F.page;
await shot(pa, 'f-01-home-rehearsalday', true); console.log('HOME-REH', await text(pa));
// expert
await nav(pa, '#/expert'); await shot(pa, 'f-02-expert', true); console.log('EXPERT', await text(pa));
const leap = pa.getByRole('button', { name: /Slow, with guide/ });
if (await leap.count()) { await leap.click(); await pa.waitForTimeout(800); await pa.getByTestId('start').click(); await pa.waitForTimeout(8000); await shot(pa, 'f-03-leapdrill'); console.log('LEAP', pa.url()); }
// settings + notation on highway
for (const [mode, re] of [['letter', /Letters/], ['fixed', /Fixed do/], ['jianpu', /Jianpu/], ['pc', /Pitch classes/], ['movable', /Movable do/]]) {
  await nav(pa, '#/settings'); await pa.getByRole('button', { name: re }).first().click();
  await nav(pa, '#/play/debussy-dieu/P2/s1-m5-12?level=1'); await pa.getByTestId('start').click(); await pa.waitForTimeout(6500);
  await shot(pa, 'f-04-notation-' + mode); await pa.getByRole('button', { name: 'Pause' }).click().catch(() => {});
}
await nav(pa, '#/settings'); await pa.getByRole('button', { name: /Just/ }).first().click(); 
const strict = pa.locator('[aria-label=Strictness] button'); console.log('STRICT opts', await strict.allInnerTexts()); await strict.last().click();
await shot(pa, 'f-05-settings', true); console.log('SETTINGS', await text(pa));
await nav(pa, '#/play/debussy-dieu/P2/s0-m0-4?level=3'); await shot(pa, 'f-06-L3-strict-just-ready'); console.log('L3READY', await text(pa));
// restore defaults
await nav(pa, '#/settings'); await pa.getByRole('button', { name: /Equal/ }).first().click(); await strict.nth(1).click();
// ranks: share codes both ways
async function code(p) {
  await nav(p, '#/ranks');
  await p.evaluate(() => { window.__clip = ''; navigator.clipboard.writeText = async (t) => { window.__clip = t; }; try { navigator.share = undefined; } catch {} });
  await p.getByRole('button', { name: /Share my ranking code/ }).click(); await p.waitForTimeout(600);
  let c = await p.evaluate(() => window.__clip);
  if (!c) c = await p.evaluate(() => (document.body.innerText.match(/SH1\.[A-Za-z0-9_\-\.=]+/) || [''])[0]);
  return c;
}
const ca = await code(pa); const cf = await code(pf);
console.log('CODES', ca.slice(0, 60), cf.slice(0, 60));
await shot(pa, 'f-07-ranks-before', true); console.log('RANKS-A0', await text(pa));
for (const [p, c, n] of [[pa, cf, 'a'], [pf, ca, 'f']]) {
  await p.locator('textarea').fill(c); await p.getByRole('button', { name: 'Add rankings' }).click(); await p.waitForTimeout(800);
  await shot(p, 'f-08-ranks-after-' + n, true); console.log('RANKS-' + n, await text(p));
}
// backup to friend's phone (new context)
await nav(pa, '#/settings');
const [dl] = await Promise.all([pa.waitForEvent('download', { timeout: 5000 }).catch(() => null), pa.getByRole('button', { name: 'Save backup file' }).click()]);
console.log('DOWNLOAD', dl && dl.suggestedFilename());
const path = dl ? await dl.path() : null;
const before = await pa.evaluate(() => localStorage.getItem('sh:progress:debussy-dieu:P2'));
const P = await ctxFor('phone', 3, null);
await nav(P.page, '#/settings');
if (path) { await P.page.locator('input[type=file]').setInputFiles(path); await P.page.waitForTimeout(1200); }
await shot(P.page, 'f-09-restore', true); console.log('RESTORE', (await text(P.page)).slice(0, 600));
const after = await P.page.evaluate(() => localStorage.getItem('sh:progress:debussy-dieu:P2'));
console.log('PROGRESS SAME', before === after, (after || '').slice(0, 120));
await nav(P.page, '#/'); await shot(P.page, 'f-10-phone-home', true); console.log('PHONEHOME', await text(P.page));
await A.save(); await F.save();
// day +11 review
const L = await ctxFor('alto', 11, 'perfect'); await L.page.waitForTimeout(500);
await shot(L.page, 'f-11-home-day12', true); console.log('HOME-D12', await text(L.page));
await nav(L.page, '#/piece/debussy-dieu'); await shot(L.page, 'f-12-piece-day12', true); console.log('PIECE-D12', await text(L.page));
await b.close();
