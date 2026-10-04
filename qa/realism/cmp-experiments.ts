// The before/after experiments. Each function returns plain JSON for its report part.
import { fidelityPair, oracle, render, sequence, summarize, calChains, ALL_TARGETS, SEEDS, T, UNCAL_CHAINS, type RunSummary, type SeqResult } from './compare';
import type { Fidelity } from './fidelity';
import { AFTER, BEFORE, UNCALIBRATED, measured, runSession } from './pipeline';
import { CHANNELS, SINGERS, idealised, type SingerProfile } from './singer';
import { transitionMaxVariant } from './variants';
import type { Target } from './experiment';

const CAL_MS = 150;

// ---- 2. good singers × latency × section, one level per call ---------------------------------

export interface GridRow {
  singer: string;
  target: string;
  level: number;
  cal: { before: RunSummary; after: RunSummary; oracleBefore: number; oracleAfter: number; oraclePitchAfter: number };
  /** True latency (ms) → 3-run sequences per pipeline chain. */
  uncal: Record<string, SeqResult[]>;
}

export async function grid(level: number): Promise<GridRow[]> {
  const rows: GridRow[] = [];
  const plan: { singer: SingerProfile; targets: Target[]; runs: number }[] = [
    { singer: SINGERS.goodChoir, targets: ALL_TARGETS, runs: 3 },
    { singer: SINGERS.operatic, targets: [T.dieu0, T.dieu1, T.warmup1], runs: 1 },
  ];
  for (const p of plan) {
    for (const target of p.targets) {
      const setup = await render({ target, singer: p.singer, level, trueLatencyMs: CAL_MS, performanceSeed: 1, microSeed: 1 });
      const [cb, ca] = calChains(CAL_MS).map((c) => summarize(runSession(c.spec, setup, c.start), c.label));
      const o = oracle(setup);
      const uncal: Record<string, SeqResult[]> = {};
      for (const ms of [200, 280]) uncal[ms] = await sequence({ target, singer: p.singer, level, trueLatencyMs: ms, seed: 1 }, UNCAL_CHAINS, p.runs);
      rows.push({ singer: p.singer.name, target: target.id, level, cal: { before: cb, after: ca, oracleBefore: o.before.accuracy, oracleAfter: o.after.accuracy, oraclePitchAfter: o.after.pitch }, uncal });
    }
  }
  return rows;
}

// ---- L2 sequences around the old learning threshold (the C/A/A case) ---------------------------

export interface SeqRow { level: number; trueLatencyMs: number; seed: number; chains: SeqResult[] }

export async function l2Sequences(): Promise<SeqRow[]> {
  const out: SeqRow[] = [];
  for (const ms of [200, 215, 230, 280]) {
    for (let seed = 1; seed <= 4; seed++) {
      out.push({ level: 2, trueLatencyMs: ms, seed, chains: await sequence({ target: T.dieu0, singer: SINGERS.goodChoir, level: 2, trueLatencyMs: ms, seed: 10 + seed }, UNCAL_CHAINS, 3) });
    }
  }
  return out;
}

// ---- 3. repeatability --------------------------------------------------------------------------

export interface RepRow { level: number; latency: string; mode: string; byPipeline: Record<string, { accs: number[]; pitches: number[]; letters: string[]; passes: number }> }

export async function repeatability(): Promise<RepRow[]> {
  const out: RepRow[] = [];
  for (const level of [1, 4]) {
    for (const lat of ['cal', 'uncal200'] as const) {
      for (const mode of ['micro', 'performance'] as const) {
        const row: RepRow = { level, latency: lat, mode, byPipeline: {} };
        for (let k = 1; k <= SEEDS; k++) {
          const setup = await render({ target: T.dieu0, singer: SINGERS.goodChoir, level, trueLatencyMs: lat === 'cal' ? CAL_MS : 200, performanceSeed: mode === 'micro' ? 1 : 100 + k, microSeed: k });
          const chains = lat === 'cal' ? calChains(CAL_MS) : UNCAL_CHAINS.slice(0, 2);
          for (const c of chains) {
            const o = runSession(c.spec, setup, c.start);
            const e = (row.byPipeline[c.label] ??= { accs: [], pitches: [], letters: [], passes: 0 });
            e.accs.push(o.result.accuracy);
            e.pitches.push(o.result.pitch);
            e.letters.push(o.letter);
            if (o.passed) e.passes++;
          }
        }
        out.push(row);
      }
    }
  }
  return out;
}

