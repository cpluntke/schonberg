// Microphone pitch tracking (McLeod pitch method via `pitchy`).
//
// Pipeline: getUserMedia (raw: no AEC/NS/AGC) → MediaStreamSource → AnalyserNode(2048)
// → every ~20 ms (setInterval, keeps running when rAF is throttled) detectPitch() on the latest
// 1024 or 2048 samples (≈21 / 43 ms at 48 kHz; the shorter window for voices that don't go below
// ~C3, so note changes smear less) → gate (rms / clarity / 60–1400 Hz) → PitchSmoother
// (median-of-3 + octave-jump guard).

import { PitchDetector } from 'pitchy';

export interface RawPitch {
  /** AudioContext time at which the analysed audio was captured (centre of the window). */
  ctxTime: number;
  /** Raw detected frequency of this frame, or null when unvoiced. */
  hz: number | null;
  /** Smoothed fractional MIDI pitch, or null when unvoiced / too quiet / unclear. */
  midi: number | null;
  clarity: number;
  rms: number;
}

export type MicErrorCode = 'denied' | 'unavailable' | 'insecure';

export class MicError extends Error {
  readonly code: MicErrorCode;
  constructor(code: MicErrorCode, message?: string) {
    super(message ?? `Microphone ${code}`);
    this.name = 'MicError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export const MIN_HZ = 60;
export const MAX_HZ = 1400;
export const RMS_GATE = 0.005;
export const CLARITY_GATE = 0.85;

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function frameRms(frame: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return frame.length ? Math.sqrt(s / frame.length) : 0;
}

const detectors = new Map<number, PitchDetector<Float32Array>>();
function detectorFor(len: number): PitchDetector<Float32Array> {
  let d = detectors.get(len);
  if (!d) {
    d = PitchDetector.forFloat32Array(len);
    detectors.set(len, d);
  }
  return d;
}

/**
 * Run McLeod pitch detection on one time-domain frame.
 * Returns the raw estimate (hz may be 0/out of range — use `gatePitch` to decide voicing).
 */
export function detectPitch(frame: Float32Array, sampleRate: number): { hz: number; clarity: number; rms: number } {
  const rms = frameRms(frame);
  if (rms < 1e-5) return { hz: 0, clarity: 0, rms };
  const [hz, clarity] = detectorFor(frame.length).findPitch(frame, sampleRate);
  return { hz: Number.isFinite(hz) ? hz : 0, clarity: Number.isFinite(clarity) ? clarity : 0, rms };
}

/** Apply voicing gates; returns fractional MIDI or null. */
export function gatePitch(
  r: { hz: number; clarity: number; rms: number },
  opts: { rmsGate?: number; clarityGate?: number } = {},
): number | null {
  const rmsGate = opts.rmsGate ?? RMS_GATE;
  const clarityGate = opts.clarityGate ?? CLARITY_GATE;
  if (r.rms < rmsGate || r.clarity < clarityGate) return null;
  if (!(r.hz >= MIN_HZ && r.hz <= MAX_HZ)) return null;
  return hzToMidi(r.hz);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Light smoothing for a stream of gated MIDI readings.
 * - Median of the last 3 voiced readings (with < 3 readings, the latest is returned so
 *   onsets aren't delayed).
 * - Octave-jump guard: a single frame ~12 semitones (±1.5) away from the current pitch is
 *   held back; if the next frame confirms it, the jump is accepted (history reset), if it
 *   returns, the outlier is discarded.
 * - History is cleared after `resetAfter` consecutive unvoiced frames so a new note
 *   isn't smeared with the previous one.
 */
export class PitchSmoother {
  private hist: number[] = [];
  private pending: number | null = null;
  private unvoicedRun = 0;
  constructor(private resetAfter = 3) {}

  reset(): void {
    this.hist = [];
    this.pending = null;
    this.unvoicedRun = 0;
  }

  push(m: number | null): number | null {
    if (m == null) {
      this.unvoicedRun++;
      this.pending = null;
      if (this.unvoicedRun >= this.resetAfter) this.hist = [];
      return null;
    }
    this.unvoicedRun = 0;
    const last = this.hist.length ? this.hist[this.hist.length - 1] : null;
    if (this.pending != null) {
      const p = this.pending;
      this.pending = null;
      if (Math.abs(m - p) < 1.5) {
        // Confirmed jump: start fresh at the new register.
        this.hist = [p, m];
        return m;
      }
      // Outlier returned (or something else): drop it and continue normally.
    } else if (last != null && isOctaveJump(m - last)) {
      this.pending = m;
      return this.current();
    }
    this.hist.push(m);
    if (this.hist.length > 3) this.hist.shift();
    return this.current();
  }

  private current(): number | null {
    const n = this.hist.length;
    if (n === 0) return null;
    if (n < 3) return this.hist[n - 1];
    return median(this.hist);
  }
}

function isOctaveJump(d: number): boolean {
  const a = Math.abs(d);
  return (a > 10.5 && a < 13.5) || (a > 22.5 && a < 25.5);
}

// ---------------------------------------------------------------------------
// Browser tracker
// ---------------------------------------------------------------------------

const FFT_SIZE = 2048;
const INTERVAL_MS = 20;
/** Periods of the lowest expected pitch the analysis window must hold for McLeod to be reliable. */
const MIN_PERIODS = 2.2;

/** Analysis window (samples) for a singer whose lowest note is `lowestMidi`. */
export function windowFor(lowestMidi: number, sampleRate: number): 1024 | 2048 {
  const f = midiToHz(lowestMidi - 2); // a little slack below the written range
  return (MIN_PERIODS * sampleRate) / f <= 1024 ? 1024 : 2048;
}

export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}

async function openMic(deviceId?: string): Promise<MediaStream> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new MicError('insecure', 'Microphone access requires HTTPS');
  }
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) {
    throw new MicError(typeof window !== 'undefined' && !window.isSecureContext ? 'insecure' : 'unavailable');
  }
  const raw: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
  if (deviceId) raw.deviceId = { exact: deviceId };
  try {
    return await md.getUserMedia({ audio: raw });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      throw new MicError('denied', (e as Error).message);
    }
    // OverconstrainedError / TypeError etc.: retry with plain constraints.
    try {
      return await md.getUserMedia(deviceId ? { audio: { deviceId } } : { audio: true });
    } catch (e2) {
      const n2 = (e2 as DOMException)?.name;
      if (n2 === 'NotAllowedError' || n2 === 'SecurityError' || n2 === 'PermissionDeniedError') {
        throw new MicError('denied', (e2 as Error).message);
      }
      throw new MicError('unavailable', (e2 as Error)?.message);
    }
  }
}

