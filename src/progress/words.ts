// Progress on learning the words of each section, separately from the notes:
// read along → first letters → from memory.
import { readJSON, writeJSON } from './store';
import { WORDS_PASS, type WordsStage } from '../game/textrhythm';

export interface WordsProgress {
  /** Highest stage passed (-1 = none). */
  passed: number;
  /** Stage → best accuracy. */
  best: Record<number, number>;
  at: number;
}

const key = (pieceId: string, partId: string) => `sh:words:${pieceId}:${partId}`;
const isMap = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function getWords(pieceId: string, partId: string): Record<string, WordsProgress> {
  return readJSON<Record<string, WordsProgress>>(key(pieceId, partId), {}, isMap);
}

/** Record a words run; returns whether it passed and whether it unlocked a new stage. */
export function recordWords(pieceId: string, partId: string, sectionId: string, stage: WordsStage, accuracy: number, now = Date.now()): { passed: boolean; newStage: boolean } {
  const all = { ...getWords(pieceId, partId) };
  const w: WordsProgress = all[sectionId] ? { ...all[sectionId], best: { ...all[sectionId].best } } : { passed: -1, best: {}, at: now };
  const passed = accuracy >= WORDS_PASS;
  w.best[stage] = Math.max(w.best[stage] ?? 0, accuracy);
  w.at = now;
  const newStage = passed && stage > w.passed;
  if (passed) w.passed = Math.max(w.passed, stage);
  all[sectionId] = w;
  writeJSON(key(pieceId, partId), all);
  return { passed, newStage };
}
