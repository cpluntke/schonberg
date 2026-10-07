// Written spelling: the importer keeps how the source spells each note (a B♯ stays a B♯), and the
// score view draws it. The corpus check compares, for every note of the library pieces, the
// spelling in the file with the one drawn on the staff: before notes kept their spelling, the app
// re-spelled them from the key (B♯ → C♮ in the Vierne).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { parseMusicXML } from './musicxml';
import { importScoreFile, PARSE_VERSION } from './import';
import { spellPc } from '../game/notation';
import { buildMeasures, keyAtBeat, spell } from '../ui/play/staff2d';
import type { Score } from './types';

const LETTERS = 'CDEFGAB';

function xml(notes: string, attrs = '<divisions>1</divisions><key><fifths>4</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time>', partName = 'Bass'): string {
  return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>${partName}</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes>${attrs}</attributes>${notes}</measure></part></score-partwise>`;
}
const note = (step: string, alter: number, octave: number, extra = '', dur = 1) =>
  `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>quarter</type>${extra}</note>`;

describe('importer keeps the written spelling', () => {
  it('B♯ stays B♯ (letter B, sounding as C); the printed accidental and its cautionary flag are kept', () => {
    const s = parseMusicXML(xml(
      note('C', 1, 3) + note('B', 1, 2, '<accidental>sharp</accidental>') + note('C', 0, 3, '<accidental cautionary="yes">natural</accidental>') + note('C', 1, 3, '<accidental parentheses="yes">sharp</accidental>'),
    ));
    const ns = s.parts[0].notes;
    expect(ns.map((n) => n.midi)).toEqual([49, 48, 48, 49]);
    expect(ns.map((n) => n.spelling)).toEqual([
      { letter: 0, alter: 1 },
      { letter: 6, alter: 1, acc: 1 },
      { letter: 0, alter: 0, acc: 0, courtesy: true },
      { letter: 0, alter: 1, acc: 1, courtesy: true },
    ]);
    // drawn: B♯2 on the B (step 2*7+6), not on the C above
    const key = keyAtBeat(s, 0);
    expect(spell(48, key, ns[1].spelling)).toEqual({ step: 20, alt: 1 });
    expect(spell(48, key, ns[2].spelling)).toEqual({ step: 21, alt: 0 });
  });

  it('a tied note keeps the first note\'s spelling', () => {
    const s = parseMusicXML(xml(note('B', 1, 2, '<tie type="start"/><notations><tied type="start"/></notations>', 2) + note('B', 1, 2, '<tie type="stop"/><notations><tied type="stop"/></notations>', 2)));
    expect(s.parts[0].notes).toHaveLength(1);
    expect(s.parts[0].notes[0]).toMatchObject({ midi: 48, durBeats: 4, spelling: { letter: 6, alter: 1 } });
  });

  it('transposing parts: octave-only keeps the letter; a chromatic transposition uses <diatonic>, or falls back to the key', () => {
    const oct = parseMusicXML(xml(note('E', 1, 4), '<divisions>1</divisions><key><fifths>4</fifths></key><transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>-1</octave-change></transpose>', 'Tenor'));
    expect(oct.parts[0].notes[0]).toMatchObject({ midi: 53, spelling: { letter: 2, alter: 1 } }); // E♯3
    // B♭ clarinet: written D5 sounds C5; written E♯ sounds D♯
    const cl = parseMusicXML(xml(note('E', 1, 5, '<accidental>sharp</accidental>'), '<divisions>1</divisions><key><fifths>2</fifths></key><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>', 'Clarinet'));
    expect(cl.parts[0].notes[0]).toMatchObject({ midi: 75, spelling: { letter: 1, alter: 1 } }); // D♯5, the written accidental left out
    const noDia = parseMusicXML(xml(note('E', 1, 5), '<divisions>1</divisions><key><fifths>2</fifths></key><transpose><chromatic>-2</chromatic></transpose>', 'Clarinet'));
    expect(noDia.parts[0].notes[0].spelling).toBeUndefined();
  });

  it('quarter-tone alterations are spelled from the key', () => {
    const s = parseMusicXML(xml(note('C', 0.5, 4)));
    expect(s.parts[0].notes[0].spelling).toBeUndefined();
  });

  it('imports carry the parse version (older stored scores are recognised)', async () => {
    const b = readFileSync(resolve(__dirname, '../../public/pieces/warmup-chorale.musicxml'));
    const s = await importScoreFile('w.musicxml', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    expect(s.parseVersion).toBe(PARSE_VERSION);
    expect(s.parts[0].notes.every((n) => n.spelling)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Corpus: the file's spelling vs the staff's

const root = resolve(__dirname, '../..');
const PIECES = ['brahms-schaffe', 'bruckner-locus-iste', 'debussy-dieu', 'debussy-tabourin', 'debussy-yver', 'faure-madrigal', 'ravel-nicolette', 'vierne-kyrie']
  .map((p) => `library/scores/${p}.mxl`).concat('public/pieces/warmup-chorale.musicxml');

function readXml(rel: string): string {
  const buf = readFileSync(resolve(root, rel));
  if (!rel.endsWith('.mxl')) return buf.toString('utf8');
  const files = unzipSync(new Uint8Array(buf));
  const container = files['META-INF/container.xml'] ? strFromU8(files['META-INF/container.xml']) : '';
  const name = container.match(/full-path\s*=\s*["']([^"']+)["']/)?.[1] ?? Object.keys(files).find((n) => !n.startsWith('META-INF') && n.endsWith('.xml'))!;
  return strFromU8(files[name]);
}

/** Straight from the file (independent of the importer): part id → measure index → pitch class → spellings used. */
function fileSpellings(text: string): { byPart: Map<string, Map<number, Map<number, Set<string>>>>; mode: 'major' | 'minor' } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const byPart = new Map<string, Map<number, Map<number, Set<string>>>>();
  const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    const bars = new Map<number, Map<number, Set<string>>>();
    Array.from(part.children).filter((m) => m.localName === 'measure').forEach((m, mi) => {
      const pcs = new Map<number, Set<string>>();
      for (const p of Array.from(m.getElementsByTagName('pitch'))) {
        const step = p.getElementsByTagName('step')[0]?.textContent?.trim() ?? 'C';
        const alter = Math.round(parseFloat(p.getElementsByTagName('alter')[0]?.textContent ?? '0') || 0);
        const pc = (((PC[step] + alter) % 12) + 12) % 12;
        if (!pcs.has(pc)) pcs.set(pc, new Set());
        pcs.get(pc)!.add(`${step}${alter}`);
      }
      bars.set(mi, pcs);
    });
    byPart.set(part.getAttribute('id') ?? '', bars);
  }
  const mode = doc.getElementsByTagName('mode')[0]?.textContent?.trim() === 'minor' ? 'minor' : 'major';
  return { byPart, mode };
}

interface Count { notes: number; before: number; after: number; examples: string[]; kinds: Map<string, number> }

/** Spelling of every note: in the file, drawn before (from the key as the file states it), drawn now (staff events). */
function compare(score: Score, file: ReturnType<typeof fileSpellings>): Map<string, Count> {
  const out = new Map<string, Count>();
  for (const part of score.parts) {
    const c: Count = { notes: 0, before: 0, after: 0, examples: [], kinds: new Map() };
    out.set(part.name, c);
    const bars = file.byPart.get(part.id.replace(/-\d+$/, ''));
    if (!bars) continue;
    // what the staff draws now: every notehead's letter and alteration
    const drawn = new Map<number, string>();
    for (const sm of buildMeasures(score, part, 0, score.measures.length - 1)) {
      for (const e of sm.events) {
        if (e.kind !== 'note' || !e.first) continue;
        drawn.set(e.noteIndex!, `${LETTERS[((e.step! % 7) + 7) % 7]}${e.alt}`);
        for (const h of e.chord ?? []) if (h.first) drawn.set(h.noteIndex, `${LETTERS[((h.step % 7) + 7) % 7]}${h.alt}`);
      }
    }
    part.notes.forEach((n, i) => {
      const inFile = bars.get(n.measure)?.get(((n.midi % 12) + 12) % 12);
      if (!inFile) return; // (not a note of this bar in the file: lane/voice bookkeeping, nothing to compare)
      c.notes++;
      const k = keyAtBeat(score, n.startBeat);
      const old = spellPc(n.midi, { fifths: k.fifths, mode: file.mode });
      const before = `${old.letter}${old.accidental}`;
      if (!inFile.has(before)) {
        c.before++;
        const kind = `${[...inFile].join('/')}→${before}`;
        c.kinds.set(kind, (c.kinds.get(kind) ?? 0) + 1);
        if (c.examples.length < 3) c.examples.push(`bar ${score.measures[n.measure].number}: ${[...inFile].join('/')} drawn ${before}`);
      }
      const now = drawn.get(i);
      if (now !== undefined && !inFile.has(now)) c.after++;
      // and exactly the note's own written spelling
      if (n.spelling && now !== undefined) expect(now).toBe(`${LETTERS[n.spelling.letter]}${n.spelling.alter}`);
    });
  }
  return out;
}

describe('library pieces: drawn spelling = written spelling', () => {
  const report: string[] = [];
  for (const rel of PIECES) {
    it(rel, async () => {
      const buf = readFileSync(resolve(root, rel));
      const score = await importScoreFile(rel, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      const counts = compare(score, fileSpellings(readXml(rel)));
      let before = 0;
      let notes = 0;
      for (const [name, c] of counts) {
        notes += c.notes;
        before += c.before;
        expect(c.after, `${rel} ${name}`).toBe(0);
        if (c.before) report.push(`${rel} ${name}: ${c.before}/${c.notes} misspelled before (${[...c.kinds].map(([k, v]) => `${k} ×${v}`).join(', ')}; e.g. ${c.examples.join('; ')})`);
      }
      report.push(`${rel}: ${before} of ${notes} notes misspelled before, 0 now`);
      if (rel.includes('vierne')) {
        // the owner's report: B♯ drawn as C♮ in the bass (do ti do read as C♯ C♮ C♯)
        expect(counts.get('Bass')!.before).toBeGreaterThan(0);
        expect(counts.get('Bass')!.kinds.get('B1→C0')).toBeGreaterThan(0);
      }
    }, 60_000);
  }
  it('report', () => {
    if (process.env.SPELLING_REPORT) console.log(report.join('\n'));
  });
});
