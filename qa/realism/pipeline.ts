// The app's whole per-run pipeline, in two versions sharing the same rendered audio:
//   BEFORE = baseline commit (frozen copies in ./baseline): N=2048, scoreAttempt, Play.tsx
//            onset-based delay learning (one run, re-scores), pass = accuracy only.
//   AFTER  = current app: windowFor() (1024 for S/A with a known range), fixSubharmonic in
//            session.onPitch, scoreAttempt → scoreAligned (lag search), two-run delay learning
//            (hint → learned), timing gate at L≥2 once the delay is trusted (Play.tsx onDone).
// A Profile carries the stored delay across runs, so 3-run sequences emulate a real singer.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AttemptResult, PitchSample, ScoringOptions } from '../../src/game/types';
import type { ScoringContext } from '../../src/game/scoring';
import * as curScoring from '../../src/game/scoring';
import * as curAlign from '../../src/game/align';
import { fixSubharmonic, windowFor } from '../../src/audio/pitch';
import type { Part } from '../../src/music/types';
import { scoreAttempt as headScoreAttempt } from './baseline/scoring';
import { bubbleStats, lossBreakdown, type BubbleStats, type LossBreakdown } from './fidelity';
import { avgCents, emulateLatencyLearn, gradeLetter, levelSetup, readingsToSamples, type Scorer } from './harness';
import { hashSeed } from './prng';
import type { RenderedTake } from './singer';
import { PITCH_CURRENT, PITCH_HEAD, trackOffline, type TrackReading } from './tracker';
import { REPO_ROOT } from './scores';

/**
 * The end-of-run policy of src/ui/screens/Play.tsx and src/ui/play/session.ts, read from the source
 * so the emulation follows edits (the regexes fall back to the values noted in `detected`).
 */
export interface PlayPolicy {
  /** Median entry later than this (real ms) fails a level-2+ run. */
  lateFailMs: number;
  /** 'measured': only with a measured delay; 'trusted': measured or learned. */
  timingGate: 'measured' | 'trusted';
  /** While the guide plays (L1–2), a learned delay is capped at estimate + this (null = 450 cap only). */
  guideLearnMaxAbove: number | null;
  /** scoreAligned(…, { liftSubharmonics }) is used at the end of the run. */
  liftSubharmonics: boolean;
  /** session.onPitch stores fixSubharmonic-corrected samples (else raw; the fix is display-only). */
  fixSubInSamples: boolean;
  detected: string[];
}

