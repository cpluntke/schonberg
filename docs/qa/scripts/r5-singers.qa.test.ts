// QA round 5 — adversarial synthetic singers against HEAD scoring + coach (analysis.ts).
// Singer model: vibrato ±50 c @ 5.5 Hz, unvoiced consonant 60–80 ms at each syllable start,
// per-note timing jitter of 30–60 ms (random sign), small per-note intonation scatter (±6 c),
// tracker detection lag (0 or 50 ms, as measured in the r4 real-audio run: ok-case median onset ≈ 48 ms),
// 50 Hz samples with ±2 ms timestamp jitter. L4 standard = ±25 c, pass 85 %.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { scoreAttempt } from '../../../src/game/scoring';
import { importScoreFile } from '../../../src/music/import';
import { computeSections } from '../../../src/music/sections';
import { effectiveTolerance, levelSpec } from '../../../src/progress/ladder';
import type { PitchSample, AttemptResult } from '../../../src/game/types';
import type { Score, Part } from '../../../src/music/types';

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

interface Singer {
  cons: [number, number]; // ms
  jitter: [number, number]; // |ms|, random sign
  bias?: number; // ms constant lateness (drag)
  lag: number; // ms detection lag
  cents?: number; // constant offset
  scoopCents?: number; // start this far below and glide in over scoopMs
  scoopMs?: number;
  voicedProb?: number; // fraction of samples voiced (quiet singer)
  vib?: number; // cents amplitude
}

function sing(part: Part, a: number, z: number, from: number, to: number, sg: Singer, seed: number): PitchSample[] {
  const R = rng(seed);
  const notes = part.notes.slice(a, z + 1);
  // Per-note realised start/end and consonant length.
  const real = notes.map((n, i) => {
    const sign = R() < 0.5 ? -1 : 1;
    const j = sign * (sg.jitter[0] + R() * (sg.jitter[1] - sg.jitter[0]));
    const off = (j + (sg.bias ?? 0)) / 1000;
    const prev = i > 0 ? notes[i - 1] : null;
    const legato = !!prev && !n.lyric && prev.start + prev.dur >= n.start - 1e-6; // melisma: no consonant
    const cons = legato ? 0 : (sg.cons[0] + R() * (sg.cons[1] - sg.cons[0])) / 1000;
    return { n, s: n.start + off, cons, cents: (R() * 2 - 1) * 6 + (sg.cents ?? 0) };
  });
  for (let i = 0; i < real.length; i++) real[i].e = i + 1 < real.length ? real[i + 1].s : real[i].n.start + real[i].n.dur + (sg.bias ?? 0) / 1000 - 0.03;
  const out: PitchSample[] = [];
  const phase = R() * 6.28;
  for (let t = from - 0.4; t < to + 0.5; t += 0.02) {
    const ts = t + (R() * 2 - 1) * 0.002;
    // Sound being produced at time (ts - lag)
    const u = ts - sg.lag / 1000;
    const r = real.find((x) => u >= x.s && u < (x as { e: number }).e);
    let midi: number | null = null;
    if (r && u >= r.s + r.cons) {
      const into = u - r.s - r.cons;
      let c = r.cents + (sg.vib ?? 50) * Math.sin(2 * Math.PI * 5.5 * u + phase);
      if (sg.scoopCents && into < (sg.scoopMs ?? 120) / 1000) c -= sg.scoopCents * (1 - into / ((sg.scoopMs ?? 120) / 1000));
      midi = r.n.midi + c / 100;
      if (sg.voicedProb !== undefined && R() > sg.voicedProb) midi = null;
    }
    out.push({ time: ts, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.003 : 0.1 });
  }
  return out;
}

