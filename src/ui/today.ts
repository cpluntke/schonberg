// Today's plan in the app: builds the planner's input from the library and the store
// (progress/today.ts), keeps the plan frozen for the day once the singer starts, and runs today's
// session (Home → step → Results → next step). docs/TODAY.md has the rules.

import { chosenPartId, getPiece, singableSections, type PieceInfo } from './library';
import { go, type Route } from './router';
import { attemptLog, getProgress, loadCycle, loadProfile, logStep, practiceDays, type AttemptLog, type Cycle } from '../progress/store';
import { nextStep, pieceReadiness } from '../progress/ladder';
import { wordsDoneFor, getWords } from '../progress/words';
import { getNoteStats } from '../progress/notestats';
import { troubleNote, troubleWords } from './path';
import { WEEKDAYS, nextRehearsal } from '../progress/rehearsal';
import { loadLab } from '../game/intonation';
import { courseWarmUp } from '../game/courses';
import {
  MAX_STEPS, addDays, buildPlan, confirmedRehearsals, dayOf, loadAnyToday, loadLabDay, loadRehearsals, loadToday, planStatus, saveToday, stepDone, stepsSungOn,
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
export function planPieces(now: number, cycle: Cycle = loadCycle(), voice = loadProfile().voice, log: AttemptLog[] = attemptLog()): PlanPiece[] {
  const focus = new Set(cycle.focusPieceIds ?? []);
  const last = new Map<string, number>();
  // (the last run of the whole piece that counted: opened its level, or a real go where too much slipped)
  const lastFull = new Map<string, number>();
  for (const e of log) {
    last.set(e.pieceId, Math.max(last.get(e.pieceId) ?? 0, e.at));
    if (logStep(e) === 'tempo' && (e.sectionId === 'all' || (e.sectionId === 'practice' && e.fullRun))) {
      const k = `${e.pieceId}|${e.partId}`;
      lastFull.set(k, Math.max(lastFull.get(k) ?? 0, e.at));
    }
  }
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
      lastFullRun: lastFull.get(`${piece.id}|${partId}`) ?? 0,
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

/**
 * Today's warm-up from the intonation courses (game/courses courseWarmUp): only when the choir
 * recommends the courses (`labOn`: the lab is in the choir's programme) or the singer started one.
 */
export function labNext(labOn: boolean, now = new Date()): PlanContext['lab'] {
  return courseWarmUp(loadLab(), labOn, dayOf(now));
}

/** The planner's input for the day of `now`. */
export function planContext(now: Date, labOn: boolean): PlanContext {
  const cycle = loadCycle();
  const day = dayOf(now);
  const nr = nextRehearsal(cycle, now);
  // (a rehearsal the singer was at counts as practice: no "welcome back" after it)
  const days = [...practiceDays(400), ...confirmedRehearsals()].filter((d) => d < day).sort();
  const yesterday = lastRehearsal(day, cycle);
  const answer = yesterday ? loadRehearsals()[yesterday] : undefined;
  return {
    now: now.getTime(),
    pieces: planPieces(now.getTime(), cycle),
    lab: labNext(labOn, now),
    rehearsal: nr && nr.days >= 0 && !nr.over
      ? { days: nr.days, weekday: WEEKDAYS[nr.at.getDay()], ...(cycle.rehearsalWeekday != null ? { time: cycle.rehearsalTime ?? '19:30' } : {}) }
      : null,
    lastPracticeDay: days.length ? days[days.length - 1] : null,
    // (what felt shaky goes into the plan of the day it was said)
    shaky: answer?.on === day ? (answer.shaky ?? []).map(({ pieceId, sectionId }) => ({ pieceId, sectionId })) : [],
  };
}

/** A fresh plan for the day of `now` (with what a rehearsal answer pushed out, not counting what's done today). */
export function computePlan(now: Date, labOn: boolean): TodayPlan {
  const ctx = planContext(now, labOn);
  const plan = buildPlan(ctx);
  if (ctx.shaky.length && plan.mode === 'normal') {
    const without = buildPlan({ ...ctx, shaky: [] });
    const ids = new Set(plan.steps.map((s) => s.id));
    const t = tickContext(dayOf(now));
    const moved = without.steps.filter((s) => s.kind !== 'lab' && !ids.has(s.id) && !stepDone(s, t)
      && !plan.steps.some((x) => x.pieceId === s.pieceId && x.sectionId === s.sectionId));
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

export function tickContext(day: string, log: AttemptLog[] = attemptLog()): TickContext {
  const lab = loadLab();
  return {
    log, day, lab: loadLabDay(),
    labRung: { fifth: lab.fifth.rung, third: lab.third.rung },
    labChecked: { fifth: lab.fifth.review?.checked, third: lab.third.review?.checked },
    wordsAt: (pieceId, partId, sectionId) => getWords(pieceId, partId)[sectionId]?.at ?? 0,
  };
}

const samePassage = (a: TodayStep, b: TodayStep) => a.id === b.id || (a.kind !== 'lab' && b.kind !== 'lab' && a.pieceId === b.pieceId && a.partId === b.partId && a.sectionId === b.sectionId);
const withMinutes = (plan: TodayPlan, steps: TodayStep[]): TodayPlan => ({ ...plan, steps, minutes: steps.reduce((a, s) => a + s.minutes, 0) });

/** Keep the steps done in `old`, then `fresh`'s steps (not on a passage already there). */
function keepDone(old: TodayPlan, fresh: TodayPlan, done: boolean[]): TodayPlan {
  const kept = old.steps.filter((_, i) => done[i]);
  const rest = fresh.steps.filter((s) => !kept.some((k) => samePassage(k, s)));
  const steps = [...kept, ...rest].slice(0, Math.max(MAX_STEPS, kept.length + 1));
  const keptTitles = new Set(kept.map((k) => k.title));
  const moved = (fresh.moved ?? []).filter((t) => !keptTitles.has(t));
  const out = withMinutes({ ...fresh, ...(moved.length ? { moved } : {}) }, steps);
  if (!moved.length) delete out.moved;
  return out;
}

/**
 * A frozen plan whose undone steps no longer fit: a piece left the programme, the singer changed voice
 * part, its passages changed (a new edition), or the rehearsal it warmed up for is over. Those steps are
 * planned again (done ones stay); null when everything still fits.
 */
function outdated(plan: TodayPlan, done: boolean[], now: Date, labOn: boolean): TodayPlan | null {
  const cycle = loadCycle();
  const voice = loadProfile().voice;
  const bad = plan.steps.some((s, i) => {
    if (done[i] || !s.pieceId) return false;
    const piece = getPiece(s.pieceId);
    if (!piece || !cycle.pieceIds.includes(s.pieceId)) return true;
    const partId = chosenPartId(piece, voice);
    if (partId !== s.partId) return true;
    return s.sectionId !== 'all' && !singableSections(piece, partId).some((x) => x.id === s.sectionId);
  });
  const nr = nextRehearsal(cycle, now);
  const rehearsalOver = plan.mode === 'rehearsal' && !(nr && nr.days === 0 && !nr.over);
  if (!bad && !rehearsalOver) return null;
  return keepDone(plan, computePlan(now, labOn), done);
}

export interface TodayState extends StoredToday {
  status: PlanStatus;
  /** What to store (the plan changed, or got frozen); null: nothing to write. Saved after render. */
  save: StoredToday | null;
}

/**
 * Today's plan as Home shows it, without writing anything (Home stores `save` after rendering). Frozen
 * for the day once the singer starts it or sings anything today (so it never reshuffles under them);
 * until then planned afresh on every look. A fresh plan on a day with singing already done starts with
 * that work, ticked.
 */
export function computeToday(labOn: boolean, now = new Date(), log: AttemptLog[] = attemptLog()): TodayState {
  const day = dayOf(now);
  const stored = loadToday(day);
  const sung = log.some((e) => dayOf(e.at) === day) || loadLabDay()?.day === day;
  const tick = tickContext(day, log);
  let s: StoredToday;
  if (stored && (stored.started || sung)) {
    s = stored.started ? stored : { ...stored, started: true };
    const fixed = outdated(s.plan, planStatus(s.plan, tick).done, now, labOn);
    if (fixed) s = { ...s, plan: fixed, finished: false };
  } else {
    let plan = computePlan(now, labOn);
    if (sung && plan.mode === 'normal') {
      const earlier = stepsSungOn(log, day, planPieces(now.getTime()));
      if (earlier.length) {
        const rest = plan.steps.filter((x) => !earlier.some((e) => samePassage(e, x)));
        plan = withMinutes(plan, [...earlier, ...rest].slice(0, Math.max(MAX_STEPS, earlier.length + 1)));
      }
    }
    s = { day, plan, started: sung, session: stored?.session ?? null, ...(stored?.finished ? { finished: true } : {}) };
  }
  const changed = !stored || JSON.stringify(stored) !== JSON.stringify(s);
  return { ...s, status: planStatus(s.plan, tick), save: changed ? s : null };
}

/** computeToday, stored at once (for taps, not for rendering). */
export function todayState(labOn: boolean, now = new Date()): TodayState {
  const t = computeToday(labOn, now);
  if (t.save) saveToday(t.save, false);
  return t;
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
  saveToday({ ...stored, finished: false, plan: keepDone(stored.plan, fresh, st.done) });
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

const belongsTo = (step: TodayStep, where: { pieceId?: string; lab?: boolean }) =>
  where.lab ? step.kind === 'lab' : !!where.pieceId && step.pieceId === where.pieceId.split('~')[0];

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
  if (!belongsTo(step, where)) return null;
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

/**
 * A session left open from an earlier day (the singer was still on Results at midnight, or came back
 * to the app the next morning): that plan is over. The screen says so and leads to today's plan.
 */
export function staleSession(where: { pieceId?: string; lab?: boolean }): boolean {
  const raw = loadAnyToday();
  if (!raw || raw.day >= dayOf(new Date()) || !raw.session || raw.finished) return false;
  const step = raw.plan.steps.find((s) => s.id === raw.session!.current);
  return !!step && belongsTo(step, where);
}

/** Close a session left from an earlier day (then go to today's plan). */
export function closeStaleSession(): void {
  const raw = loadAnyToday();
  if (raw && raw.day < dayOf(new Date())) saveToday({ ...raw, finished: true, session: null });
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

/** "Sat 10 Oct", "12 Dec", "Tuesday": a date in words (weekday, day, month), without commas. */
export function dateWords(t: number | string | Date, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  const d = typeof t === 'string' ? new Date(`${t}T12:00:00`) : new Date(t);
  const part = (k: 'weekday' | 'day' | 'month') => {
    if (!o[k]) return '';
    try { return new Intl.DateTimeFormat('en-US', { [k]: o[k] }).format(d); } catch { return ''; }
  };
  return [part('weekday'), part('day'), part('month')].filter(Boolean).join(' ');
}
