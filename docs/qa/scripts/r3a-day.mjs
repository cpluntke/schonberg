// usage: node r3a-day.mjs <tag> <dayOffset> <sim> '<json list of tasks>'
// task: {p:'debussy-dieu', btn:'Bars 1–5, level 1 Note-learning'} or {hash:'#/...'} or {home:true}
import { launch, ctxFor, nav, shot, text, run } from './r3a-lib.mjs';
const [tag, off, sim, tasksJson] = process.argv.slice(2);
const tasks = JSON.parse(tasksJson);
const b = await launch();
const { page, save } = await ctxFor('alto', Number(off), sim);
await shot(page, `${tag}-00-home`, true); console.log('HOME', await text(page));
let i = 0;
for (const t of tasks) {
  i++;
  const name = `${tag}-${String(i).padStart(2, '0')}-${(t.name || t.btn || 'x').replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}`;
  let h = t.hash;
  if (t.home) { await nav(page, '#/'); await page.getByRole('button', { name: /Practise now|Review now|Practi/ }).first().click(); await page.waitForTimeout(800); h = '#' + page.url().split('#')[1]; }
  if (t.p) { await page.goto(page.url().split('#')[0] + '#/piece/' + t.p); await page.waitForTimeout(900); await page.getByRole('button', { name: t.btn, exact: !t.loose }).first().click(); await page.waitForTimeout(800); h = '#' + page.url().split('#')[1]; }
  console.log('TASK', name, h);
  const r = await run(page, h, name, { midShot: t.mid !== false });
  console.log('RES', name, r.slice(0, 1500));
  await save();
  if (t.loop) { // click first coach-note loop drill
    const lb = page.getByRole('button', { name: /^Loop bars/ }).first();
    if (await lb.count()) { await lb.click(); await page.waitForTimeout(800); const hh = '#' + page.url().split('#')[1]; console.log('LOOP', hh);
      const r2 = await run(page, hh, name + '-loop', { midShot: true }); console.log('RESLOOP', r2.slice(0, 900)); await save(); }
  }
}
await nav(page, '#/'); await shot(page, `${tag}-99-home`, true); console.log('HOMEEND', await text(page));
await save();
await b.close();
