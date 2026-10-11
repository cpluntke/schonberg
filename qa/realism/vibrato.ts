// Wide vibrato at level 1: a singer whose vibrato is centred on every note, ±60/70/80¢ at 5.5 Hz
// (real time), sings every section of every library piece on "doo" at the level's tempo. Does the
// every-note rule still pass them? Compared with the scorer at VIB_BASE_REF (before the vibrato
// window followed the tempo). The same generator with wrong notes checks that nothing got easier.
// Pitch-level synthesis (no audio): the question is the scorer's smoothing, not the tracker.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AttemptResult, PitchSample, ScoringOptions } from '../../src/game/types';
import type { ScoringContext } from '../../src/game/scoring';
import * as cur from '../../src/game/scoring';
import type { Part } from '../../src/music/types';
import { attemptPasses, effectiveTolerance, stepSpec, noteVerdict } from '../../src/progress/ladder';
import { harnessStep } from './harness';
import { Rng } from './prng';
import { loadPiece, REPO_ROOT } from './scores';
import { gitVariant } from './variants';
import { levelSetup } from './harness';
import { AFTER, measured, runSession, type PipelineSpec } from './pipeline';
import { hashSeed } from './prng';
import { noteRangeFor } from './scores';
import { CHANNELS, SINGERS, onDoo, renderSinger, type SingerProfile } from './singer';

declare const process: { env: Record<string, string | undefined> };
/** The scorer before the vibrato window followed the tempo. */
export const VIB_BASE_REF = process.env.VIB_BASE_REF ?? 'cdc3a69';

export interface VibSinger {
  name: string;
  /** Vibrato extent (± cents, centred on the sung pitch) and rate (Hz, real time). */
  vibCents: number;
  vibHz?: number;
  /** Seconds (real) into the note before the vibrato starts (default 0.15). */
  vibDelay?: number;
  /** Cents added to note k (wrong notes). */
  offset?: (k: number, first: number) => number;
}

/**
 * One take of `part` over notes [a, b] at tempo `rate`: a "doo" (30 ms real without voice) at every
 * note, a glide into the note (time constant 40 ms real), vibrato from 0.15 s real into the note
 * with a random phase, the voice stopping 60 ms real before a rest. A reading every 20 ms real.
 */
export function singVibrato(part: Part, a: number, b: number, rate: number, s: VibSinger, seed: number): PitchSample[] {
  const rng = new Rng(seed);
  const ns = part.notes;
  const out: PitchSample[] = [];
  const hop = 0.02 * rate; // score seconds per reading
  const t0 = ns[a].start - 0.3;
  const t1 = ns[b].start + ns[b].dur + 0.1;
  const phase = ns.map(() => rng.uniform(0, 2 * Math.PI));
  let x = ns[a].midi;
  let k = a;
  for (let t = t0; t <= t1; t += hop) {
    while (k < b && ns[k + 1].start <= t) k++;
    const n = ns[k];
    const next = ns[k + 1];
    const inNote = t >= n.start && t < n.start + n.dur;
    const sinceReal = (t - n.start) / rate;
    const beforeRest = !next || next.start > n.start + n.dur + 1e-6;
    const untilEndReal = (n.start + n.dur - t) / rate;
    const voiced = inNote && sinceReal >= 0.03 && !(beforeRest && untilEndReal < 0.06);
    const target = n.midi + (s.offset ? s.offset(k, a) / 100 : 0);
    x += (target - x) * Math.min(1, 0.02 / 0.04);
    if (!voiced) {
      out.push({ time: t, midi: null, clarity: 0.3, rms: inNote ? 0.02 : 0.001 });
      continue;
    }
    const vib = sinceReal > (s.vibDelay ?? 0.15) ? (s.vibCents / 100) * Math.sin(2 * Math.PI * (s.vibHz ?? 5.5) * sinceReal + phase[k]) : 0;
    out.push({ time: t, midi: x + vib, clarity: 0.95, rms: 0.1 });
  }
  return out;
}

type ScoreFn = (ctx: ScoringContext, samples: PitchSample[], opts: ScoringOptions) => AttemptResult;

export interface VibRow { singer: string; level: number; sections: number; before: number; after: number; failedAfter: string[] }

