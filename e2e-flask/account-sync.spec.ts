import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Progress kept with a choir account, end to end against the Flask server: a member sings level 1 on
// phone A, makes an account (her anonymous shared progress moves to it), logs in on phone B and gets
// the same progress; the section lead sees one entry; the admin removes her and everything goes.
const shots = process.env.SH_SHOTS ?? '';
const dataDir = process.env.SH_DATA_DIR ?? '';
const SUPER = process.env.SH_SUPER ?? 'super-secret-pw';
const shot = async (page: Page, name: string, el?: string) => {
  if (!shots) return;
  if (el) await page.getByTestId(el).screenshot({ path: path.join(shots, name) });
  else await page.screenshot({ path: path.join(shots, name) });
};
type Prog = Record<string, { sections: Record<string, { level: number; best: Record<string, number>; lastPassed?: number }>; full?: { level: number } }>;
const progressOf = (page: Page) => page.evaluate(() => {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('sh:progress:')) out[k] = JSON.parse(localStorage.getItem(k)!);
  }
  return out;
}) as Promise<Prog>;

async function setupChoir(request: APIRequestContext, code: string) {
  const r = await request.post('./api/super/choirs', { data: { code, name: 'E2E Kammerchor' }, headers: { 'X-Super-Admin': SUPER } });
  expect(r.status()).toBe(201);
  const admin = await (await request.post('./api/invites/accept', { data: { token: (await r.json()).token, name: 'Clara', password: 'password-123' } })).json();
  const inv = await (await request.post(`./api/choirs/${code}/invites`, { data: { role: 'lead', voices: ['A'] }, headers: { Authorization: `Bearer ${admin.token}` } })).json();
  const lead = await (await request.post('./api/invites/accept', { data: { token: inv.token, name: 'Lena', password: 'password-123' } })).json();
  return { admin: admin.token as string, lead: lead.token as string };
}
const section = async (request: APIRequestContext, code: string, lead: string) =>
  // The lead sees progress only aggregated; names only next to voice ranges (one row per sharing singer).
  (await (await request.get(`./api/choirs/${code}/insights/A`, { headers: { Authorization: `Bearer ${lead}` } })).json()) as { sharing: number; ranges: { name: string }[] };

