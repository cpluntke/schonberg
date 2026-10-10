// The mastery ladder (docs/design-critique.md, "The progression").
// Pure functions only: no storage access here.
import type { ScoreNote, Section } from '../music/types';
import type { PieceProgress, SectionProgress } from './store';
import type { AttemptResult, NoteResult } from '../game/types';
import { GRADE_VALUE } from '../game/scoring';
import { ENTRY_REST_SEC, LATE_MS } from '../game/analysis';

export type LevelNumber = 1 | 2 | 3 | 4 | 5;
export type Strictness = 'forgiving' | 'standard' | 'strict';
/**
 * Every level has two steps (docs/LEVELS.md): SLOW (70%) then IN TEMPO (100%). Passing in tempo
 * completes the level (and ticks slow); a singer may always try in tempo straight away.
 */
export type Step = 'slow' | 'tempo';
export const STEPS: readonly Step[] = ['slow', 'tempo'];
/** Tempo of every level's slow step. */
export const SLOW_RATE = 0.7;

/** What one step of a level asks for. */
export interface StepRules {
  /** Tempo factor. */
  rate: number;
  /** Cents half-width (before the strictness factor). */
  tolerance: number;
  /**
   * Accuracy needed to pass (0..1). At an every-note step it is only a backstop (a run can't pass on
   * forgiven notes alone): there, every note must be right (`everyNote`).
   */
  pass: number;
  /**
   * Every note must be right ("good" or better; notes the scorer can't judge reliably are forgiven
   * unless clearly wrong, see noteVerdict). Replaces the percentage, and short sections get no slack.
   */
  everyNote: boolean;
  /**
   * Counts only with headphones on (the singer says so before the run): through the phone speaker
   * the guide bleeds into the mic and the tracker can't hear every note reliably, which an
   * every-note step can't allow. Without them the run is practice (see speakerPractice).
   */
  headphones: boolean;
  /** The entries (first note, notes after a rest) must be sung and on time on average (entriesOnTime). */
  entries: boolean;
}

/** One level: what it adds, and its two steps. */
export interface LevelSpec {
  level: LevelNumber;
  /** Notes, Words, Alone, Concert, By heart. */
  name: string;
  /** Your own part audible as a guide. */
  guide: boolean;
  /** Note names shown on the bars (otherwise lyrics only). */
  showNames: boolean;
  /** Starting-pitch cue during the count-in. */
  cue: 'note' | 'chord';
  /** Sung on "doo" instead of the words (the words are shown dimmed, for orientation). */
  doo: boolean;
  description: string;
  slow: StepRules;
  tempo: StepRules;
}

/** One step of one level: the level's parts and the step's rules. */
export interface StepSpec extends Omit<LevelSpec, 'slow' | 'tempo'>, StepRules {
  step: Step;
  /** "Level 2 · Words · slow" */
  label: string;
}

const both = (tolerance: number, pass: number): Pick<LevelSpec, 'slow' | 'tempo'> => ({
  slow: { rate: SLOW_RATE, tolerance, pass, everyNote: false, headphones: false, entries: false },
  tempo: { rate: 1, tolerance, pass, everyNote: false, headphones: false, entries: false },
});

export const LEVELS: LevelSpec[] = [
  {
    level: 1, name: 'Notes', guide: true, showNames: true, cue: 'note', doo: true,
    slow: { rate: SLOW_RATE, tolerance: 50, pass: 0.75, everyNote: true, headphones: true, entries: false },
    tempo: { rate: 1, tolerance: 50, pass: 0.8, everyNote: false, headphones: false, entries: true },
    description: 'Learn the notes on “doo”, with your part playing, note names shown and your starting note. Slow: every note right, with headphones on. In tempo: 80%, coming in on time.',
  },
  {
    level: 2, name: 'Words', guide: true, showNames: true, cue: 'note', doo: false, ...both(35, 0.8),
    description: 'Now with the words, your part still playing.',
  },
  {
    level: 3, name: 'Alone', guide: false, showNames: true, cue: 'note', doo: false, ...both(30, 0.8),
    description: 'Your part is muted: sing against the other voices only. Rehearsal-ready.',
  },
  {
    level: 4, name: 'Concert', guide: false, showNames: false, cue: 'chord', doo: false, ...both(25, 0.85),
    description: 'No note names (lyrics only), starting chord only. Concert-ready.',
  },
  {
    level: 5, name: 'By heart', guide: false, showNames: false, cue: 'chord', doo: false, ...both(25, 0.85),
    description: 'From memory: your notes and words fade out as you learn them, while the other voices play. In tempo on two different days = memorised.',
  },
];

