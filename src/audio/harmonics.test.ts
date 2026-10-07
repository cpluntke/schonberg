import { describe, expect, it } from 'vitest';
import { harmonicCheck, harmonicSplit, resolvable, subLevelDb, tonePower } from './harmonics';
import { detectPitch, hzToMidi, mcleodPitch, midiToHz } from './pitch';
import { applyInputFilter, inputFilterPlan } from './inputFilter';

const SR = 48000;
const N = 2048;

/** A sum of sines: [Hz, amplitude, phase?][], `n` samples from sample `offset`. */
function tones(parts: [number, number, number?][], n = N, offset = 0): Float32Array {
  const out = new Float32Array(n);
  for (const [f, a, ph = 0] of parts) {
    const w = (2 * Math.PI * f) / SR;
    for (let i = 0; i < n; i++) out[i] += a * Math.sin(w * (i + offset) + ph);
  }
  return out;
}

/** A voice at `f0`: harmonics with these relative amplitudes (default: a vowel-like roll-off). */
function voice(f0: number, amps = [1, 0.7, 0.45, 0.3, 0.2, 0.12, 0.08, 0.05], level = 0.15): [number, number, number][] {
  return amps.map((a, k) => [f0 * (k + 1), level * a, 0.7 * k] as [number, number, number]);
}

const F2s = midiToHz(42); // F#2 ≈ 92.5 Hz
const C4s = midiToHz(61); // C#4 ≈ 277.2 Hz
const midiOf = (r: { hz: number }) => hzToMidi(r.hz);

describe('tonePower', () => {
  it('reads a sine’s power at its frequency and little elsewhere', () => {
    const x = tones([[300, 0.5]]);
    expect(tonePower(x, SR, 300)).toBeCloseTo(0.0625, 2); // A²/4
    expect(tonePower(x, SR, 450)).toBeLessThan(0.0625 * 1e-3);
  });
});

