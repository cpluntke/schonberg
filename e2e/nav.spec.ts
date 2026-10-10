import { test, expect, type Page } from '@playwright/test';
import { startPassage } from './helpers';

// Navigation while practising (src/ui/router.ts): every practice screen sits right above its piece,
// Play and Results replace each other, so back (←, the browser's, Android's) always lands on the
// piece, never on an old Results; singing, back pauses and asks instead of dropping the run.

async function home(page: Page) {
  await page.goto('/?simulate=perfect#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
}

async function singFirstSection(page: Page) {
  await startPassage(page, /Level 1 · Notes · slow/);
  const hp = page.getByTestId('hp-yes');
  if (await hp.isVisible()) await hp.click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('results-foot')).toBeVisible({ timeout: 90_000 });
}

test('Results: back lands on the piece, then Home; Again then back lands on the piece too', async ({ page }) => {
  test.setTimeout(300_000); // four short runs
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await home(page);
  await page.getByTestId('piece-row').first().click();
  await expect(page.getByRole('heading', { name: 'Passages' })).toBeVisible();
  // The piece page keeps the tab it was opened from lit.
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'true');
  const pieceUrl = page.url();
  await singFirstSection(page);
  await expect(page).toHaveURL(/#\/results$/);
  // The next step is in view without scrolling, with these bars in tempo (a step-up) and the piece next to it.
  await expect(page.getByTestId('next-step')).toBeInViewport();
  await expect(page.getByTestId('now-in-tempo')).toBeInViewport();
  await expect(page.getByTestId('to-piece')).toBeInViewport();
  await expect(page.getByTestId('finish-today')).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(pieceUrl);
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
  await page.goForward();
  await expect(page).toHaveURL(pieceUrl);

  // Again from Results replaces it; back from that run (and its results) is the piece.
  await singFirstSection(page);
  await page.getByTestId('again').click(); // (slow passed already: Again)
  await expect(page.getByTestId('start')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(pieceUrl);
  await expect(page.getByRole('heading', { name: 'Passages' })).toBeVisible();

  // ← on Results and "☰ Piece" also go to the piece; no extra history (back again is Home).
  await singFirstSection(page);
  await page.getByTestId('bar-back').click();
  await expect(page).toHaveURL(pieceUrl);
  await singFirstSection(page);
  await page.getByTestId('to-piece').click();
  await expect(page).toHaveURL(pieceUrl);
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
  expect(errors).toEqual([]);
});

test('Practise now on Home: back from Play goes to the piece, then Home; ⌂ on Results goes Home', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  await page.getByRole('button', { name: /^(Practise now|Sing it all now|Fix it now)$/ }).first().click();
  await expect(page.getByTestId('start')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/piece\//);
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);

  await page.getByTestId('piece-row').first().click();
  await singFirstSection(page);
  await page.getByTestId('bar-home').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('Repertoire')).toBeVisible();
});

test('mid-run, ← and back pause and open the sheet; leaving from it lands on the piece', async ({ page }) => {
  await home(page);
  await page.getByTestId('piece-row').first().click();
  const pieceUrl = page.url();
  await startPassage(page, /Level 1 · Notes · slow/);
  await page.getByTestId('hp-yes').click();
  // One Start button on the ready screen.
  await expect(page.getByRole('button', { name: /Start|Sing it now/ })).toHaveCount(1);
  await page.getByTestId('start').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 10_000 });
  const playUrl = page.url();

  // ← while singing: paused, with the way out and what it costs.
  await page.getByTestId('bar-back').click();
  const sheet = page.getByTestId('pause-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Leaving discards this run');
  await expect(page).toHaveURL(playUrl);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 10_000 });

  // The browser's (Android's) back while singing: the same.
  await page.evaluate(() => history.back());
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(playUrl);

  // Paused already: back to the piece.
  await sheet.getByTestId('pause-back').click();
  await expect(page).toHaveURL(pieceUrl);
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
});
