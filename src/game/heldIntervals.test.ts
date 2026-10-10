import { describe, it, expect } from 'vitest';
import { barsLabel, heldIntervalSpot } from './heldIntervals';
import { makePart, makeScore } from './testutil';

// 4/4 at 60 bpm: a whole note is 4 s, a bar.
const whole = (m: number | null): [number | null, number] => [m, 4];
const quarters = (...ms: number[]): [number | null, number][] => ms.map((m) => [m, 1]);

describe('"use it in your music": held fifths and thirds against another voice', () => {
  it('finds the bars where the part holds an open fifth against another voice', () => {
    // Alto: bars 1–2 moving, bars 3–4 held A3 over the bass's D3 (a fifth), bar 5 a sixth.
    const alto = makePart('A', [...quarters(60, 62, 64, 65), ...quarters(64, 62, 60, 59), whole(57), whole(57), whole(59)]);
    const bass = makePart('B', [whole(48), whole(42), whole(50), whole(50), whole(50)]);
    const s = makeScore([alto, bass]);
    const spot = heldIntervalSpot(s, 'A', 7);
    expect(spot).toMatchObject({ m0: 2, m1: 3, otherPartId: 'B', count: 2 });
    expect(barsLabel(s, spot!.m0, spot!.m1)).toBe('bars 3–4');
    // No major thirds held here.
    expect(heldIntervalSpot(s, 'A', 4)).toBeNull();
  });

  it('a major third counts upwards from the lower voice, octaves apart too', () => {
    // Soprano E5 over the tenor's C4 (a third plus an octave), twice; a minor third does not count.
    const sop = makePart('S', [whole(76), whole(76), whole(75)]);
    const ten = makePart('T', [whole(60), whole(60), whole(60)]);
    const spot = heldIntervalSpot(makeScore([sop, ten]), 'S', 4);
    expect(spot).toMatchObject({ m0: 0, m1: 1, otherPartId: 'T', count: 2 });
    // A sixth (C over E) is not a third.
    const low = makePart('L', [whole(64), whole(64)]);
    const high = makePart('H', [whole(72), whole(72)]);
    expect(heldIntervalSpot(makeScore([high, low]), 'H', 4)).toBeNull();
  });

  it('short notes, a single spot, the organ and the part itself are left out', () => {
    const alto = makePart('A', quarters(57, 57, 57, 57));
    const bass = makePart('B', quarters(50, 50, 50, 50));
    // quarters at 60 bpm = 1 s each: held, but only 4 s in one bar from 4 spots → found
    expect(heldIntervalSpot(makeScore([alto, bass]), 'A', 7)).toMatchObject({ m0: 0, m1: 0, count: 4 });
    const fast = makeScore([makePart('A', quarters(57, 57, 57, 57), 180), makePart('B', quarters(50, 50, 50, 50), 180)], 180); // 0.33 s each: not held
    expect(heldIntervalSpot(fast, 'A', 7)).toBeNull();
    const organ = { ...makePart('O', [whole(50), whole(50)]), name: 'Organ' };
    const held = makePart('A', [whole(57), whole(57)]);
    expect(heldIntervalSpot(makeScore([held, organ]), 'A', 7)).toBeNull();
    // An instrument part with a short name ("Pno.") is voiceType 'other': left out too.
    const pno = { ...makePart('P', [whole(50), whole(50)]), name: 'Pno.', voiceType: 'other' as const };
    expect(heldIntervalSpot(makeScore([held, pno]), 'A', 7)).toBeNull();
    expect(heldIntervalSpot(makeScore([held]), 'A', 7)).toBeNull();
    expect(heldIntervalSpot(makeScore([held]), 'nope', 7)).toBeNull();
  });

  it('the best passage is at most 4 bars, against one voice', () => {
    const alto = makePart('A', Array.from({ length: 8 }, () => whole(57)));
    const bass = makePart('B', Array.from({ length: 8 }, () => whole(50)));
    const spot = heldIntervalSpot(makeScore([alto, bass]), 'A', 7)!;
    expect(spot.m1 - spot.m0).toBe(3);
    expect(barsLabel(makeScore([alto, bass]), 2, 2)).toBe('bar 3');
  });
});
