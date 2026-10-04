// QA round 2: unit-level probes for regressions in src/game/scoring.ts after the round-1 fixes.
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r2-regressions --silent=false
import { describe, it, expect } from 'vitest';
import { makePart, makeScore, sampleSinging } from '../../../src/game/testutil';
import { scoreAttempt } from '../../../src/game/scoring';

const base = { toleranceCents: 35, tuning: 'equal' as const, octaveTolerant: false };

describe('R2 regressions', () => {
  it('octave-transposed singer (octaveTolerant): rhythm of legato steps', () => {
    // stepwise legato soprano line, 1 beat each at 60 bpm, perfect timing, sung an octave below
    const part = makePart('S', [[67, 1], [69, 1], [71, 1], [72, 1], [74, 1], [72, 1], [71, 1], [69, 1], [67, 1]]);
    const score = makeScore([part]);
    const ctx = { score, part, range: [0, part.notes.length - 1] as [number, number] };
    const inOct = scoreAttempt(ctx, sampleSinging(part, (n) => n.midi), { ...base, octaveTolerant: true });
    const below = scoreAttempt(ctx, sampleSinging(part, (n) => n.midi - 12), { ...base, octaveTolerant: true });
    console.log('R2-octave-rhythm', JSON.stringify({
      inOctave: { acc: inOct.accuracy, rhythm: inOct.rhythm },
      octaveBelow: { acc: below.accuracy, rhythm: below.rhythm, onsets: below.notes.map((n) => n.onsetMs && Math.round(n.onsetMs)), insights: below.insights.map((i) => i.title) },
    }));
    expect(below.accuracy).toBeGreaterThan(0.95);
    // Expected: same rhythm as the in-octave singer (timing is identical)
    expect(below.rhythm).toBeGreaterThan(0.9);
  });

  it('octave flag/insight at L1 for a same-register singer', () => {
    const part = makePart('S', [[67, 1], [69, 1], [71, 1], [72, 1]]);
    const score = makeScore([part]);
    const ctx = { score, part, range: [0, 3] as [number, number] };
    const r = scoreAttempt(ctx, sampleSinging(part, (n) => n.midi - 12), { ...base, toleranceCents: 50, octaveTolerant: true });
    console.log('R2-L1-octave', JSON.stringify({ acc: r.accuracy, flags: r.notes.map((n) => !!n.octave), insights: r.insights.map((i) => i.kind) }));
  });

  it('short-ish note (0.35 s) with one detector glitch sample', () => {
    // 0.35 s notes: body ≈ 0.35-0.08-0.04 = 0.23 s < 1.5×0.18 → whole-body mean judgement
    const spec: [number, number][] = Array.from({ length: 8 }, (_, i) => [60 + (i % 3) * 2, 0.35] as [number, number]);
    const part = makePart('S', spec);
    const score = makeScore([part]);
    const ctx = { score, part, range: [0, 7] as [number, number] };
    const glitch = (n: { midi: number }, t: number) => (Math.abs(t - 0.2) < 0.011 ? n.midi + 12 : n.midi);
    const clean = scoreAttempt(ctx, sampleSinging(part, (n) => n.midi), base);
    const g = scoreAttempt(ctx, sampleSinging(part, glitch), base);
    const g2 = scoreAttempt(ctx, sampleSinging(part, (n, t) => (Math.abs(t - 0.2) < 0.011 ? n.midi - 1 : n.midi)), base);
    console.log('R2-glitch', JSON.stringify({ clean: clean.accuracy, octaveGlitch: g.accuracy, grades: g.notes.map((n) => n.grade), semitoneGlitch: g2.accuracy, grades2: g2.notes.map((n) => n.grade) }));
  });

  it('long note (1 s) with one glitch sample', () => {
    const part = makePart('S', [[60, 1], [62, 1], [64, 1], [65, 1]]);
    const score = makeScore([part]);
    const ctx = { score, part, range: [0, 3] as [number, number] };
    const g = scoreAttempt(ctx, sampleSinging(part, (n, t) => (Math.abs(t - 0.5) < 0.011 ? n.midi + 12 : n.midi)), base);
    console.log('R2-glitch-long', JSON.stringify({ acc: g.accuracy, grades: g.notes.map((n) => n.grade), hit: g.notes.map((n) => +n.hitRatio.toFixed(2)) }));
  });

  it('just intonation: reported cents for an ET singer and a pure singer', () => {
    // C major triad: soprano E above C/G → JI third −13.7 c
    const sop = makePart('S', [[64, 4]]);
    const alt = makePart('A', [[60, 4]]);
    const ten = makePart('T', [[55, 4]]);
    const score = makeScore([sop, alt, ten]);
    const ctx = { score, part: sop, range: [0, 0] as [number, number] };
    const opts = { ...base, toleranceCents: 25, tuning: 'just' as const };
    const et = scoreAttempt(ctx, sampleSinging(sop, (n) => n.midi), opts);
    const pure = scoreAttempt(ctx, sampleSinging(sop, (n) => n.midi - 0.137), opts);
    const etFlat = scoreAttempt(ctx, sampleSinging(sop, (n) => n.midi - 0.30), opts);
    const etFlatEq = scoreAttempt(ctx, sampleSinging(sop, (n) => n.midi - 0.30), { ...opts, tuning: 'equal' });
    console.log('R2-JI', JSON.stringify({ et: [et.notes[0].cents, et.notes[0].grade], pure: [pure.notes[0].cents, pure.notes[0].grade], flat30: [etFlat.notes[0].cents, etFlat.notes[0].grade], flat30equal: [etFlatEq.notes[0].cents, etFlatEq.notes[0].grade] }));
  });

  it('rhythm: noise/voiced sample at note start after a rest counts as on-time onset', () => {
    const part = makePart('S', [[null, 2], [64, 2], [null, 2], [67, 2]]);
    const score = makeScore([part]);
    const ctx = { score, part, range: [0, 1] as [number, number] };
    // singer enters 400 ms late on each note but a 1-frame voiced blip appears right at the start
    const r = scoreAttempt(ctx, sampleSinging(part, (n, t) => (t < 0.021 ? n.midi + 7 : t < 0.4 ? null : n.midi)), base);
    const r0 = scoreAttempt(ctx, sampleSinging(part, (n, t) => (t < 0.4 ? null : n.midi)), base);
    console.log('R2-blip-onset', JSON.stringify({ withBlip: [r.rhythm, r.notes.map((n) => n.onsetMs)], noBlip: [r0.rhythm, r0.notes.map((n) => n.onsetMs)] }));
  });
});
