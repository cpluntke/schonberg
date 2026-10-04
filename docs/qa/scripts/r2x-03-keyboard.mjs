import { launch, BASE, nav, shot } from './r2x-lib.mjs';
const { browser, page } = await launch({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
await page.goto(BASE + '?simulate=perfect#/');
await page.waitForSelector('main'); await page.waitForTimeout(800);
async function tabWalk(label, n = 30) {
  const seq = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      return { tag: e.tagName, name: (e.getAttribute('aria-label') || e.textContent || e.value || '').trim().slice(0, 30), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 40), visible: r.width > 0 && r.bottom > 0 && r.top < innerHeight }; });
    seq.push(info);
    if (i === 3) await shot(page, `03-focus-${label}`);
  }
  console.log(`TAB[${label}]`, JSON.stringify(seq.map((s) => s && `${s.tag}:${s.name}|${s.outline}|${s.shadow}`)));
}
await tabWalk('home', 22);
// enter the practise via keyboard
await page.goto(BASE + '?simulate=perfect#/');
await page.waitForTimeout(500);
await page.getByRole('button', { name: /Practise now/ }).focus();
await page.keyboard.press('Enter');
await page.waitForFunction(() => location.hash.includes('play'));
await page.waitForTimeout(800);
console.log('focus after nav to play:', await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.textContent || '').slice(0, 30)));
await tabWalk('play', 12);
// mixer chips semantics
console.log('CHIPS', await page.$$eval('button', (b) => b.map((x) => `${x.textContent.trim()}|pressed=${x.getAttribute('aria-pressed')}|label=${x.getAttribute('aria-label')}`)));
// Space to start?
await page.keyboard.press('Escape');
await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
console.log('after space, has Finish?', await page.getByRole('button', { name: /Finish/ }).count());
console.log('live regions', await page.$$eval('[aria-live],[role=status],[role=alert]', (e) => e.map((x) => x.outerHTML.slice(0, 120))));
console.log('canvas', await page.$$eval('canvas', (e) => e.map((x) => `${x.getAttribute('role')}|${x.getAttribute('aria-label')}`)));
await browser.close();
