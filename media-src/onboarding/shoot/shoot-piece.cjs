const { open, importPieces, setCycle, sleep, base } = require('./common.cjs');
// piece (Your path, fresh), piece-more (More ways open on Sing it all), piece-tofix (after a clean
// level-1 run and a level-2 run where two of four passages slipped). Prints element boxes (css px).
const OUT = process.argv[2] || 'img/';
(async () => {
  const { browser, page, errs } = await open({ voice: 'A' });
  const ids = await importPieces(page, ['debussy-dieu.mxl']);
  const id = ids[0];
  await page.evaluate(async (id) => { const lib = await import('/src/ui/library.ts'); await lib.renameImported(id, 'Dieu! qu’il la fait bon regarder!', 'Claude Debussy'); }, id);
  await setCycle(page, ids);
  const box = async (loc) => { if (!(await loc.count())) return null; const b = await loc.first().boundingBox(); return b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const report = async (name) => {
    const r = {};
    for (const t of ['path-card', 'piece-level', 'goal-line', 'clean-stars', 'now-card', 'now-eyebrow', 'now-checklist', 'piece-next', 'piece-next-why', 'try-tempo', 'more-ways', 'full-run-card', 'full-1', 'full-2', 'to-fix', 'passage-row']) r[t] = await box(page.getByTestId(t));
    r.passages = await box(page.getByRole('heading', { name: 'Passages' }));
    console.log(name, JSON.stringify(r));
  };
  const goPiece = async () => { await page.goto(`${base}/#/library`); await sleep(500); await page.goto(`${base}/#/piece/${encodeURIComponent(id)}`); await sleep(2000); await page.evaluate(() => window.scrollTo(0, 0)); await sleep(400); };
  await goPiece();
  await page.screenshot({ path: OUT + 'piece.png' }); await report('piece');
  await page.getByTestId('more-ways').locator('summary').first().click(); await sleep(600);
  const sy = await page.getByTestId('full-run-card').evaluate((e) => e.getBoundingClientRect().top + window.scrollY - 70);
  await page.evaluate((y) => window.scrollTo(0, y), sy); await sleep(600);
  await page.screenshot({ path: OUT + 'piece-more.png' }); await report('piece-more');
  await page.evaluate(async (id) => {
    const lib = await import('/src/ui/library.ts');
    const store = await import('/src/progress/store.ts');
    const piece = lib.getPiece(id); const partId = lib.chosenPartId(piece, 'A');
    const part = piece.score.parts.find((x) => x.id === partId); const secs = lib.singableSections(piece, partId);
    const V = { perfect: 1, good: 0.85, ok: 0.5, miss: 0 };
    const make = (slip) => {
      const notes = [];
      part.notes.forEach((n, index) => {
        const si = secs.findIndex((s) => n.start >= s.start - 1e-6 && n.start < s.end - 1e-6);
        if (n.midi == null || si < 0) return;
        const grade = slip.includes(si) ? (notes.length % 2 ? 'good' : 'ok') : 'perfect';
        notes.push({ index, grade, cents: grade === 'perfect' ? 3 : -60, hitRatio: 0.9 });
      });
      const accuracy = notes.reduce((a, n) => a + V[n.grade], 0) / notes.length;
      return { accuracy, pitch: accuracy, rhythm: 0.95, score: 5000, maxCombo: 30, counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, notes, perMeasure: {}, insights: [] };
    };
    store.recordFullRun(piece.id, partId, 1, make([]), secs, (i) => part.notes[i]?.start, { counted: true, step: 'tempo' });
    store.recordFullRun(piece.id, partId, 2, make([1, 3]), secs, (i) => part.notes[i]?.start, { counted: true, step: 'tempo' });
  }, id);
  await goPiece();
  await page.screenshot({ path: OUT + 'piece-tofix.png' }); await report('piece-tofix');
  console.log('TOFIX', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 1500));
  console.log('errors', errs); await browser.close();
})();
