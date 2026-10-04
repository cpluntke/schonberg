import { launch, BASE, nav, shot } from './r2x-lib.mjs';
const { browser, page } = await launch({ viewport: { width: 180, height: 370 } });
await page.goto(BASE + '?simulate=perfect#/play/bach-bwv315/P1/s0-m0-5?level=1'); await page.waitForTimeout(1500);
const r = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Start singing/.test(x.textContent)); const rc = b.getBoundingClientRect();
  const se = document.scrollingElement; return { top: rc.top, bottom: rc.bottom, ih: innerHeight, iw: innerWidth, sh: se.scrollHeight, ch: se.clientHeight }; });
console.log(JSON.stringify(r));
await page.mouse.wheel(0, 600); await page.waitForTimeout(300);
await shot(page, '09-zoom-play-scrolled');
// try start via the round play fab
await page.getByRole('button', { name: 'Start', exact: true }).click({ timeout: 3000 }).then(() => console.log('fab ok')).catch((e) => console.log('fab fail', e.message.slice(0, 100)));
await browser.close();
