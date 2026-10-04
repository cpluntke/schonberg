// Before/after: repeatability across seeds.
import { it } from 'vitest';
import { writePart } from './compare';
import { repeatability } from './cmp-experiments';

it('repeatability (before vs after)', async () => {
  writePart('repeat', await repeatability());
});
