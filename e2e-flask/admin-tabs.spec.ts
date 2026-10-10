import { test, expect, request as pwRequest, type Page, type Browser, type APIRequestContext } from '@playwright/test';
import path from 'node:path';

// The Admin tab end to end against the Flask server: a member sees none; a section lead sees
// "Section" with only their sections (switching voices); a choir admin sees Choir + Sections; the
// super admin logs in once, sees Choirs + Usage, stays logged in over a reload and logs out; an admin
// who is also the super admin sees all four. SH_SHOTS=<dir> saves screenshots at 390×844, 320×568
// and 1280×800.
const shots = process.env.SH_SHOTS ?? '';
const SUPER = process.env.SH_SUPER ?? 'super-secret-pw';
const SIZES = [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1280, height: 800 }];
const PW = 'password-123';

async function shoot(page: Page, name: string, sizes = SIZES) {
  for (const s of sizes) {
    await page.setViewportSize(s);
    await page.waitForTimeout(250);
    // Nothing wider than the phone: no sideways scrolling, every bottom tab on screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(s.width);
    for (const b of await page.locator('nav.nav button').all()) {
      const box = await b.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= s.width + 0.5).toBeTruthy();
    }
    if (shots) await page.screenshot({ path: path.join(shots, `${name}-${s.width}.png`), fullPage: true });
  }
  await page.setViewportSize(SIZES[0]);
}

let code = '';
let api: APIRequestContext;

test.beforeAll(async () => {
  api = await pwRequest.newContext({ baseURL: process.env.SH_FLASK_URL ?? 'http://127.0.0.1:5340/schonberg/', extraHTTPHeaders: { 'CF-Connecting-IP': '10.70.0.1' } });
  code = `adm${Date.now() % 100000}`;
  const r = await api.post('./api/super/choirs', { data: { code, name: 'Kammerchor Admin' }, headers: { 'X-Super-Admin': SUPER } });
  expect(r.status()).toBe(201);
  const admin = await (await api.post('./api/invites/accept', { data: { token: (await r.json()).token, name: 'Clara', password: PW } })).json();
  const auth = { Authorization: `Bearer ${admin.token}` };
  expect((await api.post(`./api/choirs/${code}/library/debussy-dieu`, { data: { programme: true }, headers: auth })).status()).toBe(200);
  const inv = await (await api.post(`./api/choirs/${code}/invites`, { data: { role: 'lead', voices: ['A', 'T'] }, headers: auth })).json();
  expect((await api.post('./api/invites/accept', { data: { token: inv.token, name: 'Lena', password: PW } })).status()).toBe(201);
  expect((await api.post(`./api/choirs/${code}/members`, { data: { name: 'Mia', password: PW } })).status()).toBe(201);
  // A few altos share progress, so the lead's and admin's views have something to show.
  for (const [n, lvl, weak] of [['Anna', 3, [5, 6]], ['Bea', 1, [5, 6, 12]], ['Cleo', 2, [12]]] as const) {
    const bars: Record<string, number> = {};
    for (let m = 0; m < 20; m++) bars[String(m)] = (weak as readonly number[]).includes(m) ? 0.3 : 0.85;
    const put = await api.put(`./api/choirs/${code}/progress/${n}`, {
      data: { voice: 'A', pieces: { 'debussy-dieu': { readiness: 0.3 + lvl * 0.15, level: lvl, bars } }, range: { lo: 55 + lvl, hi: 72 + lvl, at: Date.now() - 86400000 } },
      headers: { 'X-Member-Token': `e2e-admin-tabs-${n}-0123456789` },
    });
    expect(put.status()).toBe(200);
  }
});

test.afterAll(async () => {
  await api.delete(`./api/super/choirs/${code}`, { headers: { 'X-Super-Admin': SUPER } });
  await api.dispose();
});

async function phone(browser: Browser, ip: string, voice = 'A') {
  const ctx = await browser.newContext({ viewport: SIZES[0], extraHTTPHeaders: { 'CF-Connecting-IP': ip } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./#/');
  await page.evaluate(([v]) => {
    localStorage.setItem('shm:usageStats', 'off');
    localStorage.setItem('sh:profile', JSON.stringify({ name: '', voice: v, notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, onboarded: true, leaderboardOptIn: false }));
  }, [voice]);
  return { ctx, page, errors };
}

async function joinAndLogin(page: Page, name: string | null) {
  await page.goto('./#/choir');
  await page.getByLabel('Choir code').fill(code);
  await page.getByTestId('join-choir').click();
  await expect(page.getByTestId('choir-card')).toBeVisible();
  if (!name) return;
  await page.getByTestId('login-name').fill(name);
  await page.getByTestId('login-password').fill(PW);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('account-name')).toHaveText(name);
}

async function superLogin(page: Page) {
  await page.getByLabel('Super-admin password').fill(SUPER);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('create-choir')).toBeVisible();
}

