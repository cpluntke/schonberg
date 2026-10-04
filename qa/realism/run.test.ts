// Realistic synthetic-singer experiments. Writes qa/realism/out/report*.json and docs/qa/realism-*.md.
//
//   REALISM_BASELINE=1 npx vitest run --config vitest.realism.config.ts qa/realism/run.test.ts
// (skipped otherwise; the before/after comparison with the current app is cmp-*.test.ts)
//   REALISM_SEEDS=5 ...                                                      (fewer repeatability seeds)
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScoringOptions } from '../../src/game/types';
import { runTake, LATENCIES, type LatencyCondition, type TakeRecord, type Target } from './experiment';
import { fidelity, type Fidelity, type TakeReadings } from './fidelity';
import { readingsToSamples, scorePcm, scoreRecording, SCORE_CURRENT, SCORE_HEAD, type Scorer } from './harness';
import { REPO_ROOT } from './scores';
import { CHANNELS, SINGERS, idealised, type SingerProfile } from './singer';
import { PITCH_CURRENT, PITCH_HEAD, trackOffline } from './tracker';
import { writeWav16 } from './wav';
import { hashSeed } from './prng';

declare const process: { env: Record<string, string | undefined>; version: string };

// The before/after comparison lives in cmp-*.test.ts; this file regenerates the baseline report only.
const IMPL = 'head' as 'head' | 'current';
const ENABLED = process.env.REALISM_BASELINE === '1';
const SCORER: Scorer = IMPL === 'head' ? SCORE_HEAD : SCORE_CURRENT;
const PITCH = IMPL === 'head' ? PITCH_HEAD : PITCH_CURRENT;
const SEEDS = Math.max(2, Number(process.env.REALISM_SEEDS ?? 10));
const OUT_DIR = resolve(REPO_ROOT, 'qa/realism/out');
const REPORT_JSON = resolve(OUT_DIR, IMPL === 'head' ? 'report.json' : 'report-current.json');
const REPORT_MD = resolve(REPO_ROOT, 'docs/qa', IMPL === 'head' ? 'realism-baseline.md' : 'realism-current.md');

const T: Record<string, Target> = {
  warmup0: { id: 'warmup-upbeat-6', piece: 'warmup-chorale', part: 'A', section: 0 },
  warmup1: { id: 'warmup-7-12', piece: 'warmup-chorale', part: 'A', section: 1 },
  dieu0: { id: 'dieu-1-5', piece: 'debussy-dieu', part: 'A', section: 0 },
  dieu1: { id: 'dieu-6-13', piece: 'debussy-dieu', part: 'A', section: 1 },
  tab0: { id: 'tabourin-solo-1-8', piece: 'debussy-tabourin', part: 'P1', section: 0 },
  tab1: { id: 'tabourin-solo-9-16', piece: 'debussy-tabourin', part: 'P1', section: 1 },
};
const ALL_TARGETS = Object.values(T);
const [CAL, UNCAL200, UNCAL280] = LATENCIES;

const base = { scorer: SCORER, pitchImpl: PITCH };

const OPTION_VARIANTS: { variant: string; extra: Partial<ScoringOptions> }[] = [
  { variant: 'default (vibWin 0.18, grace 0.08)', extra: {} },
  { variant: 'vibratoWindow 0', extra: { vibratoWindow: 0 } },
  { variant: 'vibratoWindow 0.30', extra: { vibratoWindow: 0.3 } },
  { variant: 'onsetGrace 0.15', extra: { onsetGrace: 0.15 } },
  { variant: 'onsetGrace 0.25', extra: { onsetGrace: 0.25 } },
];

// ---------------------------------------------------------------------------------------------
// formatting

