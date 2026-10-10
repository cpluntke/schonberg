import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDisplay, openMore, startPassage } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));

// Full core loop with the synthetic singer (?simulate=perfect): home → piece → Level 1 slow → results
// (a step-up), then Level 1 in tempo (a level-up).
test('a perfect simulated singer passes Level 1 slow, then Level 1 in tempo', async ({ page }) => {
  test.setTimeout(150_000); // two runs in real time
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });

  // Open the first piece in the cycle.
  await page.getByTestId('piece-row').first().click();
  await expect(page.getByRole('heading', { name: 'Passages' })).toBeVisible();

  // Level 1 of the first passage: new, so slow first.
  await startPassage(page, /Level 1 · Notes · slow/); // a passage, not the full run
  await expect(page.getByTestId('step-label')).toHaveText('Level 1 · Notes · slow');
  await expect(page.getByTestId('step-slow')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('hp-yes').click(); // Level 1 slow counts with headphones on
  await page.getByTestId('start').click();

  // Wait for the results screen (passages are short; allow for count-in + 70% tempo).
  await expect(page.getByTestId('pass-banner')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('pass-banner')).toContainText(/Level 1 · slow ✓/);
  const score = await page.getByTestId('result-score').textContent();
  expect(Number((score ?? '0').replace(/\D/g, ''))).toBeGreaterThan(0);
  // The passage's next step, in tempo, is one tap away (no headphones question there), and Level 1 is complete.
  await expect(page.getByTestId('finish-today')).toBeVisible();
  await page.getByTestId('now-in-tempo').click();
  await expect(page.getByTestId('step-label')).toHaveText('Level 1 · Notes · in tempo');
  await expect(page.getByTestId('headphones-q')).toHaveCount(0);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toContainText('Level 1 · Notes ✓', { timeout: 90_000 });
  expect(errors).toEqual([]);
});

