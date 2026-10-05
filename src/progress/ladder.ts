// The mastery ladder (docs/design-critique.md, "The progression").
// Pure functions only: no storage access here.
import type { Section } from '../music/types';
import type { PieceProgress, SectionProgress } from './store';
import type { AttemptResult } from '../game/types';
import { GRADE_VALUE } from '../game/scoring';

export type LevelNumber = 1 | 2 | 3 | 4 | 5;
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
  {
    level: 5, name: 'Off book', rate: 1.0, guide: false, showNames: false, cue: 'chord', tolerance: 25, pass: 0.85,
    description: 'From memory: your notes and words fade out as you learn them, while the other voices play. Passed off book on two different days = memorised.',
  },
];

/** The highest level. Concert-ready (4) is the top of readiness; off book (5) is memorisation on top. */
export const MAX_LEVEL = 5;
/** Off-book passes needed on different days before a section counts as memorised. */
export const OFF_BOOK_DAYS = 2;

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

/** Spec for level 1..5 (values outside are clamped). */
export function levelSpec(level: number): LevelSpec {
  const i = Math.min(MAX_LEVEL, Math.max(1, Math.round(level || 1))) - 1;
  return LEVELS[i];
}

export function strictnessFactor(s: Strictness): number {
  return s === 'forgiving' ? 1.3 : s === 'strict' ? 0.8 : 1;
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

export interface Readiness {
  /**
   * Share of the way to concert-ready. Levels the piece has earned in a full run count fully;
   * section levels not yet confirmed by a full run count half.
   */
  pct: number;
  /** The piece's level: the highest level passed in one full run-through (see pieceLevel). */
  pieceLevel: number;
  /** Lowest section level (practice progress). */
  minLevel: number;
  /** Piece level ≥ 3. */
  rehearsalReady: boolean;
  /** Piece level ≥ 4. */
  concertReady: boolean;
  /** Piece level 5: the full run passed off book on two different days. */
  memorised: boolean;
  /** Sections at level 5. */
  memorisedSections: number;
  /**
   * Every section has reached this level but the piece hasn't yet: confirm it with a full run
   * (e.g. singers who practised before piece levels existed). 0 when there's nothing to confirm.
   */
  unconfirmed: number;
  /** Sections at the next piece level or above (the progress bar toward it); null at level 5. */
  toward: { level: number; done: number; total: number } | null;
  /** Sections that slipped in a full run and must pass on their own first, lowest level first. */
  toFix: { level: number; sectionIds: string[] }[];
  /** Full runs passed off book so far (days), while the piece isn't memorised yet. */
  offBookDays: number;
}

/**
 * The piece's level: earned only by a full run-through at that level (stored in `prog.full`).
 * A piece with a single section has nothing to run through on top: its section level is the piece level.
 */
export function pieceLevel(sections: Section[], prog: PieceProgress | undefined): number {
  const full = Math.max(0, Math.min(MAX_LEVEL, prog?.full?.level ?? 0));
  if (sections.length === 1) return Math.max(full, Math.min(MAX_LEVEL, levelOf(prog, sections[0].id)));
  return full;
}

/** Pending "to fix" sections per level (only sections of this part), lowest level first. */
export function pendingFixes(sections: Section[], prog: PieceProgress | undefined): { level: number; sectionIds: string[] }[] {
  const tf = prog?.full?.toFix;
  if (!tf || sections.length < 2) return [];
  const order = [...sections].sort((a, b) => a.index - b.index).map((s) => s.id);
  const out: { level: number; sectionIds: string[] }[] = [];
  for (const k of Object.keys(tf).map(Number).filter((l) => l >= 1 && l <= MAX_LEVEL).sort((a, b) => a - b)) {
    const ids = order.filter((id) => (tf[k] ?? []).includes(id));
    if (ids.length) out.push({ level: k, sectionIds: ids });
  }
  return out;
}

/** Sections still to fix before a full run at `level` can count. */
export function fixesBefore(sections: Section[], prog: PieceProgress | undefined, level: number): string[] {
  return pendingFixes(sections, prog).find((f) => f.level === level)?.sectionIds ?? [];
}

export function pieceReadiness(sections: Section[], prog: PieceProgress | undefined): Readiness {
  if (sections.length === 0) {
    return {
      pct: 0, pieceLevel: 0, minLevel: 0, rehearsalReady: false, concertReady: false, memorised: false, memorisedSections: 0,
      unconfirmed: 0, toward: null, toFix: [], offBookDays: 0,
    };
  }
  const P = pieceLevel(sections, prog);
  const P4 = Math.min(4, P);
  let credit = 0;
  let min = MAX_LEVEL;
  let mem = 0;
  let towardDone = 0;
  for (const s of sections) {
    const l = Math.min(MAX_LEVEL, Math.max(0, levelOf(prog, s.id)));
    credit += P4 + 0.5 * Math.max(0, Math.min(4, l) - P4);
    min = Math.min(min, l);
    if (l >= 5) mem++;
    if (l >= P + 1) towardDone++;
  }
  return {
    pct: credit / (4 * sections.length),
    pieceLevel: P,
    minLevel: min,
    rehearsalReady: P >= 3,
    concertReady: P >= 4,
    memorised: P >= 5,
    memorisedSections: mem,
    unconfirmed: min > P ? min : 0,
    toward: P >= MAX_LEVEL ? null : { level: P + 1, done: towardDone, total: sections.length },
    toFix: pendingFixes(sections, prog),
    offBookDays: P === 4 ? prog?.full?.offBookDays?.length ?? 0 : 0,
  };
}

/**
 * Accuracy of each section within one run of the whole piece (same measure as the run's accuracy:
 * the mean grade value of the section's judged notes). Sections without judged notes are left out
 * (e.g. after the point where a run was stopped).
 */
export function sectionAccuracies(
  sections: Section[],
  noteStart: (index: number) => number | undefined,
  result: Pick<AttemptResult, 'notes'>,
): Record<string, number> {
  const sum = new Map<string, { s: number; n: number }>();
  for (const n of result.notes) {
    const t = noteStart(n.index);
    if (t == null) continue;
    const sec = sections.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6);
    if (!sec) continue;
    const e = sum.get(sec.id) ?? { s: 0, n: 0 };
    e.s += GRADE_VALUE[n.grade];
    e.n++;
    sum.set(sec.id, e);
  }
  const out: Record<string, number> = {};
  for (const [id, e] of sum) out[id] = e.s / e.n;
  return out;
}

