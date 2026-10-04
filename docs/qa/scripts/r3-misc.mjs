// QA round 3: tap targets, 200% zoom, landscape, directions overlap, heat strip, entry countdown screenshot.
// Run: node docs/qa/scripts/r3-misc.mjs
import { launch, BASE, SHOTS, sleep } from './r3-lib.mjs';
const PROFILE = { name: 'Q', voice: 'S', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 0, onboarded: true };
const small = (page) => page.evaluate(() => [...document.querySelectorAll('button, a, input, select, [role=button]')]
  .filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) }; })
  .filter((x) => x.w < 44 || x.h < 44));
async function setup(opts) {
  const L = await launch(opts);
  await L.page.goto(BASE + '#/');
  await L.page.evaluate((p) => { localStorage.setItem('sh:profile', JSON.stringify(p)); localStorage.setItem('sh:seenHowto', '1'); }, PROFILE);
  return L;
}
{
  const { browser, page, errors } = await setup();
  for (const h of ['#/', '#/settings', '#/ranks', '#/library', '#/piece/warmup-chorale']) {
    await page.goto(BASE + h); await sleep(1500);
    console.log('SMALL', h, JSON.stringify(await small(page)));
  }
  // sloppy results heat strip
  await page.goto(BASE + '?simulate=sloppy#/play/debussy-dieu/P1/' + (await page.evaluate(async () => { const m = await import('/src/ui/library.ts'); await m.ensureLibrary?.(); return ''; })));
  await browser.close();
}
{
  // Debussy Dieu L1 start: directions overlap (R2-06) + entry countdown
  const { browser, page, errors } = await setup();
  await page.goto(BASE + '#/piece/debussy-dieu'); await sleep(2000);
  const secId = await page.evaluate(() => { const b = document.querySelector('.ladder-row button[aria-label*="level 1 "]'); return b?.getAttribute('aria-label'); });
  await page.locator('.ladder-row').first().locator('button[aria-label*="level 1 "]').click(); await sleep(1200);
  const playHash = await page.evaluate(() => location.hash);
  console.log('DIEU play hash', playHash, secId);
  await page.screenshot({ path: SHOTS + 'r3-dieu-ready.png' });
  await page.goto(BASE + '?simulate=perfect' + playHash); await sleep(1500);
  await page.getByTestId('start').click(); await sleep(400);
  await page.screenshot({ path: SHOTS + 'r3-dieu-countin.png' });
  await sleep(2600);
  await page.screenshot({ path: SHOTS + 'r3-dieu-start.png' });
  // sloppy run → results heat strip
  await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 90000 }).catch(() => {});
  await page.goto(BASE + '?simulate=sloppy' + playHash.replace('level=1', 'level=2')); await sleep(1500);
  await page.getByTestId('start').click();
  await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 90000 }).catch(() => {});
  await sleep(800);
  await page.screenshot({ path: SHOTS + 'r3-sloppy-results.png', fullPage: true });
  console.log('RESULTS sloppy:', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 700));
  console.log('SMALL results', JSON.stringify(await small(page)));
  console.log('ERR', errors); await browser.close();
}
{
  // 200% zoom (180x370) scroll widths
  const { browser, page } = await setup({ viewport: { width: 180, height: 370 } });
  for (const h of ['#/', '#/settings', '#/ranks', '#/play/warmup-chorale/P1/s0-m0-6?level=1']) {
    await page.goto(BASE + h); await sleep(1500);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    const st = await page.getByTestId('start').boundingBox().catch(() => null);
    console.log('ZOOM200', h, 'scrollWidth', sw, st ? 'start ' + JSON.stringify(st) : '');
  }
  await page.screenshot({ path: SHOTS + 'r3-zoom200-play.png' });
  await browser.close();
}
{
  // landscape: running play + results
  const { browser, page, errors } = await setup({ viewport: { width: 844, height: 390 } });
  await page.goto(BASE + '?simulate=perfect#/play/warmup-chorale/P1/s0-m0-6?level=2'); await sleep(1500);
  await page.getByTestId('start').click(); await sleep(5000);
  const pb = await page.getByRole('button', { name: 'Pause' }).boundingBox();
  console.log('LAND running Pause box', JSON.stringify(pb), 'scroll', await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]));
  await page.screenshot({ path: SHOTS + 'r3-land-running.png' });
  await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 60000 }).catch(() => {});
  await sleep(800);
  await page.screenshot({ path: SHOTS + 'r3-land-results.png' });
  console.log('LAND results scroll', await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]));
  console.log('ERR', errors); await browser.close();
}
