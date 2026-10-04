// The mastery ladder (docs/design-critique.md, "The progression").
// Pure functions only: no storage access here.
import type { Section } from '../music/types';
import type { PieceProgress, SectionProgress } from './store';

export type LevelNumber = 1 | 2 | 3 | 4;
export type Strictness = 'forgiving' | 'standard' | 'strict';

export interface LevelSpec {
  level: LevelNumber;
  name: string;
  /** Tempo factor. */
  rate: number;
  /** Your own part audible as a guide. */
  guide: boolean;
  /** Note names shown on the bars (otherwise lyrics only). */
  showNames: boolean;
  /** Starting-pitch cue during the count-in. */
  cue: 'note' | 'chord';
  /** Cents half-width (before the strictness factor). */
  tolerance: number;
  /** Accuracy needed to pass (0..1). */
  pass: number;
  description: string;
}

export const LEVELS: LevelSpec[] = [
  {
    level: 1, name: 'Note-learning', rate: 0.7, guide: true, showNames: true, cue: 'note', tolerance: 50, pass: 0.75,
    description: 'Slow tempo (70%) with your part playing and note names shown. Learn the notes.',
  },
  {
    level: 2, name: 'In time', rate: 1.0, guide: true, showNames: true, cue: 'note', tolerance: 35, pass: 0.8,
    description: 'Full tempo with your part still playing. Lock in rhythm and entries.',
  },
  {
    level: 3, name: 'Independent', rate: 1.0, guide: false, showNames: true, cue: 'note', tolerance: 30, pass: 0.8,
    description: 'Your part is muted: sing against the other voices only. Rehearsal-ready.',
  },
  {
    level: 4, name: 'Concert-ready', rate: 1.0, guide: false, showNames: false, cue: 'chord', tolerance: 25, pass: 0.85,
    description: 'No guide, no note names (lyrics only), starting chord only. Concert-ready.',
  },
];

/** Level 0 pseudo-level: listen once, all parts, unscored. */
export const LISTEN = {
  level: 0 as const,
  name: 'Listen',
  rate: 1.0,
  guide: true,
  showNames: true,
  description: 'Hear the section once with all parts. Not scored.',
};

export const REVIEW_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

/** Spec for level 1..4 (values outside are clamped). */
export function levelSpec(level: number): LevelSpec {
  const i = Math.min(4, Math.max(1, Math.round(level || 1))) - 1;
  return LEVELS[i];
}

export function strictnessFactor(s: Strictness): number {
  return s === 'forgiving' ? 1.3 : s === 'strict' ? 0.7 : 1;
}

/** Tolerance in cents for a level after the profile strictness factor. */
export function effectiveTolerance(level: number, strictness: Strictness): number {
  return Math.round(levelSpec(level).tolerance * strictnessFactor(strictness));
}

function levelOf(prog: PieceProgress | undefined, sectionId: string): number {
  return prog?.sections[sectionId]?.level ?? 0;
}

/** Due for review: level ≥3 and last passed (or practised, if never passed) more than 7 days ago. */
export function isDue(sp: SectionProgress | undefined, now: number = Date.now()): boolean {
  if (!sp || sp.level < 3) return false;
  const last = sp.lastPassed ?? sp.lastPracticed;
  if (last == null) return false;
  return now - last > REVIEW_AFTER_DAYS * DAY_MS;
}

export type SectionStatus = 'new' | 'learning' | 'passed' | 'due';

/** new = never tried; learning = tried / level 1–2; passed = level ≥3; due = level ≥3 and stale. */
export function sectionStatus(sp: SectionProgress | undefined, now: number = Date.now()): SectionStatus {
  if (!sp || (sp.level <= 0 && !sp.attempts && sp.lastPracticed == null)) return 'new';
  if (isDue(sp, now)) return 'due';
  if (sp.level >= 3) return 'passed';
  return 'learning';
}

export interface Readiness { pct: number; minLevel: number; rehearsalReady: boolean; concertReady: boolean }

