// QA round 3: compare onset/rhythm at d2dedc4 (pre-232b934) vs HEAD for repeated notes with vibrato.
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r3-onset-compare --silent=false
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makePart, makeScore, sampleSinging } from '../../../src/game/testutil';
import { scoreAttempt } from '../../../src/game/scoring';
import { scoreAttempt as oldScore } from './r3-old/scoring';
import { importScoreFile } from '../../../src/music/import';
import { computeSections } from '../../../src/music/sections';

it('repeated notes with vibrato: HEAD vs d2dedc4', async () => {
  const part = makePart('S', Array.from({ length: 8 }, () => [67, 1] as [number, number]), 90);
  const score = makeScore([part], 90);
  const ctx = { score, part, range: [0, 7] as [number, number] };
  for (const vib of [25, 40, 50, 60]) for (const tol of [35, 25]) {
    const s = sampleSinging(part, (n, t) => n.midi + (vib * Math.sin(2 * Math.PI * 5.5 * t)) / 100);
    const o = { toleranceCents: tol, tuning: 'equal' as const, octaveTolerant: false };
    console.log('R3-cmp-repeat', JSON.stringify({ vib, tol, headRhythm: Math.round(scoreAttempt(ctx, s, o).rhythm * 100), oldRhythm: Math.round(oldScore(ctx, s, o).rhythm * 100) }));
  }
  // real piece: Debussy Dieu soprano, first section, vibrato ±40/±50, perfect timing
  const b = readFileSync(process.cwd() + '/public/pieces/pd/debussy-dieu.mxl');
  for (const f of ['pd/debussy-dieu.mxl', 'warmup-chorale.musicxml', 'pd/bruckner-locus-iste.mxl', 'pd/debussy-yver.mxl']) {
    const bb = readFileSync(process.cwd() + '/public/pieces/' + f);
    const sc = await importScoreFile(f, bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
    for (const p of sc.parts.slice(0, 4)) {
      const sec = computeSections(sc)[0];
      const idx = p.notes.map((n, i) => [n, i] as const).filter(([n]) => n.start >= sec.start - 1e-6 && n.start < sec.end - 1e-6).map(([, i]) => i);
      if (idx.length < 3) continue;
      const c = { score: sc, part: p, range: [idx[0], idx[idx.length - 1]] as [number, number] };
      const s = sampleSinging(p, (n, t) => n.midi + (50 * Math.sin(2 * Math.PI * 5.5 * t)) / 100, 0.02, sec.start, sec.end);
      const o = { toleranceCents: 35, tuning: 'equal' as const, octaveTolerant: false };
      const h = scoreAttempt(c, s, o); const old = oldScore(c, s, o);
      console.log('R3-cmp-piece', f, p.name, sec.label, JSON.stringify({ vib: 50, L2tol: 35, head: { acc: Math.round(h.accuracy * 100), rhythm: Math.round(h.rhythm * 100), noOnset: h.notes.filter((n) => n.onsetMs == null).length + '/' + h.notes.length }, old: { acc: Math.round(old.accuracy * 100), rhythm: Math.round(old.rhythm * 100) } }));
    }
  }
  void b;
});
