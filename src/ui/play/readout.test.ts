import { describe, expect, it } from 'vitest';
import { makePart, makeScore, sampleSinging } from '../../game/testutil';
import { barsDone, liveReading, runProgress } from './readout';
import { nameFontFor, staffSpace } from './staff2d';

// C D E F, one second each (60 bpm), then a rest bar, then G.
const part = makePart('s', [[60, 1], [62, 1], [64, 1], [65, 1], [null, 4], [67, 4]]);
const range: [number, number] = [0, part.notes.length - 1];

describe('the live readout', () => {
  it('names the note being sung and how far off (averaged over ~0.2 s)', () => {
    const samples = sampleSinging(part, (n) => n.midi - 0.2, 0.02, 0, 1.5);
    const r = liveReading({ samples, pos: 1.52, part, range });
    expect(r?.index).toBe(1);
    expect(r!.cents).toBeCloseTo(-20, 5);
  });

  it('nothing when silent, in a rest, or for a note hidden off book', () => {
    const samples = sampleSinging(part, (n) => n.midi, 0.02, 0, 1.5);
    expect(liveReading({ samples, pos: 2.0, part, range })).toBeNull(); // the voice stopped 0.5 s ago
    expect(liveReading({ samples: [], pos: 1, part, range })).toBeNull();
    const inRest = sampleSinging(part, () => 60, 0.02, 0, 5).map((x) => (x.time > 4 ? { ...x, midi: 60 } : x));
    expect(liveReading({ samples: inRest, pos: 5.01, part, range })).toBeNull();
    expect(liveReading({ samples, pos: 1.52, part, range, hide: () => 'none' })).toBeNull();
  });

  it('folds octaves (a tenor singing a soprano line)', () => {
    const samples = sampleSinging(part, (n) => n.midi - 12 + 0.3, 0.02, 0, 0.5);
    expect(liveReading({ samples, pos: 0.52, part, range })!.cents).toBeCloseTo(30, 5);
  });
});

describe('the progress strip', () => {
  const score = makeScore([makePart('s', [[60, 4], [62, 4], [64, 4], [65, 4], [67, 4], [69, 4]])]);
  const sec = (a: number, b: number) => ({ start: score.measures[a].start, end: score.measures[b].start + score.measures[b].dur });

  it('only for runs over more than one passage: bars per passage', () => {
    const secs = [sec(0, 1), sec(2, 4), sec(5, 5)];
    expect(runProgress(score, secs, 0, score.duration)).toEqual({ total: 6, parts: [2, 3, 1] });
    expect(runProgress(score, secs, sec(2, 4).start, sec(2, 4).end)).toBeNull();
    expect(runProgress(score, secs, sec(2, 4).start, score.duration)).toEqual({ total: 4, parts: [3, 1] });
  });

  it('counts the bars sung', () => {
    expect(barsDone(score, 0, score.duration, 0)).toBe(0);
    expect(barsDone(score, 0, score.duration, 9)).toBe(2);
    expect(barsDone(score, 0, score.duration, 99)).toBe(6);
    expect(barsDone(score, score.measures[2].start, score.duration, 9)).toBe(0);
  });
});

describe('the score view on a phone', () => {
  it('a portrait phone gets a big staff: 15 px+ note names on a 390 and a 375 px screen', () => {
    for (const W of [390, 375]) {
      const { sp } = staffSpace(W, 470, 14);
      expect(sp).toBeGreaterThanOrEqual(14);
      expect(Number(/(\d+)px/.exec(nameFontFor(sp))![1])).toBeGreaterThanOrEqual(15);
    }
    // A small phone with big text, scrolling: one big system rather than two small ones…
    expect(staffSpace(375, 330, 15.5, true).sp).toBeGreaterThanOrEqual(14);
    // …turning pages: still two systems (the next line in view at a turn), down to 9.5 px spaces.
    const page = staffSpace(375, 330, 15.5, false).sp;
    expect(page).toBeGreaterThanOrEqual(9.5);
    expect(2 * 15.5 * page).toBeLessThanOrEqual(330);
    // Landscape and laptops: as before.
    expect(staffSpace(844, 300, 12).sp).toBeLessThanOrEqual(12);
  });
});
