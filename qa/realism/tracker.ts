// Offline equivalent of the browser PitchTracker (src/audio/pitch.ts):
// every hop (setInterval 20 ms, with jitter) read the latest N samples the AnalyserNode holds
// (it updates in 128-frame render quanta), detectPitch → gatePitch → PitchSmoother, and stamp the
// reading like the app: the previous frame's window centre (current pitch.ts, one-frame look-ahead),
// or currentTime − windowSec/2 − INTERVAL (older versions).
// The current tracker also filters the input (high-pass, hum notches: src/audio/inputFilter.ts) and
// checks each reading's harmonics (src/audio/harmonics.ts); pass `filter` / `hint` to emulate them.
import * as current from '../../src/audio/pitch';
import * as head from './baseline/pitch';
import { applyInputFilter, type InputFilterPlan } from '../../src/audio/inputFilter';
import { Rng } from './prng';

/** The pure pitch functions the tracker uses; swap in another implementation to compare. */
export interface PitchImpl {
  detectPitch(frame: Float32Array, sampleRate: number, expectedHz?: number | null, prevHz?: number | null): { hz: number; clarity: number; rms: number; lifted?: 2 | 3; subDb?: number | null };
  gatePitch(r: { hz: number; clarity: number; rms: number }, o?: { minHz?: number }): number | null;
  newSmoother(): { push(m: number | null): number | null };
  /** The app stamps the smoothed reading with the previous frame's own window centre (current pitch.ts); else centre − hop. */
  stampPrevFrame?: boolean;
}

export const PITCH_CURRENT: PitchImpl = {
  detectPitch: current.detectPitch,
  gatePitch: (r, o) => current.gatePitch(r, o),
  newSmoother: () => new current.PitchSmoother(),
  stampPrevFrame: true,
};

/** The current tracker without the harmonic check (McLeod's reading as it is). */
export const PITCH_NO_CHECK: PitchImpl = {
  detectPitch: (f, sr) => current.mcleodPitch(f, sr),
  gatePitch: (r, o) => current.gatePitch(r, o),
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
  /** Input filters in front of the analyser (the current app's high-pass and hum notches). */
  filter?: InputFilterPlan | null;
  /** The note due (MIDI) at a rec time, the harmonic check's tie-breaker (session.ts sets it). */
  hint?: ((recSec: number) => number | null) | null;
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
  /** The harmonic check lifted this frame's reading from ½ or ⅓. */
  lifted?: 2 | 3;
  /** Components at ½ / ⅓ of the reading (dB under its harmonics). */
  subDb?: number | null;
}

export function trackOffline(pcm: Float32Array, sampleRate: number, opts: TrackOptions = {}): TrackReading[] {
  const N = opts.windowN ?? 2048;
  const hop = (opts.hopMs ?? 20) / 1000;
  const jit = (opts.jitterMs ?? 0) / 1000;
  const q = opts.quantum ?? 128;
  const impl = opts.impl ?? PITCH_CURRENT;
  const rng = new Rng(opts.seed ?? 1);
  if (opts.filter) pcm = applyInputFilter(pcm, sampleRate, opts.filter);
  const until = Math.min(opts.untilSec ?? Infinity, pcm.length / sampleRate);
  const smoother = impl.newSmoother();
  const out: TrackReading[] = [];
  const frame = new Float32Array(N);
  let lastEnd = -1;
  let prevCentre: number | null = null;
  const prev = new current.LastDirectReading();
  // The tracker's lower limit just above 60 Hz mains hum (pitch.ts humFloorHz).
  const floorHz = current.humFloorHz(opts.filter?.mainsHz ?? null);
  for (let k = 0; ; k++) {
    const t = (k + 1) * hop + (jit > 0 ? rng.uniform(-jit, jit) : 0);
    if (t > until) break;
    let end = Math.floor((t * sampleRate) / q) * q;
    if (end < lastEnd) end = lastEnd;
    lastEnd = end;
    if (end < N) continue;
    frame.set(pcm.subarray(end - N, end));
    const centreSec = (end - N / 2) / sampleRate;
    const due = opts.hint ? opts.hint(centreSec) : null;
    const r = impl.detectPitch(frame, sampleRate, due == null ? null : current.midiToHz(due), prev.hint());
    const gated = impl.gatePitch(r, { minHz: floorHz });
    prev.push(gated == null ? null : r.hz, !!r.lifted);
    const midi = smoother.push(gated);
    const stampSec = impl.stampPrevFrame && prevCentre !== null ? prevCentre : centreSec - hop;
    prevCentre = centreSec;
    out.push({ centreSec, stampSec, hz: gated == null ? null : r.hz, rawMidi: gated, midi, clarity: r.clarity, rms: r.rms, ...(r.lifted ? { lifted: r.lifted } : {}), subDb: r.subDb ?? null });
  }
  return out;
}
