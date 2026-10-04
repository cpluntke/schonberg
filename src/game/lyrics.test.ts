import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { importScoreFile } from '../music/import';
import { computeSections } from '../music/sections';
import type { Part, Score, ScoreNote } from '../music/types';
import { makePart, makeScore } from './testutil';
import {
  firstLetters, lyricWords, lyricLines, makeQuiz, lyricsQuiz, normWord, hasLyrics,
  loadQuizStats, recordAnswer, recordRound, statsKey, emptyStats, applyAnswer, type QuizQuestion,
} from './lyrics';

async function load(file: string): Promise<Score> {
  const buf = readFileSync(file);
  return importScoreFile(file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** Part from [midi|null, beats, syllable?, syllabic?] (4/4, 60 bpm). */
function lyricPart(spec: [number | null, number, string?, ScoreNote['syllabic']?][]): Part {
  const p = makePart('S', spec.map(([m, b]) => [m, b]));
  let k = 0;
  for (const [m, , syl, sy] of spec) {
    if (m === null) continue;
    if (syl !== undefined) { p.notes[k].lyric = syl; p.notes[k].syllabic = sy ?? 'single'; }
    k++;
  }
  return p;
}

function checkQuestion(q: QuizQuestion) {
  expect(q.answer).toBeGreaterThanOrEqual(0);
  expect(q.answer).toBeLessThan(q.choices.length);
  expect(q.choices.length).toBeGreaterThanOrEqual(3);
  // never two choices that read the same
  const norms = q.choices.map((c) => c.split(/\s+/).map(normWord).join(' '));
  expect(new Set(norms).size).toBe(q.choices.length);
  if (q.kind === 'missing') {
    expect(q.prompt).toContain('____');
    expect(q.choices.length).toBe(4);
  }
  if (q.kind === 'letters') {
    // only the right line has these first letters
    const same = q.choices.filter((c) => normWord(firstLetters(c).replace(/\s/g, '_')) === normWord(q.prompt.replace(/\s/g, '_')));
    expect(same).toEqual([q.choices[q.answer]]);
  }
}

describe('firstLetters', () => {
  it('keeps case and punctuation', () => {
    expect(firstLetters('Quant j\'ai ouy le tabourin')).toBe("Q j'a o l t");
    expect(firstLetters('Sonner, pour s\'en aller au may,')).toBe("S, p s'e a a m,");
    expect(firstLetters('Dieu! qu\'il la fait bon regarder!')).toBe("D! q'i l f b r!");
    expect(firstLetters('  Kyrie   eleison. ')).toBe('K e.');
  });
  it('handles elisions, curly apostrophes, hyphens and accents', () => {
    expect(firstLetters('qu’il')).toBe("q'i");
    expect(firstLetters("qu'il", { elision: 'first' })).toBe('q');
    expect(firstLetters("ist's")).toBe("i's");
    expect(firstLetters("Schaff' in mir")).toBe("S' i m");
    expect(firstLetters('Jean-Pierre')).toBe('J-P');
    expect(firstLetters('que‿il')).toBe('q‿i');
    expect(firstLetters('Écoutez «Ô ciel»')).toBe('É «Ô c»');
    expect(firstLetters('weiße Nebel')).toBe('w N');
    expect(firstLetters('— ...chenu')).toBe('— ...c');
    expect(firstLetters('')).toBe('');
  });
});

describe('lyric words and lines', () => {
  it('joins syllables into words, including hyphens left in the text and elisions', () => {
    const p = lyricPart([
      [60, 1, 'Ky', 'begin'], [62, 1, 'ri', 'middle'], [64, 1, 'e', 'end'], [65, 1, 'e', 'begin'],
      [67, 1, 'le', 'middle'], [65, 1], [64, 1, 'i', 'middle'], [62, 1, 'son,', 'end'],
      [60, 1, 'Chri-', 'single'], [60, 1, '-ste', 'single'], [60, 1, 'que‿il', 'single'], [60, 1, 'Son', 'begin'], [60, 1, 'ner', 'single'],
    ]);
    expect(lyricWords(p).map((w) => w.text)).toEqual(['Kyrie', 'eleison,', 'Christe', 'que', 'il', 'Sonner']);
    expect(lyricWords(p)[1].core).toBe('eleison');
  });

  it('splits lines at rests of a beat, punctuation and sections; joins one-word lines', () => {
    const p = lyricPart([
      [60, 1, 'Dieu!'], [62, 1, 'qu\'il'], [64, 1, 'la'], [65, 1, 'fait'], // bar 1
      [null, 1], [67, 1, 'bon'], [65, 1, 're', 'begin'], [64, 1, 'gar', 'middle'], // bar 2: rest
      [62, 2, 'der,', 'end'], [60, 1, 'La'], [62, 1, 'gra', 'begin'], // bar 3: punctuation
      [64, 1, 'cieuse', 'end'], [65, 1, 'bonne'], [67, 2, 'belle.'], // bar 4
    ]);
    const s = makeScore([p]);
    const lines = lyricLines(s, p);
    expect(lines.map((l) => l.text)).toEqual(["Dieu! qu'il la fait", 'bon regarder,', 'La gracieuse bonne belle.']);
    expect(lines.map((l) => l.bar)).toEqual(['1', '2', '3']);
    // a section boundary at bar 4 splits too
    const secs = [
      { id: 'a', index: 0, label: 'A', startMeasure: 0, endMeasure: 2, start: 0, end: 12 },
      { id: 'b', index: 1, label: 'B', startMeasure: 3, endMeasure: 3, start: 12, end: 16 },
    ];
    const l2 = lyricLines(s, p, secs);
    expect(l2.map((l) => l.text)).toEqual(["Dieu! qu'il la fait", 'bon regarder,', 'La gracieuse', 'bonne belle.']);
    expect(l2.map((l) => l.sectionIndex)).toEqual([0, 0, 0, 1]);
  });

  it('no lyrics → no lines and no questions', () => {
    const p = makePart('S', [[60, 1], [62, 1], [64, 2]]);
    const s = makeScore([p]);
    expect(lyricLines(s, p)).toEqual([]);
    expect(lyricsQuiz(s, 'S')).toEqual([]);
    expect(lyricsQuiz(s, 'nope')).toEqual([]);
  });
});

describe('quiz on real pieces', () => {
  let tabourin: Score;
  let kyrie: Score;
  let chorale: Score;
  beforeEach(async () => {
    tabourin ??= await load('public/pieces/pd/debussy-tabourin.mxl');
    kyrie ??= await load('public/pieces/pd/vierne-kyrie.mxl');
    chorale ??= await load('public/pieces/warmup-chorale.musicxml');
  });

  it('reads the French alto solo as lines of whole words', () => {
    const solo = tabourin.parts.find((p) => p.name === 'Alto Solo')!;
    const lines = lyricLines(tabourin, solo, computeSections(tabourin));
    expect(lines[0].text).toBe("Quant j'ai ouy le tabourin Sonner,");
    expect(lines[0].bar).toBe('5');
    expect(firstLetters(lines[0].text)).toBe("Q j'a o l t S,");
    expect(lines.some((l) => l.text === 'Ne levé mon chief du coissin;')).toBe(true);
    expect(hasLyrics(lines)).toBe(true);
  });

  it('a humming part ("la la la") has nothing to quiz', () => {
    const alto1 = tabourin.parts.find((p) => p.name === 'Alto 1')!;
    const lines = lyricLines(tabourin, alto1);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.vocalise)).toBe(true);
    expect(hasLyrics(lines)).toBe(false);
    expect(makeQuiz(lines, { seed: 1 })).toEqual([]);
  });

  it('builds 10 valid questions, deterministic for a seed', () => {
    const solo = tabourin.parts.find((p) => p.name === 'Alto Solo')!;
    const secs = computeSections(tabourin);
    const a = lyricsQuiz(tabourin, solo.id, secs, { seed: 42 });
    const b = lyricsQuiz(tabourin, solo.id, secs, { seed: 42 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
    expect(new Set(a.map((q) => q.id)).size).toBe(10);
    expect(new Set(a.map((q) => q.kind))).toEqual(new Set(['missing', 'next', 'letters']));
    a.forEach(checkQuestion);
    const c = lyricsQuiz(tabourin, solo.id, secs, { seed: 43 });
    expect(c.map((q) => q.id)).not.toEqual(a.map((q) => q.id));
  });

  it('many seeds: every question well-formed (French, German, Latin)', () => {
    for (const [score, partIds] of [[tabourin, ['P1']], [chorale, ['P1', 'P4']], [kyrie, ['P1', 'P2', 'P3', 'P4']]] as const) {
      for (const pid of partIds) {
        for (let seed = 0; seed < 25; seed++) lyricsQuiz(score, pid, computeSections(score), { seed }).forEach(checkQuestion);
      }
    }
  });

  it('Kyrie: "Kyrie eleison / Christe eleison" is too little text for unambiguous questions', () => {
    const lines = lyricLines(kyrie, kyrie.parts[0], computeSections(kyrie));
    expect(hasLyrics(lines)).toBe(true);
    expect(new Set(lines.map((l) => l.norm))).toEqual(new Set(['kyrie eleison', 'christe eleison']));
    // "Kyrie eleison" is followed by both lines somewhere, and only two distinct lines exist:
    // no question with three different, unambiguous options can be made.
    for (let seed = 0; seed < 10; seed++) expect(lyricsQuiz(kyrie, 'P1', computeSections(kyrie), { seed })).toEqual([]);
  });

  it('repeated lines are never offered twice among the options', () => {
    // A short Latin text with repeats: "Kyrie eleison" ×3, then two other lines.
    const words: [string, 'single' | 'begin' | 'middle' | 'end'][] = [];
    const add = (txt: string) => txt.split(' ').forEach((w) => words.push([w, 'single']));
    add('Kyrie eleison, Kyrie eleison, Kyrie eleison, Christe eleison, Christe audi nos, Agnus Dei qui tollis, Dona nobis pacem.');
    const p = lyricPart(words.map(([w, sy]) => [60, 1, w, sy]));
    const s = makeScore([p]);
    for (let seed = 0; seed < 30; seed++) {
      for (const q of makeQuiz(lyricLines(s, p), { seed })) {
        checkQuestion(q);
        if (q.kind === 'next' && /^Kyrie/.test(q.prompt)) {
          const wrong = q.choices.filter((_, i) => i !== q.answer).map((c) => c.split(/\s+/).map(normWord).join(' '));
          expect(wrong).not.toContain('kyrie eleison');
          expect(wrong).not.toContain('christe eleison');
        }
      }
    }
  });

  it('German missing words keep their capitals (no lower-cased "gott" among nouns)', () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const q of lyricsQuiz(chorale, 'P1', [], { seed, kinds: ['missing'] })) {
        for (const c of q.choices) if (['mond', 'himmel', 'wald', 'nebel', 'wiesen'].includes(normWord(c))) expect(c[0]).toBe(c[0].toUpperCase());
      }
    }
  });

  it('prefers lines answered wrong before', () => {
    const solo = tabourin.parts.find((p) => p.name === 'Alto Solo')!;
    const lines = lyricLines(tabourin, solo);
    const target = lines.find((l) => l.text.startsWith('Jeunes'))!;
    let stats = emptyStats();
    const fake = { lineKey: target.key, wordNorm: 'butin' } as QuizQuestion;
    for (let i = 0; i < 5; i++) stats = applyAnswer(stats, fake, false);
    let withStats = 0;
    let without = 0;
    for (let seed = 0; seed < 40; seed++) {
      const has = (qs: QuizQuestion[]) => qs.filter((q) => q.lineKey === target.key || q.prompt.startsWith('Jeunes')).length;
      withStats += has(makeQuiz(lines, { seed, count: 4, stats }));
      without += has(makeQuiz(lines, { seed, count: 4 }));
    }
    expect(withStats).toBeGreaterThan(without);
  });
});

