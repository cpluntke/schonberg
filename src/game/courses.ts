// Courses: the intonation lab's two ladders as courses for every singer (docs/INTONATION.md).
//
// A course is one interval's 5-rung ladder (Listen · Tune it by hand · Sing it, with the wobble ·
// Sing it by ear · In the chord), about 25 minutes, one step a day suggested (never enforced). A
// course is "active" once its first round is logged and until its last rung is passed; a week after
// it is done comes a 1-minute quick check (rungs 3–4: three holds by ear); a slip suggests rung 4 once
// more. Everything here is a pure function of the lab's progress (game/intonation.ts) and a day.

import {
  CHECK_PASS, CHECK_ROUNDS, PASS, ROUNDS, RUNGS, RUNG_NAMES, TOL_SING, roundsToPass, wobbleWord,
  type LabInterval, type LabProgress, type LabTrack,
} from './intonation';
import { LAB_MINUTES, addDays } from '../progress/today';

export const COURSE_IDS: readonly LabInterval[] = ['fifth', 'third'];
/** Minutes of each step (Today's lab steps take the same). */
export const STEP_MINUTES: readonly number[] = LAB_MINUTES;
export const COURSE_MINUTES = STEP_MINUTES.reduce((a, b) => a + b, 0);

export interface CourseStep { name: string; goal: string; minutes: number; rule: string }
export interface Course {
  id: LabInterval;
  title: string;
  /** The outcome, in a few words ("Make the chord ring."). */
  outcome: string;
  /** One sentence after it. */
  about: string;
  /** The one-line card text on Train. */
  line: string;
  /** The degree the singer sings ("sol", "mi"). */
  note: string;
  /** The two demo sounds on the course page: the one off pure, then pure. */
  demo: { off: { title: string; sub: string; cents: number }; pure: { title: string; sub: string } };
  steps: CourseStep[];
  /** What a passed step lets you do (C4), per rung 1–4. */
  stepCanDo: string[];
  /** The milestone: "You can hear a pure fifth", and what you can do now (C6). */
  done: string;
  canDo: string[];
}

/** The pass rule of a rung, in words ("To pass: 3 of your last 4 holds close to pure"). */
export function passRule(rung: number): string {
  if (rung === 1) return `To pass: ${CHECK_PASS} of your last ${CHECK_ROUNDS} answers right`;
  if (rung === 2) return `To pass: ${PASS} of your last ${ROUNDS} tunings close to pure`;
  return `To pass: ${PASS} of your last ${ROUNDS} holds close to pure${rung === 5 ? ', picture off' : ''}`;
}

const steps = (goals: string[]): CourseStep[] => RUNG_NAMES.map((name, i) => ({ name, goal: goals[i], minutes: STEP_MINUTES[i], rule: passRule(i + 1) }));

export const COURSES: Record<LabInterval, Course> = {
  fifth: {
    id: 'fifth', title: 'Pure fifth', outcome: 'Make the open fifth stand still.', note: 'sol',
    about: 'The piano’s fifth is almost pure; the skill is to lock it, so do and sol sound like one calm note.',
    line: 'Lock the open fifth: sing sol so it stops moving against do.',
    demo: { off: { title: 'A little off', sub: 'a slow wobble', cents: 12 }, pure: { title: 'Pure fifth', sub: 'calm and still' } },
    steps: steps([
      'Hear pure and a little off; pick the calmer one.',
      'Slide sol until the pulse stops. No singing.',
      'Sing sol over the drone; the picture shows the pulse.',
      'The same, with no picture: only your ears.',
      'The app sings the other notes of the chord; you lock yours in.',
    ]),
    stepCanDo: [
      'You can hear when a fifth pulses, and when it stands still.',
      'You can find the still spot by ear, with your hands.',
      'You found the pure fifth with your own voice: sol locks onto do and stops moving.',
      'You found it with your ears alone, with no picture.',
    ],
    done: 'You can hear a pure fifth',
    canDo: [
      'Hear when an open fifth pulses, and when it stands still.',
      'Sing sol so it locks onto do, by ear, with no picture.',
      'Hold it inside a full chord while others sing.',
    ],
  },
  third: {
    id: 'third', title: 'Pure major third', outcome: 'Make the chord ring.', note: 'mi',
    about: 'Pianos tune the third a little wide; choirs that sing it lower get a calm, ringing chord.',
    line: 'Make the chord ring: sing the third a little lower than the piano.',
    demo: { off: { title: 'Piano chord', sub: 'a soft shimmer', cents: 400 - 386.31 }, pure: { title: 'Pure chord', sub: 'calm and still' } },
    steps: steps([
      'Hear pure and piano; pick the calmer one.',
      'Slide mi until the pulse stops. No singing.',
      'Sing mi over the drone; the picture shows the pulse.',
      'The same, with no picture: only your ears.',
      'The app sings do and sol; you add mi and lock the chord.',
    ]),
    stepCanDo: [
      'You can hear the piano’s third shimmer, and the pure one ring.',
      'You can find the still spot by ear, with your hands.',
      'You found the pure third with your own voice. Your mi now sits a little lower than the piano’s, where the chord rings.',
      'You found it with your ears alone, with no picture.',
    ],
    done: 'You can hear a pure major third',
    canDo: [
      'Hear the piano’s third shimmer, and the pure one ring.',
      'Sing mi a little lower than the piano, by ear, with no picture.',
      'Lock your note into a full chord while others sing.',
    ],
  },
};

export type CourseStatus = 'new' | 'active' | 'done';

/** New (nothing sung yet), active (started, not finished) or done. */
export function courseStatus(t: LabTrack): CourseStatus {
  if (t.rung > RUNGS) return 'done';
  const sung = !!t.at || t.rung > 1 || Object.values(t.logs).some((l) => l.length > 0);
  return sung ? 'active' : 'new';
}

