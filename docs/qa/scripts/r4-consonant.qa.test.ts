// QA round 4: why does a realistic on-time singer (consonant gap before each syllable) get low Rhythm in Debussy bars 1–5?
// Compares HEAD scoring with the pre-232b934 copy (r3-old/scoring.ts).
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { scoreAttempt } from '../../../src/game/scoring';
import { scoreAttempt as oldScore } from './r3-old/scoring';
import { importScoreFile } from '../../../src/music/import';
import { computeSections } from '../../../src/music/sections';
import type { PitchSample } from '../../../src/game/types';

it('R4-cons', async () => {
  for (const f of ['pd/debussy-dieu.mxl', 'warmup-chorale.musicxml', 'pd/bruckner-locus-iste.mxl']) {
    const b = readFileSync(process.cwd() + '/public/pieces/' + f);
    const score = await importScoreFile(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const sec = computeSections(score)[0];
    for (const part of score.parts.slice(0, 4)) {
      const idx = part.notes.map((n, i) => [n, i] as const).filter(([n]) => n.start >= sec.start - 1e-6 && n.start < sec.end - 1e-6).map(([, i]) => i);
      const a = idx[0], z = idx[idx.length - 1];
      for (const cons of [0, 40, 60, 80]) {
        const s: PitchSample[] = [];
        let k = a;
        for (let t = sec.start - 0.3; t < sec.end + 0.3; t += 0.02) {
          while (k < z && part.notes[k].start + part.notes[k].dur <= t) k++;
          const n = part.notes[k];
          const into = t - n.start;
          const midi = into >= cons / 1000 && into < n.dur - 0.03 ? n.midi + 0.3 * Math.sin(2 * Math.PI * 5.5 * t) : null;
          s.push({ time: t, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.003 : 0.1 });
        }
        const opts = { toleranceCents: 35, tuning: 'equal' as const, octaveTolerant: false };
        const r = scoreAttempt({ score, part, range: [a, z] }, s, opts);
        const o = oldScore({ score, part, range: [a, z] } as never, s as never, opts as never) as typeof r;
        const nulls = r.notes.filter((n) => n.onsetMs == null).map((n) => `${n.index}(${part.notes[n.index].dur.toFixed(2)}s${part.notes[n.index - 1]?.midi === part.notes[n.index].midi ? ',rep' : ''})`);
        console.log('R4-cons', f, part.name, sec.label, `cons=${cons}`, JSON.stringify({ headRhythm: Math.round(r.rhythm * 100), oldRhythm: Math.round(o.rhythm * 100), headAcc: Math.round(r.accuracy * 100), noOnset: nulls.slice(0, 8), nNull: nulls.length, n: r.notes.length }));
      }
    }
  }
});
