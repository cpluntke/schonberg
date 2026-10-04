// QA round 5 — why a scooping singer is told "Behind the beat" at HEAD (diagnostic; prints only).
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { scoreAttempt as headScore } from '../../../src/game/scoring';
import { scoreAttempt as oldScore } from './r5-old/src/game/scoring';
import { importScoreFile } from '../../../src/music/import';
import { computeSections } from '../../../src/music/sections';
import type { PitchSample } from '../../../src/game/types';

// Deterministic singer: exact timing, optional consonant, glide from -scoop c to 0 over scoopMs, lag.
function sing(notes: { start: number; dur: number; midi: number; lyric?: string }[], cons: number, scoop: number, scoopMs: number, lag: number, from: number, to: number) {
  const out: PitchSample[] = [];
  for (let t = from - 0.3; t < to + 0.4; t += 0.02) {
    const u = t - lag;
    const k = notes.findIndex((n, i) => u >= n.start && u < (notes[i + 1]?.start ?? n.start + n.dur - 0.03));
    let midi: number | null = null;
    if (k >= 0) {
      const n = notes[k];
      const prev = notes[k - 1];
      const c = !prev || n.lyric || prev.start + prev.dur < n.start - 1e-6 ? cons : 0;
      const into = u - n.start - c;
      if (into >= 0) midi = n.midi + (0.3 * Math.sin(2 * Math.PI * 5.5 * u)) - (into < scoopMs ? (scoop / 100) * (1 - into / scoopMs) : 0);
    }
    out.push({ time: t, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.003 : 0.1 });
  }
  return out;
}

it('R5 scoop diag', async () => {
  const opts = { toleranceCents: 25, tuning: 'equal' as const, octaveTolerant: false };
  for (const f of ['warmup-chorale.musicxml', 'pd/debussy-dieu.mxl']) {
    const b = readFileSync(process.cwd() + '/public/pieces/' + f);
    const score = await importScoreFile(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const sec = computeSections(score)[1];
    for (const part of score.parts.slice(0, 4)) {
      const idx = part.notes.map((n, i) => [n, i] as const).filter(([n]) => n.start >= sec.start - 1e-6 && n.start < sec.end - 1e-6).map(([, i]) => i);
      const a = idx[0], z = idx[idx.length - 1];
      for (const [cons, scoop, ms, lag] of [[0, 150, 0.15, 0], [0, 100, 0.1, 0.05], [0.06, 100, 0.1, 0.05], [0.06, 150, 0.15, 0.05], [0.06, 200, 0.2, 0.05]] as const) {
        const s = sing(part.notes.slice(a, z + 1), cons, scoop, ms, lag, sec.start, sec.end);
        const line = (r: ReturnType<typeof headScore>) => {
          const sc = r.notes.filter((n) => n.scoop === 'below').length;
          const on = r.notes.filter((n) => n.onsetMs != null && n.scoop === null).map((n) => Math.round(n.onsetMs!)).sort((p, q) => p - q);
          return `acc ${Math.round(r.accuracy * 100)} scoopNotes ${sc}/${r.notes.length} unscoopedOnsets med ${on[on.length >> 1]} [${r.insights.map((i) => i.kind).join(',')}]`;
        };
        console.log(`${f} ${part.name} ${sec.label} cons ${cons * 1000} scoop ${scoop}c/${ms * 1000}ms lag ${lag * 1000}: HEAD ${line(headScore({ score, part, range: [a, z] }, s, opts))} | OLD ${line(oldScore({ score, part, range: [a, z] } as never, s as never, opts as never) as never)}`);
      }
    }
  }
});
