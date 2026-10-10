// Today on Home (the UX review's A1–A8): the plan card, the week, Today done, the rehearsal check-in,
// the calm status line, and the session strip and footer on the screens inside today's session.
import React, { useEffect, useMemo, useState } from 'react';
import { go, leaveTo } from '../router';
import { getPiece } from '../library';
import { daysUntil, useDay, useStoreVersion } from '../hooks';
import { IconPlay } from '../icons';
import { LevelMeter } from './LevelMeter';
import { meterNodes, pathStatus, lowerLabel, joinLabels } from '../path';
import { stepWord } from '../../progress/ladder';
import { attemptLog, loadCycle, loadProfile, type Cycle } from '../../progress/store';
import { nextRehearsal } from '../../progress/rehearsal';
import { loadLab } from '../../game/intonation';
import {
  PLAN_MIN, addDays, addLabRounds, bestWeek, countedDays, dayOf, loadReached, loadRehearsals, minutesBetween, mondayOf, movedOn, notesBetween, pace,
  planStatus, saveRehearsal, stepsTo, weekDots, type Pace, type PlanStatus, type TodayPlan, type TodayStep,
} from '../../progress/today';
import {
  closeStaleSession, finishToday, goStep, lastRehearsal, planPieces, rehearsalOn, replanToday, shortLabel, shortTitle, startToday, staleSession,
  todaySession, tomorrowPlan, computePlan, tickContext, weekDays, weekGoalOf, dateWords, stepShort,
} from '../today';

const fmtDay = (day: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) => dateWords(day, o);
/** "12 Dec". */
export const shortDate = (day: string) => fmtDay(day, { day: 'numeric', month: 'short' });

// ---------------------------------------------------------------- the steps

