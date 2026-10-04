import { describe, expect, it } from 'vitest';
import { detectPitch, gatePitch, hzToMidi, midiToHz, median, PitchSmoother } from './pitch';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function synth(
  midi: number,
  sr: number,
  n: number,
  opts: { wave?: 'sine' | 'saw' | 'vocal'; vibCents?: number; noise?: number; amp?: number; offset?: number } = {},
): Float32Array {
  const out = new Float32Array(n);
  const f0 = midiToHz(midi);
  const r = rng(42);
  let phase = 0;
  const amp = opts.amp ?? 0.3;
  for (let i = 0; i < n; i++) {
    const t = (i + (opts.offset ?? 0)) / sr;
    const f = f0 * Math.pow(2, ((opts.vibCents ?? 0) * Math.sin(2 * Math.PI * 5.5 * t)) / 1200);
    phase += (2 * Math.PI * f) / sr;
    let v = 0;
    if (opts.wave === 'saw') {
      for (let h = 1; h <= 20 && h * f < sr / 2; h++) v += Math.sin(h * phase) / h;
      v *= 0.5;
    } else if (opts.wave === 'vocal') {
      const amps = [1, 0.6, 0.35, 0.25, 0.15, 0.1, 0.06];
      amps.forEach((a, k) => (v += a * Math.sin((k + 1) * phase)));
      v *= 0.4;
    } else v = Math.sin(phase);
    out[i] = amp * v + (opts.noise ?? 0) * (r() * 2 - 1);
  }
  return out;
}

describe('hz/midi conversion', () => {
  it('round-trips and hits reference points', () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 10);
    expect(midiToHz(57)).toBeCloseTo(220, 8);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
    for (const m of [30, 45.5, 60, 81.25, 96]) expect(hzToMidi(midiToHz(m))).toBeCloseTo(m, 9);
  });
});

describe('detectPitch', () => {
  const cases: [string, number, Parameters<typeof synth>[3]][] = [
    ['sine A3', 57, { wave: 'sine' }],
    ['saw bass E2', 40, { wave: 'saw' }],
    ['saw soprano A5', 81, { wave: 'saw' }],
    ['vocal with vibrato C4', 60, { wave: 'vocal', vibCents: 40 }],
    ['vocal + noise G4', 67, { wave: 'vocal', vibCents: 20, noise: 0.03 }],
    ['quiet-ish alto F#4', 66, { wave: 'vocal', amp: 0.05, noise: 0.005 }],
  ];
  for (const sr of [44100, 48000]) {
    for (const [name, midi, opts] of cases) {
      it(`${name} @ ${sr}`, () => {
        const frame = synth(midi, sr, 2048, opts);
        const r = detectPitch(frame, sr);
        const m = gatePitch(r);
        expect(m).not.toBeNull();
        // vibrato: frame centre may be up to ±vib cents away
        const tol = 0.1 + (opts?.vibCents ?? 0) / 100;
        expect(Math.abs((m as number) - midi)).toBeLessThan(tol);
        expect(r.clarity).toBeGreaterThan(0.85);
      });
    }
  }

  it('gates silence and low-level noise', () => {
    const silent = new Float32Array(2048);
    expect(gatePitch(detectPitch(silent, 48000))).toBeNull();
    const r = rng(1);
    const noise = new Float32Array(2048).map(() => 0.2 * (r() * 2 - 1));
    expect(gatePitch(detectPitch(noise, 48000))).toBeNull();
    const quiet = synth(57, 48000, 2048, { amp: 0.005 });
    expect(gatePitch(detectPitch(quiet, 48000))).toBeNull();
  });

  it('rejects out-of-range frequencies', () => {
    expect(gatePitch({ hz: 50, clarity: 0.99, rms: 0.2 })).toBeNull();
    expect(gatePitch({ hz: 1500, clarity: 0.99, rms: 0.2 })).toBeNull();
    expect(gatePitch({ hz: 220, clarity: 0.8, rms: 0.2 })).toBeNull();
    expect(gatePitch({ hz: 220, clarity: 0.95, rms: 0.2 })).toBeCloseTo(57, 6);
  });
});

