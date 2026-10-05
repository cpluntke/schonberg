import { test, expect } from '@playwright/test';

// An install from before the choir library: its programme came from the old preset (Debussy,
// Vierne, Fauré and Poulenc) and it has progress on a former built-in piece. After the update the
// app ships only the Abendlied: the programme drops the missing pieces without crashing anywhere,
// and the progress stays stored (it comes back if the choir adds the piece from its library).
test('an old install with former built-in pieces upgrades without errors and keeps its progress', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/#/diagnostics');
  const T = Date.now() - 2 * 86_400_000;
  await page.evaluate((t) => {
    localStorage.setItem('sh:profile', JSON.stringify({ name: 'Alma', voice: 'A', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, onboarded: true, leaderboardOptIn: true, choirCode: undefined }));
    localStorage.setItem('sh:cycle', JSON.stringify({
      name: 'Fauré · Debussy · Poulenc · Vierne', pieceIds: ['debussy-dieu', 'debussy-tabourin', 'debussy-yver', 'vierne-kyrie', 'warmup-chorale'],
      focusPieceIds: ['debussy-tabourin', 'vierne-kyrie'], rehearsalWeekday: 4, rehearsalTime: '19:30', preset: 'cycle-autumn-2026',
      wanted: [{ title: 'Vinea mea electa', composer: 'Francis Poulenc', note: 'still in copyright: import your choir’s score' },
        { title: 'Madrigal, Op. 35', composer: 'Gabriel Fauré', note: 'import your choir’s score', focus: true }],
    }));
    localStorage.setItem('sh:cyclePreset', 'cycle-autumn-2026');
    localStorage.setItem('sh:cycleSeeded', '1');
    localStorage.setItem('sh:part:debussy-dieu', 'P2');
    localStorage.setItem('sh:progress:debussy-dieu:P2', JSON.stringify({
      pieceId: 'debussy-dieu', partId: 'P2', totalAttempts: 9, bestScore: 4200,
      sections: { s0: { level: 3, best: { 1: 0.95, 2: 0.9, 3: 0.86 }, attempts: 9, lastPracticed: t, lastPassed: t } },
    }));
    sessionStorage.setItem('sh:lastResult', JSON.stringify({ pieceId: 'debussy-dieu', partId: 'P2', sectionId: 's0', level: 3 }));
  }, T);

  // Home (a fresh start of the app): only the Abendlied, the old preset's pieces to come are gone, and a notice says why.
  await page.goto('/?updated=1#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('piece-row')).toHaveCount(1);
  await expect(page.getByTestId('piece-row')).toContainText('Abendlied');
  await expect(page.getByTestId('wanted-row')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'no longer built in' })).toBeVisible();
  const cycle = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:cycle')!));
  expect(cycle.pieceIds).toEqual(['warmup-chorale']);
  expect(cycle.focusPieceIds).toEqual([]);
  expect(cycle.preset).toBeUndefined();
  expect(cycle.name).toBe('This cycle');

  // Every screen copes with the unknown piece id (deep links included).
  for (const h of ['#/library', '#/ranks', '#/settings', '#/expert', '#/results', '#/piece/debussy-dieu', '#/play/debussy-dieu/P2/s0?level=1',
    '#/lyrics/debussy-dieu/P2', '#/memorymap/debussy-dieu/P2', '#/choir', '#/choirinsights', '#/section']) {
    await page.goto('/' + h);
    await page.waitForTimeout(500);
    await expect(page.locator('main')).toBeVisible();
  }
  // The progress on the former built-in piece is still stored.
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('sh:progress:debussy-dieu:P2') ?? 'null'));
  expect(kept?.sections?.s0?.level).toBe(3);
  // A reload doesn't repeat the migration or bring the pieces back.
  await page.goto('/?again=1#/');
  await expect(page.getByTestId('piece-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a new solo singer gets the Abendlied as the programme, and no library files are served', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('piece-row')).toHaveCount(1);
  await expect(page.getByTestId('piece-row')).toContainText('Abendlied');
  await page.goto('/#/library');
  await expect(page.locator('main')).not.toContainText('Debussy');
  for (const f of ['pieces/repertoire.json', 'pieces/cycle.json', 'pieces/pd/debussy-dieu.mxl']) {
    const r = await request.get('/' + f);
    // Vite's dev server answers unknown paths with index.html; what matters is that no score comes back.
    expect((await r.body()).subarray(0, 2).toString()).not.toBe('PK');
    expect(await r.text()).not.toContain('"debussy-dieu"');
  }
  expect(errors).toEqual([]);
});
