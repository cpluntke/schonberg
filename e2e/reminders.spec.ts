import { test, expect, type Page } from '@playwright/test';

// The daily practice reminder (Settings → Your week, the You sheet's Practice row, the Today-done
// offer), with the browser's Notification and PushManager mocked and the choir server's
// /reminders API answered here (the dev build has no server: `shr:devApi` stands in for it).

const PROFILE = { name: 'Clara Weber', voice: 'A', notation: 'letter', strictness: 'standard', tuning: 'equal', latencyMs: 120, latencySource: 'measured', onboarded: true, leaderboardOptIn: false, headphones: true, displayMigrated: true, scoreDefaultMigrated: true };
const KEY = 'BAAlSm-Ut9wBJkttkrfcASZLcJW63wInTHGWu98EKE1ylLzhBipPdJq_5AsxVXqf';

type Sent = { method: string; path: string; body: Record<string, unknown> | null };

async function mockBrowser(page: Page, { permission = 'default', grant = 'granted', ua }: { permission?: string; grant?: string; ua?: string } = {}) {
  await page.addInitScript(({ permission, grant, ua }) => {
    localStorage.setItem('shr:devApi', '/schonberg/api');
    if (ua) Object.defineProperty(navigator, 'userAgent', { get: () => ua });
    const w = window as unknown as Record<string, unknown>;
    // (kept over reloads, as the browser keeps its permission and subscription)
    const saved = JSON.parse(sessionStorage.getItem('__push') ?? 'null') as null | { permission: string; asked: number; subscribed: number; unsubscribed: number; subN: number };
    const s = saved ?? { permission, asked: 0, subscribed: 0, unsubscribed: 0, subN: 0 };
    const keep = () => sessionStorage.setItem('__push', JSON.stringify(s));
    w.__push = s;
    class FakeNotification {
      static get permission() { return s.permission; }
      static async requestPermission() { s.asked++; s.permission = grant; keep(); return grant; }
    }
    w.Notification = FakeNotification;
    const makeSub = (n: number) => {
      const endpoint = `https://fcm.googleapis.com/fcm/send/fake-${n}`;
      return {
        endpoint, options: { applicationServerKey: null },
        toJSON: () => ({ endpoint, keys: { p256dh: 'BP' + 'x'.repeat(85), auth: 'a'.repeat(22) } }),
        unsubscribe: async () => { s.unsubscribed++; s.subN = 0; keep(); return true; },
      };
    };
    const pushManager = {
      getSubscription: async () => (s.subN ? makeSub(s.subN) : null),
      subscribe: async () => { s.subscribed++; s.subN = s.subscribed; keep(); return makeSub(s.subN); },
    };
    Object.defineProperty(ServiceWorkerContainer.prototype, 'ready', { get: () => Promise.resolve({ pushManager }) });
  }, { permission, grant, ua });
}

async function mockServer(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route('**/schonberg/api/reminders**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'GET' && path.endsWith('/key')) return route.fulfill({ json: { publicKey: KEY } });
    sent.push({ method: req.method(), path, body: req.postData() ? JSON.parse(req.postData()!) : null });
    return route.fulfill({ json: { ok: true } });
  });
  return sent;
}

async function seeded(page: Page, url = '/#/') {
  await page.goto('/#/');
  await page.evaluate((profile) => localStorage.setItem('sh:profile', JSON.stringify(profile)), PROFILE);
  await page.goto(url);
  await page.reload();
}

