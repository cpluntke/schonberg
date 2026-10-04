// Screenshot the 2D highway mid-run in each notation mode. usage: node ux-notation.mjs <pieceId> <partName> <secIdx> <waitMs> <tag>
import { chromium } from '@playwright/test';
const [pieceId, partName, secIdx, waitMs, tag] = process.argv.slice(2);
const BASE = 'http://localhost:5179/?simulate=perfect';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
for (const [mode, label] of [['letter','Letters'],['fixed','Fixed do'],['movable','Movable do'],['jianpu','Jianpu'],['pc','Pitch classes']]) {
  await page.goto(BASE + '#/settings'); await page.waitForTimeout(1000);
  await page.getByText(label).first().click(); await page.waitForTimeout(200);
  await page.goto(BASE + '#/piece/' + pieceId); await page.waitForTimeout(1200);
  await page.getByRole('button', { name: partName, exact: true }).click();
  await page.locator('button:has-text("Learn")').nth(+secIdx).click();
  await page.waitForFunction(() => location.hash.startsWith('#/play'));
  await page.waitForTimeout(1000);
  await page.locator('[data-testid=start]').click();
  await page.waitForTimeout(+waitMs);
  await page.screenshot({ path: `docs/qa/shots-ux/nota-${tag}-${mode}.png` });
}
await browser.close();
