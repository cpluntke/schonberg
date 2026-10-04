// Lyrics: words and lines of a singer's part, a multiple-choice quiz to memorise the text,
// and first-letter prompts.
//
// How lyrics are stored (see music/musicxml.ts): each ScoreNote carries at most one syllable in
// `lyric` (first verse, hyphens removed) and `syllabic` ('single' | 'begin' | 'middle' | 'end').
// Melisma notes have no `lyric`. A MusicXML <elision/> (two syllables on one note) is kept as
// "‿" inside the syllable ("que‿il"); an apostrophe elision is ordinary text ("qu'il", "j'ai").
// Some exporters leave hyphens in the text or mark everything 'single'; we accept "Ky-" / "-rie"
// too. MIDI imports have no lyrics at all.
//
// Pure apart from the small localStorage helpers at the end (per piece+part answer counts).

import type { Part, Score, ScoreNote, Section } from '../music/types';
import { beatLength } from '../music/time';

// ---------------------------------------------------------------------------------------------
// Words and lines

export interface LyricWord {
  /** As sung, with punctuation: "Sonner,", "j'ai", "Dieu!". */
  text: string;
  /** Without leading/trailing punctuation: "Sonner". */
  core: string;
  /** Comparison key: lower case, no accents, no punctuation, straight apostrophes. */
  norm: string;
  /** Index into part.notes of the word's first syllable. */
  noteIndex: number;
  /** 0-based measure index of the first syllable. */
  measure: number;
  startBeat: number;
}

export interface LyricLine {
  index: number;
  /** Stable id for stored stats: "<first measure index>:<norm text>". */
  key: string;
  text: string;
  norm: string;
  words: LyricWord[];
  /** 0-based measure indices of the first and last word. */
  startMeasure: number;
  endMeasure: number;
  /** Printed bar number of the first word ("12", "12a"). */
  bar: string;
  /** Score seconds of the first word. */
  start: number;
  /** Index into the sections passed in (-1 when none were given). */
  sectionIndex: number;
  /** "la la la", "lon lon": a vocalise, not text to learn. */
  vocalise: boolean;
}

