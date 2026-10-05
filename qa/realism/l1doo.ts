// Level 1 on "doo" with the every-note rule (docs/LEVELS.md): do honest singers still pass reliably at
// 70% tempo, and do singers with a wrong note fail? Renders each singer on the lyrics and on "doo"
// (a short "d" before every note, vowel "u"), runs the current app's pipeline (calibrated 150 ms, and
// an uncalibrated phone at a true 200 ms, first run), and judges each run with the old rule (75%
// accuracy) and the new one (ladder.attemptPasses: every note right, unreliable notes forgiven
// unless clearly wrong). Notes that weren't right are listed with why (cmp-l1-doo.test.ts).
import { median } from '../../src/game/scoring';
import type { AttemptResult, NoteResult } from '../../src/game/types';
import { noteVerdict } from '../../src/progress/ladder';
import { ALL_TARGETS, SEEDS, T, render } from './compare';
import { piecePassage, renderTake, scoreTake, synthPassage, type FastPassage } from './fastnotes';
import { AFTER, UNCALIBRATED, measured, runSession, type SessionOutcome } from './pipeline';
import { SINGERS, onDoo, type SingerProfile } from './singer';

const CAL_MS = 150;

export interface WrongNote { target: string; index: number; grade: string; cents: number | null; hit: number; voiced: number; unsure: string | null; clearly: string | null; dur: number }

export interface L1Cell {
  singer: string;
  doo: boolean;
  latency: 'cal' | 'uncal200';
  runs: number;
  /** New rule (every note right). */
  passes: number;
  /** Old rule (accuracy ≥ 75%). */
  oldPasses: number;
  meanAcc: number;
  notes: number;
  /** Notes below "good", and how the new rule treated them. */
  belowGood: number;
  forgiven: number;
  wrong: WrongNote[];
  /** The forgiven notes themselves (to check the exemption stays narrow). */
  forgivenNotes: WrongNote[];
  /** Notes flagged unsure ('short' / 'range'). */
  unsure: number;
  /** Median onset (ms after the beat, score ms) and rhythm, to compare "d" with the lyrics. */
  medOnsetMs: number | null;
  rhythm: number;
}

export interface L1AdvRow { singer: string; target: string; latency: string; acc: number; passed: boolean; oldPassed: boolean; wrong: number; forgiven: number }

export interface L1DooReport {
  seeds: number;
  cells: L1Cell[];
  fast: L1Cell[];
  adversarial: L1AdvRow[];
}

function tally(cell: L1Cell, target: string, o: SessionOutcome, durOf: (i: number) => number): void {
  const r: AttemptResult = o.result;
  cell.runs++;
  if (o.passed) cell.passes++;
  if (r.accuracy >= 0.75) cell.oldPasses++;
  cell.meanAcc += r.accuracy;
  cell.notes += r.notes.length;
  cell.rhythm += r.rhythm;
  for (const n of r.notes) {
    if (n.unsure) cell.unsure++;
    if (n.grade === 'perfect' || n.grade === 'good') continue;
    cell.belowGood++;
    const v = noteVerdict(n);
    if (v === 'forgiven') {
      cell.forgiven++;
      cell.forgivenNotes.push(wrongOf(target, n, durOf(n.index)));
    } else cell.wrong.push(wrongOf(target, n, durOf(n.index)));
  }
}

function wrongOf(target: string, n: NoteResult, dur: number): WrongNote {
  return {
    target, index: n.index, grade: n.grade, cents: n.cents == null ? null : Math.round(n.cents), hit: +n.hitRatio.toFixed(2),
    voiced: +n.voicedRatio.toFixed(2), unsure: n.unsure ?? null, clearly: n.clearly ?? null, dur: +dur.toFixed(3),
  };
}

const newCell = (singer: string, doo: boolean, latency: L1Cell['latency']): L1Cell => ({
  singer, doo, latency, runs: 0, passes: 0, oldPasses: 0, meanAcc: 0, notes: 0, belowGood: 0, forgiven: 0, wrong: [], forgivenNotes: [], unsure: 0, medOnsetMs: null, rhythm: 0,
});

function finishCell(c: L1Cell, onsets: number[]): L1Cell {
  c.meanAcc /= Math.max(1, c.runs);
  c.rhythm /= Math.max(1, c.runs);
  c.medOnsetMs = onsets.length ? Math.round(median(onsets)!) : null;
  return c;
}

const onsetsOf = (r: AttemptResult) => r.notes.map((n) => n.onsetMs).filter((x): x is number => x != null);

