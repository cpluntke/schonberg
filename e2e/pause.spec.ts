import { test, expect } from '@playwright/test';

// Pause and resume a run: the count-in is announced, the Resume button gets focus, and the screen
// only shows the run again once playback is back.
test('pause and resume a simulated run', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('piece-row').first().click();
  await page.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click();
  await page.getByTestId('start').click();

  await expect(page.getByTestId('countin-live')).toHaveText(/^[1-4]$/, { timeout: 10_000 });
  const pause = page.getByRole('button', { name: 'Pause' });
  await expect(pause).toBeVisible();
  await page.waitForTimeout(4000);
  await pause.click();
  const resume = page.getByRole('button', { name: 'Resume' });
  await expect(resume).toBeFocused();
  await resume.click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 10_000 });
  // The resumed run counts in again.
  await expect(page.getByTestId('countin-live')).toHaveText(/^[1-4]$/, { timeout: 10_000 });
  await page.waitForTimeout(6000); // sing on for a few notes
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Finish & see results' }).click();
  await page.waitForURL(/#\/results/, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

// A full device (the origin's storage shared with another site): the singer is told once.
test('storage full: the singer is told that saving failed', async ({ page }) => {
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (this === window.localStorage && k.startsWith('sh:')) throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, k, v);
    };
  });
  await page.goto('/#/settings');
  const notice = page.getByTestId('storage-full');
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toContainText(/storage is full/);
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(notice).toBeHidden();
});