/** "slow" / "in tempo". */
export const stepWord = (step: Step): string => (step === 'slow' ? 'slow' : 'in tempo');

/** "Level 2 · Words" */
export function levelLabel(level: number): string {
  const l = levelSpec(level);
  return `Level ${l.level} · ${l.name}`;
}

/** "Level 2 · Words · slow" / "Level 2 · Words · in tempo". */
export function stepLabel(level: number, step: Step): string {
  return `${levelLabel(level)} · ${stepWord(step)}`;
}

/** Spec for one step of level 1..5 (values outside are clamped). */
export function stepSpec(level: number, step: Step): StepSpec {
  const { slow, tempo, ...l } = levelSpec(level);
  const s = step === 'slow' ? 'slow' : 'tempo';
  return { ...l, ...(s === 'slow' ? slow : tempo), step: s, label: stepLabel(l.level, s) };
}

/**
 * The step to sing a level at by default: in tempo once the level (or its slow step) was passed,
 * else slow (the app suggests slow first when a level is new; in tempo is always allowed).
 */
export function stepFor(sp: Pick<SectionProgress, 'level' | 'slow'> | undefined, level: number): Step {
  return (sp?.level ?? 0) >= level || (sp?.slow ?? 0) >= level ? 'tempo' : 'slow';
}

/**
 * A section's current step: the next level (its in-tempo level + 1, at most 5), slow until that
 * level's slow step was passed, then in tempo.
 */
export function currentStep(sp: Pick<SectionProgress, 'level' | 'slow'> | undefined): { level: LevelNumber; step: Step } {
  const target = Math.min(MAX_LEVEL, Math.max(0, sp?.level ?? 0) + 1) as LevelNumber;
  return { level: target, step: stepFor(sp, target) };
}

/** "every note right", "80%" or "80%, entries on time": what a step needs to pass, for the cards. */
export function passLabel(spec: Pick<StepRules, 'pass' | 'everyNote'> & Partial<Pick<StepRules, 'entries'>>): string {
  if (spec.everyNote) return 'every note right';
  return `${Math.round(spec.pass * 100)}%${spec.entries ? ', entries on time' : ''}`;
}

/**
 * At an every-note step (level 1 slow): was this note right? 'right' = graded "good" or better.
 * 'forgiven' = below "good", but the scorer can't judge the note reliably (NoteResult.unsure: a very
 * short note, or a pitch outside the tracker's range) and didn't clearly hear it wrong
 * (NoteResult.clearly: no voice at all, or a definite pitch clearly off). Else 'wrong'.
 */
export function noteVerdict(n: Pick<NoteResult, 'grade' | 'unsure' | 'clearly'>): 'right' | 'forgiven' | 'wrong' {
  if (n.grade === 'perfect' || n.grade === 'good') return 'right';
  return n.unsure && !n.clearly ? 'forgiven' : 'wrong';
}

/** The notes that weren't right (noteVerdict), in score order. */
export function wrongNotes(result: Pick<AttemptResult, 'notes'>): NoteResult[] {
  return result.notes.filter((n) => noteVerdict(n) === 'wrong').sort((a, b) => a.index - b.index);
}

/**
 * Whether one attempt (a section, or a whole run overall) reaches the step's mark, before any
 * timing or entries check: the pass mark, and at an every-note step no wrong note.
 */
export function attemptPasses(level: number, step: Step, result: Pick<AttemptResult, 'accuracy' | 'notes'>): boolean {
  const spec = stepSpec(level, step);
  const accuracy = Number.isFinite(result.accuracy) ? result.accuracy : 0;
  if (accuracy < spec.pass) return false;
  return !spec.everyNote || result.notes.every((n) => noteVerdict(n) !== 'wrong');
}

