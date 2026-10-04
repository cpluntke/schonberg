import { it } from 'vitest';
import { synthPassage, renderTake, scoreTake } from './fastnotes';
import { SINGERS } from './singer';
import { AFTER, type PipelineSpec } from './pipeline';
import { gitVariant } from './variants';
it('behind', async () => {
  const base = await gitVariant('54ea7b9');
  const specs: Record<string, PipelineSpec> = { base: { ...AFTER, impl: base.impl, pitch: base.pitch, pitchKey: base.key }, both: AFTER };
  for (const [sn, singer] of [['behind', SINGERS.oneBehind], ['late', SINGERS.lateArriver]] as const)
  for (const bpm of [104, 120, 144]) for (const ly of ['ta', 'a', null] as const) for (const level of [2, 4]) {
    const p = synthPassage(bpm, 0.25, ly);
    const take = renderTake(p, singer, level, 1);
    const row = Object.entries(specs).map(([k, s]) => { const o = scoreTake(p, take, level, 1, s).outcome; return `${k}: acc ${o.result.accuracy.toFixed(2)} plain ${o.plain.accuracy.toFixed(2)} al ${o.alignedMs} ${o.passed ? 'PASS' : ''}`; });
    console.log(sn, p.id.padEnd(24), 'L' + level, row.join(' | '));
  }
});
