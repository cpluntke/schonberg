// The pre-run card and Results in words: the task as one sentence, the pass rule, and (Level 1 in
// tempo) which entries came in late. Pure functions only.

import type { ScoreNote } from '../../music/types';
import { entryTimings, type EntryTiming, type StepSpec } from '../../progress/ladder';

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * The task as one sentence: "Sing bars 22–29 on “doo”, slowly (70%), with your part playing."
 * `what`: "bars 22–29", "the whole piece". `rate`: the tempo the run starts at.
 */
export function taskSentence(spec: Pick<StepSpec, 'level' | 'guide' | 'doo' | 'showNames' | 'rate'>, what: string, rate: number = spec.rate): string {
  const how = spec.doo ? ' on “doo”'
    : spec.level >= 5 ? ' from memory'
      : !spec.showNames ? ' with the words and no note names'
        : ' with the words';
  const tempo = rate >= 1 - 1e-6 ? 'in tempo' : `slowly (${pct(rate)})`;
  const support = spec.guide ? 'with your part playing'
    : spec.level === 3 ? 'your part muted: the other voices play'
      : 'from the starting chord, the other voices playing';
  return `Sing ${what}${how}, ${tempo}, ${support}.`;
}

/** One style for every pass mark: "8 in 10" for 0.8, "85 in 100" for 0.85. */
export function shareWords(pass: number): string {
  const tenths = pass * 10;
  return Math.abs(tenths - Math.round(tenths)) < 1e-6 ? `${Math.round(tenths)} in 10` : `${Math.round(pass * 100)} in 100`;
}

/** "8 in 10 notes", "85 in 100 notes". */
export function notesShare(pass: number): string {
  return `${shareWords(pass)} notes`;
}

/** The pass rule in words: "All notes right to pass.", "8 in 10 notes right, entries on time." */
export function passRule(spec: Pick<StepSpec, 'pass' | 'everyNote' | 'entries'>, o: { full?: boolean } = {}): string {
  if (o.full) {
    return spec.everyNote
      ? 'Every note of every passage right to pass.'
      : `Every passage needs ${notesShare(spec.pass)} right${spec.entries ? ', entries on time' : ''}. Any that slip are yours to fix on their own.`;
  }
  if (spec.everyNote) return 'All notes right to pass.';
  return `${notesShare(spec.pass)} right${spec.entries ? ', entries on time' : ' to pass'}.`;
}

export interface LateEntry {
  /** Index of the entry note in the part. */
  index: number;
  /** 0-based measure of the note. */
  measure: number;
  /** How late (ms, after `offsetMs`); null = not sung. */
  ms: number | null;
}

/**
 * The entries Results names after a run failed on its entries (Level 1 in tempo): the ones not sung
 * at all and the ones later than the bound entriesOnTime used (ladder.entryTimings: the same entries,
 * the same bound). When the mean was late but no single entry passed the bound, the latest one.
 * In score order.
 */
export function lateEntries(
  partNotes: readonly Pick<ScoreNote, 'start' | 'dur' | 'measure'>[],
  notes: Parameters<typeof entryTimings>[1],
  offsetMs = 0,
): LateEntry[] {
  const { entries, bound } = entryTimings(partNotes, notes, offsetMs);
  const at = (e: EntryTiming): LateEntry => ({ index: e.index, measure: partNotes[e.index]?.measure ?? 0, ms: e.missed || e.ms === null ? null : Math.round(e.ms) });
  const out = entries.filter((e) => e.missed || (e.ms !== null && e.ms > bound));
  if (out.length) return out.map(at);
  const timed = entries.filter((e) => e.ms !== null);
  const mean = timed.length ? timed.reduce((a, e) => a + e.ms!, 0) / timed.length : 0;
  if (mean <= bound) return [];
  return [at([...timed].sort((a, b) => b.ms! - a.ms!)[0])];
}
