import { launch, BASE, shot, sleep } from './lib.mjs';
import { setProfile } from './playlib.mjs';
for (const [wav, tag] of [['a4.wav', 'a4'], ['slide.wav', 'slide']]) {
  const { browser, page, errors } = await launch({ args: [`--use-file-for-fake-audio-capture=/home/user/schonberg/docs/qa/fixtures/wav/${wav}`] });
  await setProfile(page);
  await page.goto(BASE + '#/tuner'); await sleep(1500);
  const btn = page.getByRole('button', { name: /microphone|start/i }); if (await btn.count()) await btn.first().click();
  await sleep(3000); await shot(page, `14-tuner-${tag}`);
  console.log(tag, 'TUNER', (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 300));
  // setup range step
  await page.goto(BASE + '#/setup'); await sleep(1000);
  await page.getByRole('button', { name: 'Continue' }).click(); await sleep(500);
  await page.getByRole('button', { name: /Turn on microphone/ }).click(); await sleep(9000);
  await shot(page, `14-range-${tag}`);
  console.log(tag, 'RANGE', (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 300));
  // real-mic play run (not simulated) Bach alto L1
  if (tag === 'a4') {
    await page.goto(BASE + '#/play/bach-bwv315/P2/s0-m0-5?level=1'); await sleep(1500);
    await page.getByTestId('start').click(); await sleep(8000); await shot(page, '14-realmic-play');
    console.log('real mic play score', await page.getByTestId('score').innerText());
  }
  console.log('ERR', errors);
  await browser.close();
}