/** The entries of a run, and whether they came in on time (entriesOnTime). */
export interface EntriesCheck {
  ok: boolean;
  /** Entry notes in the run. */
  entries: number;
  /** Entries not sung at all (no onset). */
  missed: number;
  /** Mean onset of the sung entries (ms after the written start, minus `offsetMs`); null when none was sung. */
  meanMs: number | null;
}

/**
 * Level 1 in tempo: the entries must each be sung and, on average, on time. Entries as analysis.ts
 * defines them: the first note (of the part, or of the run) and every note after a rest of at least
 * ENTRY_REST_SEC. Each needs an onset (`onsetMs !== null`), and their mean onset must be at most
 * LATE_MS. `offsetMs` is taken off every onset first (the part of the delay the line-up showed to be
 * the device's, on a phone without a measured delay). A run without entries passes.
 */
export function entriesOnTime(
  partNotes: readonly Pick<ScoreNote, 'start' | 'dur'>[],
  notes: readonly Pick<NoteResult, 'index' | 'onsetMs'>[],
  offsetMs = 0,
): EntriesCheck {
  const sorted = [...notes].sort((a, b) => a.index - b.index);
  const entries = sorted.filter((n, k) => {
    const i = n.index;
    if (k === 0 || i === 0) return true;
    const prev = partNotes[i - 1];
    const cur = partNotes[i];
    if (!prev || !cur) return false;
    return cur.start - (prev.start + prev.dur) >= ENTRY_REST_SEC - 1e-6;
  });
  const sung = entries.filter((n) => n.onsetMs !== null);
  const missed = entries.length - sung.length;
  const meanMs = sung.length ? sung.reduce((a, n) => a + (n.onsetMs! - offsetMs), 0) / sung.length : null;
  const ok = entries.length === 0 || (missed === 0 && meanMs !== null && meanMs <= LATE_MS);
  return { ok, entries: entries.length, missed, meanMs: meanMs == null ? null : Math.round(meanMs) };
}

/** The highest level. Concert-ready (4) is the top of readiness; off book (5) is memorisation on top. */
export const MAX_LEVEL = 5;
/** Off-book passes needed on different days before a section counts as memorised. */
export const OFF_BOOK_DAYS = 2;

/** Listening (route level 0): once, all parts, unscored. Not a level. */
export const LISTEN = {
  level: 0 as const,
  name: 'Listen',
  rate: 1.0,
  guide: true,
  showNames: true,
  description: 'Hear the passage once with all parts. Not scored.',
};

export const REVIEW_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

/** The level-wide parts of level 1..5 (values outside are clamped); stepSpec for a step's rules. */
export function levelSpec(level: number): LevelSpec {
  const i = Math.min(MAX_LEVEL, Math.max(1, Math.round(level || 1))) - 1;
  return LEVELS[i];
}

export function strictnessFactor(s: Strictness): number {
  return s === 'forgiving' ? 1.3 : s === 'strict' ? 0.8 : 1;
}

/** Tolerance in cents for a step after the profile strictness factor. */
export function effectiveTolerance(level: number, step: Step, strictness: Strictness): number {
  return Math.round(stepSpec(level, step).tolerance * strictnessFactor(strictness));
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
   * Share of the way to concert-ready. The piece level counts fully; section levels above it count
   * half.
   */
  pct: number;
  /** The piece's level (see pieceLevel). */
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
  /**
   * Open fix lists: sections that slipped in the full run that opened a level (docs/LEVELS.md).
   * Once each has passed that level on its own, the piece reaches the level. Lowest level first.
   */
  toFix: { level: number; sectionIds: string[] }[];
  /** Levels with a clean-run star: a counted full run in which every section held. */
  clean: number[];
  /** Full runs passed off book so far (days), while the piece isn't memorised yet. */
  offBookDays: number;
}

/**
 * The piece's level (stored in `prog.full`): a counted full run at that level opened it, and every
 * section that slipped in that run has since passed the level on its own (docs/LEVELS.md).
 * A piece with a single section has nothing to run through on top: its section level is the piece level.
 */
