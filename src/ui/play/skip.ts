// Skipping a long rest: during a run, when the singer's next note is still far off, the playback can
// jump ahead to a bar before it (whole-piece runs have long stretches where the others sing). Only
// rests are skipped, never a note of the singer's part, so a run with skips still counts.

import type { Measure, Part } from '../../music/types';

/** A skip is offered only when it saves at least this many bars… */
export const SKIP_MIN_BARS = 2;
/** …and this many score seconds. */
export const SKIP_MIN_SEC = 4;

const measureAt = (measures: Measure[], t: number): Measure | undefined =>
  measures.find((m) => t >= m.start - 1e-6 && t < m.start + m.dur - 1e-6) ?? (t >= (measures.at(-1)?.start ?? Infinity) ? measures.at(-1) : undefined);

/**
 * Where a skip from `pos` would land (not within `afterLast` score seconds of a note's end): the start of the bar that begins at least one bar before the
 * singer's next note (between one and two bars of lead-in), or null when there is no long rest ahead
 * (a note is sounding or starts soon, or there are no more notes before `end`).
 */
export function skipTarget(measures: Measure[], part: Pick<Part, 'notes'>, pos: number, end: number, afterLast = 0): { target: number; entry: number } | null {
  let next: { start: number } | null = null;
  for (const n of part.notes) {
    // singing now, or the last note only just ended (its tail hasn't reached the scoring yet: `afterLast`)
    if (n.start + n.dur + afterLast > pos + 1e-6 && n.start <= pos + 1e-6) return null;
    if (n.start > pos + 1e-6) { next = n; break; }
  }
  if (!next || next.start >= end - 1e-6) return null;
  const entry = next.start;
  const em = measureAt(measures, entry);
  if (!em) return null;
  const lead = measureAt(measures, entry - em.dur + 1e-6);
  if (!lead) return null;
  const target = lead.start;
  const here = measureAt(measures, pos);
  const bar = here?.dur ?? em.dur;
  if (target - pos < Math.max(SKIP_MIN_BARS * bar, SKIP_MIN_SEC) - 1e-6) return null;
  return { target, entry };
}