test('switching the daily reminder on and off in Settings, and the You sheet shows it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await mockBrowser(page);
  const sent = await mockServer(page);
  await seeded(page);
  await expect(page.getByRole('heading', { name: 'Your pieces' })).toBeVisible({ timeout: 20_000 });

  // You → Practice opens Settings at the practice part, with the reminder.
  await page.getByTestId('you-button').click();
  await expect(page.getByTestId('you-row-practice')).toContainText('reminder');
  await page.getByTestId('you-row-practice').click();
  const block = page.getByTestId('reminder-settings');
  await expect(block).toBeVisible();
  const toggle = block.getByTestId('reminder-toggle');
  await expect(toggle).not.toBeChecked();
  await expect(block.getByTestId('reminder-time')).toHaveValue('18:00');
  await expect(block.getByRole('checkbox', { name: /Only on days you haven't practised yet/ })).toBeChecked();
  await expect(block.getByRole('checkbox', { name: /Only on days/ })).toBeDisabled();
  // No permission asked before the tap.
  expect(await page.evaluate(() => (window as unknown as { __push: { asked: number } }).__push.asked)).toBe(0);

  await toggle.click();
  await expect(toggle).toBeChecked();
  const push = () => page.evaluate(() => (window as unknown as { __push: { asked: number; subscribed: number; unsubscribed: number } }).__push);
  expect(await push()).toMatchObject({ asked: 1, subscribed: 1 });
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ method: 'POST', path: '/schonberg/api/reminders', body: {
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/fake-1', keys: { p256dh: expect.any(String), auth: expect.any(String) } },
    time: '18:00', tz: expect.any(String),
  } });
  expect(JSON.stringify(sent[0].body)).not.toContain('Clara');

  // A new time goes to the server.
  await block.getByTestId('reminder-time').fill('07:45');
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].body).toMatchObject({ time: '07:45' });

  // The You sheet's Practice row says it.
  await page.goto('/#/');
  await page.reload();
  await page.getByTestId('you-button').click();
  await expect(page.getByTestId('you-row-practice')).toContainText('reminder 07:45');
  await page.getByTestId('you-row-practice').click();

  // Off: the server and the browser forget the subscription.
  await page.getByTestId('reminder-toggle').click();
  await expect(page.getByTestId('reminder-toggle')).not.toBeChecked();
  await expect.poll(() => sent.filter((s) => s.method === 'DELETE').length).toBe(1);
  expect(sent.find((s) => s.method === 'DELETE')!.body).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/fake-1' });
  expect((await push()).unsubscribed).toBe(1);
  expect(errors).toEqual([]);
});

test('an honest note where reminders cannot work: iPhone outside the Home Screen', async ({ page }) => {
  await mockBrowser(page, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await mockServer(page);
  await seeded(page, '/#/settings');
  const block = page.getByTestId('reminder-settings');
  await expect(block.getByTestId('reminder-note')).toContainText('On iPhone, add Schönberg Hero to your Home Screen first');
  await expect(block.getByTestId('reminder-toggle')).toBeDisabled();
});

test('permission refused: the reminder stays off and says why', async ({ page }) => {
  await mockBrowser(page, { grant: 'denied' });
  const sent = await mockServer(page);
  await seeded(page, '/#/settings');
  const block = page.getByTestId('reminder-settings');
  await block.getByTestId('reminder-toggle').click();
  await expect(block.getByTestId('reminder-note')).toContainText('Notifications are blocked');
  await expect(block.getByTestId('reminder-toggle')).not.toBeChecked();
  expect(sent).toEqual([]);
});

test('Today done offers the reminder once', async ({ page }) => {
  await mockBrowser(page);
  const sent = await mockServer(page);
  await seeded(page);
  await expect(page.getByTestId('plan-card')).toBeVisible({ timeout: 20_000 });
  // Finish for today (as the session's "Finish for today" does).
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('sh:today')!);
    localStorage.setItem('sh:today', JSON.stringify({ ...t, started: true, finished: true, session: null }));
  });
  await page.reload();
  await expect(page.getByTestId('today-done')).toBeVisible({ timeout: 20_000 });
  const offer = page.getByTestId('reminder-offer');
  await expect(offer).toContainText('A reminder at 18:00');
  await offer.getByTestId('reminder-offer-yes').click();
  await expect(offer).toContainText('Reminder on');
  await expect.poll(() => sent.length).toBe(1);
  // Not again.
  await page.reload();
  await expect(page.getByTestId('today-done')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reminder-offer')).toHaveCount(0);
});
