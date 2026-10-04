// QA round 3: browser checks for the latest commits (232b934, 7f7810b, fcbd4fe, 1facfd6, 9c52b25, d2dedc4).
// Run from repo root: node docs/qa/scripts/r3-browser.mjs [only-step,...]
import { launch, BASE, SHOTS, sleep, waitHash } from './r3-lib.mjs';
const only = (process.argv[2] || '').split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const txt = async (page) => (await page.innerText('main').catch(() => '')).replace(/\n+/g, ' | ');
const PROFILE = { name: 'Q', voice: 'S', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 0, onboarded: true };
async function fresh(opts = {}, profile = PROFILE, extra = {}) {
  const L = await launch(opts);
  await L.page.goto(BASE + '#/');
  await L.page.evaluate(([p, x]) => { localStorage.clear(); if (p) localStorage.setItem('sh:profile', JSON.stringify(p)); for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v); }, [profile, extra]);
  return L;
}
const hashGo = async (page, h) => { await page.evaluate((h) => { location.hash = h; }, h); await sleep(900); };

// ---------- A. removed-piece notice / cycle cleanup ----------
if (want('removed')) {
  for (const [label, cyc, prog] of [
    ['bach315+warmup', ['bach-bwv315', 'warmup-chorale'], 'bach-bwv315'],
    ['only bach512 (old id)', ['bach-bwv512'], 'bach-bwv512'],
    ['no bach in cycle, progress only', ['warmup-chorale'], 'bach-bwv315'],
  ]) {
    const { browser, page, errors } = await fresh();
    await page.evaluate(([cyc, prog]) => {
      localStorage.setItem('sh:cycle', JSON.stringify({ name: 'Spring', pieceIds: cyc }));
      localStorage.setItem(`sh:progress:${prog}:P1`, JSON.stringify({ pieceId: prog, partId: 'P1', sections: { 's0-m0-5': { level: 3, best: { 1: 1 }, attempts: 3, lastPracticed: Date.now() } }, totalAttempts: 3, bestScore: 5000 }));
    }, [cyc, prog]);
    await page.reload(); await sleep(2500);
    const notice = await page.locator('.notice').allInnerTexts();
    const cycle = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:cycle')).pieceIds);
    console.log(`REMOVED[${label}] notice=`, JSON.stringify(notice), 'cycle=', JSON.stringify(cycle));
    if (label.startsWith('bach315')) await page.screenshot({ path: SHOTS + 'r3-removed-notice.png' });
    const ok = page.getByRole('button', { name: 'OK' });
    if (await ok.count()) { await ok.first().click(); await sleep(300); await page.reload(); await sleep(2000); console.log(`REMOVED[${label}] after OK+reload notice=`, JSON.stringify(await page.locator('.notice').allInnerTexts()), 'sh:notice=', await page.evaluate(() => localStorage.getItem('sh:notice'))); }
    await page.goto(BASE + '#/piece/bach-bwv315'); await sleep(1200);
    console.log(`REMOVED[${label}] old link:`, (await txt(page)).slice(0, 160));
    console.log('ERR', errors); await browser.close();
  }
}

