// img/home.png: Today (Home) mid-cycle, from seeded progress (as the Today QA scenario: Abendlied at
// Level 3, Locus iste started, a confirmed rehearsal), clock fixed to Saturday 10 Oct 2026, 17:30.
// node shoot-today.cjs   (run from the render dir; BASE=http://localhost:5202 for another port)
const { chromium } = require('/home/user/schonberg/node_modules/@playwright/test');
const path = require('path');
const base = process.env.BASE || 'http://localhost:5191';
const SC = path.resolve(__dirname, '../../../library/scores') + '/';
const NOW = '2026-10-10T17:30:00';
const DAY = 86400000;
const at = (d, h = 18) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();
const LOCUS = 'xml-6b05f827', DIEU = 'xml-834cdeaa', ABEND = 'warmup-chorale';
function state(now) {
  const lp = now - 4 * DAY;
  const abend = { pieceId: ABEND, partId: 'P2', totalAttempts: 12, bestScore: 900,
    sections: { 's0-m0-6': { level: 3, best: { 1: 0.95, 2: 0.92, 3: 0.9 }, attempts: 6, lastPracticed: lp, lastPassed: lp }, 's1-m7-12': { level: 3, best: { 1: 0.95, 2: 0.92, 3: 0.9 }, attempts: 6, lastPracticed: lp, lastPassed: lp } },
    full: { level: 3, best: { 1: 0.9, 2: 0.9, 3: 0.9 }, attempts: 3, lastPracticed: lp, lastPassed: lp, clean: [1, 2, 3] } };
  const locus = { pieceId: LOCUS, partId: 'P2', totalAttempts: 2, bestScore: 100,
    sections: { 's0-m0-7': { level: 0, slow: 1, best: {}, attempts: 2, lastPracticed: now - 2 * DAY } } };
  const L = (d, pieceId, sectionId, level, step, passed, dur = 120) => ({ at: d, pieceId, partId: 'P2', sectionId, level, step, accuracy: passed ? 0.95 : 0.7, score: 100, passed, durationSec: dur });
  return {
    'sh:profile': { name: 'Clara', voice: 'A', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, latencySource: 'measured', onboarded: true, leaderboardOptIn: false, headphones: true, displayMigrated: true, scoreDefaultMigrated: true },
    'sh:cycle': { name: 'Advent 2026', pieceIds: [LOCUS, DIEU, ABEND], rehearsalWeekday: 2, rehearsalTime: '19:30', concertDate: '2026-12-12', focusPieceIds: [ABEND, LOCUS] },
    [`sh:progress:${ABEND}:P2`]: abend,
    [`sh:progress:${LOCUS}:P2`]: locus,
    'sh:log': [
      L(at('2026-10-05'), ABEND, 'all', 3, 'tempo', true, 60), L(at('2026-10-05') + 1000, ABEND, 's0-m0-6', 3, 'tempo', true),
      L(at('2026-10-07'), LOCUS, 's0-m0-7', 1, 'slow', false), L(at('2026-10-08'), LOCUS, 's0-m0-7', 1, 'slow', true),
      L(at('2026-09-28'), ABEND, 's0-m0-6', 2, 'tempo', true), L(at('2026-09-29'), ABEND, 's0-m0-6', 2, 'tempo', true),
      L(at('2026-09-30'), ABEND, 's1-m7-12', 2, 'tempo', true), L(at('2026-10-01'), ABEND, 's1-m7-12', 2, 'tempo', true), L(at('2026-10-02'), ABEND, 'all', 2, 'tempo', true, 60),
    ],
    'sh:rehearsals': { '2026-10-06': { attended: true, answered: true, on: '2026-10-07', fine: true } },
    'sh:dayNotes': { '2026-10-05': 120, '2026-10-07': 40, '2026-10-08': 55 },
    'sh:seenHowto': '1', 'sh:persistAsked': '1', 'sh:demoDatesCleared': '1',
  };
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.clock.install({ time: new Date(NOW) });
  await page.goto(`${base}/#/library`); await page.waitForTimeout(2000);
  for (const f of ['bruckner-locus-iste.mxl', 'debussy-dieu.mxl']) {
    await page.goto(`${base}/#/library`); await page.waitForTimeout(1200);
    await page.getByLabel('Choose score files').setInputFiles(SC + f);
    await page.waitForURL(/#\/piece\//, { timeout: 20000 }); await page.waitForTimeout(800);
  }
  await page.evaluate(async ([L, D]) => { const lib = await import('/src/ui/library.ts'); await lib.renameImported(L, 'Locus iste, WAB 23', 'Anton Bruckner'); await lib.renameImported(D, 'Dieu! qu’il la fait bon regarder!', 'Claude Debussy'); }, [LOCUS, DIEU]);
  await page.evaluate((o) => { localStorage.clear(); for (const [k, v] of Object.entries(o)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, state(new Date(NOW).getTime()));
  await page.goto(`${base}/#/`); await page.reload(); await page.waitForTimeout(3500);
  // Scrolled so the status line, the plan and the week card fill the phone.
  const sy = await page.getByTestId('status-line').evaluate((e) => e.getBoundingClientRect().top + window.scrollY - 14);
  await page.evaluate((y) => window.scrollTo(0, y), sy); await page.waitForTimeout(500);
  await page.screenshot({ path: 'img/home.png' });
  const box = async (t) => { const l = page.getByTestId(t); if (!(await l.count())) return null; const b = await l.first().boundingBox(); return b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const r = {};
  for (const t of ['greeting', 'status-line', 'plan-card', 'start-today', 'week-card', 'week-count', 'rehearsal-check']) r[t] = await box(t);
  console.log('home', JSON.stringify(r));
  console.log('TEXT', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 900));
  console.log('errors', errs); await browser.close();
})();