export function pieceLevel(sections: Section[], prog: PieceProgress | undefined): number {
  const full = Math.max(0, Math.min(MAX_LEVEL, prog?.full?.level ?? 0));
  if (sections.length === 1) return Math.max(full, Math.min(MAX_LEVEL, levelOf(prog, sections[0].id)));
  return full;
}

/** How far under the level's pass mark a run's overall accuracy may be and still open the level. */
export const OPEN_MARGIN = 0.1;

/**
 * Whether a counted full run opens its level (docs/LEVELS.md): at most half of its `sections`
 * slipped, AND its overall accuracy came within OPEN_MARGIN (10 points) of the level's pass mark.
 * Otherwise the run is practice: the fix list would be most of the piece, or the run as a whole was
 * far off (e.g. two of four sections not sung at all), which is the sections again, not a run that
 * nearly held.
 */
export function runOpensLevel(o: { level: number; sections: number; slipped: number; accuracy: number }): boolean {
  const acc = Number.isFinite(o.accuracy) ? o.accuracy : 0;
  return o.sections > 0 && o.slipped * 2 <= o.sections && acc >= stepSpec(o.level, 'tempo').pass - OPEN_MARGIN - 1e-9;
}

/**
 * Open fix lists per level (only sections of this part), lowest level first. Only lists from a run
 * that opened the level count (FullRunProgress.toFixLocks; store.upgradeFullRuns checks lists saved
 * by earlier versions), and never one naming more than half the sections.
 */
export function pendingFixes(sections: Section[], prog: PieceProgress | undefined): { level: number; sectionIds: string[] }[] {
  const tf = prog?.full?.toFix;
  if (!tf || sections.length < 2) return [];
  const order = [...sections].sort((a, b) => a.index - b.index).map((s) => s.id);
  const out: { level: number; sectionIds: string[] }[] = [];
  for (const k of Object.keys(tf).map(Number).filter((l) => l >= 1 && l <= MAX_LEVEL).sort((a, b) => a - b)) {
    const ids = order.filter((id) => (tf[k] ?? []).includes(id));
    if (!ids.length || ids.length * 2 > sections.length || prog?.full?.toFixLocks?.[k] !== true) continue;
    out.push({ level: k, sectionIds: ids });
  }
  return out;
}

/** Sections still to fix at `level` after the full run that opened it. */
export function fixesBefore(sections: Section[], prog: PieceProgress | undefined, level: number): string[] {
  return pendingFixes(sections, prog).find((f) => f.level === level)?.sectionIds ?? [];
}

/** Levels with a clean-run star (FullRunProgress.clean), lowest first. */
export function cleanLevels(prog: PieceProgress | undefined): number[] {
  const c = prog?.full?.clean;
  return Array.isArray(c) ? [...new Set(c.filter((l) => Number.isInteger(l) && l >= 1 && l <= MAX_LEVEL))].sort((a, b) => a - b) : [];
}