const tabs = (page: Page) => page.getByTestId('admin-tabs').getByRole('button');

test('a member sees no Admin tab and reaches no staff data', async ({ browser }) => {
  const m = await phone(browser, '10.70.1.1');
  await joinAndLogin(m.page, 'Mia');
  await m.page.goto('./#/');
  await expect(m.page.locator('nav.nav button')).toHaveCount(4);
  await expect(m.page.getByTestId('nav-admin')).toHaveCount(0);
  await m.page.goto('./#/choiradmin');
  await expect(m.page.getByTestId('staff-only')).toBeVisible();
  await expect(m.page.getByTestId('nav-admin')).toHaveCount(0);
  await expect(m.page.getByTestId('admin-tabs')).toHaveCount(0);
  await expect(m.page.getByTestId('programme-editor')).toHaveCount(0);
  // Settings: nothing of the super admin for a member (its login is in Diagnostics, or #/superadmin).
  await m.page.goto('./#/settings');
  await expect(m.page.getByTestId('settings-super-link')).toHaveCount(0);
  await expect(m.page.getByTestId('settings-super')).toHaveCount(0);
  await shoot(m.page, 'member-settings', [SIZES[1]]);
  expect(m.errors).toEqual([]);
  await m.ctx.close();
});

test('a section lead sees "Section" with only their sections, switching voices', async ({ browser }) => {
  const l = await phone(browser, '10.70.2.1');
  await joinAndLogin(l.page, 'Lena');
  await l.page.goto('./#/');
  await expect(l.page.getByTestId('nav-admin')).toHaveText('Section');
  await l.page.getByTestId('nav-admin').click();
  await expect(l.page).toHaveURL(/#\/section$/);
  await expect(l.page.getByRole('heading', { level: 1 })).toHaveText('Section');
  await expect(l.page.getByTestId('nav-admin')).toHaveAttribute('aria-current', 'page');
  await expect(l.page.getByTestId('admin-tabs')).toHaveCount(0); // one sub-tab only: no row
  // Everything a lead has: progress, hardest bars with loops, ranges by name, the bar map, the trend note.
  await expect(l.page.getByTestId('section-summary')).toContainText('3 singers sharing');
  await expect(l.page.getByTestId('section-ranges').getByTestId('range-row')).toHaveCount(3);
  const piece = l.page.getByTestId('section-piece').first();
  await expect(piece).toContainText('Hardest for the section');
  await expect(piece.getByTestId('loop-hardest').first()).toBeVisible();
  await expect(piece).toContainText(/trend shows from next week|since/);
  await shoot(l.page, 'lead-section-alto', SIZES);
  // Two voices: switch inside the sub-tab.
  const group = l.page.getByRole('group', { name: 'Section', exact: true });
  await group.getByRole('button', { name: 'Tenor' }).click();
  await expect(group.getByRole('button', { name: 'Tenor' })).toHaveAttribute('aria-pressed', 'true');
  await expect(l.page.locator('main')).toContainText('Nobody in this section shares');
  await shoot(l.page, 'lead-section-tenor', SIZES.slice(0, 2));
  await group.getByRole('button', { name: 'Alto' }).click();
  await expect(l.page.getByTestId('section-summary')).toBeVisible();
  // The admin's and the super admin's sub-tabs stay out of reach.
  await l.page.goto('./#/choiradmin');
  await expect(l.page.getByTestId('programme-editor')).toHaveCount(0);
  await expect(l.page.locator('main')).toContainText('Only choir admins can change');
  await l.page.goto('./#/choirinsights');
  await expect(l.page.getByTestId('choir-summary')).toHaveCount(0);
  await expect(l.page.getByTestId('section-summary')).toBeVisible();
  await l.page.goto('./#/usage');
  await expect(l.page.locator('main')).toContainText('Log in as super admin first');
  await l.page.goto('./#/superadmin');
  await expect(l.page.getByLabel('Super-admin password')).toBeVisible();
  await expect(l.page.getByTestId('choir-row')).toHaveCount(0);
  // …and so does their data on the server.
  const tok = await l.page.evaluate(() => JSON.parse(localStorage.getItem('schonberg:session') ?? '{}').token as string);
  const auth = { Authorization: `Bearer ${tok}` };
  expect((await api.get(`./api/choirs/${code}/insights`, { headers: auth })).status()).toBe(403);
  expect((await api.get(`./api/choirs/${code}/people`, { headers: auth })).status()).toBe(403);
  expect((await api.get(`./api/choirs/${code}/insights/S`, { headers: auth })).status()).toBe(403);
  expect((await api.get('./api/super/choirs', { headers: auth })).status()).toBe(401);
  expect((await api.get('./api/super/metrics', { headers: auth })).status()).toBe(401);
  expect(l.errors).toEqual([]);
  await l.ctx.close();
});

test('a choir admin sees Choir and Sections; the last sub-tab is remembered', async ({ browser }) => {
  const a = await phone(browser, '10.70.3.1', 'S');
  await joinAndLogin(a.page, 'Clara');
  await a.page.goto('./#/');
  await expect(a.page.getByTestId('nav-admin')).toHaveText('Admin');
  await a.page.getByTestId('nav-admin').click();
  await expect(a.page.getByRole('heading', { level: 1 })).toHaveText('Admin');
  await expect(tabs(a.page)).toHaveText(['Choir', 'Sections']);
  await expect(a.page.getByTestId('admin-tab-choir')).toHaveAttribute('aria-pressed', 'true');
  await expect(a.page.getByTestId('programme-editor')).toBeVisible();
  await expect(a.page.getByTestId('people-editor')).toBeVisible();
  await shoot(a.page, 'admin-choir');
  // The in-page link still works: "See the sections" opens the Sections sub-tab.
  await a.page.getByRole('button', { name: 'See the sections' }).click();
  await expect(a.page).toHaveURL(/#\/choirinsights$/);
  await expect(a.page.getByTestId('admin-tab-sections')).toHaveAttribute('aria-pressed', 'true');
  await expect(a.page.getByTestId('choir-summary')).toContainText('3 singers sharing');
  await shoot(a.page, 'admin-sections');
  // One section in detail, and back.
  await a.page.getByRole('button', { name: 'One section in detail (bar map)' }).click();
  await expect(a.page).toHaveURL(/#\/section$/);
  await expect(a.page.getByTestId('admin-tab-sections')).toHaveAttribute('aria-pressed', 'true');
  await a.page.getByRole('group', { name: 'Section', exact: true }).getByRole('button', { name: 'Alto' }).click();
  await expect(a.page.getByTestId('section-summary')).toBeVisible();
  await a.page.getByTestId('all-sections').click();
  await expect(a.page.getByTestId('choir-summary')).toBeVisible();
  // Remembered: Home, then the Admin tab opens Sections again (also after a reload).
  await a.page.getByRole('button', { name: 'Today', exact: true }).click();
  await a.page.reload();
  await a.page.getByTestId('nav-admin').click();
  await expect(a.page.getByTestId('admin-tab-sections')).toHaveAttribute('aria-pressed', 'true');
  await expect(a.page.getByTestId('admin-tab-choirs')).toHaveCount(0);
  await expect(a.page.getByTestId('admin-tab-usage')).toHaveCount(0);
  expect(a.errors).toEqual([]);
  await a.ctx.close();
});

test('the super admin logs in once, stays logged in over a reload, and logs out', async ({ browser }) => {
  const s = await phone(browser, '10.70.4.1');
  await s.page.goto('./#/');
  await expect(s.page.getByTestId('nav-admin')).toHaveCount(0);
  // The small link at the bottom of Diagnostics.
  await s.page.goto('./#/diagnostics');
  await s.page.getByTestId('settings-super-link').click();
  await expect(s.page).toHaveURL(/#\/superadmin$/);
  await expect(s.page.getByRole('heading', { level: 1 })).toHaveText('Super admin');
  await shoot(s.page, 'super-login', [SIZES[0], SIZES[1]]);
  await superLogin(s.page);
  await expect(s.page.getByTestId('nav-admin')).toHaveText('Admin');
  await expect(s.page.getByRole('heading', { level: 1 })).toHaveText('Admin');
  await expect(tabs(s.page)).toHaveText(['Choirs', 'Usage']);
  await expect(s.page.getByTestId('choir-row').filter({ hasText: code })).toBeVisible();
  // Only a token is kept: not the password, not in the backup file.
  const stored = await s.page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain(SUPER);
  const token = await s.page.evaluate(() => JSON.parse(localStorage.getItem('schonberg:superSession') ?? '{}').token as string);
  expect(token).toMatch(/^[\w-]{40,}$/);
  await shoot(s.page, 'super-choirs');
  // Reload: still logged in, no password asked.
  await s.page.reload();
  await expect(s.page.getByTestId('choir-row').filter({ hasText: code })).toBeVisible();
  await expect(s.page.getByLabel('Super-admin password')).toHaveCount(0);
  await s.page.getByTestId('admin-tab-usage').click();
  await expect(s.page).toHaveURL(/#\/usage$/);
  await expect(s.page.getByTestId('usage-tiles')).toBeVisible();
  await shoot(s.page, 'super-usage');
  // The "Usage insights" link in Choirs works too.
  await s.page.getByTestId('admin-tab-choirs').click();
  await s.page.getByTestId('open-usage').click();
  await expect(s.page.getByTestId('admin-tab-usage')).toHaveAttribute('aria-pressed', 'true');
  // A login the server rejects (as after a password change): the password prompt again, the tab goes.
  // (The app checks the login when it starts: the Admin tab goes before anything is opened.)
  await s.page.goto('./#/diagnostics');
  await s.page.evaluate(() => localStorage.setItem('schonberg:superSession', JSON.stringify({ token: 'x'.repeat(43), expiresAt: Date.now() + 86400000 })));
  await s.page.reload();
  await expect(s.page.getByTestId('settings-super-link')).toBeVisible();
  await s.page.getByTestId('settings-super-link').click();
  await expect(s.page.getByTestId('super-logged-out')).toContainText('Log in again');
  await expect(s.page.getByLabel('Super-admin password')).toBeVisible();
  await expect(s.page.getByTestId('nav-admin')).toHaveCount(0);
  // Log in again; log out from the Choirs sub-tab: the server forgets the session.
  await superLogin(s.page);
  const token2 = await s.page.evaluate(() => JSON.parse(localStorage.getItem('schonberg:superSession') ?? '{}').token as string);
  expect((await api.get('./api/super/session', { headers: { Authorization: `Bearer ${token2}` } })).status()).toBe(200);
  await s.page.getByTestId('super-logout').click();
  await expect(s.page.getByLabel('Super-admin password')).toBeVisible();
  await expect(s.page.getByTestId('nav-admin')).toHaveCount(0);
  expect(await s.page.evaluate(() => localStorage.getItem('schonberg:superSession'))).toBeNull();
  await expect.poll(async () => (await api.get('./api/super/choirs', { headers: { Authorization: `Bearer ${token2}` } })).status()).toBe(401);
  expect(await (await api.delete('./api/super/session', { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual({ ok: true }); // (replaced by hand above)
  // And from Settings.
  await superLogin(s.page);
  await s.page.goto('./#/settings');
  await expect(s.page.getByTestId('settings-super')).toContainText('Logged in as super admin');
  await s.page.getByTestId('settings-super-logout').click();
  await expect(s.page.getByTestId('settings-super')).toHaveCount(0);
  await s.page.goto('./#/diagnostics');
  await expect(s.page.getByTestId('settings-super-link')).toBeVisible();
  await expect(s.page.getByTestId('nav-admin')).toHaveCount(0);
  expect(s.errors).toEqual([]);
  await s.ctx.close();
});

test('an admin who is also the super admin sees all four sub-tabs', async ({ browser }) => {
  const a = await phone(browser, '10.70.5.1', 'S');
  await joinAndLogin(a.page, 'Clara');
  await a.page.goto('./#/superadmin');
  await superLogin(a.page);
  await expect(tabs(a.page)).toHaveText(['Choir', 'Sections', 'Choirs', 'Usage']);
  await expect(a.page.getByTestId('admin-tab-choirs')).toHaveAttribute('aria-pressed', 'true');
  await shoot(a.page, 'both-choirs');
  // The super admin's People and Library panels use the session too.
  const row = a.page.getByTestId('choir-row').filter({ hasText: code });
  await row.getByRole('button', { name: 'People' }).click();
  await expect(row).toContainText('Lena');
  await row.getByTestId('super-library').click();
  await expect(row.getByTestId('library-piece').first()).toBeVisible();
  await a.page.getByTestId('admin-tab-choir').click();
  await expect(a.page.getByTestId('programme-editor')).toBeVisible();
  await shoot(a.page, 'both-choir', [SIZES[1]]);
  await a.page.getByTestId('admin-tab-sections').click();
  await expect(a.page.getByTestId('choir-summary')).toBeVisible();
  await a.page.getByTestId('admin-tab-usage').click();
  await expect(a.page.getByTestId('usage-tiles')).toBeVisible();
  await shoot(a.page, 'both-usage', [SIZES[1]]);
  // Logging out of the choir account leaves the super admin's tabs (and the other way round).
  await a.page.getByTestId('admin-tab-choir').click();
  await a.page.getByTestId('logout-link').first().click();
  await expect(tabs(a.page)).toHaveText(['Choirs', 'Usage']);
  await a.page.getByTestId('admin-tab-choirs').click();
  await a.page.getByTestId('super-logout').click();
  await expect(a.page.getByTestId('nav-admin')).toHaveCount(0);
  expect(a.errors).toEqual([]);
  await a.ctx.close();
});
