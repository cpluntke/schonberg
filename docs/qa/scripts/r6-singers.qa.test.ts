// QA round 6: adversarial "good singer" styles at L1–L3 (+L4 for reference), all six bundled pieces.
// Unlike r5-singers, this singer RESTS during written rests (r5's model holds through rests,
// which is why r5 shows 'early-entries' in 39 runs for every singer: a probe artifact).
// Styles: consonant-led, legato melisma (no consonants), very slow (score ×2.5), staccato,
// portamento (slides from the previous pitch into every note), wide operatic vibrato, steady early.
// Also: crash probes with degenerate sample streams.
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

interface Style {
  cons: [number, number]; // ms (real time) unvoiced consonant at each syllable start
  jitter: [number, number]; // |ms| random sign
  bias?: number; // ms constant offset (negative = early)
  lag: number; // ms detection lag (real time)
  vib?: number; // cents
  vibHz?: number;
  staccato?: number; // fraction of the written duration actually sung (min 0.12 s)
  porta?: number; // ms slide from the previous pitch (legato notes only)
  noCons?: boolean;
}

function sing(part: Part, a: number, z: number, from: number, to: number, st: Style, seed: number, rate: number): PitchSample[] {
  const R = rng(seed);
  const notes = part.notes.slice(a, z + 1);
  const ms = (x: number) => (x / 1000) * rate; // real ms -> score seconds (at reduced tempo real time runs slower)
  const real = notes.map((n, i) => {
    const sign = R() < 0.5 ? -1 : 1;
    const j = sign * (st.jitter[0] + R() * (st.jitter[1] - st.jitter[0]));
    const s = n.start + ms(j + (st.bias ?? 0));
    const prev = i > 0 ? notes[i - 1] : null;
    const legato = !!prev && prev.start + prev.dur >= n.start - 1e-6;
    const newSyl = !legato || !!n.lyric;
    const cons = st.noCons || !newSyl ? 0 : ms(st.cons[0] + R() * (st.cons[1] - st.cons[0]));
    return { n, s, e: 0, cons, legato, prevMidi: prev && legato ? prev.midi : null, cents: (R() * 2 - 1) * 6, vhz: 4.5 + 2 * R(), vph: R() * 6.28 };
  });
  for (let i = 0; i < real.length; i++) {
    const r = real[i];
    const next = real[i + 1];
    const writtenEnd = r.n.start + r.n.dur + ms(st.bias ?? 0);
    // Legato into the next note: sing until it starts; before a rest: release ~40 ms before the rest.
    r.e = next && next.legato ? next.s : writtenEnd - ms(40);
    if (st.staccato) r.e = Math.min(r.e, r.s + Math.max(0.12, st.staccato * r.n.dur));
  }
  const out: PitchSample[] = [];
  const phase = R() * 6.28;
  const vib = st.vib ?? 50, vhz = st.vibHz ?? 5.5;
  for (let t = from - 0.4; t < to + 0.5; t += 0.02) {
    const ts = t + (R() * 2 - 1) * 0.002;
    const u = ts - ms(st.lag);
    const r = real.find((x) => u >= x.s && u < x.e);
    let midi: number | null = null;
    if (r && u >= r.s + r.cons) {
      const into = u - r.s - r.cons;
      const wob = vhz < 0 ? Math.sin((2 * Math.PI * r.vhz * (u - r.s)) / rate + r.vph) : Math.sin((2 * Math.PI * vhz * u) / rate + phase);
      let m = r.n.midi + (r.cents + vib * wob) / 100;
      if (st.porta && r.prevMidi !== null && into < ms(st.porta)) {
        const f = into / ms(st.porta);
        m = r.prevMidi + (m - r.prevMidi) * f;
      }
      midi = m;
    }
    out.push({ time: ts, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.003 : 0.1 });
  }
  return out;
}

