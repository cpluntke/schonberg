// Your progress (the UX review's A6): this week, the last five weeks, each programme piece on its
// level ladder, and "Getting better" when the data shows it. Reached from Today's week card and Settings.
import React from 'react';
import { back, go, openAt } from '../router';
import { useStoreVersion, useDay, daysUntil } from '../hooks';
import { IconBack } from '../icons';
import { attemptLog, getProgress, loadCycle, loadProfile, logStep } from '../../progress/store';
import { nextRehearsal } from '../../progress/rehearsal';
import { cyclePoints } from '../../progress/points';
import { pitchDegree } from '../../game/pitchwords';
import { LevelMeter } from '../components/LevelMeter';
import { meterNodes, pathStatus } from '../path';
import { shortDate, weekText } from '../components/Today';
import { dateWords, planPieces, rehearsalOn, weekDays, weekGoalOf } from '../today';
import {
  addDays, bestWeek, countedDays, dayOf, daysBetween, gettingBetter, loadReached, minutesBetween, mondayOf, notesBetween, weekDots,
} from '../../progress/today';

const fmt = (t: number | string, o: Intl.DateTimeFormatOptions) => dateWords(t, o);

/** When the piece reached each level: stamped by the run (Play), else a passed full run (a clean run) in the log. */
function reachedDates(pieceId: string, partId: string, single: boolean): Record<number, number> {
  const out: Record<number, number> = { ...(loadReached()[`${pieceId}|${partId}`] ?? {}) };
  for (const e of attemptLog()) {
    if (e.pieceId !== pieceId || e.partId !== partId || !e.passed || logStep(e) !== 'tempo') continue;
    if (e.sectionId === 'all' || (single && !['drill', 'entries', 'cold', 'practice'].includes(e.sectionId))) {
      for (let l = 1; l <= e.level; l++) if (out[l] == null || e.at < out[l]) out[l] = e.at;
    }
  }
  return out;
}

