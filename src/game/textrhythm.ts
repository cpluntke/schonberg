// "Words in rhythm": learning the text separately from the pitches. The singer speaks (or
// whispers, or sings) the words in time with the music; only *when* each syllable starts is
// judged, from the loudness of the voice, never the pitch.

import type { Part } from '../music/types';
import type { PitchSample } from './types';

export interface Syllable {
  /** Index into part.notes. */
  index: number;
  /** Score time the syllable starts. */
  start: number;
  text: string;
  /** Starts a word (vs. continues one). */
  wordStart: boolean;
  measure: number;
}

/** The singer's syllables in a note range (melisma continuation notes have no syllable). */
export function syllablesOf(part: Part, range: [number, number]): Syllable[] {
  const out: Syllable[] = [];
  for (let i = Math.max(0, range[0]); i <= Math.min(part.notes.length - 1, range[1]); i++) {
    const n = part.notes[i];
    if (!n.lyric || !n.lyric.trim()) continue;
    out.push({ index: i, start: n.start, text: n.lyric, wordStart: n.syllabic !== 'middle' && n.syllabic !== 'end', measure: n.measure });
  }
  return out;
}

const db = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-5));

/**
 * Syllable onsets from the loudness envelope: a rise of at least 6 dB within ~120 ms to a level
 * clearly above the room (and at least 90 ms after the previous onset). Consonants make the dips
 * between syllables, so speaking or whispering in rhythm works best; legato singing gives fewer.
 */
export function syllableOnsets(samples: PitchSample[]): number[] {
  const s = [...samples].filter((x) => Number.isFinite(x.rms) && Number.isFinite(x.time)).sort((a, b) => a.time - b.time);
  if (s.length < 5) return [];
  const env = s.map((x) => db(x.rms));
  const sorted = [...env].sort((a, b) => a - b);
  const globalFloor = sorted[Math.floor(sorted.length * 0.15)];
  // The floor around each moment (quietest point in the last second): music bleeding into the mic
  // raises it, and a syllable must stand clearly above what's around it.
  const localFloor = env.map((_, k) => {
    let m = Infinity;
    for (let j = k; j >= 0 && s[k].time - s[j].time <= 1; j--) m = Math.min(m, env[j]);
    return m;
  });
  const loudAt = (k: number) => Math.max(globalFloor + 8, localFloor[k] + 9, -50);
  const out: number[] = [];
  let last = -Infinity;
  for (let k = 1; k < s.length; k++) {
    const loud = loudAt(k);
    if (env[k] < loud) continue;
    let lo = Infinity;
    let at = k;
    for (let j = k - 1; j >= 0 && s[k].time - s[j].time <= 0.13; j--) {
      if (env[j] < lo) { lo = env[j]; at = j + 1; }
    }
    if (env[k] - lo < 6) continue;
    // Onset = where the rise began (the first frame above the dip).
    const t = s[Math.min(at, k)].time;
    if (t - last < 0.09) continue;
    // Only take the first frame of each rise.
    if (env[k - 1] >= loudAt(k - 1) && env[k - 1] - lo >= 6) continue;
    out.push(t);
    last = t;
  }
  return out;
}

export type WordGrade = 'perfect' | 'good' | 'ok' | 'miss';

export interface WordsResult {
  /** Per syllable: offset from the written start (real ms, + = late), or null if not heard. */
  syllables: { index: number; ms: number | null; grade: WordGrade }[];
  /** Share of syllables on time (perfect 1, good 0.85, ok 0.5). */
  accuracy: number;
  /** Measure → accuracy, for the bar strip and the piece map. */
  perMeasure: Record<number, number>;
  /** Median offset (real ms) of the syllables heard, or null. */
  medianMs: number | null;
  /** Syllables with no onset near them. */
  missed: number;
  /** Syllables heard that aren't in the text (beyond the matched ones). */
  extra?: number;
}

const GRADE_VALUE: Record<WordGrade, number> = { perfect: 1, good: 0.85, ok: 0.5, miss: 0 };

/**
 * Match onsets to syllables in order (each onset used once) within ±300 ms real time, then grade
 * each by its offset. `relative`: judge against the median offset (device delay unknown).
 */