export function pieceReadiness(sections: Section[], prog: PieceProgress | undefined): Readiness {
  if (sections.length === 0) {
    return {
      pct: 0, pieceLevel: 0, minLevel: 0, rehearsalReady: false, concertReady: false, memorised: false, memorisedSections: 0,
      unconfirmed: 0, toward: null, toFix: [], clean: [], offBookDays: 0,
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
    clean: cleanLevels(prog),
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

/** Fewer judged notes than this in a section: one weak note shouldn't decide a whole level. */
export const SHORT_SECTION_NOTES = 8;
/** A section scoring under this within a run never counts as held, slack or not. */
export const MIN_SECTION_SCORE = 0.5;

/**
 * Each section's result within one run of the whole piece: its accuracy (shown), the value the pass
 * mark is checked against, and its wrong notes (noteVerdict; counted at every level, decisive only at
 * an every-note step). Short sections (fewer than SHORT_SECTION_NOTES judged notes) get one note of
 * slack: their weakest note counts as sung well, so a single "ok" can't fail a level. Not at an
 * every-note step (level 1 slow): there every note counts. Full runs count in tempo only (the default).
 */
export function sectionChecks(
  sections: Section[],
  noteStart: (index: number) => number | undefined,
  result: Pick<AttemptResult, 'notes'>,
  level?: number,
  step: Step = 'tempo',
): Record<string, { accuracy: number; checked: number; notes: number; wrong: number[] }> {
  const vals = new Map<string, number[]>();
  const wrong = new Map<string, number[]>();
  for (const n of result.notes) {
    const t = noteStart(n.index);
    if (t == null) continue;
    const sec = sections.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6);
    if (!sec) continue;
    vals.set(sec.id, [...(vals.get(sec.id) ?? []), GRADE_VALUE[n.grade]]);
    if (noteVerdict(n) === 'wrong') wrong.set(sec.id, [...(wrong.get(sec.id) ?? []), n.index]);
  }
  const everyNote = level != null && stepSpec(level, step).everyNote;
  const out: Record<string, { accuracy: number; checked: number; notes: number; wrong: number[] }> = {};
  for (const [id, v] of vals) {
    const sum = v.reduce((a, b) => a + b, 0);
    const accuracy = sum / v.length;
    // Short sections: their weakest note counts as "good", as long as it was sung at all (a
    // missed note is never forgiven). A one-note section sung "ok" therefore holds; one that's
    // missed doesn't. A section that got no real score in the run (under 50%) never holds.
    const weakest = Math.min(...v);
    const slack = !everyNote && v.length < SHORT_SECTION_NOTES && weakest > 0 ? (sum - weakest + GRADE_VALUE.good) / v.length : accuracy;
    const checked = accuracy < MIN_SECTION_SCORE ? accuracy : Math.max(accuracy, slack);
    out[id] = { accuracy, checked, notes: v.length, wrong: (wrong.get(id) ?? []).sort((a, b) => a - b) };
  }
  return out;
}

/** A section held within a full run at `level` (in tempo unless `step` says otherwise; see sectionChecks). */
export function sectionHeld(level: number, check: { checked: number; wrong: number[] }, step: Step = 'tempo'): boolean {
  const spec = stepSpec(level, step);
  return check.checked >= spec.pass - 1e-9 && (!spec.everyNote || check.wrong.length === 0);
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
  /** The step to sing it at (fixes, reviews and full runs are always in tempo). */
  step: Step;
  reason: string;
  /** fix = a section that slipped in the full run that opened a level; full = a run-through of the whole piece. */
  kind: 'fix' | 'review' | 'full' | 'section';
  /**
   * Level 2 slow, and the passage's words in rhythm (src/progress/words.ts) aren't passed yet: the UI
   * can offer "Say it in rhythm first".
   */
  wordsFirst?: boolean;
}

/**
 * Whether a passage's words in rhythm were passed (words.ts): true, false, or null when the passage
 * has no words (or it isn't known).
 */
export type WordsDone = (sectionId: string) => boolean | null;

function todayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nextStep(sections: Section[], prog: PieceProgress | undefined, now: number = Date.now(), words?: WordsDone): NextStep | null {
  if (sections.length === 0) return null;
  const multi = sections.length > 1;
  const P = pieceLevel(sections, prog);
  const today = todayKey(now);
  const label = (id: string) => sections.find((s) => s.id === id)?.label ?? id;
  // 1. Sections that slipped in the full run that opened a level: fix them on their own and the
  // piece reaches that level (no second full run).
  const fix = pendingFixes(sections, prog)[0];
  if (fix) {
    const more = fix.sectionIds.length - 1;
    // Off book: the days the piece will have been sung from memory once this list is done.
    const days = new Set([...(prog?.full?.offBookDays ?? []), today]).size;
    const what = `Fix ${label(fix.sectionIds[0])}`;
    const goal = fix.level <= P
      ? `${what} at Level ${fix.level} in tempo: it slipped in your full run.`
      : fix.level === 5 && days < OFF_BOOK_DAYS
        ? `${what} at Level 5 in tempo to finish the whole piece from memory: day ${days} of ${OFF_BOOK_DAYS}.`
        : `${what} in tempo to reach ${levelLabel(fix.level)}.`;
    return {
      sectionId: fix.sectionIds[0], level: fix.level, step: 'tempo', kind: 'fix',
      reason: `${goal}${more ? ` ${more} more to fix after this one.` : ''}`,
    };
  }
  // 2. Review the whole piece once a week.
  if (multi && fullRunDue(sections, prog, now)) {
    const f = prog!.full!;
    const days = Math.floor((now - (f.lastPassed ?? f.lastPracticed ?? now)) / DAY_MS);
    const l = Math.min(MAX_LEVEL, P);
    return { sectionId: 'all', level: l, step: 'tempo', kind: 'review', reason: `Review: sing the whole piece at ${levelLabel(l)}. Last full run ${days} days ago.` };
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
      sectionId: due.s.id, level: l, step: 'tempo', kind: 'review',
      reason: `Review ${due.s.label}: last passed ${days} days ago. Keep it at ${levelLabel(l)}.`,
    };
  }
  // 4. Memorising: the whole piece passed from memory on one day, so sing it all from memory again
  // on another day (not today).
  const fullDays = prog?.full?.offBookDays ?? [];
  if (multi && P === 4 && fullDays.length > 0 && !fullDays.includes(today)) {
    return {
      sectionId: 'all', level: 5, step: 'tempo', kind: 'full',
      reason: `Sing the whole piece from memory again: day ${Math.min(OFF_BOOK_DAYS, fullDays.length + 1)} of ${OFF_BOOK_DAYS}.`,
    };
  }
  // 5. Every section is above the piece level (in tempo): confirm it with a full run. (Off book
  // needs a second day: a piece already sung from memory today waits until tomorrow.)
  if (multi) {
    const minSec = Math.min(...sections.map((s) => Math.min(MAX_LEVEL, levelOf(prog, s.id))));
    if (minSec > P && !(minSec === 5 && P === 4 && prog?.full?.offBookDays?.includes(today))) {
      const days = prog?.full?.offBookDays?.length ?? 0;
      const reason = minSec === 5
        ? (P === 4 && days > 0 ? `Sing the whole piece from memory again: day ${days + 1} of ${OFF_BOOK_DAYS}.` : 'Every passage is memorised: now sing the whole piece from memory.')
        : P === 0
          ? `Level ${minSec} in every passage: confirm it with a full run-through.`
          : `Every passage is at Level ${minSec}: sing the whole piece at ${levelLabel(minSec)} to make it the piece's level.`;
      return { sectionId: 'all', level: minSec, step: 'tempo', kind: 'full', reason };
    }
  }
  // 6. Earliest section at the lowest step: the lowest level, and of those a section still on its
  // slow step before one whose slow step is done (one new thing at a time, for the whole piece).
  // (A section already sung from memory today waits until tomorrow.)
  let best: Section | null = null;
  let bestRank = Infinity;
  let bestLevel = 5;
  for (const s of [...sections].sort((a, b) => a.index - b.index)) {
    const l = levelOf(prog, s.id);
    if (l === 4 && prog?.sections[s.id]?.offBookDays?.includes(today)) continue;
    const rank = 2 * l + (stepFor(prog?.sections[s.id], Math.min(MAX_LEVEL, l + 1)) === 'tempo' ? 1 : 0);
    if (rank < bestRank) { best = s; bestRank = rank; bestLevel = l; }
  }
  if (!best || bestLevel >= MAX_LEVEL) return null;
  const sp = prog?.sections[best.id];
  const { level: target, step } = currentStep(sp);
  const left = sections.filter((s) => levelOf(prog, s.id) < target).length;
  // Sections still to pass the target level's slow step (or in tempo).
  const leftSlow = sections.filter((s) => stepFor(prog?.sections[s.id], target) === 'slow' && levelOf(prog, s.id) < target).length;
  const started = sections.some((s) => (prog?.sections[s.id]?.attempts ?? 0) > 0 || levelOf(prog, s.id) > 0);
  const tail = target === 5 && step === 'slow' ? ' Everything is concert-ready: now learn it by heart.'
    : step === 'tempo' ? ' Slow is done: now in tempo.'
      : multi && left === 1 ? ` Last passage at Level ${target}.`
        : multi && leftSlow === 1 ? ' Last passage to sing slow.'
          : target === 1 && !started ? ' Learn the notes on “doo”.'
            : '';
  const out: NextStep = { sectionId: best.id, level: target, step, kind: 'section', reason: `${best.label}: ${stepLabel(target, step)}.${tail}` };
  if (target === 2 && step === 'slow' && words?.(best.id) === false) out.wordsFirst = true;
  return out;
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
 * "Rehearsal in 3 days: get 4 more passages to Level 3 · Alone (about 2 a day), then sing it all through at that level".
 * Counts the passages not yet at the target level in tempo. Returns null when there is no upcoming
 * date or the target is already met.
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
    const name = levelLabel(g.level);
    // (levelOf is the in-tempo level: a passage whose slow step alone is done still needs its run in tempo)
    const missing = sections.filter((s) => levelOf(prog, s.id) < g.level).length;
    if (missing === 0 || sections.length === 1) {
      return `${g.label} ${when}: sing the whole piece through at ${name}`;
    }
    // Practice days before the date: today up to the day before (none left on the day itself).
    const perDay = g.days > 1 ? Math.ceil(missing / g.days) : missing;
    const pace = perDay < missing ? ` (about ${perDay} a day)` : '';
    return `${g.label} ${when}: get ${plural(missing, 'more passage')} to ${name}${pace}, then sing it all through at that level`;
  }
  return null;
}

