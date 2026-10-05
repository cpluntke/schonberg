// Loading the built-in pieces exactly as the app does (src/ui/library.ts loadAll + makePiece).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importScoreFile } from '../../src/music/import';
import { computeSections } from '../../src/music/sections';
import type { Part, Score, Section } from '../../src/music/types';

export const REPO_ROOT = resolve(__dirname, '../..');
const PIECES_DIR = resolve(REPO_ROOT, 'public/pieces');
const LIBRARY_DIR = resolve(REPO_ROOT, 'library');

interface ManifestEntry { id: string; file: string; title: string; composer?: string; partNames?: string[] }

export interface LoadedPiece { id: string; score: Score; sections: Section[] }

const cache = new Map<string, Promise<LoadedPiece>>();

function manifest(): ManifestEntry[] {
  const read = (d: string, f: string) => (JSON.parse(readFileSync(resolve(d, f), 'utf8')) as ManifestEntry[]).map((m) => ({ ...m, file: resolve(d, m.file) }));
  return [...read(LIBRARY_DIR, 'index.json'), ...read(PIECES_DIR, 'manifest.json')];
}

/** Load a built-in or choir-library piece by id (library/index.json / public/pieces/manifest.json), mirroring library.ts. */
export function loadPiece(id: string): Promise<LoadedPiece> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const m = manifest().find((x) => x.id === id);
      if (!m) throw new Error(`Unknown piece ${id}`);
      const buf = readFileSync(resolve(PIECES_DIR, m.file));
      const score = await importScoreFile(m.file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      score.id = m.id;
      score.source = 'builtin';
      score.title = m.title;
      if (m.composer) score.composer = m.composer;
      if (m.partNames) {
        const vocal = score.parts.filter((x) => x.notes.length);
        m.partNames.forEach((name, i) => {
          if (!vocal[i]) return;
          vocal[i].name = name;
          const v = name[0].toUpperCase();
          if ('SATB'.includes(v)) vocal[i].voiceType = v as 'S' | 'A' | 'T' | 'B';
        });
      }
      return { id, score, sections: computeSections(score) };
    })();
    cache.set(id, p);
  }
  return p;
}

/** Same as src/ui/library.ts noteRangeFor: notes whose start lies in [from, to). */
export function noteRangeFor(part: Part, from: number, to: number): [number, number] | null {
  let a = -1;
  let b = -1;
  part.notes.forEach((n, i) => {
    if (n.start >= from - 1e-6 && n.start < to - 1e-6) {
      if (a < 0) a = i;
      b = i;
    }
  });
  return a < 0 ? null : [a, b];
}

/** Part by voice type (first match) or id. */
export function findPart(score: Score, voiceOrId: string): Part {
  const p = score.parts.find((x) => x.id === voiceOrId) ?? score.parts.find((x) => x.voiceType === voiceOrId && x.notes.length);
  if (!p) throw new Error(`No part ${voiceOrId} in ${score.id}`);
  return p;
}

/** Score-time span of printed bars [firstNumber, lastNumber] (measure.number labels). */
export function barSpan(score: Score, first: string, last: string): { from: number; to: number } {
  const a = score.measures.find((m) => m.number === first);
  const b = score.measures.find((m) => m.number === last);
  if (!a || !b) throw new Error(`Bars ${first}-${last} not in ${score.id}`);
  return { from: a.start, to: b.start + b.dur };
}
