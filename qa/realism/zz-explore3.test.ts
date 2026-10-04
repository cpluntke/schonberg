import { it } from 'vitest';
import { PASSAGES, renderTake, scoreTake, diagnose, bucketOf } from './fastnotes';
import { SINGERS, type SingerProfile } from './singer';
import { AFTER } from './pipeline';
import { levelSetup } from './harness';
declare const process: { env: Record<string, string | undefined> };
const VARIANTS: Record<string, unknown> = JSON.parse(process.env.VARIANTS ?? '{"base":{}}');
it('variants', async () => {
  const all = await PASSAGES();
  const ps = process.env.ONLY ? all.filter(p => p.id.includes(process.env.ONLY!)) : all;
  const singers: [string, SingerProfile][] = [['good', SINGERS.goodChoir], ['wrong', SINGERS.wrongNotes], ['flat40', SINGERS.flat40], ['behind', SINGERS.oneBehind], ['late', SINGERS.lateArriver]];
  const seeds = (process.env.SEEDS ?? '1,2').split(',').map(Number);
  const out: Record<string, Record<string, { acc: number[]; pass: number; n: number; fmiss: number; fn: number }>> = {};
  for (const [sname, singer] of singers) {
    for (const p of ps) for (const level of [1, 2, 4]) for (const seed of (sname === 'good' ? seeds : [seeds[0]])) {
      const take = renderTake(p, singer, level, seed);
      for (const [vname, v] of Object.entries(VARIANTS)) {
        (globalThis as any).__FAST = v;
        const run = scoreTake(p, take, level, seed, AFTER);
        const d = diagnose(run);
        const key = `${sname} L${level}`;
        const e = ((out[key] ??= {})[vname] ??= { acc: [], pass: 0, n: 0, fmiss: 0, fn: 0 });
        e.acc.push(run.outcome.result.accuracy); e.n++; if (run.outcome.passed) e.pass++;
        for (const n of d.notes) if (n.realDur < 0.15) { e.fn++; if (n.grade === 'miss' || n.grade === 'ok') e.fmiss++; }
      }
    }
  }
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  for (const [k, vs] of Object.entries(out)) console.log(k.padEnd(10), Object.entries(vs).map(([vn, e]) => `${vn}: acc ${mean(e.acc).toFixed(3)} min ${Math.min(...e.acc).toFixed(2)} pass ${e.pass}/${e.n} fastMiss ${(100*e.fmiss/Math.max(1,e.fn)).toFixed(1)}%`).join(' | '));
});