export class PitchTracker {
  private listeners = new Set<(p: RawPitch) => void>();
  private last: RawPitch | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private buf: Float32Array<ArrayBuffer>;
  private smoother = new PitchSmoother();
  private stopped = false;
  private winN = FFT_SIZE;

  private constructor(
    private ctx: AudioContext,
    readonly stream: MediaStream,
    private source: MediaStreamAudioSourceNode,
    private analyser: AnalyserNode,
    private sink: GainNode,
  ) {
    this.buf = new Float32Array(analyser.fftSize);
    this.timer = setInterval(() => this.tick(), INTERVAL_MS);
    for (const t of stream.getAudioTracks()) t.addEventListener('ended', () => this.stop());
  }

  static async create(ctx: AudioContext, opts: { deviceId?: string } = {}): Promise<PitchTracker> {
    const stream = await openMic(opts.deviceId);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    // Safari only pulls audio through nodes that reach the destination: route via a muted gain.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(analyser);
    analyser.connect(sink);
    sink.connect(ctx.destination);
    return new PitchTracker(ctx, stream, source, analyser, sink);
  }

  /** The microphone node (for recording a run). */
  get sourceNode(): AudioNode {
    return this.source;
  }

  /** Samples analysed per frame. */
  get windowN(): number {
    return this.winN;
  }

  /** False once stopped (also when the mic track ended: unplugged headset, interruption). */
  get alive(): boolean {
    return !this.stopped && this.stream.getAudioTracks().some((t) => t.readyState === 'live');
  }

  /** Seconds of audio analysed per frame. */
  get windowSec(): number {
    return this.winN / this.ctx.sampleRate;
  }

  /** Use the shortest reliable analysis window for a singer whose lowest note is `lowestMidi`. */
  configureFor(lowestMidi: number | null): void {
    const n = lowestMidi == null || !Number.isFinite(lowestMidi) ? FFT_SIZE : windowFor(lowestMidi, this.ctx.sampleRate);
    if (n !== this.winN) {
      this.winN = n;
      this.smoother.reset();
    }
  }

  onPitch(cb: (p: RawPitch) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  latest(): RawPitch | null {
    return this.last;
  }

  private tick(): void {
    if (this.stopped || this.ctx.state !== 'running') return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const frame = this.winN < this.buf.length ? this.buf.subarray(this.buf.length - this.winN) : this.buf;
    const r = detectPitch(frame, this.ctx.sampleRate);
    const gated = gatePitch(r);
    const midi = this.smoother.push(gated);
    const p: RawPitch = {
      // Centre of the analysis window, minus the median-of-3 smoother's one-frame delay.
      ctxTime: this.ctx.currentTime - this.windowSec / 2 - INTERVAL_MS / 1000,
      hz: gated == null ? null : r.hz,
      midi,
      clarity: r.clarity,
      rms: r.rms,
    };
    this.last = p;
    for (const cb of this.listeners) {
      try {
        cb(p);
      } catch (e) {
        console.error(e);
      }
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.source.disconnect();
      this.analyser.disconnect();
      this.sink.disconnect();
    } catch {
      /* ignore */
    }
    for (const t of this.stream.getTracks()) t.stop();
    this.listeners.clear();
  }
}