async function load(file: string, stretch = 1): Promise<Score> {
  const b = readFileSync(process.cwd() + '/public/pieces/' + file);
  const s = await importScoreFile(file, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (stretch === 1) return s;
  for (const p of s.parts) {
    for (const n of p.notes) { n.start *= stretch; n.dur *= stretch; }
    for (const d of p.directions ?? []) d.time *= stretch;
  }
  for (const m of s.measures) { m.start *= stretch; m.dur *= stretch; }
  for (const k of s.keys) k.time *= stretch;
  for (const t of s.tempos) { t.time *= stretch; t.bpm /= stretch; }
  s.duration *= stretch;
  return s;
}

const FILES = ['warmup-chorale.musicxml', 'pd/debussy-dieu.mxl', 'pd/debussy-yver.mxl', 'pd/brahms-schaffe.mxl', 'pd/bruckner-locus-iste.mxl', 'pd/ravel-nicolette.mxl'];
const BAD_FOR_GOOD = ['behind-beat', 'scooping', 'flat-overall', 'sharp-overall', 'wrong-notes', 'late-entries', 'early-entries', 'quiet', 'leaps', 'missed-notes'];

type Row = { file: string; part: string; sec: string; acc: number; kinds: string[]; level: number };

async function matrix(name: string, st: Style, level: number, stretch = 1, seeds = [1, 2]): Promise<Row[]> {
  const spec = levelSpec(level);
  const rate = spec.rate;
  const opts = { toleranceCents: effectiveTolerance(level, 'standard'), tuning: 'equal' as const, octaveTolerant: false };
  const rows: Row[] = [];
  for (const f of FILES) {
    const score = await load(f, stretch);
    for (const sec of computeSections(score)) {
      for (const part of score.parts) {
        const idx = part.notes.map((n, i) => [n, i] as const).filter(([n]) => n.start >= sec.start - 1e-6 && n.start < sec.end - 1e-6).map(([, i]) => i);
        if (idx.length < 4) continue;
        for (const seed of seeds) {
          const a = idx[0], z = idx[idx.length - 1];
          const s = sing(part, a, z, sec.start, sec.end, st, seed * 7919 + a, rate);
          const r: AttemptResult = scoreAttempt({ score, part, range: [a, z] }, s, opts);
          expect(Number.isFinite(r.accuracy)).toBe(true);
          rows.push({ file: f, part: part.name, sec: sec.label, acc: r.accuracy, kinds: r.insights.map((i) => i.kind), level });
        }
      }
    }
  }
  const n = rows.length;
  const pass = rows.filter((r) => r.acc >= spec.pass).length;
  const kc: Record<string, number> = {};
  for (const r of rows) for (const k of r.kinds) kc[k] = (kc[k] ?? 0) + 1;
  const accs = rows.map((r) => r.acc).sort((p, q) => p - q);
  const wrong = rows.filter((r) => r.kinds.some((k) => BAD_FOR_GOOD.includes(k))).length;
  console.log(`## ${name} L${level}${stretch !== 1 ? ` ×${stretch}` : ''}: pass ${pass}/${n}, acc min ${(accs[0] * 100).toFixed(0)} med ${(accs[n >> 1] * 100).toFixed(0)}, runs with a fault-note ${wrong}, insights ${JSON.stringify(kc)}`);
  for (const r of rows.filter((r) => r.acc < spec.pass).slice(0, 4)) console.log('   FAIL', r.file, r.part, r.sec, (r.acc * 100).toFixed(0), r.kinds.join(','));
  for (const r of rows.filter((r) => r.acc >= spec.pass && r.kinds.some((k) => BAD_FOR_GOOD.includes(k))).slice(0, 3)) console.log('   NOTE', r.file, r.part, r.sec, (r.acc * 100).toFixed(0), r.kinds.join(','));
  for (const r of rows) if (r.kinds.includes('great')) expect(r.acc).toBeGreaterThanOrEqual(spec.pass);
  return rows;
}

const good: Style = { cons: [60, 80], jitter: [20, 50], lag: Number(process.env.R6_LAG ?? 50) };
const STYLES: [string, Style, number?][] = [
  ['consonant-led', good],
  ['legato no consonants', { ...good, noCons: true, jitter: [0, 30] }],
  ['very slow (score ×2.5)', good, 2.5],
  ['staccato 45%', { ...good, staccato: 0.45 }],
  ['portamento 150 ms every note', { ...good, porta: 150, noCons: true }],
  ['portamento 250 ms every note', { ...good, porta: 250, noCons: true }],
  ['operatic vibrato ±90c 5 Hz', { ...good, vib: 90, vibHz: 5 }],
  ['steady early −60 ms', { ...good, bias: -60, jitter: [0, 20] }],
];

const ONLY = process.env.R6_ONLY;
const EXTRA: [string, Style, number?][] = [
  ['plosive consonants 30-50 ms', { ...good, cons: [30, 50] }],
  ['vibrato ±90c, rate wandering 4.5-6.5 Hz', { ...good, vib: 90, vibHz: -1 }],
  ['vibrato ±60c, rate wandering', { ...good, vib: 60, vibHz: -1 }],
];
for (const [name, st, stretch] of ONLY ? EXTRA : STYLES) {
  it(`R6 ${name} at L1–L3`, async () => {
    for (const L of [1, 2, 3]) await matrix(name, st, L, stretch ?? 1);
    await matrix(name, st, 4, stretch ?? 1, [1]);
  });
}

it('R6 degenerate sample streams do not crash', async () => {
  const score = await load('warmup-chorale.musicxml');
  const part = score.parts[0];
  const ctx = { score, part, range: [0, part.notes.length - 1] as [number, number] };
  const opts = { toleranceCents: 50, tuning: 'equal' as const, octaveTolerant: false };
  const end = part.notes[part.notes.length - 1].start + 2;
  const streams: Record<string, PitchSample[]> = {
    empty: [],
    single: [{ time: 1, midi: 60, clarity: 0.9, rms: 0.1 }],
    allNull: Array.from({ length: 500 }, (_, i) => ({ time: i * 0.02, midi: null, clarity: 0, rms: 0 })),
    nan: Array.from({ length: 500 }, (_, i) => ({ time: i * 0.02, midi: NaN, clarity: NaN, rms: NaN })),
    inf: Array.from({ length: 500 }, (_, i) => ({ time: i * 0.02, midi: Infinity, clarity: 1, rms: 1 })),
    dupTimes: Array.from({ length: 500 }, () => ({ time: 3, midi: 64, clarity: 1, rms: 1 })),
    negative: Array.from({ length: 200 }, (_, i) => ({ time: -10 + i * 0.02, midi: 60, clarity: 1, rms: 1 })),
    past: Array.from({ length: 200 }, (_, i) => ({ time: end + 100 + i * 0.02, midi: 60, clarity: 1, rms: 1 })),
    shuffled: Array.from({ length: 1000 }, (_, i) => ({ time: ((i * 7919) % 1000) * 0.03, midi: 55 + ((i * 13) % 20), clarity: 1, rms: 1 })),
  };
  for (const [k, s] of Object.entries(streams)) {
    const r = scoreAttempt(ctx, s, opts);
    console.log(`degenerate ${k}: acc ${r.accuracy} insights ${r.insights.map((i) => i.kind).join(',')}`);
    expect(Number.isFinite(r.accuracy)).toBe(true);
    for (const i of r.insights) expect(i.detail).not.toMatch(/NaN|undefined|Infinity/);
  }
});