// ---------- B. URL validation ----------
if (want('url')) {
  const { browser, page, errors } = await fresh();
  await page.goto(BASE + '#/piece/warmup-chorale'); await sleep(2000);
  const secs = await page.locator('.ladder-row').allInnerTexts();
  console.log('URL sections:', JSON.stringify(secs.map((s) => s.replace(/\n+/g, ' / ').slice(0, 80))));
  const cases = [
    '#/arcade/warmup-chorale/P1/s0-m0-6?level=1',
    '#/arcade/warmup-chorale/P1/s0-m0-6?level=abc',
    '#/play/warmup-chorale/P1/s0-m0-6?level=abc',
    '#/play/warmup-chorale/P1/s0-m0-6?level=9',
    '#/play/warmup-chorale/P1/s0-m0-6?level=-3',
    '#/play/warmup-chorale/P1/s0-m0-6?level=2&from=3&to=4',
    '#/play/warmup-chorale/P1/drill?level=2&from=30&to=5',
    '#/play/warmup-chorale/P1/drill?level=2&from=2&to=6',
    '#/play/warmup-chorale/P1/drill?level=2&from=-5&to=1e9',
    '#/play/warmup-chorale/P1/drill?level=2',
  ];
  for (const h of cases) {
    await page.goto(BASE + h); await sleep(1500);
    const t = await txt(page);
    const route = await page.evaluate(async () => { const m = await import('/src/ui/router.ts'); return m.parseHash(location.hash); });
    console.log('URL', h, '→', JSON.stringify(route), '| screen:', t.slice(0, 150));
  }
  await page.screenshot({ path: SHOTS + 'r3-url-drill-unbounded.png' });
  console.log('ERR', errors); await browser.close();
}

// ---------- C. first-run howto + landscape + setup dates ----------
if (want('howto')) {
  for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const { browser, page, errors } = await fresh({ viewport: vp });
    await page.goto(BASE + '#/play/warmup-chorale/P1/s0-m0-6?level=1'); await sleep(2000);
    const howto = page.getByTestId('howto');
    const start = page.getByTestId('start');
    const sb = await start.boundingBox();
    console.log(`HOWTO[${vp.width}x${vp.height}] visible=`, await howto.isVisible().catch(() => false), 'start box=', JSON.stringify(sb), 'docScroll=', await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]));
    const inView = sb && sb.y >= 0 && sb.y + sb.height <= vp.height;
    console.log(`HOWTO[${vp.width}x${vp.height}] start button within viewport:`, inView);
    await page.screenshot({ path: SHOTS + `r3-howto-${vp.width}x${vp.height}.png` });
    // scroll to start if needed
    await start.scrollIntoViewIfNeeded().catch(() => {});
    console.log(`HOWTO[${vp.width}x${vp.height}] after scrollIntoView start box=`, JSON.stringify(await start.boundingBox()));
    await page.reload(); await sleep(1800);
    console.log(`HOWTO[${vp.width}x${vp.height}] second visit visible=`, await page.getByTestId('howto').isVisible().catch(() => false));
    console.log('ERR', errors); await browser.close();
  }
  // Listen first, then practice: is howto still shown on the first practice?
  {
    const { browser, page } = await fresh();
    await page.goto(BASE + '#/play/warmup-chorale/P1/s0-m0-6?level=0'); await sleep(1500);
    await page.goto(BASE + '#/arcade/warmup-chorale/P1/s0-m0-6?level=2'); await sleep(1500);
    await page.goto(BASE + '#/play/warmup-chorale/P1/s0-m0-6?level=1'); await sleep(1500);
    console.log('HOWTO after listen+arcade first: visible on first 2D practice =', await page.getByTestId('howto').isVisible().catch(() => false));
    await browser.close();
  }
}

if (want('setup')) {
  const { browser, page, errors } = await fresh({}, null);
  await page.goto(BASE + '#/setup'); await sleep(1500);
  await page.screenshot({ path: SHOTS + 'r3-setup-dates.png', fullPage: true });
  const dates = page.locator('input[type=date]');
  console.log('SETUP date inputs:', await dates.count(), JSON.stringify(await dates.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.width), Math.round(r.height)]; }))), 'scrollW', await page.evaluate(() => document.documentElement.scrollWidth));
  await dates.nth(0).fill('2026-11-20');
  await dates.nth(1).fill('2026-11-01');
  await sleep(300);
  console.log('SETUP after concert<rehearsal: alerts=', JSON.stringify(await page.locator('[role=alert]').allInnerTexts()), 'cycle=', await page.evaluate(() => localStorage.getItem('sh:cycle')));
  await dates.nth(0).fill('2020-01-01'); await sleep(200);
  console.log('SETUP past date: alerts=', JSON.stringify(await page.locator('[role=alert]').allInnerTexts()));
  await page.screenshot({ path: SHOTS + 'r3-setup-dates-filled.png', fullPage: true });
  console.log('ERR', errors); await browser.close();
}

