// QA round 4 browser checks. Run from repo root: node docs/qa/scripts/r4-browser.mjs [section…]
import { fresh, nav, shot, text, sleep, runToResults, BASE } from './r4-lib.mjs';
const want = (s) => process.argv.length <= 2 || process.argv.includes(s);

if (want('howto')) {
  for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const { browser, page, errors } = await fresh({ viewport: vp, sim: null });
    await page.goto(BASE + '#/play/warmup-chorale/P2/s0-m0-6?level=1');
    await page.waitForSelector('[data-testid=start]', { timeout: 15000 });
    const h = page.locator('[data-testid=howto]');
    const info = { vp: `${vp.width}x${vp.height}`, present: await h.count(), visible: (await h.count()) ? await h.isVisible() : false, seen: await page.evaluate(() => localStorage.getItem('sh:seenHowto')), scrollH: await page.evaluate(() => document.documentElement.scrollHeight) };
    const card = await page.evaluate(() => { const el = document.querySelector('[data-testid=start]')?.closest('.overlay'); const t = el?.querySelector('*'); const r = el?.firstElementChild?.getBoundingClientRect(); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null; });
    await shot(page, `r4-howto-${vp.width}x${vp.height}`);
    await page.reload(); await page.waitForSelector('[data-testid=start]');
    info.afterReload = await page.locator('[data-testid=howto]').count();
    console.log('HOWTO', JSON.stringify({ ...info, card }), errors);
    await browser.close();
  }
}

if (want('url')) {
  const { browser, page } = await fresh({ sim: null });
  for (const lv of ['abc', '1', '', '9', '-3']) {
    await page.goto(BASE + `#/arcade/warmup-chorale/P2/s0-m0-6?level=${lv}`); await sleep(1500);
    const t = await text(page);
    console.log('ARCADE level=' + lv, (t.match(/L\d[^|]{0,40}/) || [''])[0]);
  }
  await browser.close();
}

if (want('setup')) {
  const { browser, page, errors } = await fresh({ ls: null, sim: null });
  await page.goto(BASE + '#/setup'); await sleep(1500);
  const chips = page.locator('[aria-label="Pieces in this cycle"] button');
  const n = await chips.count();
  const sizes = await chips.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.textContent, Math.round(r.width), Math.round(r.height), e.getAttribute('aria-pressed')]; }));
  console.log('SETUP chips', n, JSON.stringify(sizes), 'scrollW', await page.evaluate(() => document.documentElement.scrollWidth));
  // deselect Ravel and Bruckner
  for (const name of ['Nicolette', 'Locus']) { const c = chips.filter({ hasText: name }); if (await c.count()) await c.first().click(); }
  await sleep(200);
  console.log('SETUP cycle after picks', await page.evaluate(() => localStorage.getItem('sh:cycle')));
  const dates = page.locator('input[type=date]');
  await dates.nth(0).fill('2026-11-20'); await dates.nth(1).fill('2026-11-01'); await sleep(300);
  console.log('SETUP concert<rehearsal alerts', JSON.stringify(await page.locator('[role=alert]').allInnerTexts()));
  await shot(page, 'r4-setup-dates-warn', true);
  await dates.nth(0).fill('2020-01-01'); await dates.nth(1).fill('2026-11-01'); await sleep(300);
  console.log('SETUP past alerts', JSON.stringify(await page.locator('[role=alert]').allInnerTexts()));
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await dates.nth(0).fill(today); await sleep(300);
  console.log('SETUP today alerts', today, JSON.stringify(await page.locator('[role=alert]').allInnerTexts()));
  await dates.nth(0).fill('2026-10-07'); await dates.nth(1).fill('2026-10-25'); await sleep(300);
  console.log('SETUP valid alerts', JSON.stringify(await page.locator('[role=alert]').allInnerTexts()), await page.evaluate(() => JSON.parse(localStorage.getItem('sh:cycle')).name));
  await shot(page, 'r4-setup-step1', true);
  console.log('ERR', errors);
  await browser.close();
}