const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : `${Math.round(x * 100)}%`);
const f0 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : `${Math.round(x)}`);
const f1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(1));
const signed = (x: number | null | undefined) => (x == null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x)}¢`);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const passTxt = (p: boolean | null) => (p == null ? '–' : p ? 'pass' : 'FAIL');
const letterHist = (ls: string[]) => ['S', 'A', 'B', 'C', 'D'].map((l) => [l, ls.filter((x) => x === l).length] as const).filter(([, n]) => n).map(([l, n]) => `${l}×${n}`).join(' ');

// ---------------------------------------------------------------------------------------------

interface FidRow { singer: string; config: string; takes: string; fid: Fidelity; scoredPitch: number; scoredAcc: number }
interface RepRow { target: string; level: number; latency: string; mode: string; accs: number[]; pitches: number[]; letters: string[]; passes: number; shownLetters: string[]; shownAccs: number[] }
interface SeqRow { seed: number; level: number; trueLatencyMs: number; runs: { assumedLatencyMs: number; letter: string; accuracy: number; learnedMs: number | null; shownLetter: string; shownAccuracy: number }[] }
interface OptRow { singer: string; target: string; level: number; latency: string; variant: string; pitch: number; accuracy: number; letter: string }

const report = {
  meta: { impl: IMPL, generated: new Date().toISOString(), node: process.version, seeds: SEEDS, sampleRate: 48000, tracker: 'N=2048, hop 20 ms ±3 ms jitter, 128-frame quanta' },
  fidelity: [] as FidRow[],
  grid: [] as TakeRecord[],
  bleed: [] as (TakeRecord & { bleedDb: number; octaveOrSubharmonic: number; over50: number })[],
  repeatability: [] as RepRow[],
  sequence: [] as SeqRow[],
  sanity: [] as TakeRecord[],
  ablation: [] as (TakeRecord & { step: string })[],
  options: [] as OptRow[],
  roundtrip: null as null | { direct: number; viaWav: number; wav: string },
};

describe.skipIf(!ENABLED)(`realism baseline (${IMPL})`, () => {
  it('1. tracker fidelity vs ground truth', async () => {
    const singers = [SINGERS.goodChoir, SINGERS.operatic, SINGERS.plainControl, SINGERS.ringing];
    const configs = [
      { id: 'N2048 hop20', windowN: 2048, hopMs: 20 },
      { id: 'N1024 hop20', windowN: 1024, hopMs: 20 },
      { id: 'N1024 hop10', windowN: 1024, hopMs: 10 },
    ];
    const variants: { singer: SingerProfile; level: number; channel: typeof CHANNELS.phoneHeadphones; label: string }[] = [
      ...singers.map((s) => ({ singer: s, level: 4, channel: CHANNELS.phoneHeadphones, label: s.name })),
      { singer: SINGERS.goodChoir, level: 1, channel: CHANNELS.phoneSpeaker, label: `${SINGERS.goodChoir.name} + speaker bleed (L1)` },
    ];
    for (const v of variants) {
      const runs = [];
      for (const t of [T.dieu0, T.warmup1]) runs.push(await runTake({ ...base, target: t, singer: v.singer, level: v.level, latency: CAL, channel: v.channel, performanceSeed: 1, microSeed: 1 }));
      for (const c of configs) {
        const pairs: TakeReadings[] = [];
        const pitches: number[] = [];
        const accs: number[] = [];
        for (const r of runs) {
          const readings = trackOffline(r.take.pcm, r.take.sampleRate, { windowN: c.windowN, hopMs: c.hopMs, jitterMs: 3, seed: 7, impl: PITCH, untilSec: r.take.stopSec });
          pairs.push({ take: r.take, readings });
          const s = await scorePcm(r.take.pcm, r.sidecar, { scorer: SCORER, samples: readingsToSamples(readings, r.sidecar) });
          pitches.push(s.result.pitch);
          accs.push(s.result.accuracy);
        }
        report.fidelity.push({ singer: v.label, config: c.id, takes: `${T.dieu0.id}, ${T.warmup1.id} at L${v.level}`, fid: fidelity(pairs), scoredPitch: mean(pitches), scoredAcc: mean(accs) });
      }
    }
    const good = report.fidelity.find((r) => r.singer === SINGERS.goodChoir.name && r.config === 'N2048 hop20')!;
    // Harness self-check: a clean tracker on a steady voice is within a few cents.
    expect(good.fid.smoothed.steady.medianAbs).toBeLessThan(10);
  });

  it('2. good singers × latency × sections × levels (+ 6. scoring-option sensitivity)', async () => {
    for (const singer of [SINGERS.goodChoir, SINGERS.operatic]) {
      for (const target of ALL_TARGETS) {
        for (const level of [1, 4]) {
          for (const latency of LATENCIES) {
            const r = await runTake({ ...base, target, singer, level, latency, performanceSeed: 1, microSeed: 1, oracle: true });
            report.grid.push(r.record);
            if ((target === T.dieu0 || target === T.warmup1) && latency !== UNCAL280) {
              // 6. Scoring-option sensitivity: re-score the same samples with other options.
              for (const v of OPTION_VARIANTS) {
                const s = await scorePcm(r.take.pcm, r.sidecar, { scorer: (c, x, o) => SCORER(c, x, { ...o, ...v.extra }), samples: r.scored.samples });
                report.options.push({ singer: singer.name, target: target.id, level, latency: latency.id, variant: v.variant, pitch: s.result.pitch, accuracy: s.result.accuracy, letter: s.letter });
              }
            }
            if (singer === SINGERS.goodChoir && target === T.dieu0 && level === 1 && latency === UNCAL200) {
              // Round trip through a 16-bit WAV + sidecar: scoreRecording must match the direct path.
              mkdirSync(OUT_DIR, { recursive: true });
              const wav = resolve(OUT_DIR, 'example-dieu-1-5-alto-L1-uncal200.wav');
              writeFileSync(wav, writeWav16(r.take.pcm, r.take.sampleRate));
              writeFileSync(wav.replace(/\.wav$/, '.json'), JSON.stringify(r.sidecar, null, 2));
              const viaWav = await scoreRecording(wav, wav.replace(/\.wav$/, '.json'), SCORER, { track: { jitterMs: 3, seed: hashSeed('hop', 1), impl: PITCH }, untilSec: r.take.stopSec });
              report.roundtrip = { direct: r.record.accuracy, viaWav: viaWav.result.accuracy, wav: 'qa/realism/out/example-dieu-1-5-alto-L1-uncal200.wav' };
              expect(Math.abs(viaWav.result.accuracy - r.record.accuracy)).toBeLessThan(0.06);
            }
          }
        }
      }
    }
    // Phone speaker without headphones (backing bleeds into the mic): level sweep.
    const bleedPlan: { singer: SingerProfile; db: number; latency: LatencyCondition }[] = [
      ...[-18, -13, -8].map((db) => ({ singer: SINGERS.goodChoir, db, latency: CAL })),
      { singer: SINGERS.goodChoir, db: -13, latency: UNCAL200 },
      { singer: SINGERS.operatic, db: -13, latency: CAL },
    ];
    for (const b of bleedPlan) {
      for (const target of [T.dieu0, T.warmup1]) {
        for (const level of [1, 4]) {
          const channel = { ...CHANNELS.phoneSpeaker, bleedDb: b.db };
          const r = await runTake({ ...base, target, singer: b.singer, level, latency: b.latency, channel, performanceSeed: 1, microSeed: 1 });
          const pairs = [{ take: r.take, readings: r.scored.readings }];
          const fid = fidelity(pairs);
          report.bleed.push({ ...r.record, bleedDb: b.db, octaveOrSubharmonic: fid.smoothed.overall.octave, over50: fid.smoothed.overall.over50 });
        }
      }
    }
  });

  it('3. repeatability across seeds', async () => {
    const plan: { target: Target; level: number; latency: LatencyCondition; modes: ('micro' | 'performance')[] }[] = [
      { target: T.dieu0, level: 1, latency: CAL, modes: ['micro', 'performance'] },
      { target: T.dieu0, level: 1, latency: UNCAL200, modes: ['micro', 'performance'] },
      { target: T.dieu0, level: 4, latency: CAL, modes: ['micro', 'performance'] },
      { target: T.dieu0, level: 4, latency: UNCAL200, modes: ['micro', 'performance'] },
      { target: T.warmup1, level: 1, latency: UNCAL200, modes: ['micro'] },
      { target: T.warmup1, level: 4, latency: CAL, modes: ['micro'] },
    ];
    for (const p of plan) {
      for (const mode of p.modes) {
        const row: RepRow = { target: p.target.id, level: p.level, latency: p.latency.id, mode, accs: [], pitches: [], letters: [], passes: 0, shownLetters: [], shownAccs: [] };
        for (let k = 1; k <= SEEDS; k++) {
          const r = await runTake({ ...base, target: p.target, singer: SINGERS.goodChoir, level: p.level, latency: p.latency, performanceSeed: mode === 'micro' ? 1 : 100 + k, microSeed: k });
          row.accs.push(r.record.accuracy);
          row.pitches.push(r.record.pitch);
          row.letters.push(r.record.letter);
          if (r.record.passed) row.passes++;
          // What the Results screen shows (Play.tsx re-scores when it learns a delay).
          row.shownLetters.push(r.record.learned?.letter ?? r.record.letter);
          row.shownAccs.push(r.record.learned?.accuracy ?? r.record.accuracy);
        }
        report.repeatability.push(row);
      }
    }

    // A first-time (uncalibrated) singer doing three runs in a row: the app may learn the delay.
    const seqPlan = [
      { level: 1, trueMs: 250 }, { level: 1, trueMs: 300 },
      { level: 2, trueMs: 200 }, { level: 2, trueMs: 215 }, { level: 2, trueMs: 230 },
    ];
    for (const sp of seqPlan) {
      for (let seed = 1; seed <= 4; seed++) {
        let profileLatency = 0;
        const row: SeqRow = { seed, level: sp.level, trueLatencyMs: sp.trueMs, runs: [] };
        for (let run = 0; run < 3; run++) {
          const latency: LatencyCondition = profileLatency
            ? { id: 'learned', label: 'learned', trueLatencyMs: sp.trueMs, assumedLatencyMs: profileLatency, uncalibrated: false }
            : { id: `uncal${sp.trueMs}`, label: 'uncal', trueLatencyMs: sp.trueMs, assumedLatencyMs: 80, uncalibrated: true };
          const r = await runTake({ ...base, target: T.dieu0, singer: SINGERS.goodChoir, level: sp.level, latency, performanceSeed: 200 + seed * 10 + run, microSeed: seed * 10 + run });
          const learned = r.record.learned;
          row.runs.push({
            assumedLatencyMs: latency.assumedLatencyMs, letter: r.record.letter, accuracy: r.record.accuracy, learnedMs: learned?.latencyMs ?? null,
            shownLetter: learned?.letter ?? r.record.letter, shownAccuracy: learned?.accuracy ?? r.record.accuracy,
          });
          if (learned) profileLatency = learned.latencyMs;
        }
        report.sequence.push(row);
      }
    }
  });

  it('4. sanity: bad singers fail', async () => {
    for (const singer of [SINGERS.flat40, SINGERS.wrongNotes]) {
      for (const target of [T.dieu0, T.warmup1, T.tab0]) {
        for (const level of [1, 2, 4]) {
          for (const latency of [CAL, UNCAL200]) {
            const r = await runTake({ ...base, target, singer, level, latency, performanceSeed: 1, microSeed: 1 });
            report.sanity.push(r.record);
          }
        }
      }
    }
  });

  it('5. ablation: which realism factor costs points', async () => {
    const g = SINGERS.goodChoir;
    const ideal = idealised(g);
    const steps: { step: string; p: SingerProfile }[] = [];
    let p: SingerProfile = { ...ideal };
    steps.push({ step: '0 idealised (steady, instant steps, on time)', p });
    p = { ...p, noteSdCents: g.noteSdCents, biasCents: g.biasCents, drift: g.drift };
    steps.push({ step: '1 + intonation scatter (sd 5¢) & drift', p });
    p = { ...p, vibrato: g.vibrato };
    steps.push({ step: '2 + small vibrato (±20¢, 5.5 Hz)', p });
    p = { ...p, transition: g.transition, scoop: g.scoop };
    steps.push({ step: '3 + 2nd-order transitions & scoops', p });
    p = { ...p, timing: g.timing };
    steps.push({ step: '4 + onset jitter ±25 ms', p });
    p = { ...p, consonants: g.consonants };
    steps.push({ step: '5 + consonants (= full good singer)', p });
    for (const s of steps) {
      for (const target of [T.dieu0, T.warmup1]) {
        for (const level of [1, 4]) {
          const r = await runTake({ ...base, target, singer: { ...s.p, name: s.step }, level, latency: CAL, performanceSeed: 1, microSeed: 1, oracle: true });
          report.ablation.push({ ...r.record, step: s.step });
        }
      }
    }
  });

  it('writes the report', async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(REPORT_JSON, JSON.stringify(report, null, 1));
    mkdirSync(resolve(REPO_ROOT, 'docs/qa'), { recursive: true });
    writeFileSync(REPORT_MD, await markdown());
    // Sanity guard (checked last so the report is always written): bad singers must fail.
    // Exception by design: −40¢ is inside L1's ±50¢ window, so the flat singer may pass L1.
    const passedBad = sanityFailures();
    expect(passedBad.map((r) => `${r.singer} ${r.target} L${r.level} ${r.latency}`)).toEqual([]);
  });
});

/** Bad-singer runs that pass although they must not (flat −40¢ at L1 is allowed: inside ±50¢). */
function sanityFailures(): TakeRecord[] {
  return report.sanity.filter((r) => (r.passed || r.learned?.passed) && !(r.singer === SINGERS.flat40.name && r.level === 1));
}

// ---------------------------------------------------------------------------------------------
// Markdown

async function markdown(): Promise<string> {
  const L: string[] = [];
  const g = report.grid;
  const good = g.filter((r) => r.singer === SINGERS.goodChoir.name);
  const opera = g.filter((r) => r.singer === SINGERS.operatic.name);
  const by = (rs: TakeRecord[], lat: string, level?: number) => rs.filter((r) => r.latency === lat && (level == null || r.level === level));
  const fid = (singer: string, cfg = 'N2048 hop20') => report.fidelity.find((r) => r.singer === singer && r.config === cfg)!;
  const fg = fid(SINGERS.goodChoir.name);
  const fc = fid(SINGERS.plainControl.name);
  const fr = fid(SINGERS.ringing.name);

  L.push(`# Realism baseline: synthetic singer through the real pipeline (${IMPL === 'head' ? 'baseline, frozen HEAD scorer + tracker' : 'current working tree'})`);
  L.push('');
  L.push(`Generated ${report.meta.generated} by \`npx vitest run --config vitest.realism.config.ts\`${IMPL === 'current' ? ' with `REALISM_IMPL=current`' : ''}. Harness: \`qa/realism/\` (see its README). ` +
    `Scorer: ${IMPL === 'head' ? '`qa/realism/baseline/scoring.ts` (frozen copy of `src/game/scoring.ts` at the baseline commit)' : '`src/game/scoring.ts` (working tree)'}; ` +
    `tracker: ${IMPL === 'head' ? '`qa/realism/baseline/pitch.ts`' : '`src/audio/pitch.ts`'} (pitchy MPM, gates, median-of-3 smoother), offline at 48 kHz, ${report.meta.tracker}. Raw data: \`qa/realism/out/${IMPL === 'head' ? 'report.json' : 'report-current.json'}\`.`);
  L.push('');
  L.push('Singer model: per-note intonation error, vibrato with onset delay and wander, 2nd-order (underdamped) legato transitions, scoops, drift, onset jitter, consonant noise bursts at lyric syllables, breath gaps, glottal source with jitter/shimmer/aspiration and 5 alto formants; channel: room reverb (RT60 0.4 s, −9 dB wet), 150 Hz phone-mic high-pass, background noise at 32 dB SNR, optional speaker bleed of the backing. Latency: true acoustic round trip vs what the app assumes.');
  L.push('');
  L.push('Levels (standard strictness): L1 = 70 % tempo, ±50¢, guide on, pass 75 %; L4 = 100 % tempo, ±25¢, pass 85 %. "In tune" = `pitch`, the letter comes from `accuracy` (S ≥ 95, A ≥ 85, B ≥ 70, C ≥ 50).');
  L.push('');

  // ---- key numbers
  L.push('## Key numbers');
  L.push('');
  const kn = (rs: TakeRecord[]) => `in tune ${pct(mean(rs.map((r) => r.pitch)))} (min ${pct(Math.min(...rs.map((r) => r.pitch)))}), accuracy ${pct(mean(rs.map((r) => r.accuracy)))} (min ${pct(Math.min(...rs.map((r) => r.accuracy)))}), letters ${letterHist(rs.map((r) => r.letter))}, passes ${rs.filter((r) => r.passed).length}/${rs.length}`;
  for (const [name, rs] of [['Good choir singer', good], ['Operatic vibrato', opera]] as const) {
    for (const lat of LATENCIES) {
      for (const level of [1, 4]) L.push(`- **${name}, L${level}, ${lat.label}:** ${kn(by(rs, lat.id, level))}`);
    }
  }
  L.push(`- **Same takes, perfect tracker + true latency ("oracle"), good singer:** L1 ${pct(mean(good.filter((r) => r.level === 1 && r.oracle).map((r) => r.oracle!.pitch)))} in tune / ${pct(mean(good.filter((r) => r.level === 1).map((r) => r.oracle!.accuracy)))} accuracy; L4 ${pct(mean(good.filter((r) => r.level === 4).map((r) => r.oracle!.pitch)))} / ${pct(mean(good.filter((r) => r.level === 4).map((r) => r.oracle!.accuracy)))}.`);
  L.push(`- **Tracker (good singer, N=2048):** steady-state median |error| ${f1(fg.fid.smoothed.steady.medianAbs)}¢ (p90 ${f1(fg.fid.smoothed.steady.p90Abs)}¢); within ±150 ms of transitions p90 ${f1(fg.fid.smoothed.nearTransitions.p90Abs)}¢, p99 ${f1(fg.fid.smoothed.nearTransitions.p99Abs)}¢; readings >50¢ off the truth: ${pct(fg.fid.smoothed.overall.over50)} overall, ${pct(fg.fid.smoothed.nearTransitions.over50)} near transitions, ${pct(fg.fid.smoothed.steady.over50)} in steady parts.`);
  L.push(`- **Overshoot:** voice overshoot (pitch centre) ${f0(fg.fid.overshoot.voiceCentre)}¢ (${pct(fg.fid.overshoot.centreShareOfInterval)} of the interval), tracker shows ${f0(fg.fid.overshoot.detected)}¢; tracker invents >25¢ extra overshoot in ${pct(fg.fid.overshoot.invented)} of transitions. Control voice without overshoot: tracker shows ${f0(fc.fid.overshoot.detected)}¢ (invented in ${pct(fc.fid.overshoot.invented)}). Ringing voice (ζ≈0.35): voice ${f0(fr.fid.overshoot.voiceCentre)}¢, tracker ${f0(fr.fid.overshoot.detected)}¢.`);
  const gb = (lat: string) => good.filter((r) => r.latency === lat && r.level === 1);
  L.push(`- **Live cents bubble right after a note change (good singer, L1):** shows > tolerance toward the *previous* note in ${pct(mean(gb('cal').map((r) => r.bubble.lagShare)))} of changes when calibrated, ${pct(mean(gb('uncal200').map((r) => r.bubble.lagShare)))} at true 200/assumed 80, ${pct(mean(gb('uncal280').map((r) => r.bubble.lagShare)))} at 280/80; beyond the new note (displayed "overshoot") in ${pct(mean(gb('cal').map((r) => r.bubble.overShare)))} / ${pct(mean(gb('uncal200').map((r) => r.bubble.overShare)))} / ${pct(mean(gb('uncal280').map((r) => r.bubble.overShare)))}; out of tolerance until ${f0(mean(gb('cal').map((r) => r.bubble.settleMs)))} / ${f0(mean(gb('uncal200').map((r) => r.bubble.settleMs)))} / ${f0(mean(gb('uncal280').map((r) => r.bubble.settleMs)))} ms after the bar changes.`);
  for (const r of report.repeatability) {
    L.push(`- **Repeatability ${r.target} L${r.level} ${r.latency} (${r.mode === 'micro' ? 'same performance, micro-randomness only' : 'performance varies too'}, ${r.accs.length} seeds):** accuracy ${pct(Math.min(...r.accs))}–${pct(Math.max(...r.accs))} (sd ${f1(100 * sd(r.accs))} pts), in tune ${pct(Math.min(...r.pitches))}–${pct(Math.max(...r.pitches))}, letters ${letterHist(r.letters)}${r.shownLetters.join() !== r.letters.join() ? `, shown after latency learning ${letterHist(r.shownLetters)}` : ''}, passes ${r.passes}/${r.accs.length}.`);
  }
  {
    const gbl = report.bleed.filter((r) => r.singer === SINGERS.goodChoir.name && r.latency === 'cal');
    const cell = (db: number, level: number) => {
      const rs = gbl.filter((r) => r.bleedDb === db && r.level === level);
      return `${pct(mean(rs.map((r) => r.accuracy)))} acc / ${pct(mean(rs.map((r) => r.pitch)))} in tune (${pct(mean(rs.map((r) => r.octaveOrSubharmonic)))} octave/subharmonic readings)`;
    };
    L.push(`- **Phone speaker instead of headphones (good singer, calibrated, mean of 2 sections):** bleed −18 dB: L1 ${cell(-18, 1)}, L4 ${cell(-18, 4)}; −13 dB: L1 ${cell(-13, 1)}, L4 ${cell(-13, 4)}; −8 dB: L1 ${cell(-8, 1)}, L4 ${cell(-8, 4)}.`);
  }
  {
    const seqTxt = (level: number, ms: number) => report.sequence.filter((q) => q.level === level && q.trueLatencyMs === ms).map((q) => q.runs.map((r) => r.shownLetter).join('/')).join(', ');
    L.push(`- **Three runs in a row, new uncalibrated singer, dieu bars 1–5 (shown letters per seed):** ${[...new Set(report.sequence.map((q) => `${q.level}|${q.trueLatencyMs}`))].map((k) => { const [lv, ms] = k.split('|').map(Number); return `L${lv} true ${ms} ms: ${seqTxt(lv, ms)}`; }).join('; ')}.`);
  }
  const sanityPass = sanityFailures();
  const flatL1 = report.sanity.filter((r) => r.singer === SINGERS.flat40.name && r.level === 1);
  const wrong = report.sanity.filter((r) => r.singer === SINGERS.wrongNotes.name);
  L.push(`- **Sanity:** ${sanityPass.length === 0 ? 'every bad-singer run that must fail fails' : `${sanityPass.length} bad-singer run(s) PASS (bug)`}. Wrong notes (40 %): max accuracy ${pct(Math.max(...wrong.map((r) => r.accuracy)))}. Flat −40¢ passes L1 in ${flatL1.filter((r) => r.passed || r.learned?.passed).length}/${flatL1.length} runs (−40¢ is inside L1's ±50¢ window, by design), and fails L2 and L4.`);
  if (report.roundtrip) L.push(`- **WAV round trip** (16-bit file + sidecar through \`scoreRecording\`): accuracy ${pct(report.roundtrip.direct)} direct vs ${pct(report.roundtrip.viaWav)} via \`${report.roundtrip.wav}\`.`);
  L.push('');

  if (IMPL === 'head') {
    L.push('## Observations (baseline)');
    L.push('');
    L.push(...OBSERVATIONS);
    L.push('');
  }

  // ---- 1
  L.push('## 1. Tracker fidelity (smoothed output vs ground-truth f0, cents)');
  L.push('');
  L.push(`Takes: ${T.dieu0.id} and ${T.warmup1.id} (Alto), L4 tempo, calibrated, headphones, unless noted. "near" = within ±150 ms of a pitch change or voice onset. ">50¢" = readings off the true sung pitch by more than 50¢ (spikes the voice does not have). Overshoot = largest excursion beyond the new note in the 400 ms after a legato change (voice centre / tracker). "Scored" = mean in-tune and accuracy of those takes with this tracker.`);
  L.push('');
  L.push(table(
    ['singer', 'tracker', 'steady med/p90', 'near med/p90/p99', '>50¢ steady / near', 'octave', 'missed voiced', 'false voiced', 'overshoot voice → tracker', 'invented', 'scored in tune / acc'],
    report.fidelity.map((r) => [
      r.singer, r.config,
      `${f1(r.fid.smoothed.steady.medianAbs)} / ${f1(r.fid.smoothed.steady.p90Abs)}`,
      `${f1(r.fid.smoothed.nearTransitions.medianAbs)} / ${f1(r.fid.smoothed.nearTransitions.p90Abs)} / ${f0(r.fid.smoothed.nearTransitions.p99Abs)}`,
      `${pct(r.fid.smoothed.steady.over50)} / ${pct(r.fid.smoothed.nearTransitions.over50)}`,
      pct(r.fid.smoothed.overall.octave),
      pct(r.fid.missedVoiced), pct(r.fid.falseVoiced),
      `${f0(r.fid.overshoot.voiceCentre)} → ${f0(r.fid.overshoot.detected)}`,
      pct(r.fid.overshoot.invented),
      `${pct(r.scoredPitch)} / ${pct(r.scoredAcc)}`,
    ]),
  ));
  L.push('');
  L.push('Raw (unsmoothed) detector, N=2048, good singer: ' + (() => { const r = fg.fid.raw; return `steady median ${f1(r.steady.medianAbs)}¢ p90 ${f1(r.steady.p90Abs)}¢, near transitions p90 ${f1(r.nearTransitions.p90Abs)}¢ p99 ${f0(r.nearTransitions.p99Abs)}¢, >50¢ near ${pct(r.nearTransitions.over50)}.`; })());
  L.push('');

  // ---- 2
  L.push('## 2. Good singers: latency × section × level');
  L.push('');
  L.push('"learned" = what the Results screen shows after Play.tsx learns the delay from late entries and re-scores (uncalibrated profiles only; blank = the rule did not fire). "oracle" = same take scored from the true f0 with the true latency (no tracker, no latency error). Loss: notes perfect / demoted to good only by |median| > tol/2 / hit ratio < 0.8; "early" = share of out-of-tolerance body samples in the first 150 ms of the note body.');
  L.push('');
  for (const singer of [SINGERS.goodChoir.name, SINGERS.operatic.name]) {
    L.push(`### ${singer}`);
    L.push('');
    L.push(table(
      ['section', 'L', 'latency', 'in tune', 'rhythm', 'acc', 'grade', 'pass', 'avg', 'learned → acc/grade', 'oracle in tune/acc', 'perfect / median-demoted / low-hit', 'early', 'bubble lag/over'],
      g.filter((r) => r.singer === singer).map((r) => [
        `${r.target}`, r.level, r.latency, pct(r.pitch), pct(r.rhythm), pct(r.accuracy), r.letter, passTxt(r.passed), signed(r.avgCents),
        r.learned ? `${r.learned.latencyMs} ms → ${pct(r.learned.accuracy)} ${r.learned.letter}` : '',
        r.oracle ? `${pct(r.oracle.pitch)} / ${pct(r.oracle.accuracy)}` : '',
        `${r.loss.perfect} / ${r.loss.demotedByMedian} / ${r.loss.lowHitRatio} (of ${r.loss.notes})`,
        pct(r.loss.lostEarlyShare),
        `${pct(r.bubble.lagShare)} / ${pct(r.bubble.overShare)}`,
      ]),
    ));
    L.push('');
  }
  L.push('### Phone speaker, no headphones (backing bleeds into the mic; speaker high-passed at 400 Hz)');
  L.push('');
  L.push('Bleed level is the backing RMS relative to the voice RMS at the mic. L1 includes the own part (guide) in the backing, L4 only the other parts. "octave/subharm." = share of voiced readings more than 600¢ off the true sung pitch.');
  L.push('');
  L.push(table(
    ['singer', 'bleed', 'section', 'L', 'latency', 'in tune', 'rhythm', 'acc', 'grade', 'pass', 'octave/subharm.', '>50¢ off', 'learned'],
    report.bleed.map((r) => [r.singer, `${r.bleedDb} dB`, r.target, r.level, r.latency, pct(r.pitch), pct(r.rhythm), pct(r.accuracy), r.letter, passTxt(r.passed), pct(r.octaveOrSubharmonic), pct(r.over50), r.learned ? `${r.learned.latencyMs} ms → ${pct(r.learned.accuracy)} ${r.learned.letter}` : '']),
  ));
  L.push('');

  // ---- 3
  L.push('## 3. Repeatability (good choir singer)');
  L.push('');
  L.push('"micro" = identical performance (same intonation errors, timing, transitions), only glottal jitter/shimmer, noise, vibrato phase/wander and tracker hop jitter change. "performance" = a new, equally good performance each run (what "sang it the same way" really means for a human).');
  L.push('');
  L.push(table(
    ['section', 'L', 'latency', 'mode', 'accuracy min–max (sd)', 'in tune min–max', 'letters', 'shown letters', 'passes'],
    report.repeatability.map((r) => [r.target, r.level, r.latency, r.mode, `${pct(Math.min(...r.accs))}–${pct(Math.max(...r.accs))} (${f1(100 * sd(r.accs))})`, `${pct(Math.min(...r.pitches))}–${pct(Math.max(...r.pitches))}`, letterHist(r.letters), letterHist(r.shownLetters), `${r.passes}/${r.accs.length}`]),
  ));
  L.push('');
  L.push('### Three runs in a row by a new (uncalibrated) singer, dieu bars 1–5');
  L.push('');
  L.push('Run 1 uses the 80 ms estimate; when Play.tsx learns a delay, the run is re-scored with it ("shown") and later runs use the learned value.');
  L.push('');
  L.push(table(
    ['L', 'true latency', 'seed', 'run 1 (assumed → shown)', 'run 2', 'run 3'],
    report.sequence.map((s) => [s.level, `${s.trueLatencyMs} ms`, s.seed, ...s.runs.map((r) => `${r.assumedLatencyMs} ms: ${r.letter} ${pct(r.accuracy)}${r.learnedMs ? ` → learned ${r.learnedMs} ms: ${r.shownLetter} ${pct(r.shownAccuracy)}` : ''}`)]),
  ));
  L.push('');

  // ---- 4
  L.push('## 4. Sanity: bad singers');
  L.push('');
  L.push(table(
    ['singer', 'section', 'L', 'latency', 'in tune', 'acc', 'grade', 'pass', 'learned'],
    report.sanity.map((r) => [r.singer, r.target, r.level, r.latency, pct(r.pitch), pct(r.accuracy), r.letter, passTxt(r.passed), r.learned ? `${r.learned.latencyMs} ms → ${pct(r.learned.accuracy)} ${passTxt(r.learned.passed)}` : '']),
  ));
  L.push('');

  // ---- 5
  L.push('## 5. Ablation: adding realism one factor at a time (calibrated, headphones)');
  L.push('');
  L.push(table(
    ['step', 'section', 'L', 'in tune', 'acc', 'grade', 'oracle in tune / acc', 'perfect / median-demoted / low-hit'],
    report.ablation.map((r) => [r.step, r.target, r.level, pct(r.pitch), pct(r.accuracy), r.letter, r.oracle ? `${pct(r.oracle.pitch)} / ${pct(r.oracle.accuracy)}` : '', `${r.loss.perfect} / ${r.loss.demotedByMedian} / ${r.loss.lowHitRatio}`]),
  ));
  L.push('');

  // ---- 6
  L.push('## 6. Scoring-option sensitivity (same samples re-scored)');
  L.push('');
  const keys = [...new Set(report.options.map((o) => `${o.singer}|${o.target}|${o.level}|${o.latency}`))];
  const variants = [...new Set(report.options.map((o) => o.variant))];
  L.push(table(
    ['singer', 'section', 'L', 'latency', ...variants],
    keys.map((k) => {
      const [singer, target, level, latency] = k.split('|');
      return [singer, target, level, latency, ...variants.map((v) => {
        const o = report.options.find((x) => `${x.singer}|${x.target}|${x.level}|${x.latency}` === k && x.variant === v)!;
        return `${pct(o.pitch)} / ${pct(o.accuracy)} ${o.letter}`;
      })];
    }),
  ));
  L.push('');
  L.push('Cells: in tune / accuracy grade.');
  L.push('');
  return L.join('\n');
}

