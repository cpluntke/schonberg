import { launch, BASE, shot, waitHash, sleep } from './lib.mjs';
const { browser, page, errors } = await launch();
await page.goto(BASE + '#/'); await sleep(2500);
await shot(page, '01-home-first');
console.log('HOME TEXT:', (await page.innerText('body')).slice(0, 800));
await page.getByRole('button', { name: 'Start setup' }).click(); await waitHash(page, 'setup'); await sleep(500);
await shot(page, '01-setup-1');
await page.locator('input').first().fill('Anna Testerin');
const choices = page.locator('.choice'); console.log('voice choices', await choices.allInnerTexts());
await choices.nth(1).click();
await page.getByRole('button', { name: 'Continue' }).click(); await sleep(2500);
await shot(page, '01-setup-2');
console.log('STEP2', (await page.innerText('main')).slice(0, 500));
await page.getByRole('button', { name: 'Continue' }).click(); await sleep(500);
await shot(page, '01-setup-3');
// latency
const latBtn = page.locator('button.btn.voice'); console.log('lat btn', await latBtn.innerText());
await latBtn.click(); await sleep(9000);
await shot(page, '01-setup-3-lat');
console.log('STEP3', (await page.innerText('main')).slice(0, 500));
await page.getByRole('button', { name: 'Continue' }).click(); await sleep(500);
await shot(page, '01-setup-4');
console.log('STEP4', (await page.innerText('main')).slice(0, 600));
// back button
await page.getByRole('button', { name: 'Back' }).click(); await sleep(300);
console.log('after back:', await page.locator('.eyebrow').first().innerText());
await page.getByRole('button', { name: 'Continue' }).click(); await sleep(300);
const nc = page.locator('.choice'); console.log('notation choices', await nc.allInnerTexts());
await nc.nth(2).click(); // movable?
await shot(page, '01-setup-4-chosen');
const btns = await page.locator('main button').allInnerTexts(); console.log('step4 buttons', btns);
await page.locator('main button.btn.primary').last().click(); await sleep(800);
console.log('hash after finish', await page.evaluate(() => location.hash));
console.log('profile', await page.evaluate(() => localStorage.getItem('sh:profile')));
await page.reload(); await sleep(2000);
console.log('profile after reload', await page.evaluate(() => localStorage.getItem('sh:profile')));
await shot(page, '01-home-after-setup');
console.log('HOME2:', (await page.innerText('body')).slice(0, 800));
// Skip path in a new context
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p2 = await ctx2.newPage();
await p2.goto(BASE + '#/setup'); await sleep(1500);
await p2.getByRole('button', { name: 'Skip' }).click(); await sleep(800);
console.log('skip -> hash', await p2.evaluate(() => location.hash), 'profile', await p2.evaluate(() => localStorage.getItem('sh:profile')));
await shot(p2, '01-after-skip');
// back on step1 from deep link (no history)
await p2.goto(BASE + '#/setup'); await sleep(1000);
await p2.getByRole('button', { name: 'Back' }).click(); await sleep(800);
console.log('back on step1 ->', await p2.evaluate(() => location.hash));
console.log('ERRORS', errors);
await browser.close();