// ---- 4. sanity / adversarial singers -------------------------------------------------------------

export interface SanityRow { singer: string; target: string; level: number; latency: string; chains: SeqResult[] }

/** Device round trip for the adversarial runs (as specified: 130 ms, = the Android estimate). */
export const SANITY_DEVICE_MS = 130;

export async function sanity(): Promise<SanityRow[]> {
  const out: SanityRow[] = [];
  const singers = [SINGERS.wrongNotes, SINGERS.flat40, SINGERS.echo300, SINGERS.oneBehind, SINGERS.lateArriver];
  for (const singer of singers) {
    for (const target of [T.dieu0, T.warmup1]) {
      for (const level of [1, 2, 4]) {
        const setup = await render({ target, singer, level, trueLatencyMs: SANITY_DEVICE_MS, performanceSeed: 1, microSeed: 1 });
        const chains = calChains(SANITY_DEVICE_MS).map((c) => ({ label: c.label, runs: [summarize(runSession(c.spec, setup, c.start), c.label)] }));
        out.push({ singer: singer.name, target: target.id, level, latency: `measured ${SANITY_DEVICE_MS}`, chains });
      }
      // A first-time user on an uncalibrated phone, three runs in a row (L2 = first level with the timing gate).
      for (const level of [1, 2]) {
        out.push({
          singer: singer.name, target: target.id, level, latency: `uncalibrated (true ${SANITY_DEVICE_MS})`,
          chains: await sequence({ target, singer, level, trueLatencyMs: SANITY_DEVICE_MS, seed: 7 }, UNCAL_CHAINS.slice(0, 2), 3),
        });
      }
    }
  }
  return out;
}

// ---- TRANSITION_MAX sweep -----------------------------------------------------------------------

export interface TmRow { singer: string; target: string; level: number; byTm: Record<string, { pitch: number; accuracy: number; letter: string; passed: boolean }> }
export const TM_VALUES = [0.1, 0.15, 0.25, 0.35];

export async function transitionSweep(): Promise<TmRow[]> {
  const impls = await Promise.all(TM_VALUES.map((v) => transitionMaxVariant(v)));
  const out: TmRow[] = [];
  const singers = [SINGERS.goodChoir, SINGERS.operatic, SINGERS.ringing, SINGERS.slowTransitions, SINGERS.lateArriver, SINGERS.wrongNotes, SINGERS.oneBehind];
  for (const singer of singers) {
    for (const target of [T.dieu0, T.warmup1]) {
      for (const level of [2, 4]) {
        const setup = await render({ target, singer, level, trueLatencyMs: CAL_MS, performanceSeed: 1, microSeed: 1 });
        const row: TmRow = { singer: singer.name, target: target.id, level, byTm: {} };
        TM_VALUES.forEach((v, i) => {
          const o = runSession({ ...AFTER, impl: impls[i] }, setup, measured(CAL_MS));
          row.byTm[String(v)] = { pitch: o.result.pitch, accuracy: o.result.accuracy, letter: o.letter, passed: o.passed };
        });
        out.push(row);
      }
    }
  }
  return out;
}

// ---- 1. tracker fidelity, bleed, ablation --------------------------------------------------------

export interface FidRow { singer: string; before: Fidelity; after: Fidelity; scored: { before: { pitch: number; acc: number }; after: { pitch: number; acc: number } } }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

