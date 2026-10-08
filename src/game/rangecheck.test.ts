import { describe, expect, it } from 'vitest';
import { PATTERN, PatternFollower, judgeFollowed, judgePattern, shouldStop, summarize, type Reading } from './rangecheck';

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

  it('a bass’s low notes read partly an octave up (the tracker on "oo") are still credited', () => {
    // E2–G#2 pattern, about one reading in four an octave up in bursts: the run stays in the octave.
    const flips = sing(40).map((x, i) => (i % 8 < 2 && x.midi != null ? { ...x, midi: x.midi + 12 } : x));
    expect(judgePattern(40, flips).verdict).toBe('good');
    const e3 = sing(52).map((x, i) => (i % 9 < 2 && x.midi != null ? { ...x, midi: x.midi + 12 } : x));
    expect(judgePattern(52, e3).verdict).toBe('good');
  });
});

describe('range check: the answer at the singer\'s own pace', () => {
  const STEP_S = 0.02;
  type Note = { midi: number | null; sec: number; cents?: number };
  /** Readings every 20 ms: each note slides in over 80 ms from the one before, with a light vibrato. */
  function answer(notes: Note[], lead = 0.6, vib = { st: 0.1, hz: 7.2 }): { r: Reading; t: number }[] {
    const out: { r: Reading; t: number }[] = [];
    let t = 0;
    for (let i = 0; i < lead / STEP_S; i++, t += STEP_S) out.push({ r: { midi: null, rms: 0.001 }, t });
    let prev: number | null = null;
    for (const n of notes) {
      const k = Math.round(n.sec / STEP_S);
      for (let i = 0; i < k; i++, t += STEP_S) {
        if (n.midi === null) { out.push({ r: { midi: null, rms: 0.001 }, t }); continue; }
        const target = n.midi + (n.cents ?? 0) / 100;
        const into = prev !== null && i < 4 ? (prev - target) * (1 - i / 4) : 0;
        out.push({ r: { midi: target + into + vib.st * Math.sin(2 * Math.PI * vib.hz * t), rms: 0.05 }, t });
      }
      prev = n.midi;
    }
    // …then silence until the follower is done or gives up.
    for (let i = 0; i < 30 / STEP_S; i++, t += STEP_S) out.push({ r: { midi: null, rms: 0.001 }, t });
    return out;
  }
  const follow = (root: number, notes: Note[], dir: 1 | -1 = 1, vib?: { st: number; hz: number }, edit?: (x: { r: Reading; t: number }[]) => void) => {
    const f = new PatternFollower(PATTERN.map((x) => root + dir * x));
    let at = 0;
    const xs = answer(notes, 0.6, vib);
    edit?.(xs);
    for (const { r, t } of xs) { at = t; if (f.push(r, t)) break; }
    return { f, at, res: judgeFollowed(dir > 0 ? root : root - 4, f) };
  };
  const pat = (root: number, sec: number | number[], dir: 1 | -1 = 1): Note[] =>
    PATTERN.map((x, k) => ({ midi: root + dir * x, sec: Array.isArray(sec) ? sec[k] : sec }));

  it('any tempo: fast, slow, uneven, with a breath between notes, all complete', () => {
    for (const sec of [0.35, 0.75, 1.6, [0.4, 1.8, 0.6, 1.2, 0.5]]) {
      const { f, res } = follow(60, pat(60, sec));
      expect(f.end, String(sec)).toBe('done');
      expect(res.verdict, String(sec)).toBe('good');
    }
    const breaths = pat(60, 0.7).flatMap((n) => [n, { midi: null, sec: 0.5 }]);
    expect(follow(60, breaths).f.end).toBe('done');
    // A pattern going down, from the top.
    expect(follow(67, pat(67, 0.9, -1), -1).res.verdict).toBe('good');
  });
  it('ends soon after the last note, not after a fixed time', () => {
    const { f, at } = follow(60, pat(60, 0.5));
    expect(f.end).toBe('done');
    expect(at).toBeLessThan(0.6 + 5 * 0.5 + 0.2);
  });
  it('a held wrong note, or two brief ones, is not met', () => {
    const wrong = pat(60, 0.8);
    wrong[2] = { midi: 63, sec: 0.8 }; // a third instead of the fourth step
    const a = follow(60, wrong);
    expect(a.f.end).toBe('wrong');
    expect(a.res.verdict).toBe('missed');
    expect(a.res.unmet).toBe('wrong');
    // The notes in the wrong order.
    expect(follow(60, [{ midi: 60, sec: 0.7 }, { midi: 64, sec: 0.7 }, { midi: 62, sec: 0.7 }]).f.end).toBe('wrong');
  });
  it('out of range: the top note sung flat by a semitone and a half, or not at all, is not met', () => {
    const flat = pat(70, 0.8);
    flat[2] = { midi: 72, sec: 1.5, cents: 50 }; // aiming for 74, stuck around 72.5
    expect(follow(70, flat).res.unmet).toBe('wrong');
    const stops = pat(70, 0.8).slice(0, 2);
    expect(follow(70, stops).res.unmet).toBe('stopped');
  });
  it('nothing sung, or stuck too long, is not met', () => {
    expect(follow(60, []).res.unmet).toBe('silent');
    const stuck = pat(60, 0.8);
    stuck[1] = { midi: 62, sec: 7 };
    expect(follow(60, stuck).res.unmet).toBe('slow');
  });
  it('a slightly flat note still counts as that note; the judgement makes it shaky', () => {
    const r = follow(60, pat(60, 0.8).map((n) => ({ ...n, cents: -65 }))).res;
    expect(r.unmet).toBeUndefined();
    expect(r.verdict).toBe('shaky');
  });
  it('vibrato, also a wide one, is one sung note', () => {
    for (const vib of [{ st: 0.65, hz: 5 }, { st: 0.65, hz: 6.5 }, { st: 1.0, hz: 5.5 }, { st: 1.0, hz: 6.5 }, { st: 0.5, hz: 4.5 }]) {
      for (const sec of [0.8, 1.5]) {
        const { f, res } = follow(60, pat(60, sec), 1, vib);
        expect(f.end, JSON.stringify({ vib, sec })).toBe('done');
        expect(res.notes.every((n) => Math.abs(n.cents!) < 25), JSON.stringify({ vib, sec, notes: res.notes })).toBe(true);
      }
    }
  });
  it('an octave slip of the tracker on the first reading of a note (after a breath) is folded', () => {
    const breaths = pat(60, 0.7).flatMap((n) => [n, { midi: null, sec: 0.3 }]);
    for (const [k, d] of [[0, -12], [2, 12], [4, 12]]) {
      const { f } = follow(60, breaths, 1, undefined, (xs) => {
        // the first voiced reading of the k-th note
        let seen = -1;
        for (let i = 0; i < xs.length; i++) {
          if (xs[i].r.midi !== null && (i === 0 || xs[i - 1].r.midi === null) && ++seen === k) { xs[i].r = { ...xs[i].r, midi: xs[i].r.midi! + d }; break; }
        }
      });
      expect(f.end, `${k} ${d}`).toBe('done');
    }
  });
  it('a singer who scoops a semitone up into every note: judged on the held notes, not the scoops', () => {
    for (const scoop of [0.12, 0.2]) {
      const notes: Note[] = pat(60, 0.8).flatMap((n) => [{ midi: n.midi! - 1, sec: scoop, cents: 20 }, { midi: n.midi, sec: 0.8 }]);
      const { f, res } = follow(60, notes);
      expect(f.end, String(scoop)).toBe('done');
      expect(res.verdict, String(scoop) + JSON.stringify(res.notes)).toBe('good');
      expect(res.notes.every((n) => Math.abs(n.cents!) < 20), JSON.stringify(res.notes)).toBe(true);
    }
  });
  it('the notes of a round not met never count as steady', () => {
    const wrong = pat(60, 0.8);
    wrong[3] = { midi: 65, sec: 0.8 };
    const { res } = follow(60, wrong);
    expect(res.unmet).toBe('wrong');
    expect(res.notes.map((n) => n.verdict)).toEqual(['shaky', 'shaky', 'shaky']);
    expect(summarize([res]).steady).toBeNull();
  });
  it('the scoop into a note is not a wrong note; a tracker octave slip is folded', () => {
    const scoop: Note[] = [{ midi: 60, sec: 0.7 }, { midi: 61, sec: 0.22 }, { midi: 62, sec: 0.7 }, { midi: 64, sec: 0.7 }, { midi: 62, sec: 0.7 }, { midi: 59, sec: 0.2 }, { midi: 60, sec: 0.7 }];
    expect(follow(60, scoop).f.end).toBe('done');
    const notes = answer(pat(60, 0.8));
    const f = new PatternFollower(PATTERN.map((x) => 60 + x));
    notes.forEach(({ r, t }, i) => { if (!f.end) f.push(i % 9 === 0 && r.midi !== null ? { ...r, midi: r.midi + 12 } : r, t); });
    expect(f.end).toBe('done');
  });
});
