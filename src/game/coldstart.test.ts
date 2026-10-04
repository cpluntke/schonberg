import { describe, expect, it } from 'vitest';
import { leadInFrom, pickColdStart } from './coldstart';
import { makePart, makeScore } from './testutil';

const part = makePart('S', [[60, 4], [62, 4], [null, 4], [64, 4], [65, 4], [67, 4]]);
const score = makeScore([part]);

describe('cold start', () => {
  it('picks a bar with notes, about four bars long, two bars of lead-in', () => {
    for (let k = 0; k < 50; k++) {
      const c = pickColdStart(score, part, {}, { rand: () => k / 50 })!;
      expect(c.bar).not.toBe(2); // the bar of rests
      expect(c.from).toBe(score.measures[c.bar].start);
      expect(c.to).toBeGreaterThan(c.from);
    }
    expect(leadInFrom(score, 4)).toBe(score.measures[2].start);
    expect(leadInFrom(score, 1)).toBe(0);
  });
  it('prefers bars you do not know yet and avoids the last one', () => {
    const bars = { 0: { ema: 1, mem: 1, off: 1, n: 3, at: 0 }, 1: { ema: 1, mem: 1, off: 1, n: 3, at: 0 }, 3: { ema: 0.2, n: 1, at: 0 } };
    const counts: Record<number, number> = {};
    for (let k = 0; k < 400; k++) {
      const c = pickColdStart(score, part, bars, { rand: () => (k + 0.5) / 400, avoid: 5 })!;
      counts[c.bar] = (counts[c.bar] ?? 0) + 1;
    }
    expect(counts[5]).toBeUndefined();
    expect(counts[3]).toBeGreaterThan(counts[0]);
  });
});
