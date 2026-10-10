// Today on Home (the UX review's A1–A8): the plan card, the week, Today done, the rehearsal check-in,
// the calm status line, and the session strip on the screens inside today's session.
import React, { useEffect, useState } from 'react';
import { go } from '../router';
import { getPiece } from '../library';
import { daysUntil } from '../hooks';
import { IconPlay } from '../icons';
import { LevelMeter } from './LevelMeter';
import { meterNodes, pathStatus, lowerLabel, joinLabels } from '../path';
import { stepWord } from '../../progress/ladder';
import { attemptLog, loadCycle, loadProfile, type Cycle } from '../../progress/store';
import { nextRehearsal } from '../../progress/rehearsal';
import { loadLab } from '../../game/intonation';
import {
  addDays, addLabRounds, bestWeek, countedDays, dayOf, loadReached, loadRehearsals, minutesBetween, movedOn, notesBetween, pace,
  saveRehearsal, stepsTo, weekDots, type Pace, type PlanStatus, type TodayPlan, type TodayStep,
} from '../../progress/today';
import {
  finishToday, goStep, lastRehearsal, planPieces, rehearsalOn, replanToday, shortLabel, shortTitle, startToday, todaySession,
  tomorrowPlan, computePlan, tickContext, weekDays, weekGoalOf, dateWords,
} from '../today';
import { planStatus } from '../../progress/today';

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

export function PlanCard({ plan, status, labOn, secondary, rehearsalTime }: {
  plan: TodayPlan; status: PlanStatus; labOn: boolean; secondary?: boolean; rehearsalTime?: string;
}) {
  const started = status.done.some(Boolean);
  const mins = plan.minutes;
  const start = () => startToday(labOn);
  const btn = `btn block start-today${secondary ? '' : ' primary'}`;
  const icon = <IconPlay size={18} {...(secondary ? { color: '#FF7A45' } : {})} />;
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
        <button className={btn} data-testid="start-today" onClick={start}>{icon} {started ? 'Carry on warming up' : `Warm up · ${mins} min`}</button>
        <span className="t14 muted center">Best in the hour before you leave.</span>
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
        <button className={btn} data-testid="start-today" onClick={start}>{icon} {started ? 'Carry on' : `Start · ${mins} min`}</button>
        <span className="t14 muted center">That's enough for today. Your usual plan returns tomorrow.</span>
      </section>
    );
  }
  return (
    <section className="card plan-card" data-testid="plan-card" data-mode="normal">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h2>Today</h2>
        <span className="t14 muted" data-testid="plan-minutes">about {mins} min</span>
      </div>
      <StepList steps={plan.steps} done={status.done} next={status.next} interactive />
      {plan.moved?.length ? <span className="t14 muted" data-testid="plan-moved">Moved to tomorrow: {plan.moved.join(', ')}.</span> : null}
      <button className={btn} data-testid="start-today" onClick={start}>{icon} {started ? `Carry on · step ${status.next + 1} of ${plan.steps.length}` : 'Start today’s practice'}</button>
      {!started && plan.steps.length >= 3 && <span className="t14 muted center">Short on time? Steps 1 and 2 matter most.</span>}
      {started && <button className="link" data-testid="finish-today-home" onClick={() => finishToday()}>Finish for today</button>}
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
  const best = bestWeek(countedDays(practised, confirmed));
  return { goal, today, ...w, best, practised, confirmed };
}

/** "3 days · goal 4" / "4 of 4 days ✓". */
export const weekText = (count: number, goal: number) => (count >= goal ? `${count} of ${goal} days ✓` : `${count} day${count === 1 ? '' : 's'} · goal ${goal}`);

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
 * by the next rehearsal) at the week goal's days; orange only when clearly behind.
 */
