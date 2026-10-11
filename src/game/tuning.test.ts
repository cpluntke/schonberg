import { describe, expect, it } from 'vitest';
import {
  COMMA, FIFTHS_FROM_C, PIANO, PURE, STACKED_C, THIRDS_GAP, beatRate, centsToRatio, centsWords, circleWalk, fifthDrift, foldInto, octavesUp, oneDecimal,
  ratioToCents, upperHz, wobbleLabel,
} from './tuning';

describe('cents and ratios', () => {
  it('round-trips', () => {
    for (const c of [-1200, -30, 0, 2, 13.7, 386.3, 702, 1200, 2400]) expect(ratioToCents(centsToRatio(c))).toBeCloseTo(c, 9);
    expect(centsToRatio(1200)).toBeCloseTo(2, 12);
    expect(centsToRatio(100)).toBeCloseTo(2 ** (1 / 12), 12);
    expect(ratioToCents(1)).toBe(0);
  });

  it('the facts the explainer states', () => {
    expect(oneDecimal(PURE.fifth)).toBe('702');
    expect(oneDecimal(PURE.third)).toBe('386.3');
    expect(oneDecimal(PURE.minorThird)).toBe('315.6');
    expect(oneDecimal(PIANO.third - PURE.third)).toBe('13.7');
    expect(oneDecimal(PURE.fifth - PIANO.fifth)).toBe('2');
    expect(oneDecimal(PURE.minorThird - PIANO.minorThird)).toBe('15.6');
    expect(oneDecimal(COMMA)).toBe('23.5');
    expect(oneDecimal(3 * PURE.third)).toBe('1158.9');
    expect(oneDecimal(THIRDS_GAP)).toBe('41.1');
  });
});

describe('the wobble', () => {
  it('a fifth over f wobbles |2x − 3f| times a second; pure, not at all', () => {
    expect(beatRate(220, 330, [3, 2])).toBeCloseTo(0, 9);
    expect(beatRate(220, 331, [3, 2])).toBeCloseTo(2, 9);
    expect(beatRate(220, 329, [3, 2])).toBeCloseTo(2, 9);
    // the piano's fifth on A3: under a wobble a second
    expect(beatRate(220, 220 * centsToRatio(700), [3, 2])).toBeCloseTo(0.75, 1);
    // further off, faster
    expect(beatRate(220, upperHz(220, [3, 2], 30), [3, 2])).toBeGreaterThan(beatRate(220, upperHz(220, [3, 2], 10), [3, 2]));
  });

  it('a major third over f wobbles |4x − 5f| times a second', () => {
    expect(beatRate(220, 275, [5, 4])).toBeCloseTo(0, 9);
    expect(beatRate(220, 276, [5, 4])).toBeCloseTo(4, 9);
    // the piano's third on A3: about 9 a second
    expect(beatRate(220, 220 * centsToRatio(400), [5, 4])).toBeCloseTo(8.73, 1);
  });

  it('in words', () => {
    expect(wobbleLabel(0)).toBe('still');
    expect(wobbleLabel(0.2)).toBe('still');
    expect(wobbleLabel(0.5)).toBe('under 1 wobble a second');
    expect(wobbleLabel(1.1)).toBe('about 1 wobble a second');
    expect(wobbleLabel(-6.4)).toBe('about 6 wobbles a second');
    expect(centsWords(0)).toBe('just');
    expect(centsWords(12)).toBe('12 cents sharp');
    expect(centsWords(-1)).toBe('1 cent flat');
    expect(centsWords(0.4)).toBe('just');
  });
});

describe('walking round the circle', () => {
  it('12 pure fifths overshoot, 3 pure thirds fall short', () => {
    const f = circleWalk(PURE.fifth, 12);
    expect(f).toHaveLength(13);
    expect(f[12].at).toBeCloseTo(COMMA, 9);
    expect(f[1].at).toBeCloseTo(PURE.fifth, 9);
    const t = circleWalk(PURE.third, 3);
    expect(t[3].at).toBeCloseTo(1200 - THIRDS_GAP, 9);
  });
});

describe('stacking fifths from C', () => {
  it('the drift grows 1.955 cents a fifth, to the comma after 12', () => {
    expect(fifthDrift(1)).toBeCloseTo(1.955, 3);
    expect(fifthDrift(12)).toBeCloseTo(23.46, 2);
    expect(fifthDrift(12)).toBeCloseTo(COMMA, 9);
    expect(oneDecimal(fifthDrift(2))).toBe('3.9');
  });

  it('the stacked C, folded down 7 octaves, sits 23.5 cents above C', () => {
    expect(STACKED_C).toBeCloseTo(1.01364, 5);
    expect(ratioToCents(STACKED_C)).toBeCloseTo(COMMA, 9);
    expect(FIFTHS_FROM_C).toHaveLength(13);
    expect(octavesUp(12)).toBe(7);
    expect(octavesUp(1)).toBe(0);
    expect(octavesUp(2)).toBe(1);
  });

  it('folds into an octave', () => {
    expect(foldInto(1000, 200)).toBe(250);
    expect(foldInto(50, 200)).toBe(200);
    expect(foldInto(399, 200)).toBe(399);
  });
});
