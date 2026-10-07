// Help for a singer who's stuck: listening to the section, or singing it slowly first.

import { attemptLog, readJSON, writeJSON, type SectionProgress } from './store';

/** "Practise slowly": level 1 is already slow (70%), so half speed there; 70% from level 2 up. */
export const slowRate = (level: number): number => (level <= 1 ? 0.5 : 0.7);

/**
 * Counted runs of this section at this level that missed, in a row, up to the latest one (a pass
 * ends the count). Practice runs (slower, stopped early) are logged apart and don't count.
 */
export function failsInARow(pieceId: string, partId: string, sectionId: string, level: number): number {
  const log = attemptLog();
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.pieceId !== pieceId || e.partId !== partId || e.sectionId !== sectionId || e.level !== level) continue;
    if (e.passed) break;
    n++;
  }
  return n;
}

const SEEN = 'sh:seenSections';
/** A run of a section (sung, listened to, or practice: those are logged apart) was made. */
export function markSeen(pieceId: string, partId: string, sectionId: string): void {
  const all = readJSON<string[]>(SEEN, [], Array.isArray);
  const k = `${pieceId}|${partId}|${sectionId}`;
  if (all.includes(k)) return;
  writeJSON(SEEN, [...all, k].slice(-2000), false);
}

/** Never sung or listened to yet: the first read-through (level 1 offers to listen first). */
export const firstTime = (sp: SectionProgress | undefined, seen?: { pieceId: string; partId: string; sectionId: string }): boolean =>
  (!sp || (!sp.attempts && !sp.lastPracticed))
  && !(seen && readJSON<string[]>(SEEN, [], Array.isArray).includes(`${seen.pieceId}|${seen.partId}|${seen.sectionId}`));

/** From this many misses in a row, listening or slow practice is what the app suggests first. */
export const STUCK_AFTER = 2;