describe('quiz stats storage', () => {
  beforeEach(() => localStorage.clear());
  it('records answers and rounds per piece and part', () => {
    const q = { lineKey: '4:quant', wordNorm: 'tabourin' } as QuizQuestion;
    recordAnswer('debussy-tabourin', 'P1', q, false);
    recordAnswer('debussy-tabourin', 'P1', q, true);
    recordRound('debussy-tabourin', 'P1', 7);
    const s = loadQuizStats('debussy-tabourin', 'P1');
    expect(s.lines['4:quant']).toEqual([1, 1]);
    expect(s.words.tabourin).toEqual([1, 1]);
    expect(s.rounds).toBe(1);
    expect(s.bestScore).toBe(7);
    expect(localStorage.getItem(statsKey('debussy-tabourin', 'P1'))).toBeTruthy();
    expect(statsKey('x', 'y')).toBe('sh:lyricsQuiz:x:y');
    expect(loadQuizStats('debussy-tabourin', 'P2')).toEqual(emptyStats());
  });
  it('survives corrupt data', () => {
    localStorage.setItem(statsKey('p', 'a'), '{not json');
    expect(loadQuizStats('p', 'a')).toEqual(emptyStats());
    localStorage.setItem(statsKey('p', 'a'), '{"v":2}');
    expect(loadQuizStats('p', 'a')).toEqual(emptyStats());
  });
});
