// Microphone pitch tracking (McLeod pitch method via `pitchy`).
//
// Pipeline: getUserMedia (raw: no AEC/NS/AGC) → MediaStreamSource → input filters (a gentle
// high-pass under the lowest note, notches at the mains hum: inputFilter.ts) → AnalyserNode(2048)
// → every ~20 ms (setInterval, keeps running when rAF is throttled) detectPitch() on the latest
// 1024 or 2048 samples (≈21 / 43 ms at 48 kHz; the shorter window for voices that don't go below
// ~C3, so note changes smear less) → harmonic check (a reading at ½ or ⅓ of the voice is lifted,
// harmonics.ts) → gate (rms / clarity / 60–1400 Hz) → PitchSmoother (one-frame look-ahead glitch
// removal). A second analyser on the raw input feeds the input-quality monitor (hum, clipping:
// inputQuality.ts) every ~250 ms.

import { PitchDetector } from 'pitchy';
import { harmonicCheck } from './harmonics';
import { inputFilterPlan, planStages, samePlan, type InputFilterPlan } from './inputFilter';
import { MainsDetector, RAW_FFT, clipStats, humFromSpectrum, type RawBlock } from './inputQuality';

export interface RawPitch {
  /** AudioContext time at which the analysed audio was captured (centre of the window). */
  ctxTime: number;
  /** Raw detected frequency of this frame, or null when unvoiced. */
  hz: number | null;
  /** Smoothed fractional MIDI pitch, or null when unvoiced / too quiet / unclear. */
  midi: number | null;
  clarity: number;
  rms: number;
  /** The reading was lifted from ½ or ⅓ of the voice by the harmonic check (input trouble). */
  lifted?: 2 | 3;
  /** Components at ½ / ⅓ of the reading relative to its harmonics (dB), for voiced readings. */
  subDb?: number | null;
  /** Unpitched, above the level gate, and mostly high-frequency sound (an s, sh, f: see isFricative). */
  fric?: true;
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
/**
 * A frame without a pitch whose energy sits mostly this high (Hz, see highFreqHz) is a fricative
 * (s, sh, f, a breathy h), not silence, hum or the backing through the speaker (voices and the
 * backing put most of their energy under ~1.5 kHz).
 */
export const FRIC_HZ = 2500;

/**
 * Power-weighted "typical frequency" of a frame (Hz): from the energy of its first difference
 * relative to its own energy (a sine at f gives f; white noise gives sampleRate/4). Cheap: one pass.
 */
export function highFreqHz(frame: ArrayLike<number>, sampleRate: number): number {
  let e = 0;
  let d = 0;
  for (let i = 1; i < frame.length; i++) {
    const x = frame[i];
    const y = x - frame[i - 1];
    e += x * x;
    d += y * y;
  }
  if (e <= 0) return 0;
  return (sampleRate / Math.PI) * Math.asin(Math.min(1, Math.sqrt(d / (4 * e))));
}

/** A reading that is a fricative: no pitch passed the gates, the level did, and the sound is high (FRIC_HZ). */
export function isFricative(r: { pitched: boolean; rms: number; hfHz?: number }): boolean {
  return !r.pitched && r.rms >= RMS_GATE && (r.hfHz ?? 0) >= FRIC_HZ;
}

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

export interface PitchFrame {
  /** Detected pitch (Hz) after the harmonic check; 0 when none. */
  hz: number;
  clarity: number;
  rms: number;
  /** McLeod's own reading, before the harmonic check. */
  rawHz?: number;
  /** 2 or 3: McLeod read ½ or ⅓ of the voice and the reading was lifted. */
  lifted?: 2 | 3;
  /** Components at ½ / ⅓ of the reported pitch relative to its harmonics (dB); null when not checked. */
  subDb?: number | null;
  /** highFreqHz of the frame (frames above the level gate). */
  hfHz?: number;
}

/** McLeod's reading alone (no harmonic check). */
export function mcleodPitch(frame: Float32Array, sampleRate: number): { hz: number; clarity: number; rms: number } {
  const rms = frameRms(frame);
  if (rms < 1e-5) return { hz: 0, clarity: 0, rms };
  const [hz, clarity] = detectorFor(frame.length).findPitch(frame, sampleRate);
  return { hz: Number.isFinite(hz) ? hz : 0, clarity: Number.isFinite(clarity) ? clarity : 0, rms };
}

/** The harmonic check runs on frames with at least this clarity (cheap enough for every frame). */
const CHECK_CLARITY = 0.6;
/** …and a McLeod reading at or above this (lifted ×2 / ×3 into the tracker's range). */
const CHECK_MIN_HZ = 40;

/**
 * Run McLeod pitch detection on one time-domain frame, then the harmonic sanity check
 * (harmonics.ts): a reading at ½ or ⅓ of the voice — the candidate's own harmonics that aren't
 * multiples of 2 or 3 far weaker than those that are — is lifted. `expectedHz` (the note due) and
 * `prevHz` (the voice's last reading that wasn't lifted, LastDirectReading) only break ties in the
 * grey zone; a voice with its own harmonics reads where it is.
 * Returns the estimate (hz may be 0/out of range — use `gatePitch` to decide voicing).
 */
export function detectPitch(frame: Float32Array, sampleRate: number, expectedHz: number | null = null, prevHz: number | null = null): PitchFrame {
  const { hz, clarity, rms } = mcleodPitch(frame, sampleRate);
  const hf = rms >= RMS_GATE ? { hfHz: highFreqHz(frame, sampleRate) } : {};
  if (rms < RMS_GATE || clarity < CHECK_CLARITY || hz < CHECK_MIN_HZ || hz > MAX_HZ) return { hz, clarity, rms, ...hf };
  const v = harmonicCheck(frame, sampleRate, hz, MAX_HZ, [expectedHz, prevHz]);
  return { hz: v.hz, clarity, rms, rawHz: hz, ...(v.lifted > 1 ? { lifted: v.lifted as 2 | 3 } : {}), subDb: v.subDb, ...hf };
}

/** Apply voicing gates; returns fractional MIDI or null. */
export function gatePitch(
  r: { hz: number; clarity: number; rms: number },
  opts: { rmsGate?: number; clarityGate?: number; minHz?: number } = {},
): number | null {
  const rmsGate = opts.rmsGate ?? RMS_GATE;
  const clarityGate = opts.clarityGate ?? CLARITY_GATE;
  if (r.rms < rmsGate || r.clarity < clarityGate) return null;
  if (!(r.hz >= Math.max(MIN_HZ, opts.minHz ?? 0) && r.hz <= MAX_HZ)) return null;
  return hzToMidi(r.hz);
}

/**
 * With 60 Hz mains hum (mainsHz, measured), readings up to 6 % above it are the hum, not a voice
 * (its harmonics at 120 and 180 Hz keep a 60 Hz period even once the fundamental is notched): the
 * tracker's lower limit moves just above it (B1 and lower; C2 at 65 Hz still reads). 50 Hz hum is
 * under the tracker's range anyway.
 */
export function humFloorHz(mainsHz: number | null): number {
  return mainsHz != null && mainsHz > MIN_HZ / 1.06 ? mainsHz * 1.06 : MIN_HZ;
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
 * The voice's last voiced reading that McLeod made directly (not lifted by the harmonic check), for
 * up to MAX_AGE frames: the harmonic check's second tie-breaker (a voice doesn't leap an octave and a
 * fifth and back within 100 ms). Lifted readings never feed it, so a lift can't prop up the next one.
 */
export class LastDirectReading {
  static readonly MAX_AGE = 5;
  private hz: number | null = null;
  private age = Infinity;
  push(hz: number | null, lifted: boolean): void {
    this.age++;
    if (hz != null && !lifted) {
      this.hz = hz;
      this.age = 0;
    }
  }
  hint(): number | null {
    return this.age < LastDirectReading.MAX_AGE ? this.hz : null;
  }
  reset(): void {
    this.hz = null;
    this.age = Infinity;
  }
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

/** Raw input blocks (hum spectrum + clipping) are read every this many ticks (~250 ms). */
const RAW_EVERY = 12;

export class PitchTracker {
  private listeners = new Set<(p: RawPitch) => void>();
  private rawListeners = new Set<(b: RawBlock) => void>();
  private last: RawPitch | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private buf: Float32Array<ArrayBuffer>;
  private smoother = new PitchSmoother();
  /** The previous frame (the one the smoother reports on this tick): window centre and raw values. */
  private frames = new FrameDelay<{ ctxTime: number; hz: number | null; clarity: number; rms: number; lifted?: 2 | 3; subDb?: number | null; fric?: boolean }>();
  private stopped = false;
  private winN = FFT_SIZE;
  /** Filters between the mic and the analyser (rebuilt when the plan changes). */
  private filterNodes: BiquadFilterNode[] = [];
  private plan: InputFilterPlan | null = null;
  private lowestHz: number | null = null;
  private mains = new MainsDetector();
  private rawBuf: Float32Array<ArrayBuffer> | null = null;
  private specBuf: Float32Array<ArrayBuffer> | null = null;
  private ticks = 0;
  private lastRawTime: number | null = null;
  /** The note due at a given AudioContext time (MIDI), set by a practice run: the harmonic check's tie-breaker. */
  private hint: ((ctxTime: number) => number | null) | null = null;
  /** The voice's last reading that wasn't lifted, the harmonic check's other tie-breaker. */
  private prev = new LastDirectReading();

