// Fast notes: why does a good singer's short note score as "ok"/"miss"?
//
// Renders a good singer on fast passages (built-in pieces' fast bars, synthetic runs of eighths and
// sixteenths with/without consonants), runs the real offline tracker and the current app's end of
// run (runSession AFTER, calibrated delay so latency is not the confound), then re-runs the scorer
// on exactly the samples the app judged and asks, note by note, which rule dropped it.
import type { Part, Score } from '../../src/music/types';
import type { Grade } from '../../src/game/types';
import { LiveScorer, judgedSpan, median, type ScoringContext } from '../../src/game/scoring';
import { makePart, makeScore } from '../../src/game/testutil';
import { CLARITY_GATE, RMS_GATE } from '../../src/audio/pitch';
import { levelSetup, oracleSamples } from './harness';
import { AFTER, afterScorerView, measured, runSession, type PipelineSpec, type SessionOutcome } from './pipeline';
import { hashSeed } from './prng';
import { barSpan, findPart, loadPiece, noteRangeFor } from './scores';
import { CHANNELS, renderSinger, truthAt, type ChannelProfile, type RenderedTake, type SingerProfile } from './singer';

export interface FastPassage {
  id: string;
  score: Score;
  part: Part;
  range: [number, number];
  from: number;
  to: number;
}

/** A built-in piece, printed bars [a, b] of a voice part. */
export async function piecePassage(piece: string, voice: string, a: string, b: string): Promise<FastPassage> {
  const p = await loadPiece(piece);
  const part = findPart(p.score, voice);
  const { from, to } = barSpan(p.score, a, b);
  return { id: `${piece} ${voice} b${a}-${b}`, score: p.score, part, range: noteRangeFor(part, from, to)!, from, to };
}

/**
 * Synthetic alto runs at `bpm`: `beats` per note (0.5 = eighths, 0.25 = sixteenths). Scales, thirds,
 * neighbour figures and a repeated note, a rest between phrases. `lyric`: 'ta' = every note starts
 * with a consonant, 'a' = no consonant (one vowel per note, like a melisma), null = no lyrics (the
 * singer model then puts a consonant on ~half the notes).
 */
export function synthPassage(bpm: number, beats: number, lyric: 'ta' | 'a' | null): FastPassage {
  const phrases = [
    [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62],
    [64, 67, 65, 69, 67, 71, 69, 72, 71, 67, 69, 65, 67, 64, 65, 62],
    [67, 69, 67, 65, 64, 65, 64, 62, 60, 60, 62, 62, 64, 66, 67, 67],
  ];
  const spec: [number | null, number][] = [];
  for (const ph of phrases) {
    const n = Math.round(4 / beats) * 2; // two bars of notes...
    for (let k = 0; k < n; k++) spec.push([ph[k % ph.length], beats]);
    spec.push([null, 4]); // ...then a bar's rest (breath)
  }
  const part = makePart('A', spec, bpm);
  part.voiceType = 'A';
  part.name = 'Alto';
  if (lyric) for (const n of part.notes) n.lyric = lyric;
  const score = makeScore([part], bpm);
  const last = part.notes[part.notes.length - 1];
  return { id: `synth ${bpm}bpm ${beats === 0.5 ? '8ths' : beats === 0.25 ? '16ths' : `${beats}b`} ${lyric ?? 'nolyr'}`, score, part, range: [0, part.notes.length - 1], from: 0, to: last.start + last.dur };
}

export interface RenderedRun {
  passage: FastPassage;
  level: number;
  take: RenderedTake;
  outcome: SessionOutcome;
}

export const CAL_MS = 150;

export function renderRun(passage: FastPassage, singer: SingerProfile, level: number, seed: number, o: { channel?: ChannelProfile; spec?: PipelineSpec } = {}): RenderedRun {
  const L = levelSetup(level);
  const take = renderSinger({
    score: passage.score, part: passage.part, range: passage.range, from: passage.from, to: passage.to, rate: L.rate,
    trueLatencyMs: CAL_MS, assumedLatencyMs: CAL_MS, guide: L.guide, profile: singer, channel: o.channel ?? CHANNELS.phoneHeadphones,
    performanceSeed: hashSeed('fast-perf', seed, passage.id, level), microSeed: hashSeed('fast-micro', seed, passage.id, level),
  });
  const ctx: ScoringContext = { score: passage.score, part: passage.part, range: passage.range };
  const outcome = runSession(o.spec ?? AFTER, { take, part: passage.part, ctx, from: passage.from, to: passage.to, level, microSeed: seed }, measured(CAL_MS));
  return { passage, level, take, outcome };
}

export type Reason =
  | 'hit'
  | 'no readings: tracker gated (unclear)'
  | 'no readings: consonant / silence'
  | 'no readings: voice before/after the body (timing)'
  | 'arrival never reached'
  | 'all excluded as release'
  | 'judged readings cover too little'
  | 'tracker smear / smoother lag'
  | 'singer not settled (glide)'
  | 'singer off (wrong pitch)';

export interface NoteDiag {
  index: number;
  /** Real-time duration (s). */
  realDur: number;
  grade: Grade;
  /** Grade the live display showed (LiveScorer on the unshifted samples). */
  liveGrade: Grade;
  /** Grade with a perfect tracker (true f0, true latency). */
  oracleGrade: Grade;
  hitRatio: number;
  reason: Reason;
  bodyReadings: number;
  judgedReadings: number;
}

