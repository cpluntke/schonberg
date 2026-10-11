import { describe, expect, it } from 'vitest';
import {
  CADENCE, COMMA, FIFTHS_FROM_C, JUST, OPEN_HZ, PIANO, PIANO_FIFTH_FRAC, STACKED_C, TARGETS, THIRDS_GAP, beatRate, cadenceHz, centsToFrac, centsToRatio,
  centsWords, circleWalk, fifthDrift, foldInto, fracToCents, justOffset, nearestTarget, octavesUp, offJust, oneDecimal, partHz, ratioToCents, stringBeat,
  upperHz, wobbleLabel,
} from './tuning';

describe('cents and ratios', () => {
  it('round-trips', () => {
    for (const c of [-1200, -30, 0, 2, 13.7, 386.3, 702, 1200, 2400]) expect(ratioToCents(centsToRatio(c))).toBeCloseTo(c, 9);
    expect(centsToRatio(1200)).toBeCloseTo(2, 12);
    expect(centsToRatio(100)).toBeCloseTo(2 ** (1 / 12), 12);
    expect(ratioToCents(1)).toBe(0);
  });

  it('the facts the explainer states', () => {
    expect(oneDecimal(JUST.fifth)).toBe('702');
    expect(oneDecimal(JUST.third)).toBe('386.3');
    expect(oneDecimal(JUST.minorThird)).toBe('315.6');
    expect(oneDecimal(PIANO.third - JUST.third)).toBe('13.7');
    expect(oneDecimal(JUST.fifth - PIANO.fifth)).toBe('2');
    expect(oneDecimal(JUST.minorThird - PIANO.minorThird)).toBe('15.6');
    expect(oneDecimal(COMMA)).toBe('23.5');
    expect(oneDecimal(3 * JUST.third)).toBe('1158.9');
    expect(oneDecimal(THIRDS_GAP)).toBe('41.1');
  });
});