if (want('listen')) {
  const { browser, page, errors, q } = await fresh({ sim: 'perfect' });
  await page.goto(BASE + q + '#/piece/warmup-chorale'); await sleep(1500);
  await nav(page, '#/play/warmup-chorale/P2/s1-m7-12?level=0');
  await page.getByTestId('start').click();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !(await page.getByTestId('learn-next').count())) await sleep(500);
  console.log('LISTEN done after', Math.round((Date.now() - t0) / 1000), 's; learn-next', await page.getByTestId('learn-next').count(), 'url', page.url());
  await shot(page, 'r4-listen-done');
  await page.getByTestId('learn-next').click(); await sleep(1000);
  console.log('LISTEN → ', page.url(), (await text(page)).slice(0, 160));
  // whole-piece listen: no learn-next expected
  console.log('ERR', errors);
  await browser.close();
}

if (want('flow')) {
  const { browser, page, errors, q } = await fresh({ sim: 'perfect' });
  await page.goto(BASE + q + '#/'); await sleep(1500);
  console.log('HOME before', (await text(page)).slice(0, 400));
  await nav(page, '#/piece/debussy-dieu');
  await page.getByRole('button', { name: 'Alto' }).click(); await sleep(300);
  await page.getByRole('button', { name: /Bars 1–5: level 1/ }).click(); await sleep(1000);
  console.log('PLAY url', page.url());
  await page.getByTestId('start').click();
  await runToResults(page);
  const r1 = await text(page);
  console.log('RESULT debussy L1', r1.slice(0, 500));
  await shot(page, 'r4-debussy-l1-result', true);
  await nav(page, '#/'); await sleep(500);
  const home = await text(page);
  console.log('HOME after debussy', home.slice(0, 600));
  await shot(page, 'r4-home-plan', true);
  // entry drill
  await nav(page, '#/piece/debussy-dieu');
  const claim = ((await text(page)).match(/(\d+) entries from this piece/) || [])[1];
  await page.getByRole('button', { name: 'Practise entries' }).click(); await sleep(1000);
  console.log('ENTRY url', page.url(), 'claimed', claim, (await text(page)).slice(0, 200));
  await page.getByTestId('start').click();
  await runToResults(page, 180000);
  const r2 = await text(page);
  console.log('RESULT entries', r2.slice(0, 900));
  console.log('RESULT entries buttons', JSON.stringify(await page.locator('button').evaluateAll((b) => b.map((x) => x.textContent.trim()).filter(Boolean))));
  await shot(page, 'r4-entries-result', true);
  const back = page.getByRole('button', { name: /^Back to / });
  if (await back.count()) { await back.first().click(); await sleep(800); console.log('BACK →', page.url()); }
  // partial finish on warm-up L2 (practice run)
  await nav(page, '#/play/warmup-chorale/P2/s0-m0-6?level=1');
  await page.getByTestId('start').click(); await sleep(12000);
  const fin = page.getByRole('button', { name: /Finish/i });
  console.log('FINISH buttons', await fin.count());
  if (await fin.count()) await fin.first().click();
  await runToResults(page, 20000);
  console.log('PARTIAL result', page.url(), (await text(page)).slice(0, 600));
  await shot(page, 'r4-partial-result', true);
  console.log('ERR', errors);
  await browser.close();
}

