import { describe, expect, it } from 'vitest';
import { exposedBeats, exposedNotes } from './exposure';
import { makePart, makeScore, singRealistic } from '../game/testutil';
import { beatGrid } from '../audio/player';
import { soloTimingInsight } from '../game/analysis';

// Bars 1–2 together, bars 3–4 the soprano alone (alto rests), bar 5 together again. 60 bpm, 4/4.
const S = makePart('S', [[67, 1], [69, 1], [71, 1], [72, 1], [74, 1], [72, 1], [71, 2], [69, 1], [67, 1], [69, 1], [71, 1], [72, 1], [71, 1], [69, 1], [67, 1], [67, 4]]);
const A = makePart('A', [[60, 4], [62, 4], [null, 8], [64, 4]]);
const score = makeScore([S, A]);
const beats = beatGrid(score, 0, 20);

describe('exposure', () => {
  it('finds the stretch where nothing audible plays', () => {
    const ex = exposedBeats(score, new Set(['A']), beats, 4);
    expect([...ex].sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    // With the guide (own part audible) there is no gap at all.
    expect(exposedBeats(score, new Set(['A', 'S']), beats, 4).size).toBe(0);
    // Short gaps don't count.
    expect(exposedBeats(score, new Set(['A']), beats, 9).size).toBe(0);
  });
  it("lists the singer's notes in it", () => {
    const ex = exposedBeats(score, new Set(['A']), beats, 4);
    const idx = exposedNotes(score, 'S', ex, beats);
    expect(idx.map((i) => S.notes[i].start)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
  });
  it('notices dragging in the solo but not steady singing', () => {
    const ex = exposedBeats(score, new Set(['A']), beats, 4);
    const idx = exposedNotes(score, 'S', ex, beats);
    const ctx = { score, part: S, range: [0, S.notes.length - 1] as [number, number] };
    expect(soloTimingInsight(ctx, idx, singRealistic(S, { fn: 12, zeta: 0.7 }))).toBeNull();
    // Late by 250 ms only in the solo.
    const steady = singRealistic(S, { fn: 12, zeta: 0.7 });
    const late = singRealistic(S, { fn: 12, zeta: 0.7, lag: 0.25 });
    const mixed = [...steady.filter((s) => s.time < 8 || s.time >= 16), ...late.filter((s) => s.time >= 8 && s.time < 16)];
    const ins = soloTimingInsight(ctx, idx, mixed);
    expect(ins?.kind).toBe('tempo-drift');
    expect(ins?.title).toMatch(/dragged/);
  });
});
