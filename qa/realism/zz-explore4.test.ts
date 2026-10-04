import { it } from 'vitest';
import { PASSAGES, renderTake, scoreTake, diagnose } from './fastnotes';
import { SINGERS } from './singer';
import { AFTER } from './pipeline';
import { gitVariant } from './variants';
import { resolve } from 'node:path';
import * as cur from '../../src/game/scoring';
it('by passage', async () => {
  const head = await gitVariant('HEAD');
  const headMod = await import(/* @vite-ignore */ resolve(__dirname, 'out/variants/scoring-git-HEAD.ts'));
  const before = { ...AFTER, impl: head.impl, pitch: head.pitch, pitchKey: head.key };
  const ps = (await PASSAGES()).filter(p => p.id.includes('16ths') || !p.id.startsWith('synth'));
  for (const p of ps) {
    const row: string[] = [];
    for (const level of [2, 4]) {
      let fb = 0, fa = 0, fn = 0, ob = 0;
      for (const seed of [1, 2, 3]) {
        const take = renderTake(p, SINGERS.goodChoir, level, seed);
        const db = diagnose(scoreTake(p, take, level, seed, before), headMod);
        const da = diagnose(scoreTake(p, take, level, seed, AFTER), cur);
        db.notes.forEach((n, k) => { if (n.realDur < 0.2) { fn++; if (n.grade === 'miss' || n.grade === 'ok') fb++; const a = da.notes[k]; if (a.grade === 'miss' || a.grade === 'ok') fa++; if (a.oracleGrade === 'miss') ob++; } });
      }
      row.push(`L${level}: n ${fn} miss ${(100*fb/Math.max(1,fn)).toFixed(1)}% → ${(100*fa/Math.max(1,fn)).toFixed(1)}% (oracle ${(100*ob/Math.max(1,fn)).toFixed(1)}%)`);
    }
    console.log(p.id.padEnd(30), row.join(' | '));
  }
});