describe('harmonic check', () => {
  it('a true F#2 with its own harmonics reads F#2, even with C#4 due', () => {
    const x = tones(voice(F2s));
    expect(midiOf(detectPitch(x, SR))).toBeCloseTo(42, 0);
    const r = detectPitch(x, SR, C4s, C4s);
    expect(midiOf(r)).toBeCloseTo(42, 0);
    expect(r.lifted).toBeUndefined();
  });

  it('a true F#2 through a phone mic that cuts the fundamental still reads F#2', () => {
    // 2nd-order high-pass at 150 Hz (as the realism harness's phone mic): the 92 Hz fundamental drops ~9 dB.
    const raw = tones(voice(F2s), 4 * N);
    const x = applyInputFilter(raw, SR, { highpassHz: 150, notches: [], mainsHz: null }).subarray(3 * N);
    const r = detectPitch(x, SR, C4s, C4s);
    expect(midiOf(r)).toBeCloseTo(42, 0);
    expect(r.lifted).toBeUndefined();
  });

  it('C#4 with strong components at ⅓ and ⅔ of it (hum intermodulation) reads C#4', () => {
    // As on the real run: the voice plus components near 92 and 185 Hz, 10 and 14 dB under its fundamental.
    const x = tones([...voice(C4s), [C4s / 3, 0.15 * 0.32, 0.4], [(2 * C4s) / 3, 0.15 * 0.2, 1.3]]);
    expect(midiOf(mcleodPitch(x, SR))).toBeCloseTo(42, 0); // McLeod alone reads the ⅓: F#2
    // In a run the note due breaks the tie…
    const r = detectPitch(x, SR, C4s);
    expect(midiOf(r)).toBeCloseTo(61, 0);
    expect(r.lifted).toBe(3);
    expect(r.subDb!).toBeGreaterThan(-15);
    // …and anywhere the voice's last direct reading does (a voice doesn't leap 19 semitones and back).
    expect(midiOf(detectPitch(x, SR, null, C4s))).toBeCloseTo(61, 0);
    // Without either the evidence alone (the ⅓ family 10 dB down) isn't enough: an alto's C#4 on “a”
    // can look like that too.
    expect(midiOf(detectPitch(x, SR))).toBeCloseTo(42, 0);
  });

  it('C#4 with a 92 Hz component only 5 dB under the voice reads C#4 once the note due breaks the tie', () => {
    const x = tones([...voice(C4s), [C4s / 3, 0.15 * 0.56, 0.4], [(2 * C4s) / 3, 0.15 * 0.18, 1.3]]);
    expect(midiOf(mcleodPitch(x, SR))).toBeLessThan(55);
    expect(midiOf(detectPitch(x, SR, C4s))).toBeCloseTo(61, 0);
  });

  it('a hint never lifts a voice with its own harmonics', () => {
    // A true F#2 with C#4 due and C#4 sung just before: still F#2.
    const r = detectPitch(tones(voice(F2s)), SR, C4s, C4s);
    expect(midiOf(r)).toBeCloseTo(42, 0);
    expect(r.lifted).toBeUndefined();
  });

  it('C#4 with 60/120/180 Hz hum reads C#4 (with and without the input filters)', () => {
    const hum: [number, number, number][] = [[60, 0.03, 0], [120, 0.012, 1], [180, 0.02, 2]];
    const raw = tones([...voice(C4s), ...hum], 4 * N);
    expect(midiOf(detectPitch(raw.subarray(3 * N), SR))).toBeCloseTo(61, 0);
    const plan = inputFilterPlan(midiToHz(44), 60); // a bass part down to G#2: notch at 60, high-pass ~73 Hz
    const x = applyInputFilter(raw, SR, plan).subarray(3 * N);
    expect(midiOf(detectPitch(x, SR, C4s))).toBeCloseTo(61, 0);
  });

  it('a singer really an octave low reads low, even with the octave above due', () => {
    const G3 = midiToHz(55);
    const G4 = midiToHz(67);
    // A vowel that favours the even harmonics (the 2nd on the first formant) is the hard case.
    for (const amps of [undefined, [0.35, 1, 0.3, 0.45, 0.15, 0.2, 0.06, 0.08]]) {
      const x = tones(voice(G3, amps));
      const r = detectPitch(x, SR, G4, G4);
      expect(midiOf(r)).toBeCloseTo(55, 0);
      expect(r.lifted).toBeUndefined();
    }
  });

  it('a reading at ½ of the voice with no odd harmonics at all is lifted an octave', () => {
    // Only the even multiples of 138.6 Hz: that is a 277 Hz voice, whatever McLeod says.
    const f = C4s / 2;
    const x = tones([...voice(C4s), [f, 0.15 * 0.04, 0.2]]);
    const v = harmonicCheck(x, SR, f, 1400);
    expect(v.lifted).toBe(2);
    expect(hzToMidi(v.hz)).toBeCloseTo(61, 1);
  });

  it('splits the harmonics and measures the components at ½ / ⅓', () => {
    const clean = tones(voice(C4s));
    expect(harmonicSplit(clean, SR, C4s, 3).ratioDb).toBeGreaterThan(0);
    expect(subLevelDb(clean, SR, C4s)!).toBeLessThan(-30);
    const dirty = tones([...voice(C4s), [C4s / 3, 0.05, 0]]);
    expect(subLevelDb(dirty, SR, C4s)!).toBeGreaterThan(-15);
  });

  it('does not judge harmonics a frame cannot resolve', () => {
    expect(resolvable(92, 2048, SR)).toBe(true);
    expect(resolvable(46, 2048, SR)).toBe(false);
    expect(resolvable(92, 1024, SR)).toBe(false);
    expect(subLevelDb(tones(voice(F2s)), SR, F2s)).toBeNull(); // ⅓ of 92 Hz: 31 Hz apart, too close
  });
});
