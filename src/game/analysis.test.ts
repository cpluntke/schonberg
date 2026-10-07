import { describe, expect, it } from 'vitest';
import { analyze, barList, worstWindow } from './analysis';
import { scoreAttempt, type ScoringContext } from './scoring';
import { makePart, makeScore, sampleSinging } from './testutil';
import type { ScoringOptions } from './types';
import type { Score } from '../music/types';

const opts: ScoringOptions = { toleranceCents: 25, tuning: 'equal', octaveTolerant: false };

// 8 bars at 60 bpm: long notes in bars 3 and 6, rests before bars 5 and 7.
const part = makePart('S', [
  [62, 1], [64, 1], [66, 1], [67, 1],
  [69, 2], [67, 2],
  [66, 4],
  [64, 1], [62, 1], [null, 2],
  [69, 1], [71, 1], [72, 2],
  [71, 4],
  [null, 2], [69, 1], [67, 1],
  [66, 4],
]);
const score = makeScore([part]);
// Printed bar numbers start at 10 to check that they are used.
score.measures.forEach((m, i) => (m.number = String(10 + i)));
const ctx: ScoringContext = { score, part, range: [0, part.notes.length - 1] };

describe('analyze', () => {
  it('detects sagging long notes and names printed bars', () => {
    const samples = sampleSinging(part, (n, t) => (n.dur >= 4 ? n.midi - 0.35 * (t / n.dur) : n.midi));
    const r = scoreAttempt(ctx, samples, opts);
    const ins = r.insights.find((i) => i.kind === 'flat-long-notes');
    expect(ins).toBeDefined();
    expect(ins!.detail).toMatch(/bars 12, 15 and 17/);
    expect(ins!.measures![1] - ins!.measures![0]).toBeGreaterThanOrEqual(1);
    expect(ins!.measures![1] - ins!.measures![0]).toBeLessThanOrEqual(3);
  });

  it('detects rising long notes', () => {
    const samples = sampleSinging(part, (n, t) => (n.dur >= 4 ? n.midi + 0.3 * (t / n.dur) : n.midi));
    expect(scoreAttempt(ctx, samples, opts).insights.map((i) => i.kind)).toContain('sharp-long-notes');
  });

  it('detects late entries after rests', () => {
    const entries = new Set([0, 9, 13]);
    const samples = sampleSinging(part, (n, t, i) => (entries.has(i) && t < 0.4 ? null : n.midi));
    const r = scoreAttempt(ctx, samples, opts);
    const ins = r.insights.find((i) => i.kind === 'late-entries');
    expect(ins).toBeDefined();
    expect(ins!.detail).toMatch(/ms late/);
  });

  it('detects early entries from samples before the note start', () => {
    // sing the entry pitch 200 ms before each entry
    const entryStarts = [part.notes[9].start, part.notes[13].start];
    const base = sampleSinging(part, (n) => n.midi);
    const samples = base.map((s) => {
      for (const [k, st] of entryStarts.entries()) {
        if (s.time >= st - 0.25 && s.time < st) return { ...s, midi: part.notes[k === 0 ? 9 : 13].midi };
      }
      return s;
    });
    const r = scoreAttempt(ctx, samples, opts);
    expect(r.insights.map((i) => i.kind)).toContain('early-entries');
  });

  it('detects missed leaps', () => {
    const leap = makePart('S', [[60, 1], [67, 1], [60, 1], [69, 1], [62, 1], [74, 1], [62, 1], [62, 1]]);
    const c: ScoringContext = { score: makeScore([leap]), part: leap, range: [0, 7] };
    const samples = sampleSinging(leap, (n, _t, i) => (i > 0 && Math.abs(n.midi - leap.notes[i - 1].midi) >= 5 ? n.midi - 1 : n.midi));
    const r = scoreAttempt(c, samples, opts);
    expect(r.insights.map((i) => i.kind)).toContain('leaps');
  });

  it('at most 3 insights, sorted by severity', () => {
    const samples = sampleSinging(part, (n, t, i) => (i % 3 === 0 ? null : t < 0.15 ? n.midi - 1 : n.midi - 0.2 - (n.dur >= 4 ? 0.3 * t / n.dur : 0)));
    const r = scoreAttempt(ctx, samples, opts);
    expect(r.insights.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < r.insights.length; i++) expect(r.insights[i - 1].severity).toBeGreaterThanOrEqual(r.insights[i].severity);
  });

  it('missed-notes cluster points at the worst bars', () => {
    // bars 5-6 (indices 4,5) silent
    const samples = sampleSinging(part, (n) => (n.measure === 4 || n.measure === 5 ? null : n.midi));
    const r = scoreAttempt(ctx, samples, opts);
    const ins = r.insights.find((i) => i.kind === 'missed-notes');
    expect(ins).toBeDefined();
    expect(ins!.measures).toEqual([4, 5]);
    expect(ins!.title).toContain('bars 14–15');
  });

  it('great run gets praise', () => {
    const r = scoreAttempt(ctx, sampleSinging(part, (n) => n.midi), opts);
    expect(r.insights).toHaveLength(1);
    expect(r.insights[0].kind).toBe('great');
  });

  it('empty notes → no insights', () => expect(analyze(ctx, [])).toEqual([]));
});

describe('worstWindow', () => {
  it('finds the worst 2–4 bar cluster', () => {
    const bad = new Map([[1, 0.1], [5, 1], [6, 0.9], [7, 0.2], [12, 0.3]]);
    expect(worstWindow(bad, [0, 15])).toEqual([5, 7]);
  });
  it('a single bad bar is widened to two bars', () => {
    expect(worstWindow(new Map([[3, 1]]), [0, 9])).toEqual([3, 4]);
    expect(worstWindow(new Map([[9, 1]]), [0, 9])).toEqual([8, 9]);
  });
});

describe('bar lists in coach notes', () => {
  const score = (nums: string[]) => ({ measures: nums.map((number) => ({ number })) }) as unknown as Score;
  it('a pickup bar numbered 0 is "the upbeat", as in the bar strip and the section names', () => {
    const up = score(['0', '1', '2', '3', '4', '5']);
    expect(barList(up, [2, 0, 1])).toBe('the upbeat and bars 1 and 2');
    expect(barList(up, [0])).toBe('the upbeat');
    expect(barList(up, [0, 1])).toBe('the upbeat and bar 1');
    expect(barList(up, [0, 1, 2, 3, 4])).toBe('the upbeat and bars 1, 2, 3 and elsewhere');
    expect(barList(up, [3, 5])).toBe('bars 3 and 5');
    // No pickup: plain numbers.
    expect(barList(score(['1', '2', '3']), [0, 2])).toBe('bars 1 and 3');
    expect(barList(score(['1', '2', '3']), [1])).toBe('bar 2');
  });
});
