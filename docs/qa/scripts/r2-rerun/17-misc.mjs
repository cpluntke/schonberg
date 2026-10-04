import { launch, BASE, shot, sleep } from './lib.mjs';
import { setProfile } from './playlib.mjs';
const { browser, page, errors } = await launch();
await setProfile(page);
const T = async (n=300) => (await page.innerText('body')).replace(/\n+/g,' | ').slice(0, n);
// 1 malformed URI fresh load
const p2 = await page.context().newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
await p2.goto(BASE + '#/piece/%E0%A4%A'); await sleep(2500);
console.log('malformed fresh load body:', JSON.stringify((await p2.innerText('body')).slice(0, 100)), e2); await p2.screenshot({ path: '/home/user/schonberg/docs/qa/shots/17-malformed-uri.png' }); await p2.close();
// 2 restart then complete
await page.goto(BASE + '?simulate=perfect#/play/bach-bwv315/P3/s0-m0-5?level=2'); await sleep(1500);
await page.getByTestId('start').click(); await sleep(9000);
await page.getByRole('button', { name: 'Restart' }).first().click();
await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 90000 }); await sleep(600);
console.log('restart->complete:', await T(200));
// 3 finish at ~60% of section
await page.goto(BASE + '?simulate=perfect#/play/bach-bwv315/P3/s0-m0-5?level=2'); await sleep(1500);
await page.getByTestId('start').click(); await sleep(16000);
await page.getByRole('button', { name: 'Finish' }).click();
await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 30000 }); await sleep(600);
console.log('finish at ~60%:', await T(450)); await shot(page, '17-finish-partial');
// 4 due for review
await page.evaluate(() => { const old = Date.now() - 9 * 86400000; localStorage.setItem('sh:progress:debussy-dieu:P1', JSON.stringify({pieceId:'debussy-dieu',partId:'P1',sections:{'s0-m0-4':{level:3,best:{3:0.9},attempts:3,lastPracticed:old,lastPassed:old}},totalAttempts:3,bestScore:100})); });
await page.goto(BASE + '#/'); await sleep(1500); console.log('home with due:', (await T(1200)).match(/[^|]*due[^|]*/gi)); await shot(page, '17-home-due');
await page.goto(BASE + '#/piece/debussy-dieu'); await sleep(1500); console.log('piece with due:', await T(600)); await shot(page, '17-piece-due');
console.log('ERR', errors);
await browser.close();
