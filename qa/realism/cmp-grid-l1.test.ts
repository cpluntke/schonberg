// Before/after: good singers × latency × sections at L1 (see compare.ts).
import { it } from 'vitest';
import { writePart } from './compare';
import { grid } from './cmp-experiments';

it('grid L1 (before vs after, 3-run sequences when uncalibrated)', async () => {
  writePart('grid-l1', await grid(1));
});