export function detectPlayPolicy(): PlayPolicy {
  const read = (f: string) => { try { return readFileSync(resolve(REPO_ROOT, f), 'utf8'); } catch { return ''; } };
  const play = read('src/ui/screens/Play.tsx');
  const sess = read('src/ui/play/session.ts');
  const detected: string[] = [];
  const num = (re: RegExp, dflt: number | null, name: string) => {
    const m = re.exec(play);
    detected.push(`${name}=${m ? m[1] : `${dflt} (not found)`}`);
    return m ? Number(m[1]) : dflt;
  };
  const lateFailMs = num(/const LATE_FAIL_MS = (\d+)/, 250, 'LATE_FAIL_MS')!;
  const guideLearnMaxAbove = /sess\.cfg\.guide \?/.test(play) ? num(/const GUIDE_LEARN_MAX_ABOVE = (\d+)/, 150, 'GUIDE_LEARN_MAX_ABOVE') : null;
  if (guideLearnMaxAbove === null) detected.push('guide learn cap: none');
  const timingGate = /if \(calibrated && level >= 2/.test(play) ? 'measured' : 'trusted';
  detected.push(`timing gate: ${timingGate}`);
  const liftSubharmonics = /liftSubharmonics:/.test(play);
  detected.push(`liftSubharmonics: ${liftSubharmonics}`);
  const fixSubInSamples = /const midi = p\.midi != null && !this\.cfg\.scoring\.octaveTolerant \? fixSubharmonic/.test(sess);
  detected.push(`session stores ${fixSubInSamples ? 'fixSubharmonic-corrected' : 'raw'} samples`);
  return { lateFailMs, timingGate, guideLearnMaxAbove, liftSubharmonics, fixSubInSamples, detected };
}

export const PLAY_POLICY = detectPlayPolicy();

type Lift = (part: Part, samples: PitchSample[]) => PitchSample[];
const liftFn: Lift | undefined = (curAlign as unknown as { liftSubharmonics?: Lift }).liftSubharmonics;

/** The pitches the AFTER scorer judges (before any shift): subharmonic correction per the policy. */
export function afterScorerView(part: Part, samples: PitchSample[]): PitchSample[] {
  if (PLAY_POLICY.liftSubharmonics && liftFn) return liftFn(part, samples);
  if (PLAY_POLICY.fixSubInSamples) return samples.map((s) => (s.midi == null ? s : { ...s, midi: fixSubharmonic(s.midi, noteDueAt(part, s.time)) }));
  return samples;
}

/** What the phone has stored about the device delay. */
export interface Profile {
  /** 0 = none (uncalibrated: the session uses the estimate). */
  latencyMs: number;
  source?: 'measured' | 'learned';
  hint?: number;
}

export const UNCALIBRATED: Profile = { latencyMs: 0 };
export const measured = (ms: number): Profile => ({ latencyMs: ms, source: 'measured' });

/** The scoring functions the AFTER pipeline uses (swap for variants, e.g. another TRANSITION_MAX). */
export interface AfterImpl {
  scoreAttempt: Scorer;
  scoreAligned: (ctx: ScoringContext, samples: PitchSample[], opts: ScoringOptions, run: { rate: number; latencyMs: number; calibrated: boolean; liftSubharmonics?: boolean; maxTotalMs?: number }) => curAlign.AlignedResult;
  medianOnsetMs: (result: AttemptResult, rate: number, part?: Part) => number | null;
}
export const AFTER_CURRENT: AfterImpl = {
  scoreAttempt: curScoring.scoreAttempt,
  scoreAligned: curAlign.scoreAligned,
  medianOnsetMs: curAlign.medianOnsetMs,
};

export interface PipelineSpec {
  id: 'before' | 'after';
  /** estimateLatencyMs() on the test phone: BEFORE (any mobile) max(80, out+40) = 80; AFTER (Android) max(130, out+70) = 130. */
  estimateMs: number;
  impl?: AfterImpl;
}

export const BEFORE: PipelineSpec = { id: 'before', estimateMs: 80 };
export const AFTER: PipelineSpec = { id: 'after', estimateMs: 130 };
/** AFTER with the old 80 ms estimate (iPhone-like), to separate the estimate change from the rest. */
export const AFTER_EST80: PipelineSpec = { id: 'after', estimateMs: 80 };

export interface RunSetup {
  take: RenderedTake;
  part: Part;
  ctx: ScoringContext;
  from: number;
  to: number;
  level: number;
  microSeed: number;
  /** Analysis window override (a real recording's sidecar windowN); default as the pipeline chooses. */
  windowN?: number;
  /** Scoring options override (a real recording's sidecar); default from the level, standard strictness. */
  scoring?: ScoringOptions;
}

export interface SessionOutcome {
  pipeline: 'before' | 'after';
  latencyUsedMs: number;
  windowN: number;
  /** Shown result (after alignment / re-scoring). */
  result: AttemptResult;
  /** scoreAttempt on the unshifted samples. */
  plain: AttemptResult;
  letter: string;
  passed: boolean;
  timingFailMs: number | null;
  alignedMs: number;
  match: number | null;
  /** Profile delay after this run, when it changed. */
  learnedMs: number | null;
  medianOnsetMs: number | null;
  avgCents: number | null;
  insights: string[];
  profile: Profile;
  samples: PitchSample[];
  readings: TrackReading[];
  loss: LossBreakdown;
  bubble: BubbleStats;
}

const trackCache = new WeakMap<RenderedTake, Map<string, TrackReading[]>>();

/** Track the whole take once per tracker config; sessions cut it where they stop listening. */
function readingsFor(take: RenderedTake, key: string, make: () => TrackReading[]): TrackReading[] {
  let m = trackCache.get(take);
  if (!m) trackCache.set(take, (m = new Map()));
  let r = m.get(key);
  if (!r) m.set(key, (r = make()));
  return r;
}

export function noteDueAt(part: Part, t: number): number | null {
  const ns = part.notes;
  let lo = 0;
  let hi = ns.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ns[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return idx >= 0 && t < ns[idx].start + ns[idx].dur ? ns[idx].midi : null;
}

/** One practice run of `setup` by a phone in state `profile`. */
export function runSession(spec: PipelineSpec, setup: RunSetup, profile: Profile): SessionOutcome {
  const { take, part, ctx, level } = setup;
  const L = levelSetup(level);
  const rate = take.rate;
  const opts: ScoringOptions = setup.scoring ?? { toleranceCents: L.toleranceCents, tuning: 'equal', octaveTolerant: false };
  const latencyUsed = profile.latencyMs > 0 ? profile.latencyMs : spec.estimateMs;
  // The app stops listening min(700, latency + 120) ms after the player ends.
  const stopSec = (setup.to - take.scoreTimeAtSample0) / rate + Math.min(0.7, latencyUsed / 1000 + 0.12);
  const after = spec.id === 'after';
  const N = setup.windowN ?? (after ? windowFor(part.low, take.sampleRate) : 2048);
  const all = readingsFor(take, `${spec.id}:${N}`, () =>
    trackOffline(take.pcm, take.sampleRate, { windowN: N, jitterMs: 3, seed: hashSeed('hop', setup.microSeed), impl: after ? PITCH_CURRENT : PITCH_HEAD }));
  const readings = all.filter((r) => r.centreSec + N / 2 / take.sampleRate <= stopSec);
  const mapping = { scoreTimeAtSample0: take.scoreTimeAtSample0, rate, latencyMs: latencyUsed, from: setup.from };
  let samples = readingsToSamples(readings, mapping);
  if (after && PLAY_POLICY.fixSubInSamples) samples = samples.map((s) => (s.midi == null ? s : { ...s, midi: fixSubharmonic(s.midi, noteDueAt(part, s.time)) }));

  let result: AttemptResult;
  let plain: AttemptResult;
  let alignedMs = 0;
  let match: number | null = null;
  let timingFailMs: number | null = null;
  let unsure = false;
  let next: Profile = { ...profile };
  let medOnset: number | null = null;
  if (!after) {
    plain = headScoreAttempt(ctx, samples, opts) as unknown as AttemptResult;
    result = plain;
    if (!(profile.latencyMs > 0)) {
      const l = emulateLatencyLearn(ctx, plain, samples, rate, latencyUsed, opts, headScoreAttempt as unknown as Scorer);
      if (l) {
        result = l.result;
        next = { latencyMs: l.latencyMs };
      }
    }
  } else {
    const impl = spec.impl ?? AFTER_CURRENT;
    const pol = PLAY_POLICY;
    // LiveScorer.finish(this.samples) ≡ scoreAttempt on the stored samples.
    plain = impl.scoreAttempt(ctx, samples, opts);
    const calibrated = profile.source === 'measured' && profile.latencyMs > 0;
    const idx = plain.notes.map((n) => n.index);
    const al = impl.scoreAligned({ ...ctx, range: [Math.min(...idx), Math.max(...idx)] }, samples, opts, {
      rate, latencyMs: latencyUsed, calibrated, ...(pol.liftSubharmonics ? { liftSubharmonics: !opts.octaveTolerant } : {}),
      // Play.tsx: the lag search never looks past a plausible total device delay (guide on: estimate + cap).
      maxTotalMs: pol.guideLearnMaxAbove !== null && L.guide ? Math.max(spec.estimateMs + pol.guideLearnMaxAbove, latencyUsed + 80) : 450,
    });
    result = al.result;
    alignedMs = al.shiftMs;
    match = al.estimate.match;
    if (!calibrated && al.estimate.match >= 0.6) {
      const suggested = latencyUsed + al.shiftMs;
      const hint = profile.hint;
      if (hint != null && Math.abs(suggested - hint) <= 60) {
        const cap = pol.guideLearnMaxAbove !== null && L.guide ? spec.estimateMs + pol.guideLearnMaxAbove : 450;
        const target = (suggested + hint) / 2;
        // Play.tsx: the guide-level cap only limits increases.
        const learned = Math.round(Math.max(20, Math.min(450, target > latencyUsed ? Math.min(Math.max(cap, latencyUsed), target) : target)));
        next = { latencyMs: learned, source: 'learned' };
      } else {
        next = { ...profile, hint: suggested };
      }
    }
    // Play.tsx reads the profile as it was when the run started.
    const gateOn = pol.timingGate === 'measured' ? calibrated : calibrated || profile.source === 'learned';
    medOnset = impl.medianOnsetMs(result, rate, part);
    if (gateOn && level >= 2 && medOnset !== null && medOnset > pol.lateFailMs) timingFailMs = Math.round(medOnset);
    // Play.tsx: uncalibrated runs with clearly late entries (L2+) or a delay beyond the plausible
    // range don't count for the level (reported as a timing failure with the onset/shift).
    const medLinedUp = medOnset !== null ? medOnset - Math.max(0, al.shiftMs) : null;
    if (!calibrated && ((level >= 2 && medLinedUp !== null && medLinedUp > pol.lateFailMs) || al.beyondCapMs != null)) {
      timingFailMs = Math.round(al.beyondCapMs ?? medOnset!);
      unsure = true; void unsure;
    }
  }
  if (medOnset === null) medOnset = curAlign.medianOnsetMs(result, rate, part);
  const passed = result.accuracy >= L.pass && timingFailMs === null;

  // The live cents bubble (drawn from the session's samples).
  const avail = readings.map((r) => r.centreSec + N / 2 / take.sampleRate);
  const disp = readingsToSamples(readings, { ...mapping, from: -Infinity }).map((s) =>
    after && s.midi != null ? { ...s, midi: fixSubharmonic(s.midi, noteDueAt(part, s.time)) } : s);
  const bubble = bubbleStats(part, ctx.range, disp, avail, {
    scoreTimeAtSample0: take.scoreTimeAtSample0, rate, outputLatencyMs: Math.max(0, latencyUsed - (after ? 70 : 40)),
    tolerance: L.toleranceCents, stopSec, reference: after ? 'sample' : 'playhead',
  });

  return {
    pipeline: spec.id, latencyUsedMs: latencyUsed, windowN: N, result, plain, letter: gradeLetter(result.accuracy), passed,
    timingFailMs, alignedMs, match, learnedMs: next.latencyMs !== profile.latencyMs ? next.latencyMs : null,
    medianOnsetMs: medOnset, avgCents: avgCents(result), insights: result.insights.map((i) => i.kind), profile: next,
    samples, readings, loss: lossBreakdown(part, result, samples, L.toleranceCents), bubble,
  };
}
