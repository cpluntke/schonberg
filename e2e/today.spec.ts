import { test, expect, type Page } from '@playwright/test';

// Today (docs/TODAY.md): Home's plan, today's session through Play and Results, Today done, the week,
// Your progress, the day after a rehearsal, and welcome back after a break.

const PROFILE = { name: 'Clara Weber', voice: 'A', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, latencySource: 'measured', onboarded: true, leaderboardOptIn: false, headphones: true, displayMigrated: true, scoreDefaultMigrated: true };

async function seeded(page: Page, url: string, extra: (now: number) => Record<string, unknown> = () => ({})) {
  await page.goto('/#/');
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(({ profile, extra }) => {
    localStorage.setItem('sh:profile', JSON.stringify(profile));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, JSON.stringify(v));
  }, { profile: PROFILE, extra: extra(Date.now()) });
  await page.goto(url);
  await page.reload(); // (the same address only changes the hash: load the seeded state)
  await expect(page.getByText('Repertoire')).toBeVisible({ timeout: 20_000 });
}

async function sing(page: Page) {
  await expect(page.getByTestId('prerun')).toBeVisible();
  const hp = page.getByTestId('hp-yes');
  if (await hp.isVisible()) await hp.click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('results-foot')).toBeVisible({ timeout: 90_000 });
}

test('today’s plan: start, the session strip, the next step from Results, finish, Today done', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await seeded(page, '/?simulate=perfect#/');
  await expect(page.getByTestId('greeting')).toContainText('Clara');
  const card = page.getByTestId('plan-card');
  await expect(card).toContainText('Today');
  const steps = card.getByTestId('plan-step');
  const n = await steps.count();
  expect(n).toBeGreaterThanOrEqual(2);
  // "about N min" is the exact sum of the steps' minutes
  const mins = (await steps.allInnerTexts()).map((t) => Number(/(\d+) min/.exec(t)?.[1] ?? 0)).reduce((a, b) => a + b, 0);
  await expect(page.getByTestId('plan-minutes')).toHaveText(`about ${mins} min`);
  // One primary on the screen.
  await expect(page.locator('main .btn.primary')).toHaveCount(1);

  await page.getByTestId('start-today').click();
  await expect(page.getByTestId('session-strip')).toContainText(`Today · step 1 of ${n}`);
  await sing(page);
  await expect(page.getByTestId('session-strip')).toContainText(`1 of ${n} done`);
  await expect(page.getByTestId('today-next')).toContainText('Next:');
  await expect(page.getByTestId('today-next')).toContainText(`step 2 of ${n}`);
  await expect(page.getByTestId('finish-today')).toBeVisible();
  await page.getByTestId('today-next').click();
  await expect(page.getByTestId('session-strip')).toContainText(`Today · step 2 of ${n}`);
  await sing(page);
  if (n > 2) {
    await page.getByTestId('finish-today').click();
  } else {
    await expect(page.getByTestId('today-finish')).toContainText('Finish for today');
    await page.getByTestId('today-finish').click();
  }
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('today-done')).toContainText('Today done ✓');
  await expect(page.getByTestId('greeting')).toContainText('Gut gemacht');
  await expect(page.getByTestId('what-moved')).toContainText('Level 1 · slow ✓');
  await expect(page.getByTestId('practise-more')).toBeVisible();
  // Outside the session: no strip.
  await page.getByTestId('piece-row').first().click();
  await page.getByTestId('passage-row').first().click();
  await page.getByTestId('passage-sheet').getByRole('button', { name: /Level 1/ }).first().click();
  await expect(page.getByTestId('prerun')).toBeVisible();
  await expect(page.getByTestId('session-strip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the week instead of a streak, and Your progress', async ({ page }) => {
  const day = 86_400_000;
  await seeded(page, '/#/', (now) => ({
    'sh:log': [3, 4].map((d) => ({ at: now - d * day, pieceId: 'warmup-chorale', partId: 'P2', sectionId: 'x', level: 1, step: 'slow', accuracy: 0.8, score: 1, passed: false, durationSec: 120 })),
  }));
  const week = page.getByTestId('week-card');
  await expect(week).toContainText('goal 4');
  await expect(page.getByText(/day streak/)).toHaveCount(0);
  await week.getByTestId('see-progress').click();
  await expect(page).toHaveURL(/#\/progress$/);
  await expect(page.getByRole('heading', { name: 'Your progress' })).toBeVisible();
  await expect(page.getByTestId('last-weeks').locator('.wkrow:not(.head)')).toHaveCount(5);
  await expect(page.getByTestId('your-pieces')).toContainText('Abendlied');
  // The goal is set in Settings.
  await page.goto('/#/settings');
  await page.getByTestId('settings-week-goal').getByRole('button', { name: '3 days a week' }).click();
  await page.goto('/#/');
  await expect(page.getByTestId('week-card')).toContainText('goal 3');
});

test('the day after rehearsal: I was there, what felt shaky goes into today’s plan', async ({ page }) => {
  const yesterday = new Date(Date.now() - 86_400_000).getDay();
  await seeded(page, '/#/', (now) => ({
    'sh:cycle': { name: 'This cycle', pieceIds: ['warmup-chorale'], rehearsalWeekday: yesterday, rehearsalTime: '19:30', focusPieceIds: ['warmup-chorale'] },
    'sh:log': [{ at: now - 2 * 86_400_000, pieceId: 'warmup-chorale', partId: 'P2', sectionId: 'x', level: 1, step: 'slow', accuracy: 0.8, score: 1, passed: false }],
  }));
  const check = page.getByTestId('rehearsal-check');
  await expect(check).toContainText('How was rehearsal?');
  await check.getByTestId('rehearsal-attended').click();
  const chip = check.getByTestId('shaky-chip').last();
  const label = (await chip.innerText()).trim();
  await chip.click();
  await check.getByTestId('rehearsal-done').click();
  await expect(page.getByTestId('rehearsal-check')).toHaveAttribute('data-state', 'answered');
  await expect(page.getByTestId('rehearsal-check')).toContainText(`You said: ${label}`);
  await expect(page.getByTestId('plan-step').first()).toContainText('You said it felt shaky');
  // The rehearsal counts for the week (yesterday and the day before, when they are in this week).
  const monday = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() - 12 * 3600e3; })();
  const inWeek = [1, 2].filter((k) => Date.now() - k * 86_400_000 >= monday).length;
  await expect(page.getByTestId('week-count')).toContainText(`${inWeek} day${inWeek === 1 ? '' : 's'}`);
});

test('after a break: welcome back, a short restart, nothing lost', async ({ page }) => {
  await seeded(page, '/#/', (now) => ({
    'sh:log': [{ at: now - 10 * 86_400_000, pieceId: 'warmup-chorale', partId: 'P2', sectionId: 'x', level: 1, step: 'slow', accuracy: 0.8, score: 1, passed: false }],
  }));
  await expect(page.getByTestId('greeting')).toContainText('Welcome back, Clara');
  await expect(page.getByTestId('plan-card')).toHaveAttribute('data-mode', 'welcome');
  await expect(page.getByTestId('plan-card')).toContainText('Your usual plan returns tomorrow');
  await expect(page.getByText(/streak/i)).toHaveCount(0);
});
