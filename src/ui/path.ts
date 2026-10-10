// "Your path": the words and the LevelMeter states for the piece screen, the passage sheet and
// Results, from stored progress (docs/LEVELS.md). Pure functions only.
//
// Vocabulary (the mockups' FIXTURE): "Level 3 reached ✓" (done), "Level 1 · slow ✓" (the slow step
// passed), "Working on Level 1 · slow" (in progress). Never "Level 0".

import type { Section, Part } from '../music/types';
import type { PieceProgress, SectionProgress } from '../progress/store';
import {
  LEVELS, MAX_LEVEL, currentStep, levelLabel, pendingFixes, pieceLevel, stepWord, type NextStep, type Step,
} from '../progress/ladder';
import type { NoteMap } from '../progress/notestats';
import type { FaultKind } from './play/noteFault';

export type NodeFill = 'empty' | 'half' | 'full';

/** One node of the LevelMeter. */
export interface MeterNode {
  level: number;
  /** Notes, Words, Alone, Concert, By heart. */
  name: string;
  /** full = passed in tempo, half = slow passed, empty = not yet. */
  fill: NodeFill;
  /** The step you are on (the orange ring). */
  now: boolean;
  /** A goal on this level (a date, e.g. "12 Dec"): the ♪ marker. */
  goal?: string;
}

/**
 * The five nodes for an in-tempo level, a slow step above it, and the step you are on (null: none,
 * e.g. memorised, or a passage that isn't the next one).
 */
export function meterNodes(o: { level: number; slow?: number; now?: { level: number } | null; goals?: Record<number, string> }): MeterNode[] {
  return LEVELS.map((l) => ({
    level: l.level,
    name: l.name,
    fill: o.level >= l.level ? 'full' : (o.slow ?? 0) >= l.level ? 'half' : 'empty',
    now: !!o.now && o.now.level === l.level,
    ...(o.goals?.[l.level] ? { goal: o.goals[l.level] } : {}),
  }));
}

/** "Level 1 Notes: slow passed; you are here". */
export function nodeLabel(n: MeterNode): string {
  const state = n.fill === 'full' ? 'reached' : n.fill === 'half' ? 'slow passed' : 'not yet';
  return `Level ${n.level} ${n.name}: ${state}${n.now ? '; you are here' : ''}${n.goal ? `; goal ${n.goal}` : ''}`;
}

/** A passage's slow step above its in-tempo level (0 = none). */
export const slowOf = (sp: Pick<SectionProgress, 'level' | 'slow'> | undefined): number =>
  (sp?.slow ?? 0) > (sp?.level ?? 0) ? sp!.slow! : 0;

/** A passage's status in the fixture wording, and whether it reads as done (green) or in progress (muted). */
export function passageStatus(sp: SectionProgress | undefined): { text: string; done: boolean } {
  const lvl = Math.max(0, Math.min(MAX_LEVEL, sp?.level ?? 0));
  const slow = slowOf(sp);
  if (slow > 0) return { text: `Level ${slow} · slow ✓`, done: true };
  if (lvl >= 1) return { text: `Level ${lvl} reached ✓`, done: true };
  if ((sp?.attempts ?? 0) > 0 || sp?.lastPracticed != null) {
    const c = currentStep(sp);
    return { text: `Working on Level ${c.level} · ${stepWord(c.step)}`, done: false };
  }
  return { text: 'Not started', done: false };
}

/** A passage has passed `level` at `step` (in tempo: its level; slow: its slow step, or in tempo). */
export function passedStep(sp: Pick<SectionProgress, 'level' | 'slow'> | undefined, level: number, step: Step): boolean {
  if ((sp?.level ?? 0) >= level) return true;
  return step === 'slow' && (sp?.slow ?? 0) >= level;
}

export interface PathStatus {
  /** The piece's level (pieceReadiness / pieceLevel). */
  pieceLevel: number;
  /** The level and step the piece is being worked on; null once memorised. */
  working: { level: number; step: Step } | null;
  /** Passages that passed the working level at the working step (in score order). */
  done: string[];
  /** Passages still to pass it (in score order). */
  todo: string[];
  /** Open fix list at the working level (it slipped in a full run), if any. */
  fixes: string[];
  /** Every passage has passed the working level's slow step: the piece's node is half filled. */
  half: boolean;
  /** Every passage has passed the working level in tempo: sing it all through to make it the piece's. */
  allInTempo: boolean;
  /** "Level 1 · slow, 3 of 4 passages". */
  here: string;
}

