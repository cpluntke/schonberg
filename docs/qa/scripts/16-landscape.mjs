import { launch, BASE, shot, sleep } from './lib.mjs';
import { setProfile } from './playlib.mjs';
const { browser, page } = await launch({ viewport: { width: 844, height: 390 } });
await setProfile(page);
await page.goto(BASE + '?simulate=perfect#/play/bach-bwv315/P1/s0-m0-5?level=1'); await sleep(1800);
const info = async () => page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
  return { start: r('[data-testid=start]'), pause: r('button[aria-label=Pause]'), play: r('button[aria-label=Start]'), sh: document.scrollingElement.scrollHeight, ih: innerHeight,
    overflow: getComputedStyle(document.querySelector('main.play')).overflow, bodyOv: getComputedStyle(document.body).overflow };
});
console.log('ready', await info());
await page.getByTestId('start').click(); await sleep(2000);
console.log('running', await info());
await page.mouse.wheel(0, 500); await sleep(300); await page.evaluate(() => window.scrollTo(0, 9999)); await sleep(300);
console.log('after scroll', await info(), 'scrollY', await page.evaluate(() => scrollY));
await shot(page, '16-land-play-scrolled');
await browser.close();
