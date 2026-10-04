// QA round 3: first-run "How to read the screen" card, dev (StrictMode) vs production preview.
// Run: node docs/qa/scripts/r3-howto-prod.mjs [baseUrl]   (production: npx vite preview --port 5180 after a build)
import { launch, SHOTS, sleep } from './r3-lib.mjs';
const BASE = process.argv[2] || 'http://localhost:5179/';
for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  const { browser, page, errors } = await launch({ viewport: vp });
  await page.goto(BASE + '#/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('sh:profile', JSON.stringify({ name: 'Q', voice: 'S', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 0, onboarded: true })); });
  await page.goto(BASE + '#/play/warmup-chorale/P1/s0-m0-6?level=1'); await sleep(2500);
  const vis = await page.getByTestId('howto').isVisible().catch(() => false);
  const sb = await page.getByTestId('start').boundingBox();
  console.log(BASE, `${vp.width}x${vp.height}`, 'howto visible on first L1 run =', vis, 'start box', JSON.stringify(sb), 'seenHowto=', await page.evaluate(() => localStorage.getItem('sh:seenHowto')));
  await page.screenshot({ path: SHOTS + `r3-howto-${BASE.includes('5180') ? 'prod' : 'dev'}-${vp.width}x${vp.height}.png` });
  console.log('ERR', errors.filter((e) => !/service|sw|workbox/i.test(e)));
  await browser.close();
}