describe('the wobble', () => {
  it('a fifth over f wobbles |2x − 3f| times a second; just, not at all', () => {
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
  it('12 just fifths overshoot, 3 just thirds fall short', () => {
    const f = circleWalk(JUST.fifth, 12);
    expect(f).toHaveLength(13);
    expect(f[12].at).toBeCloseTo(COMMA, 9);
    expect(f[1].at).toBeCloseTo(JUST.fifth, 9);
    const t = circleWalk(JUST.third, 3);
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

describe('the string', () => {
  it('half the string sounds an octave up, two thirds a just fifth', () => {
    expect(partHz(OPEN_HZ, 1)).toBe(196);
    expect(partHz(OPEN_HZ, 0.5)).toBeCloseTo(392, 9);
    expect(partHz(OPEN_HZ, 2 / 3)).toBeCloseTo(294, 9);
    expect(fracToCents(0.5)).toBeCloseTo(1200, 9);
    expect(fracToCents(2 / 3)).toBeCloseTo(JUST.fifth, 9);
    expect(oneDecimal(fracToCents(2 / 3))).toBe('702');
    expect(fracToCents(TARGETS.fifth.frac)).toBeCloseTo(TARGETS.fifth.cents, 9);
    for (const c of [0, 100, 386.3, 700, 702, 1200]) expect(fracToCents(centsToFrac(c))).toBeCloseTo(c, 9);
  });

  it('the piano’s octave is the same half; its fifth sits a hair right of two thirds', () => {
    expect(centsToFrac(1200)).toBeCloseTo(0.5, 12);
    expect(PIANO_FIFTH_FRAC).toBeCloseTo(1 / 2 ** (7 / 12), 12);
    expect(PIANO_FIFTH_FRAC.toFixed(4)).toBe('0.6674');
    expect((2 / 3).toFixed(4)).toBe('0.6667');
    expect(PIANO_FIFTH_FRAC).toBeGreaterThan(2 / 3);
    expect(offJust(PIANO_FIFTH_FRAC, 'fifth')).toBeCloseTo(-1.955, 3);
  });

  it('the nearest just interval and how far off', () => {
    expect(nearestTarget(0.5)).toEqual({ target: 'octave', off: 0 });
    expect(nearestTarget(0.55).target).toBe('octave');
    expect(nearestTarget(0.62).target).toBe('fifth');
    expect(nearestTarget(0.9).target).toBe('fifth');
    // the bridge a little left: the part shorter, so sharp
    expect(nearestTarget(0.499).off).toBeGreaterThan(0);
    expect(nearestTarget(0.67).off).toBeLessThan(0);
  });

  it('wobbles: the octave |x − 2f|, the fifth |2x − 3f|; still at the exact spot', () => {
    expect(stringBeat(196, 0.5, 'octave')).toBeCloseTo(0, 9);
    expect(stringBeat(196, 2 / 3, 'fifth')).toBeCloseTo(0, 9);
    const x = 196 / 0.49;
    expect(stringBeat(196, 0.49, 'octave')).toBeCloseTo(Math.abs(x - 2 * 196), 9);
    const y = 196 / 0.66;
    expect(stringBeat(196, 0.66, 'fifth')).toBeCloseTo(Math.abs(2 * y - 3 * 196), 9);
    // 3 cents off: under a wobble or about one a second
    expect(stringBeat(196, centsToFrac(1203), 'octave')).toBeCloseTo(0.68, 2);
    expect(stringBeat(196, centsToFrac(JUST.fifth + 3), 'fifth')).toBeCloseTo(1.02, 2);
    // the piano's fifth on the open string: about 2 wobbles every 3 seconds
    expect(stringBeat(196, PIANO_FIFTH_FRAC, 'fifth')).toBeCloseTo(0.66, 2);
  });
});

describe('the cadence', () => {
  it('I–IV–V–I in C, four voices', () => {
    expect(CADENCE.map((c) => c.name)).toEqual(['I', 'IV', 'V', 'I']);
    expect(CADENCE.map((c) => c.key)).toEqual(['C', 'F', 'G', 'C']);
    expect(CADENCE[1].notes).toEqual([53, 57, 65, 72]);
    expect(CADENCE[2].notes).toEqual([55, 59, 62, 71]);
  });

  it('tuned just on each root: roots stay, fifths +1.96, major thirds −13.69 cents', () => {
    expect(justOffset(48, 48)).toBe(0);
    expect(justOffset(72, 48)).toBe(0);
    expect(justOffset(55, 48)).toBeCloseTo(1.955, 3);
    expect(justOffset(64, 48)).toBeCloseTo(-13.686, 3);
    // IV: the A a third, the C a fifth; V: the Bs thirds, the D a fifth
    expect(justOffset(57, 53)).toBeCloseTo(-13.686, 3);
    expect(justOffset(72, 53)).toBeCloseTo(1.955, 3);
    expect(justOffset(59, 55)).toBeCloseTo(-13.686, 3);
    expect(justOffset(71, 55)).toBeCloseTo(-13.686, 3);
    expect(justOffset(62, 55)).toBeCloseTo(1.955, 3);
  });

  it('in Hz: the piano’s pitches, or each chord just (its root unmoved)', () => {
    const eq = cadenceHz('equal'), ji = cadenceHz('just');
    expect(eq[0][0]).toBeCloseTo(130.813, 3);
    expect(eq[3]).toEqual(eq[0]);
    for (let i = 0; i < 4; i++) {
      expect(ji[i][0]).toBeCloseTo(eq[i][0], 9); // the bass, on the root
      // every chord: root, third and fifth in 4 : 5 : 6
      const [b, t, a, s] = ji[i];
      const notes = [b, t, a, s];
      const root = b;
      for (const hz of notes) {
        let r = hz / root;
        while (r >= 2) r /= 2;
        expect([1, 5 / 4, 3 / 2].some((q) => Math.abs(r - q) < 1e-9), `chord ${i + 1}: ${r}`).toBe(true);
      }
    }
    // no drift: the last chord is the first
    expect(ji[3]).toEqual(ji[0]);
    // the piano's thirds beat (C3's 5th partial against E4's 2nd: about 5 a second); just, they don't
    expect(Math.abs(5 * eq[0][0] - 2 * eq[0][2])).toBeCloseTo(5.2, 1);
    expect(Math.abs(5 * ji[0][0] - 2 * ji[0][2])).toBeCloseTo(0, 9);
  });
});
