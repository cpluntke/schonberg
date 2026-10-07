import { describe, expect, it } from 'vitest';
import {
  MainsDetector, RAW_FFT, clipStats, humFromSpectrum, inputAdvice, micTrouble, summarizeInput,
  type HumFrame, type QualityReading, type RawBlock,
} from './inputQuality';

const SR = 48000;
const BIN = SR / RAW_FFT;

/** An analyser dB spectrum: a flat floor plus sine peaks [Hz, amplitude] (Blackman main lobe ±2 bins). */
function spectrum(peaks: [number, number][], floorDb = -110): Float32Array {
  const db = new Float32Array(RAW_FFT / 2).fill(floorDb);
  for (const [f, a] of peaks) {
    const k = f / BIN;
    for (let i = Math.floor(k) - 2; i <= Math.ceil(k) + 2; i++) {
      const d = Math.abs(i - k);
      const lobe = d < 2.5 ? Math.max(0, 1 - (d / 2.5) ** 2) : 0;
      const v = 20 * Math.log10(Math.max(1e-12, a * 0.21 * lobe));
      if (v > db[i]) db[i] = v;
    }
  }
  return db;
}

describe('humFromSpectrum', () => {
  it('finds a 60 Hz family, its exact frequency and level', () => {
    const h = humFromSpectrum(spectrum([[58.7, 0.01], [117.4, 0.003], [176.1, 0.004]]), BIN);
    expect(h.family).toBe(60);
    expect(h.hz!).toBeCloseTo(58.7, 0);
    expect(h.humDb).toBeGreaterThan(-45);
    expect(h.humDb).toBeLessThan(-40);
  });

  it('finds a 50 Hz family', () => {
    expect(humFromSpectrum(spectrum([[50.1, 0.004], [100.2, 0.002]]), BIN).family).toBe(50);
  });

  it('finds nothing in plain noise, or in a lone peak at 180 Hz', () => {
    expect(humFromSpectrum(spectrum([]), BIN).family).toBeNull();
    expect(humFromSpectrum(spectrum([[180, 0.01]]), BIN).family).toBeNull();
  });
});

describe('MainsDetector', () => {
  const quiet = (family: 50 | 60 | null, hz: number | null): HumFrame => ({ levelDb: -38, family, hz, humDb: family ? -40 : -Infinity });
  it('needs two of three quiet blocks to agree, and ignores loud blocks', () => {
    const d = new MainsDetector();
    // The first blocks straddle the microphone opening (part silence): they say nothing, and don't
    // make the hum look loud next to them.
    expect(d.push({ levelDb: -Infinity, family: null, hz: null, humDb: -Infinity })).toBe(false);
    expect(d.push({ levelDb: -49, family: 60, hz: 60, humDb: -55 })).toBe(false);
    expect(d.push({ levelDb: -120, family: null, hz: null, humDb: -Infinity })).toBe(false);
    expect(d.push(quiet(60, 59.6))).toBe(false);
    expect(d.push({ ...quiet(50, 50), levelDb: -15 })).toBe(false); // singing: not quiet
    expect(d.push(quiet(60, 59.8))).toBe(true);
    expect(d.mainsHz).toBeCloseTo(59.7, 0);
    // Three quiet blocks without hum clear it.
    d.push(quiet(null, null));
    d.push(quiet(null, null));
    expect(d.mainsHz).not.toBeNull();
    expect(d.push(quiet(null, null))).toBe(true);
    expect(d.mainsHz).toBeNull();
  });
});

describe('clipStats', () => {
  it('counts runs of full-scale samples and the 20 ms slots they touch', () => {
    const x = new Float32Array(SR / 10).map((_, i) => 0.5 * Math.sin(i / 10));
    expect(clipStats(x, 0, x.length, SR)).toEqual({ runs: 0, slots: 0, peak: expect.closeTo(0.5, 2) });
    x[100] = 1; // one sample touching full scale is a peak, not a clip
    expect(clipStats(x, 0, x.length, SR).runs).toBe(0);
    for (let i = 2000; i < 2010; i++) x[i] = 1;
    for (let i = 2100; i < 2104; i++) x[i] = -1;
    for (let i = 4000; i < 4003; i++) x[i] = 0.995;
    const c = clipStats(x, 0, x.length, SR);
    expect(c.runs).toBe(3);
    expect(c.slots).toBe(2);
    expect(c.peak).toBe(1);
  });
});

