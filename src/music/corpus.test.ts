// Corpus robustness test: imports every file in src/music/fixtures/corpus/ (W3C MusicXML examples,
// the LilyPond/Kainhofer MusicXML test suite), content/raw/, public/pieces/ and library/ and checks the
// invariants in ./invariants.ts. See src/music/fixtures/corpus/README.md for sources & licences.
import { describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { importScoreFile } from './import';
import { computeSections } from './sections';
import { invariantViolations, USER_FACING_ERROR } from './invariants';

const root = resolve(__dirname, '../..');
const dirs = [resolve(__dirname, 'fixtures/corpus'), resolve(root, 'content/raw'), resolve(root, 'public/pieces'), resolve(root, 'library')];
const EXT = /\.(mxl|musicxml|xml|mid|midi)$/i;

function walk(d: string): string[] {
  if (!existsSync(d)) return [];
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : EXT.test(f) ? [p] : [];
  });
}
const files = dirs.flatMap(walk);

/** Files that are expected to be rejected with a user-facing error. */
const EXPECTED_REJECT = new Set<string>([
  // header-only snippet from the spec docs: no <part> at all
  'src/music/fixtures/corpus/w3c/snippet-movement-number-and-movement-title-elements.musicxml',
]);

describe('importer corpus', () => {
  it('has a corpus', () => {
    expect(files.length).toBeGreaterThan(40);
  });
  for (const file of files) {
    const rel = relative(root, file);
    it(`imports ${rel}`, async () => {
      const buf = readFileSync(file);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const t0 = performance.now();
      let score;
      try {
        score = await importScoreFile(file, ab);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e).not.toBeInstanceOf(TypeError);
        expect(e).not.toBeInstanceOf(RangeError);
        expect((e as Error).message).toMatch(USER_FACING_ERROR);
        expect(EXPECTED_REJECT.has(rel), `unexpected rejection: ${(e as Error).message}`).toBe(true);
        return;
      }
      const sections = computeSections(score);
      let ms = performance.now() - t0;
      expect(invariantViolations(score, sections).slice(0, 10)).toEqual([]);
      // The budget catches a slow importer (e.g. something quadratic), not a busy CI runner: a first
      // import past it (cold JIT, a noisy neighbour) is timed twice more and the best one counts.
      for (let i = 0; i < 2 && ms >= 1000; i++) {
        const t1 = performance.now();
        computeSections(await importScoreFile(file, ab));
        ms = Math.min(ms, performance.now() - t1);
      }
      expect(ms).toBeLessThan(1000);
      // SHOW_SCORES=/path/to/out.txt appends a one-line summary per file (for eyeballing results)
      if (process.env.SHOW_SCORES)
        appendFileSync(
          process.env.SHOW_SCORES,
          `${rel}: "${score.title}" ${score.measures.length} bars ${score.duration.toFixed(1)}s ${ms.toFixed(0)}ms :: ` +
            score.parts.map((p) => `${p.name}[${p.voiceType}] ${p.notes.length}n ${p.notes.filter((n) => n.lyric).length}l`).join(' | ') +
            '\n',
        );
    });
  }
});
