// Level 1 on "doo" with the every-note rule: honest singers must still pass reliably at 70% tempo
// (report section 8). Guards: on "doo", each good voice passes at least 95% of its runs.
import { expect, it } from 'vitest';
import { writePart } from './compare';
import { l1Grid } from './l1doo';
import { SINGERS } from './singer';

it('level 1 on doo: good singers, every note right', async () => {
  const cells = await l1Grid({
    seeds: 5,
    singers: [SINGERS.goodChoir, SINGERS.operatic, SINGERS.plainControl, SINGERS.ringing, SINGERS.slowTransitions],
  });
  writePart('l1-doo', cells);
  for (const c of cells.filter((x) => x.doo)) {
    expect.soft(c.passes / c.runs, `${c.singer} on doo, ${c.latency}: share of runs passing level 1`).toBeGreaterThanOrEqual(0.95);
  }
});
