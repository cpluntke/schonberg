// Memory map: a one-page outline of a piece from one singer's point of view, to read before
// sleeping or print. Per section: bars, key / metre / tempo changes, the singer's entries (bar,
// first word, first note, and the cue: who sounds just before, on what note, and the interval to
// the entry note), where the part is exposed or rests for long, where it is the top voice, the
// range, and the text as first letters.
//
// Pure: no DOM, no storage.

import type { KeySig, Part, Score, Section } from '../music/types';
import { beatLength, keyAtTime } from '../music/time';
import { intervalLongName, keyName, noteLabel, spellPc, type NotationMode } from './notation';
import { firstLetters, lyricLines, type LyricLine } from './lyrics';

export interface MapCue {
  partId: string;
  partName: string;
  midi: number;
  /** Note name in the chosen notation. */
  note: string;
  /** Entry note minus cue note, in semitones. */
  semitones: number;
  /** "a fifth up from the tenors' E", "the same note as the organ's B". */
  text: string;
}

export interface MapEntry {
  noteIndex: number;
  measure: number;
  /** Printed bar number. */
  bar: string;
  /** "beat 3", "beat 2½", "after beat 1". */
  beat: string;
  time: number;
  /** First lyric word sung on the entry ("Quant"), when there is one. */
  word?: string;
  midi: number;
  note: string;
  /** Rest before the entry in quarter beats (null for the very first note). */
  restBeats: number | null;
  cue?: MapCue;
}

export interface MapChange {
  kind: 'key' | 'time' | 'tempo';
  measure: number;
  bar: string;
  text: string;
}

export interface MapSpan {
  /** Inclusive 0-based measure indices. */
  from: number;
  to: number;
  /** "bar 12" / "bars 12–15" */
  bars: string;
  /** Number of bars. */
  length: number;
  /** For exposed spans: an instrument still plays (you are the only *voice*). */
  accompanied?: boolean;
}

export interface MapRange {
  low: number;
  high: number;
  lowName: string;
  highName: string;
}

export interface MapSection {
  id: string;
  index: number;
  label: string;
  bars: string;
  startMeasure: number;
  endMeasure: number;
  /** Whether the part sings at all in this section. */
  sings: boolean;
  changes: MapChange[];
  entries: MapEntry[];
  /** You sound and no other voice does, for a bar or more. */
  exposed: MapSpan[];
  /** You rest for two bars or more (spans are listed in the section where they start). */
  rests: MapSpan[];
  /** You are the highest voice for three bars or more ("you have the tune"). */
  tune: MapSpan[];
  range: MapRange | null;
  /** Lyric lines of the section (vocalise lines included, flagged). */
  lines: { text: string; letters: string; bar: string; vocalise: boolean }[];
  /** All the text as first letters, lines separated by " / ". */
  letters: string;
}

export interface MemoryMap {
  partId: string;
  partName: string;
  /** "D major", "3/4", "♩ = 84" at the start of the piece. */
  start: { key: string; time: string; tempo: string };
  range: MapRange | null;
  entryCount: number;
  /** The part is the top voice most of the time it sings with others (a soprano line). */
  usuallyTop: boolean;
  /** The part has (real) lyrics. */
  hasText: boolean;
  sections: MapSection[];
}

const EPS = 1e-6;

/** Note name in the chosen notation; jianpu octave dots as combining dots. */
export function noteText(midi: number, notation: NotationMode, key: Pick<KeySig, 'fifths' | 'mode'>, withOctave = false): string {
  const l = noteLabel(midi, notation, key);
  if (notation === 'jianpu') return l.text + '̇'.repeat(l.dotsAbove) + '̣'.repeat(l.dotsBelow);
  if (withOctave && notation === 'letter') {
    const s = spellPc(midi, key);
    const octave = Math.floor((Math.round(midi) - s.accidental) / 12) - 1;
    return l.text + octave;
  }
  return l.text;
}

const VOICE_PLURAL: Record<string, string> = {
  soprano: 'sopranos', sopran: 'sopranos', mezzo: 'mezzos', alto: 'altos', alt: 'altos', contralto: 'altos',
  tenor: 'tenors', baritone: 'baritones', bariton: 'baritones', bass: 'basses', bas: 'basses', basso: 'basses',
};

/** "the tenors'", "the Organ's", "the Tenor 1's". */
export function possessive(name: string): string {
  const plural = VOICE_PLURAL[name.trim().toLowerCase()];
  if (plural) return `the ${plural}'`;
  return `the ${name.trim()}'s`;
}