/** Where the piece stands: the level it's being worked on, and how many passages are through that step. */
export function pathStatus(sections: Section[], prog: PieceProgress | undefined): PathStatus {
  const order = [...sections].sort((a, b) => a.index - b.index);
  const P = sections.length ? pieceLevel(sections, prog) : 0;
  const sp = (id: string) => prog?.sections[id];
  const fixList = pendingFixes(sections, prog).find((f) => f.level > P);
  const base = { pieceLevel: P, done: [] as string[], todo: [] as string[], fixes: [] as string[], half: false, allInTempo: false };
  if (P >= MAX_LEVEL || !sections.length) {
    return { ...base, working: null, half: false, here: P >= MAX_LEVEL ? `${levelLabel(MAX_LEVEL)} reached ✓` : 'No passages to sing' };
  }
  const W = fixList ? fixList.level : P + 1;
  const half = order.every((s) => passedStep(sp(s.id), W, 'slow'));
  const allInTempo = order.every((s) => passedStep(sp(s.id), W, 'tempo'));
  const step: Step = fixList || half ? 'tempo' : 'slow';
  const done = order.filter((s) => passedStep(sp(s.id), W, step)).map((s) => s.id);
  const todo = order.filter((s) => !done.includes(s.id)).map((s) => s.id);
  const n = order.length;
  let here: string;
  if (fixList) {
    const k = fixList.sectionIds.length;
    here = `Level ${W} · in tempo, ${k === 1 ? 'one passage' : `${k} passages`} to fix`;
  } else if (n === 1) here = `Level ${W} · ${stepWord(step)}`;
  else if (allInTempo) here = `Level ${W} in every passage · now sing it all through`;
  else if (done.length === 0) here = `Level ${W} · ${stepWord(step)}, no passages yet`;
  else here = `Level ${W} · ${stepWord(step)}, ${done.length} of ${n} passages`;
  return { ...base, working: { level: W, step }, done, todo, fixes: fixList?.sectionIds ?? [], half, allInTempo, here };
}

/** "Bars 1–5 · 6–13 · 14–21": passage labels joined, "Bars" said once. */
export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  const m = /^(Bars?) /.exec(labels[0]);
  if (!m) return labels.join(' · ');
  return [labels[0], ...labels.slice(1).map((l) => l.replace(/^Bars? /, ''))].join(' · ');
}

/** "bars 9–12" (a label inside a sentence). */
export const lowerLabel = (label: string): string => label.replace(/^(Bars?|Upbeat)\b/, (w) => w.toLowerCase());

/**
 * The primary button of the piece's "Now" card: what nextStep says, in words. A passage: "Bars 22–29
 * · Level 1 · Notes · slow"; the whole piece "Sing it all · Level 2 · Words"; a fix "Fix bars 9–12";
 * a review "Review bars 9–16".
 */
export function nextLabel(next: NextStep, label: (id: string) => string): string {
  const lv = levelLabel(next.level);
  if (next.sectionId === 'all') return next.kind === 'review' ? `Review: sing it all · ${lv}` : `Sing it all · ${lv}`;
  if (next.kind === 'fix') return `Fix ${lowerLabel(label(next.sectionId))}`;
  if (next.kind === 'review') return `Review ${lowerLabel(label(next.sectionId))}`;
  return `${label(next.sectionId)} · ${lv} · ${stepWord(next.step)}`;
}

/**
 * The reason under the primary button, without repeating the button: a passage's reason starts with
 * "Bars 22–29: Level 1 · Notes · slow." (ladder.nextStep); only what follows is kept.
 */
export function nextReason(next: NextStep, label: (id: string) => string): string {
  if (next.kind !== 'section') return next.reason;
  const head = `${label(next.sectionId)}: `;
  const r = next.reason.startsWith(head) ? next.reason.slice(head.length) : next.reason;
  return r.replace(/^Level \d · [^.]*\.\s*/, '').trim();
}

/** The note that has gone wrong most lately in a stretch of the part, and how (notestats). */
export function troubleNote(part: Pick<Part, 'notes'>, from: number, to: number, stats: NoteMap): { index: number; measure: number; kind: FaultKind | null } | null {
  let best: { index: number; w: number } | null = null;
  for (const [k, s] of Object.entries(stats)) {
    const i = Number(k);
    const n = part.notes[i];
    if (!n || n.start < from - 1e-6 || n.start >= to - 1e-6) continue;
    // (wrong in the latest run of it or more often lately: one wrong run from nothing gives 0.4)
    if (s.w < 0.35) continue;
    if (!best || s.w > best.w) best = { index: i, w: s.w };
  }
  if (!best) return null;
  const s = stats[best.index];
  let kind: FaultKind | null = null;
  let kn = 0;
  for (const [f, c] of Object.entries(s.k ?? {})) if (c > kn) { kind = f as FaultKind; kn = c; }
  return { index: best.index, measure: part.notes[best.index].measure, kind };
}

/** "bar 25 has been flat lately" (a short reason), from a trouble note and the bar's number. */
export function troubleWords(kind: FaultKind | null, bar: string): string {
  const what = kind === 'flat' ? 'has been flat' : kind === 'sharp' ? 'has been sharp' : kind === 'missed' ? 'has had a note missed'
    : kind === 'short' ? 'has had a note cut short' : 'has had a note go wrong';
  return `bar ${bar} ${what} lately`;
}

/** Levels whose run-through is a milestone for the whole piece. */
export const MILESTONES: Record<number, string> = { 3: 'Rehearsal-ready', 4: 'Concert-ready', 5: 'Memorised' };

/** The highest milestone (3, 4, 5) the piece level crossed between `before` and `after`, else null. */
export function milestoneCrossed(before: number, after: number): 3 | 4 | 5 | null {
  for (const m of [5, 4, 3] as const) if (before < m && after >= m) return m;
  return null;
}