/** Every vocal part × section of the library at `levels`: sections passed, before vs after. */
export async function vibratoExperiment(singers: VibSinger[], levels = [1]): Promise<{ baseRef: string | null; rows: VibRow[] }> {
  let base: ScoreFn | null = null;
  try {
    base = (await gitVariant(VIB_BASE_REF)).scoring.scoreAttempt as ScoreFn;
  } catch {
    base = null;
  }
  const ids = (JSON.parse(readFileSync(resolve(REPO_ROOT, 'library/index.json'), 'utf8')) as { id: string }[]).map((m) => m.id);
  const pieces = [];
  for (const id of ['warmup-chorale', ...ids]) {
    try { pieces.push(await loadPiece(id)); } catch { /* not loadable here */ }
  }
  const rows: VibRow[] = [];
  for (const level of levels) {
    const spec = stepSpec(level, harnessStep(level));
    const opts: ScoringOptions = { toleranceCents: effectiveTolerance(level, spec.step, 'standard'), tuning: 'equal', octaveTolerant: false, rate: spec.rate };
    for (const s of singers) {
      const row: VibRow = { singer: s.name, level, sections: 0, before: 0, after: 0, failedAfter: [] };
      let seed = 1;
      for (const p of pieces) {
        for (const part of p.score.parts.filter((x) => x.notes.length && x.voiceType !== 'other')) {
          for (const sec of p.sections) {
            let a = -1, b = -1;
            part.notes.forEach((n, i) => { if (n.start >= sec.start - 1e-6 && n.start < sec.end - 1e-6) { if (a < 0) a = i; b = i; } });
            if (a < 0) continue;
            // Wrong singers: only sections where they actually sing a wrong note.
            if (s.offset && !part.notes.slice(a, b + 1).some((_, j) => s.offset!(a + j, a) !== 0)) continue;
            const ctx: ScoringContext = { score: p.score, part, range: [a, b], end: sec.end };
            const samples = singVibrato(part, a, b, spec.rate, s, seed++);
            row.sections++;
            const ra = cur.scoreAttempt(ctx, samples, opts);
            if (attemptPasses(level, spec.step, ra)) row.after++;
            else if (row.failedAfter.length < 8) row.failedAfter.push(`${p.id} ${part.name} ${sec.label}`);
            if (base && attemptPasses(level, spec.step, base(ctx, samples, opts))) row.before++;
          }
        }
      }
      if (!base) row.before = NaN;
      rows.push(row);
    }
  }
  return { baseRef: base ? VIB_BASE_REF : null, rows };
}

export const VIB_SINGERS: VibSinger[] = [
  { name: 'vibrato ±60¢', vibCents: 60 },
  { name: 'vibrato ±70¢', vibCents: 70 },
  { name: 'vibrato ±80¢', vibCents: 80 },
  { name: 'vibrato ±80¢ at 4.5 Hz', vibCents: 80, vibHz: 4.5 },
  { name: 'vibrato ±80¢ at 6.5 Hz', vibCents: 80, vibHz: 6.5 },
  { name: 'vibrato ±80¢ from the note start', vibCents: 80, vibDelay: 0 },
  { name: 'vibrato ±110¢', vibCents: 110 },
  { name: 'vibrato ±150¢', vibCents: 150 },
];

/** Singers who must keep failing (each with a ±40¢ vibrato). */
export const VIB_WRONG: VibSinger[] = [
  { name: 'every 4th note a semitone off', vibCents: 40, offset: (k) => (k % 4 === 2 ? 100 : 0) },
  { name: 'one note a semitone flat (the 3rd)', vibCents: 40, offset: (k, first) => (k === first + 2 ? -100 : 0) },
  { name: 'all a semitone flat', vibCents: 40, offset: () => -100 },
  { name: 'an octave down', vibCents: 40, offset: () => -1200 },
];

// ---------------------------------------------------------------------------------------------
// The same through the whole pipeline: rendered audio (singer.ts, on "doo"), the offline tracker,
// the app's end of run (calibrated 150 ms). Before = scoring.ts / align.ts / pitch.ts at VIB_BASE_REF.

export interface VibAudioRow {
  singer: string; level: number; sections: number; before: number; after: number; failedAfter: string[]; failedBefore: string[];
  /** The notes that failed level 1 after: section, note, written MIDI, grade, cents, share of body readings in tune / an octave up / an octave down. */
  wrongAfter: string[];
}

