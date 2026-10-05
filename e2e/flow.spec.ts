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

// Score view (sheet music): suggested at level 1, switchable before Start, remembered, and a run
// through it reaches the results.
test('score view: switch display, sing level 1 from sheet music, reach results', async ({ page }) => {
  test.setTimeout(150_000); // the run plays in real time; leave room for a loaded machine
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('piece-row').first().click();
  await page.getByRole('button', { name: /level 1/ }).first().click();

  // Nothing chosen yet: level 1 suggests the score.
  await expect(page.getByTestId('display-score')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('display-highway').click();
  await expect(page.locator('canvas[data-display="highway"]')).toHaveCount(1);
  await page.getByTestId('display-score').click();
  await expect(page.locator('canvas[data-display="score"]')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile') ?? '{}').display)).toBe('score');

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
  await expect(page.getByTestId('pass-banner')).toContainText(/Level 1 reached|Passed/);

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
  await page.getByRole('button', { name: /level 3/ }).first().click();
  await expect(page.getByTestId('display-score')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('canvas[data-display="score"]')).toHaveCount(1);
  await expect(page.getByTestId('staves-toggle')).toBeVisible();
  await expect(page.getByTestId('howto')).toContainText('full score');
  await page.getByTestId('start').click();
  await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-staves')), { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', 'Full score');
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
  await page.getByRole('button', { name: /level 1/ }).first().click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toBeVisible({ timeout: 90_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-recording').click()]);
  expect(dl.suggestedFilename()).toMatch(/^schonberg-.*\.zip$/);
  const path = await dl.path();
  const { unzipSync, strFromU8 } = await import('fflate');
  const fs = await import('node:fs');
  const files = unzipSync(new Uint8Array(fs.readFileSync(path!)));
  const meta = JSON.parse(strFromU8(files['run.json']));
  expect(meta.version).toBe(1);
  expect(meta.samples.length).toBeGreaterThan(50);
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
  await expect(page.getByTestId('piece-map')).toBeVisible({ timeout: 20_000 });
  // Level 5, all hidden, with a peek: shown as a practice run.
  await page.getByRole('button', { name: /level 5/ }).first().click();
  await page.getByRole('button', { name: 'Test: all hidden' }).click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('peek')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('peek').dispatchEvent('pointerdown');
  await page.getByTestId('peek').dispatchEvent('pointerup');
  await expect(page.getByTestId('pass-banner')).toContainText(/peeked/, { timeout: 90_000 });
  // Cold start never counts for a level.
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await page.getByTestId('cold-start').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('cold-again')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Level \d reached/)).toHaveCount(0);
  // Words in rhythm.
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await page.getByTestId('words-card').getByRole('button', { name: 'Read along' }).first().click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('words-banner')).toContainText(/done|Well done/, { timeout: 90_000 });
  // Quiz and memory map open.
  await page.goto('/#/piece/warmup-chorale');
  await page.getByTestId('words-card').getByRole('button', { name: 'Lyrics quiz' }).click();
  await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 10_000 });
  await page.goto('/#/piece/warmup-chorale');
  await page.getByRole('button', { name: 'Memory map' }).click();
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});
