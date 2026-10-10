import { launch, BASE, shot, sleep, waitHash } from './lib.mjs';
import { setProfile } from './playlib.mjs';
const { browser, page, errors } = await launch();
await setProfile(page);
const PLAY = BASE + '?simulate=perfect#/play/bach-bwv315/P2/s0-m0-5?level=1';
async function open(url) { await page.goto(url); await sleep(1500); }
const st = async (l) => console.log(l, '| hash', await page.evaluate(() => location.hash), '| overlay:', (await page.locator('.overlay').allInnerTexts()).join(' / ').replace(/\n/g,' ').slice(0,120), '| score', await page.getByTestId('score').innerText().catch(()=>'-'));
await open(PLAY);
await page.getByTestId('start').click();
for (const t of [1, 4, 7]) { await sleep(t === 1 ? 1000 : 3000); await shot(page, `07-run-t${t}`); }
await st('running');
// pause
await page.getByRole('button', { name: 'Pause' }).click(); await sleep(1500); await shot(page, '07-paused'); await st('paused');
const sc1 = await page.getByTestId('score').innerText(); await sleep(2000);
console.log('score stable while paused?', sc1, await page.getByTestId('score').innerText());
await page.getByRole('button', { name: 'Resume' }).click(); await sleep(3000); await st('resumed');
// restart button in controls
await page.getByRole('button', { name: 'Restart' }).first().click(); await sleep(1000); await st('after restart'); await shot(page, '07-after-restart');
// finish early
await sleep(4000);
await page.getByRole('button', { name: 'Stop', exact: true }).click(); await sleep(2000); await st('after finish');
await shot(page, '07-finish-early-results');
console.log((await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 400));
// pause during count-in then quit
await open(PLAY);
await page.getByTestId('start').click(); await sleep(600);
await page.getByRole('button', { name: 'Pause' }).click(); await sleep(800); await st('paused in count-in');
await page.getByRole('button', { name: 'Resume' }).click(); await sleep(800); await st('resumed count-in'); await shot(page, '07-resume-countin');
await sleep(3000); await st('after count-in resume');
await page.getByRole('button', { name: 'Pause' }).click(); await sleep(500);
await page.getByRole('button', { name: 'Quit' }).click(); await sleep(1500); await st('after quit');
// Does audio keep playing after quit? check audio context state & any running session
// Finish during count-in
await open(PLAY);
await page.getByTestId('start').click(); await sleep(500);
await page.getByRole('button', { name: 'Stop', exact: true }).click(); await sleep(2000); await st('finish during count-in');
await shot(page, '07-finish-countin');
console.log((await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 300));
// back during play
await open(PLAY);
await page.getByTestId('start').click(); await sleep(5000);
await page.getByRole('button', { name: 'Back' }).click(); await sleep(1500); await st('back during play');
await sleep(3000); await st('3s after back');
// browser back during play
await open(BASE + '?simulate=perfect#/piece/bach-bwv315'); await page.locator('.ladder-row').first().locator('button[aria-label*="level 1 "]').click(); await waitHash(page,'play/'); await sleep(800);
await page.getByTestId('start').click(); await sleep(4000);
await page.goBack(); await sleep(2500); await st('browser back during play');
await page.goForward(); await sleep(2500); await st('browser forward');
// rapid double tap start
await open(PLAY);
await page.getByTestId('start').dblclick(); await sleep(300); await page.getByTestId('start').click({ timeout: 1000 }).catch(()=>{});
await sleep(4000); await shot(page, '07-doubletap'); await st('double tap');
await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 90000 }).catch(()=>{});
await st('double tap end');
console.log('ERR', errors);
await browser.close();
