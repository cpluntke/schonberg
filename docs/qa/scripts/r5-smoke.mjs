// QA round 5 — smoke all screens at 390×844 with ?simulate=perfect and ?simulate=sloppy; report page errors + horizontal overflow.
import { fresh, nav, sleep, text, runToResults } from './r4-lib.mjs';
const SH = '/home/user/schonberg/docs/qa/shots-r5/';
const SCREENS = ['#/', '#/library', '#/piece/warmup-chorale', '#/piece/debussy-dieu', '#/setup', '#/settings', '#/ranks', '#/expert', '#/tuner'];
for (const sim of ['perfect', 'sloppy']) {
  const { browser, page, errors, q } = await fresh({ sim });
  await page.goto('http://localhost:5179/' + q + '#/'); await sleep(1500);
  for (const h of SCREENS) {
    await nav(page, h); await sleep(400);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const t = (await text(page)).slice(0, 90);
    console.log(sim, h, 'overflowX', ov, '|', t);
    await page.screenshot({ path: SH + `${sim}-${h.replace(/[#/]+/g, '_')}.png` });
  }
  for (const [pl, lv] of [['play', 1], ['arcade', 4]]) {
    await nav(page, `#/${pl}/warmup-chorale/P2/s0-m0-6?level=${lv}`); await sleep(1200);
    const btn = page.getByRole('button', { name: /start|sing|go|play/i }).first();
    if (await btn.count()) { try { await btn.click({ timeout: 3000 }); } catch {} }
    await runToResults(page, 90000);
    const t = await text(page);
    console.log(sim, pl, lv, '→', page.url().split('#')[1], '|', t.slice(0, 260));
    await page.screenshot({ path: SH + `${sim}-${pl}-results.png`, fullPage: true });
  }
  console.log(sim, 'ERRORS', JSON.stringify(errors));
  await browser.close();
}