const APOS = /[’ʼ‘`´]/g;
const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** Lower case, straight apostrophes, accents and punctuation removed. "Là," → "la", "J’ai" → "j'ai". */
export function normWord(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(APOS, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, '')
    .replace(/^'+|'+$/g, '');
}

/** Split a word into leading punctuation, core, trailing punctuation. */
function splitPunct(s: string): { lead: string; core: string; trail: string } {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(s);
  if (!m) return { lead: '', core: s, trail: '' };
  return { lead: m[1], core: m[2], trail: m[3] };
}

const VOCALISE = new Set(['la', 'las', 'lon', 'lo', 'lu', 'li', 'loum', 'ah', 'a', 'o', 'oh', 'ooh', 'oo', 'u', 'ou', 'm', 'mm', 'mmm', 'hm', 'hmm', 'hum', 'n', 'ng', 'ha', 'da', 'du', 'doo', 'dum', 'ba', 'bom', 'bum', 'pa', 'ta', 'ti', 'ra', 'aah']);

function isVocalise(words: LyricWord[]): boolean {
  if (!words.length) return true;
  if (words.every((w) => VOCALISE.has(w.norm) || !w.norm)) return true;
  const distinct = new Set(words.map((w) => w.norm));
  return distinct.size === 1 && words.length >= 3;
}

/** Words of a part in order, with syllables joined. */
export function lyricWords(part: Part): LyricWord[] {
  const out: LyricWord[] = [];
  const notes = part.notes;
  let open: { text: string; noteIndex: number } | null = null;
  const flush = () => {
    if (!open) return;
    const text = open.text.replace(/\s+/g, ' ').trim();
    if (text && /[\p{L}\p{N}]/u.test(text)) {
      const n = notes[open.noteIndex];
      const { core } = splitPunct(text);
      out.push({ text, core, norm: normWord(text), noteIndex: open.noteIndex, measure: n.measure, startBeat: n.startBeat });
    }
    open = null;
  };
  notes.forEach((n, i) => {
    let raw = n.lyric;
    if (raw == null) return;
    raw = raw.replace(/­/g, '').trim();
    if (!raw || /^[_\-–—\s]+$/.test(raw)) return; // extender or hyphen only
    let syl: ScoreNote['syllabic'] = n.syllabic ?? 'single';
    // Hyphens left in the text: "Ky-" begins/continues a word, "-rie" continues one.
    const leadHyphen = /^[-–]/.test(raw);
    const trailHyphen = /[-–]$/.test(raw);
    raw = raw.replace(/^[-–]+|[-–]+$/g, '');
    // A word left open by 'begin'/'middle' can't be followed by a 'single': editions that mark
    // "Son-ner" as begin + single mean begin + end.
    if (syl === 'single' && open && !leadHyphen) syl = 'end';
    if (leadHyphen || trailHyphen) {
      if (leadHyphen && trailHyphen) syl = 'middle';
      else if (trailHyphen) syl = open && syl !== 'begin' ? 'middle' : 'begin';
      else syl = 'end';
    }
    // "que‿il" (elision) or "a b" (two texts on one note) → several words.
    // "gib,und" (missing space after punctuation) → two words too.
    const pieces = raw.replace(/([,;:!?])(?=\p{L})/gu, '$1 ').split(/[\s‿]+/).filter(Boolean);
    pieces.forEach((p, k) => {
      const first = k === 0;
      const last = k === pieces.length - 1;
      // A word doesn't continue after punctuation ("gib," + "und" marked begin/end).
      const continues = first && (syl === 'middle' || syl === 'end') && open && !/[,;:!?.]$/.test(open.text);
      if (continues) open!.text += p;
      else {
        flush();
        open = { text: p, noteIndex: i };
      }
      if (!last || syl === 'single' || syl === 'end') flush();
    });
  });
  flush();
  return out;
}

const BREAK_PUNCT = /[,;:.!?…]["'»”’)\]]*$/;

function sectionOf(sections: Section[], start: number): number {
  let before = -1;
  for (let i = 0; i < sections.length; i++) {
    if (start >= sections[i].start - 1e-6 && start < sections[i].end - 1e-6) return i;
    if (sections[i].start <= start) before = i;
  }
  return sections.length ? Math.max(0, before) : -1;
}

/**
 * Lyric lines of a part: words split at rests of about a beat or more, at punctuation
 * (, ; : . ! ?) and at section boundaries. One-word lines ("Dieu!") join the next line of the same
 * section; very long lines are halved.
 */
export function lyricLines(score: Score, part: Part, sections: Section[] = []): LyricLine[] {
  const words = lyricWords(part);
  if (!words.length) return [];
  const notes = part.notes;
  const ms = score.measures;
  const beatAt = (measure: number) => beatLength(ms[measure]?.timeSig ?? [4, 4]);
  // Longest rest between note a and note b (exclusive of b's own start), in quarter beats.
  const restBetween = (a: number, b: number): number => {
    let maxEnd = -Infinity;
    let rest = 0;
    for (let k = a; k < b; k++) {
      maxEnd = Math.max(maxEnd, notes[k].startBeat + notes[k].durBeats);
      rest = Math.max(rest, notes[k + 1].startBeat - maxEnd);
    }
    return rest;
  };

  // hard: the line starts after a long rest (≥ 2 beats). joined: only a section boundary
  // separated it from the previous line (a pickup word like "der" belongs to the next phrase).
  type Raw = { words: LyricWord[]; section: number; hard: boolean; joined?: boolean };
  const raw: Raw[] = [];
  let cur: LyricWord[] = [];
  let curSection = sectionOf(sections, notes[words[0].noteIndex].start);
  let hardBefore = true;
  let joinedBefore = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const sec = sectionOf(sections, notes[w.noteIndex].start);
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const rest = restBetween(prev.noteIndex, w.noteIndex);
      const restBreak = rest >= 0.9 * beatAt(w.measure) - 1e-6;
      const punct = BREAK_PUNCT.test(prev.text);
      const secBreak = sec !== curSection;
      if (restBreak || punct || secBreak) {
        raw.push({ words: cur, section: curSection, hard: hardBefore, joined: joinedBefore });
        hardBefore = rest >= 2 * beatAt(w.measure) - 1e-6;
        joinedBefore = secBreak && !restBreak && !punct;
        cur = [];
      }
    }
    curSection = sec;
    cur.push(w);
  }
  if (cur.length) raw.push({ words: cur, section: curSection, hard: hardBefore, joined: joinedBefore });

  // Merge one-word lines ("Dieu!", "De", "Kyrie") into the next line of the same section, or into
  // the next section's first line when only the section boundary split them (pickups).
  // Vocalise syllables ("A", "la") stay on their own.
  const merged: Raw[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const next = raw[i + 1];
    if (r.words.length === 1 && next && !isVocalise(r.words) && !isVocalise(next.words) && (next.section === r.section || next.joined)) {
      next.words = [...r.words, ...next.words];
      next.hard = r.hard;
      next.joined = r.joined;
      continue;
    }
    merged.push(r);
  }
  // Halve very long lines.
  const MAX_WORDS = 12;
  const split: Raw[] = [];
  const pushSplit = (r: Raw) => {
    if (r.words.length <= MAX_WORDS) { split.push(r); return; }
    const mid = Math.ceil(r.words.length / 2);
    pushSplit({ ...r, words: r.words.slice(0, mid) });
    pushSplit({ ...r, words: r.words.slice(mid), hard: false });
  };
  merged.forEach(pushSplit);

  return split.map((r, index) => {
    const ws = r.words;
    const text = ws.map((w) => w.text).join(' ');
    const norm = ws.map((w) => w.norm).filter(Boolean).join(' ');
    const first = ws[0];
    return {
      index,
      key: `${first.measure}:${norm}`,
      text,
      norm,
      words: ws,
      startMeasure: first.measure,
      endMeasure: ws[ws.length - 1].measure,
      bar: ms[first.measure]?.number ?? String(first.measure + 1),
      start: notes[first.noteIndex].start,
      sectionIndex: r.section,
      vocalise: isVocalise(ws),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// First letters

export interface FirstLettersOptions {
  /**
   * Apostrophe elisions: 'split' (default) keeps the first letter of both halves, so
   * "qu'il" → "q'i", "j'ai" → "j'a", "s'en" → "s'e", "ist's" → "i's". This keeps every sung word
   * visible (the elided "qu'" is a syllable in its own right) and still reads as one token.
   * 'first' keeps only the first letter: "qu'il" → "q".
   */
  elision?: 'split' | 'first';
}

function firstLettersOfWord(token: string, opts: FirstLettersOptions): string {
  const { lead, core, trail } = splitPunct(token.replace(APOS, "'"));
  if (!core) return token; // punctuation only ("–", "…")
  // Hyphenated compounds and ‿ elisions: first letter of each part ("Jean-Pierre" → "J-P").
  const joined = core.split(/([-‿])/).map((seg) => {
    if (seg === '-' || seg === '‿') return seg;
    const parts = seg.split("'");
    const letters = parts.map((p) => [...p].find(isLetter) ?? '');
    if (opts.elision === 'first') return letters.find(Boolean) ?? '';
    // "'s" (leading apostrophe) keeps it: "'s".
    return letters.map((l, i) => (i === 0 ? l : "'" + l)).join('');
  }).join('');
  return lead + joined + trail;
}

/**
 * First-letter prompt for a line of text: "Quant j'ai ouy le tabourin" → "Q j'a o l t".
 * Case and punctuation are kept ("Sonner, pour" → "S, p"); see FirstLettersOptions for elisions.
 */
export function firstLetters(text: string, opts: FirstLettersOptions = {}): string {
  return text
    .normalize('NFC')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => firstLettersOfWord(t, opts))
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------------------------
// Quiz

export type QuizKind = 'missing' | 'next' | 'letters';

export interface QuizQuestion {
  id: string;
  kind: QuizKind;
  /** The text shown: the line with "____" (missing), the line (next), its first letters (letters). */
  prompt: string;
  choices: string[];
  /** Index of the right choice. */
  answer: number;
  /** The line the question is about (for "next": the line to find). */
  lineIndex: number;
  lineKey: string;
  /** The full line, shown after answering. */
  lineText: string;
  /** Bar of that line. */
  bar: string;
  /** Bar of the text shown in the prompt (differs from `bar` for "next"). */
  promptBar: string;
  /** Missing word: the blanked word's norm (for stats). */
  wordNorm?: string;
}

export interface QuizStats {
  v: 1;
  /** line key → [right, wrong] */
  lines: Record<string, [number, number]>;
  /** word norm → [right, wrong] */
  words: Record<string, [number, number]>;
  rounds: number;
  lastScore?: number;
  bestScore?: number;
}

export function emptyStats(): QuizStats {
  return { v: 1, lines: {}, words: {}, rounds: 0 };
}

export interface QuizOptions {
  count?: number;
  /** Deterministic questions for a given seed. */
  seed?: number;
  stats?: QuizStats;
  kinds?: QuizKind[];
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rand: () => number): T | undefined {
  if (!items.length) return undefined;
  const ws = items.map((t) => Math.max(0, weight(t)));
  const total = ws.reduce((s, w) => s + w, 0);
  if (total <= 0) return items[Math.floor(rand() * items.length)];
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Lines and words answered wrong before are picked more often; well-known ones less. */
function missWeight(rw: [number, number] | undefined): number {
  if (!rw) return 1;
  const [right, wrong] = rw;
  return Math.max(0.25, 1 + 2.5 * wrong - 0.4 * right);
}

const cap = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);
const lettersKey = (s: string) => normWord(firstLetters(s).replace(/\s+/g, '_')).replace(/_/g, ' ');

/** Build a round of questions from a part's lyric lines. Empty when there's no usable text. */
export function makeQuiz(allLines: LyricLine[], opts: QuizOptions = {}): QuizQuestion[] {
  const count = opts.count ?? 10;
  const rand = rng(opts.seed ?? Math.floor(Math.random() * 2 ** 32));
  const stats = opts.stats ?? emptyStats();
  const kindsAllowed = opts.kinds ?? ['missing', 'next', 'letters'];
  const lines = allLines.filter((l) => !l.vocalise && l.norm);
  if (!lines.length) return [];

  const lineNorms = new Set(lines.map((l) => l.norm));
  // Distinct lines by text (no "Kyrie eleison" ×6 among the options).
  const distinctLines: LyricLine[] = [];
  const seenNorm = new Set<string>();
  for (const l of lines) if (!seenNorm.has(l.norm)) { seenNorm.add(l.norm); distinctLines.push(l); }
  // What follows each line text anywhere in the piece (so "next" questions stay unambiguous).
  const followers = new Map<string, Set<string>>();
  lines.forEach((l, i) => {
    const nx = lines[i + 1];
    if (!nx) return;
    if (!followers.has(l.norm)) followers.set(l.norm, new Set());
    followers.get(l.norm)!.add(nx.norm);
  });
  // Distinct words with a natural display form (case as written mid-line when we have it).
  const wordForm = new Map<string, { core: string; midLine: boolean }>();
  for (const l of lines) {
    l.words.forEach((w, i) => {
      if (!w.norm || VOCALISE.has(w.norm)) return;
      const cur = wordForm.get(w.norm);
      if (!cur || (!cur.midLine && i > 0)) wordForm.set(w.norm, { core: w.core, midLine: i > 0 });
    });
  }
  // Languages that capitalise nouns (German): keep line-initial words as written, else a
  // lower-cased "gott" among "Geist" and "Herz" gives the answer away.
  const mid = lines.flatMap((l) => l.words.slice(1));
  const capitalising = mid.length > 0 && mid.filter((w) => /^\p{Lu}/u.test(w.core)).length / mid.length > 0.12;
  const display = (norm: string) => {
    const f = wordForm.get(norm);
    if (!f) return norm;
    return f.midLine || capitalising ? f.core : f.core.toLocaleLowerCase();
  };
  const allWords = [...wordForm.keys()];

  const lineWeight = (l: LyricLine) => {
    let w = missWeight(stats.lines[l.key]);
    for (const x of l.words) if (stats.words[x.norm]?.[1]) w += 0.5 * stats.words[x.norm][1];
    return w;
  };

  const build = (kind: QuizKind, l: LyricLine): QuizQuestion | null => {
    const li = lines.indexOf(l);
    const base = { lineIndex: l.index, lineKey: l.key, bar: l.bar, promptBar: l.bar };
    if (kind === 'missing') {
      if (l.words.length < 2) return null;
      const cands = l.words.map((w, i) => ({ w, i })).filter(({ w }) => w.norm && !VOCALISE.has(w.norm) && w.core.length >= 2);
      const pick = weightedPick(cands, ({ w }) => missWeight(stats.words[w.norm]) * (w.core.length >= 4 ? 1.5 : 1), rand);
      if (!pick) return null;
      const { w, i: wi } = pick;
      const inLine = new Set(l.words.map((x) => x.norm));
      const fillNorm = (n: string) => l.words.map((x, k) => (k === wi ? n : x.norm)).filter(Boolean).join(' ');
      const pool = allWords.filter((n) => n !== w.norm && !inLine.has(n) && !lineNorms.has(fillNorm(n)));
      if (pool.length < 2) return null;
      const len = w.core.length;
      const near = shuffle(pool, rand).sort((a, b) => Math.abs(a.length - len) - Math.abs(b.length - len)).slice(0, 8);
      const distractors = shuffle(near, rand).slice(0, 3);
      const atStart = wi === 0;
      const show = (n: string, core?: string) => (atStart ? cap(core ?? display(n)) : core ?? display(n));
      const right = atStart ? cap(w.core) : w.core;
      const options = shuffle([right, ...distractors.map((n) => show(n))], rand);
      // Never two options that read the same.
      if (new Set(options.map(normWord)).size !== options.length) return null;
      const { lead, trail } = splitPunct(w.text);
      const prompt = l.words.map((x, k) => (k === wi ? `${lead}____${trail}` : x.text)).join(' ');
      return { ...base, id: `missing:${l.key}:${w.norm}`, kind, prompt, choices: options, answer: options.indexOf(right), lineText: l.text, wordNorm: w.norm };
    }
    if (kind === 'next') {
      const nx = lines[li + 1];
      if (!nx || li < 0) return null;
      const bad = followers.get(l.norm) ?? new Set([nx.norm]);
      const pool = distinctLines.filter((x) => !bad.has(x.norm) && x.norm !== nx.norm);
      if (pool.length < 2) return null;
      // Prefer lines of a similar length.
      const near = shuffle(pool, rand).sort((a, b) => Math.abs(a.words.length - nx.words.length) - Math.abs(b.words.length - nx.words.length)).slice(0, 6);
      const options = shuffle([nx.text, ...shuffle(near, rand).slice(0, 2).map((x) => x.text)], rand);
      return { ...base, lineIndex: nx.index, lineKey: nx.key, bar: nx.bar, id: `next:${l.key}`, kind, prompt: l.text, choices: options, answer: options.indexOf(nx.text), lineText: nx.text };
    }
    // letters
    if (l.words.length < 2) return null;
    const key = lettersKey(l.text);
    const pool = distinctLines.filter((x) => x.norm !== l.norm && lettersKey(x.text) !== key);
    if (pool.length < 2) return null;
    const near = shuffle(pool, rand).sort((a, b) => Math.abs(a.words.length - l.words.length) - Math.abs(b.words.length - l.words.length)).slice(0, 6);
    const picked = shuffle(near, rand).slice(0, 2);
    if (new Set(picked.map((x) => lettersKey(x.text))).size < picked.length) return null;
    const options = shuffle([l.text, ...picked.map((x) => x.text)], rand);
    return { ...base, id: `letters:${l.key}`, kind, prompt: firstLetters(l.text), choices: options, answer: options.indexOf(l.text), lineText: l.text };
  };

  const out: QuizQuestion[] = [];
  const usedIds = new Set<string>();
  const usedLineNorm = new Map<string, number>();
  const kindWeights: Record<QuizKind, number> = { missing: 4, next: 3, letters: 3 };
  let attempts = 0;
  while (out.length < count && attempts < count * 40) {
    attempts++;
    const kind = weightedPick(kindsAllowed, (k) => kindWeights[k], rand)!;
    // Fresh lines first; a line text may come back (with another kind) once fresh ones run out.
    const minUse = Math.min(...distinctLines.map((x) => usedLineNorm.get(x.norm) ?? 0));
    const fresh = lines.filter((x) => (usedLineNorm.get(x.norm) ?? 0) <= minUse);
    const l = weightedPick(fresh, lineWeight, rand);
    if (!l) break;
    const q = build(kind, l);
    if (!q || usedIds.has(q.id)) continue;
    usedIds.add(q.id);
    usedLineNorm.set(l.norm, (usedLineNorm.get(l.norm) ?? 0) + 1);
    out.push(q);
  }
  return out;
}

/** Convenience: lines + quiz for a part of a score. */
export function lyricsQuiz(score: Score, partId: string, sections: Section[] = [], opts: QuizOptions = {}): QuizQuestion[] {
  const part = score.parts.find((p) => p.id === partId);
  if (!part) return [];
  return makeQuiz(lyricLines(score, part, sections), opts);
}

/** Whether the part has text worth quizzing (not just "la la"). */
export function hasLyrics(lines: LyricLine[]): boolean {
  return lines.some((l) => !l.vocalise && l.norm);
}

// ---------------------------------------------------------------------------------------------
// Stats (localStorage `sh:lyricsQuiz:<pieceId>:<partId>`)

export const statsKey = (pieceId: string, partId: string) => `sh:lyricsQuiz:${pieceId}:${partId}`;

export function applyAnswer(stats: QuizStats, q: QuizQuestion, correct: boolean): QuizStats {
  const bump = (rec: Record<string, [number, number]>, k: string) => {
    const [r, w] = rec[k] ?? [0, 0];
    rec[k] = correct ? [r + 1, w] : [r, w + 1];
  };
  const s: QuizStats = { ...stats, lines: { ...stats.lines }, words: { ...stats.words } };
  bump(s.lines, q.lineKey);
  if (q.wordNorm) bump(s.words, q.wordNorm);
  return s;
}

export function loadQuizStats(pieceId: string, partId: string): QuizStats {
  try {
    const raw = localStorage.getItem(statsKey(pieceId, partId));
    if (!raw) return emptyStats();
    const v = JSON.parse(raw);
    if (!v || v.v !== 1 || typeof v.lines !== 'object' || typeof v.words !== 'object') return emptyStats();
    return { ...emptyStats(), ...v };
  } catch {
    return emptyStats();
  }
}

export function saveQuizStats(pieceId: string, partId: string, stats: QuizStats): void {
  try { localStorage.setItem(statsKey(pieceId, partId), JSON.stringify(stats)); } catch { /* storage blocked / full */ }
}

/** Record one answer and persist it. Returns the new stats. */
export function recordAnswer(pieceId: string, partId: string, q: QuizQuestion, correct: boolean): QuizStats {
  const s = applyAnswer(loadQuizStats(pieceId, partId), q, correct);
  saveQuizStats(pieceId, partId, s);
  return s;
}

/** Record a finished round (count of rounds, last and best score). */
export function recordRound(pieceId: string, partId: string, score: number): QuizStats {
  const s = loadQuizStats(pieceId, partId);
  const next: QuizStats = { ...s, rounds: s.rounds + 1, lastScore: score, bestScore: Math.max(score, s.bestScore ?? 0) };
  saveQuizStats(pieceId, partId, next);
  return next;
}