/**
 * A step that counts only with headphones (level 1 slow), sung without them (`headphones`: the
 * singer's answer before the run, undefined = not answered): practice, it never changes a level.
 */
export function speakerPractice(level: number, step: Step, headphones: boolean | undefined): boolean {
  return level >= 1 && stepSpec(level, step).headphones && headphones !== true;
}

/**
 * Whether a run of one section counts for its step: not stopped early, at the step's tempo (or
 * faster), with a trustworthy timing, (off book) with everything hidden and no peeking, and (level 1
 * slow) with headphones on. Says why not.
 */
export function sectionRunCounts(o: {
  level: number; step: Step; rate: number; partial: boolean; timingUnsure: boolean; offBookPractice: boolean; headphones?: boolean;
}): { counted: boolean; why?: 'stopped' | 'tempo' | 'timing' | 'offbook' | 'speaker' } {
  if (o.partial) return { counted: false, why: 'stopped' };
  if (o.rate < stepSpec(o.level, o.step).rate - 1e-6) return { counted: false, why: 'tempo' };
  if (o.timingUnsure) return { counted: false, why: 'timing' };
  if (o.offBookPractice) return { counted: false, why: 'offbook' };
  if (speakerPractice(o.level, o.step, o.headphones)) return { counted: false, why: 'speaker' };
  return { counted: true };
}

