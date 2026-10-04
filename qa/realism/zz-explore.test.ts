import { it } from 'vitest';
import { PASSAGES, renderRun, diagnose, bucketOf, DUR_BUCKETS } from './fastnotes';
import { SINGERS } from './singer';
it('explore', async () => {
  const ps = await PASSAGES();
  const agg: Record<string, Record<string, number>> = {};
  const reasons: Record<string, Record<string, number>> = {};
  const acc: Record<string, number[]> = {};
  for (const p of ps) {
    for (const level of [1, 2, 4]) {
      for (const seed of [1, 2, 3]) {
        const run = renderRun(p, SINGERS.goodChoir, level, seed);
        const d = diagnose(run);
        const g = (p.id.startsWith('synth') ? p.id.replace(/ (ta|a|nolyr)$/, '') : p.id) ;
        (acc[`${g} L${level}`] ??= []).push(run.outcome.result.accuracy);
        for (const n of d.notes) {
          const key = `${bucketOf(n.realDur)} L${level}`;
          const a = (agg[key] ??= { n: 0, perfect: 0, good: 0, ok: 0, miss: 0, oBad: 0, liveBad: 0 });
          a.n++; a[n.grade]++;
          if (n.oracleGrade === 'ok' || n.oracleGrade === 'miss') a.oBad++;
          if (n.liveGrade === 'ok' || n.liveGrade === 'miss') a.liveBad++;
          if (n.reason !== 'hit') { const r = (reasons[bucketOf(n.realDur)] ??= {}); r[n.reason] = (r[n.reason] ?? 0) + 1; }
        }
      }
    }
  }
  for (const [k, v] of Object.entries(acc)) console.log(k.padEnd(40), v.map(x => x.toFixed(2)).join(' '));
  for (const [k, v] of Object.entries(agg).sort()) console.log(k.padEnd(20), JSON.stringify(v));
  for (const [k, v] of Object.entries(reasons)) console.log(k, JSON.stringify(v));
});
