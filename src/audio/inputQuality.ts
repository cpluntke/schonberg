// How good the microphone input is: mains hum, clipping, distortion (energy at ½ or ⅓ of the sung
// note) and a voice too quiet to track well. Measured cheaply during every run (and in the setup
// mic check) from what the pitch tracker already reads:
// - every ~250 ms the raw input's last 32768 samples (a second AnalyserNode): a long spectrum for
//   the hum (50 or 60 Hz family) in the quiet stretches, and the new samples for clipping;
// - every tracker reading (20 ms): level, and from the harmonic check (harmonics.ts) the level of
//   components at ½ / ⅓ of the reading and whether the reading was lifted from a ½ or ⅓.
// The summary (InputQuality) is stored with the run and drives the advice on Results.

// ---------------------------------------------------------------------------------------------
// Hum: one long spectrum

/** Samples per raw block (AnalyserNode fftSize): ~0.7 s at 48 kHz, 1.5 Hz per bin. */
export const RAW_FFT = 32768;
/** A hum component must stand this far (dB) above the spectrum around it. */
const HUM_PROMINENCE_DB = 10;
/** Blackman window coherent gain / 2: a sine of amplitude A shows as 20·log10(A·0.21) in the analyser's dB spectrum. */
const BLACKMAN_PEAK = 0.42 / 2;
/** Mean square of the Blackman window (for the level from the spectrum). */
const BLACKMAN_MS = 0.3046;

export interface HumFrame {
  /** Broadband level of the block (dBFS RMS). */
  levelDb: number;
  /** Mains family found (null = none). */
  family: 50 | 60 | null;
  /** Measured fundamental (Hz), e.g. 59.6. */
  hz: number | null;
  /** RMS of the hum components (dBFS). */
  humDb: number;
}

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-10));

/**
 * Find mains hum in an analyser dB spectrum (Blackman window, magnitudes scaled 1/N as Web Audio's
 * getFloatFrequencyData): peaks at k·50 or k·60 Hz (k = 1…4, ±4 %, sound cards' clocks and grids
 * drift) standing HUM_PROMINENCE_DB above their surroundings.
 */
export function humFromSpectrum(db: ArrayLike<number>, binHz: number): HumFrame {
  let ms = 0;
  for (let k = 1; k < db.length; k++) {
    const v = db[k];
    if (Number.isFinite(v)) ms += Math.pow(10, v / 10);
  }
  const levelDb = toDb(Math.sqrt((2 * ms) / BLACKMAN_MS));
  const fams: { F: 50 | 60; power: number; hz: number | null; n: number; low: boolean }[] = [];
  for (const F of [50, 60] as const) {
    let power = 0;
    let n = 0;
    let best: { db: number; hz: number } | null = null;
    let low = false;
    for (let k = 1; k <= 4; k++) {
      const lo = Math.max(1, Math.floor((k * F * 0.96) / binHz));
      const hi = Math.min(db.length - 2, Math.ceil((k * F * 1.04) / binHz));
      let pk = -1;
      for (let i = lo; i <= hi; i++) if (pk < 0 || db[i] > db[pk]) pk = i;
      if (pk < 0 || !Number.isFinite(db[pk])) continue;
      // Surroundings: ±20 % around the component, leaving out the peak's own main lobe.
      const around: number[] = [];
      const a0 = Math.max(1, Math.floor((k * F * 0.8) / binHz));
      const a1 = Math.min(db.length - 1, Math.ceil((k * F * 1.2) / binHz));
      for (let i = a0; i <= a1; i++) if (Math.abs(i - pk) > 4 && Number.isFinite(db[i])) around.push(db[i]);
      around.sort((x, y) => x - y);
      const floor = around.length ? around[around.length >> 1] : -Infinity;
      if (db[pk] - floor < HUM_PROMINENCE_DB) continue;
      n++;
      if (k <= 2) low = true;
      const amp = Math.pow(10, db[pk] / 20) / BLACKMAN_PEAK;
      power += (amp * amp) / 2;
      // Refine the peak (parabola through the dB values) and refer it to the fundamental.
      const y0 = db[pk - 1], y1 = db[pk], y2 = db[pk + 1];
      const d = Number.isFinite(y0) && Number.isFinite(y2) && y0 - 2 * y1 + y2 < 0 ? (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2) : 0;
      const hz = ((pk + d) * binHz) / k;
      if (!best || db[pk] > best.db) best = { db: db[pk], hz };
    }
    fams.push({ F, power, hz: best?.hz ?? null, n, low });
  }
  // A family needs its fundamental or 2nd harmonic (a lone 150 or 180 Hz peak is too easily something else).
  const ok = fams.filter((f) => f.n > 0 && f.low).sort((a, b) => b.power - a.power);
  if (!ok.length) return { levelDb, family: null, hz: null, humDb: -Infinity };
  const f = ok[0];
  return { levelDb, family: f.F, hz: f.hz != null ? Math.round(f.hz * 100) / 100 : null, humDb: toDb(Math.sqrt(f.power)) };
}

