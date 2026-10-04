// QA round 3: audio interruption (AudioContext suspended by the OS) during a run → should pause.
// Run: node docs/qa/scripts/r3-interrupt.mjs
import { launch, BASE, SHOTS, sleep } from './r3-lib.mjs';
const txt = async (page) => (await page.innerText('main').catch(() => '')).replace(/\n+/g, ' | ');
for (const [i, waitMs] of [[1, 6000], [2, 6000], [3, 2000], [4, 10000]]) {
  const { browser, page, errors } = await launch();
  await page.addInitScript(() => {
    const Orig = window.AudioContext; window.__ctxs = [];
    window.AudioContext = class extends Orig { constructor(...a) { super(...a); window.__ctxs.push(this); this.addEventListener('statechange', () => (window.__log ||= []).push(performance.now().toFixed(0) + ':' + this.state)); } };
  });
  await page.goto(BASE + '#/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('sh:profile', JSON.stringify({ name: 'Q', voice: 'S', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 0, onboarded: true })); });
  await page.goto(BASE + '?simulate=perfect#/play/warmup-chorale/P1/s0-m0-6?level=2'); await sleep(1800);
  await page.getByTestId('start').click(); await sleep(waitMs);
  const nCtx = await page.evaluate(() => window.__ctxs.length);
  await page.evaluate(() => Promise.all(window.__ctxs.map((c) => c.suspend())));
  await sleep(1500);
  const paused = await page.getByRole('button', { name: 'Resume' }).count();
  console.log(`RUN${i} wait ${waitMs}ms ctxs=${nCtx} states=${JSON.stringify(await page.evaluate(() => window.__ctxs.map((c) => c.state)))} log=${JSON.stringify(await page.evaluate(() => window.__log))} pausedOverlay=${paused} | ${(await txt(page)).slice(0, 120)}`);
  if (i === 2) await page.screenshot({ path: SHOTS + 'r3-interrupt.png' });
  if (paused) {
    await page.getByRole('button', { name: 'Resume' }).click(); await sleep(1000);
    console.log(`RUN${i} after Resume states=${JSON.stringify(await page.evaluate(() => window.__ctxs.map((c) => c.state)))}`);
  } else {
    await sleep(4000);
    console.log(`RUN${i} not paused; 4 s later: ${(await txt(page)).slice(0, 160)}`);
  }
  await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 40000 }).catch(() => console.log(`RUN${i} no results within 40 s`));
  console.log(`RUN${i} end hash ${await page.evaluate(() => location.hash)} | ${(await txt(page)).slice(0, 140)}`);
  console.log('ERR', errors); await browser.close();
}
