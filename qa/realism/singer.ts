// Realistic synthetic singer: renders 48 kHz mono audio of one part as a phone mic would hear it,
// plus the ground-truth f0 contour.
//
// Time bases:
//   rec time τ   seconds since the first sample of the recording (= AudioContext time - ctx0)
//   score time s seconds at tempo factor 1 (Score.notes[].start)
// The app schedules score time s at rec time (s - s0) / rate, where s0 = scoreTimeAtSample0.
// A singer who is exactly on time with what they hear reaches the mic one acoustic round trip
// later: τ(s) = (s - s0) / rate + trueLatency. Their own timing errors come on top.

import type { Part, Score, ScoreNote } from '../../src/music/types';
import { Biquad, backgroundNoise, convolve, dbToGain, rms, roomImpulse } from './dsp';
import { Rng } from './prng';

export const SAMPLE_RATE = 48000;
/** Ground-truth contour resolution. */
export const TRUTH_HZ = 1000;

type Range2 = [number, number];

export interface SingerProfile {
  name: string;
  /** Mean per-note intonation error (cents). */
  biasCents: number;
  /** SD of the per-note intonation error (cents). */
  noteSdCents: number;
  vibrato: null | {
    extentCents: Range2;
    rateHz: Range2;
    /** Onset delay after the note's pitch command. */
    delayMs: Range2;
    rampMs: number;
    /** Relative slow wander of rate and extent (0.1 = ±10 %). */
    wander: number;
  };
  /** Slow drift (Ornstein–Uhlenbeck) of the whole voice. */
  drift: { sdCents: number; tauSec: number };
  /** Legato transitions as an underdamped 2nd-order response; null = instant steps (idealised). */
  transition: null | { fnHz: Range2; zeta: Range2 };
  /** Scoop from below at note starts after rests. */
  scoop: { prob: number; cents: Range2 };
  timing: {
    /** Onset jitter: uniform ±jitterMs (approximately). */
    jitterMs: number;
    /** Constant lead (<0) / lag (>0) of the singer. */
    biasMs: number;
  };
  consonants: boolean;
  consonantMs: Range2;
  /** Fraction of the consonant placed before the beat (trained singers put the vowel on the beat). */
  consonantLead: number;
  /** Voice stops this much before a written rest (breath). */
  releaseMs: Range2;
  /** Probability of a wrong note (±1–2 semitones). */
  wrongNoteProb: number;
  source: { jitterPct: number; shimmerPct: number; aspirationDb: number };
}

export interface ChannelProfile {
  rt60: number;
  wetDb: number;
  micHpfHz: number;
  snrDb: number;
  /** Bleed of the backing (speaker, no headphones) relative to the voice, dB; null = headphones. */
  bleedDb: number | null;
  /** Phone speakers have no bass: high-pass the bleed here. */
  speakerHpfHz: number;
  /** RMS of the voice at the mic (linear, full scale = 1). */
  voiceRms: number;
}

export interface RenderOptions {
  score: Score;
  part: Part;
  /** Inclusive note indices to sing. */
  range: [number, number];
  /** Section span in score time (what the player plays). */
  from: number;
  to: number;
  rate: number;
  trueLatencyMs: number;
  /** What the app assumes; only used for when the app stops listening. */
  assumedLatencyMs: number;
  /** Own part audible in the backing (levels 1–2). */
  guide: boolean;
  profile: SingerProfile;
  channel: ChannelProfile;
  /** Seeds the performance: intonation, timing, transitions, vibrato settings, drift. */
  performanceSeed: number;
  /** Seeds micro-randomness: glottal jitter/shimmer, noise, vibrato phase and wander. */
  microSeed: number;
  sampleRate?: number;
  /** Real seconds recorded before `from` is scheduled. */
  leadInSec?: number;
}

export interface RenderedNote {
  index: number;
  writtenMidi: number;
  /** Intended pitch (written + error), fractional MIDI. */
  targetMidi: number;
  scoreStart: number;
  scoreDur: number;
  /** Rec time the singer's pitch command switches to this note. */
  cmdSec: number;
  /** Rec time of the vowel (voicing) onset. */
  vowelSec: number;
  consonantSec: number | null;
  afterRest: boolean;
  wrong: boolean;
}