/** The course being worked on: started and not finished (the one practised last, when both are). */
export function activeCourse(lab: LabProgress): LabInterval | null {
  const act = COURSE_IDS.filter((k) => courseStatus(lab[k]) === 'active');
  if (!act.length) return null;
  return [...act].sort((a, b) => (lab[b].at ?? 0) - (lab[a].at ?? 0))[0];
}

/** A course to suggest beside the active one: the first not started (the choir's pick first). */
export function suggestedCourse(lab: LabProgress, active: LabInterval | null = activeCourse(lab)): LabInterval | null {
  return COURSE_IDS.find((k) => k !== active && courseStatus(lab[k]) === 'new') ?? null;
}

/** A step of a course on its page: done (on that day), now (suggested for that day), or later. */
export interface StepState { rung: number; state: 'done' | 'now' | 'later'; day?: string }

/**
 * One step a day (suggested, never enforced): the current step is for today, or tomorrow when a step
 * was already passed today; each step after it a day later. Done steps carry the day they passed.
 */
export function stepStates(t: LabTrack, today: string): StepState[] {
  const passedToday = Object.values(t.passed ?? {}).includes(today);
  const first = passedToday ? addDays(today, 1) : today;
  return Array.from({ length: RUNGS }, (_, i) => {
    const rung = i + 1;
    if (rung < t.rung) return { rung, state: 'done' as const, ...(t.passed?.[rung] ? { day: t.passed[rung] } : {}) };
    return { rung, state: rung === t.rung ? 'now' as const : 'later' as const, day: addDays(first, rung - t.rung) };
  });
}

/** The quick check: none (course not done), booked, due today (or overdue), kept, or slipped (redo rung 4). */
export type ReviewState = 'none' | 'booked' | 'due' | 'kept' | 'slipped';
export function reviewState(t: LabTrack, today: string): ReviewState {
  if (t.rung <= RUNGS || !t.review) return 'none';
  if (t.redo) return 'slipped';
  if (t.review.checked) return t.review.kept ? 'kept' : 'slipped';
  return t.review.due <= today ? 'due' : 'booked';
}

/** Does Today offer the course warm-up? When the choir recommends it, or once the singer started a course. */
export function courseInToday(lab: LabProgress, recommended: boolean): boolean {
  return recommended || COURSE_IDS.some((k) => courseStatus(lab[k]) !== 'new');
}

/**
 * Today's warm-up from the courses (progress/today PlanContext.lab), or null: a quick check that is
 * due; rung 4 once more after a slip; the active course's next step (none when a step of it was
 * passed today: one step a day); with the choir's recommendation
 * the fifth, then the third, then (both done) a short tune-up in the chord. A singer who only finished
 * a course on their own gets nothing more (Today doesn't grow by itself).
 */
export function courseWarmUp(lab: LabProgress, recommended: boolean, today: string):
  { interval: LabInterval; rung: number; done: boolean; check?: boolean; redo?: boolean } | null {
  if (!courseInToday(lab, recommended)) return null;
  const due = COURSE_IDS.find((k) => reviewState(lab[k], today) === 'due');
  if (due) return { interval: due, rung: 4, done: true, check: true };
  const redo = COURSE_IDS.find((k) => lab[k].redo);
  if (redo) return { interval: redo, rung: lab[redo].redo!, done: true, redo: true };
  const act = activeCourse(lab);
  // (one step a day: a step of it passed today, the next one is for tomorrow)
  if (act) return Object.values(lab[act].passed ?? {}).includes(today) ? null : { interval: act, rung: lab[act].rung, done: false };
  if (!recommended) return null;
  const open = COURSE_IDS.find((k) => lab[k].rung <= RUNGS);
  return open ? { interval: open, rung: lab[open].rung, done: false } : { interval: 'third', rung: RUNGS, done: true };
}

/** "1 more to pass", "3 more to pass", "Passed". */
export function moreToPass(rung: number, results: number[]): string {
  const n = roundsToPass(rung, results);
  return n === 0 ? 'Passed' : `${n} more to pass`;
}

/** The pitch scale's degree for the lab's direction ("a touch", "a little", "clearly"), from the cents off pure. */
function degree(a: number): string {
  return a <= 25 ? 'a touch' : a <= 50 ? 'a little' : 'clearly';
}

/**
 * Feedback words first: the pulse word, then the direction on the pitch scale with the cents in
 * brackets ("Almost still · a touch high (6 cents)"; "Still · pure" within 2.5 cents).
 */
export function feelWords(off: number): string {
  const a = Math.abs(Math.round(off));
  const pulse = wobbleWord(off);
  const cap = pulse[0].toUpperCase() + pulse.slice(1);
  if (Math.abs(off) <= 2.5) return `${cap} · pure`;
  return `${cap} · ${degree(a)} ${off > 0 ? 'high' : 'low'} (${a} cent${a === 1 ? '' : 's'})`;
}

/** What to do next after a hold or a tuning `off` cents from pure (null when it counted as pure). */
export function feelAdvice(off: number, tol = TOL_SING): string | null {
  if (Math.abs(off) <= tol) return null;
  const a = Math.abs(off);
  const way = off > 0 ? 'lower' : 'higher';
  return a <= 25 ? `Slide a little ${way} and hold where it settles.` : `Start again a little ${way}, then slide slowly until it goes still.`;
}

/** The quick check's holds as words: "2 of 3 close to pure". */
export const checkLine = (holds: number[]) => `${holds.filter((v) => Math.abs(v) <= TOL_SING).length} of ${holds.length} close to pure`;
