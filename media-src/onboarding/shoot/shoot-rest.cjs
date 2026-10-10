// node shoot-rest.cjs <what> [seconds into the run]: toggle | score 8 | highway 9.5 | fix | home | laptop 14
// → img/practice-toggle, practice-score, practice-highway, results-fix, home, fullscore-laptop.
// Frames depend on timing: check that the blue ink still sits just under a note before re-measuring video.html.
const { open, importPieces, setCycle, sleep, base } = require('./common.cjs');
const what = process.argv[2];
const TITLES = {
  'bruckner-locus-iste.mxl': ['Locus iste, WAB 23', 'Anton Bruckner'],
  'debussy-dieu.mxl': ['Dieu! qu’il la fait bon regarder!', 'Claude Debussy'],
  'ravel-nicolette.mxl': ['Nicolette', 'Maurice Ravel'],
  'vierne-kyrie.mxl': ['Kyrie (Messe solennelle, Op. 16)', 'Louis Vierne'],
};
const box = async (loc) => { if (!(await loc.count())) return null; const b = await loc.first().boundingBox(); return b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
async function setup(page, files) {
  const ids = await importPieces(page, files);
  for (let i = 0; i < files.length; i++) {
    const [t, c] = TITLES[files[i]];
    await page.evaluate(async ([id, t, c]) => { const lib = await import('/src/ui/library.ts'); await lib.renameImported(id, t, c); }, [ids[i], t, c]);
  }
  await setCycle(page, ids);
  return ids;
}
(async () => {
  const laptop = what === 'laptop';
  const display = what === 'highway' ? 'highway' : 'score';
  const { browser, page, errs } = await open(laptop ? { w: 1280, h: 800, dpr: 1, voice: 'A', extra: { display: 'score', displayChosen: true } } : { voice: what === 'home' ? 'A' : 'S', extra: { display, displayChosen: true } });
  const sim = what === 'fix' ? 'oneflat' : 'flat';
  if (what === 'home') {
    const ids = await setup(page, ['bruckner-locus-iste.mxl', 'debussy-dieu.mxl', 'ravel-nicolette.mxl']);
    await page.goto(`${base}/#/`); await sleep(4000);
    await page.screenshot({ path: 'img/home.png' });
    const r = {};
    for (const s of ['5d', '64d', 'Practise now', 'Next up', 'cycle readiness']) r[s] = await box(page.getByText(s, { exact: true }));
    console.log('home', JSON.stringify(r));
  } else {
    const files = laptop ? ['vierne-kyrie.mxl'] : ['bruckner-locus-iste.mxl'];
    const ids = await setup(page, files);
    await page.goto(`${base}/?simulate=${sim}#/piece/${encodeURIComponent(ids[0])}`); await sleep(2500);
    await page.getByTestId('piece-next').click();
    await page.getByTestId('start').waitFor({ timeout: 20000 }); await sleep(800);
    if (laptop) {
      const u = page.url().replace(/level=\d+/, 'level=3').replace(/step=\w+/, 'step=tempo');
      await page.goto(u); await page.getByTestId('start').waitFor({ timeout: 20000 }); await sleep(800);
      console.log('URL', page.url());
    }
    if (what === 'toggle') {
      await page.getByTestId('display-tempo').locator('summary').click(); await sleep(500);
      await page.getByTestId('display-toggle').evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(500);
      await page.screenshot({ path: 'img/practice-toggle.png' });
      console.log('toggle', JSON.stringify({ score: await box(page.getByTestId('display-score')), highway: await box(page.getByTestId('display-highway')), prerun: await box(page.getByTestId('prerun')) }));
    } else {
      const t = Number(process.argv[3] || 8);
      await page.getByTestId('start').click(); await sleep(t * 1000);
      const name = { score: 'practice-score', highway: 'practice-highway', laptop: 'fullscore-laptop' }[what];
      if (name) await page.screenshot({ path: `img/${name}.png` });
      if (what === 'fix') {
        await page.waitForURL(/#\/results/, { timeout: 90000 }); await sleep(2500);
        await page.screenshot({ path: 'img/results-fix.png' });
        const r = {};
        for (const s of ['Not yet: one note to fix.', 'Hear it']) r[s] = await box(page.getByText(s));
        r.loop = await box(page.getByRole('button', { name: /Loop bar/ }));
        r.tip = await box(page.getByText(/Aim it/));
        r.cents = await box(page.getByText(/clearly flat \(/));
        console.log('fix', JSON.stringify(r));
        console.log('RES', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 600));
      }
    }
  }
  console.log('errors', errs.filter((e) => !/CERT/.test(e))); await browser.close();
})();
