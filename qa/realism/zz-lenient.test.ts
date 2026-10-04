import { it } from 'vitest';
import { PASSAGES, renderTake, scoreTake } from './fastnotes';
import { SINGERS, type SingerProfile } from './singer';
import { AFTER } from './pipeline';
it('leniency', async () => {
  const all = await PASSAGES();
  const singers: [string, SingerProfile][] = [['good', SINGERS.goodChoir], ['wrong', SINGERS.wrongNotes], ['flat40', SINGERS.flat40], ['behind', SINGERS.oneBehind]];
  const out: Record<string, Record<string, { acc: number[]; pass: number; n: number; fm: number; fn: number }>> = {};
  for (const [sn, singer] of singers) for (const p of all) for (const level of [1, 2, 4]) for (const seed of (sn === 'good' ? [1, 2] : [1])) {
    const take = renderTake(p, singer, level, seed);
    for (const B of ['both', 'pre', 'none', 'post'] as const) {
      (globalThis as any).__SLK = { both: { pre: 0.03, post: 0.03 }, pre: { pre: 0.03, post: 0 }, none: { pre: 0, post: 0 }, post: { pre: 0, post: 0.03 } }[B];
      const o = scoreTake(p, take, level, seed, AFTER).outcome;
      const e = ((out[`${sn} L${level}`] ??= {})[B] ??= { acc: [], pass: 0, n: 0, fm: 0, fn: 0 });
      e.acc.push(o.result.accuracy); e.n++; if (o.passed) e.pass++;
      for (const n of o.result.notes) if (p.part.notes[n.index].dur / take.rate < 0.25) { e.fn++; if (n.grade === 'miss' || n.grade === 'ok') e.fm++; }
    }
  }
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  for (const [k, vs] of Object.entries(out)) console.log(k.padEnd(10), Object.entries(vs).map(([vn, e]) => `${vn}: ${mean(e.acc).toFixed(3)} min ${Math.min(...e.acc).toFixed(2)} pass ${e.pass}/${e.n} short-lost ${(100*e.fm/Math.max(1,e.fn)).toFixed(1)}%`).join(' | '));
});