/** Hand-written reading of the baseline numbers (only emitted for IMPL=head; all runs are seeded, so they reproduce). */
const OBSERVATIONS: string[] = [
  '1. **With calibrated latency and headphones, the baseline scores a good singer fairly.** The good choir singer gets S on all 6 sections at L1 and 5 of 6 at L4 (in tune 95–100 %). The "oracle" (true f0 + true latency) gives 99–100 %, so neither the tracker nor the scorer loses meaningful points on a realistic voice when timing is right. The ablation agrees: idealised → + scatter/drift → + small vibrato → + 2nd-order transitions → + onset jitter → + consonants stays at 97–100 % in tune and accuracy at every step.',
  '2. **Latency mismatch is the dominant cause of lost points.** True 200 ms vs assumed 80 ms costs little at L1 (70 % tempo, ±50¢) but at L4 it drops in tune to 47–91 % (mean 78 %) and fails 2 of 6 sections. Debussy bars 1–5 (0.17 s ornaments) drop to C, 47 % in tune with "avg −1¢". At 280/80, L1 Debussy bars 1–5 is C (49 % in tune) and L4 is C/D on 4 of 6 sections. The lost body time sits at note starts ("early" column mostly 75–100 %): the previous note\'s pitch is still in the first part of each body. This is complaint 2, and it is also the best match for complaint 4 ("avg +3¢ but 90 % in tune"). Several uncalibrated L4 rows show |avg| ≤ 5¢ with 82–91 % in tune.',
  '3. **The latency learning in Play.tsx has a cliff.** It fires only when the median onset / rate > 170 ms (and IQR / rate < 120 ms). At L1 that means a true round trip somewhere between 200 and 250 ms; at L2/L4 (rate 1.0), about 215–230 ms. Above the cliff, the run is re-scored and every later run is S. Below it, nothing is learned and a 200 ms phone stays at C/B on Debussy at L2 every time. Near the cliff it is random: at L2 with a true 215 ms the 4 seeds give C/C/C, C/C/C, **C/S/S** and S/S/S. In C/S/S, run 1 learns nothing, run 2 learns the delay (and is re-scored), and run 3 uses it. That is the C/A/A pattern Jenny reported. Micro-randomness alone (same performance) moves calibrated accuracy by ≤ 0.8 pts sd and never changes the letter, so the scorer itself is stable.',
  '4. **The tracker does not invent overshoot (with headphones).** Voice overshoot after legato changes is 28¢ (13 % of the interval) for the good singer and 68¢ for a ringing voice (ζ≈0.35). The smoothed tracker shows less: 19¢ and 50¢. Against a control voice with no overshoot it shows 3¢, and in 0 % of transitions does it show more than 25¢ beyond the true pitch. Steady-state error is 3.5¢ median (p90 8.5¢); spikes over 50¢ occur only within ±150 ms of transitions (3 % of those readings). The "sinc-like wiggle" in the trace is real voice dynamics (2nd-order ringing plus vibrato starting), slightly smoothed. N=1024 or a 10 ms hop changes the scores by ≤ 2 pts; they mostly show more of the real overshoot.',
  '5. **What the singer sees right after a note change is mostly readout lag, not overshoot.** The cents bubble compares the *latest* reading with the note under the *playhead*. The latest reading is always ≥ input latency + half a window + one hop behind the playhead, so for about 150 ms after every bar change (calibrated) the bubble shows the previous pitch against the new target. This takes 260 ms at 200/80 and 320 ms at 280/80. "Beyond the new note" readouts happen in only ~5 % of changes. Comparing the readout with the note at the sample\'s own score time would remove this.',
  '6. **Practising on the phone speaker breaks the tracker.** With the backing bleeding into the mic, MPM locks onto the common period of the voice and the equal-tempered backing. It reads f0/3 (−19 st, voice + a part a fifth away) or an octave below; the smoother\'s octave guard does not catch −19 st. At −18 dB bleed, L4 loses 4–25 pts. At −13 dB, half of the L4 readings are octave/subharmonic errors (C/D grades). At −8 dB, everything fails. L1 suffers less because the guide (own part) reinforces the singer\'s period. The trace shows these as huge jumps, clamped to the edge of the highway, and they cluster at transitions (+12 % "invented" excursions). So if Jenny practised without headphones, this alone explains "massive overshoot" and erratic grades.',
  '7. **Scoring mechanisms that cost points:** (a) the fixed 80 ms onset grace is in score time and cannot absorb a latency error (raising it to 0.15–0.25 s recovers up to 10 pts of in tune at L4 uncal200, e.g. Debussy 47 → 57 %, which is still B); (b) the vibrato window works: without it, operatic vibrato at L4 drops from 91–97 % to 54–68 % in tune; with it, a small vibrato costs nothing (ablation step 2), so vibrato alone does not reproduce complaint 4; (c) grade steps: "perfect" needs |median| ≤ tol/2 (12.5¢ at L4), and good singers lose 0–4 notes per section to that rule (operatic up to 7/42), while one "ok" in a 16-note section costs 3 pts; (d) the short-note leniency (body < 150 ms gets "good" from any in-tolerance raw sample) lets misaligned neighbour pitches count: the 40 % wrong-note singer scores *higher* uncalibrated (75 % vs 67 % on Debussy bars 1–5 at L1, 0.2 pts short of passing).',
  '8. **Sanity:** wrong notes (40 %) fail everywhere. A −40¢ flat singer passes L1 with B on 5 of 6 runs because −40¢ is inside L1\'s ±50¢ window; this follows from the level design (L2 and L4 fail).',
];