// Level 1 is sung on "doo" and needs every note right: one note 70¢ flat fails it, and Results names
// the bar and the note, with a loop to drill it (docs/LEVELS.md).
test('level 1 on “doo”: one flat note fails it, and Results says which', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=oneflat#/piece/warmup-chorale');
  await startPassage(page, /Level 1 · Notes · slow/);
  // The task in one sentence, and the pass rule in words.
  await expect(page.getByTestId('doo-note')).toContainText(/Sing .* on “doo”, slowly \(70%\), with your part playing\./);
  await expect(page.getByTestId('pass-rule')).toContainText('All notes right to pass.'); // (Level 1 slow)
  await page.getByTestId('hp-yes').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('doo-label')).toBeVisible();
  await expect(page.getByTestId('pass-banner')).toContainText('Not yet: one note to fix.', { timeout: 90_000 });
  // The worst bar as a mini score, the note named in words (the pitch word scale), the level's tolerance.
  await expect(page.getByTestId('mistake-spot')).toHaveCount(1);
  await expect(page.getByTestId('wrong-bar')).toHaveCount(1);
  await expect(page.getByTestId('wrong-bar')).toContainText(/The .+ in (bar \d+|the upbeat) was clearly flat \(\d+ cents\)\./);
  await expect(page.getByTestId('wrong-bar')).toContainText('At Level 1 a note may be up to half a semitone (50 cents) off.');
  await page.getByTestId('cent-help-btn').click();
  await expect(page.getByTestId('cent-help')).toContainText('hundredth of a semitone');
  await expect(page.getByTestId('mistake-snippet').locator('canvas')).toBeVisible();
  // Zoomed in, and closed again with Escape and with "back".
  await page.getByTestId('mistake-snippet').click();
  await expect(page.getByTestId('mistake-zoom')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mistake-zoom')).toHaveCount(0);
  await page.getByTestId('mistake-zoom-btn').click();
  await expect(page.getByTestId('mistake-zoom')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('mistake-zoom')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/results/);
  // The primary action acts on the diagnosis: loop that bar slowly.
  await expect(page.getByTestId('loop-bar')).toContainText(/Loop (bar \d+|the upbeat) slowly \(50%\)/);
  await expect(page.getByTestId('next-passage')).toBeVisible();
  await expect(page.getByTestId('to-piece')).toBeVisible();
  // 95% accuracy, but a wrong note: the letter doesn't read as a pass.
  await expect(page.getByTestId('grade')).toHaveText('B');
  // The bar holding the wrong note "needs work" in the bar-by-bar strip.
  const orange = await page.locator('.heat button').evaluateAll((bs) => bs.filter((b) => getComputedStyle(b).backgroundColor === 'rgb(255, 122, 69)').length);
  expect(orange).toBe(1);
  // The section didn't pass: still level 0.
  const level = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('sh:progress:warmup-chorale:'));
    const p = k ? JSON.parse(localStorage.getItem(k)!) : null;
    return p ? Object.values(p.sections as Record<string, { level: number }>)[0]?.level ?? 0 : 0;
  });
  expect(level).toBe(0);
  // A result saved by an older version (no note verdicts, passed on the 75% mark) reads as it was
  // judged then: no "Notes to fix" next to "level 1 reached".
  await page.evaluate(() => {
    const r = JSON.parse(sessionStorage.getItem('sh:lastResult')!);
    delete r.everyNote;
    for (const n of r.result.notes) { delete n.unsure; delete n.clearly; }
    delete r.step;
    Object.assign(r, { passed: true, prevLevel: 0, newLevel: 1 });
    sessionStorage.setItem('sh:lastResult', JSON.stringify(r));
  });
  await page.reload();
  await expect(page.getByTestId('pass-banner')).toContainText('Level 1 · Notes ✓');
  await expect(page.getByTestId('wrong-notes')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// The primary action after a miss loops the worst bar slowly; the loop's results lead back to the
// whole passage. The zoomed mini score keeps its own slow drill of the marked bars.
test('What to fix: loop the bar slowly, then the passage again; the zoom drills the marked bars', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=oneflat#/piece/warmup-chorale');
  await startPassage(page, /Level 1 · Notes · slow/);
  await page.getByTestId('hp-yes').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toContainText('one note to fix', { timeout: 90_000 });
  await page.getByTestId('loop-bar').click();
  await expect(page).toHaveURL(/#\/play\/warmup-chorale\/[^/]+\/drill\?level=1&from=[\d.]+&to=[\d.]+&step=slow&rate=0\.5/);
  await expect(page.getByTestId('pass-rule')).toContainText('practice only');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('passage-again')).toContainText(/Now sing .* again/, { timeout: 60_000 });
  await page.getByTestId('passage-again').click();
  await expect(page.getByTestId('step-label')).toHaveText('Level 1 · Notes · slow');
  await expect(page.getByTestId('hp-state')).toContainText('Headphones on'); // (remembered)
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toContainText('one note to fix', { timeout: 90_000 });
  await page.getByTestId('mistake-zoom-btn').click();
  await page.getByTestId('practise-slow-zoom').click();
  await expect(page).toHaveURL(/#\/play\/warmup-chorale\/[^/]+\/drill\?level=1&from=[\d.]+&to=[\d.]+&step=slow&rate=0\.5/);
  await expect(page.getByTestId('mistake-zoom')).toHaveCount(0);
  await expect(page.getByTestId('start')).toBeVisible();
  expect(errors).toEqual([]);
});

// Level 1 counts only with headphones on (docs/LEVELS.md): the pre-run card asks, Start waits for
// the answer, the answer is remembered on this phone, and a perfect run through the speaker is
// practice: scored, wrong notes listed, but no level. Level 2 doesn't ask.
test('level 1 asks “Headphones on?”; without them a perfect run is practice', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await startPassage(page, /Level 1 · Notes · slow/);
  const q = page.getByTestId('headphones-q');
  await expect(q).toContainText('Headphones on?');
  await expect(page.getByTestId('start')).toBeDisabled();
  await page.getByTestId('hp-no').click();
  // Answered: one line, with the rule, and "change".
  await expect(page.getByTestId('hp-state')).toContainText('Phone speaker: practice only');
  await expect(page.getByTestId('hp-note')).toContainText('runs only count with headphones');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile') ?? '{}').headphones)).toBe(false);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toContainText(
    /Practice: Level 1 slow counts with headphones on, because through the speaker the app can.t hear every note reliably/, { timeout: 90_000 });
  await expect(page.getByTestId('result-score')).toBeVisible();
  await expect(page.getByTestId('again-headphones')).toBeVisible();
  await expect(page.getByTestId('grade')).toHaveAttribute('aria-label', /\(practice\)/);
  // Not a pass: the section is still at level 0, and nothing was granted.
  const level = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('sh:progress:warmup-chorale:'));
    const p = k ? JSON.parse(localStorage.getItem(k)!) : null;
    // (Uncounted runs are logged under 'practice', which isn't a section.)
    return p ? Object.entries(p.sections as Record<string, { level: number }>).filter(([id]) => id !== 'practice').reduce((a, [, x]) => Math.max(a, x.level), 0) : -1;
  });
  expect(level).toBe(0);
  // "Sing it again with headphones on" answers Yes for the next run.
  await page.getByTestId('again-headphones').click();
  await expect(page.getByTestId('hp-state')).toContainText('Headphones on');
  await page.getByTestId('hp-change').click();
  await expect(page.getByTestId('hp-yes')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('hp-no').click();
  // Next time the card is pre-filled; "change" and one tap change it.
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await startPassage(page, /Level 1 · Notes · slow/);
  await expect(page.getByTestId('hp-state')).toContainText('Phone speaker');
  await expect(page.getByTestId('start')).toBeEnabled();
  await page.getByTestId('hp-change').click();
  await page.getByTestId('hp-yes').click();
  await expect(page.getByTestId('hp-state')).toContainText('Headphones on');
  // Level 1 in tempo doesn't ask, nor does Level 2.
  await openDisplay(page);
  await page.getByTestId('step-tempo').click();
  await expect(page.getByTestId('step-label')).toHaveText('Level 1 · Notes · in tempo');
  await expect(page.getByTestId('headphones-q')).toHaveCount(0);
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await startPassage(page, /, Level 2 · Words/);
  await expect(page.getByTestId('start')).toBeEnabled();
  await expect(page.getByTestId('headphones-q')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Score view (sheet music): suggested at level 1, switchable before Start, remembered, and a run
// through it reaches the results.
test('score view: switch display, sing level 1 from sheet music, reach results', async ({ page }) => {
  test.setTimeout(150_000); // the run plays in real time; leave room for a loaded machine
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('piece-row').first().click();
  await startPassage(page, /Level 1 · Notes · slow/); // a passage, not the full run

  // Nothing chosen yet: level 1 suggests the score (under "Display & tempo").
  await openDisplay(page);
  await expect(page.getByTestId('display-score')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('display-highway').click();
  await expect(page.locator('canvas[data-display="highway"]')).toHaveCount(1);
  await page.getByTestId('display-score').click();
  await expect(page.locator('canvas[data-display="score"]')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile') ?? '{}').display)).toBe('score');

  await page.getByTestId('hp-yes').click();
  await page.getByTestId('start').click();
  await page.waitForTimeout(5000);
  // The staff is drawn: plenty of light (ink) pixels on the dark canvas.
  const ink = await page.locator('canvas').evaluate((cv: HTMLCanvasElement) => {
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 450) n++;
    return n;
  });
  expect(ink).toBeGreaterThan(2000);

  await expect(page.getByTestId('pass-banner')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('pass-banner')).toContainText(/Level 1 · slow ✓|✓/);

  // Settings: the same choice, including going back to automatic.
  await page.goto('/#/settings');
  const seg = page.getByTestId('settings-display');
  await expect(seg.getByRole('button', { name: 'Score' })).toHaveAttribute('aria-pressed', 'true');
  await seg.getByRole('button', { name: 'Highway' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile') ?? '{}').display)).toBe('highway');
  await seg.getByRole('button', { name: 'Automatic' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile') ?? '{}').display)).toBeUndefined();
  expect(errors).toEqual([]);
});

// Sheet music is the default at every level; on a laptop the score view is the full score.
test('new singer: level 3 opens in score view, a 1280-wide screen shows every voice, a phone one staff', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?simulate=perfect#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('piece-row').first().click();
  await startPassage(page, /Level 3/); // a passage, not the full run
  await openDisplay(page);
  await expect(page.getByTestId('display-score')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('canvas[data-display="score"]')).toHaveCount(1);
  await expect(page.getByTestId('staves-toggle')).toBeVisible();
  await expect(page.getByTestId('howto')).toContainText('full score');
  await page.getByTestId('start').click();
  await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-staves')), { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', /^Full score: S A T B, your part: /);
  const ink = await page.locator('canvas').evaluate((cv: HTMLCanvasElement) => {
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 450) n++;
    return n;
  });
  expect(ink).toBeGreaterThan(4000);

  // Same singer on a phone: the single staff, no staff choice.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('display-score')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('staves-toggle')).toHaveCount(0);
  await page.getByTestId('start').click();
  await expect.poll(async () => page.locator('canvas').getAttribute('data-staves'), { timeout: 10_000 }).toBe('1');
  expect(errors).toEqual([]);
});

// Off book the full score must not give the part away: no accompaniment (the organ doubles the
// alto), no words under the other voices. The Vierne is in the choir library (not built in), so the
// singer imports it here as their own score.
test('off book on a laptop: full score of the voices only', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/library');
  await page.getByLabel('Choose score files').setInputFiles(path.join(here, '..', 'library', 'scores', 'vierne-kyrie.mxl'));
  await expect(page).toHaveURL(/#\/piece\//, { timeout: 20_000 });
  const id = decodeURIComponent(page.url().split('#/piece/')[1]);
  await page.goto(`/?simulate=perfect#/play/${encodeURIComponent(id)}/P2/all?level=5&from=44&to=70`);
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Test: all hidden' }).click();
  await page.getByTestId('start').click();
  await expect.poll(async () => page.locator('canvas').getAttribute('aria-label'), { timeout: 10_000 }).toBe('Full score: S A T B, your part: alto');
  await expect(page.locator('canvas')).toHaveAttribute('data-staves', '4');
  // The same run at level 3 adds the organ.
  await page.goto(`/?simulate=perfect#/play/${encodeURIComponent(id)}/P2/all?level=3&from=44&to=70`);
  await page.getByTestId('start').click();
  await expect.poll(async () => page.locator('canvas').getAttribute('aria-label'), { timeout: 10_000 }).toBe('Full score: S A T B + organ, your part: alto');
  expect(errors).toEqual([]);
});

// Piece levels (docs/LEVELS.md): a full run-through at Level 1 in tempo, available right away, earns piece level 1.
test('a perfect simulated full run at level 1 grants piece level 1', async ({ page }) => {
  test.setTimeout(180_000); // the whole piece plays in real time
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await expect(page.getByTestId('piece-level')).toHaveText('You\'re here: Level 1 · slow, no passages yet', { timeout: 20_000 });
  await openMore(page);
  await expect(page.getByTestId('full-run-card')).toBeVisible();
  await page.getByTestId('full-1').click();
  await expect(page.getByTestId('full-info')).toBeVisible();
  // Full runs count in tempo only: no step choice, no headphones question.
  await expect(page.getByTestId('step-label')).toHaveText('Level 1 · Notes · in tempo');
  await expect(page.getByTestId('headphones-q')).toHaveCount(0);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toContainText('The whole piece reached Level 1 · Notes', { timeout: 150_000 });
  // Every section was scored within the run, none to fix.
  await expect(page.getByTestId('full-sections')).toBeVisible();
  await expect(page.getByTestId('full-section-fix')).toHaveCount(0);
  await page.goto('/#/piece/warmup-chorale');
  await expect(page.getByTestId('piece-level')).toHaveText(/You're here: Level 2/);
  await expect(page.getByTestId('level-meter').getByRole('listitem').first()).toHaveAttribute('aria-label', 'Level 1 Notes: reached');
  await openMore(page);
  await expect(page.getByTestId('full-1')).toHaveAttribute('aria-label', /passed/);
  const full = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('sh:progress:warmup-chorale:'));
    return k ? JSON.parse(localStorage.getItem(k)!).full : null;
  });
  expect(full).toMatchObject({ level: 1, attempts: 1 });
  expect(errors).toEqual([]);
});

// A new singer whose full run far above their level slips everywhere: too much slipped for it to
// count (practice), nothing to fix, and the next step is still level 1 of the first section.
test('a full run where most sections slip is practice and does not take over Next up', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?simulate=flat#/piece/warmup-chorale');
  await expect(page.getByTestId('more-ways')).toBeVisible({ timeout: 20_000 });
  await openMore(page);
  await page.getByTestId('full-4').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toContainText('Too much slipped for this run to count', { timeout: 120_000 });
  await expect(page.getByTestId('fix-first')).toHaveCount(0);
  await expect(page.getByTestId('full-section-fix')).toHaveCount(0);
  await page.goto('/#/piece/warmup-chorale');
  await expect(page.getByTestId('piece-next')).toContainText('Level 1 · Notes · slow');
  await expect(page.getByTestId('to-fix')).toHaveCount(0);
  await expect(page.getByTestId('full-4')).toBeEnabled();
});

/** Section ids and the singer's part of a built-in piece (vite serves the app's own modules). */
async function pieceInfo(page: import('@playwright/test').Page, pieceId: string) {
  return page.evaluate(async (id) => {
    const lib = await import('/src/ui/library.ts');
    await lib.ensureLoaded();
    const piece = lib.getPiece(id)!;
    const partId = lib.chosenPartId(piece, 'S');
    return { partId, ids: lib.singableSections(piece, partId).map((s) => s.id) };
  }, pieceId);
}

// The fix list after a full run (docs/LEVELS.md): fixing the section that slipped on its own
// reaches the level, with no second full run, and the full run is open all along.
test('fixing the section that slipped in a full run reaches the piece level without a re-run', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/#/piece/warmup-chorale');
  await expect(page.getByTestId('more-ways')).toBeVisible({ timeout: 20_000 });
  const { partId, ids } = await pieceInfo(page, 'warmup-chorale');
  const t = Date.now() - 3_600_000;
  await page.evaluate(({ partId, ids, t }) => {
    // A counted level-1 run an hour ago: the second section held, the first slipped.
    localStorage.setItem(`sh:progress:warmup-chorale:${partId}`, JSON.stringify({
      pieceId: 'warmup-chorale', partId, totalAttempts: 1, bestScore: 900,
      sections: { [ids[1]]: { level: 1, best: { 1: 0.95 }, attempts: 0, lastPassed: t, lastPracticed: t } },
      full: { level: 0, best: { 1: 0.9 }, attempts: 1, lastPracticed: t, toFix: { 1: [ids[0]] }, toFixLocks: { 1: true }, clean: [] },
    }));
  }, { partId, ids, t });
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await expect(page.getByTestId('to-fix')).toContainText('No need to sing it all again');
  await expect(page.getByTestId('piece-level')).toHaveText('You\'re here: Level 1 · in tempo, one passage to fix');
  await expect(page.getByTestId('now-eyebrow')).toHaveText('Now · Fix · Level 1 · Notes · in tempo');
  await expect(page.getByTestId('piece-next')).toContainText('Fix');
  await expect(page.getByTestId('section-to-fix')).toContainText('To fix · Level 1 in tempo');
  await expect(page.getByTestId('full-1')).toBeEnabled();
  await page.getByTestId('piece-next').click();
  // Fixes are in tempo (no headphones question there).
  await expect(page.getByTestId('step-label')).toHaveText('Level 1 · Notes · in tempo');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('fixed-banner')).toContainText('The whole piece reached Level 1 · Notes', { timeout: 90_000 });
  await page.goto('/#/piece/warmup-chorale');
  await expect(page.getByTestId('piece-level')).toHaveText(/You're here: Level 2/);
  await expect(page.getByTestId('to-fix')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Progress saved under the earlier rules: a fix list already done (the singer still owed the second
// full run) reaches its level on load, and a passed full run in the history is a clean-run star.
test('progress saved under the earlier rules is upgraded on load', async ({ page }) => {
  await page.goto('/#/piece/warmup-chorale');
  await expect(page.getByTestId('more-ways')).toBeVisible({ timeout: 20_000 });
  const { partId, ids } = await pieceInfo(page, 'warmup-chorale');
  const t = Date.now() - 2 * 86_400_000;
  await page.evaluate(({ partId, ids, t }) => {
    const e = (sectionId: string, level: number, at: number, passed: boolean) => ({ at, pieceId: 'warmup-chorale', partId, sectionId, level, accuracy: 0.84, score: 800, passed });
    localStorage.setItem(`sh:progress:warmup-chorale:${partId}`, JSON.stringify({
      pieceId: 'warmup-chorale', partId, totalAttempts: 6, bestScore: 900,
      sections: { [ids[0]]: { level: 2, best: { 2: 0.9 }, attempts: 2, lastPassed: t + 3600e3 }, [ids[1]]: { level: 2, best: { 2: 0.9 }, attempts: 1, lastPassed: t } },
      full: { level: 1, best: { 1: 0.9, 2: 0.84 }, attempts: 2, lastPracticed: t, lastPassed: t - 86_400_000 },
    }));
    localStorage.setItem('sh:log', JSON.stringify([e('all', 1, t - 86_400_000, true), e('all', 2, t, false), e(ids[0], 2, t + 3600e3, true)]));
  }, { partId, ids, t });
  await page.reload();
  await expect(page.getByTestId('piece-level')).toHaveText(/You're here: Level 3/, { timeout: 20_000 });
  await expect(page.getByTestId('clean-stars')).toContainText('Level 1');
  await openMore(page);
  await expect(page.getByTestId('star-1')).toBeVisible();
});

test('a flat simulated singer does not pass level 4', async ({ page }) => {
  await page.goto('/?simulate=flat#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('piece-row').first().click();
  await startPassage(page, /Level 4/); // a passage, not the full run
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('pass-banner')).toContainText('Not yet');
});

test('all main screens render without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const h of ['#/', '#/library', '#/ranks', '#/settings', '#/expert', '#/setup', '#/tuner', '#/diagnostics']) {
    await page.goto('/' + h);
    await page.waitForTimeout(800);
  }
  expect(errors).toEqual([]);
});

test('diagnostics mic test reads the fake microphone', async ({ page }) => {
  await page.goto('/#/diagnostics');
  await page.getByTestId('diag-mic').click();
  await expect(page.getByText(/readings\/s/)).toBeVisible({ timeout: 15_000 });
  const report = await page.getByLabel('Diagnostics report').inputValue();
  expect(JSON.parse(report).mic.readingsPerSec).toBeGreaterThan(20);
});

test('onboarding video opens from Home and loads', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('intro-open').first().click();
  const v = page.getByTestId('intro-video');
  await expect(v).toBeVisible();
  await expect.poll(async () => v.evaluate((el: HTMLVideoElement) => el.duration || 0), { timeout: 15_000 }).toBeGreaterThan(90);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(v).toHaveCount(0);
});

test('a real-microphone run can be shared as a recording (WAV + run.json)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('piece-row').first().click();
  await startPassage(page, /Level 1 · Notes · slow/); // a passage, not the full run
  await page.getByTestId('hp-yes').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toBeVisible({ timeout: 90_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-recording').click()]);
  expect(dl.suggestedFilename()).toMatch(/^schonberg-.*\.zip$/);
  const path = await dl.path();
  const { unzipSync, strFromU8 } = await import('fflate');
  const fs = await import('node:fs');
  const files = unzipSync(new Uint8Array(fs.readFileSync(path!)));
  const meta = JSON.parse(strFromU8(files['run.json']));
  expect(meta.version).toBe(2);
  expect(meta.samples.length).toBeGreaterThan(50);
  // The input-quality summary (hum, clipping, distortion, level) and the filters in front of the tracker.
  expect(Array.isArray(meta.inputQuality.problems)).toBe(true);
  expect(meta.inputQuality.filter.hp).toBeGreaterThan(30);
  expect(typeof meta.scoreTimeAtSample0).toBe('number');
  const wav = files['run.wav'];
  expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
  // Seconds of audio ≈ the run (count-in + section at 70%).
  const secs = (wav.length - 44) / 2 / meta.sampleRate;
  expect(secs).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('memorisation: piece map, off-book test with peek, cold start, words in rhythm, quiz and memory map', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await expect(page.getByTestId('more-ways')).toBeVisible({ timeout: 20_000 });
  await openMore(page);
  await expect(page.getByTestId('piece-map')).toBeVisible();
  // Level 5, all hidden, with a peek: shown as a practice run.
  await startPassage(page, /Level 5/); // a passage, not the full run
  await page.getByRole('button', { name: 'Test: all hidden' }).click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('peek')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('peek').dispatchEvent('pointerdown');
  await page.getByTestId('peek').dispatchEvent('pointerup');
  await expect(page.getByTestId('pass-banner')).toContainText(/peeked/, { timeout: 90_000 });
  // Cold start never counts for a level.
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await openMore(page);
  await page.getByTestId('cold-start').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('cold-again')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/level \d reached/i)).toHaveCount(0);
  // Words in rhythm.
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await openMore(page);
  await page.getByTestId('words-card').getByRole('button', { name: 'Read along' }).first().click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('words-banner')).toContainText(/done|Well done/, { timeout: 90_000 });
  // Quiz and memory map open.
  await page.goto('/#/piece/warmup-chorale');
  await openMore(page);
  await page.getByTestId('words-card').getByRole('button', { name: 'Lyrics quiz' }).click();
  await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 10_000 });
  await page.goto('/#/piece/warmup-chorale');
  await openMore(page);
  await page.getByRole('button', { name: 'Memory map' }).click();
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});

