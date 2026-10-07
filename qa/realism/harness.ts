// Glue: recording (+ sidecar) → offline tracker → score-time samples → pluggable scorer.
// Mirrors src/ui/play/session.ts (onPitch, minTime), src/ui/screens/Play.tsx (scoring options,
// latency learning) and src/ui/screens/Results.tsx (grade letter, "avg ¢").
import { readFileSync } from 'node:fs';
import type { AttemptResult, PitchSample, ScoringOptions, TuningMode } from '../../src/game/types';
import type { ScoringContext } from '../../src/game/scoring';
import { scoreAttempt as scoreCurrent } from '../../src/game/scoring';
import { LEVELS, attemptPasses, effectiveTolerance, levelSpec, wrongNotes, type Strictness } from '../../src/progress/ladder';
import { scoreAttempt as scoreHead } from './baseline/scoring';
import { loadPiece, noteRangeFor } from './scores';
import { trackOffline, type TrackOptions, type TrackReading } from './tracker';
import { readWav } from './wav';
import { micTrouble } from '../../src/audio/inputQuality';
import { TRUTH_HZ, truthAt, type RenderedTake } from './singer';

/** End-of-run scoring step. Defaults to the app's scoreAttempt. */
export type Scorer = (ctx: ScoringContext, samples: PitchSample[], opts: ScoringOptions) => AttemptResult;

/** The working-tree scorer (src/game/scoring.ts as it is now). */
export const SCORE_CURRENT: Scorer = scoreCurrent;
/** Frozen copy of scoreAttempt at the baseline commit (qa/realism/baseline/scoring.ts). */
export const SCORE_HEAD: Scorer = scoreHead as unknown as Scorer;

/** Sidecar JSON the app exports next to a 16-bit WAV recording. */
export interface Sidecar {
  /** 2 adds inputQuality and a 5th sample field (mic trouble); nothing here reads them. */
  version: 1 | 2;
  pieceId: string;
  partId: string;
  from: number;
  to: number;
  rate: number;
  level?: number;
  toleranceCents: number;
  tuning: TuningMode;
  octaveTolerant: boolean;
  /** Latency the app assumed (calibrated or estimated), ms. */
  latencyMs: number;
  sampleRate: number;
  /** Score time (before latency compensation) of the WAV's first sample. */
  scoreTimeAtSample0: number;
  /** Analysis window the app used (current app exports it). */
  windowN?: number;
  /** The delay was measured with the delay check (current app exports it). */
  calibrated?: boolean;
}

export interface LevelSetup {
  level: number;
  rate: number;
  toleranceCents: number;
  pass: number;
  /** Own part audible (levels 1–2). */
  guide: boolean;
}

export function levelSetup(level: number, strictness: Strictness = 'standard'): LevelSetup {
  const spec = LEVELS[Math.min(4, Math.max(1, level)) - 1];
  return { level: spec.level, rate: spec.rate, toleranceCents: effectiveTolerance(spec.level, strictness), pass: spec.pass, guide: spec.guide };
}

/**
 * Results.tsx gradeLetter: from accuracy, but at an every-note level (level 1) a run with a wrong
 * note shows at most a B, so the letter never reads as a pass next to "Not yet".
 */
export function gradeLetter(acc: number, wrongAtEveryNote = false): string {
  const l = acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : acc >= 0.5 ? 'C' : 'D';
  return wrongAtEveryNote && (l === 'S' || l === 'A') ? 'B' : l;
}

/** The letter Results shows for `result` at `level`. */
export function letterFor(level: number, result: AttemptResult): string {
  return gradeLetter(result.accuracy, levelSpec(level).everyNote && wrongNotes(result).length > 0);
}

/** Results.tsx "avg ±N¢" (median of per-note cents within ±100). */
export function avgCents(r: AttemptResult): number | null {
  const c = r.notes.map((n) => n.cents).filter((x): x is number => x != null && Math.abs(x) < 100).sort((a, b) => a - b);
  return c.length ? Math.round(c[Math.floor(c.length / 2)]) : null;
}

/**
 * session.ts onPitch: scoreTime = scoreTimeAt(ctxTime − latency), with
 * ctxTime − ctx0 = stampSec. Samples before minTime (from − 0.6) are dropped.
 */
