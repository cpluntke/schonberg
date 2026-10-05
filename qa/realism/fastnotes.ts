// Fast notes: why does a good singer's short note score as "ok"/"miss"?
//
// Renders a good singer on fast passages (built-in pieces' fast bars, synthetic runs of eighths and
// sixteenths with/without consonants), runs the real offline tracker and the app's end of run
// (runSession, calibrated delay so latency is not the confound), then re-runs the scorer on exactly
// the samples the app judged and asks, note by note, which rule dropped it (`diagnose`).
// `fastExperiment` compares the pre-fix app (git FAST_BASE_REF: scoring.ts, align.ts, pitch.ts) with
// the working tree on the same renders, for good and adversarial singers (cmp-fast.test.ts).
import type { Part, Score } from '../../src/music/types';
import type { Grade } from '../../src/game/types';
import * as curScoring from '../../src/game/scoring';
import { median, type ScoringContext } from '../../src/game/scoring';
import { makePart, makeScore } from '../../src/game/testutil';
import { CLARITY_GATE, RMS_GATE } from '../../src/audio/pitch';
import { levelSetup, oracleSamples } from './harness';
import { AFTER, UNCALIBRATED, afterScorerView, measured, runSession, type PipelineSpec, type Profile, type SessionOutcome } from './pipeline';
import { SINGERS, onDoo } from './singer';
import { gitVariant } from './variants';
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

export function renderTake(passage: FastPassage, singer: SingerProfile, level: number, seed: number, channel?: ChannelProfile, trueLatencyMs = CAL_MS): RenderedTake {
  const L = levelSetup(level);
  return renderSinger({
    score: passage.score, part: passage.part, range: passage.range, from: passage.from, to: passage.to, rate: L.rate,
    trueLatencyMs, assumedLatencyMs: 450, guide: L.guide, profile: singer, channel: channel ?? CHANNELS.phoneHeadphones,
    performanceSeed: hashSeed('fast-perf', seed, passage.id, level), microSeed: hashSeed('fast-micro', seed, passage.id, level),
  });
}

/** Score a rendered take with a pipeline (default: the delay was measured and is exact). */
export function scoreTake(passage: FastPassage, take: RenderedTake, level: number, seed: number, spec: PipelineSpec = AFTER, profile: Profile = measured(take.trueLatencyMs)): RenderedRun {
  const ctx: ScoringContext = { score: passage.score, part: passage.part, range: passage.range, end: passage.to };
  const outcome = runSession(spec, { take, part: passage.part, ctx, from: passage.from, to: passage.to, level, microSeed: seed }, profile);
  return { passage, level, take, outcome };
}

export function renderRun(passage: FastPassage, singer: SingerProfile, level: number, seed: number, o: { channel?: ChannelProfile; spec?: PipelineSpec } = {}): RenderedRun {
  return scoreTake(passage, renderTake(passage, singer, level, seed, o.channel), level, seed, o.spec);
}

export type Reason =
  | 'hit'
  | 'no readings: tracker gated (unclear)'
  | 'no readings: consonant / silence'
  | 'no readings: voice before/after the body (timing)'
  | 'arrival never reached'
  | 'only transition readings in the note'
  | 'too few readings in the note to judge it'
  | 'all excluded as release'
  | 'judged readings cover too little'
  | 'tracker smear (window, reverb, smoother)'
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

/** The scorer module a diagnosis replays (src/game/scoring.ts, or a git variant of it). */
export type ScoringModule = Pick<typeof curScoring, 'LiveScorer' | 'judgedSpan'> & { shortNoteDev?: typeof curScoring.shortNoteDev; shortNoteReadings?: typeof curScoring.shortNoteReadings };

/**
 * Per-note diagnosis of a run. Replays the app's final scorer (afterScorerView + the alignment shift)
 * and inspects the per-note accumulators, so it explains exactly the grades the app shows
 * (`mismatches` counts notes where the replay disagrees with the run).
 */
