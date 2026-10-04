import { describe, expect, it } from 'vitest';
import { PATTERN, judgePattern, shouldStop, summarize } from './rangecheck';

/** Readings of a sung-back pattern: 20 readings per note, with a little vibrato and an offset. */
function sing(root: number, opts: { cents?: number; wobble?: number; skip?: number[]; db?: number } = {}) {
  const out: { midi: number | null; rms: number }[] = [];
  PATTERN.forEach((x, k) => {
    for (let i = 0; i < 20; i++) {
      const skip = opts.skip?.includes(x);
      out.push({ midi: skip ? null : root + x + ((opts.cents ?? 0) + (opts.wobble ?? 10) * Math.sin(i + k)) / 100, rms: 10 ** ((opts.db ?? -20) / 20) });
    }
  });
  return out;
}

describe('range check', () => {
  it('a steady, in-tune pattern is good', () => {
    const r = judgePattern(60, sing(60));
    expect(r.verdict).toBe('good');
    expect(r.notes.map((n) => n.midi)).toEqual([60, 62, 64]);
    expect(r.db).toBe(-20);
  });
  it('flat or wobbly is shaky; a top note not reached is shaky, nothing sung is missed', () => {
    expect(judgePattern(60, sing(60, { cents: -70 })).verdict).toBe('shaky');
    expect(judgePattern(60, sing(60, { wobble: 80 })).verdict).toBe('shaky');
    expect(judgePattern(72, sing(72, { skip: [4] })).verdict).toBe('shaky');
    expect(judgePattern(60, [{ midi: null, rms: 0.001 }]).verdict).toBe('missed');
  });
  it('stops after two poor rounds in a row', () => {
    const good = judgePattern(60, sing(60));
    const bad = judgePattern(70, sing(70, { cents: -80 }));
    expect(shouldStop([good, bad])).toBe(false);
    expect(shouldStop([good, bad, bad])).toBe(true);
  });
  it('keeps the steady range, reports the reach', () => {
    const rounds = [judgePattern(57, sing(57)), judgePattern(59, sing(59)), judgePattern(61, sing(61, { wobble: 80 })), judgePattern(55, sing(55))];
    const s = summarize(rounds);
    expect(s.steady).toEqual({ lo: 55, hi: 63 });
    expect(s.reach).toEqual({ lo: 55, hi: 65 });
  });
});
