// Microphone pitch tracking (McLeod pitch method via `pitchy`).
//
// Pipeline: getUserMedia (raw: no AEC/NS/AGC) → MediaStreamSource → AnalyserNode(2048)
// → every ~20 ms (setInterval, keeps running when rAF is throttled) detectPitch() on the latest
// 1024 or 2048 samples (≈21 / 43 ms at 48 kHz; the shorter window for voices that don't go below
// ~C3, so note changes smear less) → gate (rms / clarity / 60–1400 Hz) → PitchSmoother
// (one-frame look-ahead glitch removal).

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

/** 'setup': the mic opened but the audio graph around it couldn't be built (e.g. a closed/interrupted context). */
export type MicErrorCode = 'denied' | 'unavailable' | 'insecure' | 'setup';

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

/** A reading this far (semitones) from both voiced neighbours, on the same side, is a glitch. */
export const SPIKE_SEMITONES = 1.5;

/**
 * Glitch removal for a stream of gated MIDI readings, with a fixed one-frame look-ahead: `push`
 * (frame k) returns the reading of frame k−1, judged against both of its neighbours. That is the
 * one-frame delay the tracker's timestamps assume (ctxTime = window centre − one interval), and it
 * holds for every output, voicing on- and offsets included.
 * - A frame that sticks out from both voiced neighbours by more than SPIKE_SEMITONES on the same
 *   side (a one-frame octave jump or a wild reading) is replaced by the median of the three. A voice
 *   can't leave a note by a semitone and a half and come back within two frames (~40 ms).
 * - Every other frame is passed through unchanged. (A running median-of-3 also flattens real
 *   one- and two-frame features: in fast passages a 0.1 s note's whole plateau or turning point.)
 * - Unvoiced frames stay unvoiced, and nothing is carried across them, so a new note isn't smeared
 *   with the previous one. A one-frame octave jump that the next frame confirms is accepted.
 */
export class PitchSmoother {
  /** Frames k−2 and k−1 (null = unvoiced / none yet). */
  private a: number | null = null;
  private b: number | null = null;

  reset(): void {
    this.a = null;
    this.b = null;
  }

  push(m: number | null): number | null {
    const prev = this.a;
    const mid = this.b;
    this.a = mid;
    this.b = m;
    if (mid == null) return null;
    if (prev == null || m == null) return mid;
    const T = SPIKE_SEMITONES;
    if ((mid - prev > T && mid - m > T) || (prev - mid > T && m - mid > T)) return median([prev, mid, m]);
    return mid;
  }
}

/**
 * Practising on the phone speaker, the mic hears the backing too, and McLeod can lock onto the
 * common period of voice + chord: an octave (×½), an octave and a fifth (×⅓) or two octaves (×¼)
 * below the voice. A reading far below the note that is due is lifted by 12, 19 or 24 semitones
 * when that lands it on (within a semitone and a half of) that note. Only for singers singing the
 * part in its own octave.
 */
export function fixSubharmonic(midi: number, expected: number | null): number {
  if (expected == null || midi > expected - 7) return midi;
  for (const k of [12, 19, 24]) if (Math.abs(midi + k - expected) <= 1.5) return midi + k;
  return midi;
}

/**
 * Holds one frame back, to go with PitchSmoother's one-frame look-ahead: `push(frame k)` returns
 * frame k−1 (null at the start), so a smoothed pitch is sent with its own frame's time, Hz,
 * clarity and level.
 */
export class FrameDelay<T> {
  private prev: T | null = null;
  push(cur: T): T | null {
    const p = this.prev;
    this.prev = cur;
    return p;
  }
  reset(): void {
    this.prev = null;
  }
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
  /** The previous frame (the one the smoother reports on this tick): window centre and raw values. */
  private frames = new FrameDelay<{ ctxTime: number; hz: number | null; clarity: number; rms: number }>();
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
    const nodes: AudioNode[] = [];
    try {
      const source = ctx.createMediaStreamSource(stream);
      nodes.push(source);
      const analyser = ctx.createAnalyser();
      nodes.push(analyser);
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      // Safari only pulls audio through nodes that reach the destination: route via a muted gain.
      const sink = ctx.createGain();
      nodes.push(sink);
      sink.gain.value = 0;
      source.connect(analyser);
      analyser.connect(sink);
      sink.connect(ctx.destination);
      return new PitchTracker(ctx, stream, source, analyser, sink);
    } catch (e) {
      // Don't leave the microphone on (each retry would open another stream).
      for (const n of nodes) { try { n.disconnect(); } catch { /* ignore */ } }
      for (const t of stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
      throw new MicError('setup', (e as Error)?.message || 'Audio setup failed');
    }
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
      this.frames.reset();
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
    const cur = { ctxTime: this.ctx.currentTime - this.windowSec / 2, hz: gated == null ? null : r.hz, clarity: r.clarity, rms: r.rms };
    // The smoother reports the previous frame (one-frame look-ahead): send it with that frame's own
    // window centre, Hz, clarity and level, so every field of a reading describes the same moment.
    const f = this.frames.push(cur) ?? { ...cur, ctxTime: cur.ctxTime - INTERVAL_MS / 1000 };
    const p: RawPitch = { ctxTime: f.ctxTime, hz: f.hz, midi, clarity: f.clarity, rms: f.rms };
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