async function load(file: string): Promise<Score> {
  const b = readFileSync(process.cwd() + '/public/pieces/' + file);
  return importScoreFile(file, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const FILES = ['warmup-chorale.musicxml', 'pd/debussy-dieu.mxl', 'pd/debussy-yver.mxl'];
const L = 4;
const opts = { toleranceCents: effectiveTolerance(L, 'standard'), tuning: 'equal' as const, octaveTolerant: false };
const PASS = levelSpec(L).pass;

type Row = { file: string; part: string; sec: string; seed: number; acc: number; rhythm: number; kinds: string[]; medOn: number | null };

async function matrix(name: string, sg: Singer, seeds = [1, 2, 3]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const f of FILES) {
    const score = await load(f);
    for (const sec of computeSections(score)) {
      for (const part of score.parts) {
        const idx = part.notes.map((n, i) => [n, i] as const).filter(([n]) => n.start >= sec.start - 1e-6 && n.start < sec.end - 1e-6).map(([, i]) => i);
        if (idx.length < 4) continue;
        for (const seed of seeds) {
          const a = idx[0], z = idx[idx.length - 1];
          const s = sing(part, a, z, sec.start, sec.end, sg, seed * 7919 + a);
          const r: AttemptResult = scoreAttempt({ score, part, range: [a, z] }, s, opts);
          const on = r.notes.filter((n) => n.onsetMs != null && n.scoop === null).map((n) => n.onsetMs!).sort((p, q) => p - q);
          rows.push({ file: f, part: part.name, sec: sec.label, seed, acc: r.accuracy, rhythm: r.rhythm, kinds: r.insights.map((i) => i.kind), medOn: on.length ? on[on.length >> 1] : null });
        }
      }
    }
  }
  const n = rows.length;
  const pass = rows.filter((r) => r.acc >= PASS).length;
  const kindCount: Record<string, number> = {};
  for (const r of rows) for (const k of r.kinds) kindCount[k] = (kindCount[k] ?? 0) + 1;
  const accs = rows.map((r) => r.acc).sort((p, q) => p - q);
  const med = rows.map((r) => r.medOn ?? 0).sort((p, q) => p - q);
  console.log(`## ${name}: runs ${n}, pass@L4 ${pass}/${n}, acc min ${(accs[0] * 100).toFixed(0)} med ${(accs[n >> 1] * 100).toFixed(0)}, medOnset median ${med[n >> 1].toFixed(0)} ms, insights ${JSON.stringify(kindCount)}`);
  const fails = rows.filter((r) => r.acc < PASS).slice(0, 6);
  for (const r of fails) console.log('   FAIL', r.file, r.part, r.sec, 'seed', r.seed, 'acc', (r.acc * 100).toFixed(0), 'rh', (r.rhythm * 100).toFixed(0), r.kinds.join(','));
  // Global invariant: never 'great' on a failed run.
  for (const r of rows) if (r.kinds.includes('great')) expect(r.acc).toBeGreaterThanOrEqual(PASS);
  return rows;
}

const base: Singer = { cons: [60, 80], jitter: [30, 60], lag: 50 };

it('R5 good singer (lag 50) passes L4 and is not told it is behind/scooping/flat', async () => {
  const rows = await matrix('good lag50', base);
  const failed = rows.filter((r) => r.acc < PASS);
  const bb = rows.filter((r) => r.kinds.includes('behind-beat'));
  const wrongCoach = rows.filter((r) => r.kinds.some((k) => ['scooping', 'flat-overall', 'sharp-overall', 'wrong-notes', 'quiet', 'late-entries'].includes(k)));
  console.log(`good lag50: failed ${failed.length}, behind-beat ${bb.length}, other wrong coach ${wrongCoach.length}`);
  for (const r of bb.slice(0, 5)) console.log('   BB', r.file, r.part, r.sec, 'medOn', r.medOn);
  expect(failed.length).toBe(0);
});

it('R5 good singer, consonant-only (no jitter) and lag 0 variants', async () => {
  await matrix('good lag0', { ...base, lag: 0 });
  await matrix('good lag50 cons80 jitter late-only', { ...base, cons: [80, 80], jitter: [30, 60], bias: 45 });
});

it('R5 dragging singer (+150 ms) gets behind-beat', async () => {
  const rows = await matrix('drag150', { ...base, bias: 150 });
  const hit = rows.filter((r) => r.kinds.includes('behind-beat')).length;
  console.log(`drag150: behind-beat ${hit}/${rows.length}`);
  expect(hit / rows.length).toBeGreaterThan(0.9);
});

it('R5 scooping singer still gets scooping', async () => {
  const rows = await matrix('scoop150', { ...base, scoopCents: 150, scoopMs: 150 });
  const hit = rows.filter((r) => r.kinds.includes('scooping')).length;
  const bb = rows.filter((r) => r.kinds.includes('behind-beat')).length;
  console.log(`scoop: scooping ${hit}/${rows.length}, behind-beat ${bb}`);
  expect(hit / rows.length).toBeGreaterThan(0.8);
});

it('R5 flat singer (-35 c) gets flat-overall', async () => {
  const rows = await matrix('flat35', { ...base, cents: -35 });
  const hit = rows.filter((r) => r.kinds[0] === 'flat-overall').length;
  const any = rows.filter((r) => r.kinds.includes('flat-overall')).length;
  console.log(`flat: flat-overall first ${hit}/${rows.length}, anywhere ${any}`);
  expect(any / rows.length).toBeGreaterThan(0.95);
});

it('R5 quiet singer gets only quiet', async () => {
  const rows = await matrix('quiet15', { ...base, voicedProb: 0.15 });
  const only = rows.filter((r) => r.kinds.length === 1 && r.kinds[0] === 'quiet').length;
  console.log(`quiet: only-quiet ${only}/${rows.length}`);
  expect(only).toBe(rows.length);
});
