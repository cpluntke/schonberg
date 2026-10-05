import { describe, expect, it } from 'vitest';
import { PATTERN, judgePattern, shouldStop, summarize } from './rangecheck';

/** Readings of a sung-back pattern: 37 readings (0.75 s) per note, with a little vibrato and an offset. */
function sing(root: number, opts: { cents?: number; wobble?: number; skip?: number[]; db?: number; drift?: number } = {}) {
  const out: { midi: number | null; rms: number }[] = [];
  PATTERN.forEach((x, k) => {
    for (let i = 0; i < 37; i++) {
      const skip = opts.skip?.includes(x);
      // drift: the pitch slides across each note (an unsteady voice), in cents per reading.
      const d = (opts.drift ?? 0) * (i - 18);
      out.push({ midi: skip ? null : root + x + ((opts.cents ?? 0) + d + (opts.wobble ?? 10) * Math.sin(i + k)) / 100, rms: 10 ** ((opts.db ?? -20) / 20) });
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
    expect(judgePattern(60, sing(60, { drift: 4 })).verdict).toBe('shaky');
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
    const rounds = [judgePattern(57, sing(57)), judgePattern(59, sing(59)), judgePattern(61, sing(61, { drift: 4 })), judgePattern(55, sing(55))];
    const s = summarize(rounds);
    expect(s.steady).toEqual({ lo: 55, hi: 63 });
    expect(s.reach).toEqual({ lo: 55, hi: 65 });
  });
});

describe('range check: the glide between notes', () => {
  /** A singer who slides ~120 ms into each note (wider high up) and holds it steadily. */
  const glide = (root: number, slide: number) => {
    const out: { midi: number | null; rms: number }[] = [];
    let prev = root - 2;
    PATTERN.forEach((x) => {
      const target = root + x;
      for (let i = 0; i < 37; i++) { // 0.75 s per note
        const into = i < 6 ? (prev - target) * (1 - i / 6) + (i < 6 ? slide / 100 * (1 - i / 6) : 0) : 0;
        out.push({ midi: target + into + 0.08 * Math.sin(i * 1.7), rms: 0.1 });
      }
      prev = target;
    });
    return out;
  };
  it('the slide into each note does not make a held note unsteady', () => {
    expect(judgePattern(72, glide(72, 60)).verdict).toBe('good');
    expect(judgePattern(60, glide(60, 30)).verdict).toBe('good');
  });
  it('a pitch that drifts through the whole note is still unsteady', () => {
    const drift: { midi: number | null; rms: number }[] = [];
    PATTERN.forEach((x) => { for (let i = 0; i < 37; i++) drift.push({ midi: 72 + x + (i - 18) * 0.04, rms: 0.1 }); });
    expect(judgePattern(72, drift).verdict).toBe('shaky');
  });
});

describe('range check: wide vibrato vs drift (any vibrato phase)', () => {
  /** 0.75 s notes, a scoop into each, then a held note with vibrato (and optional drift). */
  const voice = (root: number, vib: number, hz: number, phase: number, driftCents = 0) => {
    const out: { midi: number | null; rms: number }[] = [];
    PATTERN.forEach((x) => {
      for (let i = 0; i < 37; i++) {
        const t = i * 0.02;
        const scoop = i < 6 ? -80 * (1 - i / 6) : 0;
        const c = scoop + vib * Math.sin(2 * Math.PI * hz * t + phase) + driftCents * (i - 18) / 18;
        out.push({ midi: root + x + c / 100, rms: 0.1 });
      }
    });
    return out;
  };
  it('±80¢ at 5 Hz with scoops is steady at every phase', () => {
    for (let k = 0; k < 12; k++) expect(judgePattern(72, voice(72, 80, 5, (k / 12) * 2 * Math.PI)).verdict).toBe('good');
  });
  it('a ±70¢ drift through each note is unsteady', () => {
    expect(judgePattern(72, voice(72, 10, 5.5, 0, 70)).notes.every((n) => n.verdict === 'shaky')).toBe(true);
  });
});

describe('range check and vibrato', () => {
  it('a wide, even classical vibrato is steady; an irregular wobble is not', () => {
    const vib = (root: number, cents: number, irregular = false) => {
      const out: { midi: number | null; rms: number }[] = [];
      PATTERN.forEach((x) => {
        for (let i = 0; i < 22; i++) {
          const t = i * 0.02;
          const v = irregular ? cents * Math.sin(2 * Math.PI * 1.3 * t + x) : cents * Math.sin(2 * Math.PI * 5.5 * t);
          out.push({ midi: root + x + v / 100, rms: 0.1 });
        }
      });
      return out;
    };
    expect(judgePattern(60, vib(60, 65)).verdict).toBe('good');
    expect(judgePattern(60, vib(60, 90, true)).verdict).not.toBe('good');
  });
});

describe('range check: octaves', () => {
  it('a pattern sung an octave down is not credited (A5 pattern sung at A4)', () => {
    const r = judgePattern(81, sing(69));
    expect(r.verdict).toBe('missed');
    expect(r.notes.every((n) => n.verdict === 'missed')).toBe(true);
    // …nor an octave up (a low pattern sung in the octave above).
    expect(judgePattern(48, sing(60)).verdict).toBe('missed');
    // Dropping the octave only for the top note leaves that note unsung.
    const top = sing(81).map((x, i) => (i >= 74 && i < 111 && x.midi != null ? { ...x, midi: x.midi - 12 } : x));
    const r2 = judgePattern(81, top);
    expect(r2.verdict).toBe('shaky');
    expect(r2.notes.find((n) => n.midi === 85)!.verdict).toBe('missed');
  });

  it('octave-jump glitches of the tracker in a correct take still pass', () => {
    // Single frames (and a short burst) an octave off, both directions, in every note.
    const glitchy = sing(81).map((x, i) => {
      if (x.midi == null) return x;
      const k = i % 37;
      if (k === 10 || k === 23) return { ...x, midi: x.midi - 12 };
      if (k === 30) return { ...x, midi: x.midi + 12 };
      if (i >= 50 && i < 54) return { ...x, midi: x.midi - 12 };
      return x;
    });
    const r = judgePattern(81, glitchy);
    expect(r.verdict).toBe('good');
    expect(judgePattern(60, sing(60).map((x, i) => (i % 7 === 3 && x.midi != null ? { ...x, midi: x.midi - 12 } : x))).verdict).toBe('good');
  });
});