export function StatusLine({ cycle = loadCycle(), rehearsalDay }: { cycle?: Cycle; rehearsalDay?: boolean }) {
  const nr = nextRehearsal(cycle);
  const toConcert = daysUntil(cycle.concertDate);
  const goal = weekGoalOf(loadProfile().weekGoal);
  const pieces = planPieces(Date.now(), cycle);
  if (!nr && (toConcert == null || toConcert < 0)) {
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
  if (cycle.concertDate && toConcert != null && toConcert >= 0) {
    parts.push(`Concert ${shortDate(cycle.concertDate)}`);
    paces.push(paceOf(pieces, 4, toConcert, goal));
  }
  const rank = (p: Pace) => (p.kind === 'behind' ? 2 : p.kind === 'tight' ? 1 : 0);
  const worst = paces.reduce<Pace | null>((a, p) => (!a || rank(p) > rank(a) ? p : a), null);
  const word = !worst || !pieces.length ? '' : worst.kind === 'on-track' ? 'on track'
    : worst.kind === 'tight' ? `a little tight: about ${worst.perDay} steps a day` : `behind: about ${worst.perDay} steps a day to catch up`;
  const ready = nr && nr.days >= 0 && !rehearsalDay ? focus.filter((p) => p.readiness.rehearsalReady && !p.readiness.concertReady) : [];
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

/** "How was rehearsal?": confirm you were there (the day counts) and say what felt shaky. */
export function RehearsalCheck({ labOn }: { labOn: boolean }) {
  const today = dayOf(new Date());
  const cycle = loadCycle();
  const date = lastRehearsal(today, cycle);
  const [open, setOpen] = useState(false);
  if (!date) return null;
  const a = loadRehearsals()[date] ?? {};
  // (answered on another day: nothing more to say)
  if (a.answered && a.on !== today) return null;
  if (!a.answered && daysUntil(date) != null && (daysUntil(date) ?? 0) < -2) return null;
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
          <button className="link inline" data-testid="rehearsal-change" onClick={() => setOpen(true)}>change</button>
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
  const today = dayOf(new Date());
  const tomorrow = addDays(today, 1);
  const log = attemptLog();
  // (the lab keeps no log: its steps done today count with their planned minutes)
  const labDone = planStatus(plan, tickContext(today));
  const mins = minutesBetween(log, today, tomorrow) + plan.steps.reduce((a, s, i) => a + (s.kind === 'lab' && labDone.done[i] ? s.minutes : 0), 0);
  const notes = notesBetween(today, tomorrow);
  const w = useWeek();
  const tmr = tomorrowPlan(labOn);
  const weekLine = w.count >= w.goal
    ? (w.best && w.best.days > w.count ? `practise tomorrow to match your best week (${w.best.days})` : w.count > 1 && w.best && w.best.days <= w.count ? 'your best week so far' : 'goal reached')
    : `${w.goal - w.count} more day${w.goal - w.count === 1 ? '' : 's'} to reach your goal`;
  const more = () => {
    const fresh = computePlan(new Date(), labOn);
    const st = planStatus(fresh, tickContext(today));
    const s = fresh.steps.find((_, i) => !st.done[i]);
    if (s) go(s.route as never); else go({ name: 'pieces' });
  };
  return (
    <>
      <section className="card done-band" data-testid="today-done" role="status">
        <h2>Today done ✓</h2>
        <span className="t16" data-testid="done-stats">{[`${Math.max(1, mins)} min`, notes > 0 ? `${notes.toLocaleString('en-GB')} notes sung right` : ''].filter(Boolean).join(' · ')}</span>
        <span className="t14 muted">You can stop here. Your progress is saved.</span>
        <div className="divider" />
        <span className="t14"><strong>{weekText(w.count, w.goal)}</strong> <span className="muted">· {weekLine}</span></span>
        <button className="link between" data-testid="see-progress" onClick={() => go({ name: 'progress' })}>See your progress <span aria-hidden="true">›</span></button>
      </section>
      <WhatMoved plan={plan} />
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

/** Only real moves today: steps passed for the first time, levels the whole piece reached, lab steps passed. */
function WhatMoved({ plan }: { plan: TodayPlan }) {
  const today = dayOf(new Date());
  const moved = movedOn(attemptLog(), today);
  const reached = loadReached();
  const lab = loadLab();
  const labPassed = plan.steps.filter((s) => s.kind === 'lab' && s.lab && lab[s.lab.interval].rung > s.lab.rung);
  const rows = moved.map((m) => {
    const piece = getPiece(m.pieceId);
    if (!piece) return null;
    const prog = planPieces(Date.now()).find((p) => p.pieceId === m.pieceId && p.partId === m.partId);
    if (!prog) return null;
    const ps = pathStatus(prog.sections, prog.prog);
    const n = prog.sections.length;
    const label = (id: string) => prog.sections.find((s) => s.id === id)?.label ?? id;
    const lines = m.steps.map((g) => {
      const all = n > 1 && prog.sections.every((s) => {
        const sp = prog.prog?.sections[s.id];
        return (sp?.level ?? 0) >= g.level || (g.step === 'slow' && (sp?.slow ?? 0) >= g.level);
      });
      const where = all ? `on all ${n} passages` : g.sectionIds.length === 1 ? `on ${lowerLabel(label(g.sectionIds[0]))}` : `on ${lowerLabel(joinLabels(g.sectionIds.map(label)))}`;
      return `Level ${g.level} · ${stepWord(g.step)} ✓ ${n === 1 ? '' : where}`.trim();
    });
    const r = reached[`${m.pieceId}|${m.partId}`] ?? {};
    const lv = Object.entries(r).filter(([, t]) => dayOf(t) === today).map(([l]) => Number(l)).sort((a, b) => b - a)[0];
    const milestone = lv ? `The whole piece reached Level ${lv}${lv === 3 ? ': rehearsal-ready' : lv === 4 ? ': concert-ready' : lv === 5 ? ': memorised' : ''}` : null;
    const next = ps.working ? `Next: Level ${ps.working.level} ${stepWord(ps.working.step)}` : null;
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

// ---------------------------------------------------------------- the session strip

/**
 * "Today · step 2 of 4 ●◐○○ · 5 min left" on the screens inside today's session (the pre-run card,
 * Results, the lab). Nothing outside a session. On the lab it also counts rounds (the lab keeps no
 * dates) and offers the next step.
 */
export function SessionStrip({ pieceId, lab, compact }: { pieceId?: string; lab?: boolean; compact?: boolean }) {
  const [, setTick] = useState(0);
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
  if (!ses) return null;
  const n = ses.plan.steps.length;
  const curDone = ses.status.done[ses.index];
  const head = curDone ? `Today · ${ses.doneCount} of ${n} done` : `Today · step ${ses.index + 1} of ${n}`;
  return (
    <div className={`session${compact ? ' compact' : ''}`} data-testid="session-strip" role="status">
      <span>{head}</span>
      <span className="ticks" aria-hidden="true">
        {ses.plan.steps.map((s, i) => <i key={s.id} className={ses.status.done[i] ? 'done' : i === ses.index ? 'now' : ''} />)}
      </span>
      <span className="grow" />
      <span className="muted mono">{ses.status.minutesLeft} min left</span>
      {lab && (
        ses.next
          ? <button className="link inline" data-testid="session-next" onClick={() => goStep(ses.next!)}>{curDone ? 'Next step ›' : 'Skip ›'}</button>
          : <button className="link inline" data-testid="session-finish" onClick={() => { finishToday(); go({ name: 'home' }); }}>Finish</button>
      )}
    </div>
  );
}
