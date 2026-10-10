import { describe, expect, it, beforeEach } from 'vitest';
import { needsPartChoice, partChoices, rememberPart, chosenPartId, type PieceInfo } from './library';
import type { Part, VoiceType } from '../music/types';

const part = (id: string, name: string, voiceType: VoiceType, midis: number[]): Part => ({
  id, name, voiceType, low: Math.min(...midis), high: Math.max(...midis),
  notes: midis.map((midi, i) => ({ index: i, start: i, dur: 1, midi, measure: 0 })) as Part['notes'],
});

const piece = (parts: Part[]): PieceInfo => ({
  id: 'p', title: 'P', composer: '', builtin: false, sections: [],
  score: { parts } as unknown as PieceInfo['score'],
});

// Poulenc-like: the basses split three ways, plus a piano.
const poulenc = piece([
  part('S', 'Soprano', 'S', [67, 69, 72]),
  part('A', 'Mezzo', 'A', [62, 64, 67]),
  part('Bar', 'Barytone', 'B', [52, 55, 57, 59]),
  part('B1', 'Basse I', 'B', [48, 50, 52, 53]),
  part('B2', 'Basse II', 'B', [41, 43, 45, 48]),
  part('Pno', 'Piano', 'other', [40, 60, 80]),
]);

describe('choosing your part in a piece', () => {
  beforeEach(() => localStorage.clear());

  it('asks when the section splits, until the singer picks; the pick is kept for that piece', () => {
    expect(needsPartChoice(poulenc, 'B')).toBe(true);
    expect(chosenPartId(poulenc, 'B')).toBe('Bar');
    rememberPart('p', 'B2');
    expect(needsPartChoice(poulenc, 'B')).toBe(false);
    expect(chosenPartId(poulenc, 'B')).toBe('B2');
  });

  it("doesn't ask when exactly one part is the singer's", () => {
    expect(needsPartChoice(poulenc, 'S')).toBe(false);
    expect(needsPartChoice(poulenc, 'A')).toBe(false);
  });

  it('asks when no part is named for the voice (names it can\'t read)', () => {
    const odd = piece([part('c1', 'Chor I', 'S', [67, 69]), part('c2', 'Chor II', 'A', [60, 62])]);
    expect(needsPartChoice(odd, 'T')).toBe(true);
  });

  it('offers every sung part, never the piano, best range fit first', () => {
    const low = partChoices(poulenc, 'B', { low: 38, high: 52 });
    expect(low.map((c) => c.part.id)).not.toContain('Pno');
    expect(low[0].part.id).toBe('B2');
    expect(low).toHaveLength(5);
    const high = partChoices(poulenc, 'B', { low: 48, high: 62 });
    expect(high[0].part.id).toBe('Bar');
  });

  it('without a measured range: parts named for the voice first, in score order', () => {
    expect(partChoices(poulenc, 'B').slice(0, 3).map((c) => c.part.id)).toEqual(['Bar', 'B1', 'B2']);
    expect(partChoices(poulenc, 'B')[0].fit).toBeNull();
  });
});
