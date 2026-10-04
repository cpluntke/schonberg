// QA round 2: compare HEAD scoring vs pre-fix scoring (bb83fbc) on detector glitches.
import { it } from 'vitest';
import { makePart, makeScore, sampleSinging } from '../../../src/game/testutil';
import { scoreAttempt } from '../../../src/game/scoring';
import { scoreAttempt as oldScore } from './r2-old/scoring';
const base = { toleranceCents: 35, tuning: 'equal' as const, octaveTolerant: false };
it('glitch compare', () => {
  for (const dur of [0.3, 0.35, 0.45, 0.6, 1.0]) {
    const spec: [number, number][] = Array.from({ length: 8 }, (_, i) => [60 + (i % 3) * 2, dur] as [number, number]);
    const part = makePart('S', spec);
    const ctx = { score: makeScore([part]), part, range: [0, 7] as [number, number] };
    const row: Record<string, unknown> = { dur };
    for (const [name, sing] of [
      ['clean', (n: any) => n.midi],
      ['1 frame +12', (n: any, t: number) => (Math.abs(t - dur * 0.55) < 0.011 ? n.midi + 12 : n.midi)],
      ['1 frame -12', (n: any, t: number) => (Math.abs(t - dur * 0.55) < 0.011 ? n.midi - 12 : n.midi)],
      ['2 frames +7', (n: any, t: number) => (Math.abs(t - dur * 0.55) < 0.021 ? n.midi + 7 : n.midi)],
    ] as const) {
      const s = sampleSinging(part, sing as any);
      row[name] = `${Math.round(scoreAttempt(ctx, s, base).accuracy * 100)} (old ${Math.round(oldScore(ctx, s, base).accuracy * 100)})`;
    }
    console.log('R2-cmp', JSON.stringify(row));
  }
});
