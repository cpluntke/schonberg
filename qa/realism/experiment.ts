// One synthetic take end to end: render → track → map → score (+ oracle, loss, display bubble).
import type { ScoringOptions } from '../../src/game/types';
import { bubbleStats, lossBreakdown, type BubbleStats, type LossBreakdown } from './fidelity';
import { levelSetup, oracleSamples, scorePcm, SCORE_CURRENT, type Scored, type Scorer, type Sidecar } from './harness';
import { hashSeed } from './prng';
import { findPart, loadPiece, noteRangeFor } from './scores';
import { CHANNELS, renderSinger, type ChannelProfile, type RenderedTake, type SingerProfile } from './singer';
import { PITCH_CURRENT, type PitchImpl, type TrackOptions } from './tracker';

export interface Target {
  id: string;
  piece: string;
  /** Voice type ('A') or part id ('P1'). */
  part: string;
  /** Index into computeSections(score). */
  section: number;
}

export interface LatencyCondition {
  id: string;
  label: string;
  trueLatencyMs: number;
  assumedLatencyMs: number;
  /** Profile has no calibrated latency (Play.tsx may learn one after the run). */
  uncalibrated: boolean;
}

export const LATENCIES: LatencyCondition[] = [
  { id: 'cal', label: 'calibrated (true = assumed = 150 ms)', trueLatencyMs: 150, assumedLatencyMs: 150, uncalibrated: false },
  { id: 'uncal200', label: 'uncalibrated phone (true 200, assumed 80)', trueLatencyMs: 200, assumedLatencyMs: 80, uncalibrated: true },
  { id: 'uncal280', label: 'uncalibrated phone (true 280, assumed 80)', trueLatencyMs: 280, assumedLatencyMs: 80, uncalibrated: true },
];

export interface TakeConfig {
  target: Target;
  singer: SingerProfile;
  level: number;
  latency: LatencyCondition;
  channel?: ChannelProfile;
  performanceSeed: number;
  microSeed: number;
  scorer?: Scorer;
  pitchImpl?: PitchImpl;
  track?: TrackOptions;
  /** Also score the ground-truth contour (perfect tracker, true latency). */
  oracle?: boolean;
  /** Override what the app assumes (e.g. a latency learned in a previous run). */
  assumedLatencyMs?: number;
  /**
   * Reported output latency used by the display (pos = scoreTimeAt(ctx − out)).
   * Default: assumed − 40 ms, the app's own model (estimate = output latency + 40 ms input/processing).
   */
  outputLatencyMs?: number;
  /** Extra scoring options (vibratoWindow, onsetGrace) on top of the level's. */
  scoringExtra?: Partial<ScoringOptions>;
}

export interface TakeRecord {
  target: string;
  section: string;
  singer: string;
  level: number;
  latency: string;
  trueLatencyMs: number;
  assumedLatencyMs: number;
  channel: string;
  performanceSeed: number;
  microSeed: number;
  toleranceCents: number;
  pitch: number;
  rhythm: number;
  accuracy: number;
  letter: string;
  passed: boolean | null;
  avgCents: number | null;
  counts: Record<string, number>;
  learned?: { latencyMs: number; pitch: number; accuracy: number; letter: string; passed: boolean | null };
  oracle?: { pitch: number; rhythm: number; accuracy: number; letter: string };
  loss: LossBreakdown;
  bubble: BubbleStats;
}

export interface TakeRun { record: TakeRecord; take: RenderedTake; scored: Scored; sidecar: Sidecar }