/** "a fifth up", "a minor third down", "an octave up", "two octaves down", "the same note". */
export function intervalPhrase(semitones: number): string {
  if (semitones === 0) return 'the same note';
  let name = intervalLongName(semitones).replace(/^perfect /, '');
  const dir = semitones > 0 ? 'up' : 'down';
  if (/^two /.test(name)) return `${name} ${dir}`;
  name = (/^[aeiou]/.test(name) ? 'an ' : 'a ') + name;
  return `${name} ${dir}`;
}

function barsLabel(score: Score, a: number, b: number): string {
  const n = (i: number) => score.measures[i]?.number ?? String(i + 1);
  return a === b ? `bar ${n(a)}` : `bars ${n(a)}–${n(b)}`;
}

function beatInBar(score: Score, measure: number, startBeat: number): string {
  const m = score.measures[measure];
  if (!m) return '';
  const bl = beatLength(m.timeSig);
  const full = (m.timeSig[0] * 4) / m.timeSig[1];
  // A short first bar is a pickup: count its beats from the end of a full bar.
  const pickup = measure === 0 && m.durBeats < full - EPS ? full - m.durBeats : 0;
  const pos = (startBeat - m.startBeat + pickup) / bl + 1;
  const whole = Math.round(pos);
  if (Math.abs(pos - whole) < 0.02) return `beat ${whole}`;
  const fl = Math.floor(pos);
  if (Math.abs(pos - fl - 0.5) < 0.02) return `beat ${fl}½`;
  return `after beat ${fl}`;
}

interface Iv { s: number; e: number; midi: number }

const isVocal = (p: Part) => p.voiceType !== 'other' || p.notes.some((n) => n.lyric);

/** Notes of each part overlapping each measure. */
function perMeasure(score: Score, part: Part): Iv[][] {
  const out: Iv[][] = score.measures.map(() => []);
  const ms = score.measures;
  for (const n of part.notes) {
    const s = n.startBeat;
    const e = n.startBeat + n.durBeats;
    for (let m = Math.max(0, n.measure); m < ms.length && ms[m].startBeat < e - EPS; m++) {
      if (ms[m].startBeat + ms[m].durBeats > s + EPS) out[m].push({ s, e, midi: n.midi });
    }
  }
  return out;
}

/** Fraction of [a, b) covered by intervals. */
function coverage(ivs: Iv[], a: number, b: number): number {
  const cl = ivs.map((x) => [Math.max(a, x.s), Math.min(b, x.e)] as [number, number]).filter(([s, e]) => e > s + EPS).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curS = -Infinity;
  let curE = -Infinity;
  for (const [s, e] of cl) {
    if (s > curE) {
      if (curE > curS) total += curE - curS;
      curS = s;
      curE = e;
    } else curE = Math.max(curE, e);
  }
  if (curE > curS) total += curE - curS;
  return b > a ? total / (b - a) : 0;
}

function runs(flags: boolean[], minLen: number): [number, number][] {
  const out: [number, number][] = [];
  let a = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) { if (a < 0) a = i; }
    else if (a >= 0) {
      if (i - a >= minLen) out.push([a, i - 1]);
      a = -1;
    }
  }
  return out;
}

/** Spans that start in measures a..b (a span that runs on into the next section stays whole). */
function spansStartingIn(score: Score, rs: [number, number][], a: number, b: number, extra?: (r: [number, number]) => Partial<MapSpan>): MapSpan[] {
  return rs
    .filter((r) => r[0] >= a && r[0] <= b)
    .map((r) => ({ from: r[0], to: r[1], bars: barsLabel(score, r[0], r[1]), length: r[1] - r[0] + 1, ...(extra?.(r) ?? {}) }));
}

const tsText = (ts: [number, number]) => `${ts[0]}/${ts[1]}`;
const bpmText = (bpm: number) => `♩ = ${Math.round(bpm)}`;

export interface MemoryMapOptions {
  notation?: NotationMode;
}