/** Good singers × {lyrics, doo} × 6 sections × seeds × {calibrated, uncalibrated first run}. */
export async function l1Grid(o: { seeds?: number; singers?: SingerProfile[] } = {}): Promise<L1Cell[]> {
  const seeds = o.seeds ?? SEEDS;
  const singers = o.singers ?? [SINGERS.goodChoir, SINGERS.operatic, SINGERS.plainControl, SINGERS.ringing, SINGERS.slowTransitions];
  const out: L1Cell[] = [];
  for (const base of singers) {
    for (const doo of [false, true]) {
      const singer = doo ? onDoo(base) : base;
      const cells = { cal: newCell(base.name, doo, 'cal'), uncal200: newCell(base.name, doo, 'uncal200') };
      const ons = { cal: [] as number[], uncal200: [] as number[] };
      // The first singer gets every seed; the others half (they're there for the spread of voices).
      const n = base === singers[0] ? seeds : Math.max(2, Math.ceil(seeds / 2));
      for (const target of ALL_TARGETS) {
        for (let k = 1; k <= n; k++) {
          for (const lat of ['cal', 'uncal200'] as const) {
            const setup = await render({ target, singer, level: 1, trueLatencyMs: lat === 'cal' ? CAL_MS : 200, performanceSeed: 500 + k, microSeed: 500 + k });
            const res = runSession(AFTER, setup, lat === 'cal' ? measured(CAL_MS) : UNCALIBRATED);
            tally(cells[lat], target.id, res, (i) => setup.part.notes[i].dur / setup.take.rate);
            ons[lat].push(...onsetsOf(res.result));
          }
        }
      }
      out.push(finishCell(cells.cal, ons.cal), finishCell(cells.uncal200, ons.uncal200));
    }
  }
  return out;
}

/** The pieces' fast bars and synthetic 16ths/8ths at level 1, good singer, lyrics vs doo, calibrated. */
export async function l1Fast(seeds = 4): Promise<L1Cell[]> {
  const passages: FastPassage[] = [
    await piecePassage('debussy-yver', 'A', '1', '23'),
    await piecePassage('debussy-dieu', 'A', '1', '5'),
    await piecePassage('ravel-nicolette', 'A', '20', '45'),
    synthPassage(104, 0.25, 'ta'),
    synthPassage(144, 0.25, 'ta'),
    synthPassage(144, 0.5, 'ta'),
  ];
  const out: L1Cell[] = [];
  for (const doo of [false, true]) {
    const singer = doo ? onDoo(SINGERS.goodChoir) : SINGERS.goodChoir;
    const cell = newCell(`${SINGERS.goodChoir.name}, fast bars`, doo, 'cal');
    const ons: number[] = [];
    for (const p of passages) {
      for (let seed = 1; seed <= seeds; seed++) {
        const take = renderTake(p, singer, 1, 700 + seed);
        const run = scoreTake(p, take, 1, 700 + seed);
        tally(cell, p.id, run.outcome, (i) => p.part.notes[i].dur / take.rate);
        ons.push(...onsetsOf(run.outcome.result));
      }
    }
    out.push(finishCell(cell, ons));
  }
  return out;
}

/** Singers who must fail level 1 (and two to report): wrong notes, one note behind, a single wrong note. */
export async function l1Adversarial(seeds = 3): Promise<L1AdvRow[]> {
  const singers: SingerProfile[] = [
    { ...SINGERS.wrongNotes },
    { ...SINGERS.oneBehind },
    { ...SINGERS.goodChoir, name: 'one wrong note (a semitone, random)', wrongCount: 1 },
    { ...SINGERS.goodChoir, name: 'one note a semitone flat', wrongCount: 1, wrongByCents: -100 },
    { ...SINGERS.goodChoir, name: 'one note 70¢ flat', wrongCount: 1, wrongByCents: -70 },
    { ...SINGERS.flat40 },
  ];
  const out: L1AdvRow[] = [];
  for (const s of singers) {
    for (const target of [T.dieu0, T.dieu1, T.warmup0, T.warmup1, T.tab0, T.tab1]) {
      for (let k = 1; k <= seeds; k++) {
        const setup = await render({ target, singer: onDoo(s), level: 1, trueLatencyMs: CAL_MS, performanceSeed: 900 + k, microSeed: 900 + k });
        const o = runSession(AFTER, setup, measured(CAL_MS));
        const v = o.result.notes.map(noteVerdict);
        out.push({
          singer: s.name, target: target.id, latency: 'cal', acc: o.result.accuracy, passed: o.passed, oldPassed: o.result.accuracy >= 0.75,
          wrong: v.filter((x) => x === 'wrong').length, forgiven: v.filter((x) => x === 'forgiven').length,
        });
      }
    }
  }
  return out;
}

export async function l1DooExperiment(): Promise<L1DooReport> {
  return { seeds: SEEDS, cells: await l1Grid(), fast: await l1Fast(), adversarial: await l1Adversarial() };
}