if (want('ranks')) {
  const a = await fresh({ sim: 'perfect' });
  await a.page.goto(BASE + a.q + '#/'); await sleep(1200);
  // some progress on Debussy
  await nav(a.page, '#/piece/debussy-dieu');
  await a.page.getByRole('button', { name: 'Alto' }).click(); await sleep(300);
  await a.page.getByRole('button', { name: /Bars 1–5: level 1/ }).click(); await sleep(800);
  await a.page.getByTestId('start').click(); await runToResults(a.page);
  await nav(a.page, '#/ranks'); await sleep(800);
  const t0 = await text(a.page);
  console.log('RANKS unnamed', (t0.match(/[^|]*\(you\)[^|]*|\| You \|/g) || []).join(' ; '), '| share disabled:', await a.page.getByRole('button', { name: /Share my progress/ }).isDisabled());
  await a.page.locator('input').filter({ hasNot: a.page.locator('[type=date]') }).first();
  const nameInput = a.page.getByLabel(/Your name/i);
  if (await nameInput.count()) { await nameInput.fill('Clara'); await a.page.getByRole('button', { name: 'Save' }).click(); await sleep(400); }
  await a.page.getByRole('button', { name: /Share my progress/ }).click(); await sleep(500);
  const shared = await a.page.evaluate(() => window.__shared);
  console.log('SHARED', JSON.stringify(shared).slice(0, 400), 'codes:', (shared[0] || '').split(' ').filter((x) => x.startsWith('SH1')).length);
  await shot(a.page, 'r4-ranks-a', true);
  const b = await fresh({ sim: null, ls: { 'sh:profile': JSON.stringify({ onboarded: true, voice: 'S', name: 'Mathilde' }) } });
  await b.page.goto(BASE + '#/ranks'); await sleep(1200);
  await b.page.locator('textarea').fill(shared[0] || ''); await b.page.getByRole('button', { name: /^Add/ }).click(); await sleep(600);
  const sel = b.page.locator('select').first();
  const opts = await sel.locator('option').allInnerTexts();
  console.log('B options', JSON.stringify(opts));
  const dv = opts.findIndex((o) => /Dieu/.test(o));
  if (dv >= 0) { await sel.selectOption({ index: dv }); await sleep(600); }
  console.log('B ranks Debussy', (await text(b.page)).slice(0, 900));
  await shot(b.page, 'r4-ranks-b-debussy', true);
  console.log('ERR', a.errors, b.errors);
  await a.browser.close(); await b.browser.close();
}

if (want('landscape')) {
  const { browser, page, errors, q } = await fresh({ viewport: { width: 844, height: 390 }, sim: 'perfect' });
  await page.goto(BASE + q + '#/play/warmup-chorale/P2/s0-m0-6?level=2'); await sleep(1500);
  const st = await page.getByTestId('start').boundingBox();
  console.log('LAND ready start btn', JSON.stringify(st), 'scrollH', await page.evaluate(() => document.documentElement.scrollHeight));
  await shot(page, 'r4-land-ready');
  await page.getByTestId('start').click(); await sleep(6000);
  const chips = await page.locator('button').evaluateAll((b) => b.filter((x) => /you/.test(x.textContent || '')).map((x) => ({ t: x.textContent, sw: x.scrollWidth, cw: x.clientWidth })));
  console.log('LAND chips', JSON.stringify(chips));
  await shot(page, 'r4-land-running');
  await runToResults(page);
  console.log('LAND end', page.url(), errors);
  await browser.close();
}

if (want('blocked')) {
  // CR-08: site storage blocked (localStorage/sessionStorage getters throw SecurityError, as with blocked site data)
  const { browser, ctx, page, errors } = await fresh({ sim: null, ls: null });
  await ctx.addInitScript(() => {
    for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); }, configurable: true });
  });
  await page.goto(BASE + '#/'); await sleep(2500);
  console.log('BLOCKED home', (await text(page)).slice(0, 200));
  await page.evaluate(() => { location.hash = '#/library'; }); await sleep(1000);
  console.log('BLOCKED after hash→library', page.url(), (await text(page)).slice(0, 120));
  await page.goto(BASE + '?r=1#/piece/warmup-chorale'); await sleep(2500);
  console.log('BLOCKED direct piece', (await text(page)).slice(0, 120));
  await page.goto(BASE + '?r=2#/play/warmup-chorale/P2/s0-m0-6?level=1'); await sleep(2500);
  console.log('BLOCKED direct play', (await text(page)).slice(0, 120));
  await shot(page, 'r4-blocked-play');
  console.log('ERR', errors.slice(0, 6));
  await browser.close();
}