/** Every vocal part × section of the library (or every `stride`-th), sung with a centred vibrato of ±`cents` at level `level`. */
export async function vibratoAudio(centsList: number[], o: { level?: number; stride?: number; offset?: number; wrong?: Partial<SingerProfile> & { name: string }; only?: string[]; debug?: (label: string, out: ReturnType<typeof runSession>, take: ReturnType<typeof renderSinger>) => void } = {}): Promise<VibAudioRow[]> {
  const level = o.level ?? 1;
  let before: PipelineSpec | null = null;
  try {
    const b = await gitVariant(VIB_BASE_REF);
    before = { ...AFTER, impl: b.impl, pitch: b.pitch, pitchKey: b.key };
  } catch { before = null; }
  const ids = (JSON.parse(readFileSync(resolve(REPO_ROOT, 'library/index.json'), 'utf8')) as { id: string }[]).map((m) => m.id);
  const pieces = [];
  for (const id of ['warmup-chorale', ...ids]) {
    try { pieces.push(await loadPiece(id)); } catch { /* not loadable here */ }
  }
  const L = levelSetup(level);
  const rows: VibAudioRow[] = [];
  for (const cents of centsList) {
    const base = o.wrong ?? SINGERS.goodChoir;
    const singer = onDoo({ ...SINGERS.goodChoir, ...base, name: o.wrong ? `${o.wrong.name}, vibrato ±${cents}¢` : `vibrato ±${cents}¢`, vibrato: { extentCents: [cents, cents], rateHz: [5.3, 5.7], delayMs: [100, 300], rampMs: 150, wander: 0.1 } });
    const row: VibAudioRow = { singer: singer.name, level, sections: 0, before: 0, after: 0, failedAfter: [], failedBefore: [], wrongAfter: [] };
    let k = 0;
    for (const p of pieces) {
      for (const part of p.score.parts.filter((x) => x.notes.length && x.voiceType !== 'other')) {
        for (const sec of p.sections) {
          const range = noteRangeFor(part, sec.start, sec.end);
          if (!range) continue;
          if (k++ % (o.stride ?? 1) !== (o.offset ?? 0)) continue;
          if (o.only && !o.only.includes(`${p.id} ${part.name} ${sec.label}`)) continue;
          const take = renderSinger({
            score: p.score, part, range, from: sec.start, to: sec.end, rate: L.rate, trueLatencyMs: 150, assumedLatencyMs: 450, guide: L.guide,
            profile: singer, channel: CHANNELS.phoneHeadphones,
            performanceSeed: hashSeed('vib-perf', k, p.id, part.id), microSeed: hashSeed('vib-micro', k, p.id, part.id),
          });
          const setup = { take, part, ctx: { score: p.score, part, range, end: sec.end }, from: sec.start, to: sec.end, level, microSeed: k };
          row.sections++;
          const label = `${p.id} ${part.name} ${sec.label}`;
          const oa = runSession(AFTER, setup, measured(150));
          o.debug?.(label, oa, take);
          if (oa.passed) row.after++;
          else {
            if (row.failedAfter.length < 8) row.failedAfter.push(label);
            for (const n of oa.result.notes.filter((x) => noteVerdict(x) === 'wrong')) {
              const sn = part.notes[n.index];
              const body = oa.samples.filter((x) => x.midi != null && x.time >= sn.start + 0.08 && x.time < sn.start + sn.dur - 0.04).map((x) => 100 * (x.midi! - sn.midi));
              const sh = (f: (d: number) => boolean) => (body.length ? Math.round((100 * body.filter(f).length) / body.length) : 0);
              row.wrongAfter.push(`${label} #${n.index} m${sn.midi} ${n.grade} ${n.cents == null ? '–' : Math.round(n.cents)}¢ in ${sh((d) => Math.abs(d) <= 50)}% up ${sh((d) => Math.abs(d - 1200) <= 50)}% down ${sh((d) => Math.abs(d + 1200) <= 50)}% n${body.length}${n.unsure ? ' ' + n.unsure : ''}`);
            }
          }
          if (before) {
            if (runSession(before, setup, measured(150)).passed) row.before++;
            else if (row.failedBefore.length < 8) row.failedBefore.push(label);
          }
        }
      }
    }
    if (!before) row.before = NaN;
    rows.push(row);
  }
  return rows;
}