export async function fidelityRows(): Promise<FidRow[]> {
  const variants = [
    ...[SINGERS.goodChoir, SINGERS.operatic, SINGERS.plainControl, SINGERS.ringing].map((s) => ({ singer: s, level: 4, channel: CHANNELS.phoneHeadphones, label: s.name })),
    { singer: SINGERS.goodChoir, level: 1, channel: CHANNELS.phoneSpeaker, label: `${SINGERS.goodChoir.name} + speaker bleed −13 dB (L1)` },
  ];
  const out: FidRow[] = [];
  for (const v of variants) {
    const setups = [];
    for (const t of [T.dieu0, T.warmup1]) setups.push(await render({ target: t, singer: v.singer, level: v.level, trueLatencyMs: CAL_MS, performanceSeed: 1, microSeed: 1, channel: v.channel }));
    const f = fidelityPair(setups, CAL_MS);
    const sb = setups.map((s) => runSession(BEFORE, s, measured(CAL_MS)).result);
    const sa = setups.map((s) => runSession(AFTER, s, measured(CAL_MS)).result);
    out.push({
      singer: v.label, before: f.before, after: f.after,
      scored: { before: { pitch: mean(sb.map((r) => r.pitch)), acc: mean(sb.map((r) => r.accuracy)) }, after: { pitch: mean(sa.map((r) => r.pitch)), acc: mean(sa.map((r) => r.accuracy)) } },
    });
  }
  return out;
}

export interface BleedRow { singer: string; bleedDb: number; target: string; level: number; latency: string; before: RunSummary; after: RunSummary; octBefore: number; octAfter: number }

export async function bleed(): Promise<BleedRow[]> {
  const plan: { singer: SingerProfile; db: number; uncal: boolean }[] = [
    ...[-18, -13, -8].map((db) => ({ singer: SINGERS.goodChoir, db, uncal: false })),
    { singer: SINGERS.goodChoir, db: -13, uncal: true },
    { singer: SINGERS.operatic, db: -13, uncal: false },
  ];
  const out: BleedRow[] = [];
  for (const b of plan) {
    for (const target of [T.dieu0, T.warmup1]) {
      for (const level of [1, 4]) {
        const setup = await render({ target, singer: b.singer, level, trueLatencyMs: b.uncal ? 200 : CAL_MS, performanceSeed: 1, microSeed: 1, channel: { ...CHANNELS.phoneSpeaker, bleedDb: b.db } });
        const [pb, pa] = b.uncal ? [UNCALIBRATED, UNCALIBRATED] : [measured(CAL_MS), measured(CAL_MS)];
        const before = summarize(runSession(BEFORE, setup, pb), 'before');
        const after = summarize(runSession(AFTER, setup, pa), 'after');
        const f = fidelityPair([setup], b.uncal ? 200 : CAL_MS);
        out.push({ singer: b.singer.name, bleedDb: b.db, target: target.id, level, latency: b.uncal ? 'uncal200' : 'cal', before, after, octBefore: f.before.smoothed.overall.octave, octAfter: f.after.smoothed.overall.octave });
      }
    }
  }
  return out;
}

export interface AblRow { step: string; target: string; level: number; before: RunSummary; after: RunSummary; oracleBefore: number; oracleAfter: number }

export async function ablation(): Promise<AblRow[]> {
  const g = SINGERS.goodChoir;
  const steps: { step: string; p: SingerProfile }[] = [];
  let p: SingerProfile = idealised(g);
  steps.push({ step: '0 idealised', p });
  p = { ...p, noteSdCents: g.noteSdCents, biasCents: g.biasCents, drift: g.drift };
  steps.push({ step: '1 + scatter & drift', p });
  p = { ...p, vibrato: g.vibrato };
  steps.push({ step: '2 + small vibrato', p });
  p = { ...p, transition: g.transition, scoop: g.scoop };
  steps.push({ step: '3 + transitions & scoops', p });
  p = { ...p, timing: g.timing };
  steps.push({ step: '4 + onset jitter', p });
  p = { ...p, consonants: g.consonants };
  steps.push({ step: '5 + consonants (full)', p });
  const out: AblRow[] = [];
  for (const s of steps) {
    for (const target of [T.dieu0, T.warmup1]) {
      for (const level of [1, 4]) {
        const setup = await render({ target, singer: { ...s.p, name: s.step }, level, trueLatencyMs: CAL_MS, performanceSeed: 1, microSeed: 1 });
        const o = oracle(setup);
        out.push({
          step: s.step, target: target.id, level,
          before: summarize(runSession(BEFORE, setup, measured(CAL_MS)), 'before'),
          after: summarize(runSession(AFTER, setup, measured(CAL_MS)), 'after'),
          oracleBefore: o.before.accuracy, oracleAfter: o.after.accuracy,
        });
      }
    }
  }
  return out;
}

