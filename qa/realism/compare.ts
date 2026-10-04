// Before/after comparison experiments (baseline app vs current app) on shared renders.
// Each cmp-*.test.ts runs a slice and writes qa/realism/out/parts/<name>.json; the global teardown
// (global-setup.ts → report-current.ts) merges the parts into report-current.json and
// docs/qa/realism-current.md. Splitting into files lets vitest use all cores.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScoringContext } from '../../src/game/scoring';
import { fidelity, type Fidelity, type TakeReadings } from './fidelity';
import { levelSetup, oracleSamples } from './harness';
import { AFTER, AFTER_EST80, BEFORE, UNCALIBRATED, afterScorerView, measured, runSession, type AfterImpl, type PipelineSpec, type Profile, type RunSetup, type SessionOutcome } from './pipeline';
import { hashSeed } from './prng';
import { findPart, loadPiece, noteRangeFor, REPO_ROOT } from './scores';
import { CHANNELS, renderSinger, type ChannelProfile, type SingerProfile } from './singer';
import { scoreAttempt as curScoreAttempt } from '../../src/game/scoring';
import { scoreAttempt as headScoreAttempt } from './baseline/scoring';
import type { AttemptResult } from '../../src/game/types';
import type { Target } from './experiment';

export const OUT_DIR = resolve(REPO_ROOT, 'qa/realism/out');
export const PARTS_DIR = resolve(OUT_DIR, 'parts');

export const T = {
  warmup0: { id: 'warmup-upbeat-6', piece: 'warmup-chorale', part: 'A', section: 0 },
  warmup1: { id: 'warmup-7-12', piece: 'warmup-chorale', part: 'A', section: 1 },
  dieu0: { id: 'dieu-1-5', piece: 'debussy-dieu', part: 'A', section: 0 },
  dieu1: { id: 'dieu-6-13', piece: 'debussy-dieu', part: 'A', section: 1 },
  tab0: { id: 'tabourin-solo-1-8', piece: 'debussy-tabourin', part: 'P1', section: 0 },
  tab1: { id: 'tabourin-solo-9-16', piece: 'debussy-tabourin', part: 'P1', section: 1 },
} satisfies Record<string, Target>;
export const ALL_TARGETS: Target[] = Object.values(T);

declare const process: { env: Record<string, string | undefined> };
export const SEEDS = Math.max(2, Number(process.env.REALISM_SEEDS ?? 10));

// ---------------------------------------------------------------------------------------------

export interface RenderSpec {
  target: Target;
  singer: SingerProfile;
  level: number;
  trueLatencyMs: number;
  performanceSeed: number;
  microSeed: number;
  channel?: ChannelProfile;
}

/** Render once (long enough for any assumed delay); every pipeline/profile scores the same audio. */
export async function render(r: RenderSpec): Promise<RunSetup> {
  const piece = await loadPiece(r.target.piece);
  const part = findPart(piece.score, r.target.part);
  const sec = piece.sections[r.target.section];
  const range = noteRangeFor(part, sec.start, sec.end)!;
  const L = levelSetup(r.level);
  const take = renderSinger({
    score: piece.score, part, range, from: sec.start, to: sec.end, rate: L.rate,
    trueLatencyMs: r.trueLatencyMs, assumedLatencyMs: 450, guide: L.guide,
    profile: r.singer, channel: r.channel ?? CHANNELS.phoneHeadphones,
    performanceSeed: hashSeed('perf', r.performanceSeed, r.target.id, r.level),
    microSeed: hashSeed('micro', r.microSeed, r.target.id, r.level),
  });
  const ctx: ScoringContext = { score: piece.score, part, range };
  return { take, part, ctx, from: sec.start, to: sec.end, level: r.level, microSeed: r.microSeed };
}

/** JSON-friendly summary of one run. */
export interface RunSummary {
  pipeline: string;
  latencyUsedMs: number;
  windowN: number;
  pitch: number;
  rhythm: number;
  accuracy: number;
  letter: string;
  passed: boolean;
  timingFailMs: number | null;
  alignedMs: number;
  match: number | null;
  learnedMs: number | null;
  medianOnsetMs: number | null;
  avgCents: number | null;
  insights: string[];
  counts: Record<string, number>;
  bubble: { lagShare: number; overShare: number; settleMs: number };
  loss: { early: number; perfect: number; demoted: number; lowHit: number };
}

