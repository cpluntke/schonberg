import { test, expect, type Page } from '@playwright/test';
import { startPassage } from './helpers';

// Navigation while practising (src/ui/router.ts): every practice screen sits right above its piece,
// Play and Results replace each other, so back (←, the browser's, Android's) always lands on the
// piece, never on an old Results; singing, back pauses and asks instead of dropping the run.

async function home(page: Page) {
  await page.goto('/?simulate=perfect#/');
  await expect(page.getByRole('heading', { name: 'Your pieces' })).toBeVisible({ timeout: 20_000 });
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
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'true');
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

test('Start today\u2019s practice on Home: back from Play goes to the piece, then Home; ⌂ on Results goes Home', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  await page.getByTestId('start-today').click();
  await expect(page.getByTestId('start')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/piece\//);
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);

  await page.getByTestId('piece-row').first().click();
  await singFirstSection(page);
  await page.getByTestId('bar-home').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Your pieces' })).toBeVisible();
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

// The tabs (src/ui/nav.ts): Today · Pieces · Intonation · Train · Choir; Settings behind the avatar's You sheet.
test('tabs: Today, Pieces, Intonation, Train, Choir; old addresses land on the new homes; the lit tab follows where a piece was opened', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await home(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('button')).toHaveText(['Today', 'Pieces', 'Intonation', 'Train', 'Choir']);
  await expect(nav.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('button', { name: 'Pieces' }).click();
  await expect(page).toHaveURL(/#\/pieces$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pieces');
  await expect(page.getByLabel('Choose score files')).toBeAttached();
  await expect(page.getByTestId('pieces-row').first()).toContainText('Abendlied');
  // A piece opened from Pieces keeps Pieces lit.
  await page.getByTestId('pieces-row').first().click();
  await expect(page).toHaveURL(/#\/piece\//);
  await expect(nav.getByRole('button', { name: 'Pieces' })).toHaveAttribute('aria-current', 'true');

  await page.goto('/#/library');
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pieces');
  await expect(nav.getByRole('button', { name: 'Pieces' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('button', { name: 'Train' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Train');
  await nav.getByRole('button', { name: 'Intonation' }).click();
  await expect(page).toHaveURL(/#\/tune$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Intonation');
  await page.getByTestId('train-tuner').click();
  await expect(page).toHaveURL(/#\/tuner$/);
  await expect(nav.getByRole('button', { name: 'Intonation' })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/tune$/);

  await nav.getByRole('button', { name: 'Choir' }).click();
  await expect(page).toHaveURL(/#\/choir$/);
  await expect(page.getByTestId('choir-title')).toBeVisible();
  // Ranks is part of the Choir tab now.
  await page.goto('/#/ranks');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ranks');
  await expect(nav.getByRole('button', { name: 'Choir' })).toHaveAttribute('aria-current', 'true');
  expect(errors).toEqual([]);
});

test('phones: the tab bar on the tabs only; sub-screens have their back arrow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.getByTestId('piece-row').first().click();
  await expect(page.getByRole('heading', { name: 'Passages' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
});

test('the avatar opens the You sheet; its rows open Settings on the right part; no Super admin for singers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  await page.getByTestId('you-button').click();
  const sheet = page.getByTestId('you-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.you-row strong')).toHaveText(['You & voice', 'Practice', 'Your progress', 'Choir & account', 'Display', 'Privacy', 'Help & intro video', 'Your data']);
  // (staff rows only with a staff login)
  await expect(sheet.getByTestId('you-row-super')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  // The browser's (Android's) back closes the sheet and stays on the screen.
  await page.getByTestId('you-button').click();
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('greeting')).toBeVisible();
  await expect(page.getByTestId('you-button')).toHaveAccessibleName(/^You \(\S+\): /);

  await page.getByTestId('you-button').click();
  await page.getByTestId('you-row-privacy').click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByTestId('usage-stats')).toBeInViewport();
  await expect(page.getByTestId('settings-super-link')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Super admin');

  await page.goBack();
  await page.getByTestId('you-button').click();
  await page.getByTestId('you-row-progress').click();
  await expect(page).toHaveURL(/#\/progress$/);
});
