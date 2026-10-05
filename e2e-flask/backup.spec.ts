import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Progress backup end to end against the Flask server: sing level 1 on phone A, back up, restore on
// phone B (a fresh browser) with the restore code, compare, delete the backup.
const shots = process.env.SH_SHOTS ?? '';
const dataDir = process.env.SH_DATA_DIR ?? '';
const shot = async (page: Page, name: string, el?: string) => {
  if (!shots) return;
  if (el) await page.getByTestId(el).screenshot({ path: path.join(shots, name) });
  else await page.screenshot({ path: path.join(shots, name) });
};
const progressOf = (page: Page) => page.evaluate(() => {
  const out: Record<string, { sections: Record<string, { level: number; best: Record<string, number>; lastPassed?: number }> }> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('sh:progress:')) out[k] = JSON.parse(localStorage.getItem(k)!);
  }
  return out;
});

test('sing on phone A, back up, restore on phone B with the code, then delete the backup', async ({ browser }) => {
  const errors: string[] = [];
  // ---- phone A
  const a = await browser.newContext();
  const pa = await a.newPage();
  pa.on('pageerror', (e) => errors.push(String(e)));
  await pa.goto('./?simulate=perfect#/');
  await expect(pa.getByText('Repertoire')).toBeVisible({ timeout: 30_000 });
  await pa.getByTestId('piece-row').first().click();
  await pa.getByLabel('Sections').getByRole('button', { name: /level 1/ }).first().click();
  await pa.getByTestId('start').click();
  await expect(pa.getByTestId('pass-banner')).toContainText(/level 1 reached|Passed/, { timeout: 120_000 });
  const progA = await progressOf(pa);
  const [pkey] = Object.keys(progA);
  const [sid, secA] = Object.entries(progA[pkey].sections).find(([, s]) => s.level >= 1)!;
  expect(secA.level).toBe(1);

  // Settings: no choir, so backups are off with a gentle suggestion.
  await pa.goto('./#/settings');
  const panel = pa.getByTestId('backup-panel');
  await panel.scrollIntoViewIfNeeded();
  await expect(pa.getByTestId('backup-switch')).not.toBeChecked();
  await expect(panel).toContainText('Recommended');
  await shot(pa, '1-settings-backup-off.png', 'backup-panel');
  await pa.getByTestId('backup-switch').check();
  await expect(pa.getByTestId('backup-status')).toContainText(/Backed up just now · \d+\.\d KB/, { timeout: 15_000 });
  await pa.getByTestId('backup-show-code').click();
  const code = (await pa.getByTestId('backup-code').textContent())!.trim();
  expect(code).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);
  await panel.scrollIntoViewIfNeeded();
  await shot(pa, '2-settings-backup-on-with-code.png');
  await shot(pa, '2b-backup-panel-on.png', 'backup-panel');

  // On the server: one small file, named by a hash of the key, without the key or the code in it.
  const key = await pa.evaluate(() => localStorage.getItem('schonberg:backupKey'))!;
  if (dataDir) {
    const dir = path.join(dataDir, 'schonberg_backups');
    const files = fs.readdirSync(dir);
    expect(files).toEqual([crypto.createHash('sha256').update(key!).digest('hex').slice(0, 32) + '.json']);
    const text = fs.readFileSync(path.join(dir, files[0]), 'utf-8');
    expect(text).not.toContain(key!);
    expect(text.length).toBeLessThan(8 * 1024);
    console.info(`[e2e] server backup file: ${text.length} bytes`);
  }

  // ---- phone B: a fresh browser
  const b = await browser.newContext();
  const pb = await b.newPage();
  pb.on('pageerror', (e) => errors.push(String(e)));
  await pb.goto('./#/');
  await expect(pb.getByText('Repertoire')).toBeVisible({ timeout: 30_000 });
  expect(await progressOf(pb)).toEqual({});
  await pb.getByTestId('home-restore').click();
  await expect(pb.getByTestId('backup-code-input')).toBeVisible();
  await pb.getByTestId('backup-code-input').fill('ABCD-EFGH');
  await pb.getByTestId('backup-restore-btn').click();
  await expect(pb.getByTestId('backup-restore')).toContainText('28 characters');
  // Typed in lower case with spaces: still fine.
  await pb.getByTestId('backup-code-input').fill(code.toLowerCase().replace(/-/g, ' '));
  await shot(pb, '3-phone-b-restore-form.png');
  await pb.getByTestId('backup-restore-btn').click();
  await expect(pb.getByText(/Restored: progress on 1 piece/)).toBeVisible({ timeout: 15_000 });
  await shot(pb, '4-phone-b-restored.png');
  const progB = await progressOf(pb);
  expect(Object.keys(progB)).toEqual([pkey]);
  expect(progB[pkey].sections[sid].level).toBe(secA.level);
  expect(progB[pkey].sections[sid].best[1]).toBeCloseTo(secA.best[1], 2);
  expect(Math.abs((progB[pkey].sections[sid].lastPassed ?? 0) - (secA.lastPassed ?? 0))).toBeLessThan(3_600_000);
  expect(await pb.evaluate(() => localStorage.getItem('schonberg:backupKey'))).toBe(key);
  // The piece screen shows the level too.
  await pb.goto('./#/');
  await expect(pb.getByTestId('piece-row').first()).toBeVisible({ timeout: 30_000 });

  // ---- delete the backup (from phone B)
  await pb.goto('./#/settings');
  await expect(pb.getByTestId('backup-status')).toBeVisible();
  pb.once('dialog', (d) => void d.accept());
  await pb.getByTestId('backup-delete').click();
  await expect(pb.getByText('Backup deleted from the server')).toBeVisible();
  await expect(pb.getByTestId('backup-switch')).not.toBeChecked();
  if (dataDir) expect(fs.readdirSync(path.join(dataDir, 'schonberg_backups'))).toEqual([]);
  const after = await pb.evaluate(async (k) => (await fetch('./api/backup', { headers: { Authorization: `Bearer ${k}` } })).status, key);
  expect(after).toBe(404);
  // Progress on the phone stays.
  expect((await progressOf(pb))[pkey].sections[sid].level).toBe(1);
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});

test('super admin sees the storage used by each choir and by the backups', async ({ page, request }) => {
  const pw = process.env.SH_SUPER ?? 'super-secret-pw';
  const code = `e2e${Date.now() % 100000}`;
  const r = await request.post('./api/super/choirs', { data: { code, name: 'E2E Choir' }, headers: { 'X-Super-Admin': pw } });
  expect(r.status()).toBe(201);
  await page.goto('./#/superadmin');
  await page.locator('input[type="password"]').fill(pw);
  await page.locator('input[type="password"]').press('Enter');
  await expect(page.getByTestId('server-usage')).toContainText(/MB of 400 MB used by all choirs and backups/, { timeout: 15_000 });
  await expect(page.getByTestId('server-usage')).toContainText(/backups: \d+ of 2000/);
  await expect(page.getByTestId('choir-row').filter({ hasText: code })).toContainText('of 50 MB');
  await shot(page, '5-super-admin-storage.png');
  await request.delete(`./api/super/choirs/${code}`, { headers: { 'X-Super-Admin': pw } });
});
