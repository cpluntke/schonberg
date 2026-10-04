// QA round 4: auto-learned headphone delay, judged against the HEAD rule in src/ui/screens/Play.tsx onDone
// (copied verbatim below as learnHead), per real section, with realistic singers.
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r4-latency --silent=false
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { scoreAttempt } from '../../../src/game/scoring';
import { importScoreFile } from '../../../src/music/import';
import { computeSections } from '../../../src/music/sections';
import { effectiveTolerance } from '../../../src/progress/ladder';
import type { AttemptResult, PitchSample } from '../../../src/game/types';
import type { Part, Score } from '../../../src/music/types';

const ROOT = process.cwd() + '/public/pieces/';
async function load(file: string): Promise<Score> {
  const b = readFileSync(ROOT + file);
  return importScoreFile(file, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
function sing(part: Part, a: number, b: number, from: number, to: number, rate: number,
  o: { vib?: number; lagMs?: number; latMs?: number; drop?: number; cons?: number; jitterMs?: number }): PitchSample[] {
  seed = 7;
  const out: PitchSample[] = [];
  const notes = part.notes;
  const jit = notes.map(() => (rnd() - 0.5) * 2 * (o.jitterMs ?? 0));
  let k = a;
  for (let tr = -0.3; tr < (to - from) / rate + 0.4; tr += 0.02) {
    const heard = from + tr * rate;
    const stamp = from + (tr + (o.latMs ?? 0) / 1000) * rate;
    while (k < b && notes[k].start + notes[k].dur <= heard - ((o.lagMs ?? 0) / 1000) * rate) k++;
    const n = notes[k];
    let midi: number | null = null;
    const into = (heard - n.start) / rate - (o.lagMs ?? 0) / 1000 - jit[k] / 1000;
    if (into >= (o.cons ?? 0) / 1000 && into < n.dur / rate - 0.03) {
      midi = n.midi + ((o.vib ?? 0) * Math.sin(2 * Math.PI * 5.5 * tr + k)) / 100;
    }
    if (midi != null && rnd() < (o.drop ?? 0)) midi = null;
    out.push({ time: stamp, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.003 : 0.1 });
  }
  return out;
}

/** Verbatim copy of the HEAD (9b13580) decision in Play.tsx onDone. Returns the learned latency or null. */
function learnHead(r: AttemptResult, part: Part, rate: number, sessLatency: number): { learned: number | null; n: number; med: number | null; iqr: number | null; useAll: boolean } {
  const entryOnsets = r.notes
    .filter((n) => {
      const i = n.index;
      const prev = i > 0 ? part.notes[i - 1] : null;
      return n.onsetMs != null && (!prev || part.notes[i].start - (prev.start + prev.dur) >= 0.4);
    })
    .map((n) => n.onsetMs!)
    .sort((a, b) => a - b) as number[];
  const allOnsets = r.notes.filter((n) => n.onsetMs != null).map((n) => n.onsetMs!).sort((a, b) => a - b);
  const useAll = entryOnsets.length < 2 && allOnsets.length >= 6;
  if (useAll) entryOnsets.splice(0, entryOnsets.length, ...allOnsets);
  if (entryOnsets.length >= 2) {
    const med = entryOnsets[Math.floor(entryOnsets.length / 2)];
    const iqr = entryOnsets[Math.floor(entryOnsets.length * 0.75)] - entryOnsets[Math.floor(entryOnsets.length * 0.25)];
    if (med / rate > 150 && iqr / rate < 120) {
      return { learned: Math.round(Math.min(400, sessLatency + (med / rate - 40))), n: entryOnsets.length, med, iqr, useAll };
    }
    return { learned: null, n: entryOnsets.length, med, iqr, useAll };
  }
  return { learned: null, n: entryOnsets.length, med: null, iqr: null, useAll };
}

const SCEN: [string, number, { vib?: number; lagMs?: number; latMs?: number; drop?: number; cons?: number; jitterMs?: number }][] = [
  ['L1 70% BT 250 (est 80)', 0.7, { latMs: 170, vib: 30, cons: 40, jitterMs: 30 }],
  ['L2 BT 250 (est 80)', 1.0, { latMs: 170, vib: 30, cons: 40, jitterMs: 30 }],
  ['L2 BT 350 (est 80)', 1.0, { latMs: 270, vib: 30, cons: 40, jitterMs: 30 }],
  ['L2 wired ok, singer on time (cons 60, jitter 40)', 1.0, { latMs: 0, vib: 40, cons: 60, jitterMs: 40 }],
  ['L1 70% wired ok, singer on time (cons 80, jitter 60)', 0.7, { latMs: 0, vib: 40, cons: 80, jitterMs: 60 }],
  ['L2 wired ok, singer 200 ms late (consistent)', 1.0, { latMs: 0, lagMs: 200, vib: 30, jitterMs: 30 }],
  ['L2 wired ok, singer 200 ms late (jitter ±100)', 1.0, { latMs: 0, lagMs: 200, vib: 30, jitterMs: 100 }],
];

describe('R4 latency learning (HEAD rule)', () => {
  it('per section, warm-up + Debussy + Bruckner', async () => {
    for (const f of ['warmup-chorale.musicxml', 'pd/debussy-dieu.mxl', 'pd/bruckner-locus-iste.mxl']) {
      const score = await load(f);
      const secs = computeSections(score);
      const part = score.parts[1];
      for (const [label, rate, o] of SCEN) {
        const rows: string[] = [];
        for (const sec of secs) {
          const idx = part.notes.map((n, i) => [n, i] as const).filter(([n]) => n.start >= sec.start - 1e-6 && n.start < sec.end - 1e-6).map(([, i]) => i);
          if (!idx.length) continue;
          const a = idx[0], b = idx[idx.length - 1];
          const tol = effectiveTolerance(rate < 1 ? 1 : 2, 'standard');
          const r = scoreAttempt({ score, part, range: [a, b] }, sing(part, a, b, sec.start, sec.end, rate, o), { toleranceCents: tol, tuning: 'equal', octaveTolerant: false });
          const L = learnHead(r, part, rate, 80);
          rows.push(`${sec.label}: n=${L.n}${L.useAll ? '(all)' : ''} med=${L.med == null ? '-' : Math.round(L.med)} iqr=${L.iqr == null ? '-' : Math.round(L.iqr)} learned=${L.learned ?? '-'} rhythm=${Math.round(r.rhythm * 100)}`);
        }
        console.log('R4-latency', f, part.name, '|', label, '\n   ', rows.join('\n    '));
      }
    }
  });
});