/** The steps of a plan: numbered circles (the next one ringed, done ones ticked), minutes on the right. */
export function StepList({ steps, done, next, interactive, testid = 'plan-steps' }: {
  steps: TodayStep[]; done?: boolean[]; next?: number; interactive?: boolean; testid?: string;
}) {
  return (
    <ol className="steps-list" data-testid={testid}>
      {steps.map((s, i) => {
        const d = !!done?.[i];
        const body = (
          <>
            <span className={`check${d ? ' done' : i === next ? ' now' : ''}`} aria-hidden="true">{d ? '✓' : i + 1}</span>
            <span className="grow col step-text">
              <strong>{s.title}</strong>
              <span className="t14 muted">{s.reason}</span>
            </span>
            <span className="mins">{s.minutes} min</span>
            <span className="sr-only">{d ? ' (done)' : i === next ? ' (next)' : ''}</span>
          </>
        );
        return (
          <li key={s.id} className={`${s.why === 'shaky' ? 'shaky ' : ''}${d ? 'done' : ''}`} data-testid="plan-step" data-done={d ? '1' : '0'}>
            {interactive ? <button className="step-row" onClick={() => goStep(s)}>{body}</button> : <div className="step-row">{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- the plan card

/** "about 12 min", or, when the programme holds less than a full day, "A short day: 6 min". */
const planMinutes = (plan: TodayPlan) => (plan.minutes < PLAN_MIN && plan.mode === 'normal' ? `A short day: ${plan.minutes} min` : `about ${plan.minutes} min`);

/** `started`: today's plan is under way (frozen): Carry on, and Finish for today, from then on. */
export function PlanCard({ plan, status, labOn, secondary, rehearsalTime, started }: {
  plan: TodayPlan; status: PlanStatus; labOn: boolean; secondary?: boolean; rehearsalTime?: string; started?: boolean;
}) {
  const going = !!started || status.done.some(Boolean);
  const mins = plan.minutes;
  const start = () => startToday(labOn);
  const btn = `btn block start-today${secondary ? '' : ' primary'}`;
  const icon = <IconPlay size={18} {...(secondary ? { color: '#FF7A45' } : {})} />;
  const at = status.next >= 0 ? status.next + 1 : 1;
  const finish = going && <button className="link" data-testid="finish-today-home" onClick={() => finishToday()}>Finish for today</button>;
  if (plan.mode === 'rehearsal') {
    return (
      <section className="card plan-card" data-testid="plan-card" data-mode="rehearsal">
        <span className="eb">Rehearsal day</span>
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h2>Tonight{rehearsalTime ? ` ${rehearsalTime}` : ''} · warm up for rehearsal</h2>
          <span className="t14 muted nowrap" data-testid="plan-minutes">{mins} min</span>
        </div>
        <p className="t14 muted" style={{ margin: 0 }}>No full practice today: rehearsal is practice too.</p>
        <StepList steps={plan.steps} done={status.done} next={status.next} interactive />
        <button className={btn} data-testid="start-today" onClick={start}>{icon} {going ? `Carry on warming up · step ${at} of ${plan.steps.length}` : `Warm up · ${mins} min`}</button>
        <span className="t14 muted center">Best in the hour before you leave.</span>
        {finish}
      </section>
    );
  }
  if (plan.mode === 'welcome') {
    return (
      <section className="card plan-card" data-testid="plan-card" data-mode="welcome">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h2>Restart</h2>
          <span className="t14 muted" data-testid="plan-minutes">about {mins} min</span>
        </div>
        <StepList steps={plan.steps} done={status.done} next={status.next} interactive />
        <button className={btn} data-testid="start-today" onClick={start}>{icon} {going ? `Carry on · step ${at} of ${plan.steps.length}` : `Start · ${mins} min`}</button>
        <span className="t14 muted center">That's enough for today. Your usual plan returns tomorrow.</span>
        {finish}
      </section>
    );
  }
  return (
    <section className="card plan-card" data-testid="plan-card" data-mode="normal">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h2>Today</h2>
        <span className="t14 muted" data-testid="plan-minutes">{planMinutes(plan)}</span>
      </div>
      <StepList steps={plan.steps} done={status.done} next={status.next} interactive />
      {plan.moved?.length ? <span className="t14 muted" data-testid="plan-moved">Moved to tomorrow: {plan.moved.join(', ')}.</span> : null}
      <button className={btn} data-testid="start-today" onClick={start}>{icon} {going ? `Carry on · step ${at} of ${plan.steps.length}` : 'Start today’s practice'}</button>
      {!going && plan.steps.length >= 3 && <span className="t14 muted center">Short on time? Steps 1 and 2 matter most.</span>}
      {finish}
    </section>
  );
}

// ---------------------------------------------------------------- the week

export function useWeek(now = new Date()) {
  const profile = loadProfile();
  const goal = weekGoalOf(profile.weekGoal);
  const today = dayOf(now);
  const { practised, confirmed } = weekDays();
  const cycle = loadCycle();
  const w = weekDots(today, practised, confirmed, rehearsalOn(cycle));
  const counted = countedDays(practised, confirmed);
  const best = bestWeek(counted);
  // (the best of the weeks before this one: is this week the best so far?)
  const monday = mondayOf(today);
  const prevBest = bestWeek(new Set([...counted].filter((d) => mondayOf(d) !== monday)));
  /** Days left in the week after today (0 on Sunday). */
  const daysLeft = 6 - Math.max(0, w.dots.findIndex((d) => d.today));
  return { goal, today, ...w, best, prevBest, daysLeft, practised, confirmed };
}

/** "3 days · goal 4" / "4 of 4 days ✓" / "5 days ✓ (goal 4)". */
export const weekText = (count: number, goal: number) => (count > goal ? `${count} days ✓ (goal ${goal})`
  : count === goal ? `${count} of ${goal} days ✓` : `${count} day${count === 1 ? '' : 's'} · goal ${goal}`);

/** After today's practice: where the week stands, honestly (no "tomorrow" on a Sunday). */
export function weekLine(w: { count: number; goal: number; prevBest: { days: number } | null; daysLeft: number }): string {
  const prev = w.prevBest?.days ?? 0;
  if (w.count < w.goal) {
    const need = w.goal - w.count;
    if (need > w.daysLeft) return w.daysLeft === 0 ? 'a new week starts tomorrow' : 'every day you sing still counts';
    return `${need} more day${need === 1 ? '' : 's'} to reach your goal`;
  }
  if (prev > 1 && w.count > prev) return 'your best week so far';
  if (prev > 1 && w.count === prev) return 'matches your best week';
  if (prev > w.count && prev - w.count === 1 && w.daysLeft > 0) return `practise tomorrow to match your best week (${prev})`;
  if (prev > w.count && prev - w.count <= w.daysLeft) return `your best week: ${prev} days`;
  return 'goal reached';
}

export function WeekDots({ dots }: { dots: ReturnType<typeof useWeek>['dots'] }) {
  return (
    <div className="wk" role="list" aria-label="This week">
      {dots.map((d) => {
        const r = d.rehearsal;
        const done = d.practised || r === 'confirmed';
        const cls = done ? 'check done' : d.today ? 'check now' : 'check';
        const mark = r && (r === 'confirmed' || !d.practised) ? '♪' : done ? '✓' : '';
        const state = done ? (r === 'confirmed' ? 'rehearsal, counted' : 'practised') : r === 'tonight' ? 'rehearsal tonight' : r === 'planned' ? 'rehearsal' : d.today ? 'today' : d.future ? '' : 'not practised';
        return (
          <div key={d.day} role="listitem" aria-label={`${fmtDay(d.day, { weekday: 'long' })}${state ? `: ${state}` : ''}`}>
            <span className={`t14 ${d.today ? 'wk-today' : 'muted'}`} aria-hidden="true">{d.name}</span>
            <span className={`${cls}${r && !done ? ' reh' : ''}`} aria-hidden="true">{mark}</span>
          </div>
        );
      })}
    </div>
  );
}

export function WeekCard({ mode, nextRehearsalLabel }: { mode: 'normal' | 'rehearsal' | 'welcome' | 'after'; nextRehearsalLabel?: string }) {
  const w = useWeek();
  const cycle = loadCycle();
  const toConcert = daysUntil(cycle.concertDate);
  const hasReh = w.dots.some((d) => d.rehearsal);
  const line = mode === 'rehearsal'
    ? <><strong>Tonight counts for your week.</strong> {fmtDay(w.today, { weekday: 'long' })} ticks when you confirm you were there: tomorrow, one tap.</>
    : mode === 'welcome'
      ? <>{[nextRehearsalLabel ? `Next rehearsal ${nextRehearsalLabel}` : '', cycle.concertDate && toConcert != null && toConcert >= 0 ? `Concert ${shortDate(cycle.concertDate)}` : ''].filter(Boolean).join(' · ') || 'Every day you sing counts, whenever it is.'}</>
      : <>{hasReh ? '♪ = rehearsal, it counts. ' : ''}{mode === 'after' && nextRehearsalLabel ? `Next rehearsal ${nextRehearsalLabel}.` : w.best && w.best.days > 1 ? `Your best week: ${w.best.days} days.` : `Goal: ${w.goal} days a week.`}</>;
  return (
    <section className="card flat week-card" data-testid="week-card">
      <div className="row between">
        <h2 className="h3">{mode === 'welcome' ? 'This week' : 'Your week'}</h2>
        <span className={`t14 ${w.count >= w.goal ? 'good-text' : 'muted'}`} data-testid="week-count">{weekText(w.count, w.goal)}</span>
      </div>
      {mode !== 'welcome' && <WeekDots dots={w.dots} />}
      <span className="t14 muted">{line}</span>
      <button className="link between" data-testid="see-progress" onClick={() => go({ name: 'progress' })}>See your progress <span aria-hidden="true">›</span></button>
    </section>
  );
}

// ---------------------------------------------------------------- the status line

function paceOf(set: ReturnType<typeof planPieces>, target: number, days: number, goal: number): Pace {
  const need = set.reduce((a, p) => a + stepsTo(p.sections, p.prog, p.readiness.pieceLevel, target), 0);
  return pace(need, days, goal);
}

/**
 * One calm line: "Rehearsal Tue 19:30 · in 3 days · Concert 12 Dec · on track". The pace is the
 * concert's (every piece to Level 4 by then; without a concert date, the rehearsal pieces to Level 3
 * by the next rehearsal) at the week goal's days; orange only when clearly behind; none on the day
 * itself. With nothing ahead, a prompt to set the dates (none once the concert is over: Home says so).
 */
export function StatusLine({ cycle, rehearsalDay }: { cycle: Cycle; rehearsalDay?: boolean }) {
  const v = useStoreVersion();
  const day = useDay();
  const goal = weekGoalOf(loadProfile().weekGoal);
  // (cycle: read fresh on every render; the pieces are planned once per change of the store or the day)
  const pieces = useMemo(() => planPieces(Date.now(), cycle), [v, day]);
  const nr0 = nextRehearsal(cycle);
  const nr = nr0 && nr0.days >= 0 && !nr0.over ? nr0 : null;
  const toConcert = daysUntil(cycle.concertDate);
  const concertAhead = toConcert != null && toConcert >= 0;
  if (!nr && !concertAhead) {
    if (cycle.concertDate) return null; // (the concert is over: Home says so)
    return (
      <div className="row status-line" style={{ gap: 4, flexWrap: 'wrap' }} data-testid="status-line">
        <span className="t14 muted">No rehearsal or concert dates yet.</span>
        <button className="link inline" onClick={() => go({ name: 'settings' })}>Set dates</button>
      </div>
    );
  }
  const parts: string[] = [];
  const paces: Pace[] = [];
  const focus = pieces.filter((p) => p.focus);
  if (nr && nr.days > 0) {
    parts.push(`Rehearsal ${nr.label} · ${nr.days === 1 ? 'tomorrow' : `in ${nr.days} days`}`);
    // (a weekly rehearsal works on pieces for weeks: only without a concert date does it set the pace)
    if (!cycle.concertDate) paces.push(paceOf(focus.length ? focus : pieces, 3, nr.days, goal));
  }
  if (cycle.concertDate && concertAhead) {
    parts.push(toConcert === 0 ? 'Concert today' : `Concert ${shortDate(cycle.concertDate)}`);
    if (toConcert! > 0) paces.push(paceOf(pieces, 4, toConcert!, goal));
  }
  const rank = (p: Pace) => (p.kind === 'behind' ? 2 : p.kind === 'tight' ? 1 : 0);
  const worst = paces.reduce<Pace | null>((a, p) => (!a || rank(p) > rank(a) ? p : a), null);
  const word = !worst || !pieces.length ? '' : worst.kind === 'on-track' ? 'on track'
    : worst.kind === 'tight' ? `a little tight: about ${worst.perDay} steps a day` : `behind: about ${worst.perDay} steps a day to catch up`;
  const ready = nr && !rehearsalDay ? focus.filter((p) => p.readiness.rehearsalReady && !p.readiness.concertReady) : [];
  if (!parts.length && !ready.length) return null;
  return (
    <div className="col status-line" style={{ gap: 2 }} data-testid="status-line">
      {parts.length > 0 && (
        <span className="t14 muted">
          {parts.join(' · ')}{word && <> · <span className={worst?.kind === 'behind' ? 'behind' : undefined} data-testid="pace">{word}</span></>}
        </span>
      )}
      {ready.map((p) => <span key={p.pieceId} className="t14 good-text">{shortTitle(p.title)} is rehearsal-ready ✓</span>)}
    </div>
  );
}

// ---------------------------------------------------------------- the day after rehearsal

/** "How was rehearsal?": confirm you were there (the day counts) and say what felt shaky. Up to 3 days after. */
export function RehearsalCheck({ labOn }: { labOn: boolean }) {
  const today = useDay();
  const cycle = loadCycle();
  const date = lastRehearsal(today, cycle);
  const [open, setOpen] = useState(false);
  if (!date) return null;
  const a = loadRehearsals()[date] ?? {};
  // (answered on another day: nothing more to say)
  if (a.answered && a.on !== today) return null;
  const weekday = fmtDay(date, { weekday: 'short' });
  const pieces = planPieces(Date.now(), cycle);
  const focus = pieces.filter((p) => p.focus);
  const chips = (focus.length ? focus : pieces).flatMap((p) => p.sections.map((s) => ({ pieceId: p.pieceId, sectionId: s.id, label: `${p.short} ${shortLabel(s.label)}` }))).slice(0, 12);
  const shaky = a.shaky ?? [];
  const save = (patch: Partial<typeof a>, replan = false) => {
    saveRehearsal(date, { ...a, ...patch, on: today });
    if (replan) replanToday(labOn);
  };
  const isOn = (c: { pieceId: string; sectionId: string }) => shaky.some((x) => x.pieceId === c.pieceId && x.sectionId === c.sectionId);
  if (a.answered && !open) {
    return (
      <section className="card checkin" data-testid="rehearsal-check" data-state="answered">
        <div className="li">
          <span className={`check${a.attended ? ' done' : ''}`} aria-hidden="true">{a.attended ? '✓' : ''}</span>
          <span className="grow t16">{a.attended ? 'I was at rehearsal' : 'Not at rehearsal this time'}</span>
          {a.attended && <span className="t14 muted">{weekday} counts</span>}
        </div>
        <div className="li">
          <span className="check done" aria-hidden="true">✓</span>
          <span className="grow t16">{shaky.length ? <>You said: <strong>{shaky.map((s) => s.label).join(', ')}</strong></> : 'You said: all fine'}</span>
          <button className="link inline" data-testid="rehearsal-change" aria-label="Change your answer" onClick={() => setOpen(true)}>change</button>
        </div>
      </section>
    );
  }
  return (
    <section className="card checkin" data-testid="rehearsal-check" data-state="open">
      <h2 className="h3">How was rehearsal?</h2>
      <button className="chip attended" aria-pressed={!!a.attended} data-testid="rehearsal-attended" onClick={() => save({ attended: !a.attended })}>
        {a.attended ? '✓ ' : ''}I was at rehearsal{a.attended ? ` · ${weekday} counts` : ''}
      </button>
      {chips.length > 0 && <>
        <span className="t14 muted">What felt shaky?</span>
        <div className="chips" role="group" aria-label="What felt shaky?">
          {chips.map((c) => (
            <button key={`${c.pieceId}|${c.sectionId}`} className="chip" aria-pressed={isOn(c)} data-testid="shaky-chip"
              onClick={() => save({ shaky: isOn(c) ? shaky.filter((x) => !(x.pieceId === c.pieceId && x.sectionId === c.sectionId)) : [...shaky, c], fine: false }, true)}>
              {c.label}
            </button>
          ))}
          <button className="chip" aria-pressed={!!a.fine && !shaky.length} data-testid="shaky-fine" onClick={() => { save({ shaky: [], fine: true, answered: true }, true); setOpen(false); }}>All fine</button>
        </div>
      </>}
      <button className="btn small" data-testid="rehearsal-done" onClick={() => { save({ answered: true }, true); setOpen(false); }}>Done</button>
    </section>
  );
}

// ---------------------------------------------------------------- today done

/** Today done (A2): one stats line, what moved, tomorrow, and practising more as an option. */
export function TodayDone({ plan, labOn }: { plan: TodayPlan; labOn: boolean }) {
  const v = useStoreVersion();
  const today = useDay();
  const tomorrow = addDays(today, 1);
  const log = useMemo(() => attemptLog(), [v, today]);
  // (the lab keeps no log: its steps done today count with their planned minutes)
  const status = useMemo(() => planStatus(plan, tickContext(today, log)), [plan, log, today]);
  const mins = minutesBetween(log, today, tomorrow) + plan.steps.reduce((a, s, i) => a + (s.kind === 'lab' && status.done[i] ? s.minutes : 0), 0);
  const notes = notesBetween(today, tomorrow);
  const w = useWeek();
  const tmr = useMemo(() => tomorrowPlan(labOn), [v, today, labOn]);
  const more = () => {
    const fresh = computePlan(new Date(), labOn);
    const st = planStatus(fresh, tickContext(today));
    const s = fresh.steps.find((_, i) => !st.done[i]);
    if (s) go(s.route as never); else go({ name: 'library' });
  };
  return (
    <>
      <section className="card done-band" data-testid="today-done">
        <h2 role="status">Today done ✓</h2>
        <span className="t16" data-testid="done-stats">{[`${Math.max(1, mins)} min`, notes > 0 ? `${notes.toLocaleString('en-GB')} notes sung right` : ''].filter(Boolean).join(' · ')}</span>
        <span className="t14 muted">You can stop here. Your progress is saved.</span>
        <div className="divider" />
        <span className="t14"><strong>{weekText(w.count, w.goal)}</strong> <span className="muted">· {weekLine(w)}</span></span>
        <button className="link between" data-testid="see-progress" onClick={() => go({ name: 'progress' })}>See your progress <span aria-hidden="true">›</span></button>
      </section>
      <WhatMoved plan={plan} log={log} status={status} />
      {tmr.steps.length > 0 && (
        <section className="card" data-testid="tomorrow">
          <div className="row between" style={{ alignItems: 'baseline' }}>
            <h2 className="h3">Tomorrow · {fmtDay(tomorrow)}{tmr.mode === 'rehearsal' ? ' · rehearsal day' : ''}</h2>
            <span className="t14 muted nowrap">about {tmr.minutes} min</span>
          </div>
          <StepList steps={tmr.steps} testid="tomorrow-steps" />
        </section>
      )}
      <button className="btn block" data-testid="practise-more" onClick={more}>Practise more (optional)</button>
    </>
  );
}

/** "on bars 22–29", "on both passages", "on all 4 passages", "on bars 1–5 · 6–13 · 14–21". */
export function onPassages(ids: string[], total: number, label: (id: string) => string): string {
  if (total > 1 && ids.length === total) return total === 2 ? 'on both passages' : `on all ${total} passages`;
  if (ids.length <= 3) return `on ${lowerLabel(joinLabels(ids.map(label)))}`;
  return `on ${ids.length} passages`;
}

/** Only real moves today: steps passed for the first time, levels the whole piece reached, lab steps passed. */
function WhatMoved({ plan, log, status }: { plan: TodayPlan; log: ReturnType<typeof attemptLog>; status: PlanStatus }) {
  const today = useDay();
  const moved = movedOn(log, today);
  const reached = loadReached();
  const lab = loadLab();
  const pieces = moved.length ? planPieces(Date.now(), loadCycle(), loadProfile().voice, log) : [];
  const labPassed = plan.steps.filter((s, i) => s.kind === 'lab' && s.lab && !s.lab.tuneUp && status.done[i] && lab[s.lab.interval].rung > s.lab.rung);
  const rows = moved.map((m) => {
    const piece = getPiece(m.pieceId);
    const prog = pieces.find((p) => p.pieceId === m.pieceId && p.partId === m.partId);
    if (!piece || !prog) return null;
    const ps = pathStatus(prog.sections, prog.prog);
    const n = prog.sections.length;
    const label = (id: string) => prog.sections.find((s) => s.id === id)?.label ?? id;
    const lines = m.steps.map((g) => {
      const all = prog.sections.filter((s) => {
        const sp = prog.prog?.sections[s.id];
        return (sp?.level ?? 0) >= g.level || (g.step === 'slow' && (sp?.slow ?? 0) >= g.level);
      }).map((s) => s.id);
      const ids = all.length === n ? all : g.sectionIds;
      return `Level ${g.level} · ${stepWord(g.step)} ✓${n === 1 ? '' : ` ${onPassages(ids, n, label)}`}`;
    });
    const r = reached[`${m.pieceId}|${m.partId}`] ?? {};
    const lv = Object.entries(r).filter(([, t]) => dayOf(t) === today).map(([l]) => Number(l)).sort((a, b) => b - a)[0];
    const milestone = lv ? `The whole piece reached Level ${lv}${lv === 3 ? ': rehearsal-ready' : lv === 4 ? ': concert-ready' : lv === 5 ? ': memorised' : ''}` : null;
    const next = ps.working
      ? `Next: Level ${ps.working.level} ${stepWord(ps.working.step)}${ps.allInTempo ? ', the whole piece' : n > 1 && ps.todo.length ? ` ${onPassages(ps.todo, n, label)}` : ''}`
      : null;
    return { key: `${m.pieceId}|${m.partId}`, title: piece.title, lines: [milestone, ...lines].filter(Boolean) as string[], next,
      nodes: meterNodes({ level: ps.pieceLevel, slow: ps.half && ps.working ? ps.working.level : 0, now: ps.working }) };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (!rows.length && !labPassed.length) return null;
  return (
    <section className="card" data-testid="what-moved">
      <h2 className="h3">What moved</h2>
      <div className="checklist">
        {rows.map((r) => (
          <div key={r.key} className="li" style={{ alignItems: 'flex-start' }}>
            <span className="check done" aria-hidden="true">✓</span>
            <div className="grow col" style={{ gap: 2 }}>
              <strong className="t16">{r.title}</strong>
              {r.lines.map((l) => <span key={l} className="t14 muted">{l}</span>)}
              {r.next && <span className="t14 muted">{r.next}</span>}
            </div>
            <LevelMeter nodes={r.nodes} label={r.title} />
          </div>
        ))}
        {labPassed.map((s) => (
          <div key={s.id} className="li" style={{ alignItems: 'flex-start' }}>
            <span className="check done" aria-hidden="true">✓</span>
            <div className="grow col" style={{ gap: 2 }}>
              <strong className="t16">{s.lab!.interval === 'third' ? 'Pure third' : 'Pure fifth'} · step {s.lab!.rung} of 5</strong>
              <span className="t14 muted">Passed</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the session strip and footer

/**
 * "Today · step 2 of 4 ●◐○○ · 5 min" on the screens inside today's session (the pre-run card,
 * Results, the words, the lab). Nothing outside a session. A session left from yesterday says so and
 * leads to today's plan. On the lab it also counts rounds (the lab keeps no dates) and offers the
 * next step.
 */
export function SessionStrip({ pieceId, lab, compact }: { pieceId?: string; lab?: boolean; compact?: boolean }) {
  const [, setTick] = useState(0);
  useStoreVersion();
  useDay();
  const ses = todaySession({ pieceId, lab });
  const labStep = lab && ses?.step.kind === 'lab' ? ses.step.lab : undefined;
  useEffect(() => {
    if (!labStep) return;
    // (the lab saves without telling anyone: look for new rounds while it's open)
    const read = () => { try { return JSON.stringify(loadLab()[labStep.interval]); } catch { return ''; } };
    let prev = read();
    const t = window.setInterval(() => {
      const cur = read();
      if (cur === prev) return;
      const before = JSON.parse(prev || '{}') as { rung?: number; logs?: Record<number, number[]> };
      const after = JSON.parse(cur || '{}') as { rung?: number; logs?: Record<number, number[]> };
      prev = cur;
      const a = before.logs?.[labStep.rung] ?? [], b = after.logs?.[labStep.rung] ?? [];
      if (JSON.stringify(a) !== JSON.stringify(b)) addLabRounds(labStep.interval, labStep.rung, Math.max(1, b.length - a.length), Date.now());
      setTick((x) => x + 1);
    }, 700);
    return () => clearInterval(t);
  }, [labStep?.interval, labStep?.rung]);
  if (!ses) {
    if (!staleSession({ pieceId, lab })) return null;
    return (
      <div className={`session${compact ? ' compact' : ''}`} data-testid="session-stale" role="status">
        <span>That was yesterday’s plan</span>
        <span className="grow" />
        <button className="link inline" data-testid="session-today" onClick={() => { closeStaleSession(); leaveTo({ name: 'home' }); }}>Today ›</button>
      </div>
    );
  }
  const n = ses.plan.steps.length;
  const curDone = ses.status.done[ses.index];
  const head = curDone ? `Today · ${ses.doneCount} of ${n} done` : `Today · step ${ses.index + 1} of ${n}`;
  return (
    <div className={`session${compact ? ' compact' : ''}`} data-testid="session-strip" role="status">
      <span className="nowrap">{head}</span>
      <span className="ticks" aria-hidden="true">
        {ses.plan.steps.map((s, i) => <i key={s.id} className={ses.status.done[i] ? 'done' : i === ses.index ? 'now' : ''} />)}
      </span>
      <span className="grow" />
      <span className="muted mono nowrap" aria-label={`${ses.status.minutesLeft} minutes left`}>{ses.status.minutesLeft} min</span>
      {lab && (
        ses.next
          ? <button className="link inline" data-testid="session-next" onClick={() => goStep(ses.next!)}>{curDone ? 'Next ›' : 'Skip ›'}</button>
          : <button className="link inline" data-testid="session-finish" onClick={() => { finishToday(); go({ name: 'home' }); }}>Finish</button>
      )}
    </div>
  );
}

/** One action of a practice screen's footer (Results, the words). */
export interface FootAction { label: React.ReactNode; why?: React.ReactNode; onClick: () => void; testid?: string; repeats?: boolean }

/**
 * The footer inside today's session. Once the step is done, the primary is the next step of today
 * ("Next: Abendlied · sing it all", "step 3 of 4 · 3 min"; the last step's is "Finish for today") and
 * the screen's own next step becomes the second button (unless it starts the same run); "Finish for
 * today" stays a quiet link. After a miss the screen's own buttons stay, with "Skip to next step" as a
 * link. Outside a session nothing changes; a session left from yesterday gets no "Next" (its strip
 * leads to today's plan). `own`: what the screen's primary would start, to spot a duplicate.
 */
export function sessionFoot(pieceId: string, primary: FootAction, again: FootAction | null, finish: boolean, own?: { sectionId: string; level: number; step?: string }): {
  primary: FootAction; again: FootAction | null; skip: FootAction | null; finish: boolean; session: boolean;
} {
  const ses = todaySession({ pieceId });
  if (!ses) return { primary, again, skip: null, finish: finish && !staleSession({ pieceId }), session: false };
  const n = ses.plan.steps.length;
  if (!ses.status.done[ses.index]) {
    const skip = ses.next ? { label: 'Skip to next step', testid: 'skip-step', onClick: () => goStep(ses.next!, true) } : null;
    return { primary, again, skip, finish: true, session: true };
  }
  const nx = ses.next;
  const dup = !!nx && !!own && nx.pieceId === pieceId.split('~')[0] && nx.sectionId === own.sectionId && nx.level === own.level && (!own.step || nx.step === own.step);
  const demoted = primary.repeats || dup || primary.testid === 'arcade-run' || primary.testid === 'finish-primary' ? null
    : { label: primary.label, testid: primary.testid, onClick: primary.onClick };
  return {
    primary: nx
      ? { label: <><IconPlay size={18} /> Next: {stepShort(nx)}</>, testid: 'today-next', why: `step ${ses.nextIndex + 1} of ${n} · ${nx.minutes} min`, onClick: () => goStep(nx, true) }
      : { label: 'Finish for today', testid: 'today-finish', why: 'Every step of today is done.', onClick: () => { finishToday(); leaveTo({ name: 'home' }); } },
    again: demoted ?? again,
    skip: null,
    finish: !!nx,
    session: true,
  };
}