export function readingsToSamples(
  readings: TrackReading[],
  m: { scoreTimeAtSample0: number; rate: number; latencyMs: number; from: number },
): PitchSample[] {
  const minTime = m.from - 0.6;
  const out: PitchSample[] = [];
  for (const r of readings) {
    const time = m.scoreTimeAtSample0 + (r.stampSec - m.latencyMs / 1000) * m.rate;
    if (time < minTime) continue;
    out.push({ time, midi: r.midi, clarity: r.clarity, rms: r.rms, ...(micTrouble(r) ? { mic: true } : {}) });
  }
  return out;
}

/** A perfect tracker: the ground-truth contour sampled every hop and mapped with `latencyMs`. */
export function oracleSamples(take: RenderedTake, m: { latencyMs: number; from: number; hopMs?: number }): PitchSample[] {
  const hop = (m.hopMs ?? 20) / 1000;
  const out: PitchSample[] = [];
  for (let t = hop; t <= take.stopSec; t += hop) {
    const v = truthAt(take.truthMidi, t);
    const time = take.scoreTimeAtSample0 + (t - m.latencyMs / 1000) * take.rate;
    if (time < m.from - 0.6) continue;
    const midi = Number.isFinite(v) ? v : null;
    out.push({ time, midi, clarity: midi == null ? 0.3 : 0.97, rms: midi == null ? 0.001 : 0.05 });
  }
  return out;
}

export interface Scored {
  result: AttemptResult;
  letter: string;
  passed: boolean | null;
  avgCents: number | null;
  range: [number, number];
  samples: PitchSample[];
  readings: TrackReading[];
  /** Set when the Play.tsx latency learning would fire (uncalibrated runs only). */
  learned?: { latencyMs: number; result: AttemptResult; letter: string; passed: boolean | null };
}

export interface ScoreOptions {
  scorer?: Scorer;
  track?: TrackOptions;
  /** Emulate Play.tsx: when uncalibrated, learn the delay from late entries and re-score. */
  uncalibrated?: boolean;
  /** Stop reading at this rec time (the app stops listening). */
  untilSec?: number;
  /** Use these samples instead of tracking the audio (e.g. oracleSamples). */
  samples?: PitchSample[];
}

function passOf(level: number | undefined, result: AttemptResult): boolean | null {
  return level && level >= 1 && level <= 5 ? attemptPasses(level, result) : null;
}

/** Track + score mono PCM described by a sidecar. */
export async function scorePcm(pcm: Float32Array, sc: Sidecar, o: ScoreOptions = {}): Promise<Scored> {
  const scorer = o.scorer ?? SCORE_CURRENT;
  const piece = await loadPiece(sc.pieceId);
  const part = piece.score.parts.find((p) => p.id === sc.partId);
  if (!part) throw new Error(`Part ${sc.partId} not in ${sc.pieceId}`);
  const range = noteRangeFor(part, sc.from, sc.to);
  if (!range) throw new Error('No notes in the section');
  const readings = o.samples ? [] : trackOffline(pcm, sc.sampleRate, { untilSec: o.untilSec, windowN: sc.windowN, ...o.track });
  const samples = o.samples ?? readingsToSamples(readings, sc);
  const ctx: ScoringContext = { score: piece.score, part, range, end: sc.to };
  const opts: ScoringOptions = { toleranceCents: sc.toleranceCents, tuning: sc.tuning, octaveTolerant: sc.octaveTolerant, rate: sc.rate };
  const result = scorer(ctx, samples, opts);
  const out: Scored = {
    result, letter: sc.level ? letterFor(sc.level, result) : gradeLetter(result.accuracy), passed: passOf(sc.level, result), avgCents: avgCents(result), range, samples, readings,
  };
  if (o.uncalibrated) {
    const l = emulateLatencyLearn(ctx, result, samples, sc.rate, sc.latencyMs, opts, scorer);
    if (l) out.learned = { latencyMs: l.latencyMs, result: l.result, letter: sc.level ? letterFor(sc.level, l.result) : gradeLetter(l.result.accuracy), passed: passOf(sc.level, l.result) };
  }
  return out;
}

