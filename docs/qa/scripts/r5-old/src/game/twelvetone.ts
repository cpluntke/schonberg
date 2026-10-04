// Zwölfton mode: a deterministic "row of the day" and its realization as a singable score.

import type { Measure, Part, Score, ScoreNote } from '../music/types';
import { pcSymbol } from './notation';

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** mulberry32 PRNG → floats in [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Local calendar date as "YYYY-MM-DD". */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Deterministic random 12-tone row for a (local) calendar day. */
export function rowOfTheDay(date: Date): number[] {
  const rng = makeRng(hashString(dateKey(date)));
  const row = Array.from({ length: 12 }, (_, i) => i);
  for (let i = 11; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [row[i], row[j]] = [row[j], row[i]];
  }
  return row;
}

export function transposeRow(row: number[], n: number): number[] {
  return row.map((p) => mod12(p + n));
}

export function invertRow(row: number[]): number[] {
  const first = row[0];
  return row.map((p) => mod12(2 * first - p));
}

/**
 * All 48 row forms. Subscripts count semitones from the row's first pitch class, so P0 is the row
 * as given, I0 its inversion starting on the same pitch, R0 = P0 reversed, RI0 = I0 reversed.
 * Keys: P0..P11, I0..I11, R0..R11, RI0..RI11.
 */
export function rowForms(row: number[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const inv = invertRow(row);
  for (let n = 0; n < 12; n++) {
    const p = transposeRow(row, n);
    const i = transposeRow(inv, n);
    out[`P${n}`] = p;
    out[`I${n}`] = i;
    out[`R${n}`] = [...p].reverse();
    out[`RI${n}`] = [...i].reverse();
  }
  return out;
}

export function isValidRow(row: number[]): boolean {
  return row.length === 12 && new Set(row.map(mod12)).size === 12 && row.every((p) => Number.isInteger(p));
}

export interface RowScoreOptions {
  /** Lowest / highest MIDI pitch the singer can use (widened to at least an octave + semitone). */
  low: number;
  high: number;
  bpm?: number;
  seed?: number;
  /** Day used for the score id/title (default: today). */
  date?: Date;
  /** Which form to append as the second phrase (default: R0 or I5, chosen by seed). */
  secondForm?: string;
}

/** Choose octaves for a sequence of pitch classes: leaps ≤ 12, varied, staying inside [low, high]. */
function realize(pcs: number[], low: number, high: number, rng: () => number, startNear: number): number[] {
  const center = (low + high) / 2;
  const out: number[] = [];
  let prev: number | null = null;
  let prevLeap = 0;
  let sameDir = 0;
  for (const pc of pcs) {
    const cands: number[] = [];
    for (let m = low; m <= high; m++) if (mod12(m) === pc) cands.push(m);
    let pick: number;
    if (prev === null) {
      pick = cands.reduce((a, b) => (Math.abs(b - startNear) < Math.abs(a - startNear) ? b : a));
    } else {
      const p: number = prev;
      const ok = cands.filter((m) => Math.abs(m - p) <= 12 && m !== p);
      const pool = ok.length ? ok : cands;
      let best = pool[0];
      let bestCost = Infinity;
      for (const m of pool) {
        const leap = m - p;
        const size = Math.abs(leap);
        let cost = rng() * 4;
        cost += Math.max(0, Math.abs(m - center) - (high - low) / 3) * 1.5; // stay away from the extremes
        if (size === Math.abs(prevLeap)) cost += 3; // vary the leap sizes
        if (size > 9) cost += 2; // big leaps occasionally, not constantly
        if (size <= 2) cost += 1.5; // a twelve-tone row should not be a scale
        if (prevLeap !== 0 && Math.sign(leap) === Math.sign(prevLeap) && sameDir >= 2) cost += 4; // turn around
        if (Math.abs(prevLeap) >= 8 && Math.sign(leap) === Math.sign(prevLeap)) cost += 3; // recover after a big leap
        if (cost < bestCost) { bestCost = cost; best = m; }
      }
      pick = best;
      const leap = pick - p;
      sameDir = Math.sign(leap) === Math.sign(prevLeap) ? sameDir + 1 : 1;
      prevLeap = leap;
    }
    out.push(pick);
    prev = pick;
  }
  return out;
}

/** Durations in beats (quarter = 1) for `n` notes, never crossing a barline except the last note. */
function rhythm(n: number, rng: () => number, startBeat: number): number[] {
  const opts: [number, number][] = [[1, 4], [2, 3], [1.5, 1.5], [3, 1]];
  const out: number[] = [];
  let pos = startBeat % 4;
  for (let i = 0; i < n; i++) {
    const r = 4 - pos;
    let d: number;
    if (i === n - 1) {
      d = r >= 2 ? r : r + 4; // end on a long note filling the bar
    } else if (r === 0.5) {
      d = 0.5;
    } else {
      const fit = opts.filter(([v]) => v <= r);
      const total = fit.reduce((s, [, w]) => s + w, 0);
      let x = rng() * total;
      d = fit[0][0];
      for (const [v, w] of fit) {
        if ((x -= w) < 0) { d = v; break; }
      }
    }
    out.push(d);
    pos = (pos + d) % 4;
  }
  return out;
}

/**
 * Realize a row as a one-part score: the row (P0), a bar of rest, then a second form (R0 or I5).
 * 4/4, key of C (no signature), lyrics = pitch-class symbols.
 */
export function rowToScore(row: number[], opts: RowScoreOptions): Score {
  const bpm = opts.bpm ?? 72;
  const seed = opts.seed ?? row.reduce((h, p) => h * 13 + p, 7);
  const rng = makeRng(seed);
  let low = Math.round(Math.min(opts.low, opts.high));
  let high = Math.round(Math.max(opts.low, opts.high));
  if (high - low < 12) {
    const mid = (low + high) / 2;
    low = Math.round(mid - 6);
    high = low + 12;
  }
  const forms = rowForms(row);
  const secondName = opts.secondForm && forms[opts.secondForm] ? opts.secondForm : (seed & 1 ? 'I5' : 'R0');

  const spb = 60 / bpm;
  const notes: ScoreNote[] = [];
  let beat = 0;
  const addPhrase = (pcs: number[], startNear: number) => {
    const midis = realize(pcs, low, high, rng, startNear);
    const durs = rhythm(midis.length, rng, beat);
    midis.forEach((midi, i) => {
      const d = durs[i];
      notes.push({
        midi, start: beat * spb, dur: d * spb, startBeat: beat, durBeats: d,
        measure: Math.floor(beat / 4 + 1e-9), lyric: pcSymbol(midi), syllabic: 'single',
      });
      beat += d;
    });
  };
  addPhrase(forms.P0, (low + high) / 2);
  beat = Math.ceil(beat / 4 - 1e-9) * 4 + 4; // one bar of rest
  addPhrase(forms[secondName], notes[notes.length - 1].midi);
  const totalBeats = Math.ceil(beat / 4 - 1e-9) * 4;

  const measures: Measure[] = [];
  for (let i = 0; i < totalBeats / 4; i++) {
    measures.push({
      index: i, number: String(i + 1), startBeat: i * 4, durBeats: 4, start: i * 4 * spb, dur: 4 * spb,
      timeSig: [4, 4], ...(i === totalBeats / 4 - 1 ? { doubleBar: true } : {}),
    });
  }
  measures[0].rehearsalMark = 'P0';
  measures[notes[12].measure].rehearsalMark = secondName;

  const midis = notes.map((n) => n.midi);
  const part: Part = {
    id: 'row', name: 'Row', voiceType: 'other', notes,
    low: Math.min(...midis), high: Math.max(...midis),
  };
  const day = dateKey(opts.date ?? new Date());
  return {
    id: `row-${day.replace(/-/g, '')}`,
    title: `Row of the day ${day}`,
    composer: 'Schönberg Hero',
    source: 'builtin',
    parts: [part],
    measures,
    keys: [{ beat: 0, time: 0, fifths: 0, mode: 'major' }],
    tempos: [{ beat: 0, time: 0, bpm }],
    duration: totalBeats * spb,
  };
}