/** The full run is due for review: piece level ≥ 3 and the last passed full run is more than a week old. */
export function fullRunDue(sections: Section[], prog: PieceProgress | undefined, now: number = Date.now()): boolean {
  const f = prog?.full;
  if (sections.length < 2 || !f || (f.level ?? 0) < 3) return false;
  const last = f.lastPassed ?? f.lastPracticed;
  return last != null && now - last > REVIEW_AFTER_DAYS * DAY_MS;
}

export interface NextStep {
  /** A section id, or 'all' for a full run-through. */
  sectionId: string;
  level: number;
  reason: string;
  /** fix = a section that slipped in a full run; full = a run-through of the whole piece. */
  kind: 'fix' | 'review' | 'full' | 'section';
}

function todayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nextStep(sections: Section[], prog: PieceProgress | undefined, now: number = Date.now()): NextStep | null {
  if (sections.length === 0) return null;
  const multi = sections.length > 1;
  const P = pieceLevel(sections, prog);
  const today = todayKey(now);
  const label = (id: string) => sections.find((s) => s.id === id)?.label ?? id;
  // 1. Sections that slipped in a full run: fix them on their own before the next full run.
  const fix = pendingFixes(sections, prog)[0];
  if (fix) {
    const more = fix.sectionIds.length - 1;
    return {
      sectionId: fix.sectionIds[0], level: fix.level, kind: 'fix',
      reason: `Fix ${label(fix.sectionIds[0])} at level ${fix.level}: it slipped in your full run.${more ? ` ${more} more to fix, then` : ' Then'} sing it all again.`,
    };
  }
  // 2. Review the whole piece once a week.
  if (multi && fullRunDue(sections, prog, now)) {
    const f = prog!.full!;
    const days = Math.floor((now - (f.lastPassed ?? f.lastPracticed ?? now)) / DAY_MS);
    const l = Math.min(MAX_LEVEL, P);
    return { sectionId: 'all', level: l, kind: 'review', reason: `Review: sing the whole piece at level ${l} (${levelSpec(l).name}). Last full run ${days} days ago.` };
  }
  // 3. Review: the most overdue section.
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
      sectionId: due.s.id, level: l, kind: 'review',
      reason: `Review ${due.s.label}: last passed ${days} days ago. Keep it at ${levelSpec(l).name}.`,
    };
  }
  // 4. Every section is above the piece level: confirm it with a full run. (Off book needs a
  // second day: a piece already sung from memory today waits until tomorrow.)
  if (multi) {
    const minSec = Math.min(...sections.map((s) => Math.min(MAX_LEVEL, levelOf(prog, s.id))));
    if (minSec > P && !(minSec === 5 && P === 4 && prog?.full?.offBookDays?.includes(today))) {
      const days = prog?.full?.offBookDays?.length ?? 0;
      const reason = minSec === 5
        ? (P === 4 && days > 0 ? `Sing the whole piece from memory again: day ${days + 1} of ${OFF_BOOK_DAYS}.` : 'Every section is memorised: now sing the whole piece from memory.')
        : P === 0
          ? `Level ${minSec} in every section: confirm it with a full run-through.`
          : `Every section is at level ${minSec}: sing the whole piece at ${levelSpec(minSec).name} to make it the piece's level.`;
      return { sectionId: 'all', level: minSec, kind: 'full', reason };
    }
  }
  // 5. Earliest section with the lowest level. (A section already sung from memory today waits
  // until tomorrow.)
  let best: Section | null = null;
  let bestLevel = 5;
  for (const s of [...sections].sort((a, b) => a.index - b.index)) {
    const l = levelOf(prog, s.id);
    if (l === 4 && prog?.sections[s.id]?.offBookDays?.includes(today)) continue;
    if (l < bestLevel) { best = s; bestLevel = l; }
  }
  if (!best || bestLevel >= MAX_LEVEL) return null;
  const target = Math.min(MAX_LEVEL, bestLevel + 1);
  const spec = levelSpec(target);
  const reason = bestLevel === 0
    ? `Start ${best.label}: learn the notes at ${Math.round(spec.rate * 100)}% tempo.`
    : target === 5
      ? `Everything is concert-ready. Now learn ${best.label} by heart.`
      : `${best.label} is your weakest section. Take it to ${spec.name}.`;
  return { sectionId: best.id, level: target, kind: 'section', reason };
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
  const P = pieceLevel(sections, prog);
  for (const g of goals) {
    if (g.days == null || g.days < 0 || P >= g.level) continue;
    const when = g.days === 0 ? 'today' : g.days === 1 ? 'tomorrow' : `in ${g.days} days`;
    const name = levelSpec(g.level).name;
    const missing = sections.filter((s) => levelOf(prog, s.id) < g.level).length;
    if (missing === 0 || sections.length === 1) {
      return `${g.label} ${when}: sing the whole piece through at ${name} (level ${g.level})`;
    }
    const perDay = g.days > 1 ? Math.ceil(missing / g.days) : missing;
    const pace = g.days > 1 && perDay < missing ? ` (about ${perDay} a day)` : '';
    return `${g.label} ${when}: get ${plural(missing, 'more section')} to ${name}${pace}, then sing it all through at that level`;
  }
  return null;
}

/**
 * Whether a run of the whole piece counts for the piece level: in one go (not stopped early, not
 * paused and resumed), at the level's full tempo, with a trustworthy timing and (off book) with
 * everything hidden and no peeking. Says why not, for the results screen.
 */
export function fullRunCounts(o: {
  level: number; rate: number; partial: boolean; resumed: boolean; timingUnsure: boolean; offBookPractice: boolean;
}): { counted: boolean; why?: 'stopped' | 'paused' | 'tempo' | 'timing' | 'offbook' } {
  if (o.partial) return { counted: false, why: 'stopped' };
  if (o.resumed) return { counted: false, why: 'paused' };
  if (o.rate < levelSpec(o.level).rate - 1e-6) return { counted: false, why: 'tempo' };
  if (o.timingUnsure) return { counted: false, why: 'timing' };
  if (o.offBookPractice) return { counted: false, why: 'offbook' };
  return { counted: true };
}