export function summarize(o: SessionOutcome, label?: string): RunSummary {
  const r = o.result;
  return {
    pipeline: label ?? o.pipeline, latencyUsedMs: o.latencyUsedMs, windowN: o.windowN, pitch: r.pitch, rhythm: r.rhythm,
    accuracy: r.accuracy, letter: o.letter, passed: o.passed, timingFailMs: o.timingFailMs, alignedMs: o.alignedMs,
    match: o.match, learnedMs: o.learnedMs, medianOnsetMs: o.medianOnsetMs, avgCents: o.avgCents, insights: o.insights,
    counts: { ...r.counts }, bubble: { lagShare: o.bubble.lagShare, overShare: o.bubble.overShare, settleMs: o.bubble.settleMs },
    loss: { early: o.loss.lostEarlyShare, perfect: o.loss.perfect, demoted: o.loss.demotedByMedian, lowHit: o.loss.lowHitRatio },
  };
}

export interface PipeChain { label: string; spec: PipelineSpec; start: Profile }

/** The pipelines compared for an uncalibrated phone. */
export const UNCAL_CHAINS: PipeChain[] = [
  { label: 'before', spec: BEFORE, start: UNCALIBRATED },
  { label: 'after', spec: AFTER, start: UNCALIBRATED },
  { label: 'after (80 ms estimate)', spec: AFTER_EST80, start: UNCALIBRATED },
];
export const calChains = (ms: number): PipeChain[] => [
  { label: 'before', spec: BEFORE, start: measured(ms) },
  { label: 'after', spec: AFTER, start: measured(ms) },
];

export interface SeqResult { label: string; runs: RunSummary[] }

/**
 * `runs` consecutive runs (a new performance each time) scored by every chain, each chain carrying
 * its own stored delay from run to run.
 */
export async function sequence(base: Omit<RenderSpec, 'performanceSeed' | 'microSeed'> & { seed: number }, chains: PipeChain[], runs = 3, afterImpl?: AfterImpl): Promise<SeqResult[]> {
  const out: SeqResult[] = chains.map((c) => ({ label: c.label, runs: [] }));
  const state = chains.map((c) => ({ ...c.start }));
  for (let k = 0; k < runs; k++) {
    const setup = await render({ ...base, performanceSeed: base.seed * 100 + k, microSeed: base.seed * 100 + k });
    chains.forEach((c, i) => {
      const spec = afterImpl && c.spec.id === 'after' ? { ...c.spec, impl: afterImpl } : c.spec;
      const o = runSession(spec, setup, state[i]);
      state[i] = o.profile;
      out[i].runs.push(summarize(o, c.label));
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tracker fidelity, before (N=2048, frozen pitch.ts) vs after (windowFor + fixSubharmonic)

export function fidelityPair(setups: RunSetup[], latencyMs: number): { before: Fidelity; after: Fidelity } {
  const pairsB: TakeReadings[] = [];
  const pairsA: TakeReadings[] = [];
  for (const s of setups) {
    const ob = runSession(BEFORE, s, measured(latencyMs));
    const oa = runSession(AFTER, s, measured(latencyMs));
    pairsB.push({ take: s.take, readings: ob.readings });
    // Judge the pitches the current scorer sees (subharmonic correction as the app applies it).
    const rate = s.take.rate;
    const mapped = oa.readings.map((r) => ({ time: s.take.scoreTimeAtSample0 + (r.stampSec - latencyMs / 1000) * rate, midi: r.midi, clarity: r.clarity, rms: r.rms }));
    const view = afterScorerView(s.part, mapped);
    pairsA.push({ take: s.take, readings: oa.readings.map((r, k) => ({ ...r, midi: view[k].midi })) });
  }
  // fidelity() compares up to take.stopSec (render length); the sessions already cut the readings.
  return { before: fidelity(pairsB), after: fidelity(pairsA) };
}

/** Oracle (true f0, true latency) through each pipeline's plain scorer. */
export function oracle(setup: RunSetup): { before: AttemptResult; after: AttemptResult } {
  const L = levelSetup(setup.level);
  const opts = { toleranceCents: L.toleranceCents, tuning: 'equal' as const, octaveTolerant: false };
  const s = oracleSamples(setup.take, { latencyMs: setup.take.trueLatencyMs, from: setup.from });
  return { before: headScoreAttempt(setup.ctx, s, opts) as unknown as AttemptResult, after: curScoreAttempt(setup.ctx, s, opts) };
}

// ---------------------------------------------------------------------------------------------

export function writePart(name: string, data: unknown): void {
  mkdirSync(PARTS_DIR, { recursive: true });
  writeFileSync(resolve(PARTS_DIR, `${name}.json`), JSON.stringify(data));
}

export function readPart<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(resolve(PARTS_DIR, `${name}.json`), 'utf8')) as T;
  } catch {
    return null;
  }
}
