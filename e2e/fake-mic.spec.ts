import { expect, test } from '@playwright/test';

interface Reading { t: number; hz: number | null; midi: number | null; clarity: number; rms: number }

test('PitchTracker detects the fixture pitches from a fake microphone (WAV fixture)', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // On a cold Vite cache the dev server may pre-bundle deps (pitchy) on first load and
  // force a full page reload, wiping the page state — so retry until readings flow.
  const count = async () => ((await page.locator('#out').textContent()) ?? '').split('\n').filter(Boolean).length;
  let n = 0;
  for (let attempt = 0; attempt < 3 && n <= 300; attempt++) {
    await page.goto('/pitch-test.html');
    await page.waitForLoadState('networkidle');
    await page.click('#start');
    await expect(page.locator('#status')).toContainText('running', { timeout: 10_000 });
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && (n = await count()) <= 300) await page.waitForTimeout(250);
  }
  expect(n).toBeGreaterThan(300);

  const text = (await page.locator('#out').textContent()) ?? '';
  const readings: Reading[] = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const voiced = readings.filter((r) => r.midi != null).map((r) => r.midi as number);
  if (testInfo.project.name === 'mic-scale') {
    // A3 B3 C4 D4 E4 F4 G4 A4 (+ rest), looped: each scale step must be seen and readings
    // must sit on the semitone grid (no octave / off-by-a-step errors).
    expect(voiced.length / readings.length).toBeGreaterThan(0.5);
    const counts = new Map<number, number>();
    for (const m of voiced) counts.set(Math.round(m), (counts.get(Math.round(m)) ?? 0) + 1);
    for (const m of [57, 59, 60, 62, 64, 65, 67, 69]) expect(counts.get(m) ?? 0).toBeGreaterThanOrEqual(3);
    const onGrid = voiced.filter((m) => Math.abs(m - Math.round(m)) < 0.3 && [57, 59, 60, 62, 64, 65, 67, 69].includes(Math.round(m)));
    expect(onGrid.length / voiced.length).toBeGreaterThan(0.95);
  } else {
    expect(voiced.length / readings.length).toBeGreaterThan(0.6);
    const sorted = [...voiced].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    expect(Math.abs(med - 57)).toBeLessThan(0.5);
    // Nearly every voiced reading should be A3 (no octave errors).
    const close = voiced.filter((m) => Math.abs(m - 57) < 0.5).length;
    expect(close / voiced.length).toBeGreaterThan(0.95);
  }
  // Timestamps are monotonic on the AudioContext clock, ~20 ms apart.
  const dts = readings.slice(1).map((r, i) => r.t - readings[i].t);
  expect(dts.every((d) => d >= 0)).toBe(true);
  expect(errors).toEqual([]);

  await page.click('#stop');
  await expect(page.locator('#status')).toHaveText('stopped');
});
