import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test';
import path from 'node:path';

// Insights end to end against the Flask server: members share progress (and their ranges); the alto
// section lead sees aggregates only (counts only under 3 singers) and each alto's range by name; the
// choir admin sees S | A | T | B side by side; a run's anonymous usage summary reaches the super
// admin's Usage insights. SH_SHOTS=<dir> saves screenshots at 390×844 and 1280×800.
const shots = process.env.SH_SHOTS ?? '';
const SUPER = process.env.SH_SUPER ?? 'super-secret-pw';
const PIECES = ['debussy-dieu', 'bruckner-locus-iste'];
const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];

async function shoot(page: Page, name: string) {
  if (!shots) return;
  for (const s of SIZES) {
    await page.setViewportSize(s);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shots, `${name}-${s.width}.png`), fullPage: true });
  }
  await page.setViewportSize(SIZES[0]);
}
async function shootEl(page: Page, testId: string, name: string) {
  if (!shots) return;
  for (const s of SIZES) {
    await page.setViewportSize(s);
    await page.waitForTimeout(250);
    await page.getByTestId(testId).first().scrollIntoViewIfNeeded();
    await page.getByTestId(testId).first().screenshot({ path: path.join(shots, `${name}-${s.width}.png`) });
  }
  await page.setViewportSize(SIZES[0]);
}

async function setupChoir(request: APIRequestContext, code: string) {
  const r = await request.post('./api/super/choirs', { data: { code, name: 'Kammerchor Insights' }, headers: { 'X-Super-Admin': SUPER } });
  expect(r.status()).toBe(201);
  const admin = await (await request.post('./api/invites/accept', { data: { token: (await r.json()).token, name: 'Clara', password: 'password-123' } })).json();
  const auth = { Authorization: `Bearer ${admin.token}` };
  // The pieces come from the choir library (members' phones get the scores with the choir sync).
  for (const id of PIECES) expect((await request.post(`./api/choirs/${code}/library/${id}`, { data: {}, headers: auth })).status()).toBe(200);
  expect((await request.put(`./api/choirs/${code}/cycle`, { data: { name: 'Autumn', pieceIds: PIECES, rehearsalWeekday: 3, rehearsalTime: '19:30' }, headers: auth })).status()).toBe(200);
  const inv = await (await request.post(`./api/choirs/${code}/invites`, { data: { role: 'lead', voices: ['A'] }, headers: auth })).json();
  expect((await request.post('./api/invites/accept', { data: { token: inv.token, name: 'Lena', password: 'password-123' } })).status()).toBe(201);
}

/** One member shares progress (bars: measure index → 0..1) and her range. */
async function share(request: APIRequestContext, code: string, name: string, voice: string, level: number, readiness: number,
  weak: number[], range?: { lo: number; hi: number; reachLo?: number; reachHi?: number }) {
  const bars: Record<string, number> = {};
  for (let m = 0; m < 24; m++) bars[String(m)] = weak.includes(m) ? 0.3 + (name.length % 3) * 0.05 : 0.85;
  const pieces = Object.fromEntries(PIECES.map((id, i) => [id, { readiness: Math.max(0, readiness - i * 0.15), level: Math.max(0, level - i), bars }]));
  const r = await request.put(`./api/choirs/${code}/progress/${encodeURIComponent(name)}`, {
    data: { voice, pieces, ...(range ? { range: { ...range, at: Date.now() - 3 * 86400000 } } : {}) },
    headers: { 'X-Member-Token': `e2e-token-of-${name}-0123456789` },
  });
  expect(r.status()).toBe(200);
}

async function loggedIn(browser: Browser, code: string, name: string, voice: string, ip?: string) {
  // `ip`: a phone of its own for the server's per-client rate limits (they see CF-Connecting-IP).
  const ctx = await browser.newContext({ viewport: SIZES[0], ...(ip ? { extraHTTPHeaders: { 'CF-Connecting-IP': ip } } : {}) });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./#/');
  await page.evaluate(([v]) => {
    localStorage.setItem('shm:usageStats', 'off');
    localStorage.setItem('sh:profile', JSON.stringify({ name: '', voice: v, notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, onboarded: true, leaderboardOptIn: false }));
  }, [voice]);
  await page.goto('./#/choir');
  await page.getByLabel('Choir code').fill(code);
  await page.getByTestId('join-choir').click();
  await expect(page.getByTestId('choir-card')).toBeVisible();
  await page.getByTestId('login-name').fill(name);
  await page.getByTestId('login-password').fill('password-123');
  await page.getByTestId('login').click();
  await expect(page.getByTestId('account-name')).toHaveText(name);
  return { page, errors };
}