export function diagnose(run: RenderedRun, mod: ScoringModule = curScoring): { notes: NoteDiag[]; mismatches: number } {
  const { passage, level, take, outcome } = run;
  const rate = take.rate;
  const tol = tolOf(level);
  const opts = { toleranceCents: tol, tuning: 'equal' as const, octaveTolerant: false, rate };
  const ctx: ScoringContext = { score: passage.score, part: passage.part, range: passage.range, end: passage.to };
  const lag = (outcome.alignedMs / 1000) * rate;
  const view = afterScorerView(passage.part, outcome.samples).map((s) => ({ ...s, time: s.time - lag }));
  const ls = new mod.LiveScorer(ctx, opts);
  for (const s of [...view].sort((a, b) => a.time - b.time)) ls.push(s);
  const res = ls.finish();
  const oracle = new mod.LiveScorer(ctx, opts);
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
  const accs = (ls as any).accs as { w: any; bT: number[]; bD: number[]; bW: number[]; nT?: number[]; nD?: number[]; final: { grade: Grade; hitRatio: number } }[];
  let mismatches = 0;
  const notes: NoteDiag[] = accs.map((a, k) => {
    const w = a.w;
    const final = res.notes[k];
    if (final.grade !== outcome.result.notes[k].grade) mismatches++;
    const tolN = tol + w.tolExtra;
    const n = a.bT.length;
    const span = mod.judgedSpan(a, tolN, false);
    let jD = a.bD.slice(span.k0, span.k1);
    let jT = a.bT.slice(span.k0, span.k1);
    // Very short notes in the new scorer: judged on the note's own readings.
    const shortPath = !!(w.short && mod.shortNoteDev && a.nT);
    let shortNone = false;
    let shortFew = false;
    let inNoteCount = 0;
    if (shortPath) {
      const nT = a.nT!;
      const nD = a.nD!;
      const inNote = nT.map((t, k) => k).filter((k) => nT[k] >= w.start && nT[k] < w.start + w.note.dur);
      inNoteCount = inNote.length;
      if (mod.shortNoteDev!(a as never, tolN, false) === null && inNote.length > 0) {
        // No reading left after the transitions, or too few to judge the note on (shortNoteReadings).
        const left = mod.shortNoteReadings ? mod.shortNoteReadings(a as never, tolN, false).devs.length : 0;
        if (left === 0) shortNone = true;
        else shortFew = true;
      }
      jT = nT;
      jD = nD;
    }
    let reason: Reason = 'hit';
    if (final.grade === 'ok' || final.grade === 'miss') {
      if (shortNone) reason = 'only transition readings in the note';
      else if (shortFew) reason = 'too few readings in the note to judge it';
      else if (shortPath ? inNoteCount === 0 : n === 0) {
        const inBody = raw.filter((r) => r.time >= w.bodyStart && r.time < w.bodyEnd);
        const unclear = inBody.filter((r) => r.raw == null && r.rms >= RMS_GATE && r.clarity < CLARITY_GATE && Number.isFinite(r.truth)).length;
        const truthVoiced = inBody.filter((r) => Number.isFinite(r.truth)).length;
        reason = unclear > 0 && unclear >= inBody.length / 2 ? 'no readings: tracker gated (unclear)'
          : truthVoiced < inBody.length / 2 ? 'no readings: consonant / silence'
            : 'no readings: voice before/after the body (timing)';
      } else if (!shortPath && span.k0 >= n) reason = 'arrival never reached';
      else if (!shortPath && span.k1 <= span.k0) reason = 'all excluded as release';
      else {
        const md = shortPath ? mod.shortNoteDev!(a as never, tolN, false)! : median(jD)!;
        if (Math.abs(md) <= tolN) reason = 'judged readings cover too little';
        else {
          const tr = jT.map((t) => 100 * (truthAtScore(t) - w.target)).filter(Number.isFinite);
          const tmd = median(tr);
          const sungMed = median(take.notes.filter((x) => x.index === w.index).map((x) => 100 * (x.targetMidi - w.target)));
          if (sungMed !== null && Math.abs(sungMed) > tolN) reason = 'singer off (wrong pitch)';
          else if (tmd !== null && Math.abs(tmd) <= tolN) reason = 'tracker smear (window, reverb, smoother)';
          else reason = 'singer not settled (glide)';
        }
      }
    }
    return {
      index: w.index, realDur: w.note.dur / rate, grade: final.grade, liveGrade: outcome.plain.notes[k].grade, oracleGrade: ores.notes[k].grade,
      hitRatio: final.hitRatio, reason, bodyReadings: n, judgedReadings: shortPath ? jT.length : Math.max(0, span.k1 - span.k0),
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

/** The good singer's passages: the built-in pieces' fast bars and synthetic runs. */
export const PASSAGES = async (): Promise<FastPassage[]> => [
  await piecePassage('debussy-yver', 'A', '1', '23'),
  await piecePassage('debussy-dieu', 'A', '1', '5'),
  await piecePassage('ravel-nicolette', 'A', '20', '45'),
  ...[80, 104, 120, 144].flatMap((bpm) => [0.5, 0.25].flatMap((b) => (['ta', 'a', null] as const).map((ly) => synthPassage(bpm, b, ly)))),
];

// ---------------------------------------------------------------------------------------------
// The before/after experiment (cmp-fast.test.ts → report section "Fast notes")

declare const process: { env: Record<string, string | undefined> };
/** The app before the fast-note fixes (scoring.ts short-note judgement, pitch.ts smoother). */
export const FAST_BASE_REF = process.env.FAST_BASE_REF ?? '54ea7b9';
/** A note this short (real seconds) is a "fast note". */
export const FAST_SEC = 0.15;

export interface FastRun { acc: number; plainAcc: number; passed: boolean; alignedMs: number; fast: Record<Grade, number>; liveFastMiss: number }
export interface FastGoodRow { passage: string; level: number; seed: number; before: FastRun | null; after: FastRun }
export interface FastAdvRow { singer: string; passage: string; level: number; before: FastRun | null; after: FastRun }
export interface FastReport {
  baseRef: string | null;
  good: FastGoodRow[];
  /** Why fast (and 0.15–0.25 s) ok/miss notes of the good singer were dropped: bucket → reason → count, plus `notes` = all notes in the bucket. */
  reasons: { before: Record<string, Record<string, number>> | null; after: Record<string, Record<string, number>> };
  adversarial: FastAdvRow[];
  /** Uncalibrated phone (true 200 ms, estimate 130): misses of notes < 0.25 s on the live display vs the result. */
  live: { passage: string; level: number; fastN: number; liveMiss: number; finalMiss: number }[];
  mismatches: number;
}

const isMiss = (g: Grade) => g === 'miss' || g === 'ok';

function fastRun(run: RenderedRun, fastSec = FAST_SEC): FastRun {
  const { outcome, passage, take } = run;
  const fast: Record<Grade, number> = { perfect: 0, good: 0, ok: 0, miss: 0 };
  let liveFastMiss = 0;
  outcome.result.notes.forEach((n, k) => {
    if (passage.part.notes[n.index].dur / take.rate >= fastSec) return;
    fast[n.grade]++;
    if (isMiss(outcome.plain.notes[k].grade)) liveFastMiss++;
  });
  return { acc: outcome.result.accuracy, plainAcc: outcome.plain.accuracy, passed: outcome.passed, alignedMs: outcome.alignedMs, fast, liveFastMiss };
}

function addReasons(into: Record<string, Record<string, number>>, notes: NoteDiag[]): void {
  for (const n of notes) {
    if (n.realDur >= 0.25) continue;
    const b = (into[bucketOf(n.realDur)] ??= { notes: 0 });
    b.notes++;
    if (n.reason !== 'hit') b[n.reason] = (b[n.reason] ?? 0) + 1;
  }
}

export async function fastExperiment(o: { seeds?: number[] } = {}): Promise<FastReport> {
  const seeds = o.seeds ?? [1, 2];
  let base: Awaited<ReturnType<typeof gitVariant>> | null = null;
  try {
    base = await gitVariant(FAST_BASE_REF);
  } catch {
    base = null; // no git history (e.g. an exported copy): after only
  }
  const before: PipelineSpec | null = base ? { ...AFTER, impl: base.impl, pitch: base.pitch, pitchKey: base.key } : null;
  const all = await PASSAGES();
  const goodPassages = all.filter((p) => !p.id.startsWith('synth') || p.id.includes('16ths') || p.id.startsWith('synth 144bpm 8ths'));
  const report: FastReport = { baseRef: base ? FAST_BASE_REF : null, good: [], reasons: { before: base ? {} : null, after: {} }, adversarial: [], live: [], mismatches: 0 };
  for (const p of goodPassages) {
    for (const level of [1, 2, 4]) {
      for (const seed of seeds) {
        // Level 1 is sung on "doo" (docs/LEVELS.md).
        const take = renderTake(p, level === 1 ? onDoo(SINGERS.goodChoir) : SINGERS.goodChoir, level, seed);
        const ra = scoreTake(p, take, level, seed, AFTER);
        const da = diagnose(ra);
        report.mismatches += da.mismatches;
        addReasons(report.reasons.after, da.notes);
        let rb: RenderedRun | null = null;
        if (before && base) {
          rb = scoreTake(p, take, level, seed, before);
          addReasons(report.reasons.before!, diagnose(rb, base.scoring).notes);
        }
        report.good.push({ passage: p.id, level, seed, before: rb && fastRun(rb), after: fastRun(ra) });
      }
    }
  }
  // Adversarial singers on the pieces and the fastest runs.
  const advPassages = all.filter((p) => !p.id.startsWith('synth') || ['synth 104bpm 16ths ta', 'synth 144bpm 16ths ta', 'synth 144bpm 16ths a', 'synth 144bpm 8ths ta'].includes(p.id));
  for (const singer of [SINGERS.wrongNotes, SINGERS.flat40, SINGERS.oneBehind]) {
    for (const p of advPassages) {
      for (const level of [1, 2, 4]) {
        const take = renderTake(p, level === 1 ? onDoo(singer) : singer, level, seeds[0]);
        const ra = scoreTake(p, take, level, seeds[0], AFTER);
        const rb = before ? scoreTake(p, take, level, seeds[0], before) : null;
        report.adversarial.push({ singer: singer.name, passage: p.id, level, before: rb && fastRun(rb), after: fastRun(ra) });
      }
    }
  }
  // Live display vs result on an uncalibrated phone (the end-of-run alignment can't help the live view).
  for (const p of all.filter((x) => !x.id.startsWith('synth') || x.id === 'synth 144bpm 16ths a' || x.id === 'synth 104bpm 16ths ta')) {
    for (const level of [2, 4]) {
      const take = renderTake(p, SINGERS.goodChoir, level, seeds[0], undefined, 200);
      const r = fastRun(scoreTake(p, take, level, seeds[0], AFTER, UNCALIBRATED), 0.25);
      const fastN = r.fast.perfect + r.fast.good + r.fast.ok + r.fast.miss;
      report.live.push({ passage: p.id, level, fastN, liveMiss: r.liveFastMiss, finalMiss: r.fast.ok + r.fast.miss });
    }
  }
  return report;
}
