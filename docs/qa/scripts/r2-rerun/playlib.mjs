import { BASE, shot, waitHash, sleep } from './lib.mjs';
export async function setProfile(page, extra = {}) {
  await page.goto(BASE + '#/');
  await page.evaluate((x) => localStorage.setItem('sh:profile', JSON.stringify({name:'Q',voice:'S',notation:'letter',strictness:'standard',tuning:'equal',latencyMs:0,onboarded:true, ...x})), extra);
}
/** Play from the piece screen: click the level button for section idx. */
export async function playFromPiece(page, { sim, pieceId, part = 0, sec = 0, level = 1, mode = '2d', tag, maxWait = 120000, beforeStart }) {
  await page.goto(BASE + (sim ? `?simulate=${sim}` : '') + `#/piece/${pieceId}`); await sleep(1500);
  await page.locator('[aria-label="Part"] .chip').nth(part).click(); await sleep(200);
  const row = page.locator('.ladder-row').nth(sec);
  if (mode === '3d') await row.locator('button[aria-label^="Arcade"]').click();
  else if (level === 0) await row.locator('button[aria-label^="Listen"]').click();
  else await row.locator(`button[aria-label*="level ${level} "]`).click();
  await waitHash(page, mode === '3d' ? 'arcade/' : 'play/'); await sleep(800);
  if (beforeStart) await beforeStart(page);
  const t0 = Date.now();
  await page.getByTestId('start').click();
  await sleep(2500); if (tag) await shot(page, tag + '-running');
  await page.waitForFunction(() => !location.hash.includes('play/') && !location.hash.includes('arcade/') || !!document.querySelector('[data-testid=start]'), null, { timeout: maxWait, polling: 500 });
  const hash = await page.evaluate(() => location.hash);
  await sleep(600);
  if (tag) await shot(page, tag + '-after');
  const text = await page.innerText('main').catch(() => '');
  return { hash, secs: ((Date.now() - t0) / 1000).toFixed(1), text };
}
