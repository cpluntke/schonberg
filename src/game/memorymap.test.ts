import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { importScoreFile } from '../music/import';
import { computeSections } from '../music/sections';
import type { Part, Score, Section } from '../music/types';
import { makePart, makeScore } from './testutil';
import { buildMemoryMap, intervalPhrase, possessive, noteText } from './memorymap';

async function load(file: string): Promise<Score> {
  const buf = readFileSync(file);
  return importScoreFile(file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

function named(p: Part, name: string, voiceType: Part['voiceType']): Part {
  p.name = name;
  p.voiceType = voiceType;
  return p;
}

const whole: (s: Score) => Section[] = (s) => [{ id: 'all', index: 0, label: 'All', startMeasure: 0, endMeasure: s.measures.length - 1, start: 0, end: s.duration }];

describe('helpers', () => {
  it('names intervals the way singers say them', () => {
    expect(intervalPhrase(7)).toBe('a fifth up');
    expect(intervalPhrase(-3)).toBe('a minor third down');
    expect(intervalPhrase(12)).toBe('an octave up');
    expect(intervalPhrase(6)).toBe('a tritone up');
    expect(intervalPhrase(-24)).toBe('two octaves down');
    expect(intervalPhrase(17)).toBe('an eleventh up');
    expect(intervalPhrase(0)).toBe('the same note');
  });
  it('possessives', () => {
    expect(possessive('Tenor')).toBe("the tenors'");
    expect(possessive('Bass')).toBe("the basses'");
    expect(possessive('Organ')).toBe("the Organ's");
    expect(possessive('Tenor 1')).toBe("the Tenor 1's");
  });
  it('note names follow the notation and the key', () => {
    expect(noteText(64, 'letter', { fifths: 0, mode: 'major' })).toBe('E');
    expect(noteText(64, 'letter', { fifths: 0, mode: 'major' }, true)).toBe('E4');
    expect(noteText(70, 'letter', { fifths: -1, mode: 'major' }, true)).toBe('B♭4');
    expect(noteText(64, 'fixed', { fifths: 0, mode: 'major' })).toBe('Mi');
    expect(noteText(67, 'movable', { fifths: 0, mode: 'major' })).toBe('Sol');
  });
});

describe('synthetic score', () => {
  // Bars 1–2: tenor alone (4 quarters + 4); bar 3: alto enters a fifth above the tenor's last note.
  // Bars 5–6: alto alone (solo), bars 7–9: alto rests while the tenor sings.
  const tenor = named(makePart('T', [
    [48, 4], [50, 4], [52, 2], [null, 2], [53, 4], [null, 8], [55, 4], [57, 4], [55, 4], [53, 4],
  ]), 'Tenor', 'T');
  const alto = named(makePart('A', [
    [null, 8], [59, 2], [60, 2], [62, 4], [64, 4], [65, 4], [null, 12], [60, 4],
  ]), 'Alto', 'A');
  alto.notes[0].lyric = 'Dieu!';
  alto.notes[0].syllabic = 'single';
  alto.notes[1].lyric = 'Bon';
  alto.notes[1].syllabic = 'begin';
  alto.notes[2].lyric = 'jour';
  alto.notes[2].syllabic = 'end';
  const score = makeScore([tenor, alto]);
  score.keys.push({ beat: 32, time: 32, fifths: 2, mode: 'major' });
  score.tempos.push({ beat: 32, time: 32, bpm: 80 });
  score.measures[8].timeSig = [3, 4];
  const sections: Section[] = [
    { id: 'a', index: 0, label: 'A', startMeasure: 0, endMeasure: 3, start: 0, end: 16 },
    { id: 'b', index: 1, label: 'B', startMeasure: 4, endMeasure: 9, start: 16, end: score.duration },
  ];
  const map = buildMemoryMap(score, sections, 'A')!;

  it('finds entries with bar, word, note and cue', () => {
    expect(map.entryCount).toBe(2);
    const [e1, e2] = map.sections.flatMap((s) => s.entries);
    expect(e1.bar).toBe('3');
    expect(e1.beat).toBe('beat 1');
    expect(e1.word).toBe('Dieu');
    expect(e1.note).toBe('B');
    expect(e1.restBeats).toBeNull();
    // the tenor's E starts together with the alto; the cue is the note before it, D (50)
    expect(e1.cue?.partName).toBe('Tenor');
    expect(e1.cue?.note).toBe('D');
    expect(e1.cue?.text).toBe("a major sixth up from the tenors' D");
    expect(e2.bar).toBe('10');
    expect(e2.cue?.text).toBe("a fourth up from the tenors' G");
  });

  it('marks the solo, the long rest, and the range', () => {
    const [a, b] = map.sections;
    expect(a.range).toMatchObject({ low: 59, high: 62, lowName: 'B3', highName: 'D4' });
    // bar 4 the tenor holds F with the alto → not exposed; bars 5–6 the tenor rests → exposed
    expect(b.exposed.map((x) => x.bars)).toEqual(['bars 5–6']);
    expect(b.exposed[0].accompanied).toBe(false);
    expect(b.rests.map((x) => x.bars)).toEqual(['bars 7–9']);
    expect(a.rests.map((x) => x.bars)).toEqual(['bars 1–2']);
  });

  it('lists key, tempo and metre changes inside a section', () => {
    const b = map.sections[1];
    expect(b.changes.map((c) => `${c.bar} ${c.text}`)).toEqual(['9 Key: D major', '9 Time: 3/4', '9 Faster: ♩ = 80', '10 Time: 4/4']);
    expect(map.start).toEqual({ key: 'C major', time: '4/4', tempo: '♩ = 60' });
  });

  it('first letters per section', () => {
    expect(map.sections[0].letters).toBe('D! B');
    expect(map.hasText).toBe(true);
  });

  it('the alto is above the tenor: top voice', () => {
    expect(map.usuallyTop).toBe(true);
    const t = buildMemoryMap(score, whole(score), 'T')!;
    expect(t.usuallyTop).toBe(false);
    expect(t.sections[0].tune).toEqual([]);
  });

  it('unknown part → null', () => {
    expect(buildMemoryMap(score, sections, 'X')).toBeNull();
  });
});

describe('built-in pieces', () => {
  it('Debussy, Quant j\'ai ouy le tabourin: alto solo', async () => {
    const s = await load('library/scores/debussy-tabourin.mxl');
    const solo = s.parts.find((p) => p.name === 'Alto Solo')!;
    const map = buildMemoryMap(s, computeSections(s), solo.id)!;
    const first = map.sections[0].entries[0];
    expect(first.bar).toBe('5');
    expect(first.word).toBe('Quant');
    expect(first.cue?.text).toMatch(/up from|down from|same note/);
    expect(map.sections[0].rests[0].bars).toBe('bars 1–4');
    expect(map.sections[0].letters.startsWith("Q j'a o l t S,")).toBe(true);
    const changes = map.sections.flatMap((x) => x.changes.map((c) => c.text));
    expect(changes).toContain('Key: C major');
    expect(changes).toContain('Key: A major');
    expect(map.start.key).toBe('A major');
    expect(map.start.time).toBe('3/4');
  });

  it('Vierne, Kyrie: tenor entries all have a cue and Latin first letters', async () => {
    const s = await load('library/scores/vierne-kyrie.mxl');
    const map = buildMemoryMap(s, computeSections(s), 'P3', { notation: 'fixed' })!;
    expect(map.sections[0].sings).toBe(false);
    const entries = map.sections.flatMap((x) => x.entries);
    expect(entries.length).toBeGreaterThan(3);
    for (const e of entries) {
      expect(e.cue).toBeDefined();
      expect(e.note).toMatch(/^(Do|Re|Mi|Fa|Sol|La|Si)/);
    }
    expect(entries[0].word).toBe('Kyrie');
    expect(map.sections.some((x) => x.letters.includes('K e,'))).toBe(true);
    expect(map.sections.some((x) => x.letters.includes('C e'))).toBe(true);
  });

  it('warm-up chorale: one entry, no cue for the first note of the piece', async () => {
    const s = await load('public/pieces/warmup-chorale.musicxml');
    const map = buildMemoryMap(s, computeSections(s), 'P1')!;
    expect(map.entryCount).toBe(1);
    const e = map.sections[0].entries[0];
    expect(e.cue).toBeUndefined();
    expect(e.word).toBe('Der');
    expect(e.bar).toBe('0');
    expect(e.beat).toBe('beat 4');
    expect(map.usuallyTop).toBe(true);
    expect(map.sections.every((x) => x.exposed.length === 0)).toBe(true);
  });
});
