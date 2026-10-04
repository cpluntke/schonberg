import { launch, BASE, nav, shot, axe, targets } from './r2x-lib.mjs';
const { browser, ctx, page } = await launch();
await page.goto(BASE + '?simulate=sloppy#/');
await page.waitForSelector('main');
// sloppy run
await nav(page, '#/play/debussy-dieu/P1/' + (await page.evaluate(() => '')) );
await nav(page, '#/piece/debussy-dieu');
console.log('DEBUSSY PIECE', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 900));
await shot(page, '05-debussy-piece', true);
await page.getByRole('button', { name: /level 1/ }).first().click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Start singing/ }).click();
await page.waitForTimeout(4000); await shot(page, '05-sloppy-mid');
await page.waitForFunction(() => location.hash.includes('results'), null, { timeout: 90000 }).catch(() => console.log('timeout sloppy'));
await page.waitForTimeout(800);
await shot(page, '05-sloppy-results', true);
console.log('SLOPPY', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 1200));
// tap a coach drill
const drill = page.getByRole('button', { name: /loop|drill|bars/i }).first();
console.log('drill btn', await drill.textContent().catch(() => 'none'));
await drill.click().catch(() => {}); await page.waitForTimeout(800);
console.log('after drill hash', await page.evaluate(() => location.hash));
await shot(page, '05-drill');
// whole piece arcade
await nav(page, '#/arcade/bach-bwv315/P1/all?level=3');
await shot(page, '05-arcade-pre');
await page.getByRole('button', { name: /Start/ }).first().click().catch((e) => console.log(e.message));
await page.waitForTimeout(5000); await shot(page, '05-arcade-mid');
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); function f() { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else r(n / 2); } requestAnimationFrame(f); }));
console.log('arcade fps (headless)', fps);
await page.waitForTimeout(4000); await shot(page, '05-arcade-mid2');
await page.getByRole('button', { name: /Finish/ }).click().catch((e) => console.log('nofinish', e.message));
await page.waitForTimeout(1500);
console.log('after finish', await page.evaluate(() => location.hash), (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 500));
await shot(page, '05-arcade-results', true);
// expert
await nav(page, '#/expert');
await page.getByRole('button', { name: /With guide tone/ }).click();
await page.waitForTimeout(1000);
console.log('expert hash', await page.evaluate(() => location.hash));
await shot(page, '05-expert-play');
await page.getByRole('button', { name: /Start/ }).first().click().catch(() => {});
await page.waitForTimeout(4000); await shot(page, '05-expert-mid');
// ranks share
await nav(page, '#/ranks');
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.getByRole('button', { name: /Share my ranking code/ }).click();
await page.waitForTimeout(1000);
await shot(page, '05-ranks-share', true);
console.log('RANKS', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 900));
const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => 'ERR ' + e.message));
console.log('CLIP', clip.slice(0, 400), 'len', clip.length);
// paste a code from another singer: tamper name
await page.getByRole('button', { name: /Paste codes/ }).click().catch(() => {});
await page.waitForTimeout(300);
const ta = page.locator('textarea').first();
await ta.fill(clip + '\n' + 'garbage SHR1:xyz').catch((e) => console.log('nota', e.message));
await page.getByRole('button', { name: /Add rankings/ }).click().catch(() => {});
await page.waitForTimeout(500);
console.log('RANKS2', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 900));
await shot(page, '05-ranks-pasted', true);
await browser.close();
