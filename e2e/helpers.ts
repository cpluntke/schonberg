import { expect, type Page } from '@playwright/test';

/**
 * Start a step of a passage from the piece screen: open the passage's sheet (its row in "Passages")
 * and tap the step whose label matches `name` (e.g. /Level 1 · Notes · slow/, /Level 3/).
 */
export async function startPassage(page: Page, name: RegExp, index = 0) {
  await page.getByTestId('passage-row').nth(index).click();
  const sheet = page.getByTestId('passage-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name }).first().click();
  await expect(page).toHaveURL(/#\/(play|arcade)\//);
}

/** Open the piece's "More ways to practise" row (sing it all, entries, words, cold start, the map…). */
export async function openMore(page: Page) {
  const more = page.getByTestId('more-ways');
  if (!(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator('summary').first().click();
}

/** Open the pre-run card's "Display & tempo" row (step, display, staves, tempo). */
export async function openDisplay(page: Page) {
  const d = page.getByTestId('display-tempo');
  if (!(await d.evaluate((x) => (x as HTMLDetailsElement).open))) await d.locator('summary').click();
}