/**
 * Whether a run of the whole piece counts for the piece level: in tempo (a slow run of the whole
 * piece is practice), in one go (not stopped early, not paused and resumed), at full tempo, with a
 * trustworthy timing, and (off book) with everything hidden and no peeking. Says why not, for the
 * results screen.
 */
export function fullRunCounts(o: {
  level: number; step: Step; rate: number; partial: boolean; resumed: boolean; timingUnsure: boolean; offBookPractice: boolean; arcade?: boolean; headphones?: boolean;
}): { counted: boolean; why?: 'arcade' | 'slow' | 'stopped' | 'paused' | 'tempo' | 'timing' | 'offbook' | 'speaker' } {
  // The arcade is a reward mode: its runs of the whole piece are for fun, never a level test.
  if (o.arcade) return { counted: false, why: 'arcade' };
  if (o.step === 'slow') return { counted: false, why: 'slow' };
  if (o.partial) return { counted: false, why: 'stopped' };
  if (o.resumed) return { counted: false, why: 'paused' };
  if (o.rate < stepSpec(o.level, 'tempo').rate - 1e-6) return { counted: false, why: 'tempo' };
  if (o.timingUnsure) return { counted: false, why: 'timing' };
  if (o.offBookPractice) return { counted: false, why: 'offbook' };
  if (speakerPractice(o.level, 'tempo', o.headphones)) return { counted: false, why: 'speaker' };
  return { counted: true };
}
