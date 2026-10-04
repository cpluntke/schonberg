import { it } from 'vitest';
import { PASSAGES, renderTake, scoreTake, diagnose, bucketOf, type NoteDiag } from './fastnotes';
import { SINGERS, type SingerProfile } from './singer';
import { AFTER } from './pipeline';
import { gitVariant } from './variants';
import * as cur from '../../src/game/scoring';
declare const process: { env: Record<string, string | undefined> };
it('explore', async () => {
  const head = await gitVariant('HEAD');
  const headMod = await import(/* @vite-ignore */ require('node:path').resolve(__dirname, 'out/variants/scoring-git-HEAD.ts'));
  const specs = { before: { ...AFTER, impl: head.impl, pitch: head.pitch, pitchKey: head.key }, after: AFTER };
  const ps = await PASSAGES();
  const singers: SingerProfile[] = process.env.ADV ? [SINGERS.wrongNotes, SINGERS.flat40, SINGERS.oneBehind, SINGERS.echo300, SINGERS.lateArriver] : [SINGERS.goodChoir];
  const seeds = process.env.ADV ? [1] : [1, 2, 3];
  for (const singer of singers) {
  const agg: Record<string, Record<string, number>> = {};
  const reasons: Record<string, Record<string, number>> = {};
  const acc: Record<string, number[]> = {};
  const passes: Record<string, number> = {};
  for (const p of ps) {
    for (const level of [1, 2, 4]) {
      for (const seed of seeds) {
        const take = renderTake(p, singer, level, seed);
        for (const [label, spec] of Object.entries(specs)) {
          const run = scoreTake(p, take, level, seed, spec);
          const d = diagnose(run, label === 'before' ? headMod : cur);
          if (d.mismatches) console.log('MISMATCH', label, p.id, level, d.mismatches);
          const g = (p.id.startsWith('synth') ? p.id.replace(/ (ta|a|nolyr)$/, '') : p.id);
          (acc[`${g} L${level} ${label}`] ??= []).push(run.outcome.result.accuracy);
          passes[`L${level} ${label}`] = (passes[`L${level} ${label}`] ?? 0) + (run.outcome.passed ? 1 : 0);
          for (const n of d.notes) {
            const key = `${bucketOf(n.realDur)} L${level} ${label}`;
            const a = (agg[key] ??= { n: 0, perfect: 0, good: 0, ok: 0, miss: 0, oBad: 0, liveBad: 0 });
            a.n++; a[n.grade]++;
            if (n.oracleGrade === 'ok' || n.oracleGrade === 'miss') a.oBad++;
            if (n.liveGrade === 'ok' || n.liveGrade === 'miss') a.liveBad++;
            if (n.reason !== 'hit') { const r = (reasons[`${bucketOf(n.realDur)} ${label}`] ??= {}); r[n.reason] = (r[n.reason] ?? 0) + 1; }
          }
        }
      }
    }
  }
  console.log('#### singer', singer.name);
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  for (const [k, v] of Object.entries(acc)) if (k.endsWith('before')) { const ka = k.replace(/before$/, 'after'); console.log(k.replace(/ before$/, '').padEnd(36), 'before', mean(v).toFixed(3), 'min', Math.min(...v).toFixed(2), '| after', mean(acc[ka]).toFixed(3), 'min', Math.min(...acc[ka]).toFixed(2)); }
  console.log('passes', JSON.stringify(passes));
  for (const [k, v] of Object.entries(agg).sort()) console.log(k.padEnd(28), JSON.stringify(v));
  for (const [k, v] of Object.entries(reasons).sort()) console.log(k, JSON.stringify(v));
  }
});
