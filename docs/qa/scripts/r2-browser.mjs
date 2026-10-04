// QA round 2: targeted browser checks for round-1 fixes and regressions.
// Run from repo root: node docs/qa/scripts/r2-browser.mjs [only=a,b,...]
import { launch, BASE, sleep, waitHash } from './r2-rerun/lib.mjs';
import { setProfile } from './r2-rerun/playlib.mjs';
const SH = '/home/user/schonberg/docs/qa/shots-r2/';
const only = (process.argv[2] || '').split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const txt = async (page, n = 400) => (await page.innerText('main').catch(() => '')).replace(/\n+/g, ' | ').slice(0, n);
const prog = (page, id = 'bach-bwv315') => page.evaluate((id) => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('sh:progress:' + id)).map(([k, v]) => [k, Object.fromEntries(Object.entries(JSON.parse(v).sections).map(([s, x]) => [s, { lvl: x.level, best: x.best, att: x.attempts }]))])), id);
const waitResults = (page) => page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 150000, polling: 300 });

// ---------- F2: id migration
if (want('migrate')) {
  const { browser, page, errors } = await launch();
  await setProfile(page);
  await sleep(1500);
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('sh:cycle') || '{}');
    c.pieceIds = ['bach-bwv512', ...(c.pieceIds || []).filter((x) => x !== 'bach-bwv315')];
    localStorage.setItem('sh:cycle', JSON.stringify(c));
    localStorage.setItem('sh:progress:bach-bwv512:P1', JSON.stringify({ pieceId: 'bach-bwv512', partId: 'P1', sections: { 's0-m0-5': { level: 2, best: { 1: 1, 2: 0.95 }, bestScore: { 1: 4000, 2: 5000 }, attempts: 2, lastPracticed: Date.now(), lastPassed: Date.now() } }, totalAttempts: 2, bestScore: 5000 }));
    localStorage.setItem('sh:log', JSON.stringify([{ at: Date.now() - 3600e3, pieceId: 'bach-bwv512', partId: 'P1', sectionId: 's0-m0-5', level: 2, accuracy: 0.95, score: 5000, passed: true }]));
  });
  await page.reload(); await sleep(2500);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('bach')));
  const cyc = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:cycle')).pieceIds);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:log')).map((e) => e.pieceId));
  console.log('MIGRATE keys', keys, 'cycle', cyc, 'log pieceIds', log);
  console.log('MIGRATE home', await txt(page, 700));
  await page.goto(BASE + '#/piece/bach-bwv512'); await sleep(1500);
  console.log('MIGRATE old link', await txt(page, 300), 'hash', await page.evaluate(() => location.hash));
  await page.screenshot({ path: SH + 'r2-migrate-oldlink.png' });
  console.log('MIGRATE errors', errors);
  await browser.close();
}

// ---------- F5 / partial finish: progress, results copy, count-in finish
if (want('partial')) {
  const { browser, page, errors } = await launch();
  await setProfile(page);
  const P = BASE + '?simulate=perfect#/play/bach-bwv315/P3/s0-m0-5?level=2';
  await page.goto(BASE + '?simulate=perfect#/piece/bach-bwv315'); await sleep(1500);
  await page.goto(P); await sleep(1500);
  await page.getByTestId('start').click(); await sleep(16000);
  await page.getByRole('button', { name: /finish/i }).first().click().catch(async () => {
    await page.getByRole('button', { name: 'Pause' }).click(); await sleep(300);
    await page.getByRole('button', { name: /Finish/ }).click();
  });
  await waitResults(page); await sleep(800);
  console.log('PARTIAL results', await txt(page, 900));
  console.log('PARTIAL progress', JSON.stringify(await prog(page)));
  await page.screenshot({ path: SH + 'r2-partial-results.png', fullPage: true });
  // finish during count-in
  await page.goto(BASE + '?simulate=perfect#/piece/bach-bwv315'); await sleep(800);
  await page.goto(P); await sleep(1500);
  const logBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:log') || '[]').length);
  await page.getByTestId('start').click(); await sleep(700);
  await page.getByRole('button', { name: 'Pause' }).click(); await sleep(300);
  await page.getByRole('button', { name: /Finish/ }).click(); await sleep(1500);
  const logAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:log') || '[]').length);
  console.log('COUNTIN-FINISH hash', await page.evaluate(() => location.hash), 'log', logBefore, '->', logAfter, '| screen:', await txt(page, 250));
  await page.screenshot({ path: SH + 'r2-finish-countin.png' });
  // pause mid-way, resume, complete: should still be ~100%
  await page.goto(P); await sleep(1200);
  await page.getByTestId('start').click(); await sleep(9000);
  await page.getByRole('button', { name: 'Pause' }).click(); await sleep(1500);
  await page.getByRole('button', { name: 'Resume' }).click();
  await waitResults(page); await sleep(800);
  console.log('PAUSE-RESUME results', await txt(page, 300));
  console.log('PARTIAL errors', errors);
  await browser.close();
}

