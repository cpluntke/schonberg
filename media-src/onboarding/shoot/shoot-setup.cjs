// img/setup-choir, setup-range, setup-delay: the voice setup with a fake microphone (fakemic.js: an
// oscillator we control plus the app's own output played back 2.8 s later, which "sings back" each
// range pattern). No app code changed. Run from the render dir; BASE=http://localhost:PORT.
const { chromium } = require('/home/user/schonberg/node_modules/@playwright/test');
const base = process.env.BASE || 'http://localhost:5191';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  await c.addInitScript({ path: __dirname + '/fakemic.js' });
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const txt = async () => (await p.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 400);
  const box = async (loc) => { if (!(await loc.count())) return null; const bb = await loc.first().boundingBox(); return bb && [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)]; };
  await p.goto(base + '/#/setup'); await sleep(2500);
  await p.fill('input[aria-label="Choir code"]', 'stcecilia'); await sleep(400);
  await p.screenshot({ path: 'img/setup-choir.png' });
  console.log('choir', JSON.stringify({ code: await box(p.locator('input[aria-label="Choir code"]')), own: await box(p.getByTestId('choir-step-next')) }));
  await p.fill('input[aria-label="Choir code"]', ''); await sleep(200);
  await p.getByTestId('choir-step-next').click(); await sleep(800);
  console.log('S2', await txt());
  await p.fill('input[autocomplete=given-name]', 'Clara').catch(() => {});
  await p.click('button.choice:has-text("Alto")').catch(() => {}); await sleep(300);
  await p.click('button.primary:has-text("Continue")'); await sleep(1000);
  console.log('S3', await txt());
  await p.click('button:has-text("Turn on microphone")').catch(() => {}); await sleep(1500);
  await p.evaluate(() => window.__voice(57, 2)); await sleep(4000); await p.evaluate(() => window.__voice(null));
  await p.getByTestId('range-next').click(); await sleep(500);
  await p.getByTestId('range-start').click();
  for (let i = 0; i < 40; i++) { await sleep(500); if (await p.getByTestId('range-next').count()) break; }
  await p.getByTestId('range-next').click(); await sleep(500);
  await p.getByTestId('range-start').click();
  // Going up: sing each pattern back with the oscillator (do re mi re do from the round's first note,
  // A3 for this voice, a whole step higher each round). Shoot during round 2's "Your turn".
  await p.evaluate(() => window.__echoGain(0));
  let shot = false, sungRound = -1;
  for (let i = 0; i < 240 && !shot; i++) {
    await sleep(250);
    const t = await txt(); const chips = await p.locator('.chip').count();
    if (/Your turn/.test(t) && chips >= 1) { await sleep(900); await p.screenshot({ path: 'img/setup-range.png' }); shot = true; console.log('range', chips, t.slice(190)); break; }
    if (/Your turn/.test(t) && sungRound < chips) {
      sungRound = chips; const base = 57 + 2 * chips;
      for (const d of [0, 2, 4, 2, 0]) { await p.evaluate((m) => window.__voice(m, 1), base + d); await sleep(800); }
      await p.evaluate(() => window.__voice(null));
    }
  }
  // on to the delay step
  await p.getByRole('button', { name: 'Skip the range check' }).click(); await sleep(1000);
  if (await p.getByTestId('range-done').count()) { await p.getByTestId('range-done').click(); await sleep(800); }
  console.log('S4', await txt());
  await p.evaluate(() => { window.__echoGain(1.2); window.__echo(0.12); });
  await p.click('button:has-text("Start the clicks")');
  for (let i = 0; i < 40; i++) { await sleep(300); const t = await txt(); if (/Sing “ta” on every click/.test(t) && /\| 3 \|/.test(t)) { await p.screenshot({ path: 'img/setup-delay.png' }); console.log('delay', t); break; } }
  console.log('errors', errs); await b.close();
})();