export function pieceReadiness(sections: Section[], prog: PieceProgress | undefined): Readiness {
  if (sections.length === 0) return { pct: 0, minLevel: 0, rehearsalReady: false, concertReady: false };
  let sum = 0;
  let min = 4;
  for (const s of sections) {
    const l = Math.min(4, Math.max(0, levelOf(prog, s.id)));
    sum += l;
    min = Math.min(min, l);
  }
  return { pct: sum / (4 * sections.length), minLevel: min, rehearsalReady: min >= 3, concertReady: min >= 4 };
}

export interface NextStep { sectionId: string; level: number; reason: string }

export function nextStep(sections: Section[], prog: PieceProgress | undefined, now: number = Date.now()): NextStep | null {
  if (sections.length === 0) return null;
  // 1. Review: the most overdue section.
  let due: { s: Section; last: number } | null = null;
  for (const s of sections) {
    const sp = prog?.sections[s.id];
    if (sp && isDue(sp, now)) {
      const last = sp.lastPassed ?? sp.lastPracticed ?? 0;
      if (!due || last < due.last) due = { s, last };
    }
  }
  if (due) {
    const l = levelOf(prog, due.s.id);
    const days = Math.floor((now - due.last) / DAY_MS);
    return {
      sectionId: due.s.id,
      level: l,
      reason: `Review ${due.s.label}: last passed ${days} days ago. Keep it at ${levelSpec(l).name}.`,
    };
  }
  // 2. Earliest section with the lowest level.
  let best: Section | null = null;
  let bestLevel = 5;
  for (const s of [...sections].sort((a, b) => a.index - b.index)) {
    const l = levelOf(prog, s.id);
    if (l < bestLevel) { best = s; bestLevel = l; }
  }
  if (!best || bestLevel >= 4) return null;
  const target = Math.min(4, bestLevel + 1);
  const spec = levelSpec(target);
  const reason = bestLevel === 0
    ? `Start ${best.label}: learn the notes at ${Math.round(spec.rate * 100)}% tempo.`
    : `${best.label} is your weakest section. Take it to ${spec.name}.`;
  return { sectionId: best.id, level: target, reason };
}

function daysUntil(date: string | undefined, now: number): number | null {
  if (!date) return null;
  // 'YYYY-MM-DD' → local midnight
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const t = m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : Date.parse(date);
  if (!Number.isFinite(t)) return null;
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((t - startOfToday) / DAY_MS);
}

function plural(n: number, w: string): string { return `${n} ${w}${n === 1 ? '' : 's'}`; }

/**
 * Recommended target given the cycle dates, e.g.
 * "Rehearsal in 3 days: get 4 more sections to Independent".
 * Returns null when there is no upcoming date or the target is already met.
 */
export function targetForDate(
  sections: Section[],
  prog: PieceProgress | undefined,
  cycle: { rehearsalDate?: string; concertDate?: string },
  now: number = Date.now(),
): string | null {
  if (sections.length === 0) return null;
  const goals: { label: string; level: number; days: number | null }[] = [
    { label: 'Rehearsal', level: 3, days: daysUntil(cycle.rehearsalDate, now) },
    { label: 'Concert', level: 4, days: daysUntil(cycle.concertDate, now) },
  ];
  for (const g of goals) {
    if (g.days == null || g.days < 0) continue;
    const missing = sections.filter((s) => levelOf(prog, s.id) < g.level).length;
    if (missing === 0) continue;
    const when = g.days === 0 ? 'today' : g.days === 1 ? 'tomorrow' : `in ${g.days} days`;
    const perDay = g.days > 1 ? Math.ceil(missing / g.days) : missing;
    const pace = g.days > 1 && perDay < missing ? ` (about ${perDay} a day)` : '';
    return `${g.label} ${when}: get ${plural(missing, 'more section')} to ${levelSpec(g.level).name}${pace}`;
  }
  return null;
}
