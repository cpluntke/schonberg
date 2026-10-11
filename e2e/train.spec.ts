import { test, expect, type Page } from '@playwright/test';

// The Intonation tab and the intonation courses (docs/INTONATION.md): courses for every singer, a course's
// page, a step, step done, the course done with its quick check, the drone, the leap drill's results.

const PROFILE = { name: 'Clara Weber', voice: 'A', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, latencySource: 'measured', onboarded: true, leaderboardOptIn: false, headphones: true, displayMigrated: true, scoreDefaultMigrated: true };

const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DAY = 86_400_000;

async function seeded(page: Page, url: string, lab?: (now: number) => unknown) {
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Your pieces' })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(({ profile, lab }) => {
    localStorage.setItem('sh:profile', JSON.stringify(profile));
    if (lab) localStorage.setItem('sh:intonation', JSON.stringify(lab));
  }, { profile: PROFILE, lab: lab ? lab(Date.now()) : null });
  await page.goto(url);
  await page.reload();
}

test('courses for every singer: Train, a course page, its first step; no warm-up until a course is started', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await seeded(page, '/#/tune');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Intonation');
  await expect(page.getByTestId('train-lab')).toHaveCount(0);
  const card = page.getByTestId('train-course-fifth');
  await expect(card).toContainText('Pure fifth');
  await expect(card).toContainText('Start: Listen');
  await expect(page.getByTestId('train-all-courses')).toContainText('All courses (2)');
  // Today doesn't grow for a singer who hasn't started a course (and whose choir doesn't recommend one).
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today' }).click();
  await expect(page.getByTestId('plan-card')).toBeVisible();
  await expect(page.getByTestId('plan-card')).not.toContainText('Warm-up');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Intonation' }).click();

  await page.getByTestId('train-course-fifth').click();
  await expect(page).toHaveURL(/#\/intonation\/fifth$/);
  const ladder = page.getByTestId('lab-ladder');
  await expect(ladder).toContainText('Make the open fifth stand still.');
  await expect(ladder).toContainText('5 steps · about 25 min · one step a day');
  await expect(page.getByTestId('lab-rung-1')).toContainText('To pass: 5 of your last 6 answers right');
  await expect(page.getByTestId('lab-rung-2')).toBeDisabled();
  await expect(page.getByTestId('lab-rung-4')).toContainText('Sing it by ear');
  await page.getByTestId('lab-cent').click();
  await expect(page.getByRole('note')).toContainText('hundredth of a semitone');
  await page.getByTestId('lab-demo-pure').click();
  await expect(page.getByTestId('lab-demo-pure')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main .btn.primary')).toHaveCount(1);
  await expect(page.getByTestId('lab-continue')).toContainText('Start: Listen');
  await page.getByTestId('lab-continue').click();
  await expect(page.getByTestId('lab-listen')).toBeVisible();
  await page.getByTestId('lab-check').click();
  await expect(page.getByTestId('lab-tries')).toContainText('Right answers');
  await expect(page.getByTestId('lab-tries')).toContainText('6 more to pass');
  await page.getByTestId('lab-chord-A').click();
  await page.getByTestId('lab-chord-B').click();
  await page.getByTestId('lab-answer-A').click();
  await expect(page.getByTestId('lab-quiz-feedback')).toBeVisible();
  await expect(page.getByTestId('lab-tries')).toContainText('more to pass');
  // Started: the course is active on Train, and Today has its warm-up.
  await page.goto('/#/tune');
  await expect(page.getByTestId('train-course-fifth')).toContainText('step 1 of 5');
  await expect(page.getByTestId('train-lab')).toContainText('Pure fifth · step 1 of 5');
  await page.goto('/#/');
  await expect(page.getByTestId('plan-card')).toContainText('Warm-up · the pure fifth');
  expect(errors).toEqual([]);
});

test('a step done: the quiet card, back to Train; the next step waits for tomorrow; tuning by hand speaks in words', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await seeded(page, '/#/intonation/fifth/1', (now) => ({ fifth: { rung: 1, logs: { 1: [0, 0, 0, 0, 0] }, at: now - DAY }, third: { rung: 1, logs: {} } }));
  await page.getByTestId('lab-check').click();
  await page.getByTestId('lab-chord-A').click();
  await page.getByTestId('lab-chord-B').click();
  // (5 right of the last 5: either answer passes)
  await page.getByTestId('lab-answer-B').click();
  const done = page.getByTestId('lab-passed');
  await expect(done).toContainText('Step 1 done ✓');
  await expect(done).toContainText('Pure fifth · 5 of your last 6 answers right');
  await expect(done).toContainText('Step 2 of the course waits for tomorrow.');
  await done.getByTestId('lab-to-train').click();
  await expect(page).toHaveURL(/#\/tune$/);
  // One step a day: no warm-up now; the course shows its next step.
  await expect(page.getByTestId('train-lab')).toHaveCount(0);
  await expect(page.getByTestId('train-course-fifth')).toContainText('Tune it by hand · 5 min');
  await page.getByTestId('train-course-fifth').click();
  await expect(page.getByTestId('lab-rung-1')).toContainText('done today');
  await expect(page.getByTestId('lab-rung-2')).toContainText('tomorrow · 5 min');

  await page.getByTestId('lab-rung-2').click();
  await expect(page.getByTestId('lab-goal')).toHaveText('Move sol until the pulse stops.');
  await page.getByTestId('lab-start').click();
  await page.getByTestId('lab-lock').click();
  await expect(page.getByTestId('lab-feel')).toHaveText(/^(Still|Almost still|Pulsing|Fast buzz) · (pure|(a touch|a little|clearly) (high|low) \(\d+ cents?\))$/);
  await expect(page.getByTestId('lab-tries')).toContainText('Pure tunings');
  expect(errors).toEqual([]);
});

test('course complete: what you can do now, the quick check a week later (Train offers it on its day), use it in your music', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const fifth = (now: number, due: string) => ({ rung: 6, logs: { 5: [1, 2, 1] }, passed: { 1: dayOf(now - 10 * DAY), 5: dayOf(now - 6 * DAY) }, at: now - 6 * DAY, review: { due } });
  await seeded(page, '/#/intonation/fifth/done', (now) => ({ fifth: fifth(now, dayOf(now + DAY)), third: { rung: 1, logs: {} } }));
  const page6 = page.getByTestId('lab-course-done');
  await expect(page6).toContainText('You can hear a pure fifth');
  await expect(page6).toContainText('Sing sol so it locks onto do, by ear, with no picture.');
  await expect(page.getByTestId('lab-review')).toContainText('Quick check tomorrow');
  await expect(page.getByTestId('lab-use-it')).toContainText('the open fifths');
  await expect(page.getByTestId('lab-sing-spot')).toContainText(/Sing .+ bars? .+ slowly$/);
  await expect(page.getByTestId('lab-next-course')).toContainText('Start step 1: Listen');

  // On its day: Train's warm-up is the quick check.
  await seeded(page, '/#/tune', (now) => ({ fifth: fifth(now, dayOf(now)), third: { rung: 1, logs: {} } }));
  await expect(page.getByTestId('train-lab')).toContainText('Pure fifth · quick check');
  await page.getByTestId('train-lab-go').click();
  await expect(page).toHaveURL(/#\/intonation\/fifth\/check$/);
  await expect(page.getByTestId('lab-check-screen')).toBeVisible();
  await expect(page.getByTestId('lab-tries')).toContainText('Holds');
  await expect(page.getByTestId('lab-tries')).toContainText('3 to go');
  expect(errors).toEqual([]);
});

test('the drone and all courses', async ({ page }) => {
  await seeded(page, '/#/tune');
  await page.getByTestId('train-drone').click();
  await expect(page).toHaveURL(/#\/drone$/);
  const note = await page.getByTestId('drone-note').innerText();
  await page.getByTestId('drone-higher').click();
  await expect(page.getByTestId('drone-note')).not.toHaveText(note);
  await page.getByTestId('drone-fifth').click();
  await page.getByTestId('drone-toggle').click();
  await expect(page.getByTestId('drone-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('drone-toggle').click();
  await expect(page.getByTestId('drone-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByTestId('train-all-courses').click();
  await expect(page.getByTestId('course-fifth')).toContainText('not started');
  await expect(page.getByTestId('course-third')).toContainText('Pure major third');
});

test('the leap drill: results lead with what landed, last time, and the leap to practise', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/');
  await expect(page.getByRole('heading', { name: 'Your pieces' })).toBeVisible({ timeout: 20_000 });
  await page.evaluate((profile) => localStorage.setItem('sh:profile', JSON.stringify(profile)), PROFILE);
  await page.goto('/?simulate=perfect#/train');
  await page.reload();
  await page.getByTestId('train-leaps-go').click();
  await expect(page.getByTestId('prerun')).toBeVisible();
  const hp = page.getByTestId('hp-yes');
  if (await hp.isVisible()) await hp.click();
  await page.getByTestId('start').click();
  const res = page.getByTestId('leap-results');
  await expect(res).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('drill-verdict')).toContainText(/(\d+) of \1 leaps landed/);
  await expect(page.getByTestId('leaps-last')).toContainText('Your first go');
  await expect(page.locator('main .btn.primary')).toHaveCount(1);
  await page.getByTestId('leap-back').click();
  await expect(page).toHaveURL(/#\/train$/);
  await expect(page.getByTestId('train-leaps-go')).toContainText(/last time (\d+) of \1/);
  expect(errors).toEqual([]);
});

test("inside today's session: the course step is the warm-up; step done leads to today's next step", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await seeded(page, '/?simulate=perfect#/', (now) => ({ fifth: { rung: 1, logs: { 1: [0, 0, 0, 0, 0] }, at: now - DAY }, third: { rung: 1, logs: {} } }));
  await expect(page.getByTestId('plan-step').first()).toContainText('Warm-up · the pure fifth');
  await page.getByTestId('start-today').click();
  await expect(page).toHaveURL(/#\/intonation\/fifth\/1$/);
  await expect(page.getByTestId('session-strip')).toContainText('Today · step 1 of');
  await page.getByTestId('lab-check').click();
  await page.getByTestId('lab-chord-A').click();
  await page.getByTestId('lab-chord-B').click();
  await page.getByTestId('lab-answer-A').click();
  const done = page.getByTestId('lab-passed');
  await expect(done).toContainText('Step 1 done ✓');
  await expect(done.getByTestId('today-next')).toContainText('Next:');
  await expect(done.getByTestId('today-next')).toContainText('step 2 of');
  await expect(done.getByTestId('finish-today')).toBeVisible();
  await done.getByTestId('lab-keep').click();
  await expect(page.getByTestId('lab-passed')).toHaveCount(0);
  await expect(page.getByTestId('session-strip')).toContainText('1 of');
  expect(errors).toEqual([]);
});
