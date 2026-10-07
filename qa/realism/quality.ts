// Offline copy of the app's input-quality path (src/audio/pitch.ts PitchTracker + session.ts):
// raw blocks every ~250 ms (a 32768-sample Blackman spectrum for the hum, the new samples for
// clipping), the mains frequency from the pre-roll silence, the filter plan, and the run summary.
import { MainsDetector, RAW_FFT, clipStats, humFromSpectrum, summarizeInput, type InputQuality, type QualityReading, type RawBlock } from '../../src/audio/inputQuality';
import { inputFilterPlan, type InputFilterPlan } from '../../src/audio/inputFilter';
import { midiToHz } from '../../src/audio/pitch';
import { fft } from './dsp';
import type { TrackReading } from './tracker';

const BLOCK_SEC = 0.25;

let blackman: Float64Array | null = null;

/** Web Audio AnalyserNode.getFloatFrequencyData of the RAW_FFT samples ending at `end`. */
export function analyserSpectrum(pcm: Float32Array, end: number): Float32Array {
  const N = RAW_FFT;
  if (!blackman) {
    blackman = new Float64Array(N);
    for (let i = 0; i < N; i++) blackman[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N);
  }
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const k = end - N + i;
    re[i] = k >= 0 ? pcm[k] * blackman[i] : 0;
  }
  fft(re, im);
  const out = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) out[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / N + 1e-20);
  return out;
}

/** Raw blocks as the app reads them (rec time of each block's end as ctxTime). */
export function rawBlocks(pcm: Float32Array, sampleRate: number, untilSec = Infinity): RawBlock[] {
  const out: RawBlock[] = [];
  const step = Math.round(BLOCK_SEC * sampleRate);
  let prev = 0;
  for (let end = step; end <= pcm.length && end / sampleRate <= untilSec; end += step) {
    const hum = humFromSpectrum(analyserSpectrum(pcm, end), sampleRate / RAW_FFT);
    out.push({ ctxTime: end / sampleRate, hum, clip: clipStats(pcm, prev, end, sampleRate), slotsTotal: (end - prev) / (0.02 * sampleRate) });
    prev = end;
  }
  return out;
}

/** The mains frequency the app would have found by rec time `bySec` (the pre-roll), or null. */
export function mainsBy(blocks: RawBlock[], bySec: number): number | null {
  const d = new MainsDetector();
  for (const b of blocks) {
    if (b.ctxTime > bySec) break;
    d.push(b.hum);
  }
  return d.mainsHz;
}

/** The filter plan for a singer whose lowest note is `lowestMidi`, with the hum found by `bySec`. */
export function offlinePlan(blocks: RawBlock[], lowestMidi: number, bySec: number): InputFilterPlan {
  return inputFilterPlan(midiToHz(lowestMidi), mainsBy(blocks, bySec));
}

/** The run's input-quality summary from offline readings (rec times) and raw blocks. */
export function offlineQuality(
  readings: TrackReading[], blocks: RawBlock[], due: (recSec: number) => number | null, plan?: InputFilterPlan, fromSec = 0,
): InputQuality {
  const qr: QualityReading[] = readings.filter((r) => r.stampSec >= fromSec).map((r) => ({
    ctxTime: r.stampSec, midi: r.midi, rms: r.rms, ...(r.lifted ? { lifted: r.lifted } : {}), subDb: r.subDb ?? null, expected: due(r.stampSec),
  }));
  return summarizeInput(qr, blocks.filter((b) => b.ctxTime >= fromSec), plan ? { hp: plan.highpassHz, notches: plan.notches } : undefined);
}