export interface RenderedTake {
  pcm: Float32Array;
  sampleRate: number;
  /** Score time (before latency compensation) of sample 0. */
  scoreTimeAtSample0: number;
  rate: number;
  trueLatencyMs: number;
  /** Rec time at which the app stops listening. */
  stopSec: number;
  /** Ground truth sung pitch at TRUTH_HZ (fractional MIDI incl. vibrato and drift; NaN = unvoiced). */
  truthMidi: Float32Array;
  /** Same without vibrato (the "centre" the singer aims at incl. transition dynamics and drift). */
  truthCentre: Float32Array;
  notes: RenderedNote[];
}

// ---------------------------------------------------------------------------------------------
// Profiles

const base: Omit<SingerProfile, 'name'> = {
  biasCents: 0,
  noteSdCents: 5,
  vibrato: { extentCents: [18, 22], rateHz: [5.3, 5.7], delayMs: [100, 300], rampMs: 150, wander: 0.1 },
  drift: { sdCents: 3, tauSec: 3 },
  transition: { fnHz: [7, 10], zeta: [0.45, 0.65] },
  scoop: { prob: 0.15, cents: [30, 80] },
  timing: { jitterMs: 25, biasMs: 0 },
  consonants: true,
  consonantMs: [30, 90],
  consonantLead: 0.7,
  releaseMs: [40, 120],
  wrongNoteProb: 0,
  source: { jitterPct: 0.7, shimmerPct: 4, aspirationDb: -30 },
};

export const SINGERS = {
  /** Trained choir singer: in tune, small vibrato, realistic legato. */
  goodChoir: { ...base, name: 'good choir singer' } as SingerProfile,
  /** Operatic vibrato ±50–60 ¢ at 6 Hz. */
  operatic: {
    ...base,
    name: 'operatic vibrato',
    noteSdCents: 6,
    vibrato: { extentCents: [50, 60], rateHz: [5.8, 6.2], delayMs: [100, 250], rampMs: 150, wander: 0.12 },
    transition: { fnHz: [6, 9], zeta: [0.4, 0.55] },
  } as SingerProfile,
  /** Control: no vibrato, critically damped transitions (no overshoot in the voice). */
  plainControl: {
    ...base,
    name: 'control (no vibrato, no overshoot)',
    vibrato: null,
    transition: { fnHz: [9, 9], zeta: [1, 1] },
    scoop: { prob: 0, cents: [0, 0] },
  } as SingerProfile,
  /** Strong overshoot singer (low damping). */
  ringing: {
    ...base,
    name: 'ringing transitions (zeta 0.35)',
    transition: { fnHz: [5, 7], zeta: [0.33, 0.38] },
  } as SingerProfile,
  flat40: { ...base, name: 'flat −40¢', biasCents: -40, noteSdCents: 8 } as SingerProfile,
  wrongNotes: { ...base, name: 'wrong notes (40 %)', wrongNoteProb: 0.4, noteSdCents: 8 } as SingerProfile,
};

/** The idealised singer used by the earlier synthetic tests (for ablations). */
export function idealised(p: SingerProfile): SingerProfile {
  return {
    ...p,
    name: `${p.name} (idealised)`,
    noteSdCents: 0,
    biasCents: 0,
    vibrato: null,
    drift: { sdCents: 0, tauSec: 3 },
    transition: null,
    scoop: { prob: 0, cents: [0, 0] },
    timing: { jitterMs: 0, biasMs: 0 },
    consonants: false,
  };
}

export const CHANNELS = {
  /** Phone on a music stand in a living room, headphones on. */
  phoneHeadphones: { rt60: 0.4, wetDb: -9, micHpfHz: 150, snrDb: 32, bleedDb: null, speakerHpfHz: 400, voiceRms: 0.05 } as ChannelProfile,
  /** Same, practising on the phone speaker (backing bleeds into the mic). */
  phoneSpeaker: { rt60: 0.4, wetDb: -9, micHpfHz: 150, snrDb: 32, bleedDb: -13, speakerHpfHz: 400, voiceRms: 0.05 } as ChannelProfile,
  /** Dry studio-like control. */
  clean: { rt60: 0.2, wetDb: -30, micHpfHz: 60, snrDb: 60, bleedDb: null, speakerHpfHz: 400, voiceRms: 0.05 } as ChannelProfile,
};

// ---------------------------------------------------------------------------------------------
// Vowels (alto formants, Hz / bandwidth Hz)