describe('median', () => {
  it('works for odd/even', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('PitchSmoother', () => {
  it('reports each frame one frame later (the look-ahead the timestamps assume)', () => {
    const s = new PitchSmoother();
    expect(s.push(60)).toBeNull(); // nothing to report yet
    expect(s.push(61)).toBe(60);
    expect(s.push(62)).toBe(61);
    expect(s.push(null)).toBe(62); // the last voiced frame is reported on the next tick
    expect(s.push(null)).toBeNull();
  });
  it('removes single-frame glitches', () => {
    const s = new PitchSmoother();
    s.push(60);
    s.push(60.1);
    expect(s.push(63)).toBeCloseTo(60.1);
    expect(s.push(60)).toBeCloseTo(60.1); // the 63 glitch, judged against both neighbours
    expect(s.push(60)).toBeCloseTo(60);
  });
  it('ignores a one-frame octave jump that returns', () => {
    const s = new PitchSmoother();
    [57, 57, 57].forEach((m) => s.push(m));
    expect(s.push(69)).toBeCloseTo(57);
    expect(s.push(57)).toBeCloseTo(57); // the 69
    expect(s.push(57.05)).toBeCloseTo(57, 1);
  });
  it('accepts a confirmed octave leap', () => {
    const s = new PitchSmoother();
    [57, 57, 57].forEach((m) => s.push(m));
    expect(s.push(69)).toBeCloseTo(57);
    expect(s.push(69)).toBeCloseTo(69);
    expect(s.push(69)).toBeCloseTo(69);
  });
  it('keeps one- and two-frame notes of a fast run and its turning points (no median smear)', () => {
    // 16ths at 144 bpm are ~5 frames long, of which only one or two sit on the note.
    const run = [60, 60.6, 62, 62.1, 63.3, 64, 64.9, 64, 62.8, 62];
    const s = new PitchSmoother();
    const out = [...run, null].map((m) => s.push(m)).slice(1);
    expect(out).toEqual(run);
  });
  it('carries nothing across silence', () => {
    const s = new PitchSmoother();
    [60, 60, 60, 65].forEach((m) => s.push(m));
    expect(s.push(65)).toBe(65);
    expect(s.push(null)).toBe(65);
    expect(s.push(50)).toBeNull();
    expect(s.push(50.2)).toBe(50); // no smear from before the gap
    expect(s.push(50.1)).toBe(50.2);
  });
});

describe('windowFor', () => {
  it('uses the short window for upper voices and the long one for basses', async () => {
    const { windowFor } = await import('./pitch');
    expect(windowFor(53, 48000)).toBe(1024); // alto F3
    expect(windowFor(48, 48000)).toBe(1024); // tenor C3
    expect(windowFor(40, 48000)).toBe(2048); // bass E2
    expect(windowFor(48, 44100)).toBe(1024);
  });
});

describe('fixSubharmonic', () => {
  it('lifts octave, octave-and-a-fifth and two-octave subharmonics onto the note that is due', async () => {
    const { fixSubharmonic } = await import('./pitch');
    expect(fixSubharmonic(69.2, 69)).toBe(69.2); // fine: untouched
    expect(fixSubharmonic(66, 69)).toBe(66); // a wrong note: untouched
    expect(fixSubharmonic(57.1, 69)).toBeCloseTo(69.1); // ×½
    expect(fixSubharmonic(50, 69)).toBe(69); // ×⅓
    expect(fixSubharmonic(45, 69)).toBe(69); // ×¼
    expect(fixSubharmonic(52, 69)).toBe(52); // not a subharmonic of the due note
    expect(fixSubharmonic(50, null)).toBe(50); // rest: untouched
  });
});