export function ProgressScreen() {
  useStoreVersion();
  useDay();
  const now = new Date();
  const today = dayOf(now);
  const monday = mondayOf(today);
  const cycle = loadCycle();
  const goal = weekGoalOf(loadProfile().weekGoal);
  const { practised, confirmed } = weekDays();
  const counted = countedDays(practised, confirmed);
  const week = weekDots(today, practised, confirmed, rehearsalOn(cycle));
  const log = attemptLog();
  const tomorrow = addDays(today, 1);
  const minsWeek = minutesBetween(log, monday, tomorrow);
  const notesWeek = notesBetween(monday, tomorrow);
  const pts = cyclePoints();
  const best = bestWeek(counted);
  const weeks = [4, 3, 2, 1, 0].map((k) => {
    const m = addDays(monday, -7 * k);
    const w = weekDots(today, practised, confirmed, () => false, m);
    return { monday: m, ...w, minutes: minutesBetween(log, m, addDays(m, 7)), best: !!best && best.monday === m && best.days > 1 };
  });
  const nr = nextRehearsal(cycle);
  const toConcert = daysUntil(cycle.concertDate);
  const pieces = planPieces(Date.now(), cycle);
  // (only passages whose counted attempts are all in the kept log: their first run there is their first)
  const better = gettingBetter(log, Date.now(), (pieceId, partId, sectionId) => getProgress(pieceId, partId)?.sections[sectionId]?.attempts ?? 0);

  return (
    <main className="screen wide progress-screen">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => back({ name: 'home' })}><IconBack /></button>
        <span className="t14 muted">Today</span>
      </div>
      <div className="col" style={{ gap: 2 }}>
        <h1 className="hero" style={{ fontSize: 28 }}>Your progress</h1>
        <span className="t14 muted">{[cycle.name, cycle.concertDate && toConcert != null && toConcert >= 0 ? `concert ${shortDate(cycle.concertDate)}` : ''].filter(Boolean).join(' · ')}</span>
      </div>

      <div className="lay progress-cols">
      <section className="card" data-testid="this-week">
        <div className="row between">
          <h2 className="h3">This week</h2>
          {week.count >= goal ? <span className="t14 good-text">Goal reached ✓</span> : <span className="t14 muted">goal {goal} days</span>}
        </div>
        <div className="tiles">
          <div className="tile"><strong className="mono">{week.count >= goal ? `${week.count} of ${goal}` : week.count}</strong><span className="t14 muted">days{confirmed.size ? ', ♪ counted' : ''}</span></div>
          <div className="tile"><strong className="mono">{minsWeek}</strong><span className="t14 muted">minutes practised</span></div>
          <div className="tile"><strong className="mono">{notesWeek.toLocaleString('en-GB')}</strong><span className="t14 muted">notes sung right</span></div>
        </div>
        {pts.n > 0 && (
          <span className="t14 muted" data-testid="since-points">
            {pts.since ? `Since ${fmt(pts.since, { day: 'numeric', month: 'short' })}` : 'This cycle'}: {pts.n.toLocaleString('en-GB')} notes sung right.
          </span>
        )}
      </section>

      <section className="card" data-testid="last-weeks">
        <div className="row between">
          <h2 className="h3">Last 5 weeks</h2>
          {confirmed.size > 0 && <span className="t14 muted">♪ = rehearsal</span>}
        </div>
        <div className="wkrows" role="table" aria-label="Last 5 weeks">
          <div className="wkrow head" role="row">
            <span role="columnheader" className="t14 muted">Week of</span>
            <span role="columnheader" className="t14 muted">Mon – Sun</span>
            <span role="columnheader" className="t14 muted num">days</span>
            <span role="columnheader" className="t14 muted num">min</span>
          </div>
          {weeks.map((w) => (
            <div key={w.monday} className={`wkrow${w.monday === monday ? ' cur' : ''}`} role="row">
              <span role="cell" className="t14">{fmt(w.monday, { day: 'numeric', month: 'short' })}</span>
              <span role="cell" className="cells" aria-label={`${w.count} days`}>
                {w.dots.map((d) => (
                  <i key={d.day} className={d.practised || d.rehearsal === 'confirmed' ? 'on' : d.future ? 'future' : ''}>{d.rehearsal === 'confirmed' ? '♪' : ''}</i>
                ))}
              </span>
              <span role="cell" className="t14 num">{w.count}{w.best ? ' ★' : ''}</span>
              <span role="cell" className="t14 num muted">{w.minutes}</span>
            </div>
          ))}
        </div>
        {best && best.days > 1 && (
          <span className="t14 muted">★ Best week: {fmt(best.monday, { day: 'numeric', month: 'short' })} – {fmt(addDays(best.monday, 6), { day: 'numeric', month: 'short' })}, {best.days} days.</span>
        )}
      </section>

      {pieces.length > 0 && (
        <section className="card" data-testid="your-pieces">
          <h2 className="h3">Your pieces</h2>
          <div className="checklist">
            {pieces.map((p) => {
              const ps = pathStatus(p.sections, p.prog);
              const nodes = meterNodes({ level: ps.pieceLevel, slow: ps.half && ps.working ? ps.working.level : 0, now: ps.working });
              const P = ps.pieceLevel;
              const dates = reachedDates(p.pieceId, p.partId, p.sections.length === 1);
              const at = P >= 1 ? dates[P] : undefined;
              const after1 = P > 1 && dates[1] && at ? daysBetween(dayOf(dates[1]), dayOf(at)) : null;
              const next = P < 3 ? `next: Level 3, rehearsal-ready${p.focus && nr && nr.days >= 0 ? ` by ${nr.days === 0 ? 'tonight' : fmt(nr.iso, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}`
                : P === 3 ? `next: Concert${cycle.concertDate && toConcert != null && toConcert >= 0 ? ` by ${shortDate(cycle.concertDate)}` : ''}`
                  : P === 4 ? 'next: By heart' : '';
              return (
                <div key={p.pieceId} className="li" style={{ alignItems: 'flex-start' }} data-testid="progress-piece">
                  <button className="grow col plain" style={{ gap: 2 }} onClick={() => go({ name: 'piece', pieceId: p.pieceId })}>
                    <strong className="t16">{p.title}</strong>
                    {P >= 1 ? (
                      <span className="t14">
                        <span className="good-text">Level {P} reached ✓</span>
                        <span className="muted">{at ? ` ${fmt(at, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}{after1 ? `, ${after1} days after Level 1` : ''}{next ? ` · ${next}` : ''}</span>
                      </span>
                    ) : <span className="t14 muted">{started(p) ? `Working on ${ps.here}` : 'Not started'}</span>}
                  </button>
                  <LevelMeter nodes={nodes} label={p.title} />
                </div>
              );
            })}
          </div>
          <div className="row t14 muted legend" aria-hidden="true">
            <span className="lvl"><i className="n full" /></span> reached
            <span className="lvl"><i className="n half" /></span> slow passed
            <span className="lvl"><i className="n now" /></span> you are here
          </div>
        </section>
      )}

      {better && (
        <section className="card" data-testid="getting-better">
          <span className="eb">Getting better</span>
          <h2 className="h3">When you learn new notes</h2>
          {better.metric === 'cents' ? <>
            <p className="t16" style={{ margin: 0 }}>Your first slow runs on a new passage land closer to the note than they used to.</p>
            <span className="t14 muted">Shorter = closer to the note</span>
            <BetterBar label="Before" value={`${pitchDegree(better.earlier)} off (${better.earlier} cents)`} frac={Math.min(1, better.earlier / 50)} />
            <BetterBar label="Last two weeks" value={`${pitchDegree(better.now)} off (${better.now} cents)`} frac={Math.min(1, better.now / 50)} now />
          </> : <>
            <p className="t16" style={{ margin: 0 }}>Your first slow runs on a new passage get more notes right than they used to.</p>
            <BetterBar label="Before" value={`${Math.round(better.earlier * 100)}% right`} frac={better.earlier} />
            <BetterBar label="Last two weeks" value={`${Math.round(better.now * 100)}% right`} frac={better.now} now />
          </>}
        </section>
      )}
      </div>
      <button className="btn ghost block" onClick={() => openAt({ name: 'settings' }, 'settings-practice')} data-testid="progress-settings">Week goal: {goal} days a week · change</button>
      <span className="t14 muted center">{weekText(week.count, goal)} this week.</span>
    </main>
  );
}

function BetterBar({ label, value, frac, now }: { label: string; value: string; frac: number; now?: boolean }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row between t14"><span className={now ? '' : 'muted'} style={now ? { fontWeight: 700 } : undefined}>{label}</span><span className={now ? '' : 'muted'} style={now ? { fontWeight: 700 } : undefined}>{value}</span></div>
      <div className="better-bar"><span className={now ? 'now' : ''} style={{ width: `${Math.max(4, Math.round(frac * 100))}%` }} /></div>
    </div>
  );
}

/** Anything sung in the piece yet (a level, a slow step, an attempt)? */
function started(p: { sections: { id: string }[]; prog?: { sections: Record<string, { level: number; slow?: number; attempts: number }> } }): boolean {
  return p.sections.some((x) => { const sp = p.prog?.sections[x.id]; return !!sp && (sp.level > 0 || (sp.slow ?? 0) > 0 || sp.attempts > 0); });
}
