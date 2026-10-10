import { describe, expect, it } from 'vitest';
import { pitchDegree, pitchPhrase, pitchReadout, pitchShort, pitchTag, pitchWords, toleranceWords } from './pitchwords';

describe('the pitch word scale', () => {
  it('spot on up to 10 cents, a touch to 25, a little to 50, clearly beyond', () => {
    expect(pitchDegree(0)).toBe('spot on');
    expect(pitchDegree(-10)).toBe('spot on');
    expect(pitchDegree(10.4)).toBe('spot on');
    expect(pitchDegree(11)).toBe('a touch');
    expect(pitchDegree(-25)).toBe('a touch');
    expect(pitchDegree(26)).toBe('a little');
    expect(pitchDegree(-50)).toBe('a little');
    expect(pitchDegree(51)).toBe('clearly');
    expect(pitchDegree(-400)).toBe('clearly');
  });

  it('words with a direction, then the cents in brackets', () => {
    expect(pitchWords(-65)).toBe('clearly flat');
    expect(pitchWords(18)).toBe('a touch sharp');
    expect(pitchWords(-30)).toBe('a little flat');
    expect(pitchWords(3)).toBe('spot on');
    expect(pitchPhrase(-65)).toBe('clearly flat (65 cents)');
    expect(pitchPhrase(12)).toBe('a touch sharp (12 cents)');
    expect(pitchPhrase(-4)).toBe('spot on');
    expect(pitchTag(-65)).toBe('↓ clearly flat');
    expect(pitchTag(40)).toBe('↑ a little sharp');
    expect(pitchTag(-2)).toBe('spot on');
    expect(pitchShort(-30)).toBe('↓ a little');
    expect(pitchShort(70)).toBe('↑ clearly');
    expect(pitchShort(5)).toBe('spot on');
  });

  it('tolerances in words', () => {
    expect(toleranceWords(50)).toBe('half a semitone (50 cents)');
    expect(toleranceWords(35)).toBe('about a third of a semitone (35 cents)');
    expect(toleranceWords(33)).toBe('a third of a semitone (33 cents)');
    expect(toleranceWords(25)).toBe('a quarter of a semitone (25 cents)');
    expect(toleranceWords(30)).toBe('about a third of a semitone (30 cents)');
    expect(toleranceWords(65)).toBe('about two thirds of a semitone (65 cents)');
    expect(toleranceWords(20)).toBe('a fifth of a semitone (20 cents)');
  });
});

describe('the live readout', () => {
  it('words and where the voice is: flat ↓, sharp ↑ (as in Results and the bubble), nothing when spot on', () => {
    expect(pitchReadout(-18)).toEqual({ words: 'a touch flat', arrow: '↓', say: 'a touch flat: sing a touch higher' });
    expect(pitchReadout(62)).toEqual({ words: 'clearly sharp', arrow: '↑', say: 'clearly sharp: sing clearly lower' });
    expect(pitchReadout(4)).toEqual({ words: 'spot on', arrow: '', say: 'spot on' });
  });
});