test('member: level 1 on phone A, account, phone B gets it; lead sees one entry; admin removes her', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const code = `e2e${Date.now() % 100000}`;
  const { lead } = await setupChoir(request, code);
  const errors: string[] = [];

  // ---- phone A: an anonymous member who shares her progress
  const a = await browser.newContext();
  const pa = await a.newPage();
  pa.on('pageerror', (e) => errors.push(String(e)));
  await pa.goto('./#/');
  await pa.evaluate(() => localStorage.setItem('sh:profile', JSON.stringify({ name: 'Anna', voice: 'A', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, onboarded: false, leaderboardOptIn: false })));
  await pa.goto('./?simulate=perfect#/choir');
  await pa.getByLabel('Choir code').fill(code);
  await pa.getByTestId('join-choir').click();
  await expect(pa.getByTestId('choir-card')).toBeVisible();
  await pa.getByLabel(/Share my progress with my section lead/).check();
  await expect.poll(async () => (await section(request, code, lead)).ranges.map((m) => m.name), { timeout: 15_000 }).toEqual(['Anna']);

  await pa.goto('./?simulate=perfect#/');
  await expect(pa.getByText('Repertoire')).toBeVisible({ timeout: 30_000 });
  await pa.getByTestId('piece-row').first().click();
  await pa.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click();
  await pa.getByTestId('hp-yes').click(); // level 1 counts with headphones on
  await pa.getByTestId('start').click();
  await expect(pa.getByTestId('pass-banner')).toContainText(/level 1 reached|Passed/, { timeout: 120_000 });
  // The run also updated her entry on the choir's leaderboard (without opening Ranks).
  const board = async () => ((await (await request.get(`./api/choirs/${code}/entries`)).json()).entries as { name: string; readiness: number }[])
    .filter((e) => e.name === 'Anna').map((e) => e.readiness > 0);
  await expect.poll(board, { timeout: 15_000 }).toContain(true);
  // Results suggests an account (inline, below the main buttons).
  await expect(pa.getByTestId('account-tip')).toBeVisible();
  await pa.getByTestId('account-tip').scrollIntoViewIfNeeded();
  await shot(pa, '1-results-account-tip.png');
  const progA = await progressOf(pa);
  const [pkey] = Object.keys(progA);
  const [sid, secA] = Object.entries(progA[pkey].sections).find(([, s]) => s.level >= 1)!;

  await pa.getByTestId('account-tip').getByRole('button', { name: 'Make an account' }).click();
  await expect(pa.getByTestId('account-form')).toBeVisible();
  // The tip opens "Make an account" (even though she never finished voice setup).
  await expect(pa.getByTestId('account-mode-create')).toHaveAttribute('aria-pressed', 'true');
  await shot(pa, '2-settings-make-account.png');
  await pa.getByTestId('account-password').fill('anna-password');
  await pa.getByTestId('account-submit').click();
  await expect(pa.getByTestId('account-who')).toHaveText('Anna');
  await expect(pa.getByTestId('sync-status')).toContainText(/Saved just now · \d+\.\d KB/, { timeout: 20_000 });
  await pa.getByTestId('account-sync').scrollIntoViewIfNeeded();
  await shot(pa, '3-settings-logged-in.png');

  // On the server: one small file for her account; one shared entry, now the account's.
  if (dataDir) {
    const dir = path.join(dataDir, 'schonberg_member_progress', code);
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    const size = fs.statSync(path.join(dir, files[0])).size;
    console.info(`[e2e] account progress file: ${size} bytes`);
    expect(size).toBeLessThan(8 * 1024);
    await expect.poll(() => {
      const shared = JSON.parse(fs.readFileSync(path.join(dataDir, 'schonberg_progress', `${code}.json`), 'utf-8'));
      return Object.entries(shared).map(([n, e]) => `${n}:${(e as { account?: string }).account ? 'account' : 'token'}`);
    }, { timeout: 15_000 }).toEqual(['Anna:account']);
  }
  const view = await section(request, code, lead);
  expect(view.ranges.map((m) => m.name)).toEqual(['Anna']);
  expect(view.sharing).toBe(1);

  // ---- phone B: a fresh browser logs in and gets her progress
  const b = await browser.newContext();
  const pb = await b.newPage();
  pb.on('pageerror', (e) => errors.push(String(e)));
  await pb.goto('./#/');
  await expect(pb.getByText('Repertoire')).toBeVisible({ timeout: 30_000 });
  expect(await progressOf(pb)).toEqual({});
  await pb.getByTestId('home-account').click();
  await expect(pb.getByTestId('account-form')).toBeVisible();
  await pb.getByTestId('account-code').fill(code);
  await pb.getByTestId('account-name-input').fill('anna'); // any case
  await pb.getByTestId('account-password').fill('anna-password');
  await shot(pb, '4-phone-b-login.png');
  await pb.getByTestId('account-submit').click();
  await expect(pb.getByTestId('account-who')).toHaveText('Anna');
  await expect.poll(async () => Object.keys(await progressOf(pb)), { timeout: 20_000 }).toEqual([pkey]);
  const progB = await progressOf(pb);
  expect(progB[pkey].sections[sid].level).toBe(secA.level);
  expect(progB[pkey].sections[sid].best[1]).toBeCloseTo(secA.best[1], 2);
  expect(Math.abs((progB[pkey].sections[sid].lastPassed ?? 0) - (secA.lastPassed ?? 0))).toBeLessThan(60_000);
  expect(await pb.evaluate(() => JSON.parse(localStorage.getItem('sh:profile')!).name)).toBe('Anna');
  await pb.getByTestId('account-sync').scrollIntoViewIfNeeded();
  await shot(pb, '5-phone-b-logged-in.png');
  // Two phones of one account settle: reloading (start + focus) without singing saves nothing new.
  const rev = () => pb.evaluate(async () => {
    const t = JSON.parse(localStorage.getItem('schonberg:session')!).token;
    return (await (await fetch('./api/session/progress?meta=1', { headers: { Authorization: `Bearer ${t}` } })).json()).rev as number;
  });
  await pb.waitForTimeout(1500);
  const r0 = await rev();
  for (let i = 0; i < 2; i++) { await pb.reload(); await pb.waitForTimeout(1500); await pa.reload(); await pa.waitForTimeout(1500); }
  expect(await rev()).toBe(r0);
  // The lead still sees one entry.
  expect((await section(request, code, lead)).ranges.map((m) => m.name)).toEqual(['Anna']);
  // Logged in: Home no longer offers "New phone? Log in…" (the setup card still shows: never set up).
  await pb.goto('./#/');
  await expect(pb.getByRole('button', { name: 'Start setup' })).toBeVisible({ timeout: 30_000 });
  await expect(pb.getByTestId('home-account')).toHaveCount(0);
  await shot(pb, '5b-phone-b-home-logged-in.png');

  // ---- the admin removes her (People, on a laptop)
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pc = await c.newPage();
  pc.on('pageerror', (e) => errors.push(String(e)));
  await pc.goto('./#/choir');
  await pc.getByLabel('Choir code').fill(code);
  await pc.getByTestId('join-choir').click();
  await pc.getByTestId('login-name').fill('Clara');
  await pc.getByTestId('login-password').fill('password-123');
  await pc.getByTestId('login').click();
  await pc.getByRole('button', { name: 'Choir admin' }).click();
  const members = pc.getByTestId('members');
  await expect(members).toContainText('Anna');
  await expect(pc.getByTestId('signups-open')).toHaveValue('open');
  await members.scrollIntoViewIfNeeded();
  await shot(pc, '6-admin-people-members.png');
  pc.once('dialog', (d) => void d.accept());
  await members.getByTestId('person').filter({ hasText: 'Anna' }).getByRole('button', { name: 'Remove' }).click();
  await expect(members).not.toContainText('Anna', { timeout: 10_000 });
  if (dataDir) {
    expect(fs.existsSync(path.join(dataDir, 'schonberg_member_progress', code)) ? fs.readdirSync(path.join(dataDir, 'schonberg_member_progress', code)) : []).toEqual([]);
  }
  expect((await section(request, code, lead)).ranges).toEqual([]);
  // Phone B is logged out on its next sync, keeps its local progress, and doesn't share again.
  await pb.reload();
  await expect.poll(async () => pb.evaluate(() => localStorage.getItem('schonberg:session')), { timeout: 20_000 }).toBeNull();
  await pb.goto('./#/');
  await expect(pb.getByTestId('logged-out-card')).toContainText('removed');
  await shot(pb, '9-phone-b-home-removed.png');
  await pb.goto('./#/settings');
  await expect(pb.getByTestId('logged-out-why')).toContainText('removed');
  await pb.getByTestId('account-sync').scrollIntoViewIfNeeded();
  await shot(pb, '8-phone-b-account-removed.png');
  expect((await progressOf(pb))[pkey].sections[sid].level).toBe(1);
  await pb.waitForTimeout(1500);
  expect((await section(request, code, lead)).ranges).toEqual([]);
  expect(errors).toEqual([]);
  await request.delete(`./api/super/choirs/${code}`, { headers: { 'X-Super-Admin': SUPER } });
  await a.close(); await b.close(); await c.close();
});

test('super admin sees storage per choir (KB below 1 MB) and the progress kept with accounts', async ({ page, request }) => {
  const code = `e2s${Date.now() % 100000}`;
  await setupChoir(request, code);
  await page.goto('./#/superadmin');
  await page.locator('input[type="password"]').fill(SUPER);
  await page.locator('input[type="password"]').press('Enter');
  await expect(page.getByTestId('server-usage')).toContainText(/ (KB|MB) of 400 MB used by all choirs/, { timeout: 15_000 });
  await expect(page.getByTestId('server-usage')).toContainText(/Progress kept with accounts: \d+ accounts? · \d+ KB of 50 MB/);
  await expect(page.getByTestId('choir-row').filter({ hasText: code })).toContainText('0 KB of 50 MB');
  await shot(page, '7-super-admin-storage.png');
  await request.delete(`./api/super/choirs/${code}`, { headers: { 'X-Super-Admin': SUPER } });
});
