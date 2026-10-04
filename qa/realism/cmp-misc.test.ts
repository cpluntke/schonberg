// Before/after: tracker fidelity, speaker bleed sweep, ablation.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { scoreRecordingApp, type Sidecar } from './harness';
import { render, T, OUT_DIR } from './compare';
import { AFTER, UNCALIBRATED, runSession } from './pipeline';
import { SINGERS } from './singer';
import { writeWav16 } from './wav';
import { windowFor } from '../../src/audio/pitch';
import { writePart } from './compare';
import { PLAY_POLICY } from './pipeline';
import { REPO_ROOT } from './scores';
import { ablation, bleed, fidelityRows } from './cmp-experiments';

it('meta: what "after" mirrors', () => {
  const sh = (c: string) => { try { return execSync(c, { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
  writePart('meta', {
    head: sh('git rev-parse --short HEAD'),
    dirty: sh('git status --porcelain -- src').split('\n').filter(Boolean).map((l: string) => l.slice(3)).filter((f: string) => !f.endsWith('.test.ts')),
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

it('real-recording path: WAV + app sidecar through scoreRecordingApp matches the direct pipeline', async () => {
  const setup = await render({ target: T.dieu0, singer: SINGERS.goodChoir, level: 2, trueLatencyMs: 200, performanceSeed: 1, microSeed: 1 });
  const direct = runSession(AFTER, setup, UNCALIBRATED);
  mkdirSync(OUT_DIR, { recursive: true });
  const wav = resolve(OUT_DIR, 'example-current-dieu-1-5-alto-L2-true200.wav');
  writeFileSync(wav, writeWav16(setup.take.pcm, setup.take.sampleRate));
  const sc: Sidecar = {
    version: 1, pieceId: 'debussy-dieu', partId: setup.part.id, from: setup.from, to: setup.to, rate: setup.take.rate, level: 2,
    toleranceCents: 35, tuning: 'equal', octaveTolerant: false, latencyMs: direct.latencyUsedMs, calibrated: false,
    sampleRate: setup.take.sampleRate, scoreTimeAtSample0: setup.take.scoreTimeAtSample0, windowN: direct.windowN,
  };
  writeFileSync(wav.replace(/\.wav$/, '.json'), JSON.stringify(sc, null, 2));
  const viaWav = await scoreRecordingApp(wav, wav.replace(/\.wav$/, '.json'));
  writePart('roundtrip', { direct: direct.result.accuracy, viaWav: viaWav.result.accuracy, alignedDirect: direct.alignedMs, alignedWav: viaWav.alignedMs });
  expect(Math.abs(viaWav.result.accuracy - direct.result.accuracy)).toBeLessThan(0.05);
});
