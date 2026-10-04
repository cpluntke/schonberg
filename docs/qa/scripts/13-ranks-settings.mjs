import { launch, BASE, shot, sleep, waitHash } from './lib.mjs';
import { setProfile } from './playlib.mjs';
import fs from 'fs';
const { browser, ctx, page, errors } = await launch();
page.on('dialog', d => { console.log('DIALOG', d.type(), d.message().slice(0,150)); d.accept(); });
await setProfile(page, { name: 'Qa Tester' });
const T = async (n=600) => (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, n);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const code = (arr) => 'SH1.' + b64(JSON.stringify(arr));
// generate some progress first so "me" exists
await page.evaluate(() => { localStorage.setItem('sh:progress:bach-bwv315:P1', JSON.stringify({pieceId:'bach-bwv315',partId:'P1',sections:{'s0-m0-5':{level:3,best:{1:1,2:1,3:1},attempts:3,lastPracticed:Date.now(),lastPassed:Date.now()}},totalAttempts:3,bestScore:5000})); localStorage.setItem('sh:log', JSON.stringify([{at:Date.now(),pieceId:'bach-bwv315',partId:'P1',sectionId:'s0-m0-5',level:3,accuracy:1,score:5000,passed:true}])); });
if (process.env.SKIP) { await page.goto(BASE + '#/settings'); await sleep(1000); } else {
await page.goto(BASE + '#/ranks'); await sleep(2000);
await shot(page, '13-ranks'); console.log('RANKS', await T(900));
const tabs = page.locator('[aria-label="Rank by"] button');
for (let i = 0; i < await tabs.count(); i++) { await tabs.nth(i).click(); await sleep(200); console.log(' tab', (await tabs.nth(i).innerText()).replace(/\n/g,' '), '->', (await T(2000)).split('Rank by')[1]?.slice(0, 250)); }
// share
await page.getByRole('button', { name: /Share my ranking code/ }).click(); await sleep(800);
console.log('after share:', await page.locator('.toast').allInnerTexts(), 'clip:', await page.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e.message)));
// paste codes
const now = Math.round(Date.now() / 1000);
const codes = [
  code(['Marie', 'A', 'bach-bwv315', 750, 1200, 4, 100, now]),
  code(['<img src=x onerror=alert(1)>', 'T', 'bach-bwv315', 500, 300, 2, -50, now]),
  code(['Zukunft', 'B', 'bach-bwv315', 2000, 99999999999, 999999, 5000, now + 86400 * 365]),
  'SH1.garbage!!', 'hello',
];
const ta = page.locator('textarea'); console.log('textarea count', await ta.count());
await ta.last().fill('Marie: ' + codes[0] + '\n' + codes.slice(1).join('\n'));
await page.getByRole('button', { name: 'Add rankings' }).click(); await sleep(800);
console.log('toast', await page.locator('.toast').allInnerTexts());
await shot(page, '13-ranks-after-paste'); console.log('RANKS2', await T(1200));
// SETTINGS
await page.goto(BASE + '#/settings'); await sleep(1500); await shot(page, '13-settings');
console.log('SETTINGS', await T(1500));
const choices = page.locator('main .choice');
for (let i = 0; i < await choices.count(); i++) { await choices.nth(i).click(); await sleep(100); }
const segs = page.locator('[aria-label="Strictness"] button');
for (let i = 0; i < await segs.count(); i++) { await segs.nth(i).click(); await sleep(100); }
console.log('profile', await page.evaluate(() => localStorage.getItem('sh:profile')));
// cycle dates
const dates = page.locator('input[type=date]');
await dates.nth(0).fill('2026-10-10'); await dates.nth(1).fill('2026-10-06'); await sleep(300);
await page.locator('input[placeholder^="e.g."]').fill('Herbstkonzert');
await page.locator('input[type=number]').fill('-50'); await sleep(200);
console.log('latency after -50:', await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile')).latencyMs));
await page.locator('input[type=number]').fill('99999'); await sleep(200);
console.log('latency after 99999:', await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile')).latencyMs));
await page.locator('input[type=number]').fill('80');
await page.goto(BASE + '#/'); await sleep(1500); await shot(page, '13-home-dates'); console.log('HOME', (await T(500)));
// past dates
await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('sh:cycle')); c.rehearsalDate = '2026-09-01'; c.concertDate = '2026-09-20'; localStorage.setItem('sh:cycle', JSON.stringify(c)); });
await page.reload(); await sleep(2000); await shot(page, '13-home-past-dates'); console.log('HOME past', (await T(400)));
}
// backup save
await page.goto(BASE + '#/settings'); await sleep(1500);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.getByRole('button', { name: 'Save backup file' }).click()]);
let backupPath = null;
if (dl) { backupPath = '/home/user/schonberg/docs/qa/fixtures/backup.json'; await dl.saveAs(backupPath); console.log('backup', dl.suggestedFilename(), fs.statSync(backupPath).size, 'bytes, keys', Object.keys(JSON.parse(fs.readFileSync(backupPath,'utf8'))).slice(0,20)); }
else console.log('NO DOWNLOAD');
// wipe and restore from file
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sh:progress')) localStorage.removeItem(k); });
if (backupPath) { await page.setInputFiles('input[aria-label="Backup file"]', backupPath); await sleep(1500); console.log('restore file toast', await page.locator('.toast, [role=alert]').allInnerTexts(), 'progress back?', await page.evaluate(() => !!localStorage.getItem('sh:progress:bach-bwv315:P1'))); }
// invalid backups
for (const bad of ['{not json', '{"foo": 1}', '[]', '{"sh:profile": "x"}']) {
  await page.goto(BASE + '#/settings'); await sleep(1200);
  const tas = page.locator('textarea[aria-label="Backup JSON"]');
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); await sleep(300);
  await page.locator('textarea[aria-label="Backup JSON"]').fill(bad);
  await page.getByRole('button', { name: 'Restore', exact: true }).click(); await sleep(800);
  console.log('bad backup', JSON.stringify(bad), '->', await page.locator('.toast, [role=alert], .notice').allInnerTexts(), '| app ok:', (await page.innerText('body')).length > 100);
}
await shot(page, '13-settings-bad-backup');
// invalid backup file (txt)
await page.setInputFiles('input[aria-label="Backup file"]', '/home/user/schonberg/docs/qa/fixtures/notes.txt'); await sleep(800);
console.log('bad file ->', await page.locator('.toast, [role=alert], .notice').allInnerTexts());
console.log('ERR', errors);
await browser.close();
