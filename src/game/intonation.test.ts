import { describe, expect, it } from 'vitest';
import {
  HoldDetector, HOLD_SEC, beatHz, centsAbove, loadLab, logRound, pairRatio, pianoCents, pureCents, rootFor, rungPassed, saveLab, wobble, wobbleWord,
} from './intonation';

const hz = (rootHz: number, c: number) => rootHz * 2 ** (c / 1200);

describe('intonation lab: the physics', () => {
  it('pure and piano intervals', () => {
    expect(pureCents('sol')).toBeCloseTo(701.955, 2);
    expect(pureCents('mi')).toBeCloseTo(386.314, 2);
    expect(pianoCents('mi') - pureCents('mi')).toBeCloseTo(13.69, 1);
  });

  it('a pure interval does not beat; the piano third on middle C beats about 10 times a second', () => {
    const c4 = 261.63;
    expect(beatHz(c4, c4 * 1.5, [3, 2])).toBeCloseTo(0, 6);
    expect(beatHz(c4, c4 * 1.25, [5, 4])).toBeCloseTo(0, 6);
    expect(beatHz(c4, hz(c4, 400), [5, 4])).toBeCloseTo(10.4, 0);
    // The piano fifth: about once a second.
    expect(beatHz(c4, hz(c4, 700), [3, 2])).toBeCloseTo(0.89, 1);
  });

  it('pair ratios inside the triad', () => {
    expect(pairRatio('mi', 'do')).toEqual([5, 4]);
    expect(pairRatio('do', 'sol')).toEqual([3, 2]);
    expect(pairRatio('mi', 'sol')).toEqual([6, 5]);
  });

  it('wobble: zero when pure against every other chord tone, grows either way off it', () => {
    const d3 = 146.83;
    expect(wobble(hz(d3, pureCents('mi')), 'mi', d3, ['do', 'sol'])).toBeLessThan(1e-6);
    const hi = wobble(hz(d3, pureCents('mi') + 10), 'mi', d3, ['do']);
    const lo = wobble(hz(d3, pureCents('mi') - 10), 'mi', d3, ['do']);
    expect(hi).toBeGreaterThan(3);
    expect(lo).toBeCloseTo(hi, 0); // how much, not which way
    // An octave higher still reads as pure (a soprano's mi above an alto's do).
    expect(wobble(hz(d3, pureCents('mi') + 1200), 'mi', d3, ['do'])).toBeLessThan(1e-6);
    // Singing do against the app's sol and mi.
    expect(wobble(d3, 'do', d3, ['mi', 'sol'])).toBeLessThan(1e-6);
    expect(wobble(hz(d3, 8), 'do', d3, ['mi', 'sol'])).toBeGreaterThan(2);
  });

  it('words for the pulse', () => {
    expect(wobbleWord(0.2)).toBe('still');
    expect(wobbleWord(10)).toBe('fast buzz');
    expect(wobbleWord(null)).toBe('listening…');
  });

  it('cents above do fold to the octave of the target', () => {
    expect(centsAbove(hz(100, 386 + 1200), 100, 386)).toBeCloseTo(386, 6);
    expect(centsAbove(hz(100, 386 - 1200), 100, 386)).toBeCloseTo(386, 6);
  });

  it('do sits inside the singer\'s range, with sol above it still inside', () => {
    expect(rootFor('A')).toBe(57);
    const r = rootFor('S', 60, 79);
    expect(r).toBeGreaterThan(60);
    expect(r + 7).toBeLessThanOrEqual(79 - 2);
  });
});

describe('hold to lock', () => {
  const feed = (h: HoldDetector, from: number, to: number, c: (t: number) => number | null) => {
    let got: number | null = null;
    for (let t = from; t <= to + 1e-9 && got == null; t += 0.02) got = h.push(t, c(t));
    return got;
  };

  it('a steady tone locks after HOLD_SEC with its settled value', () => {
    const h = new HoldDetector();
    const v = feed(h, 0, 3, (t) => 389 + (t < 0.3 ? 8 : 0) + Math.sin(t * 30) * 2);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(389, 0);
  });

  it('a slide never locks; a held note after it does', () => {
    const h = new HoldDetector();
    expect(feed(h, 0, 3, (t) => 430 - t * 15)).toBeNull();
    expect(feed(h, 3, 6, () => 395)).toBeCloseTo(395, 0);
  });

  it('vibrato counts at its centre; breaks start the hold over', () => {
    const h = new HoldDetector();
    expect(feed(h, 0, 4, (t) => 390 + 25 * Math.sin(2 * Math.PI * 5.5 * t))).toBeCloseTo(390, -0.5);
    // (a slow vibrato-like wander is a slide, not a hold)
    expect(feed(new HoldDetector(), 0, 4, (t) => 390 + 25 * Math.sin(2 * Math.PI * 0.4 * t))).toBeNull();
    const g = new HoldDetector();
    expect(feed(g, 0, 4, (t) => ((t % 1) < 0.7 ? 386 : null))).toBeNull();
    expect(HOLD_SEC).toBe(2);
  });
});

describe('ladder progress', () => {
  it('a rung opens the next after 3 of the last 4 rounds are pure', () => {
    let p = loadLab();
    expect(p.third.rung).toBe(1);
    // Listening check: 5 of 6 right.
    for (const v of [0, 0, 1, 0, 0]) p = logRound(p, 'third', 1, v).p;
    expect(p.third.rung).toBe(1);
    const r = logRound(p, 'third', 1, 0);
    expect(r.passed).toBe(true);
    p = r.p;
    expect(p.third.rung).toBe(2);
    // Tuning by hand: within 5 cents.
    for (const v of [12, 4, -3]) p = logRound(p, 'third', 2, v).p;
    expect(p.third.rung).toBe(2);
    p = logRound(p, 'third', 2, 2).p;
    expect(p.third.rung).toBe(3);
    // Singing: within 8; replaying an earlier rung never moves the ladder back.
    expect(rungPassed(3, [7, -8, 20, 6])).toBe(true);
    expect(rungPassed(3, [9, 9, 9, 0])).toBe(false);
    p = logRound(p, 'third', 1, 1).p;
    expect(p.third.rung).toBe(3);
    expect(p.fifth.rung).toBe(1);
  });

  it('survives a reload, and bad storage', () => {
    let p = loadLab();
    p = logRound(p, 'fifth', 1, 0).p;
    saveLab(p);
    expect(loadLab().fifth.logs[1]).toEqual([0]);
    localStorage.setItem('sh:intonation', '{"fifth":{"rung":99}}');
    expect(loadLab().fifth.rung).toBe(6);
    localStorage.setItem('sh:intonation', 'not json');
    expect(loadLab().third.rung).toBe(1);
    localStorage.removeItem('sh:intonation');
  });
});
