import { launch, BASE, nav, shot } from './r2x-lib.mjs';
import fs from 'fs';
let { browser, ctx, page } = await launch({ acceptDownloads: true });
await page.goto(BASE + '#/settings'); await page.waitForSelector('main'); await page.waitForTimeout(500);
// cycle name & dates
const inputs = await page.$$eval('input', (a) => a.map((x) => `${x.type}|${x.getAttribute('aria-label')}|${x.id}|${x.value}`));
console.log('INPUTS', inputs);
const nameIn = page.getByLabel('Name').first();
await nameIn.fill('Herbstkonzert 2026').catch((e) => console.log('noname', e.message));
await page.getByLabel(/rehearsal/i).fill('2026-10-01').catch((e) => console.log('nodate', e.message)); // in the past
await page.getByLabel(/Concert/).fill('2026-09-20').catch((e) => console.log('noconc', e.message)); // concert before rehearsal, in past
await page.waitForTimeout(300);
await shot(page, '08-settings-cycle', true);
await page.getByRole('button', { name: /Choose the cycle's pieces/ }).click();
await page.waitForTimeout(500);
console.log('after choose', await page.evaluate(() => location.hash));
await nav(page, '#/');
await shot(page, '08-home-pastdates');
console.log('HOME', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 600));
// cycle with zero pieces
await nav(page, '#/library');
const boxes = await page.$$eval('[role=checkbox], input[type=checkbox], button[aria-pressed]', (a) => a.map((x) => `${x.tagName}|${x.getAttribute('aria-label')}|${x.getAttribute('aria-pressed') ?? x.getAttribute('aria-checked') ?? x.checked}`));
console.log('LIB toggles', boxes);
await shot(page, '08-library', true);
// backup
await nav(page, '#/settings');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.getByRole('button', { name: /Save backup file/ }).click()]);
if (dl) { const p = 'docs/qa/shots-r2x/backup.json'; await dl.saveAs(p); console.log('backup', dl.suggestedFilename(), fs.statSync(p).size); }
else console.log('no download event');
await page.waitForTimeout(500);
await shot(page, '08-after-backup');
// restore into a fresh context
const ctx2 = await browser.newContext({ viewport: { width: 360, height: 740 } });
const p2 = await ctx2.newPage();
p2.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
await p2.goto(BASE + '#/settings'); await p2.waitForSelector('main');
if (dl) {
  const fc = p2.waitForEvent('filechooser');
  await p2.getByRole('button', { name: /Restore from file/ }).click();
  (await fc).setFiles('docs/qa/shots-r2x/backup.json');
  await p2.waitForTimeout(1500);
  await shot(p2, '08-restored');
  console.log('restored body', (await p2.innerText('body')).replace(/\n+/g, ' | ').slice(0, 300));
  await p2.evaluate(() => { location.hash = '#/'; }); await p2.waitForTimeout(800);
  console.log('restored home', (await p2.innerText('main')).replace(/\n+/g, ' | ').slice(0, 300));
}
// garbage restore
const fc2 = p2.waitForEvent('filechooser');
await p2.evaluate(() => { location.hash = '#/settings'; }); await p2.waitForTimeout(500);
await p2.getByRole('button', { name: /Restore from file/ }).click();
fs.writeFileSync('/tmp/garbage.json', '{"hello":1}');
(await fc2).setFiles('/tmp/garbage.json'); await p2.waitForTimeout(1000);
console.log('garbage restore', (await p2.innerText('body')).match(/(not|invalid|couldn|error)[^|\n]{0,80}/i)?.[0]);
await shot(p2, '08-garbage-restore');
await browser.close();
// 200% zoom = 180 css px wide
({ browser, page } = await launch({ viewport: { width: 180, height: 370 } }));
await page.goto(BASE + '?simulate=perfect#/'); await page.waitForSelector('main'); await page.waitForTimeout(800);
for (const h of ['#/', '#/piece/bach-bwv315', '#/play/bach-bwv315/P1/s0-m0-5?level=1', '#/settings', '#/ranks']) {
  await nav(page, h);
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: innerWidth }));
  console.log('ZOOM', h, JSON.stringify(ov));
  await shot(page, '08-zoom200-' + h.replace(/[#/?=]/g, '_').slice(0, 30));
}
await browser.close();
