import { test, expect, type Browser, type Page } from '@playwright/test';
import path from 'node:path';

// The choir library end to end against the Flask server: the choir admin sees the whole library in
// Choir admin, adds Fauré's Madrigal with one tap (score + programme), a member's phone receives it
// and opens it; a solo phone has only the Abendlied; a section lead and anonymous callers are refused;
// library files are never served as static files. SH_SHOTS=<dir> saves screenshots at 390×844 and 1280×800.
const shots = process.env.SH_SHOTS ?? '';
const SUPER = process.env.SH_SUPER ?? 'super-secret-pw';
const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];

async function shoot(page: Page, name: string, testId?: string) {
  if (!shots) return;
  for (const s of SIZES) {
    await page.setViewportSize(s);
    await page.waitForTimeout(300);
    if (testId) {
      await page.getByTestId(testId).first().scrollIntoViewIfNeeded();
      await page.getByTestId(testId).first().screenshot({ path: path.join(shots, `${name}-${s.width}.png`) });
    } else {
      await page.screenshot({ path: path.join(shots, `${name}-${s.width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize(SIZES[0]);
}

async function phone(browser: Browser, voice = 'A') {
  const ctx = await browser.newContext({ viewport: SIZES[0] });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./#/');
  await page.evaluate(([v]) => {
    localStorage.setItem('shm:usageStats', 'off');
    localStorage.setItem('sh:profile', JSON.stringify({ name: '', voice: v, notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, onboarded: true, leaderboardOptIn: false }));
  }, [voice]);
  return { page, errors };
}

async function join(page: Page, code: string) {
  await page.goto('./#/choir');
  await page.getByLabel('Choir code').fill(code);
  await page.getByTestId('join-choir').click();
  await expect(page.getByTestId('choir-card')).toBeVisible();
}

test('admin adds the Madrigal from the library; a member gets it; solo phones and leads do not see the library', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const code = `lib${Date.now() % 100000}`;
  const r = await request.post('./api/super/choirs', { data: { code, name: 'Kammerchor Library' }, headers: { 'X-Super-Admin': SUPER } });
  expect(r.status()).toBe(201);
  const admin = await (await request.post('./api/invites/accept', { data: { token: (await r.json()).token, name: 'Clara', password: 'password-123' } })).json();
  const auth = { Authorization: `Bearer ${admin.token}` };
  const inv = await (await request.post(`./api/choirs/${code}/invites`, { data: { role: 'lead', voices: ['A'] }, headers: auth })).json();
  const lead = await (await request.post('./api/invites/accept', { data: { token: inv.token, name: 'Lena', password: 'password-123' } })).json();

  // ---- access: no login 401, the section lead 403 (list and add)
  expect((await request.get(`./api/choirs/${code}/library`)).status()).toBe(401);
  expect((await request.post(`./api/choirs/${code}/library/faure-madrigal`, { data: {} })).status()).toBe(401);
  expect((await request.get(`./api/choirs/${code}/library`, { headers: { Authorization: `Bearer ${lead.token}` } })).status()).toBe(403);
  expect((await request.post(`./api/choirs/${code}/library/faure-madrigal`, { data: { programme: true }, headers: { Authorization: `Bearer ${lead.token}` } })).status()).toBe(403);

  // ---- library files are not public, not even for a logged-in admin
  for (const f of ['library/index.json', 'library/scores/faure-madrigal.mxl', 'schonberg_library/index.json', 'schonberg_library/scores/faure-madrigal.mxl',
    'pieces/repertoire.json', 'pieces/cycle.json', 'pieces/pd/debussy-dieu.mxl', 'pieces/pd/vierne-kyrie.mxl']) {
    expect((await request.get(`./${f}`)).status(), f).toBe(404);
    expect((await request.get(`./${f}`, { headers: auth })).status(), f).toBe(404);
  }

  // ---- the admin's phone: Choir admin → Library → Add to our choir
  const adm = await phone(browser, 'S');
  await join(adm.page, code);
  await adm.page.getByTestId('login-name').fill('Clara');
  await adm.page.getByTestId('login-password').fill('password-123');
  await adm.page.getByTestId('login').click();
  await expect(adm.page.getByTestId('account-name')).toHaveText('Clara');
  await adm.page.goto('./#/choiradmin');
  const panel = adm.page.getByTestId('library-panel');
  await expect(panel.getByTestId('library-piece')).toHaveCount(8);
  const mad = panel.locator('[data-piece="faure-madrigal"]');
  await expect(mad).toContainText('Madrigal, Op. 35');
  await expect(mad).toContainText('Gabriel Fauré');
  await expect(mad).toContainText('Medium');
  await expect(mad).toContainText('Robert Kerr');
  await expect(panel.locator('[data-piece="vierne-kyrie"]')).toContainText('Louis Vierne');
  await shoot(adm.page, 'admin-library', 'library-panel');
  await mad.getByTestId('library-add').click();
  await expect(mad.getByTestId('library-added')).toContainText('in the programme');
  await expect(mad.getByTestId('library-add')).toHaveCount(0);
  // The choir's scores and its programme have it; the admin's own phone got it with the sync.
  await expect(adm.page.getByTestId('scores-editor')).toContainText('Madrigal, Op. 35');
  await expect(adm.page.getByTestId('programme-editor').getByRole('button', { name: /Madrigal, Op\. 35/ }).first()).toHaveAttribute('aria-pressed', 'true');
  await shoot(adm.page, 'admin-library-added', 'library-panel');
  const info = await (await request.get(`./api/choirs/${code}`)).json();
  expect(info.cycle.pieceIds).toEqual(['faure-madrigal']);
  expect(info.pieces.map((p: { libraryId?: string }) => p.libraryId)).toEqual(['faure-madrigal']);
  expect(info.pieces[0].credit).toContain('Robert Kerr');
  // A second tap (another admin, or a reload) adds nothing twice.
  const again = await (await request.post(`./api/choirs/${code}/library/faure-madrigal`, { data: { programme: true }, headers: auth })).json();
  expect(again.added).toBe(false);
  expect((await (await request.get(`./api/choirs/${code}`)).json()).pieces).toHaveLength(1);

  // ---- the super admin sees the library too, with the Madrigal marked as added
  const sup = await phone(browser);
  await sup.page.goto('./#/superadmin');
  await sup.page.getByLabel('Super-admin password').fill(SUPER);
  await sup.page.getByRole('button', { name: 'Continue' }).click();
  await sup.page.getByTestId('choir-row').filter({ hasText: code }).getByTestId('super-library').click();
  await expect(sup.page.locator('[data-piece="faure-madrigal"]').getByTestId('library-added')).toBeVisible();
  await expect(sup.page.getByTestId('library-piece')).toHaveCount(8);

  // ---- a member's phone receives it and can open it
  const mem = await phone(browser, 'A');
  await join(mem.page, code);
  await mem.page.goto('./?simulate=perfect#/');
  const row = mem.page.getByTestId('piece-row').filter({ hasText: 'Madrigal, Op. 35' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(mem.page).toHaveURL(/#\/piece\/faure-madrigal$/);
  await expect(mem.page.getByRole('heading', { name: 'Sections' })).toBeVisible();
  await expect(mem.page.locator('main')).toContainText('Robert Kerr');
  await mem.page.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click();
  await expect(mem.page.getByTestId('start')).toBeVisible();
  // The member has no library access.
  await mem.page.goto('./#/choiradmin');
  await expect(mem.page.getByTestId('library-panel')).toHaveCount(0);

  // ---- a solo phone: only the Abendlied
  const solo = await phone(browser, 'T');
  await solo.page.goto('./#/');
  await expect(solo.page.getByRole('heading', { name: 'Your pieces' })).toBeVisible({ timeout: 30_000 });
  await expect(solo.page.getByTestId('piece-row')).toHaveCount(1);
  await expect(solo.page.getByTestId('piece-row')).toContainText('Abendlied');
  await shoot(solo.page, 'solo-home');
  await solo.page.goto('./#/library');
  await expect(solo.page.locator('main')).not.toContainText('Madrigal');
  await expect(solo.page.locator('main')).not.toContainText('Debussy');

  expect([...adm.errors, ...sup.errors, ...mem.errors, ...solo.errors]).toEqual([]);
});

test('a choir from before the library keeps its former built-in piece: the server adds the score, Ranks opened first shows it', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const code = `old${Date.now() % 100000}`;
  const r = await request.post('./api/super/choirs', { data: { code, name: 'Kammerchor Old' }, headers: { 'X-Super-Admin': SUPER } });
  expect(r.status()).toBe(201);
  const admin = await (await request.post('./api/invites/accept', { data: { token: (await r.json()).token, name: 'Clara', password: 'password-123' } })).json();
  // Published while Debussy was still built into the app: the programme names it, the choir has no score.
  const put = await request.put(`./api/choirs/${code}/cycle`, { data: { name: 'Autumn', pieceIds: ['debussy-dieu'], base: 0 }, headers: { Authorization: `Bearer ${admin.token}` } });
  expect(put.status()).toBe(200);

  // A new phone of a member opens Ranks first (the choir's scores haven't arrived yet).
  const mem = await phone(browser, 'A');
  await mem.page.evaluate(([c]) => {
    const p = JSON.parse(localStorage.getItem('sh:profile')!);
    localStorage.setItem('sh:profile', JSON.stringify({ ...p, name: 'Mia', choirCode: c }));
  }, [code]);
  const board = mem.page.waitForRequest((q) => q.url().includes(`/choirs/${code}/entries?pieceId=debussy-dieu`), { timeout: 30_000 });
  await mem.page.goto('./#/ranks');
  await board;
  await expect(mem.page.getByLabel('Piece')).toHaveValue('debussy-dieu');
  await shoot(mem.page, 'ranks-first');
  // The server copied the library score into the choir's scores (once).
  const info = await (await request.get(`./api/choirs/${code}`)).json();
  expect(info.pieces.map((p: { libraryId?: string }) => p.libraryId)).toEqual(['debussy-dieu']);
  expect(info.cycle.pieceIds).toEqual(['debussy-dieu']);
  await mem.page.goto('./#/');
  await expect(mem.page.getByTestId('piece-row').filter({ hasText: 'Dieu! qu' })).toBeVisible({ timeout: 30_000 });
  expect(mem.errors).toEqual([]);
});

test('the programme editor lists the library pieces: one tap adds the score and includes it, publishing sends it', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const code = `plb${Date.now() % 100000}`;
  const r = await request.post('./api/super/choirs', { data: { code, name: 'Programme Library' }, headers: { 'X-Super-Admin': SUPER } });
  expect(r.status()).toBe(201);
  await request.post('./api/invites/accept', { data: { token: (await r.json()).token, name: 'Clara', password: 'password-123' } });
  const adm = await phone(browser, 'S');
  await join(adm.page, code);
  await adm.page.getByTestId('login-name').fill('Clara');
  await adm.page.getByTestId('login-password').fill('password-123');
  await adm.page.getByTestId('login').click();
  await expect(adm.page.getByTestId('account-name')).toHaveText('Clara');
  await adm.page.goto('./#/choiradmin');
  const editor = adm.page.getByTestId('programme-editor');
  // Every library piece is offered right in the programme's piece list, the Madrigal included.
  await expect(editor.getByTestId('programme-library')).toHaveCount(8);
  await expect(editor.getByTestId('programme-library').filter({ hasText: 'Madrigal, Op. 35' })).toContainText('Gabriel Fauré');
  await shoot(adm.page, 'programme-library', 'programme-editor');
  await editor.getByTestId('programme-library').filter({ hasText: 'Madrigal, Op. 35' }).getByRole('button').click();
  // Its score is in the choir now (not yet in the published programme), and it is included in the draft.
  await expect(editor.getByTestId('programme-library')).toHaveCount(7);
  await expect(editor.getByRole('button', { name: /Madrigal, Op\. 35/ }).first()).toHaveAttribute('aria-pressed', 'true');
  let info = await (await request.get(`./api/choirs/${code}`)).json();
  expect(info.pieces.map((p: { libraryId?: string }) => p.libraryId)).toEqual(['faure-madrigal']);
  expect(info.cycle?.pieceIds ?? []).toEqual([]);
  await adm.page.getByRole('button', { name: 'Publish to the choir' }).click();
  await expect.poll(async () => ((await (await request.get(`./api/choirs/${code}`)).json()).cycle?.pieceIds ?? [])).toEqual(['faure-madrigal']);
  info = await (await request.get(`./api/choirs/${code}`)).json();
  expect(info.pieces).toHaveLength(1);
  expect(adm.errors).toEqual([]);
});