/** Score a real recording: 16-bit PCM / 32-bit float WAV + sidecar JSON (object or path). */
export async function scoreRecording(wavPath: string, sidecar: Sidecar | string, scorer?: Scorer, o: Omit<ScoreOptions, 'scorer'> = {}): Promise<Scored> {
  const sc: Sidecar = typeof sidecar === 'string' ? JSON.parse(readFileSync(sidecar, 'utf8')) : sidecar;
  const buf = readFileSync(wavPath);
  const wav = readWav(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  if (sc.sampleRate && wav.sampleRate !== sc.sampleRate) throw new Error(`WAV is ${wav.sampleRate} Hz but the sidecar says ${sc.sampleRate}`);
  return scorePcm(wav.pcm, { ...sc, sampleRate: wav.sampleRate }, { ...o, scorer });
}

/**
 * Port of the latency learning in Play.tsx onDone (uncalibrated profiles only): consistent late
 * entries after rests (or all onsets if there are few entries) → learn the delay and re-score.
 */
export function emulateLatencyLearn(
  ctx: ScoringContext, r: AttemptResult, samples: PitchSample[], rate: number, sessionLatencyMs: number, opts: ScoringOptions, scorer: Scorer,
): { latencyMs: number; result: AttemptResult } | null {
  const part = ctx.part;
  const entryOnsets = r.notes
    .filter((n) => {
      const i = n.index;
      const prev = i > 0 ? part.notes[i - 1] : null;
      return n.onsetMs != null && (!prev || part.notes[i].start - (prev.start + prev.dur) >= 0.4);
    })
    .map((n) => n.onsetMs!)
    .sort((a, b) => a - b);
  const allOnsets = r.notes
    .filter((n) => {
      if (n.onsetMs == null) return false;
      const prev = n.index > 0 ? part.notes[n.index - 1] : null;
      const cur = part.notes[n.index];
      return !(prev && prev.midi === cur.midi && cur.start - (prev.start + prev.dur) < 0.25);
    })
    .map((n) => n.onsetMs!)
    .sort((a, b) => a - b);
  const useAll = entryOnsets.length < 2 && allOnsets.length >= 6;
  if (useAll) entryOnsets.splice(0, entryOnsets.length, ...allOnsets);
  if (entryOnsets.length < 2) return null;
  const med = entryOnsets[Math.floor(entryOnsets.length / 2)];
  const iqr = entryOnsets[Math.floor(entryOnsets.length * 0.75)] - entryOnsets[Math.floor(entryOnsets.length * 0.25)];
  if (!(med / rate > 170 && iqr / rate < 120)) return null;
  const latencyMs = Math.round(Math.min(400, sessionLatencyMs + (med / rate - 50)));
  const shift = ((latencyMs - sessionLatencyMs) / 1000) * rate;
  const idx = r.notes.map((n) => n.index);
  const result = scorer({ ...ctx, range: [Math.min(...idx), Math.max(...idx)] }, samples.map((x) => ({ ...x, time: x.time - shift })), opts);
  return { latencyMs, result };
}

export { TRUTH_HZ };

/**
 * Score a real recording exactly as the CURRENT app does at the end of a run: raw readings with
 * the sidecar's window → scoreAttempt → scoreAligned (+ subharmonic lift) → timing gate (L≥2, measured
 * delay). Returns the pipeline outcome (result, alignedMs, timingFailMs, the delay the app would store…).
 */
export async function scoreRecordingApp(wavPath: string, sidecar: Sidecar | string, spec?: import('./pipeline').PipelineSpec) {
  const { runSession, AFTER, measured } = await import('./pipeline');
  const sc: Sidecar = typeof sidecar === 'string' ? JSON.parse(readFileSync(sidecar, 'utf8')) : sidecar;
  const buf = readFileSync(wavPath);
  const wav = readWav(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const piece = await loadPiece(sc.pieceId);
  const part = piece.score.parts.find((p) => p.id === sc.partId);
  if (!part) throw new Error(`Part ${sc.partId} not in ${sc.pieceId}`);
  const range = noteRangeFor(part, sc.from, sc.to);
  if (!range) throw new Error('No notes in the section');
  const take = {
    pcm: wav.pcm, sampleRate: wav.sampleRate, scoreTimeAtSample0: sc.scoreTimeAtSample0, rate: sc.rate, trueLatencyMs: NaN,
    stopSec: wav.pcm.length / wav.sampleRate, truthMidi: new Float32Array(0), truthCentre: new Float32Array(0), notes: [],
  };
  const profile = sc.calibrated ? measured(sc.latencyMs) : { latencyMs: sc.latencyMs };
  return runSession(spec ?? AFTER, {
    take, part, ctx: { score: piece.score, part, range, end: sc.to }, from: sc.from, to: sc.to, level: sc.level ?? 1, microSeed: 1, windowN: sc.windowN,
    scoring: { toleranceCents: sc.toleranceCents, tuning: sc.tuning, octaveTolerant: sc.octaveTolerant, rate: sc.rate },
  }, profile);
}