export function scoreWords(syl: Syllable[], onsets: number[], opts: { rate: number; relative?: boolean }): WordsResult {
  const rate = opts.rate > 0 ? opts.rate : 1;
  const win = 0.3 * rate; // score seconds
  // First the speaker's overall offset (device delay, or simply speaking late): the shift under
  // which most syllables have an onset close by. Matching around it keeps a late speaker on their
  // own syllables instead of sliding them onto the next ones.
  const close = 0.08 * rate;
  let bestD = 0;
  let bestN = -1;
  for (let d = -0.15 * rate; d <= 0.35 * rate + 1e-9; d += 0.01 * rate) {
    let n = 0;
    for (const x of syl) if (onsets.some((t) => Math.abs(t - (x.start + d)) <= close)) n++;
    if (n > bestN || (n === bestN && Math.abs(d) < Math.abs(bestD))) { bestN = n; bestD = d; }
  }
  const used = new Set<number>();
  const raw: (number | null)[] = syl.map((x, k) => {
    const c = x.start + bestD;
    // Don't steal a neighbour's onset: stop halfway to it (around the offset).
    const nextStart = k + 1 < syl.length ? syl[k + 1].start + bestD : Infinity;
    const prevStart = k > 0 ? syl[k - 1].start + bestD : -Infinity;
    const lo = Math.max(c - win, (prevStart + c) / 2);
    const hi = Math.min(c + win, (c + nextStart) / 2);
    let best = -1;
    for (let j = 0; j < onsets.length; j++) {
      if (used.has(j) || onsets[j] < lo || onsets[j] > hi) continue;
      if (best < 0 || Math.abs(onsets[j] - c) < Math.abs(onsets[best] - c)) best = j;
    }
    if (best < 0) return null;
    used.add(best);
    return ((onsets[best] - x.start) / rate) * 1000;
  });
  const heard = raw.filter((x): x is number => x !== null).sort((a, b) => a - b);
  const medianMs = heard.length ? heard[Math.floor(heard.length / 2)] : null;
  const ref = opts.relative && medianMs !== null ? Math.max(-100, Math.min(250, medianMs)) : 0;
  const grade = (ms: number | null): WordGrade => {
    if (ms === null) return 'miss';
    const d = Math.abs(ms - ref);
    return d <= 100 ? 'perfect' : d <= 170 ? 'good' : d <= 250 ? 'ok' : 'miss';
  };
  const syllables = syl.map((x, k) => ({ index: x.index, ms: raw[k] === null ? null : Math.round(raw[k]!), grade: grade(raw[k]) }));
  const per = new Map<number, { s: number; n: number }>();
  syl.forEach((x, k) => {
    const e = per.get(x.measure) ?? { s: 0, n: 0 };
    e.s += GRADE_VALUE[syllables[k].grade];
    e.n++;
    per.set(x.measure, e);
  });
  const perMeasure: Record<number, number> = {};
  for (const [m, e] of per) perMeasure[m] = e.s / e.n;
  // Extra syllables count against you: chattering steadily through the section mustn't pass.
  // (A few spare onsets, e.g. a consonant cluster heard twice, are tolerated.)
  const first = syl.length ? syl[0].start + bestD - win : 0;
  const last = syl.length ? syl[syl.length - 1].start + bestD + win : 0;
  const inWindow = onsets.filter((t) => t >= first && t <= last).length;
  const extra = Math.max(0, inWindow - used.size);
  const penalty = Math.max(0, extra - 0.2 * syl.length);
  const sum = syllables.reduce((a, x) => a + GRADE_VALUE[x.grade], 0);
  const accuracy = syl.length ? sum / (syl.length + penalty) : 0;
  return { syllables, accuracy, perMeasure, medianMs: medianMs === null ? null : Math.round(medianMs), missed: syllables.filter((x) => x.ms === null).length, extra };
}

/** How much of the text is shown: 0 = read along, 1 = first letters, 2 = from memory. */
export type WordsStage = 0 | 1 | 2;
export const STAGE_NAMES = ['Read along', 'First letters', 'From memory'] as const;
/** Accuracy that unlocks the next stage. */
export const WORDS_PASS = 0.8;