/** A run: `n` readings singing `midi` (due) at level `rms`, plus raw blocks (quiet ones with hum). */
function run(o: { rms?: number; subDb?: number; liftedEvery?: number; humDb?: number | null; clipSlots?: number; n?: number } = {}) {
  const n = o.n ?? 400;
  const readings: QualityReading[] = [];
  for (let i = 0; i < n; i++) {
    readings.push({ ctxTime: i * 0.02, midi: 61, rms: o.rms ?? 0.1, subDb: o.subDb ?? -35, expected: 61, ...(o.liftedEvery && i % o.liftedEvery === 0 ? { lifted: 3 as const } : {}) });
  }
  const blocks: RawBlock[] = [];
  for (let k = 0; k < 40; k++) {
    const quiet = k < 8;
    const hum = o.humDb != null && quiet;
    blocks.push({
      ctxTime: k * 0.25, slotsTotal: 12.5,
      hum: { levelDb: quiet ? -45 : -20, family: hum ? 60 : null, hz: hum ? 59.6 : null, humDb: hum ? o.humDb! : -Infinity },
      clip: { runs: !quiet && k < 8 + (o.clipSlots ?? 0) ? 1 : 0, slots: !quiet && k < 8 + (o.clipSlots ?? 0) ? 1 : 0, peak: 0.5 },
    });
  }
  return summarizeInput(readings, blocks);
}

describe('summarizeInput', () => {
  it('a clean run has no problems', () => {
    const q = run();
    expect(q.problems).toEqual([]);
    expect(q.hum).toBeNull();
    expect(q.voiceDb).toBeCloseTo(-20, 0);
  });

  it('hum within 40 dB of the voice is a problem; far under it is not', () => {
    const q = run({ humDb: -50 });
    expect(q.hum).toEqual({ hz: 59.6, db: -50, vsVoiceDb: -30 });
    expect(q.problems).toEqual(['hum']);
    expect(run({ humDb: -65 }).problems).toEqual([]);
  });

  it('clipping in 2 % of the singing time or more is a problem', () => {
    expect(run({ clipSlots: 1 }).problems).toEqual([]); // 1 slot of 400
    const q = run({ clipSlots: 12 });
    expect(q.clip.share).toBeGreaterThanOrEqual(0.02);
    expect(q.problems).toEqual(['clipping']);
  });

  it('distortion needs strong components at ½ / ⅓ of the note and the tracker lifting readings', () => {
    expect(run({ subDb: -11 }).problems).toEqual([]);
    expect(run({ liftedEvery: 2 }).problems).toEqual([]);
    expect(run({ subDb: -11, liftedEvery: 2 }).problems).toEqual(['distortion']);
  });

  it('a voice under −38 dBFS is too quiet', () => {
    expect(run({ rms: 0.008 }).problems).toEqual(['quiet']);
  });
});

describe('advice', () => {
  it('says what to do, only for what was found', () => {
    expect(inputAdvice(null)).toEqual([]);
    expect(inputAdvice({ problems: [], hum: null })).toEqual([]);
    const a = inputAdvice({ problems: ['hum', 'clipping', 'distortion'], hum: { hz: 60, db: -45, vsVoiceDb: -25 } });
    expect(a.map((x) => x.kind)).toEqual(['clipping', 'hum', 'distortion']);
    expect(a[1].title).toBe('Electrical hum on your microphone');
    expect(a[1].text).toMatch(/unplug the laptop charger, or use your headset’s mic or another USB port/i);
    expect(a[0].title).toBe('Too loud for the mic');
    expect(a[0].text).toMatch(/further away.*System Settings → Sound → Input.*Sound settings → Input/);
    expect(a[2].text).toMatch(/hum/);
    // Too quiet and too loud at once: the clipping advice wins.
    expect(inputAdvice({ problems: ['clipping', 'quiet'], hum: null }).map((x) => x.kind)).toEqual(['clipping']);
  });
});

describe('micTrouble', () => {
  it('flags lifted readings and strong components at ½ / ⅓', () => {
    expect(micTrouble({})).toBe(false);
    expect(micTrouble({ subDb: -30 })).toBe(false);
    expect(micTrouble({ subDb: -10 })).toBe(true);
    expect(micTrouble({ lifted: 3, subDb: null })).toBe(true);
  });
});
