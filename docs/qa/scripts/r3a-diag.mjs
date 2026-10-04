import { launch, ctxFor, nav, shot, text } from './r3a-lib.mjs';
const b = await launch();
const { page, save } = await ctxFor('alto', 0, process.argv[2] || 'sloppy');
await nav(page, '#/play/debussy-dieu/P2/s0-m0-4?level=1');
await page.getByTestId('start').click();
for (let i = 0; i < 12; i++) { await page.waitForTimeout(5000); console.log(i * 5 + 5, page.url().split('#')[1], (await text(page)).slice(0, 160)); if (/results/.test(page.url())) break; }
await shot(page, 'diag-end');
await save();
await b.close();
