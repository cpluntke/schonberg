// Today's plan in the app: builds the planner's input from the library and the store
// (progress/today.ts), keeps the plan frozen for the day once the singer starts, and runs today's
// session (Home → step → Results → next step). docs/TODAY.md has the rules.

import { chosenPartId, getPiece, singableSections, type PieceInfo } from './library';
import { go, type Route } from './router';
import { attemptLog, getProgress, loadCycle, loadProfile, practiceDays, type Cycle } from '../progress/store';
import { nextStep, pieceReadiness } from '../progress/ladder';
import { wordsDoneFor, getWords } from '../progress/words';
import { getNoteStats } from '../progress/notestats';
import { troubleNote, troubleWords } from './path';
import { WEEKDAYS, nextRehearsal } from '../progress/rehearsal';
import { loadLab, RUNGS } from '../game/intonation';
import {
  addDays, buildPlan, confirmedRehearsals, dayOf, loadLabDay, loadRehearsals, loadToday, planStatus, saveToday,
  type PlanContext, type PlanPiece, type PlanStatus, type StoredToday, type TickContext, type TodayPlan, type TodayStep,
} from '../progress/today';

/** "Dieu!", "Abendlied", "Schaffe in mir": a piece's title, short enough for a chip. */
export function shortTitle(t: string): string {
  const s = t.trim();
  const m = /^(.*?[!?])(\s|$)/.exec(s);
  if (m && m[1].length >= 3) return m[1];
  const cut = s.split(/\s*(?:[,(:;]|\s[–—-]\s)\s*/)[0].trim();
  if (cut.length <= 18) return cut || s;
  const words = cut.split(/\s+/);
  let out = '';
  for (const w of words) { if ((out + ' ' + w).trim().length > 18) break; out = (out + ' ' + w).trim(); }
  return out || words[0];
}

/** "14–21" from "Bars 14–21" (chips). */
export const shortLabel = (label: string) => label.replace(/^Bars? /, '');

/** The programme's pieces as the planner sees them, at time `now`. */
export function planPieces(now: number, cycle: Cycle = loadCycle(), voice = loadProfile().voice): PlanPiece[] {
  const focus = new Set(cycle.focusPieceIds ?? []);
  const last = new Map<string, number>();
  for (const e of attemptLog()) last.set(e.pieceId, Math.max(last.get(e.pieceId) ?? 0, e.at));
  return cycle.pieceIds.map((id) => getPiece(id)).filter((p): p is PieceInfo => !!p).map((piece) => {
    const partId = chosenPartId(piece, voice);
    const part = piece.score.parts.find((x) => x.id === partId);
    const sections = singableSections(piece, partId);
    const prog = getProgress(piece.id, partId);
    const words = wordsDoneFor(piece.id, partId, part, sections);
    const stats = part ? getNoteStats(piece.id, partId) : {};
    return {
      pieceId: piece.id, partId, title: piece.title, short: shortTitle(piece.title), sections, prog,
      readiness: pieceReadiness(sections, prog),
      next: nextStep(sections, prog, now, words),
      focus: focus.has(piece.id), words,
      trouble: (sectionId: string) => {
        const s = sections.find((x) => x.id === sectionId);
        if (!s || !part) return null;
        const t = troubleNote(part, s.start, s.end, stats);
        return t ? troubleWords(t.kind, piece.score.measures[t.measure]?.number ?? String(t.measure + 1)) : null;
      },
      lastPractised: last.get(piece.id) ?? 0,
    };
  });
}

/** Is there a rehearsal on `day` (the weekly one, or the one-off date)? */
export function rehearsalOn(cycle: Cycle = loadCycle()): (day: string) => boolean {
  return (day) => {
    if (cycle.rehearsalWeekday != null) return new Date(`${day}T12:00:00`).getDay() === cycle.rehearsalWeekday;
    return !!cycle.rehearsalDate && cycle.rehearsalDate === day;
  };
}

/** The last rehearsal in the 3 days before `today` (the "How was rehearsal?" card), or null. */
export function lastRehearsal(today: string, cycle: Cycle = loadCycle()): string | null {
  const on = rehearsalOn(cycle);
  for (let i = 1; i <= 3; i++) {
    const d = addDays(today, -i);
    if (on(d)) return d;
  }
  return null;
}

/** The intonation lab's next step (the fifth first, then the third), or null when it's off for this singer. */
export function labNext(labOn: boolean): PlanContext['lab'] {
  if (!labOn) return null;
  const lab = loadLab();
  if (lab.fifth.rung <= RUNGS) return { interval: 'fifth', rung: lab.fifth.rung, done: false };
  if (lab.third.rung <= RUNGS) return { interval: 'third', rung: lab.third.rung, done: false };
  return { interval: 'third', rung: RUNGS, done: true };
}

/** The planner's input for the day of `now`. */
export function planContext(now: Date, labOn: boolean): PlanContext {
  const cycle = loadCycle();
  const day = dayOf(now);
  const nr = nextRehearsal(cycle, now);
  const days = practiceDays(400).filter((d) => d < day);
  const yesterday = lastRehearsal(day, cycle);
  const answer = yesterday ? loadRehearsals()[yesterday] : undefined;
  return {
    now: now.getTime(),
    pieces: planPieces(now.getTime(), cycle),
    lab: labNext(labOn),
    rehearsal: nr ? { days: nr.days, weekday: WEEKDAYS[nr.at.getDay()], ...(cycle.rehearsalWeekday != null ? { time: cycle.rehearsalTime ?? '19:30' } : {}) } : null,
    lastPracticeDay: days.length ? days[days.length - 1] : null,
    // (what felt shaky goes into the plan of the day it was said)
    shaky: answer?.on === day ? (answer.shaky ?? []).map(({ pieceId, sectionId }) => ({ pieceId, sectionId })) : [],
  };
}

/** A fresh plan for the day of `now` (with what a rehearsal answer pushed out). */
export function computePlan(now: Date, labOn: boolean): TodayPlan {
  const ctx = planContext(now, labOn);
  const plan = buildPlan(ctx);
  if (ctx.shaky.length && plan.mode === 'normal') {
    const without = buildPlan({ ...ctx, shaky: [] });
    const ids = new Set(plan.steps.map((s) => s.id));
    const moved = without.steps.filter((s) => s.kind !== 'lab' && !ids.has(s.id) && !plan.steps.some((x) => x.pieceId === s.pieceId && x.sectionId === s.sectionId));
    if (moved.length) plan.moved = moved.map((s) => s.title);
  }
  return plan;
}

/** Tomorrow's plan on today's progress (a preview: tomorrow it is planned again). */
export function tomorrowPlan(labOn: boolean, now = new Date()): TodayPlan {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  const ctx = planContext(t, labOn);
  // (today counts as practised by tomorrow; no rehearsal answer applies)
  return buildPlan({ ...ctx, shaky: [], lastPracticeDay: dayOf(now) });
}

export function tickContext(day: string): TickContext {
  const lab = loadLab();
  return {
    log: attemptLog(), day, lab: loadLabDay(),
    labRung: { fifth: lab.fifth.rung, third: lab.third.rung },
    wordsAt: (pieceId, partId, sectionId) => getWords(pieceId, partId)[sectionId]?.at ?? 0,
  };
}

const sungOn = (day: string) => attemptLog().some((e) => dayOf(e.at) === day) || (loadLabDay()?.day === day);

/**
 * Today's plan as Home shows it. Frozen for the day once the singer starts it or sings anything
 * today (so it never reshuffles under them); until then planned afresh on every look.
 */
export function todayState(labOn: boolean, now = new Date()): StoredToday & { status: PlanStatus } {
  const day = dayOf(now);
  const stored = loadToday(day);
  const sung = sungOn(day);
  let s: StoredToday;
  if (stored && (stored.started || sung)) {
    s = stored.started ? stored : { ...stored, started: true };
    if (s !== stored) saveToday(s, false);
  } else {
    s = { day, plan: computePlan(now, labOn), started: sung, session: stored?.session ?? null, ...(stored?.finished ? { finished: true } : {}) };
    if (!stored || JSON.stringify(stored) !== JSON.stringify(s)) saveToday(s, false);
  }
  return { ...s, status: planStatus(s.plan, tickContext(day)) };
}

/**
 * A rehearsal answer changed what's shaky: plan the rest of today again. Steps already done stay;
 * the rest is planned afresh with the shaky passages first.
 */
export function replanToday(labOn: boolean, now = new Date()): void {
  const day = dayOf(now);
  const stored = loadToday(day);
  const fresh = computePlan(now, labOn);
  if (!stored || !stored.started) { saveToday({ day, plan: fresh, session: stored?.session ?? null }); return; }
  const st = planStatus(stored.plan, tickContext(day));
  const kept = stored.plan.steps.filter((_, i) => st.done[i]);
  const same = (a: TodayStep, b: TodayStep) => a.id === b.id || (a.kind !== 'lab' && a.pieceId === b.pieceId && a.sectionId === b.sectionId);
  const rest = fresh.steps.filter((s) => !kept.some((k) => same(k, s)));
  const steps = [...kept, ...rest].slice(0, Math.max(4, kept.length + 1));
  saveToday({ ...stored, finished: false, plan: { ...fresh, steps, minutes: steps.reduce((a, s) => a + s.minutes, 0) } });
}

/** The route of a step. */
export const stepRoute = (s: TodayStep): Route => s.route as Route;

/** Start a step of today's plan (it becomes the session's current step). `replace`: from a practice screen. */
export function goStep(s: TodayStep, replace = false): void {
  const day = dayOf(new Date());
  const stored = loadToday(day);
  if (stored) saveToday({ ...stored, started: true, session: { current: s.id } }, false);
  go(stepRoute(s), replace);
}

/** "▶ Start today's practice": the first step not done yet. */
export function startToday(labOn: boolean): void {
  const t = todayState(labOn);
  const i = t.status.next >= 0 ? t.status.next : 0;
  const s = t.plan.steps[i];
  if (s) goStep(s);
}

/** "Finish for today": today is done (Home shows Today done), the session ends. */
export function finishToday(): void {
  const day = dayOf(new Date());
  const stored = loadToday(day);
  if (stored) saveToday({ ...stored, started: true, finished: true, session: null });
}

/** Back on Home: the session pauses (the strip shows again once a step is started from the plan). */
export function endSession(): void {
  const day = dayOf(new Date());
  const stored = loadToday(day);
  if (stored?.session) saveToday({ ...stored, session: null }, false);
}

export interface Session {
  plan: TodayPlan;
  status: PlanStatus;
  /** The step being worked on. */
  index: number;
  step: TodayStep;
  /** The step after it that isn't done (null: none left). */
  next: TodayStep | null;
  nextIndex: number;
  doneCount: number;
}

/**
 * Today's session, when the singer is working through the plan and this screen belongs to the current
 * step (`pieceId`, or the lab). Null otherwise: outside a session nothing changes.
 */
export function todaySession(where: { pieceId?: string; lab?: boolean }): Session | null {
  const day = dayOf(new Date());
  const stored = loadToday(day);
  if (!stored?.session || stored.finished) return null;
  const index = stored.plan.steps.findIndex((s) => s.id === stored.session!.current);
  if (index < 0) return null;
  const step = stored.plan.steps[index];
  const belongs = where.lab ? step.kind === 'lab' : !!where.pieceId && step.pieceId === where.pieceId.split('~')[0];
  if (!belongs) return null;
  const status = planStatus(stored.plan, tickContext(day));
  const order = [...stored.plan.steps.keys()].filter((i) => i !== index);
  const after = order.filter((i) => i > index).concat(order.filter((i) => i < index));
  const nextIndex = after.find((i) => !status.done[i]) ?? -1;
  return {
    plan: stored.plan, status, index, step,
    next: nextIndex >= 0 ? stored.plan.steps[nextIndex] : null, nextIndex,
    doneCount: status.done.filter(Boolean).length,
  };
}

/** Days that count for the week: practised (this phone and the account copy) or a confirmed rehearsal. */
export function weekDays(): { practised: Set<string>; confirmed: Set<string> } {
  return { practised: new Set(practiceDays(400)), confirmed: confirmedRehearsals() };
}

/** The week goal (days a week), default 4. */
export const weekGoalOf = (g: number | undefined) => (Number.isInteger(g) && g! >= 1 && g! <= 7 ? g! : 4);

/** A kind of step in a button: "sing it all", "bars 22–29". */
export function stepShort(s: TodayStep): string {
  if (s.kind === 'lab') return s.title;
  const p = s.pieceId ? getPiece(s.pieceId) : undefined;
  const t = p ? shortTitle(p.title) : '';
  const what = s.sectionId === 'all' ? 'sing it all' : s.title.split(' · ').slice(1).join(' · ');
  return [t, what].filter(Boolean).join(' · ');
}
