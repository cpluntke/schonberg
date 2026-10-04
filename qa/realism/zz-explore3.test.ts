import { it } from 'vitest';
import { PASSAGES, renderTake, scoreTake } from './fastnotes';
import { SINGERS, type SingerProfile } from './singer';
import { AFTER, type PipelineSpec } from './pipeline';
import { gitVariant } from './variants';
declare const process: { env: Record<string, string | undefined> };
it('combos', async () => {
  const base = await gitVariant('54ea7b9');
  const specs: Record<string, PipelineSpec> = {
    base: { ...AFTER, impl: base.impl, pitch: base.pitch, pitchKey: base.key },
    pitch: { ...AFTER, impl: base.impl },
    score: { ...AFTER, pitch: base.pitch, pitchKey: base.key },
    both: AFTER,
  };
  const all = await PASSAGES();
  const ps = process.env.ONLY ? all.filter(p => p.id.includes(process.env.ONLY!)) : all;
  const singers: [string, SingerProfile][] = [['good', SINGERS.goodChoir], ['wrong', SINGERS.wrongNotes], ['flat40', SINGERS.flat40], ['behind', SINGERS.oneBehind], ['echo', SINGERS.echo300], ['late', SINGERS.lateArriver]];
  const seeds = (process.env.SEEDS ?? '1,2').split(',').map(Number);
  const out: Record<string, Record<string, { acc: number[]; pass: number; n: number; fmiss: number; fn: number }>> = {};
  const passList: Record<string, string[]> = {};
  for (const [sname, singer] of singers) {
    for (const p of ps) for (const level of [1, 2, 4]) for (const seed of (sname === 'good' ? seeds : [seeds[0]])) {
      const take = renderTake(p, singer, level, seed);
      for (const [vname, spec] of Object.entries(specs)) {
        const run = scoreTake(p, take, level, seed, spec);
        const r = run.outcome.result;
        const key = `${sname} L${level}`;
        const e = ((out[key] ??= {})[vname] ??= { acc: [], pass: 0, n: 0, fmiss: 0, fn: 0 });
        e.acc.push(r.accuracy); e.n++; if (run.outcome.passed) { e.pass++; if (sname !== 'good') (passList[`${key} ${vname}`] ??= []).push(p.id); }
        for (const n of r.notes) if (p.part.notes[n.index].dur / take.rate < 0.15) { e.fn++; if (n.grade === 'miss' || n.grade === 'ok') e.fmiss++; }
      }
    }
  }
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  for (const [k, vs] of Object.entries(out)) console.log(k.padEnd(10), Object.entries(vs).map(([vn, e]) => `${vn}: ${mean(e.acc).toFixed(3)} min ${Math.min(...e.acc).toFixed(2)} pass ${e.pass}/${e.n} fm ${(100*e.fmiss/Math.max(1,e.fn)).toFixed(1)}%`).join(' | '));
  for (const [k, v] of Object.entries(passList)) console.log('PASS', k, v.join(', '));
});