export function buildMemoryMap(score: Score, sections: Section[], partId: string, opts: MemoryMapOptions = {}): MemoryMap | null {
  const part = score.parts.find((p) => p.id === partId);
  if (!part) return null;
  const notation = opts.notation ?? 'letter';
  const ms = score.measures;
  const notes = part.notes;
  const others = score.parts.filter((p) => p.id !== part.id && p.notes.length);
  const otherVocal = others.filter(isVocal);
  const instruments = others.filter((p) => !isVocal(p));
  const keyAt = (t: number) => keyAtTime(score, t);

  // ---- per-measure facts
  const mine = perMeasure(score, part);
  const vocalPM = otherVocal.map((p) => perMeasure(score, p));
  const instrPM = instruments.map((p) => perMeasure(score, p));
  const singCover: number[] = [];
  const exposedFlags: boolean[] = [];
  const accompaniedFlags: boolean[] = [];
  const restFlags: boolean[] = [];
  const topFlags: boolean[] = [];
  const withOthers: boolean[] = [];
  ms.forEach((m, i) => {
    const a = m.startBeat;
    const b = m.startBeat + m.durBeats;
    const cov = coverage(mine[i], a, b);
    singCover.push(cov);
    restFlags.push(mine[i].length === 0);
    const vocalCov = otherVocal.length ? coverage(vocalPM.flatMap((x) => x[i]), a, b) : 0;
    const instrCov = instruments.length ? coverage(instrPM.flatMap((x) => x[i]), a, b) : 0;
    exposedFlags.push(cov >= 0.5 && vocalCov <= 0.1 && score.parts.length > 1);
    accompaniedFlags.push(instrCov > 0.1);
    // Top voice: sample every sixteenth where you and another voice both sound.
    let both = 0;
    let top = 0;
    for (let t = a + 0.125; t < b; t += 0.25) {
      const me = mine[i].filter((x) => x.s <= t && t < x.e).map((x) => x.midi);
      if (!me.length) continue;
      const them = vocalPM.flatMap((x) => x[i]).filter((x) => x.s <= t && t < x.e).map((x) => x.midi);
      if (!them.length) continue;
      both++;
      if (Math.max(...me) >= Math.max(...them)) top++;
    }
    withOthers.push(both >= 4);
    topFlags.push(both >= 4 && top / both >= 0.8);
  });
  const sungWithOthers = withOthers.filter(Boolean).length;
  const usuallyTop = sungWithOthers > 0 && topFlags.filter(Boolean).length / sungWithOthers >= 0.6;
  const exposedRuns = runs(exposedFlags, 1);
  const restRuns = runs(restFlags, 2);
  const tuneRuns = usuallyTop ? [] : runs(topFlags, 3);

  // ---- lyrics
  const lines: LyricLine[] = lyricLines(score, part, sections);
  const hasText = lines.some((l) => !l.vocalise);
  const wordAt = new Map<number, string>();
  for (const l of lines) for (const w of l.words) wordAt.set(w.noteIndex, w.core);

  // ---- entries
  const entries: MapEntry[] = [];
  let maxEnd = -Infinity;
  notes.forEach((n, i) => {
    const restBeats = i === 0 ? null : n.startBeat - maxEnd;
    maxEnd = Math.max(maxEnd, n.startBeat + n.durBeats);
    const bl = beatLength(ms[n.measure]?.timeSig ?? [4, 4]);
    if (restBeats !== null && restBeats < 0.9 * bl - EPS) return;
    const key = keyAt(n.start);
    const entry: MapEntry = {
      noteIndex: i,
      measure: n.measure,
      bar: ms[n.measure]?.number ?? String(n.measure + 1),
      beat: beatInBar(score, n.measure, n.startBeat),
      time: n.start,
      word: wordAt.get(i),
      midi: n.midi,
      note: noteText(n.midi, notation, key),
      restBeats,
    };
    const cue = findCue(score, others, n.startBeat, n.midi, bl);
    if (cue) {
      const semis = n.midi - cue.midi;
      const cueNote = noteText(cue.midi, notation, key);
      const where = `${possessive(cue.part.name)} ${cueNote}`;
      entry.cue = {
        partId: cue.part.id,
        partName: cue.part.name,
        midi: cue.midi,
        note: cueNote,
        semitones: semis,
        text: semis === 0 ? `the same note as ${where}` : `${intervalPhrase(semis)} from ${where}`,
      };
    }
    entries.push(entry);
  });

  // ---- sections
  const rangeOf = (midis: number[], t: number): MapRange | null => {
    if (!midis.length) return null;
    const low = Math.min(...midis);
    const high = Math.max(...midis);
    const key = keyAt(t);
    return { low, high, lowName: noteText(low, notation, key, true), highName: noteText(high, notation, key, true) };
  };

  const mapSections: MapSection[] = sections.map((sec, si) => {
    const a = sec.startMeasure;
    const b = sec.endMeasure;
    const inSec = (t: number) => t >= sec.start - EPS && t < sec.end - EPS;
    const secNotes = notes.filter((n) => inSec(n.start));
    const changes: MapChange[] = [];
    for (const k of score.keys) {
      if (k.beat <= EPS || !inSec(k.time)) continue;
      const m = measureOfBeat(score, k.beat);
      changes.push({ kind: 'key', measure: m, bar: ms[m]?.number ?? '', text: `Key: ${keyName(k)}` });
    }
    for (let m = Math.max(1, a); m <= b; m++) {
      const p = ms[m - 1].timeSig;
      const c = ms[m].timeSig;
      if (p[0] !== c[0] || p[1] !== c[1]) changes.push({ kind: 'time', measure: m, bar: ms[m].number, text: `Time: ${tsText(c)}` });
    }
    const tempos = score.tempos.filter((t) => t.beat > EPS && inSec(t.time));
    if (tempos.length > 3) {
      const bpms = tempos.map((t) => Math.round(t.bpm));
      const m = measureOfBeat(score, tempos[0].beat);
      changes.push({ kind: 'tempo', measure: m, bar: ms[m]?.number ?? '', text: `Tempo varies: ♩ = ${Math.min(...bpms)}–${Math.max(...bpms)}` });
    } else {
      for (const t of tempos) {
        const prev = score.tempos.filter((x) => x.beat < t.beat - EPS).pop();
        const m = measureOfBeat(score, t.beat);
        const word = prev ? (t.bpm > prev.bpm + 0.5 ? 'Faster' : t.bpm < prev.bpm - 0.5 ? 'Slower' : 'Tempo') : 'Tempo';
        changes.push({ kind: 'tempo', measure: m, bar: ms[m]?.number ?? '', text: `${word}: ${bpmText(t.bpm)}` });
      }
    }
    changes.sort((x, y) => x.measure - y.measure);

    const secLines = lines.filter((l) => l.sectionIndex === si);
    const sings = secNotes.length > 0;
    return {
      id: sec.id,
      index: sec.index,
      label: sec.label,
      bars: barsLabel(score, a, b),
      startMeasure: a,
      endMeasure: b,
      sings,
      changes,
      entries: entries.filter((e) => inSec(e.time)),
      exposed: spansStartingIn(score, exposedRuns, a, b, (r) => ({ accompanied: accompaniedFlags.slice(r[0], r[1] + 1).some(Boolean) })),
      rests: sings ? spansStartingIn(score, restRuns, a, b) : [],
      tune: spansStartingIn(score, tuneRuns, a, b),
      range: rangeOf(secNotes.map((n) => n.midi), sec.start),
      lines: secLines.map((l) => ({ text: l.text, letters: firstLetters(l.text), bar: l.bar, vocalise: l.vocalise })),
      letters: secLines.filter((l) => !l.vocalise).map((l) => firstLetters(l.text)).join(' / '),
    };
  });

  const k0 = score.keys[0] ?? { fifths: 0, mode: 'major' as const };
  return {
    partId: part.id,
    partName: part.name,
    start: {
      key: keyName(k0),
      time: ms[0] ? tsText(ms[0].timeSig) : '4/4',
      tempo: bpmText(score.tempos[0]?.bpm ?? 90),
    },
    range: rangeOf(notes.map((n) => n.midi), 0),
    entryCount: entries.length,
    usuallyTop,
    hasText,
    sections: mapSections,
  };
}

