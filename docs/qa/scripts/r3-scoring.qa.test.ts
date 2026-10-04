// QA round 3: probes for the scoring changes in 232b934 (sustained onset run, octave-folded
// legato, short-note median, JI cents vs pure) and the auto-learned latency heuristic in Play.tsx.
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r3-scoring --silent=false
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { makePart, makeScore, sampleSinging } from '../../../src/game/testutil';
import { scoreAttempt } from '../../../src/game/scoring';
import { importScoreFile } from '../../../src/music/import';
import { computeSections } from '../../../src/music/sections';
import { effectiveTolerance, LEVELS } from '../../../src/progress/ladder';
import type { PitchSample } from '../../../src/game/types';
import type { Part, Score } from '../../../src/music/types';

const ROOT = process.cwd() + '/public/pieces/';
async function load(file: string): Promise<Score> {
  const b = readFileSync(ROOT + file);
  return importScoreFile(file, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const base = { toleranceCents: 35, tuning: 'equal' as const, octaveTolerant: false };
const pct = (x: number) => Math.round(x * 100);

let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** Real-time singer: vibrato, lag (real ms), uncompensated latency (real ms), dropout, rate. */
function sing(part: Part, a: number, b: number, from: number, to: number, rate: number,
  o: { vib?: number; lagMs?: number; latMs?: number; drop?: number; cents?: number; octave?: number; cons?: number }): PitchSample[] {
  seed = 3;
  const out: PitchSample[] = [];
  const notes = part.notes;
  let k = a;
  for (let tr = -0.3; tr < (to - from) / rate + 0.4; tr += 0.02) {
    const heard = from + tr * rate;
    const stamp = from + (tr + (o.latMs ?? 0) / 1000) * rate;
    while (k < b && notes[k].start + notes[k].dur <= heard - ((o.lagMs ?? 0) / 1000) * rate) k++;
    const n = notes[k];
    let midi: number | null = null;
    const into = (heard - n.start) / rate - (o.lagMs ?? 0) / 1000;
    if (into >= (o.cons ?? 0) / 1000 && into < n.dur / rate - 0.03) {
      midi = n.midi + (o.octave ?? 0) + ((o.cents ?? 0) + (o.vib ?? 0) * Math.sin(2 * Math.PI * 5.5 * tr + k)) / 100;
    }
    if (midi != null && rnd() < (o.drop ?? 0)) midi = null;
    out.push({ time: stamp, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.003 : 0.1 });
  }
  return out;
}

describe('R3 scoring probes', () => {
  it('repeated notes + wide vibrato: does the 60 ms in-tolerance run still find onsets?', () => {
    // 8 repeated quarter notes on G4 at 90 bpm (legato, no gaps) – common in chorales
    const spec: [number, number][] = Array.from({ length: 8 }, () => [67, 1] as [number, number]);
    const part = makePart('S', spec, 90);
    const score = makeScore([part], 90);
    const ctx = { score, part, range: [0, 7] as [number, number] };
    for (const vib of [0, 25, 40, 60]) {
      for (const L of [2, 4]) {
        const tol = effectiveTolerance(L, 'standard');
        const r = scoreAttempt(ctx, sampleSinging(part, (n, t) => n.midi + (vib * Math.sin(2 * Math.PI * 5.5 * t)) / 100), { ...base, toleranceCents: tol });
        console.log('R3-repeat-vib', JSON.stringify({ vib, L, tol, acc: pct(r.accuracy), rhythm: pct(r.rhythm), onsets: r.notes.map((n) => n.onsetMs == null ? null : Math.round(n.onsetMs)), insights: r.insights.map((i) => i.kind) }));
      }
    }
  });

  it('dropouts break the onset run (5% / 15% per-frame dropout)', () => {
    const part = makePart('S', [[null, 1], [64, 1], [null, 1], [67, 1], [null, 1], [65, 1], [null, 1], [62, 1]], 90);
    const score = makeScore([part], 90);
    const ctx = { score, part, range: [0, 3] as [number, number] };
    for (const drop of [0, 0.05, 0.15, 0.3]) {
      seed = 11;
      const r = scoreAttempt(ctx, sampleSinging(part, (n) => (rnd() < drop ? null : n.midi)), base);
      console.log('R3-dropout-onset', JSON.stringify({ drop, rhythm: pct(r.rhythm), onsets: r.notes.map((n) => n.onsetMs == null ? null : Math.round(n.onsetMs)) }));
    }
  });

  it('JI mode: singer matching the (tempered) backing on real pieces – reported cents and insights', async () => {
    for (const f of ['warmup-chorale.musicxml', 'pd/bruckner-locus-iste.mxl', 'pd/debussy-dieu.mxl']) {
      const score = await load(f);
      for (const part of score.parts.slice(0, 4)) {
        const n = part.notes.length - 1;
        const r = scoreAttempt({ score, part, range: [0, n] }, sampleSinging(part, (x) => x.midi), { toleranceCents: 25, tuning: 'just', octaveTolerant: false });
        const c = r.notes.map((x) => x.cents).filter((x): x is number => x != null).sort((a, b) => a - b);
        const flagged = r.notes.filter((x) => x.cents != null && Math.abs(x.cents) > 12).length;
        console.log('R3-JI', f, part.name, JSON.stringify({ acc: pct(r.accuracy), medianCents: +c[c.length >> 1].toFixed(1), notesOver12c: `${flagged}/${r.notes.length}`, insights: r.insights.map((i) => i.kind) }));
      }
    }
  });

  it('auto-learned latency (Play.tsx onDone heuristic replicated): reduced tempo and a genuinely late singer', async () => {
    const score = await load('warmup-chorale.musicxml');
    const secs = computeSections(score);
    for (const part of score.parts.slice(0, 2)) {
      for (const [label, rate, latMs, lagMs] of [
        ['L2, 250 ms BT, est 80', 1.0, 170, 0],
        ['L1 (70%), 250 ms BT, est 80', 0.7, 170, 0],
        ['L1 (70%), 350 ms BT, est 80', 0.7, 270, 0],
        ['L2, wired headset (correct est), singer 200 ms late', 1.0, 0, 200],
      ] as [string, number, number, number][]) {
        const notes = part.notes;
        const from = 0, to = score.duration;
        const r = scoreAttempt({ score, part, range: [0, notes.length - 1] }, sing(part, 0, notes.length - 1, from, to, rate, { latMs, lagMs, vib: 20 }), { toleranceCents: 35, tuning: 'equal', octaveTolerant: false });
        const entry = r.notes.filter((n) => { const i = n.index; const p = i > 0 ? notes[i - 1] : null; return n.onsetMs != null && (!p || notes[i].start - (p.start + p.dur) >= 0.4); }).map((n) => n.onsetMs!).sort((a, b) => a - b);
        let learned: number | null = null;
        if (entry.length >= 4) {
          const med = entry[Math.floor(entry.length / 2)];
          const iqr = entry[Math.floor(entry.length * 0.75)] - entry[Math.floor(entry.length * 0.25)];
          if (med > 120 && iqr < 160) learned = Math.round(Math.min(500, 80 + (med - 40)));
        }
        console.log('R3-latency', part.name, label, JSON.stringify({ trueTotalMs: 80 + latMs, entries: entry.length, entryOnsetsMs: entry.map(Math.round), learnedMs: learned, acc: pct(r.accuracy), rhythm: pct(r.rhythm), sections: secs.length }));
      }
    }
  });

  it('partial finish: last fully-sung note vs latency (samples lag the playback position)', () => {
    // 4 notes of 0.3 s; singer stops (Finish) right after note 3 ends in playback; samples are latency-shifted
    const part = makePart('S', [[60, 0.5], [62, 0.5], [64, 0.5], [65, 0.5], [67, 0.5]], 100);
    const score = makeScore([part], 100);
    const pos = part.notes[2].start + part.notes[2].dur + 0.01; // playback position at Finish
    for (const lat of [0.08, 0.15, 0.25]) {
      const all = sampleSinging(part, (n) => n.midi);
      const samples = all.filter((s) => s.time <= pos - lat); // what has arrived (score time = ctx - latency)
      let last = -1;
      for (let i = 0; i < part.notes.length; i++) if (part.notes[i].start + part.notes[i].dur <= pos + 0.05) last = i;
      const r = scoreAttempt({ score, part, range: [0, last] }, samples, base);
      console.log('R3-partial', JSON.stringify({ latMs: lat * 1000, scoredNotes: last + 1, grades: r.notes.map((n) => n.grade), acc: pct(r.accuracy) }));
    }
  });

  it('octave-below singer on real pieces (HEAD octaveTolerant only for cross-register)', async () => {
    for (const f of ['warmup-chorale.musicxml', 'pd/debussy-dieu.mxl', 'pd/bruckner-locus-iste.mxl']) {
      const score = await load(f);
      const part = score.parts[0];
      const sec = computeSections(score)[0];
      const idx = part.notes.map((n, i) => [n, i] as const).filter(([n]) => n.start >= sec.start - 1e-6 && n.start < sec.end - 1e-6).map(([, i]) => i);
      const a = idx[0], b = idx[idx.length - 1];
      const row = LEVELS.map((L) => {
        const r = scoreAttempt({ score, part, range: [a, b] }, sing(part, a, b, sec.start, sec.end, L.rate, { octave: -12, vib: 40, lagMs: 40, cons: 50, drop: 0.05 }), { toleranceCents: effectiveTolerance(L.level, 'standard'), tuning: 'equal', octaveTolerant: true });
        return `L${L.level} ${pct(r.accuracy)}/${pct(r.rhythm)}`;
      });
      const inOct = LEVELS.map((L) => {
        const r = scoreAttempt({ score, part, range: [a, b] }, sing(part, a, b, sec.start, sec.end, L.rate, { vib: 40, lagMs: 40, cons: 50, drop: 0.05 }), { toleranceCents: effectiveTolerance(L.level, 'standard'), tuning: 'equal', octaveTolerant: false });
        return `L${L.level} ${pct(r.accuracy)}/${pct(r.rhythm)}`;
      });
      console.log('R3-octave', f, sec.label, 'octave-below acc/rhythm:', row.join(' '), '| in-octave:', inOct.join(' '));
    }
  });
});
