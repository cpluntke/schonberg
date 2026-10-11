import { test, expect } from '@playwright/test';
import { openMore } from './helpers';

// Settings → Display: appearance and text size apply app-wide, at once, and survive a reload.
test('appearance and text size: light theme, larger text, back to the defaults', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/#/settings');
  const html = page.locator('html');
  await expect(page.getByTestId('settings-appearance')).toBeVisible({ timeout: 20_000 });
  // Dark by default.
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  await expect(page.getByTestId('appearance-dark')).toHaveAttribute('aria-pressed', 'true');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe('rgb(11, 13, 26)');

  await page.getByTestId('appearance-light').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await bg()).toBe('rgb(245, 246, 250)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#F5F6FA');

  await page.getByTestId('textsize-larger').click();
  await expect(html).toHaveAttribute('data-text', 'larger');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20.8px');
  // Running text grows with it (a 14 px line becomes 18.2 px).
  expect(await page.locator('.settings .small').first().evaluate((e) => getComputedStyle(e).fontSize)).toBe('18.2px');

  // Kept across a reload, before the first paint.
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveAttribute('data-text', 'larger');

  await page.getByTestId('appearance-dark').click();
  await page.getByTestId('textsize-standard').click();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  await expect(html).not.toHaveAttribute('data-text', /.+/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0B0D1A');
  expect(errors).toEqual([]);
});

test('"Match the phone" follows the phone\'s light or dark setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/settings');
  await expect(page.getByTestId('settings-appearance')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('appearance-system').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

// The singing view on a phone: no words about the pitch (the blue line shows it), the progress strip of a whole-piece run, Stop and Pause.
test.describe('the singing view on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a whole-piece run in the score view: no pitch words, bar strip, Stop and Pause side by side', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/?simulate=flat#/piece/warmup-chorale');
    await expect(page.getByTestId('piece-level')).toBeVisible({ timeout: 20_000 });
    await openMore(page);
    await page.getByTestId('full-1').click();
    const strip = page.getByTestId('run-strip');
    await expect(strip).toHaveAttribute('aria-valuenow', '0');
    await page.getByTestId('start').click();

    // The simulated singer is flat: the blue line shows it; no words say so.
    await expect.poll(async () => Number(await strip.getAttribute('aria-valuenow')), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId('readout')).toHaveCount(0);
    await expect(page.getByText(/flat ↓|spot on/)).toHaveCount(0);
    const stop = page.getByRole('button', { name: 'Stop' });
    const pause = page.getByRole('button', { name: 'Pause' });
    const [a, b] = [await stop.boundingBox(), await pause.boundingBox()];
    expect(Math.abs(a!.width - b!.width)).toBeLessThan(2);
    expect(a!.height).toBeGreaterThanOrEqual(44);
    // Neither is orange while singing.
    const fill = await pause.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(fill).not.toBe('rgb(255, 122, 69)');
    // The strip moves on bar by bar.
    await expect.poll(async () => Number(await strip.getAttribute('aria-valuenow')), { timeout: 15_000 }).toBeGreaterThan(0);

    await stop.click();
    await page.waitForURL(/#\/results/, { timeout: 20_000 });
    expect(errors).toEqual([]);
  });
});
