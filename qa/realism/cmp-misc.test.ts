// Before/after: tracker fidelity, speaker bleed sweep, ablation.
import { execSync } from 'node:child_process';
import { it } from 'vitest';
import { windowFor } from '../../src/audio/pitch';
import { writePart } from './compare';
import { PLAY_POLICY } from './pipeline';
import { REPO_ROOT } from './scores';
import { ablation, bleed, fidelityRows } from './cmp-experiments';

it('meta: what "after" mirrors', () => {
  const sh = (c: string) => { try { return execSync(c, { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
  writePart('meta', {
    head: sh('git rev-parse --short HEAD'),
    dirty: sh('git status --porcelain -- src').split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => !f.endsWith('.test.ts')),
    policy: PLAY_POLICY.detected,
    windowN: windowFor(55, 48000),
  });
});

it('tracker fidelity (before vs after)', async () => {
  writePart('fidelity', await fidelityRows());
});

it('speaker bleed sweep (before vs after)', async () => {
  writePart('bleed', await bleed());
});

it('ablation (before vs after)', async () => {
  writePart('ablation', await ablation());
});
