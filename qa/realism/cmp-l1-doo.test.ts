// Level 1 on "doo" with the every-note rule: honest singers must still pass reliably at 70% tempo
// (report section 8). Guards: on "doo", each good voice passes at least 95% of its runs (headphones).
// The phone speaker (the backing, the own part included, bleeding into the mic at −13 dB) is
// reported for two voices, not guarded (see observations).
import { expect, it } from 'vitest';
import { writePart } from './compare';
import { SPEAKER, l1Grid } from './l1doo';
import { SINGERS } from './singer';

it('level 1 on doo: good singers, every note right', async () => {
  const cells = await l1Grid({
    seeds: 5,
    singers: [SINGERS.goodChoir, SINGERS.operatic, SINGERS.plainControl, SINGERS.ringing, SINGERS.slowTransitions],
  });
  const speaker = await l1Grid({ seeds: 5, singers: [SINGERS.goodChoir, SINGERS.operatic], channel: SPEAKER, lyrics: false });
  writePart('l1-doo', [...cells, ...speaker]);
  for (const c of cells.filter((x) => x.doo)) {
    expect.soft(c.passes / c.runs, `${c.singer} on doo, ${c.latency}: share of runs passing level 1`).toBeGreaterThanOrEqual(0.95);
  }
});