export async function runTake(c: TakeConfig): Promise<TakeRun> {
  const piece = await loadPiece(c.target.piece);
  const part = findPart(piece.score, c.target.part);
  const sec = piece.sections[c.target.section];
  if (!sec) throw new Error(`No section ${c.target.section} in ${c.target.piece}`);
  const range = noteRangeFor(part, sec.start, sec.end);
  if (!range) throw new Error(`No ${part.name} notes in ${sec.label}`);
  const L = levelSetup(c.level);
  const assumed = c.assumedLatencyMs ?? c.latency.assumedLatencyMs;
  const channel = c.channel ?? CHANNELS.phoneHeadphones;
  const take = renderSinger({
    score: piece.score, part, range, from: sec.start, to: sec.end, rate: L.rate,
    trueLatencyMs: c.latency.trueLatencyMs, assumedLatencyMs: assumed, guide: L.guide,
    profile: c.singer, channel,
    performanceSeed: hashSeed('perf', c.performanceSeed, c.target.id, c.level),
    microSeed: hashSeed('micro', c.microSeed, c.target.id, c.level),
  });
  const sidecar: Sidecar = {
    version: 1, pieceId: c.target.piece, partId: part.id, from: sec.start, to: sec.end, rate: L.rate, level: L.level,
    toleranceCents: L.toleranceCents, tuning: 'equal', octaveTolerant: false, latencyMs: assumed,
    sampleRate: take.sampleRate, scoreTimeAtSample0: take.scoreTimeAtSample0,
  };
  const baseScorer = c.scorer ?? SCORE_CURRENT;
  const scorer: Scorer = c.scoringExtra ? (ctx, s, o) => baseScorer(ctx, s, { ...o, ...c.scoringExtra }) : baseScorer;
  const track: TrackOptions = { jitterMs: 3, seed: hashSeed('hop', c.microSeed), impl: c.pitchImpl ?? PITCH_CURRENT, ...c.track };
  const scored = await scorePcm(take.pcm, sidecar, { scorer, track, untilSec: take.stopSec, uncalibrated: c.latency.uncalibrated && c.assumedLatencyMs === undefined });
  const r = scored.result;

  let oracle: TakeRecord['oracle'];
  if (c.oracle) {
    const o = await scorePcm(take.pcm, sidecar, { scorer, samples: oracleSamples(take, { latencyMs: c.latency.trueLatencyMs, from: sec.start }) });
    oracle = { pitch: o.result.pitch, rhythm: o.result.rhythm, accuracy: o.result.accuracy, letter: o.letter };
  }

  // Display emulation uses every reading (the trace is drawn from all samples).
  const N = track.windowN ?? 2048;
  const disp = scored.readings.map((x) => ({
    time: take.scoreTimeAtSample0 + (x.stampSec - assumed / 1000) * L.rate,
    midi: x.midi, clarity: x.clarity, rms: x.rms,
  }));
  const avail = scored.readings.map((x) => x.centreSec + N / 2 / take.sampleRate);
  const bubble = bubbleStats(part, range, disp, avail, {
    scoreTimeAtSample0: take.scoreTimeAtSample0, rate: L.rate, outputLatencyMs: c.outputLatencyMs ?? Math.max(0, assumed - 40),
    tolerance: L.toleranceCents, stopSec: take.stopSec,
  });

  const record: TakeRecord = {
    target: c.target.id, section: sec.label, singer: c.singer.name, level: c.level, latency: c.latency.id,
    trueLatencyMs: c.latency.trueLatencyMs, assumedLatencyMs: assumed, channel: channelName(channel),
    performanceSeed: c.performanceSeed, microSeed: c.microSeed, toleranceCents: L.toleranceCents,
    pitch: r.pitch, rhythm: r.rhythm, accuracy: r.accuracy, letter: scored.letter, passed: scored.passed, avgCents: scored.avgCents,
    counts: { ...r.counts },
    learned: scored.learned ? {
      latencyMs: scored.learned.latencyMs, pitch: scored.learned.result.pitch, accuracy: scored.learned.result.accuracy,
      letter: scored.learned.letter, passed: scored.learned.passed,
    } : undefined,
    oracle,
    loss: lossBreakdown(part, r, scored.samples, L.toleranceCents, c.scoringExtra?.vibratoWindow ?? 0.18, c.scoringExtra?.onsetGrace ?? 0.08),
    bubble,
  };
  return { record, take, scored, sidecar };
}

function channelName(c: ChannelProfile): string {
  for (const [k, v] of Object.entries(CHANNELS)) if (v === c) return k;
  return c.bleedDb === null ? 'custom' : 'custom+bleed';
}
