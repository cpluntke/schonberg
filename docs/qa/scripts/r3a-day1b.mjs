import { launch, ctxFor, nav, shot, text, run } from './r3a-lib.mjs';
const b = await launch();
const { page, save } = await ctxFor('alto', 0, 'sloppy');
for (const id of ['warmup-chorale', 'debussy-dieu']) {
  await nav(page, '#/piece/' + id); await shot(page, 'd1-piece-' + id, true); console.log('PIECE', id, await text(page));
  console.log('BTNS', await page.evaluate(() => [...document.querySelectorAll('section.ladder button')].map(b => b.getAttribute('aria-label')).join(' || ')));
}
await page.getByRole('button', { name: /How it works|help|\?/i }).first().click().catch(() => {});
await shot(page, 'd1-piece-help', true);
await b.close();