// ---------- D. focus on route change ----------
if (want('focus')) {
  const { browser, page, errors } = await fresh({ desktop: true, viewport: { width: 1024, height: 800 } });
  await page.goto(BASE + '#/'); await sleep(2000);
  for (const h of ['#/library', '#/piece/warmup-chorale', '#/play/warmup-chorale/P1/s0-m0-6?level=1', '#/ranks', '#/settings', '#/expert', '#/tuner', '#/results']) {
    await hashGo(page, h);
    const f = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.slice(0, 50), title: document.title }));
    console.log('FOCUS', h, JSON.stringify(f));
  }
  // Tab after route change: where does the first Tab go?
  await hashGo(page, '#/library');
  await page.keyboard.press('Tab');
  console.log('FOCUS first Tab after library:', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  console.log('ERR', errors); await browser.close();
}

// ---------- E. Ranks: name prompt, remove, overview ----------
if (want('ranks')) {
  const { browser, page, errors } = await fresh({}, { ...PROFILE, name: '' });
  await page.goto(BASE + '#/'); await sleep(1500);
  // seed some progress so "me" exists
  await page.evaluate(() => localStorage.setItem('sh:cycle', JSON.stringify({ name: 'Spring', pieceIds: ['warmup-chorale'] })));
  await page.evaluate(() => localStorage.setItem('sh:progress:warmup-chorale:P1', JSON.stringify({ pieceId: 'warmup-chorale', partId: 'P1', sections: { 's0-m0-6': { level: 2, best: { 1: 0.9, 2: 0.9 }, attempts: 2, lastPracticed: Date.now(), lastPassed: Date.now() } }, totalAttempts: 2, bestScore: 3000 })));
  const codes = await page.evaluate(async () => {
    const m = await import('/src/progress/leaderboard.ts');
    const mk = (name, voice, readiness) => m.encodeShareCode({ name, voice, pieceId: 'warmup-chorale', readiness, improved: 0.1, streak: 2, weeklyScore: 1000, updatedAt: Date.now() - 3600e3 });
    return [mk('Anna', 'A', 0.8), mk('Ben', 'B', 0.3), mk('Carl', 'T', 0.5)];
  });
  await page.goto(BASE + '#/ranks'); await sleep(1500);
  console.log('RANKS (no name):', (await txt(page)).slice(0, 600));
  const shareBtn = page.getByRole('button', { name: /Share my ranking code/ });
  console.log('RANKS share disabled w/o name =', await shareBtn.isDisabled());
  await page.getByLabel('Your name').fill('Zoe'); await page.getByRole('button', { name: 'Save' }).click(); await sleep(400);
  console.log('RANKS after name: share disabled =', await shareBtn.isDisabled(), 'profile name=', await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile')).name));
  const ta = page.locator('textarea');
  await ta.fill(codes.join('\n')); await page.getByRole('button', { name: 'Add rankings' }).click(); await sleep(600);
  console.log('RANKS toast/list:', (await txt(page)).slice(0, 900));
  await page.screenshot({ path: SHOTS + 'r3-ranks-overview.png', fullPage: true });
  const rm = page.getByRole('button', { name: 'Remove Ben' });
  console.log('RANKS remove Ben btn count', await rm.count(), 'box', JSON.stringify(await rm.first().boundingBox().catch(() => null)));
  if (await rm.count()) { await rm.first().click(); await sleep(400); }
  const listAfter = await page.locator('main').innerText();
  console.log('RANKS after remove (UI) has Ben =', /\bBen\b/.test(listAfter), '| storage has Ben =', await page.evaluate(() => Object.entries(localStorage).filter(([k]) => /lead|board|rank/i.test(k)).map(([k, v]) => k + ':' + (v.includes('Ben') ? 'Ben' : 'noBen')).join(',')));
  await page.reload(); await sleep(1500);
  console.log('RANKS after reload has Ben =', /\bBen\b/.test(await page.locator('main').innerText()));
  // own code paste
  const myCode = await page.evaluate(async () => { const m = await import('/src/progress/leaderboard.ts'); return m.encodeShareCode({ name: 'Zoe', voice: 'S', pieceId: 'warmup-chorale', readiness: 0.4, improved: 0, streak: 1, weeklyScore: 1, updatedAt: Date.now() }); });
  await ta.fill(myCode); await page.getByRole('button', { name: 'Add rankings' }).click(); await sleep(300);
  console.log('RANKS own-code toast:', JSON.stringify(await page.locator('[role=status], .toast').allInnerTexts()));
  // overview table width at 390
  console.log('RANKS scrollW', await page.evaluate(() => document.documentElement.scrollWidth));
  console.log('ERR', errors); await browser.close();
}

// ---------- F. rename imported piece ----------
if (want('rename')) {
  const { browser, page, errors } = await fresh();
  await page.goto(BASE + '#/library'); await sleep(1500);
  await page.locator('input[type=file]').setInputFiles('docs/qa/fixtures/qa-test-song.mid'); await sleep(2500);
  const hash = await page.evaluate(() => location.hash);
  console.log('RENAME after import hash', hash, (await txt(page)).slice(0, 200));
  let pid = (hash.match(/piece\/([^?]+)/) || [])[1];
  if (!pid) {
    const link = page.locator('a[href*="#/piece/"], [data-piece]').filter({ hasText: /qa|test|song/i }).first();
    if (await link.count()) { await link.click(); await sleep(1200); pid = (await page.evaluate(() => location.hash)).split('/')[2]; }
  }
  console.log('RENAME piece id', pid);
  const btn = page.getByRole('button', { name: 'Rename' });
  console.log('RENAME button count', await btn.count());
  if (await btn.count()) {
    await btn.click(); await sleep(300);
    await page.screenshot({ path: SHOTS + 'r3-rename-form.png' });
    const inputs = page.locator('form input');
    console.log('RENAME inputs', await inputs.count(), JSON.stringify(await inputs.evaluateAll((els) => els.map((e) => [e.getAttribute('aria-label') || e.closest('label')?.textContent, e.value]))));
    await inputs.nth(0).fill('My Renamed Song'); if (await inputs.count() > 1) await inputs.nth(1).fill('Q. Composer');
    await page.locator('form button[type=submit], form button').filter({ hasText: /Save/ }).first().click(); await sleep(800);
    console.log('RENAME piece screen after save:', (await txt(page)).slice(0, 160));
    await page.reload(); await sleep(2200);
    console.log('RENAME after reload:', (await txt(page)).slice(0, 160));
    await page.goto(BASE + '#/library'); await sleep(1200);
    console.log('RENAME library has new title:', (await txt(page)).includes('My Renamed Song'));
    // empty title
    await page.goto(BASE + '#/piece/' + pid); await sleep(1200);
    await page.getByRole('button', { name: 'Rename' }).click(); await sleep(200);
    await page.locator('form input').nth(0).fill('');
    await page.locator('form button').filter({ hasText: /Save/ }).first().click(); await sleep(800);
    console.log('RENAME empty title → screen:', (await txt(page)).slice(0, 160));
  }
  // built-in piece shows rename?
  await page.goto(BASE + '#/piece/warmup-chorale'); await sleep(1200);
  console.log('RENAME on built-in visible:', await page.getByRole('button', { name: 'Rename' }).count());
  console.log('ERR', errors); await browser.close();
}

// ---------- G. reduced motion ----------
if (want('motion')) {
  const L = await launch();
  const ctx2 = await L.browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', permissions: ['microphone'] });
  const page = await ctx2.newPage();
  await page.goto(BASE + '#/'); await sleep(1500);
  await page.evaluate((p) => localStorage.setItem('sh:profile', JSON.stringify(p)), PROFILE);
  await page.reload(); await sleep(1500);
  const td = await page.evaluate(() => { const b = document.querySelector('.btn'); return b ? getComputedStyle(b).transitionDuration : null; });
  console.log('MOTION btn transitionDuration under reduce =', td, '| matchMedia =', await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
  await page.goto(BASE + '?simulate=perfect#/arcade/warmup-chorale/P1/s0-m0-6?level=2'); await sleep(1500);
  await page.getByTestId('start').click(); await sleep(6000);
  await page.screenshot({ path: SHOTS + 'r3-reduced-motion-arcade.png' });
  console.log('MOTION arcade still offered/running under reduce (no default fallback to 2D):', await page.evaluate(() => location.hash));
  await L.browser.close();
}

// ---------- H. practice-run notice (partial) + interruption pause ----------
if (want('partial')) {
  const { browser, page, errors } = await fresh();
  await page.goto(BASE + '?simulate=perfect#/play/warmup-chorale/P1/s0-m0-6?level=2'); await sleep(1800);
  await page.getByTestId('start').click(); await sleep(9000);
  await page.getByRole('button', { name: /Finish/ }).click(); await sleep(2000);
  console.log('PARTIAL results:', (await txt(page)).slice(0, 700));
  await page.screenshot({ path: SHOTS + 'r3-partial-results.png', fullPage: true });
  console.log('PARTIAL progress', await page.evaluate(() => localStorage.getItem('sh:progress:warmup-chorale:P1')));
  // slow tempo run, full
  await page.goto(BASE + '?simulate=perfect#/play/warmup-chorale/P1/s0-m0-6?level=2'); await sleep(1500);
  const slider = page.locator('input[type=range]');
  console.log('PARTIAL tempo slider present at L2:', await slider.count());
  console.log('ERR', errors); await browser.close();
}

if (want('interrupt')) {
  const L = await launch();
  const { browser, page, errors } = L;
  await page.addInitScript(() => {
    const Orig = window.AudioContext;
    window.__ctxs = [];
    window.AudioContext = class extends Orig { constructor(...a) { super(...a); window.__ctxs.push(this); } };
  });
  await page.goto(BASE + '#/');
  await page.evaluate((p) => localStorage.setItem('sh:profile', JSON.stringify(p)), PROFILE);
  await page.goto(BASE + '?simulate=perfect#/play/warmup-chorale/P1/s0-m0-6?level=2'); await sleep(1800);
  await page.getByTestId('start').click(); await sleep(6000);
  const posBefore = await page.evaluate(() => window.__ctxs.map((c) => c.state));
  await page.evaluate(() => Promise.all(window.__ctxs.map((c) => c.suspend())));
  await sleep(1500);
  const pauseBtn = await page.getByRole('button', { name: 'Pause' }).count();
  const startBtn = await page.getByRole('button', { name: 'Resume' }).count();
  console.log('INTERRUPT ctx states before', JSON.stringify(posBefore), 'after suspend: Pause btn', pauseBtn, 'Start(resume) btn', startBtn, '|', (await txt(page)).slice(0, 200));
  await page.screenshot({ path: SHOTS + 'r3-interrupt.png' });
  if (startBtn) { await page.getByRole('button', { name: 'Resume' }).click(); await sleep(1500); console.log('INTERRUPT after resume ctx', JSON.stringify(await page.evaluate(() => window.__ctxs.map((c) => c.state))), 'Pause btn', await page.getByRole('button', { name: 'Pause' }).count()); }
  await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 60000 }).catch(() => {});
  console.log('INTERRUPT end:', (await txt(page)).slice(0, 300));
  console.log('ERR', errors); await browser.close();
}