// A choir member is on the choir's leaderboard by first name: Skip in setup can't go past the name.
test('setup: Skip with a choir code asks for the first name before finishing', async ({ page }) => {
  await page.goto('/#/');
  await page.evaluate(() => {
    localStorage.setItem('sh:profile', JSON.stringify({ choirCode: 'kammerchor', leaderboardOptIn: true, name: '', onboarded: false }));
  });
  await page.goto('/#/setup');
  await page.getByTestId('setup-skip').click();
  await expect(page.getByRole('heading', { name: "Who's singing?" })).toBeVisible();
  await expect(page.getByText("Your choir's leaderboard needs your first name.")).toBeVisible();
  await page.getByTestId('setup-skip').click(); // still no name: stays here
  await expect(page.getByRole('heading', { name: "Who's singing?" })).toBeVisible();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile') ?? '{}'));
  expect((await stored()).onboarded).toBeFalsy();
  await page.getByPlaceholder('First name').fill('Sophie');
  await page.getByTestId('setup-skip').click();
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  expect(await stored()).toMatchObject({ name: 'Sophie', onboarded: true, choirCode: 'kammerchor' });
});

test('setup: Skip without a choir finishes at once, name or not', async ({ page }) => {
  await page.goto('/#/setup');
  await page.getByTestId('setup-skip').click();
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
});
