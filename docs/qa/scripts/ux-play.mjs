// usage: node ux-play.mjs <pieceId> <partName> <sectionIndex> <levelBtnIndex 0-3> <sim> <mode 2d|3d> <tag> [notation]
import { chromium } from '@playwright/test';
const [pieceId, partName, secIdx, lvlIdx, sim, mode, tag, notation] = process.argv.slice(2);
const BASE = 'http://localhost:5179/';
const OUT = 'docs/qa/shots-ux/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/CERT|fonts/.test(m.text())) logs.push(m.text()); });
const q = sim ? `?simulate=${sim}` : '';
if (notation) {
  await page.goto(BASE + q + '#/settings'); await page.waitForTimeout(1200);
  await page.getByText(notation, { exact: false }).first().click(); await page.waitForTimeout(300);
}
await page.goto(BASE + q + '#/piece/' + pieceId); await page.waitForTimeout(1500);
await page.getByRole('button', { name: partName, exact: true }).click();
await page.waitForTimeout(300);
const groups = page.locator('button:has-text("Learn")');
const sectionRows = await groups.count();
const lvlNames = ['Learn', 'In time', 'Alone', 'Concert'];
await page.locator(`button:has-text("${lvlNames[+lvlIdx]}")`).nth(+secIdx).click();
await page.waitForFunction(() => location.hash.startsWith('#/play'));
let hash = await page.evaluate(() => location.hash);
if (mode === '3d') { await page.goto(BASE + q + hash.replace('#/play', '#/arcade')); hash = await page.evaluate(() => location.hash); }
console.log('HASH', hash);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}${tag}-0ready.png` });
console.log('READY TEXT:', (await page.innerText('body')).slice(0, 800));
await page.locator('[data-testid=start], button[aria-label=Start]').first().click();
for (const t of [2500, 4000, 4000, 5000]) { await page.waitForTimeout(t); await page.screenshot({ path: `${OUT}${tag}-run${t}-${Date.now()%1000}.png` }); }
await page.waitForFunction(() => location.hash.startsWith('#/results'), null, { timeout: 120000 }).catch(() => console.log('no results within timeout'));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}${tag}-results.png`, fullPage: true });
console.log('RESULTS TEXT:', (await page.innerText('body')).slice(0, 2500));
console.log('ERRORS', logs);
await browser.close();
