// The pre-run card and Results in words: the task as one sentence, the pass rule, and (Level 1 in
// tempo) which entries came in late. Pure functions only.

import type { ScoreNote } from '../../music/types';
import type { NoteResult } from '../../game/types';
import { ENTRY_REST_SEC, LATE_MS } from '../../game/analysis';
import type { StepSpec } from '../../progress/ladder';

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

/** "8 in 10" for 0.8, "85%" otherwise. */
export function shareWords(pass: number): string {
  const tenths = pass * 10;
  return Math.abs(tenths - Math.round(tenths)) < 1e-6 ? `${Math.round(tenths)} in 10` : pct(pass);
}

/** "8 in 10 notes", "85% of the notes". */
export function notesShare(pass: number): string {
  const w = shareWords(pass);
  return w.endsWith('%') ? `${w} of the notes` : `${w} notes`;
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

export interface EntryTiming {
  /** Index of the entry note in the part. */
  index: number;
  /** 0-based measure of the note. */
  measure: number;
  /** How late (ms, after `offsetMs`); null = not sung. */
  ms: number | null;
}

/**
 * The entries of a run (ladder.entriesOnTime's definition: the run's first note and every note
 * after a rest of at least ENTRY_REST_SEC) that came in late (over LATE_MS) or weren't sung,
 * in score order.
 */
export function lateEntries(
  partNotes: readonly Pick<ScoreNote, 'start' | 'dur' | 'measure'>[],
  notes: readonly Pick<NoteResult, 'index' | 'onsetMs'>[],
  offsetMs = 0,
): EntryTiming[] {
  const sorted = [...notes].sort((a, b) => a.index - b.index);
  const out: EntryTiming[] = [];
  sorted.forEach((n, k) => {
    const i = n.index;
    const prev = partNotes[i - 1];
    const cur = partNotes[i];
    if (!cur) return;
    const entry = k === 0 || i === 0 || (!!prev && cur.start - (prev.start + prev.dur) >= ENTRY_REST_SEC - 1e-6);
    if (!entry) return;
    const ms = n.onsetMs == null ? null : Math.round(n.onsetMs - offsetMs);
    if (ms === null || ms > LATE_MS) out.push({ index: i, measure: cur.measure, ms });
  });
  return out;
}