  private constructor(
    private ctx: AudioContext,
    readonly stream: MediaStream,
    private source: MediaStreamAudioSourceNode,
    private analyser: AnalyserNode,
    private sink: GainNode,
    private raw: AnalyserNode | null,
  ) {
    this.buf = new Float32Array(analyser.fftSize);
    this.applyPlan();
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
      analyser.connect(sink);
      sink.connect(ctx.destination);
      // The raw input for the quality monitor (hum, clipping). Optional: the tracker works without it.
      let raw: AnalyserNode | null = null;
      try {
        raw = ctx.createAnalyser();
        raw.fftSize = RAW_FFT;
        raw.smoothingTimeConstant = 0;
        source.connect(raw);
        raw.connect(sink);
        nodes.push(raw);
      } catch {
        raw = null;
      }
      return new PitchTracker(ctx, stream, source, analyser, sink, raw);
    } catch (e) {
      // Don't leave the microphone on (each retry would open another stream).
      for (const n of nodes) { try { n.disconnect(); } catch { /* ignore */ } }
      for (const t of stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
      throw new MicError('setup', (e as Error)?.message || 'Audio setup failed');
    }
  }

  /** The microphone node, unfiltered (for recording a run). */
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

  /** The filters in front of the pitch tracker now. */
  get filterPlan(): InputFilterPlan | null {
    return this.plan;
  }