// ---------- HUD count-in on 2/2 (Yver) and entry countdown at 70 % tempo; directions
if (want('countin')) {
  const { browser, page, errors } = await launch();
  await setProfile(page);
  await page.goto(BASE + '?simulate=perfect#/piece/debussy-yver'); await sleep(2000);
  const info = await page.evaluate(async () => {
    const m = await import('/src/ui/library.ts'); await m.ensureLoaded();
    const p = m.getPiece('debussy-yver');
    return { parts: p.score.parts.map((x) => [x.id, x.name, (x.directions || []).length]), secs: p.sections.slice(0, 3).map((s) => [s.id, s.label, s.start]) };
  });
  console.log('YVER', JSON.stringify(info));
  const partId = info.parts[0][0];
  await page.goto(BASE + `?simulate=perfect#/play/debussy-yver/${partId}/${info.secs[0][0]}?level=2`); await sleep(1500);
  await page.getByTestId('start').click();
  const counts = [];
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) {
    const c = await page.evaluate(() => [...document.querySelectorAll('.count, [data-testid=count], .countin')].map((e) => e.textContent).join('/'));
    counts.push(`${Date.now() - t0}:${c}`);
    await sleep(150);
  }
  console.log('YVER HUD count samples', counts.join(' '));
  await page.screenshot({ path: SH + 'r2-yver-play.png' });
  await sleep(4000);
  await page.screenshot({ path: SH + 'r2-yver-play2.png' });
  console.log('YVER lyrics', await page.locator('.lyrics').innerText().catch(() => '?'));
  // Debussy Dieu with directions
  await page.goto(BASE + '?simulate=perfect#/play/debussy-dieu/P1/' + 's0' + '?level=1'); await sleep(1200);
  const dsec = await page.evaluate(async () => { const m = await import('/src/ui/library.ts'); await m.ensureLoaded(); const p = m.getPiece('debussy-dieu'); return [p.score.parts[0].id, p.sections[0].id, p.score.parts.map((x) => (x.directions || []).map((d) => d.text).slice(0, 8))]; });
  console.log('DIEU directions', JSON.stringify(dsec));
  await page.goto(BASE + `?simulate=perfect#/play/debussy-dieu/${dsec[0]}/${dsec[1]}?level=1`); await sleep(1200);
  await page.getByTestId('start').click(); await sleep(6500);
  await page.screenshot({ path: SH + 'r2-dieu-directions.png' });
  console.log('COUNTIN errors', errors);
  await browser.close();
}

