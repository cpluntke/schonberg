import { test, expect } from '@playwright/test';

// Full core loop with the synthetic singer (?simulate=perfect): home → piece → level 1 → results.
test('a perfect simulated singer passes level 1 and levels up', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });

  // Open the first piece in the cycle.
  await page.getByTestId('piece-row').first().click();
  await expect(page.getByRole('heading', { name: 'Sections' })).toBeVisible();

  // Level 1 of the first section.
  await page.getByRole('button', { name: /level 1/ }).first().click();
  await page.getByTestId('start').click();

  // Wait for the results screen (sections are short; allow for count-in + 70% tempo).
  await expect(page.getByTestId('pass-banner')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('pass-banner')).toContainText(/Level 1 reached|Passed/);
  const score = await page.getByTestId('result-score').textContent();
  expect(Number((score ?? '0').replace(/\D/g, ''))).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a flat simulated singer does not pass level 4', async ({ page }) => {
  await page.goto('/?simulate=flat#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('piece-row').first().click();
  await page.getByRole('button', { name: /level 4/ }).first().click();
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