// ---------------------------------------------------------------------------------------------
// Clipping: runs of samples at full scale

/** A sample at or above this (absolute) is at full scale. */
export const CLIP_LEVEL = 0.99;
/** Consecutive full-scale samples that make a clip (one sample touching 1.0 is a peak, not a clip). */
export const CLIP_RUN = 3;
/** Time slots for "share of time affected" (one tracker reading). */
export const CLIP_SLOT_SEC = 0.02;

export interface ClipStats {
  /** Runs of ≥ CLIP_RUN samples at full scale. */
  runs: number;
  /** 20 ms slots containing a run. */
  slots: number;
  /** Highest absolute sample. */
  peak: number;
}

/** Clipping in `x[from…to)`, slot boundaries counted from `from`. */
export function clipStats(x: ArrayLike<number>, from: number, to: number, sampleRate: number): ClipStats {
  const slotN = Math.max(1, Math.round(CLIP_SLOT_SEC * sampleRate));
  let runs = 0;
  let slots = 0;
  let lastSlot = -1;
  let run = 0;
  let peak = 0;
  for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    if (a >= CLIP_LEVEL) {
      run++;
      if (run === CLIP_RUN) {
        runs++;
        const s = Math.floor((i - from) / slotN);
        if (s !== lastSlot) { slots++; lastSlot = s; }
      }
    } else run = 0;
  }
  return { runs, slots, peak };
}

// ---------------------------------------------------------------------------------------------
// Mains frequency for the notch filters

/** Blocks under this level (dBFS) are digital silence (the stream starting, a muted mic): no evidence either way. */
const SILENT_DB = -90;
/** The first blocks after the microphone opens hold part of the time before it (RAW_FFT ≈ 0.7 s): skipped. */
const START_BLOCKS = 3;

/**
 * Decides the mains frequency from the quiet blocks: two of the last three quiet blocks agreeing on
 * a family sets it; three quiet blocks in a row without hum clear it.
 */
export class MainsDetector {
  private recent: HumFrame[] = [];
  private noneRun = 0;
  /** Levels of the last LEVELS blocks with sound (digital silence at start-up doesn't count). */
  private levels: number[] = [];
  mainsHz: number | null = null;

  /** Blocks seen since the start (the first ones straddle the stream starting: half silence). */
  private seen = 0;

  /** Feed a block; returns true when mainsHz changed. */
  push(f: HumFrame): boolean {
    if (++this.seen <= START_BLOCKS) return false;
    if (!(f.levelDb > SILENT_DB)) return false;
    // Quiet: within 6 dB of the quietest block of the last ~10 s (the singer isn't singing), or under −45 dBFS.
    this.levels.push(f.levelDb);
    if (this.levels.length > 40) this.levels.shift();
    const minLevel = Math.min(...this.levels);
    if (!(f.levelDb <= Math.max(-45, minLevel + 6))) return false;
    const before = this.mainsHz;
    this.recent.push(f);
    if (this.recent.length > 3) this.recent.shift();
    if (f.family == null) {
      if (++this.noneRun >= 3) this.mainsHz = null;
    } else {
      this.noneRun = 0;
      const same = this.recent.filter((r) => r.family === f.family && r.hz != null);
      if (same.length >= 2) {
        const hz = same.map((r) => r.hz!).sort((a, b) => a - b)[same.length >> 1];
        // Keep a stable value (the notches are rebuilt on every change).
        if (this.mainsHz == null || Math.abs(hz - this.mainsHz) > 0.4) this.mainsHz = Math.round(hz * 10) / 10;
      }
    }
    return before !== this.mainsHz;
  }

