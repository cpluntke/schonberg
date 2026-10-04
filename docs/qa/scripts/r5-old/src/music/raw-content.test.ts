// Parses the public-domain scores in content/raw/ (if present) as a robustness check.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importScoreFile } from './import';
import { computeSections } from './sections';

const dir = resolve(__dirname, '../../content/raw');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(mxl|musicxml|xml|mid|midi)$/i.test(f)) : [];

describe.skipIf(files.length === 0)('content/raw scores', () => {
  for (const f of files) {
    it(`parses ${f}`, async () => {
      const buf = readFileSync(resolve(dir, f));
      const score = await importScoreFile(f, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const sung = score.parts.filter((p) => p.voiceType !== 'other');
      if (process.env.SHOW_SCORES)
        console.log(
          `${f}: "${score.title}" / ${score.composer} — ${score.measures.length} bars, ${score.duration.toFixed(1)}s, tempos ${score.tempos.map((t) => Math.round(t.bpm)).join(',')}, keys ${score.keys.map((k) => k.fifths + k.mode[0]).join(',')}\n` +
            score.parts
              .map((p) => {
                const ly = p.notes.filter((n) => n.lyric).length;
                return `   ${p.id} ${p.name} [${p.voiceType}] notes=${p.notes.length} lyr=${ly} range=${p.low}-${p.high} :: ${p.notes.slice(0, 8).map((n) => n.lyric ?? '·').join(' ')}`;
              })
              .join('\n') +
            `\n   sections: ${computeSections(score).map((s) => s.label).join(' | ')}`,
        );
      expect(score.measures.length).toBeGreaterThan(0);
      expect(sung.length).toBeGreaterThan(0);
      for (const p of score.parts) {
        for (let i = 1; i < p.notes.length; i++) expect(p.notes[i].start).toBeGreaterThanOrEqual(p.notes[i - 1].start);
        for (const n of p.notes) {
          expect(n.dur).toBeGreaterThan(0);
          expect(Number.isFinite(n.start)).toBe(true);
        }
      }
      for (const p of sung) {
        expect(p.notes.length).toBeGreaterThan(0);
        // a singable part is monophonic
        for (let i = 1; i < p.notes.length; i++) expect(p.notes[i].startBeat).toBeGreaterThanOrEqual(p.notes[i - 1].startBeat + p.notes[i - 1].durBeats - 1e-3);
        expect(p.notes.filter((n) => n.lyric).length).toBeGreaterThan(p.notes.length * 0.3);
      }
      expect(computeSections(score).length).toBeGreaterThan(0);
    });
  }
});
