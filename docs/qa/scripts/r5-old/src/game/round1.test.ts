import { describe, it, expect } from 'vitest';
import { makePart, makeScore, sampleSinging } from './testutil';
import { scoreAttempt } from './scoring';

const opts = { toleranceCents: 25, tuning: 'equal' as const, octaveTolerant: false };

describe('QA round 1 fixes', () => {
  it('rhythm is independent of intonation (in time but a semitone off)', () => {
    const part = makePart('S', [[60, 1], [62, 1], [64, 1], [null, 1], [65, 1], [67, 1]]);
    const score = makeScore([part]);
    const ctx = { score, part, range: [0, part.notes.length - 1] as [number, number] };
    const samples = sampleSinging(part, (n) => n.midi + 1);
    const r = scoreAttempt(ctx, samples, opts);
    expect(r.pitch).toBeLessThan(0.2);
    expect(r.rhythm).toBeGreaterThan(0.8);
  });

  it('a run with clearly wrong notes gets a wrong-notes insight', () => {
    const part = makePart('S', [[60, 1], [62, 1], [64, 1], [65, 1], [67, 1], [69, 1]]);
    const score = makeScore([part]);
    const ctx = { score, part, range: [0, part.notes.length - 1] as [number, number] };
    const samples = sampleSinging(part, (n, _t, i) => (i % 2 ? n.midi + 0.9 : n.midi));
    const r = scoreAttempt(ctx, samples, opts);
    expect(r.insights.some((i) => i.kind === 'wrong-notes')).toBe(true);
  });

  it('a failed run always has at least one insight', () => {
    const part = makePart('S', [[60, 1], [62, 1], [64, 1], [65, 1]]);
    const score = makeScore([part]);
    const ctx = { score, part, range: [0, 3] as [number, number] };
    const samples = sampleSinging(part, (n, t) => (t < 0.45 ? n.midi : null));
    const r = scoreAttempt(ctx, samples, opts);
    expect(r.accuracy).toBeLessThan(0.85);
    expect(r.insights.length).toBeGreaterThan(0);
  });

  it('silence is reported as a mic/volume problem', () => {
    const part = makePart('S', [[60, 1], [62, 1], [64, 1], [65, 1]]);
    const score = makeScore([part]);
    const ctx = { score, part, range: [0, 3] as [number, number] };
    const samples = sampleSinging(part, () => null);
    const r = scoreAttempt(ctx, samples, opts);
    expect(r.insights[0]?.kind).toBe('quiet');
  });
});