  reset(): void {
    this.recent = [];
    this.noneRun = 0;
    this.levels = [];
    this.seen = 0;
    this.mainsHz = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Per-reading flag

/** Components at ½ / ⅓ of a reading this strong (dB under its harmonics) are input trouble. */
export const MIC_SUB_DB = -12;

/**
 * The tracker saw input trouble in this frame: it read ½ or ⅓ of the voice and lifted it, or the
 * frame has strong components at ½ / ⅓ of the pitch (PitchSample.mic, NoteResult.unsure 'mic').
 */
export function micTrouble(p: { lifted?: number; subDb?: number | null }): boolean {
  return !!p.lifted || (p.subDb != null && p.subDb >= MIC_SUB_DB);
}

// ---------------------------------------------------------------------------------------------
// Per-run summary

/** One raw block (≈ 250 ms of new samples, with the hum spectrum of the last RAW_FFT samples). */
export interface RawBlock {
  /** AudioContext time of the block's end. */
  ctxTime: number;
  hum: HumFrame;
  clip: ClipStats;
  /** 20 ms slots of new samples in this block. */
  slotsTotal: number;
}

/** One pitch reading as the monitor needs it. */
export interface QualityReading {
  ctxTime: number;
  /** Reported pitch (after the harmonic check), null = unvoiced. */
  midi: number | null;
  rms: number;
  /** The reading was lifted from ½ or ⅓ of the voice (harmonics.ts). */
  lifted?: 2 | 3;
  /** Components at ½ / ⅓ of the reading relative to its harmonics (dB), when voiced. */
  subDb?: number | null;
  /** The note due at this reading (written MIDI), null in rests / unknown. */
  expected: number | null;
}

export type InputProblem = 'hum' | 'clipping' | 'distortion' | 'quiet';

export interface InputQuality {
  /** Mains hum found in the quiet stretches: fundamental (Hz), level (dBFS) and relative to the voice (dB). */
  hum: { hz: number; db: number; vsVoiceDb: number | null } | null;
  /** Clipping while singing: runs of full-scale samples, share of the singing time affected, highest sample. */
  clip: { runs: number; share: number; peak: number };
  /** Voice level while singing (median RMS of the readings where a note is due, dBFS). */
  voiceDb: number | null;
  /**
   * Distortion while on the written note: median level (dB) of components at ½ / ⅓ of it relative to
   * its harmonics, share of voiced readings the tracker lifted from ½ or ⅓, and readings judged.
   */
  sub: { db: number | null; liftedShare: number; n: number };
  /** Filters applied before tracking. */
  filter?: { hp: number; notches: number[] };
  problems: InputProblem[];
}

/**
 * Hum is worth mentioning from this level relative to the voice (dB)… (A hum peak needs to stand
 * HUM_PROMINENCE_DB above the noise around it to be found at all; a run with hum 31 dB under the
 * voice had its readings wrecked by intermodulation.)
 */
export const HUM_VS_VOICE_DB = -40;
/** …or this absolute level (dBFS) when the voice level is unknown. */
const HUM_ABS_DB = -58;
/** Clipping in this share of the singing time (or more) is a problem. */
export const CLIP_SHARE = 0.02;
/**
 * Distortion: components at ½ / ⅓ of the sung note this strong (median, dB under its harmonics)…
 * (clean synthetic voices: −20 to −37 dB; the backing bleeding in from a phone speaker: −17 to −19 dB;
 * a real run with hum intermodulation: −11 dB)
 */
export const SUB_DISTORTION_DB = -14;
/** …and the tracker lifting this share of the voiced readings from ½ / ⅓ (that run: 48 %). */
export const LIFTED_SHARE = 0.2;
/** A voice under this level (dBFS RMS) is too quiet to track reliably. */
export const QUIET_DB = -38;
/** Fewer voiced readings on the note than this: no verdict on distortion / level. */
const MIN_READINGS = 25;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Collects a run's readings and raw blocks and summarises them. */
export class InputMonitor {
  readonly readings: QualityReading[] = [];
  readonly blocks: RawBlock[] = [];
  filter: InputQuality['filter'];

  pushReading(r: QualityReading): void {
    this.readings.push(r);
  }

  pushBlock(b: RawBlock): void {
    this.blocks.push(b);
  }

  /** Forget what came before `ctxTime` (a rolling window, e.g. the setup mic check). */
  trim(ctxTime: number): void {
    let i = 0;
    while (i < this.readings.length && this.readings[i].ctxTime < ctxTime) i++;
    if (i) this.readings.splice(0, i);
    let j = 0;
    while (j < this.blocks.length && this.blocks[j].ctxTime < ctxTime) j++;
    if (j) this.blocks.splice(0, j);
  }

  summary(): InputQuality {
    return summarizeInput(this.readings, this.blocks, this.filter);
  }
}

export function summarizeInput(readings: QualityReading[], blocks: RawBlock[], filter?: InputQuality['filter']): InputQuality {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  // Voice: readings where a note is due and the tracker heard a pitch.
  const voiced = readings.filter((r) => r.expected != null && r.midi != null);
  const voiceDb = voiced.length >= 5 ? toDb(median(voiced.map((r) => r.rms))!) : null;
  // Hum: the quiet blocks (within 6 dB of the quietest, and well under the voice).
  let hum: InputQuality['hum'] = null;
  const sounding = blocks.filter((b) => b.hum.levelDb > SILENT_DB);
  if (sounding.length) {
    // The quietest level, robustly: a block straddling the microphone opening reads lower than any silence.
    const lv = sounding.map((b) => b.hum.levelDb).sort((a, b) => a - b);
    const minLevel = lv[Math.min(lv.length - 1, Math.max(1, Math.floor(0.05 * lv.length)))];
    const quiet = sounding.filter((b) => b.hum.levelDb <= minLevel + 6 && (voiceDb == null || b.hum.levelDb <= voiceDb - 10));
    const fam = (F: 50 | 60) => quiet.filter((b) => b.hum.family === F);
    const f50 = fam(50);
    const f60 = fam(60);
    const fs = f60.length >= f50.length ? f60 : f50;
    // Most of the quiet blocks must show it (a door slam or a click doesn't make hum).
    if (quiet.length && fs.length >= Math.max(1, quiet.length / 2)) {
      const db = median(fs.map((b) => b.hum.humDb))!;
      const hz = median(fs.map((b) => b.hum.hz).filter((x): x is number => x != null));
      if (hz != null) hum = { hz: r1(hz), db: r1(db), vsVoiceDb: voiceDb == null ? null : r1(db - voiceDb) };
    }
  }
  // Clipping while singing (blocks louder than the quiet ones).
  let runs = 0;
  let clipSlots = 0;
  let singSlots = 0;
  let peak = 0;
  for (const b of blocks) {
    runs += b.clip.runs;
    clipSlots += b.clip.slots;
    peak = Math.max(peak, b.clip.peak);
    if (voiceDb == null || b.hum.levelDb >= voiceDb - 12) singSlots += b.slotsTotal;
  }
  const share = singSlots > 0 ? clipSlots / singSlots : 0;
  // Distortion: on-note readings (within a semitone of the note due).
  const onNote = voiced.filter((r) => Math.abs(r.midi! - r.expected!) <= 1 && r.subDb != null && Number.isFinite(r.subDb));
  const subDb = onNote.length >= MIN_READINGS ? median(onNote.map((r) => r.subDb!)) : null;
  const allVoiced = readings.filter((r) => r.midi != null);
  const liftedShare = allVoiced.length ? allVoiced.filter((r) => r.lifted).length / allVoiced.length : 0;

  const problems: InputProblem[] = [];
  if (hum && (hum.vsVoiceDb != null ? hum.vsVoiceDb >= HUM_VS_VOICE_DB : hum.db >= HUM_ABS_DB)) problems.push('hum');
  if (share >= CLIP_SHARE) problems.push('clipping');
  if (subDb != null && subDb >= SUB_DISTORTION_DB && allVoiced.length >= MIN_READINGS && liftedShare >= LIFTED_SHARE) problems.push('distortion');
  if (voiceDb != null && voiced.length >= MIN_READINGS && voiceDb < QUIET_DB) problems.push('quiet');
  return {
    hum,
    clip: { runs, share: Math.round(share * 1000) / 1000, peak: r2(peak) },
    voiceDb: voiceDb == null ? null : r1(voiceDb),
    sub: { db: subDb == null ? null : r1(subDb), liftedShare: Math.round(liftedShare * 1000) / 1000, n: onNote.length },
    ...(filter ? { filter } : {}),
    problems,
  };
}

// ---------------------------------------------------------------------------------------------
// Advice

export interface InputAdvice {
  kind: InputProblem;
  title: string;
  text: string;
}

/** Short, concrete advice for each problem found (empty when the input is fine). */
export function inputAdvice(q: Pick<InputQuality, 'problems' | 'hum'> | null | undefined): InputAdvice[] {
  if (!q) return [];
  const out: InputAdvice[] = [];
  const has = (p: InputProblem) => q.problems.includes(p);
  if (has('clipping')) {
    out.push({
      kind: 'clipping', title: 'Too loud for the mic',
      text: 'Hold it a little further away, or lower the input volume (Mac: System Settings → Sound → Input; Windows: Sound settings → Input).',
    });
  }
  if (has('hum')) {
    out.push({
      kind: 'hum', title: 'Electrical hum on your microphone',
      text: 'Unplug the laptop charger, or use your headset’s mic or another USB port.',
    });
  }
  if (has('distortion')) {
    out.push({
      kind: 'distortion', title: 'Your microphone distorts',
      text: has('hum')
        ? 'The hum mixes with your voice and the app hears notes that aren’t there. Fix the hum first; if it stays, lower the input volume or try another mic.'
        : 'The app hears notes that aren’t there. Lower the input volume a little (Mac: System Settings → Sound → Input; Windows: Sound settings → Input), or try your headset’s mic.',
    });
  }
  if (has('quiet') && !has('clipping')) {
    out.push({
      kind: 'quiet', title: 'Your voice comes in very quietly',
      text: 'Sing at rehearsal volume, 20–50 cm from the mic, and check the input volume isn’t turned down (Mac: System Settings → Sound → Input; Windows: Sound settings → Input).',
    });
  }
  return out;
}
