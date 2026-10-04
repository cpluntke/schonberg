import { describe, expect, it } from 'vitest';
import { scoreWords, syllableOnsets, syllablesOf } from './textrhythm';
import { makePart } from './testutil';
import type { PitchSample } from './types';

// "Quant j'ai ouy le ta-bou-rin": syllables on quarter/eighth notes at 90 bpm.
const words: [string, string | undefined][] = [['Quant', undefined], ["j'ai", undefined], ['ouy', undefined], ['le', undefined], ['ta', 'begin'], ['bou', 'middle'], ['rin', 'end']];
const part = makePart('A', [[64, 1], [64, 0.5], [65, 0.5], [67, 1], [69, 0.5], [67, 0.5], [65, 2]], 90);
part.notes.forEach((n, i) => { n.lyric = words[i][0]; n.syllabic = words[i][1] as never; });

/** Speech-like loudness: each syllable a quick rise then decay, quiet between, every 20 ms. */
function speak(starts: number[], noise = 0.002): PitchSample[] {
  const out: PitchSample[] = [];
  for (let t = 0; t < 6; t += 0.02) {
    let rms = noise;
    for (const s of starts) {
      const d = t - s;
      if (d >= 0 && d < 0.35) rms = Math.max(rms, 0.12 * Math.min(1, d / 0.03) * Math.exp(-d / 0.15));
    }
    out.push({ time: t, midi: null, clarity: 0, rms });
  }
  return out;
}

describe('words in rhythm', () => {
  const syl = syllablesOf(part, [0, part.notes.length - 1]);
  it('lists syllables with word starts', () => {
    expect(syl.map((s) => s.text)).toEqual(['Quant', "j'ai", 'ouy', 'le', 'ta', 'bou', 'rin']);
    expect(syl.map((s) => s.wordStart)).toEqual([true, true, true, true, true, false, false]);
  });
  it('finds spoken syllable onsets', () => {
    const on = syllableOnsets(speak(syl.map((s) => s.start)));
    expect(on.length).toBe(syl.length);
    on.forEach((t, k) => expect(Math.abs(t - syl[k].start)).toBeLessThan(0.045));
  });
  it('scores on-time speech high, a late speaker relative to the median only when asked', () => {
    const on = syllableOnsets(speak(syl.map((s) => s.start)));
    expect(scoreWords(syl, on, { rate: 1 }).accuracy).toBeGreaterThan(0.95);
    const late = syllableOnsets(speak(syl.map((s) => s.start + 0.22)));
    const abs = scoreWords(syl, late, { rate: 1 });
    expect(abs.medianMs).toBeGreaterThan(180);
    expect(abs.accuracy).toBeLessThan(0.7);
    expect(scoreWords(syl, late, { rate: 1, relative: true }).accuracy).toBeGreaterThan(0.95);
  });
  it('a missing word is a miss; silence scores nothing', () => {
    const starts = syl.map((s) => s.start).filter((_, k) => k !== 2);
    const r = scoreWords(syl, syllableOnsets(speak(starts)), { rate: 1 });
    expect(r.missed).toBe(1);
    expect(r.syllables[2].grade).toBe('miss');
    expect(scoreWords(syl, syllableOnsets(speak([])), { rate: 1 }).accuracy).toBe(0);
  });
});
