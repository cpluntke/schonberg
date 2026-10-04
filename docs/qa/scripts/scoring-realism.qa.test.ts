// QA round 1: scoring realism / timing chain simulations on the built-in pieces.
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs scoring-realism
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { importScoreFile } from '../../../src/music/import';
import { computeSections } from '../../../src/music/sections';
import { LiveScorer, scoreAttempt } from '../../../src/game/scoring';
import { effectiveTolerance, LEVELS } from '../../../src/progress/ladder';
import type { PitchSample } from '../../../src/game/types';
import type { Part, Score } from '../../../src/music/types';

const ROOT = process.cwd() + '/public/pieces/';
async function load(file: string): Promise<Score> {
  const b = readFileSync(ROOT + file);
  return importScoreFile(file, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / Math.sqrt(0.5); };

interface Singer {
  name: string;
  vibCents: number;          // vibrato half-depth
  offsetCents: number;       // constant offset
  perNoteSdCents: number;    // per-note intonation SD
  lagMs: number;             // onset reaction lag (real ms) – singer comes in late
  scoopCents: number;        // starts this many cents below and glides in over scoopMs
  scoopMs: number;
  consonantMs: number;       // unvoiced at start of each note (real ms)
  releaseMs: number;         // unvoiced at end of each note (breath/consonant)
  wrongNoteProb: number;     // prob. of a ±1 semitone wrong note
  octave: number;            // +-12 for octave displacement
  dropoutProb: number;       // per-frame detector dropout probability
  uncompLatencyMs: number;   // latency not compensated (uncalibrated device)
}
const base: Singer = { name: '', vibCents: 0, offsetCents: 0, perNoteSdCents: 0, lagMs: 0, scoopCents: 0, scoopMs: 0,
  consonantMs: 0, releaseMs: 0, wrongNoteProb: 0, octave: 0, dropoutProb: 0, uncompLatencyMs: 0 };
const SINGERS: Singer[] = [
  { ...base, name: 'ideal (vib±25)', vibCents: 25 },
  { ...base, name: 'pro: vib±50, +10c, sd8, lag40, scoop-60/80ms, cons50, rel40, drop5%', vibCents: 50, offsetCents: 10, perNoteSdCents: 8, lagMs: 40, scoopCents: 60, scoopMs: 80, consonantMs: 50, releaseMs: 40, dropoutProb: 0.05 },
  { ...base, name: 'pro, wide vib±60 / -10c', vibCents: 60, offsetCents: -10, perNoteSdCents: 8, lagMs: 40, scoopCents: 60, scoopMs: 80, consonantMs: 50, releaseMs: 40, dropoutProb: 0.05 },
  { ...base, name: 'pro, uncalibrated (+120ms latency)', vibCents: 50, offsetCents: 10, perNoteSdCents: 8, lagMs: 40, scoopCents: 60, scoopMs: 80, consonantMs: 50, releaseMs: 40, dropoutProb: 0.05, uncompLatencyMs: 120 },
  { ...base, name: 'pro, bluetooth uncalibrated (+250ms)', vibCents: 50, offsetCents: 10, perNoteSdCents: 8, lagMs: 40, scoopCents: 60, scoopMs: 80, consonantMs: 50, releaseMs: 40, dropoutProb: 0.05, uncompLatencyMs: 250 },
  { ...base, name: 'mediocre: vib±60, sd25, -20c, lag120, scoop-120/150ms, 8% wrong', vibCents: 60, offsetCents: -20, perNoteSdCents: 25, lagMs: 120, scoopCents: 120, scoopMs: 150, consonantMs: 70, releaseMs: 60, wrongNoteProb: 0.08, dropoutProb: 0.08 },
  { ...base, name: 'weak: sd40, -30c, lag180, 15% wrong', vibCents: 50, offsetCents: -30, perNoteSdCents: 40, lagMs: 180, scoopCents: 150, scoopMs: 200, consonantMs: 80, releaseMs: 60, wrongNoteProb: 0.15, dropoutProb: 0.1 },
  { ...base, name: 'pro, octave below (man on S part)', vibCents: 50, offsetCents: 10, perNoteSdCents: 8, lagMs: 40, scoopCents: 60, scoopMs: 80, consonantMs: 50, releaseMs: 40, dropoutProb: 0.05, octave: -12 },
];

/** Synthesise mic samples every 20 ms real time for notes[a..b] played from `from` at `rate`. */
function sing(part: Part, a: number, b: number, from: number, to: number, rate: number, sg: Singer, s0 = 7): PitchSample[] {
  seed = s0;
  const notes = part.notes;
  const perNote = notes.map(() => ({ dev: gauss() * sg.perNoteSdCents, wrong: rnd() < sg.wrongNoteProb ? (rnd() < 0.5 ? -1 : 1) : 0 }));
  const out: PitchSample[] = [];
  const realDur = (to - from) / rate + 0.5;
  let k = a;
  for (let tr = -0.5; tr < realDur; tr += 0.02) {
    const heard = from + tr * rate;                 // what the singer hears/sings now
    const stamp = from + (tr + sg.uncompLatencyMs / 1000) * rate; // what the app timestamps
    while (k < b && notes[k].start + notes[k].dur <= heard - (sg.lagMs / 1000) * rate) k++;
    const n = notes[k];
    let midi: number | null = null;
    if (n) {
      const intoReal = (heard - n.start) / rate - sg.lagMs / 1000;
      const durReal = n.dur / rate;
      if (intoReal >= sg.consonantMs / 1000 && intoReal < durReal - sg.releaseMs / 1000 && k >= a && k <= b) {
        const pn = perNote[k];
        let c = sg.offsetCents + pn.dev + pn.wrong * 100 + sg.vibCents * Math.sin(2 * Math.PI * 5.5 * tr + k);
        if (sg.scoopMs > 0 && intoReal < sg.scoopMs / 1000) c -= sg.scoopCents * (1 - intoReal / (sg.scoopMs / 1000));
        midi = n.midi + sg.octave + c / 100;
      }
    }
    if (midi != null && rnd() < sg.dropoutProb) midi = null;
    out.push({ time: stamp, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.003 : 0.1 });
  }
  return out;
}

function fmt(x: number) { return (x * 100).toFixed(0).padStart(4); }

const PIECES: [string, string, string | null][] = [
  ['bach-bwv512', 'pd/bach-bwv512.mxl', null],
  ['bruckner-locus-iste', 'pd/bruckner-locus-iste.mxl', null],
  ['debussy-yver', 'pd/debussy-yver.mxl', null],
  ['ravel-nicolette', 'pd/ravel-nicolette.mxl', null],
  ['warmup', 'warmup-chorale.musicxml', null],
];

test('scoring realism matrix', async () => {
  const lines: string[] = [];
  for (const [id, file] of PIECES) {
    const score = await load(file);
    for (const part of score.parts.filter((p) => p.notes.length > 10 && p.voiceType !== 'other').slice(0, 4)) {
      const notes = part.notes;
      // first section with notes
      const secs = computeSections(score);
      const sec = secs.find((s) => notes.some((n) => n.start >= s.start && n.start < s.end)) ?? { start: 0, end: score.duration };
      const idx = notes.map((n, i) => [n, i] as const).filter(([n]) => n.start >= sec.start - 1e-6 && n.start < sec.end - 1e-6).map(([, i]) => i);
      if (idx.length < 4) continue;
      const a = idx[0], b = idx[idx.length - 1];
      const shortest = Math.min(...idx.map((i) => notes[i].dur));
      const medDur = [...idx.map((i) => notes[i].dur)].sort((x, y) => x - y)[idx.length >> 1];
      lines.push(`\n## ${id} / ${part.name} (${part.voiceType}) notes ${a}-${b} (${idx.length}), shortest ${shortest.toFixed(3)}s, median ${medDur.toFixed(3)}s`);
      lines.push('singer'.padEnd(70) + '  L1(70%,50c) L2(35c) L3(30c) L4(25c)  | L4 strict(18c) forgiving(33c) | pass L1..L4 (std)');
      for (const sg of SINGERS) {
        if (sg.octave && part.voiceType !== 'S') continue;
        const row: string[] = [];
        const passes: string[] = [];
        for (const L of LEVELS) {
          const tol = effectiveTolerance(L.level, 'standard');
          const samples = sing(part, a, b, sec.start, sec.end, L.rate, sg);
          const r = scoreAttempt({ score, part, range: [a, b] }, samples, { toleranceCents: tol, tuning: 'equal', octaveTolerant: L.level <= 1 || sg.octave !== 0 });
          row.push(`${fmt(r.accuracy)}/${fmt(r.rhythm)}`);
          passes.push(r.accuracy >= L.pass ? 'P' : '-');
        }
        const extra: string[] = [];
        for (const st of ['strict', 'forgiving'] as const) {
          const samples = sing(part, a, b, sec.start, sec.end, 1, sg);
          const r = scoreAttempt({ score, part, range: [a, b] }, samples, { toleranceCents: effectiveTolerance(4, st), tuning: 'equal', octaveTolerant: sg.octave !== 0 });
          extra.push(fmt(r.accuracy));
        }
        lines.push(sg.name.padEnd(70) + '  ' + row.join(' ') + '  | ' + extra.join('   ') + '        | ' + passes.join(''));
      }
      // just intonation: pro singer singing ET while scored JI, and singing JI-ish
      {
        const sg = SINGERS[1];
        const samples = sing(part, a, b, sec.start, sec.end, 1, sg);
        const rJ = scoreAttempt({ score, part, range: [a, b] }, samples, { toleranceCents: 25, tuning: 'just', octaveTolerant: false });
        const rE = scoreAttempt({ score, part, range: [a, b] }, samples, { toleranceCents: 25, tuning: 'equal', octaveTolerant: false });
        const offs = rJ.notes.map((n) => Math.abs(n.targetOffset));
        lines.push(`JI: pro singing ET, L4 acc equal=${fmt(rE.accuracy)} just=${fmt(rJ.accuracy)}; |JI offset| mean ${(offs.reduce((s, x) => s + x, 0) / offs.length).toFixed(1)}c max ${Math.max(...offs).toFixed(1)}c`);
      }
    }
  }
  console.log(lines.join('\n'));
});

test('pause/resume: count-in samples after resume pollute already-sung notes', async () => {
  const score = await load('pd/bach-bwv512.mxl');
  const part = score.parts[0];
  const a = 0, b = Math.min(part.notes.length - 1, 30);
  const from = part.notes[a].start, to = part.notes[b].start + part.notes[b].dur;
  const sg = SINGERS[1];
  const clean = sing(part, a, b, from, to, 1, sg);
  const opts = { toleranceCents: 25, tuning: 'equal' as const, octaveTolerant: false };
  const r0 = scoreAttempt({ score, part, range: [a, b] }, clean, opts);
  // pause at mid, resume with a one-bar count-in (4 beats) that maps to score times before resumeFrom
  const resumeFrom = (from + to) / 2;
  const beat = 60 / (score.tempos[0]?.bpm ?? 90);
  const countIn: PitchSample[] = [];
  for (let t = resumeFrom - 4 * beat; t < resumeFrom; t += 0.02) countIn.push({ time: t, midi: null, clarity: 0.2, rms: 0.003 });
  // and the singer humming the cue note (mic hears the guide cue on speakers)
  const cueMidi = part.notes.find((n) => n.start >= resumeFrom)!.midi;
  const countInCue = countIn.map((s) => ({ ...s, midi: cueMidi, clarity: 0.95, rms: 0.05 }));
  const before = clean.filter((s) => s.time < resumeFrom);
  const after = clean.filter((s) => s.time >= resumeFrom);
  const live = new LiveScorer({ score, part, range: [a, b] }, opts);
  const sessionSamples = [...before, ...countIn, ...after];
  for (const s of sessionSamples) live.push(s);
  const r1 = live.finish(sessionSamples); // what PracticeSession.finish() does
  const r2 = scoreAttempt({ score, part, range: [a, b] }, [...before, ...countInCue, ...after], opts);
  const affected = part.notes.slice(a, b + 1).filter((n) => n.start + n.dur > resumeFrom - 4 * beat && n.start < resumeFrom).length;
  console.log(`\n## pause/resume (Bach S, notes ${a}-${b}, ${affected} notes inside the replayed count-in window)\n` +
    `no pause: acc ${fmt(r0.accuracy)} counts ${JSON.stringify(r0.counts)}\n` +
    `pause+resume, silent count-in: acc ${fmt(r1.accuracy)} counts ${JSON.stringify(r1.counts)}\n` +
    `pause+resume, mic hears cue note in count-in: acc ${fmt(r2.accuracy)} counts ${JSON.stringify(r2.counts)}`);
});

test('LiveScorer cost over a whole piece', async () => {
  for (const f of ['pd/brahms-schaffe.mxl', 'pd/debussy-yver.mxl', 'pd/ravel-nicolette.mxl']) {
    const score = await load(f);
    const part = score.parts[0];
    const samples = sing(part, 0, part.notes.length - 1, 0, score.duration, 1, SINGERS[1]);
    const ls = new LiveScorer({ score, part, range: [0, part.notes.length - 1] }, { toleranceCents: 25, tuning: 'just', octaveTolerant: false });
    const t0 = performance.now();
    for (const s of samples) ls.push(s);
    const t1 = performance.now();
    ls.finish(samples);
    const t2 = performance.now();
    console.log(`${f}: dur ${score.duration.toFixed(0)}s, ${part.notes.length} notes, ${samples.length} samples; push total ${(t1 - t0).toFixed(1)}ms (${((t1 - t0) / samples.length * 1000).toFixed(1)}µs/sample); finish(samples) re-score ${(t2 - t1).toFixed(1)}ms`);
  }
});
