// Before/after: good singers × latency × sections at L4, plus L2 sequences near the old learning cliff.
import { it } from 'vitest';
import { writePart } from './compare';
import { grid, l2Sequences } from './cmp-experiments';

it('grid L4 (before vs after, 3-run sequences when uncalibrated)', async () => {
  writePart('grid-l4', await grid(4));
});

it('L2 three-run sequences around the old delay-learning threshold', async () => {
  writePart('seq-l2', await l2Sequences());
});
