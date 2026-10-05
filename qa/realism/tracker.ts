// Offline equivalent of the browser PitchTracker (src/audio/pitch.ts):
// every hop (setInterval 20 ms, with jitter) read the latest N samples the AnalyserNode holds
// (it updates in 128-frame render quanta), detectPitch → gatePitch → PitchSmoother, and stamp the
// reading like the app: the previous frame's window centre (current pitch.ts, one-frame look-ahead),
// or currentTime − windowSec/2 − INTERVAL (older versions).
import * as current from '../../src/audio/pitch';
import * as head from './baseline/pitch';
import { Rng } from './prng';

/** The pure pitch functions the tracker uses; swap in another implementation to compare. */
export interface PitchImpl {
  detectPitch(frame: Float32Array, sampleRate: number): { hz: number; clarity: number; rms: number };
  gatePitch(r: { hz: number; clarity: number; rms: number }): number | null;
  newSmoother(): { push(m: number | null): number | null };
  /** The app stamps the smoothed reading with the previous frame's own window centre (current pitch.ts); else centre − hop. */
  stampPrevFrame?: boolean;
}

export const PITCH_CURRENT: PitchImpl = {
  detectPitch: current.detectPitch,
  gatePitch: (r) => current.gatePitch(r),
  newSmoother: () => new current.PitchSmoother(),
  stampPrevFrame: true,
};

/** Frozen copy of src/audio/pitch.ts at the baseline commit. */
export const PITCH_HEAD: PitchImpl = {
  detectPitch: head.detectPitch,
  gatePitch: (r) => head.gatePitch(r),
  newSmoother: () => new head.PitchSmoother(),
};

export interface TrackOptions {
  /** Analysis window (AnalyserNode.fftSize). Default 2048. */
  windowN?: number;
  /** setInterval period. Default 20 ms. */
  hopMs?: number;
  /** Uniform ±jitter of each tick (setInterval is not exact). Default 0. */
  jitterMs?: number;
  seed?: number;
  /** AnalyserNode / currentTime granularity in frames. Default 128. */
  quantum?: number;
  /** Stop reading at this rec time (the app stops listening). Default: end of pcm. */
  untilSec?: number;
  impl?: PitchImpl;
}

export interface TrackReading {
  /** Rec time (s) of the window's centre. */
  centreSec: number;
  /** Rec time the app stamps the smoothed reading with (the previous frame's centre, or centre − one hop). = ctxTime − ctx0. */
  stampSec: number;
  /** Raw detected Hz when it passed the gates. */
  hz: number | null;
  /** Gated, unsmoothed MIDI. */
  rawMidi: number | null;
  /** Smoothed MIDI (what the app scores and displays). */
  midi: number | null;
  clarity: number;
  rms: number;
}

export function trackOffline(pcm: Float32Array, sampleRate: number, opts: TrackOptions = {}): TrackReading[] {
  const N = opts.windowN ?? 2048;
  const hop = (opts.hopMs ?? 20) / 1000;
  const jit = (opts.jitterMs ?? 0) / 1000;
  const q = opts.quantum ?? 128;
  const impl = opts.impl ?? PITCH_CURRENT;
  const rng = new Rng(opts.seed ?? 1);
  const until = Math.min(opts.untilSec ?? Infinity, pcm.length / sampleRate);
  const smoother = impl.newSmoother();
  const out: TrackReading[] = [];
  const frame = new Float32Array(N);
  let lastEnd = -1;
  let prevCentre: number | null = null;
  for (let k = 0; ; k++) {
    const t = (k + 1) * hop + (jit > 0 ? rng.uniform(-jit, jit) : 0);
    if (t > until) break;
    let end = Math.floor((t * sampleRate) / q) * q;
    if (end < lastEnd) end = lastEnd;
    lastEnd = end;
    if (end < N) continue;
    frame.set(pcm.subarray(end - N, end));
    const r = impl.detectPitch(frame, sampleRate);
    const gated = impl.gatePitch(r);
    const midi = smoother.push(gated);
    const centreSec = (end - N / 2) / sampleRate;
    const stampSec = impl.stampPrevFrame && prevCentre !== null ? prevCentre : centreSec - hop;
    prevCentre = centreSec;
    out.push({ centreSec, stampSec, hz: gated == null ? null : r.hz, rawMidi: gated, midi, clarity: r.clarity, rms: r.rms });
  }
  return out;
}