function measureOfBeat(score: Score, beat: number): number {
  const ms = score.measures;
  let ans = 0;
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].startBeat <= beat + EPS) ans = i;
    else break;
  }
  return ans;
}

/**
 * The cue for an entry at `beat`: the other part whose note started most recently before it and
 * was still sounding (or had just stopped) within two beats. Voices are preferred to instruments;
 * among simultaneous onsets, the note closest in pitch to the entry.
 */
function findCue(score: Score, others: Part[], beat: number, midi: number, beatLen: number): { part: Part; midi: number } | null {
  type Cand = { part: Part; midi: number; onset: number; vocal: boolean };
  const cands: Cand[] = [];
  const window = 2 * beatLen;
  for (const p of others) {
    // last onset strictly before the entry
    let best: { midi: number; onset: number; end: number } | null = null;
    for (const n of p.notes) {
      if (n.startBeat >= beat - EPS) break;
      const end = n.startBeat + n.durBeats;
      if (!best || n.startBeat > best.onset + EPS || (Math.abs(n.startBeat - best.onset) < EPS && Math.abs(n.midi - midi) < Math.abs(best.midi - midi))) {
        best = { midi: n.midi, onset: n.startBeat, end };
      }
    }
    if (!best || best.end < beat - window - EPS) continue;
    cands.push({ part: p, midi: best.midi, onset: best.onset, vocal: isVocal(p) });
  }
  if (!cands.length) return null;
  const pool = cands.some((c) => c.vocal) ? cands.filter((c) => c.vocal) : cands;
  pool.sort((x, y) => (y.onset - x.onset > EPS ? 1 : x.onset - y.onset > EPS ? -1 : Math.abs(x.midi - midi) - Math.abs(y.midi - midi)));
  return { part: pool[0].part, midi: pool[0].midi };
}
