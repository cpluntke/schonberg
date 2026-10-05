import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

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
  await page.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click(); // a section, not the full run
  await page.getByTestId('hp-yes').click(); // level 1 counts with headphones on
  await page.getByTestId('start').click();

  // Wait for the results screen (sections are short; allow for count-in + 70% tempo).
  await expect(page.getByTestId('pass-banner')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('pass-banner')).toContainText(/level 1 reached|Passed/);
  const score = await page.getByTestId('result-score').textContent();
  expect(Number((score ?? '0').replace(/\D/g, ''))).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// Level 1 is sung on "doo" and needs every note right: one note 70¢ flat fails it, and Results names
// the bar and the note, with a loop to drill it (docs/LEVELS.md).
test('level 1 on “doo”: one flat note fails it, and Results says which', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=oneflat#/piece/warmup-chorale');
  await page.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click();
  await expect(page.getByTestId('doo-note')).toContainText('doo');
  await expect(page.getByText(/pass: every note right/)).toBeVisible();
  await page.getByTestId('hp-yes').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('doo-label')).toBeVisible();
  await expect(page.getByTestId('pass-banner')).toContainText(/one note wasn’t right/, { timeout: 90_000 });
  await expect(page.getByTestId('wrong-bar')).toHaveCount(1);
  await expect(page.getByTestId('wrong-bar')).toContainText(/(Bar \d+|Upbeat):.*note \d+.*was flat \(−\d+¢\)/);
  await expect(page.getByTestId('wrong-bar').getByRole('button', { name: /Loop (bar \d+|upbeat) slowly/ })).toBeVisible();
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
    Object.assign(r, { passed: true, prevLevel: 0, newLevel: 1 });
    sessionStorage.setItem('sh:lastResult', JSON.stringify(r));
  });
  await page.reload();
  await expect(page.getByTestId('pass-banner')).toContainText('level 1 reached');
  await expect(page.getByTestId('wrong-notes')).toHaveCount(0);
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
  await page.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click();
  const q = page.getByTestId('headphones-q');
  await expect(q).toContainText('Headphones on?');
  await expect(page.getByTestId('start')).toBeDisabled();
  await page.getByTestId('hp-no').click();
  await expect(page.getByTestId('hp-no')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hp-note')).toContainText('level 1 counts with headphones on');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sh:profile') ?? '{}').headphones)).toBe(false);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toContainText(
    /Practice: level 1 counts with headphones on, because through the speaker the app can.t hear every note reliably/, { timeout: 90_000 });
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
  await expect(page.getByTestId('hp-yes')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('hp-no').click();
  // Next time the card is pre-filled; one tap changes it.
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await page.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click();
  await expect(page.getByTestId('hp-no')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('start')).toBeEnabled();
  await page.getByTestId('hp-yes').click();
  await expect(page.getByTestId('hp-yes')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hp-note')).toHaveText('Level 1 counts with headphones on.');
  // Level 2 doesn't ask.
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await page.getByLabel('Sections').getByRole('button', { name: /, level 2 In time/ }).first().click();
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
  await page.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click(); // a section, not the full run

  // Nothing chosen yet: level 1 suggests the score.
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
  await expect(page.getByTestId('pass-banner')).toContainText(/level 1 reached|Passed/);

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
  await page.getByLabel('Sections').getByRole('button', { name: /level 3/ }).first().click(); // a section, not the full run
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

// Piece levels (docs/LEVELS.md): a full run-through at level 1, available right away, earns piece level 1.
test('a perfect simulated full run at level 1 grants piece level 1', async ({ page }) => {
  test.setTimeout(180_000); // the whole piece plays in real time at 70%
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/piece/warmup-chorale');
  await expect(page.getByTestId('full-run-card')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('piece-level')).toHaveText('Not sung through yet');
  await page.getByTestId('full-1').click();
  await expect(page.getByTestId('full-info')).toBeVisible();
  await page.getByTestId('hp-yes').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toContainText('Piece level 1 reached', { timeout: 150_000 });
  // Every section was scored within the run, none to fix.
  await expect(page.getByTestId('full-sections')).toBeVisible();
  await expect(page.getByTestId('full-section-fix')).toHaveCount(0);
  await page.goto('/#/piece/warmup-chorale');
  await expect(page.getByTestId('piece-level')).toHaveText(/Piece level 1/);
  await expect(page.getByTestId('full-1')).toHaveAttribute('aria-label', /passed/);
  const full = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('sh:progress:warmup-chorale:'));
    return k ? JSON.parse(localStorage.getItem(k)!).full : null;
  });
  expect(full).toMatchObject({ level: 1, attempts: 1 });
  expect(errors).toEqual([]);
});

// A new singer whose full run far above their level fails: the slips are shown, nothing locks,
// and the next step is still level 1 of the first section.
test('a failed full run above the singer’s level does not take over Next up', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?simulate=flat#/piece/warmup-chorale');
  await expect(page.getByTestId('full-run-card')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('full-4').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toContainText('Not yet', { timeout: 120_000 });
  await expect(page.getByTestId('fix-first')).toHaveCount(0);
  await page.goto('/#/piece/warmup-chorale');
  await expect(page.getByTestId('piece-next')).toContainText('level 1');
  await expect(page.getByTestId('later-fix')).toBeVisible();
  await expect(page.getByTestId('full-4')).toBeEnabled();
});

test('a flat simulated singer does not pass level 4', async ({ page }) => {
  await page.goto('/?simulate=flat#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('piece-row').first().click();
  await page.getByLabel('Sections').getByRole('button', { name: /level 4/ }).first().click(); // a section, not the full run
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
  await page.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click(); // a section, not the full run
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
  await page.getByLabel('Sections').getByRole('button', { name: /level 5/ }).first().click(); // a section, not the full run
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
  await expect(page.getByText(/level \d reached/i)).toHaveCount(0);
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