test('lead sees aggregates and ranges; admin sees S|A|T|B; usage reaches the super admin', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const code = `ins${Date.now() % 100000}`;
  await setupChoir(request, code);

  // ---- two altos share: the lead sees counts only (and both ranges by name)
  await share(request, code, 'Anna', 'A', 3, 0.72, [5, 6], { lo: 55, hi: 74, reachLo: 53, reachHi: 77 });
  await share(request, code, 'Bea', 'A', 1, 0.35, [5, 6, 12], { lo: 57, hi: 69, reachLo: 55, reachHi: 71 });
  const lead = await loggedIn(browser, code, 'Lena', 'A');
  await lead.page.goto('./#/section');
  await expect(lead.page.getByTestId('section-summary')).toContainText('2 singers sharing');
  await expect(lead.page.getByTestId('small-group').first()).toContainText('3 or more singers');
  await expect(lead.page.getByTestId('range-row')).toHaveCount(2);
  await expect(lead.page.locator('main')).not.toContainText('level 1 ·');
  await shoot(lead.page, 'lead-2-singers');

  // ---- more altos (one without a range check): distributions, hardest bars, the range chart
  await share(request, code, 'Cleo', 'A', 2, 0.5, [5, 6, 12], { lo: 53, hi: 72 });
  await share(request, code, 'Dora', 'A', 4, 0.9, [12]);
  await share(request, code, 'Eva Marie', 'A', 2, 0.55, [5, 6], { lo: 58, hi: 67 });
  await lead.page.reload();
  await expect(lead.page.getByTestId('section-summary')).toContainText('5 singers sharing');
  const first = lead.page.getByTestId('section-piece').first();
  await expect(first).toContainText('rehearsal-ready');
  await expect(first).toContainText(/Hardest for the section: bar \d+/);
  await expect(first.getByTestId('loop-hardest').first()).toBeVisible();
  // No names next to progress: only in the range chart.
  for (const n of ['Anna', 'Bea', 'Cleo', 'Dora']) await expect(lead.page.getByTestId('section-piece').filter({ hasText: n })).toHaveCount(0);
  await expect(lead.page.getByTestId('range-row')).toHaveCount(5);
  await expect(lead.page.getByTestId('range-row').last()).toContainText('not measured');
  await expect(lead.page.getByTestId('range-chart-A')).toContainText('above steady range');
  await shoot(lead.page, 'lead-view');
  await shootEl(lead.page, 'section-ranges', 'lead-range-chart');
  // "Loop these bars" opens a loop on the practice screen.
  await first.getByTestId('loop-hardest').first().click();
  await expect(lead.page).toHaveURL(/#\/play\/.*\/drill\?/);

  // ---- other sections; the admin sees S | A | T | B and every section's ranges
  for (const [n, v, lvl, r, rng] of [
    ['Sara', 'S', 4, 0.9, { lo: 60, hi: 81 }], ['Sofie', 'S', 3, 0.8, { lo: 62, hi: 79 }], ['Svea', 'S', 3, 0.75, { lo: 59, hi: 77, reachLo: 57, reachHi: 82 }],
    ['Tom', 'T', 1, 0.3, { lo: 48, hi: 64, reachLo: 46, reachHi: 67 }], ['Theo', 'T', 2, 0.4, { lo: 50, hi: 67 }], ['Till', 'T', 1, 0.25, undefined],
    ['Ben', 'B', 3, 0.7, { lo: 40, hi: 60 }], ['Bruno', 'B', 2, 0.6, { lo: 43, hi: 62 }],
  ] as const) await share(request, code, n, v, lvl, r, v === 'T' ? [3, 4, 9, 10] : [7], rng);
  const admin = await loggedIn(browser, code, 'Clara', 'S');
  await admin.page.goto('./#/choirinsights');
  const piece = admin.page.getByTestId('choir-piece').first();
  for (const v of ['S', 'A', 'T', 'B']) await expect(piece.getByTestId(`col-${v}`)).toBeVisible();
  await expect(piece.getByTestId('col-T')).toContainText('needs time');
  await expect(piece.getByTestId('col-B')).toContainText('counts only');
  await expect(admin.page.getByTestId('needs-time')).toContainText('Tenor');
  for (const n of ['Sara', 'Tom', 'Anna']) await expect(admin.page.getByTestId('choir-piece').filter({ hasText: n })).toHaveCount(0);
  await expect(admin.page.getByTestId('choir-ranges').getByTestId('range-row')).toHaveCount(5 + 3 + 3 + 2);
  await admin.page.getByTestId('ranges-toggle-A').click();
  await expect(admin.page.getByTestId('range-chart-A')).toHaveCount(0);
  await admin.page.getByTestId('ranges-toggle-A').click();
  await shoot(admin.page, 'admin-view');
  await shootEl(admin.page, 'choir-ranges', 'admin-range-charts');
  // The lead can't open the admin view's data.
  expect((await request.get(`./api/choirs/${code}/insights`)).status()).toBe(401);
  // A member's own account opening the staff pages by address: who they're for, not "section lead".
  expect((await request.post(`./api/choirs/${code}/members`, { data: { name: 'Mia', password: 'password-123' } })).status()).toBe(201);
  const mia = await loggedIn(browser, code, 'Mia', 'A', '10.9.9.9');
  for (const h of ['#/section', '#/choiradmin']) {
    await mia.page.goto(`./${h}`);
    await expect(mia.page.getByTestId('staff-only')).toContainText('for section leads and choir admins');
    await expect(mia.page.locator('main')).not.toContainText(/a section lead\b|Section lead ·/);
  }
  await shoot(mia.page, 'member-on-section');

  // ---- usage statistics: a real run on a phone, its summary sent the next day
  const yesterday = async () => {
    const m = await (await request.get('./api/super/metrics?days=3', { headers: { 'X-Super-Admin': SUPER } })).json();
    const y = m.days[m.days.length - 2];
    return [y.installs ?? 0, y.c['run.section.L1'] ?? 0, y.c['onb.first_run'] ?? 0];
  };
  const before = await yesterday();
  const ctx = await browser.newContext({ viewport: SIZES[0] });
  const phone = await ctx.newPage();
  await phone.goto('./#/');
  await phone.evaluate(() => localStorage.setItem('sh:profile', JSON.stringify({ name: 'X', voice: 'A', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, latencySource: 'measured', onboarded: true, leaderboardOptIn: false })));
  await phone.goto('./?simulate=perfect#/');
  await expect(phone.getByRole('heading', { name: 'Your pieces' })).toBeVisible({ timeout: 30_000 });
  await phone.getByTestId('piece-row').first().click();
  await phone.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click();
  await phone.getByTestId('hp-yes').click(); // level 1 counts with headphones on
  await phone.getByTestId('start').click();
  await expect(phone.getByTestId('pass-banner')).toContainText(/level 1 reached|Passed/, { timeout: 120_000 });
  const today = await phone.evaluate(() => JSON.parse(localStorage.getItem('shm:usage')!));
  const day = Object.keys(today.days)[0];
  expect(today.days[day]['run.section.L1']).toBe(1);
  expect(today.days[day]['onb.first_run']).toBe(1);
  // Pretend that was yesterday: the next start sends it (once).
  const posted = phone.waitForRequest((r) => r.url().endsWith('/api/metrics') && r.method() === 'POST');
  await phone.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('shm:usage')!);
    const t = new Date(Date.now() - 86400000);
    const y = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    d.days = { [y]: Object.values(d.days)[0] };
    localStorage.setItem('shm:usage', JSON.stringify(d));
  });
  await phone.reload();
  const req = await posted;
  const body = req.postDataJSON();
  expect(body.id).toMatch(/^[0-9a-f]{32}$/);
  expect(JSON.stringify(body)).not.toContain('"X"');
  // The server added it to yesterday's totals (sent once: a resend the next day would be ignored).
  await expect.poll(yesterday).toEqual(before.map((x) => x + 1));

  const sup = await (await browser.newContext({ viewport: SIZES[0] })).newPage();
  await sup.goto('./#/superadmin');
  await sup.getByLabel('Super-admin password').fill(SUPER);
  await sup.getByRole('button', { name: 'Continue' }).click();
  await sup.getByTestId('open-usage').click();
  await expect(sup.getByTestId('usage-tiles')).toContainText('Daily actives (yesterday)');
  await expect(sup.getByTestId('usage-tiles').locator('.stat').first().locator('.v')).toHaveText(String(before[0] + 1));
  await expect(sup.getByTestId('usage-modes')).toContainText('Sections');
  await expect(sup.getByTestId('usage-funnel')).toContainText('First run');
  await shoot(sup, 'super-usage');
  const dl = sup.waitForEvent('download');
  await sup.getByTestId('usage-csv').click();
  expect((await dl).suggestedFilename()).toMatch(/^schonberg-usage-.*\.csv$/);

  expect([...lead.errors, ...admin.errors, ...mia.errors]).toEqual([]);
});