// ---------- Entry drill + its navigation
if (want('entries')) {
  const { browser, page, errors } = await launch();
  await setProfile(page);
  await page.goto(BASE + '?simulate=perfect#/piece/ravel-nicolette'); await sleep(2000);
  await page.getByRole('button', { name: /entries/i }).first().click(); await sleep(1500);
  console.log('ENTRIES hash', await page.evaluate(() => location.hash), await txt(page, 300));
  await page.screenshot({ path: SH + 'r2-entries-ready.png' });
  await page.getByTestId('start').click(); await sleep(5000);
  await page.screenshot({ path: SH + 'r2-entries-run.png' });
  await page.getByRole('button', { name: 'Pause' }).click(); await sleep(300);
  await page.getByRole('button', { name: 'Quit' }).click(); await sleep(1200);
  console.log('ENTRIES quit ->', await page.evaluate(() => location.hash));
  await page.goBack(); await sleep(800);
  console.log('ENTRIES back after quit ->', await page.evaluate(() => location.hash));
  console.log('ENTRIES errors', errors);
  await browser.close();
}

// ---------- Navigation: stale sh:fromResults flag; browser back from Results
if (want('nav')) {
  const { browser, page, errors } = await launch();
  await setProfile(page);
  const H = () => page.evaluate(() => location.hash);
  await page.goto(BASE + '?simulate=perfect#/library'); await sleep(1500);
  await page.goto(BASE + '?simulate=perfect#/piece/warmup-chorale'); await sleep(1200);
  await page.locator('.ladder-row').first().locator('button[aria-label*="level 2 "]').click(); await waitHash(page, 'play/');
  await page.getByTestId('start').click(); await waitResults(page); await sleep(600);
  await page.getByRole('button', { name: 'Again' }).click(); await waitHash(page, 'play/'); await sleep(500);
  await page.getByTestId('start').click(); await waitResults(page); await sleep(600);
  console.log('NAV after Again run completes, flag=', await page.evaluate(() => sessionStorage.getItem('sh:fromResults')));
  await page.getByRole('button', { name: 'All sections' }).click(); await sleep(800);
  // now go Home and start via Next up / or open Library → other piece → play, then Back
  await page.goto(BASE + '?simulate=perfect#/library'); await sleep(800);
  await page.goto(BASE + '?simulate=perfect#/piece/bach-bwv315'); await sleep(800);
  await page.locator('.ladder-row').first().locator('button[aria-label*="level 1 "]').click(); await waitHash(page, 'play/'); await sleep(500);
  await page.getByRole('button', { name: 'Back' }).click(); await sleep(800);
  console.log('NAV back from play (stale flag) ->', await H());
  await page.goBack(); await sleep(800);
  console.log('NAV then browser back ->', await H());
  await page.goBack(); await sleep(800);
  console.log('NAV then browser back ->', await H());
  console.log('NAV errors', errors);
  await browser.close();
}

// ---------- Landscape screenshots
if (want('land')) {
  const { browser, page } = await launch({ viewport: { width: 844, height: 390 } });
  await setProfile(page);
  await page.goto(BASE + '?simulate=perfect#/play/bach-bwv315/P1/s0-m0-5?level=1'); await sleep(1500);
  await page.screenshot({ path: SH + 'r2-land-ready.png' });
  await page.getByTestId('start').click(); await sleep(5000);
  const canvas = await page.locator('canvas').first().boundingBox();
  const lyr = await page.locator('.lyrics').boundingBox().catch(() => null);
  console.log('LAND canvas', canvas, 'lyrics', lyr);
  await page.screenshot({ path: SH + 'r2-land-play.png' });
  await page.goto(BASE + '?simulate=perfect#/arcade/bach-bwv315/P1/s0-m0-5?level=2'); await sleep(1500);
  await page.getByTestId('start').click(); await sleep(4000);
  await page.screenshot({ path: SH + 'r2-land-arcade.png' });
  const pauseBox = await page.getByRole('button', { name: 'Pause' }).boundingBox().catch(() => null);
  console.log('LAND arcade pause', pauseBox);
  // 390 portrait: still fine?
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(800);
  await page.screenshot({ path: SH + 'r2-portrait-arcade.png' });
  await browser.close();
}