  /** Mains hum frequency found in the quiet stretches (Hz), or null. */
  get mainsHz(): number | null {
    return this.mains.mainsHz;
  }

  /** Use the shortest reliable analysis window for a singer whose lowest note is `lowestMidi`. */
  configureFor(lowestMidi: number | null): void {
    const n = lowestMidi == null || !Number.isFinite(lowestMidi) ? FFT_SIZE : windowFor(lowestMidi, this.ctx.sampleRate);
    if (n !== this.winN) {
      this.winN = n;
      this.smoother.reset();
      this.frames.reset();
      this.prev.reset();
    }
  }

  /**
   * The lowest note the singer is expected to sing (MIDI; null = unknown: tuner, range check). The
   * high-pass sits well under it and the hum notches stay below it (inputFilter.ts).
   */
  setLowestNote(midi: number | null): void {
    this.lowestHz = midi == null || !Number.isFinite(midi) ? null : midiToHz(midi);
    this.applyPlan();
  }

  /** The note due at a context time (null = none), as a tie-breaker for the harmonic check; null to clear. */
  setHint(fn: ((ctxTime: number) => number | null) | null): void {
    this.hint = fn;
  }

  onPitch(cb: (p: RawPitch) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Raw input blocks (~every 250 ms): hum spectrum and clipping, for the quality monitor. */
  onRawBlock(cb: (b: RawBlock) => void): () => void {
    this.rawListeners.add(cb);
    return () => this.rawListeners.delete(cb);
  }

  latest(): RawPitch | null {
    return this.last;
  }

  /** (Re)build the filter chain source → high-pass → notches → analyser when the plan changed. */
  private applyPlan(): void {
    if (this.stopped) return;
    const plan = inputFilterPlan(this.lowestHz, this.mains.mainsHz);
    if (this.filterNodes.length && samePlan(plan, this.plan)) return;
    const old = this.filterNodes;
    let nodes: BiquadFilterNode[] = [];
    try {
      nodes = planStages(plan).map((st) => {
        const f = this.ctx.createBiquadFilter();
        f.type = st.type;
        f.frequency.value = st.f;
        f.Q.value = st.q;
        return f;
      });
      for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
      if (nodes.length) nodes[nodes.length - 1].connect(this.analyser);
    } catch {
      nodes = [];
    }
    try { this.source.disconnect(this.analyser); } catch { /* not connected */ }
    if (old.length) { try { this.source.disconnect(old[0]); } catch { /* ignore */ } }
    for (const n of old) { try { n.disconnect(); } catch { /* ignore */ } }
    this.source.connect(nodes.length ? nodes[0] : this.analyser);
    this.filterNodes = nodes;
    this.plan = nodes.length ? plan : null;
    // Fresh filter state: don't carry the last readings across the switch.
    this.smoother.reset();
    this.frames.reset();
    this.prev.reset();
  }

  private readRaw(): void {
    const raw = this.raw;
    if (!raw) return;
    const now = this.ctx.currentTime;
    const sr = this.ctx.sampleRate;
    if (!this.rawBuf) this.rawBuf = new Float32Array(raw.fftSize);
    if (!this.specBuf) this.specBuf = new Float32Array(raw.frequencyBinCount);
    raw.getFloatTimeDomainData(this.rawBuf);
    raw.getFloatFrequencyData(this.specBuf);
    const fresh = this.lastRawTime == null ? Math.round(0.25 * sr) : Math.round((now - this.lastRawTime) * sr);
    this.lastRawTime = now;
    const n = this.rawBuf.length;
    const from = Math.max(0, n - Math.min(n, fresh));
    const hum = humFromSpectrum(this.specBuf, sr / raw.fftSize);
    const block: RawBlock = { ctxTime: now, hum, clip: clipStats(this.rawBuf, from, n, sr), slotsTotal: (n - from) / (0.02 * sr) };
    // A hum found (or gone) changes the notches; during a run only a first finding does (the
    // count-in), so a breath or a rest can't switch the filters under the singer.
    if (this.mains.push(hum) && !(this.hint && this.plan?.mainsHz != null)) this.applyPlan();
    for (const cb of this.rawListeners) {
      try { cb(block); } catch (e) { console.error(e); }
    }
  }

  private tick(): void {
    if (this.stopped || this.ctx.state !== 'running') return;
    if (++this.ticks % RAW_EVERY === 0) this.readRaw();
    this.analyser.getFloatTimeDomainData(this.buf);
    const frame = this.winN < this.buf.length ? this.buf.subarray(this.buf.length - this.winN) : this.buf;
    const centre = this.ctx.currentTime - this.windowSec / 2;
    let expectedHz: number | null = null;
    if (this.hint) {
      try {
        const m = this.hint(centre);
        expectedHz = m == null ? null : midiToHz(m);
      } catch { /* ignore */ }
    }
    const r = detectPitch(frame, this.ctx.sampleRate, expectedHz, this.prev.hint());
    const gated = gatePitch(r, { minHz: humFloorHz(this.mains.mainsHz) });
    this.prev.push(gated == null ? null : r.hz, !!r.lifted);
    const midi = this.smoother.push(gated);
    const cur = { ctxTime: centre, hz: gated == null ? null : r.hz, clarity: r.clarity, rms: r.rms, lifted: r.lifted, subDb: r.subDb, fric: isFricative({ pitched: gated != null, rms: r.rms, hfHz: r.hfHz }) };
    // The smoother reports the previous frame (one-frame look-ahead): send it with that frame's own
    // window centre, Hz, clarity and level, so every field of a reading describes the same moment.
    const f = this.frames.push(cur) ?? { ...cur, ctxTime: cur.ctxTime - INTERVAL_MS / 1000 };
    const p: RawPitch = { ctxTime: f.ctxTime, hz: f.hz, midi, clarity: f.clarity, rms: f.rms, ...(f.lifted ? { lifted: f.lifted } : {}), subDb: f.subDb ?? null, ...(f.fric && midi == null ? { fric: true as const } : {}) };
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
      for (const n of this.filterNodes) n.disconnect();
      this.analyser.disconnect();
      this.raw?.disconnect();
      this.sink.disconnect();
    } catch {
      /* ignore */
    }
    for (const t of this.stream.getTracks()) t.stop();
    this.listeners.clear();
    this.rawListeners.clear();
  }
}
