import { describe, expect, it } from 'vitest';
import type { Score } from '../music/types';
import { beatGrid, beatSecAt, beatsInMeasure, chordAt, clampRate, clipNote, ctxTimeFromScore, firstNoteIn, scoreTimeFromCtx } from './player';

function mkScore(): Score {
  const measures = [0, 1, 2].map((i) => ({
    index: i, number: String(i + 1), startBeat: i * 4, durBeats: 4, start: i * 2, dur: 2, timeSig: [4, 4] as [number, number],
  }));
  const n = (midi: number, start: number, dur: number) => ({ midi, start, dur, startBeat: start * 2, durBeats: dur * 2, measure: Math.floor(start / 2) });
  return {
    id: 't', title: 't', composer: '', source: 'builtin', duration: 6,
    measures, keys: [], tempos: [{ beat: 0, time: 0, bpm: 120 }],
    parts: [
      { id: 's', name: 'S', voiceType: 'S', low: 0, high: 0, notes: [n(72, 0, 1), n(74, 1, 2), n(76, 3, 3)] },
      { id: 'b', name: 'B', voiceType: 'B', low: 0, high: 0, notes: [n(48, 0, 4), n(43, 4, 2)] },
    ],
  };
}

describe('time mapping', () => {
  it('maps ctx → score and back at various rates', () => {
    for (const rate of [0.5, 0.75, 1, 1.25]) {
      expect(scoreTimeFromCtx(10, 4, rate, 10)).toBe(4);
      expect(scoreTimeFromCtx(10, 4, rate, 12)).toBeCloseTo(4 + 2 * rate);
      expect(scoreTimeFromCtx(10, 4, rate, 9)).toBeCloseTo(4 - rate); // count-in: before `from`
      const c = ctxTimeFromScore(10, 4, rate, 7.3);
      expect(scoreTimeFromCtx(10, 4, rate, c)).toBeCloseTo(7.3, 10);
    }
  });
  it('clamps rate', () => {
    expect(clampRate(0.2)).toBe(0.5);
    expect(clampRate(2)).toBe(1.25);
    expect(clampRate(NaN)).toBe(1);
    expect(clampRate(0.8)).toBe(0.8);
  });
});

describe('clipNote', () => {
  it('drops notes before from, cuts at to', () => {
    expect(clipNote(0, 4, 1, 5)).toBeNull();
    expect(clipNote(1, 1, 1, 5)).toEqual({ start: 1, dur: 1 });
    expect(clipNote(4, 3, 1, 5)).toEqual({ start: 4, dur: 1 });
    expect(clipNote(5, 1, 1, 5)).toBeNull();
  });
});

describe('beats', () => {
  it('compound meters count dotted beats', () => {
    expect(beatsInMeasure([4, 4])).toBe(4);
    expect(beatsInMeasure([6, 8])).toBe(2);
    expect(beatsInMeasure([3, 8])).toBe(3);
    expect(beatsInMeasure([12, 8])).toBe(4);
  });
  it('beat duration and grid', () => {
    const s = mkScore();
    expect(beatSecAt(s, 1)).toBeCloseTo(0.5);
    const g = beatGrid(s, 1, 3);
    expect(g.map((b) => b.time)).toEqual([1, 1.5, 2, 2.5]);
    expect(g.map((b) => b.downbeat)).toEqual([false, false, true, false]);
  });
});

describe('cues', () => {
  it('chord and first note', () => {
    const s = mkScore();
    expect(chordAt(s, 1)).toEqual([48, 74]);
    expect(chordAt(s, 0)).toEqual([48, 72]);
    expect(firstNoteIn(s.parts[0], 0.5, 6)).toBe(74);
    expect(firstNoteIn(s.parts[1], 4.5, 6)).toBeNull();
  });
});

describe('beatGrid with a pickup bar', () => {
  it('a one-beat upbeat gets one beat, counted from its end', async () => {
    const { beatGrid } = await import('./player');
    const score = {
      measures: [
        { index: 0, number: '0', startBeat: 0, durBeats: 1, start: 0, dur: 1, timeSig: [4, 4] as [number, number] },
        { index: 1, number: '1', startBeat: 1, durBeats: 4, start: 1, dur: 4, timeSig: [4, 4] as [number, number] },
      ],
      tempos: [{ beat: 0, time: 0, bpm: 60 }],
    } as never;
    expect(beatGrid(score, 0, 5).map((b) => b.time)).toEqual([0, 1, 2, 3, 4]);
    expect(beatGrid(score, 0, 5)[1].downbeat).toBe(true);
  });
});