const tolOf = (level: number) => levelSetup(level).toleranceCents;

/**
 * Per-note diagnosis of a run. Replays the app's final scorer (afterScorerView + the alignment shift)
 * and inspects the per-note accumulators, so it explains exactly the grades the app shows.
 */
export function diagnose(run: RenderedRun): { notes: NoteDiag[]; mismatches: number } {
  const { passage, level, take, outcome } = run;
  const rate = take.rate;
  const tol = tolOf(level);
  const opts = { toleranceCents: tol, tuning: 'equal' as const, octaveTolerant: false };
  const ctx: ScoringContext = { score: passage.score, part: passage.part, range: passage.range };
  const lag = (outcome.alignedMs / 1000) * rate;
  const view = afterScorerView(passage.part, outcome.samples).map((s) => ({ ...s, time: s.time - lag }));
  const ls = new LiveScorer(ctx, opts);
  for (const s of [...view].sort((a, b) => a.time - b.time)) ls.push(s);
  const res = ls.finish();
  const oracle = new LiveScorer(ctx, opts);
  for (const s of oracleSamples(take, { latencyMs: take.trueLatencyMs, from: passage.from })) oracle.push(s);
  const ores = oracle.finish();
  // Raw readings mapped to (shifted) score time, with their truth.
  const lat = outcome.latencyUsedMs / 1000;
  const raw = outcome.readings.map((r) => ({
    time: take.scoreTimeAtSample0 + (r.stampSec - lat) * rate - lag,
    raw: r.rawMidi, clarity: r.clarity, rms: r.rms,
    truth: truthAt(take.truthMidi, r.stampSec),
  }));
  const truthAtScore = (t: number) => truthAt(take.truthMidi, (t + lag - take.scoreTimeAtSample0) / rate + lat);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accs = (ls as any).accs as { w: any; bT: number[]; bD: number[]; bW: number[]; final: { grade: Grade; hitRatio: number } }[];
  let mismatches = 0;
  const notes: NoteDiag[] = accs.map((a, k) => {
    const w = a.w;
    const final = res.notes[k];
    if (final.grade !== outcome.result.notes[k].grade) mismatches++;
    const tolN = tol + w.tolExtra;
    const n = a.bT.length;
    const span = judgedSpan(a, tolN, false);
    const jD = a.bD.slice(span.k0, span.k1);
    const jT = a.bT.slice(span.k0, span.k1);
    let reason: Reason = 'hit';
    if (final.grade === 'ok' || final.grade === 'miss') {
      if (n === 0) {
        const inBody = raw.filter((r) => r.time >= w.bodyStart && r.time < w.bodyEnd);
        const unclear = inBody.filter((r) => r.raw == null && r.rms >= RMS_GATE && r.clarity < CLARITY_GATE && Number.isFinite(r.truth)).length;
        const truthVoiced = inBody.filter((r) => Number.isFinite(r.truth)).length;
        reason = unclear > 0 && unclear >= inBody.length / 2 ? 'no readings: tracker gated (unclear)'
          : truthVoiced < inBody.length / 2 ? 'no readings: consonant / silence'
            : 'no readings: voice before/after the body (timing)';
      } else if (span.k0 >= n) reason = 'arrival never reached';
      else if (span.k1 <= span.k0) reason = 'all excluded as release';
      else {
        const md = median(jD)!;
        if (Math.abs(md) <= tolN) reason = 'judged readings cover too little';
        else {
          const tr = jT.map((t) => 100 * (truthAtScore(t) - w.target)).filter(Number.isFinite);
          const tmd = median(tr);
          const sungMed = median(take.notes.filter((x) => x.index === w.index).map((x) => 100 * (x.targetMidi - w.target)));
          if (sungMed !== null && Math.abs(sungMed) > tolN) reason = 'singer off (wrong pitch)';
          else if (tmd !== null && Math.abs(tmd) <= tolN) reason = 'tracker smear / smoother lag';
          else reason = 'singer not settled (glide)';
        }
      }
    }
    return {
      index: w.index, realDur: w.note.dur / rate, grade: final.grade, liveGrade: outcome.plain.notes[k].grade, oracleGrade: ores.notes[k].grade,
      hitRatio: final.hitRatio, reason, bodyReadings: n, judgedReadings: Math.max(0, span.k1 - span.k0),
    };
  });
  return { notes, mismatches };
}

export const DUR_BUCKETS: [string, number, number][] = [
  ['<0.15 s', 0, 0.15],
  ['0.15–0.25 s', 0.15, 0.25],
  ['0.25–0.40 s', 0.25, 0.4],
  ['≥0.40 s', 0.4, Infinity],
];
export const bucketOf = (d: number) => DUR_BUCKETS.find(([, lo, hi]) => d >= lo && d < hi)![0];

export const PASSAGES = async (): Promise<FastPassage[]> => [
  await piecePassage('debussy-yver', 'A', '1', '23'),
  await piecePassage('debussy-dieu', 'A', '1', '5'),
  await piecePassage('ravel-nicolette', 'A', '20', '45'),
  ...[80, 104, 120, 144].flatMap((bpm) => [0.5, 0.25].flatMap((b) => (['ta', 'a', null] as const).map((ly) => synthPassage(bpm, b, ly)))),
];

