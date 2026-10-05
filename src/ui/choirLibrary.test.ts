import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importScoreFile } from '../music/import';

// The choir library (library/, admins only) and the public build (public/): the public app ships
// only the Abendlied; the library holds the former built-in pieces plus Fauré's Madrigal.
const root = resolve(__dirname, '../..');
interface Entry { id: string; file: string; title: string; composer: string; level?: string; description?: string; credit?: string }
const index = JSON.parse(readFileSync(resolve(root, 'library/index.json'), 'utf8')) as Entry[];

describe('choir library', () => {
  it('lists the Madrigal and the former built-in pieces, each with title, composer, level, description and credit', () => {
    const ids = index.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['faure-madrigal', 'bruckner-locus-iste', 'debussy-dieu', 'debussy-tabourin', 'debussy-yver', 'brahms-schaffe', 'ravel-nicolette', 'vierne-kyrie']));
    for (const e of index) {
      expect(e.id).toMatch(/^[a-z0-9][a-z0-9-]{1,60}$/);
      expect(e.title && e.composer && e.description && e.credit, e.id).toBeTruthy();
      expect(['easy', 'medium', 'hard']).toContain(e.level);
      expect(existsSync(resolve(root, 'library', e.file)), e.file).toBe(true);
    }
    expect(index.find((e) => e.id === 'faure-madrigal')!.credit).toMatch(/Robert Kerr.*CC BY-SA 4\.0/);
  });

  for (const e of index) {
    it(`${e.id} imports with sung parts and lyrics`, async () => {
      const buf = readFileSync(resolve(root, 'library', e.file));
      const s = await importScoreFile(e.file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      const sung = s.parts.filter((p) => p.voiceType !== 'other' && p.notes.length);
      expect(sung.length).toBeGreaterThanOrEqual(3);
      expect(sung.every((p) => p.notes.some((n) => n.lyric))).toBe(true);
    });
  }

  it('the public build has only the Abendlied: no library score, index or programme preset', () => {
    const pub = resolve(root, 'public/pieces');
    const files = readdirSync(pub, { recursive: true }).map(String);
    expect(files.filter((f) => /\.(mxl|mid|midi)$/i.test(f))).toEqual([]);
    expect(files).not.toContain('repertoire.json');
    expect(files).not.toContain('cycle.json');
    const manifest = JSON.parse(readFileSync(resolve(pub, 'manifest.json'), 'utf8')) as Entry[];
    expect(manifest.map((m) => m.id)).toEqual(['warmup-chorale']);
  });
});