const VOWELS: { f: number[]; bw: number[] }[] = [
  { f: [800, 1150, 2800, 3500, 4950], bw: [80, 90, 120, 130, 140] }, // a
  { f: [400, 1600, 2700, 3300, 4950], bw: [60, 80, 120, 150, 200] }, // e
  { f: [350, 1700, 2700, 3700, 4950], bw: [50, 100, 120, 150, 200] }, // i
  { f: [450, 800, 2830, 3500, 4950], bw: [70, 80, 100, 130, 135] }, // o
  { f: [325, 700, 2530, 3500, 4950], bw: [50, 60, 170, 180, 200] }, // u
];

function startsWithConsonant(lyric: string): boolean {
  const c = lyric.normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase()[0];
  return !!c && !'aeiouy'.includes(c);
}

/** Klatt-style all-pole resonator (unity gain at DC). */
class Resonator {
  private a = 1; private b = 0; private c = 0; private y1 = 0; private y2 = 0;
  set(f: number, bw: number, sr: number): void {
    const t = 1 / sr;
    this.c = -Math.exp(-2 * Math.PI * bw * t);
    this.b = 2 * Math.exp(-Math.PI * bw * t) * Math.cos(2 * Math.PI * f * t);
    this.a = 1 - this.b - this.c;
  }
  process(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------------------------------------
// Rendering

/** Render one take of `part` over `range`. */
export function renderSinger(o: RenderOptions): RenderedTake {
  const sr = o.sampleRate ?? SAMPLE_RATE;
  const P = o.profile;
  const perf = new Rng(o.performanceSeed);
  const micro = new Rng(o.microSeed);
  const L = o.trueLatencyMs / 1000;
  const leadIn = o.leadInSec ?? 1.0;
  const s0 = o.from - leadIn * o.rate;
  const tau = (s: number) => (s - s0) / o.rate + L;
  // The app stops listening min(700, latency + 120) ms after the player ends.
  const stopSec = (o.to - s0) / o.rate + Math.min(0.7, o.assumedLatencyMs / 1000 + 0.12);
  const durSec = stopSec + 0.05;
  const nCtl = Math.ceil(durSec * TRUTH_HZ) + 1;
  const nAud = Math.ceil(durSec * sr);

  // ---- note plan --------------------------------------------------------------------------
  const ns = o.part.notes;
  const [ra, rb] = o.range;
  const hasLyrics = ns.slice(ra, rb + 1).some((n) => n.lyric);
  const notes: (RenderedNote & { endSec: number; voiceEnd: number; fn: number; zeta: number; vibDelay: number; vibExtent: number; scoopCents: number; vowel: number; consDur: number })[] = [];
  let vowel = perf.fork('vowel').next() * 5 | 0;
  for (let i = ra; i <= rb; i++) {
    const n: ScoreNote = ns[i];
    const prev = i > ra ? ns[i - 1] : null;
    const afterRest = !prev || n.start - (prev.start + prev.dur) > 0.03;
    const jit = clamp(perf.normal(0, P.timing.jitterMs / 2), -P.timing.jitterMs, P.timing.jitterMs) / 1000;
    let onset = tau(n.start) + P.timing.biasMs / 1000 + jit;
    const prevPlan = notes[notes.length - 1];
    if (prevPlan) onset = Math.max(onset, prevPlan.vowelSec + 0.5 * (prevPlan.endSec - prevPlan.vowelSec), prevPlan.vowelSec + 0.04);
    const lyricConsonant = n.lyric ? startsWithConsonant(n.lyric) : false;
    const cons = P.consonants && (hasLyrics ? lyricConsonant : afterRest || perf.chance(0.5));
    const consDur = cons ? Math.min(perf.range(P.consonantMs) / 1000, 0.45 * n.dur / o.rate) : 0;
    const consonantSec = cons ? onset - P.consonantLead * consDur : null;
    const vowelSec = cons ? onset + (1 - P.consonantLead) * consDur : onset;
    if (n.lyric || !hasLyrics) vowel = (vowel + 1) % 5;
    const wrong = P.wrongNoteProb > 0 && perf.chance(P.wrongNoteProb);
    const wrongBy = wrong ? perf.pick([-2, -1, 1, 2]) : 0;
    const targetMidi = n.midi + wrongBy + perf.normal(P.biasCents, P.noteSdCents) / 100;
    const cmdSec = afterRest ? vowelSec : cons ? consonantSec! + 0.5 * consDur : vowelSec - perf.uniform(0, 0.03);
    notes.push({
      index: i, writtenMidi: n.midi, targetMidi, scoreStart: n.start, scoreDur: n.dur, cmdSec, vowelSec,
      consonantSec, afterRest, wrong,
      endSec: tau(n.start + n.dur), voiceEnd: 0,
      fn: P.transition ? perf.range(P.transition.fnHz) : 0,
      zeta: P.transition ? perf.range(P.transition.zeta) : 1,
      vibDelay: P.vibrato ? perf.range(P.vibrato.delayMs) / 1000 : 0,
      vibExtent: P.vibrato ? perf.range(P.vibrato.extentCents) : 0,
      scoopCents: afterRest && P.transition && perf.chance(P.scoop.prob) ? perf.range(P.scoop.cents) : 0,
      vowel, consDur,
    });
  }
  for (let k = 0; k < notes.length; k++) {
    const a = notes[k];
    const b = notes[k + 1];
    if (!b || b.afterRest) {
      const endJit = clamp(perf.normal(0, P.timing.jitterMs / 2), -P.timing.jitterMs, P.timing.jitterMs) / 1000;
      a.voiceEnd = Math.max(a.vowelSec + 0.05, a.endSec + endJit - perf.range(P.releaseMs) / 1000);
      if (b) a.voiceEnd = Math.min(a.voiceEnd, (b.consonantSec ?? b.vowelSec) - 0.03);
    } else {
      a.voiceEnd = b.consonantSec ?? b.vowelSec;
    }
  }

  // ---- control-rate contour (1 kHz) --------------------------------------------------------
  const dt = 1 / TRUTH_HZ;
  const truthMidi = new Float32Array(nCtl).fill(NaN);
  const truthCentre = new Float32Array(nCtl).fill(NaN);
  const ctlMidi = new Float32Array(nCtl); // always defined (for phase continuity)
  const ctlAmp = new Float32Array(nCtl);
  const ctlCons = new Float32Array(nCtl);
  const ctlVowel = new Int8Array(nCtl);
  const vibRate = P.vibrato ? perf.range(P.vibrato.rateHz) : 0;
  let vibPhase = micro.uniform(0, 2 * Math.PI);
  let wanderR = 0;
  let wanderE = 0;
  let drift = perf.normal(0, P.drift.sdCents);
  let x = notes.length ? notes[0].targetMidi : 60;
  let v = 0;
  let env = 0;
  let amp = 0;
  let k = -1;
  const driftRng = perf.fork('drift');
  for (let j = 0; j < nCtl; j++) {
    const t = j * dt;
    while (k + 1 < notes.length && notes[k + 1].cmdSec <= t) {
      k++;
      const nk = notes[k];
      if (nk.afterRest) {
        x = nk.targetMidi - nk.scoopCents / 100;
        v = 0;
        env = 0;
      }
    }
    const cur = k >= 0 ? notes[k] : notes[0];
    if (cur) {
      const u = cur.targetMidi;
      if (!P.transition) {
        x = u;
        v = 0;
      } else {
        const wn = 2 * Math.PI * cur.fn;
        // 4 semi-implicit Euler sub-steps per ms (stable for wn·dt ≪ 1).
        const h = dt / 4;
        for (let q = 0; q < 4; q++) {
          v += h * (wn * wn * (u - x) - 2 * cur.zeta * wn * v);
          x += h * v;
        }
      }
      // Vibrato (fades out at each pitch command, back in after the per-note delay).
      if (P.vibrato) {
        const target = k >= 0 && t >= cur.cmdSec + cur.vibDelay ? cur.vibExtent : 0;
        const tc = target > env ? P.vibrato.rampMs / 3000 : 0.04;
        env += (target - env) * Math.min(1, dt / tc);
        wanderR += -wanderR * dt / 0.7 + Math.sqrt(2 * dt / 0.7) * micro.normal();
        wanderE += -wanderE * dt / 0.9 + Math.sqrt(2 * dt / 0.9) * micro.normal();
        vibPhase += 2 * Math.PI * vibRate * (1 + P.vibrato.wander * clamp(wanderR, -2, 2)) * dt;
      }
    }
    if (P.drift.sdCents > 0) drift += -drift * dt / P.drift.tauSec + P.drift.sdCents * Math.sqrt(2 * dt / P.drift.tauSec) * driftRng.normal();
    const vib = P.vibrato ? env * (1 + P.vibrato.wander * clamp(wanderE, -2, 2)) * Math.sin(vibPhase) : 0;
    const centre = x + drift / 100;
    const m = centre + vib / 100;
    ctlMidi[j] = m;
    // Voicing and consonants.
    let voiced = false;
    let cons = 0;
    for (let q = Math.max(0, k - 1); q <= Math.min(notes.length - 1, k + 1); q++) {
      const nq = notes[q];
      if (t >= nq.vowelSec && t < nq.voiceEnd) voiced = true;
      if (nq.consonantSec !== null && t >= nq.consonantSec && t < nq.vowelSec) {
        const a1 = (t - nq.consonantSec) / 0.006;
        const a2 = (nq.vowelSec - t) / 0.012;
        cons = Math.max(cons, clamp(Math.min(a1, a2), 0, 1));
      }
    }
    const aimAmp = voiced ? 1 : 0;
    amp += (aimAmp - amp) * Math.min(1, dt / (aimAmp > amp ? 0.012 : 0.02));
    ctlAmp[j] = amp;
    ctlCons[j] = cons;
    ctlVowel[j] = cur ? cur.vowel : 0;
    if (amp > 0.3) {
      truthMidi[j] = m;
      truthCentre[j] = centre;
    }
  }

  // ---- audio: glottal source → formants → voice -----------------------------------------------
  const ctlHz = new Float32Array(nCtl);
  for (let j = 0; j < nCtl; j++) ctlHz[j] = 440 * Math.pow(2, (ctlMidi[j] - 69) / 12);
  const voice = new Float32Array(nAud);
  const res = Array.from({ length: 5 }, () => new Resonator());
  const curF = [...VOWELS[ctlVowel[0]].f];
  const curB = [...VOWELS[ctlVowel[0]].bw];
  const consHp = Biquad.highpass(2500, sr, 0.7);
  const aspG = dbToGain(P.source.aspirationDb) * 0.76;
  let ph = 0;
  let jf = 1;
  let sh = 1;
  const block = sr / TRUTH_HZ;
  for (let n = 0; n < nAud; n++) {
    const tc = n / block;
    const j = Math.min(nCtl - 2, Math.floor(tc));
    const fr = tc - j;
    if (n % block === 0) {
      const target = VOWELS[ctlVowel[j]];
      for (let q = 0; q < 5; q++) {
        curF[q] += (target.f[q] - curF[q]) * 0.05;
        curB[q] += (target.bw[q] - curB[q]) * 0.05;
        res[q].set(curF[q], curB[q], sr);
      }
    }
    const a = ctlAmp[j] + (ctlAmp[j + 1] - ctlAmp[j]) * fr;
    const f0 = ctlHz[j] + (ctlHz[j + 1] - ctlHz[j]) * fr;
    ph += (f0 * jf) / sr;
    if (ph >= 1) {
      ph -= 1;
      jf = 1 + micro.normal(0, P.source.jitterPct / 100);
      sh = Math.max(0, 1 + micro.normal(0, P.source.shimmerPct / 100));
    }
    let src = 0;
    if (a > 1e-4) {
      const th = 2 * Math.PI * ph;
      const s1 = Math.sin(th);
      const c2 = 2 * Math.cos(th);
      const K = Math.min(40, Math.floor(7000 / f0));
      let sPrev = 0;
      let sk = s1;
      for (let kk = 1; kk <= K; kk++) {
        src += sk / (kk * kk);
        const sn = c2 * sk - sPrev;
        sPrev = sk;
        sk = sn;
      }
      src = a * sh * src + a * aspG * micro.gauss() * (ph < 0.5 ? 1 : 0.4);
    }
    let y = src;
    for (let q = 0; q < 5; q++) y = res[q].process(y);
    const c = ctlCons[j];
    const cn = consHp.process(c > 0 ? micro.gauss() : 0);
    voice[n] = y + c * cn * 0.6;
  }
  // Normalise the voice to the channel's level (RMS over voiced audio), keeping consonants relative.
  let e = 0;
  let cnt = 0;
  for (let n = 0; n < nAud; n++) {
    const j = Math.min(nCtl - 1, Math.floor(n / block));
    if (ctlAmp[j] > 0.5) { e += voice[n] * voice[n]; cnt++; }
  }
  const vr = cnt ? Math.sqrt(e / cnt) : 1;
  const g = o.channel.voiceRms / (vr || 1);
  for (let n = 0; n < nAud; n++) voice[n] *= g;

  // ---- backing bleed ---------------------------------------------------------------------------
  const mix = voice;
  if (o.channel.bleedDb !== null) {
    const bleed = renderBacking(o, s0, L, nAud, sr);
    const br = rms(bleed);
    if (br > 0) {
      const bg = (o.channel.voiceRms * dbToGain(o.channel.bleedDb)) / br;
      for (let n = 0; n < nAud; n++) mix[n] += bleed[n] * bg;
    }
  }

  // ---- room, mic, noise -------------------------------------------------------------------------
  const ir = roomImpulse(micro.fork('room'), sr, o.channel.rt60, dbToGain(o.channel.wetDb));
  const wet = convolve(mix, ir);
  const out = new Float32Array(nAud);
  for (let n = 0; n < nAud; n++) out[n] = mix[n] + wet[n];
  Biquad.highpass(o.channel.micHpfHz, sr).processBuffer(out);
  const noise = backgroundNoise(micro.fork('noise'), nAud);
  const ng = o.channel.voiceRms * dbToGain(-o.channel.snrDb);
  for (let n = 0; n < nAud; n++) out[n] = clamp(out[n] + noise[n] * ng, -1, 1);

  return {
    pcm: out,
    sampleRate: sr,
    scoreTimeAtSample0: s0,
    rate: o.rate,
    trueLatencyMs: o.trueLatencyMs,
    stopSec,
    truthMidi,
    truthCentre,
    notes: notes.map(({ index, writtenMidi, targetMidi, scoreStart, scoreDur, cmdSec, vowelSec, consonantSec, afterRest, wrong }) => ({
      index, writtenMidi, targetMidi, scoreStart, scoreDur, cmdSec, vowelSec, consonantSec, afterRest, wrong,
    })),
  };
}

/** The app's playback (other parts, plus the own part when `guide`) as a phone speaker plays it. */
function renderBacking(o: RenderOptions, s0: number, L: number, nAud: number, sr: number): Float32Array {
  const out = new Float32Array(nAud);
  const ATTACK = 0.06;
  const RELEASE = 0.12;
  for (const p of o.score.parts) {
    const own = p.id === o.part.id;
    if (own && !o.guide) continue;
    const gain = own ? 0.9 * 0.22 : (p.voiceType === 'other' ? 0.55 : 0.7) * 0.18;
    const cutoff = own ? 2600 : 1200;
    for (const n of p.notes) {
      if (n.start + n.dur <= o.from || n.start >= o.to) continue;
      const t0 = (n.start - s0) / o.rate + L;
      const d = n.dur / o.rate;
      const f = 440 * Math.pow(2, (n.midi - 69) / 12);
      const K = Math.max(1, Math.min(12, Math.floor(cutoff / f)));
      const i0 = Math.max(0, Math.floor(t0 * sr));
      const i1 = Math.min(nAud, Math.ceil((t0 + d + RELEASE) * sr));
      for (let i = i0; i < i1; i++) {
        const t = i / sr - t0;
        const env = t < ATTACK ? t / ATTACK : t < d ? 1 : Math.max(0, 1 - (t - d) / RELEASE);
        const th = 2 * Math.PI * f * t;
        const s1 = Math.sin(th);
        const c2 = 2 * Math.cos(th);
        let sPrev = 0;
        let sk = s1;
        let s = 0;
        for (let k = 1; k <= K; k++) {
          // Triangle (odd partials, 1/k²) + a touch of the 2nd partial ("oo") or a sawtooth ("guide").
          let w = k % 2 ? ((k - 1) / 2) % 2 ? -1 / (k * k) : 1 / (k * k) : 0;
          if (own) w += 0.25 / k;
          else if (k === 2) w += 0.3;
          s += w * sk;
          const sn = c2 * sk - sPrev;
          sPrev = sk;
          sk = sn;
        }
        out[i] += gain * env * s;
      }
    }
  }
  const hp1 = Biquad.highpass(o.channel.speakerHpfHz, sr);
  const hp2 = Biquad.highpass(o.channel.speakerHpfHz, sr);
  for (let i = 0; i < nAud; i++) out[i] = hp2.process(hp1.process(out[i]));
  return out;
}

/** Truth value at rec time `sec` (linear interpolation; NaN if unvoiced at either neighbour). */
export function truthAt(truth: Float32Array, sec: number): number {
  const x = sec * TRUTH_HZ;
  const j = Math.floor(x);
  if (j < 0 || j + 1 >= truth.length) return NaN;
  const a = truth[j];
  const b = truth[j + 1];
  return a + (b - a) * (x - j);
}
