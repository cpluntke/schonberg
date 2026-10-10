// The intonation courses (the lab): find a pure fifth and a pure major third by ear, one interval at
// a time, up a ladder where the help fades: listen, tune by hand, sing with the pulse shown, sing it by
// ear, sing it in a chord. Every singer has them (Train); a choir can recommend them by putting the
// lab into its programme. The course page (C2), a step (C3), a step done (C4), the course done (C6)
// and its quick check a week later. docs/INTONATION.md has the why.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { back, go, type Route } from '../router';
import { useProfile } from '../hooks';
import { IconBack, IconCheck, IconClock, IconEar, IconPause, IconPlay, IconChevron } from '../icons';
import { getAudioContext, unlockAudio } from '../../audio/context';
import { Drone } from '../../audio/drone';
import { midiToHz } from '../../audio/pitch';
import { getTracker } from '../play/session';
import { micErrorText } from '../components/Tuner';
import {
  CHECK_HOLDS, CHECK_KEEP, CHECK_ROUNDS, HOLD_SEC, HoldDetector, INTERVAL_DEGREE, ROUNDS, RUNGS, RUNG_NAMES, RATIO, TOL_HAND, TOL_SING,
  centsAbove, labInProgramme, loadLab, logCheck, logRound, median, pianoCents, pureCents, rootFor, saveLab, shownBeats, wobbleWord,
  type Degree, type LabInterval, type LabProgress,
} from '../../game/intonation';
import {
  COURSES, COURSE_MINUTES, activeCourse, checkLine, courseStatus, feelAdvice, feelWords, moreToPass, reviewState, stepStates, suggestedCourse,
} from '../../game/courses';
import { heldIntervalSpot, barsLabel, type HeldSpot } from '../../game/heldIntervals';
import { dateWords, finishToday, goStep, shortTitle, stepShort, todaySession } from '../today';
import { dayOf, daysBetween } from '../../progress/today';
import { loadCycle, loadProfile } from '../../progress/store';
import { getPiece, chosenPartId, type PieceInfo } from '../library';
import { syncEnabled, syncProgressSoon } from '../../progress/sync';

type LabRoute = Extract<Route, { name: 'intonation' }>;

/** Does the singer's choir recommend the courses? (the lab is in its running cycle's programme) */
export const courseRecommended = () => labInProgramme();

const DEG_NAME: Record<Degree, string> = { do: 'do', mi: 'mi', sol: 'sol' };

export function IntonationLab({ route }: { route: LabRoute }) {
  const [profile] = useProfile();
  const [lab, setLab] = useState<LabProgress>(loadLab);
  const root = rootFor(profile.voice, profile.rangeLow, profile.rangeHigh);
  // (from storage, not this render's copy: the mic's callbacks outlive renders)
  const record = (iv: LabInterval, rung: number, value: number) => {
    const before = loadLab()[iv];
    const r = logRound(loadLab(), iv, rung, value);
    saveLab(r.p);
    setLab(r.p);
    const after = r.p[iv];
    const opened = after.rung > before.rung;
    if (opened || (before.redo && !after.redo)) syncProgressSoon();
    // The course is done: its page says so (C6).
    if (opened && rung === RUNGS) {
      const here = location.hash;
      window.setTimeout(() => { if (location.hash === here) go({ name: 'intonation', interval: iv, done: true }, true); }, 900);
    }
    return { passed: r.passed, opened: opened || (!!before.redo && !after.redo) };
  };

  const iv = route.interval ?? activeCourse(lab) ?? suggestedCourse(lab) ?? 'fifth';
  const done = lab[iv].rung > RUNGS;
  if (route.done && done) return <CourseDone iv={iv} lab={lab} />;
  if (route.check && done) return <QuickCheck iv={iv} root={root} lab={lab} onLab={setLab} />;
  const rung = route.rung;
  if (!route.interval || !rung || rung > lab[iv].rung) return <CourseOverview iv={iv} lab={lab} root={root} />;
  const props = { iv, root, lab, record };
  return rung === 1 ? <ListenRung {...props} />
    : rung === 2 ? <TuneRung {...props} />
    : <SingRung {...props} rung={rung} />;
}

// ---------- shared pieces ----------

interface RungProps {
  iv: LabInterval; root: number; lab: LabProgress;
  record: (iv: LabInterval, rung: number, v: number) => { passed: boolean; opened: boolean };
}

/** Check circles: ✓ done, ✗ missed, a number for a step or try still to come, the orange ring for now. */
function Check({ state, n, label }: { state: 'done' | 'miss' | 'now' | 'todo'; n?: number; label?: string }) {
  return (
    <span className={`check${state === 'todo' ? '' : ` ${state}`}`} aria-hidden={label ? undefined : true} aria-label={label}>
      {state === 'done' ? <IconCheck size={14} /> : state === 'miss' ? '✗' : n}
    </span>
  );
}

/** The course's steps as check circles (done, the one you're on, still to come). */
export function CourseChecks({ iv, lab, size }: { iv: LabInterval; lab: LabProgress; size?: 'sm' }) {
  const cur = lab[iv].rung;
  return (
    <span className={`row crs-checks${size ? ` ${size}` : ''}`} role="img" aria-label={cur > RUNGS ? `All ${RUNGS} steps done` : `Step ${cur} of ${RUNGS}`}>
      {Array.from({ length: RUNGS }, (_, i) => <Check key={i} n={i + 1} state={i + 1 < cur ? 'done' : i + 1 === cur ? 'now' : 'todo'} />)}
    </span>
  );
}

/** The top of a step: back to the course, which course and step. */
function RungTop({ iv, rung, children }: { iv: LabInterval; rung: number | 'check'; children?: React.ReactNode }) {
  return (
    <>
      <div className="topbar">
        <button className="icon-btn filled" aria-label="Back to the course" onClick={() => back({ name: 'intonation', interval: iv })}><IconBack /></button>
        <h1 className="crs-where">{COURSES[iv].title} · {rung === 'check' ? 'Quick check' : `Step ${rung} of ${RUNGS}`}</h1>
      </div>
      {children}
    </>
  );
}

/** "Sing mi so the chord goes still, then hold it for 2 seconds." and how, under it. */
function GoalLines({ goal, how }: { goal: string; how?: React.ReactNode }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <h2 className="crs-goal" data-testid="lab-goal">{goal}</h2>
      {how && <span className="t16 muted">{how}</span>}
    </div>
  );
}

/**
 * Labelled progress: "Pure tries ✓ ✓ ✗ ④ · 1 more to pass". The last tries of the rung's window and
 * the next one (an orange ring), then how many more pure ones would pass it.
 */
function Tries({ label, results, ok, total, more }: { label: string; results: number[]; ok: (v: number) => boolean; total: number; more: string }) {
  const passed = more === 'Passed';
  const shown = passed ? results.slice(-total) : results.slice(-(total - 1));
  const pure = results.slice(-total).filter(ok).length;
  return (
    <div className="crs-tries" role="group" aria-label={`${label}: ${pure} of the last ${Math.min(total, results.length)} · ${more}`} data-testid="lab-tries">
      <strong className="t16">{label}</strong>
      <span className="row crs-checks" aria-hidden="true">
        {shown.map((v, i) => <Check key={i} state={ok(v) ? 'done' : 'miss'} />)}
        {!passed && <Check state="now" n={results.length + 1} />}
      </span>
      <span className={`t14 crs-more${passed ? ' good-text' : ''}`}>{more}</span>
    </div>
  );
}

/** "What's a cent?": a quiet link that opens a short answer in place. */
function CentHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="col" style={{ gap: 6 }}>
      <button className="link start" aria-expanded={open} data-testid="lab-cent" onClick={() => setOpen(!open)}>What’s a cent?</button>
      {open && (
        <div className="cent-help t14" role="note">
          A cent is a hundredth of a semitone: a very small step. Most ears notice about 5 to 10 cents between two notes
          held together, as a slow pulse. Pure and the piano differ by 2 cents for a fifth and 14 cents for a major third.
        </div>
      )}
    </div>
  );
}

/**
 * The app's held notes for this screen, silent for good when the screen goes. `get` resolves null
 * once the screen is gone (anything awaited before must then do nothing); `alive` says so too.
 */
function useDrone() {
  const ref = useRef<Drone | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ref.current?.dispose(); ref.current = null; };
  }, []);
  const get = async (): Promise<Drone | null> => {
    await unlockAudio();
    if (!alive.current) return null;
    if (!ref.current) ref.current = new Drone(getAudioContext());
    return ref.current;
  };
  return { get, alive };
}

const toneHz = (root: number, d: Degree, offsetCents = 0) => midiToHz(root) * (RATIO[d][0] / RATIO[d][1]) * 2 ** (offsetCents / 1200);

/** One second of the sound: a wave whose swell shows the pulse (how much, never which way). */
function Wave({ beats, colour = 'var(--voice)', height = 110, label }: { beats: number | null; colour?: string; height?: number; label: string }) {
  const b = beats == null ? null : Math.min(14, Math.round(beats * 10) / 10);
  const d = useMemo(() => {
    if (b == null) return '';
    const W = 340, mid = height / 2, A = height * 0.42, N = 500, carrier = 42;
    let s = '';
    for (let i = 0; i <= N; i++) {
      const t = i / N, env = Math.abs(Math.cos(Math.PI * b * t));
      s += `${i ? 'L' : 'M'}${(t * W).toFixed(1)} ${(mid - A * env * Math.sin(2 * Math.PI * carrier * t)).toFixed(1)}`;
    }
    return s;
  }, [b, height]);
  return (
    <svg viewBox={`0 0 340 ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={label} data-testid="lab-wave" data-beats={b ?? ''}>
      <line x1={0} x2={340} y1={height / 2} y2={height / 2} stroke="var(--line)" />
      {d && <path d={d} fill="none" stroke={colour} strokeWidth={1.4} />}
    </svg>
  );
}

/** Where a tone landed: pure and piano marks, the singer's dot. */
function Landed({ deg, value, tol }: { deg: Degree; value: number; tol: number }) {
  const pure = pureCents(deg), piano = pianoCents(deg);
  const lo = pure - 30, hi = pure + 30;
  const x = (c: number) => 10 + ((Math.max(lo, Math.min(hi, c)) - lo) / (hi - lo)) * 300;
  const showPiano = Math.abs(piano - pure) >= 3;
  return (
    <svg viewBox="0 0 320 112" width="100%" style={{ maxWidth: 400 }} role="img" data-testid="lab-landed"
      aria-label={`You: ${Math.round(value - pure)} cents from pure${showPiano ? `; the piano is ${Math.round(piano - pure)} cents above pure` : ''}.`}>
      <rect x={x(pure - tol)} y={44} width={x(pure + tol) - x(pure - tol)} height={24} rx={6} fill="var(--good)" opacity={0.16} />
      <line x1={10} x2={310} y1={56} y2={56} stroke="var(--line)" strokeWidth={2} />
      <line x1={x(pure)} x2={x(pure)} y1={22} y2={70} stroke="var(--good)" strokeWidth={2.5} />
      <text x={x(pure)} y={16} textAnchor="middle" style={{ fontSize: '0.875rem' }} fontWeight={600} fill="var(--good)">pure</text>
      {showPiano && <>
        <line x1={x(piano)} x2={x(piano)} y1={22} y2={70} stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 3" />
        <text x={x(piano)} y={16} textAnchor="middle" style={{ fontSize: '0.875rem' }} fill="var(--muted)">piano</text>
      </>}
      <circle cx={x(value)} cy={56} r={8} fill="var(--voice)" stroke="var(--bg)" strokeWidth={3} />
      <text x={Math.max(40, Math.min(280, x(value)))} y={96} textAnchor="middle" style={{ fontSize: '0.875rem' }} fontWeight={800} fill="var(--voice)">
        you{value < lo ? ' ◂' : value > hi ? ' ▸' : ''}
      </text>
    </svg>
  );
}

/** What to do after a try `off` cents from pure (null: it counted as pure). The piano's third gets its own words. */
function advice(deg: Degree, off: number, tol: number): string | null {
  const pure = pureCents(deg), piano = pianoCents(deg);
  if (Math.abs(off) <= tol) return null;
  if (Math.abs(piano - pure) >= 3 && Math.abs(pure + off - piano) <= 4) return 'That’s the piano’s note: most of us learned it there. Go a little lower, until the pulse settles.';
  return feelAdvice(off, tol);
}

/** The result of a try: words first ("Almost still · a touch high (6 cents)"), what to do, where it landed. */
function TryResult({ deg, off, tol, title = 'Your last try', note, practice }: { deg: Degree; off: number; tol: number; title?: string; note?: string; practice?: boolean }) {
  const good = Math.abs(off) <= tol;
  const a = advice(deg, off, tol);
  return (
    <div className={`card crs-result${good ? ' good' : ''}`} role="status" data-testid="lab-verdict">
      <div className="row between">
        <span className="t14 muted">{title}{practice ? ' · practice round' : ''}</span>
        <span className="t14 mono" style={{ color: good ? 'var(--good)' : 'var(--voice)' }}>{wobbleWord(off)}</span>
      </div>
      <strong className="crs-feel" data-testid="lab-feel">{feelWords(off)}</strong>
      <span className="t16">{good ? 'Pure: you found it. Remember how still that sounded.' : a}</span>
      <Landed deg={deg} value={pureCents(deg) + off} tol={tol} />
      {note && <span className="t14 muted">{note}</span>}
    </div>
  );
}

// ---------- the course page (C2) ----------

/** A weekday for a step's day: "today", "tomorrow", "Sun". */
function dayWord(day: string, today: string): string {
  if (day === today) return 'today';
  const t = new Date(`${today}T12:00:00`);
  const tm = dayOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 12));
  if (day === tm) return 'tomorrow';
  return dateWords(day, { weekday: 'short' });
}

function CourseOverview({ iv, lab, root }: { iv: LabInterval; lab: LabProgress; root: number }) {
  const c = COURSES[iv];
  const t = lab[iv];
  const today = dayOf(new Date());
  const states = stepStates(t, today);
  const done = t.rung > RUNGS;
  const rv = reviewState(t, today);
  const recommended = courseRecommended();
  const drone = useDrone();
  const [playing, setPlaying] = useState<'off' | 'pure' | null>(null);
  const stopTimer = useRef(0);
  useEffect(() => () => clearTimeout(stopTimer.current), []);
  const deg = INTERVAL_DEGREE[iv];
  async function demo(which: 'off' | 'pure') {
    const d = await drone.get();
    if (!d) return;
    clearTimeout(stopTimer.current);
    d.stop();
    if (playing === which) { setPlaying(null); return; }
    const off = which === 'off' ? c.demo.off.cents : 0;
    d.set(iv === 'third'
      ? { do: midiToHz(root), sol: toneHz(root, 'sol'), mi: toneHz(root, 'mi', off) }
      : { do: midiToHz(root), sol: toneHz(root, 'sol', off) });
    setPlaying(which);
    stopTimer.current = window.setTimeout(() => { d.stop(); setPlaying(null); }, 5000);
  }
  const cur = Math.min(t.rung, RUNGS);
  const go1 = (n: number) => go({ name: 'intonation', interval: iv, rung: n });
  return (
    <main className="screen has-foot crs-page" data-testid="lab-ladder">
      <div className="topbar">
        <button className="icon-btn filled" aria-label="Back to Train" onClick={() => back({ name: 'train' })}><IconBack /></button>
        <span className="t16 muted grow">Train</span>
        {recommended && <span className="crs-rec" data-testid="lab-recommended">Your choir recommends</span>}
      </div>
      <div className="col" style={{ gap: 8 }}>
        <span className="eb">Course · Intonation</span>
        <h1 className="crs-title">{c.title}</h1>
        <p className="t16" style={{ margin: 0 }}><strong>{c.outcome}</strong> {c.about}</p>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <div className="row crs-demo">
          {(['off', 'pure'] as const).map((w) => (
            <button key={w} className="btn two grow" aria-pressed={playing === w} data-testid={`lab-demo-${w}`} onClick={() => void demo(w)}>
              <span className="row" style={{ gap: 6 }}>{playing === w ? <IconPause size={16} /> : <IconPlay size={16} color="currentColor" />} {c.demo[w].title}</span>
              <span className="sub">{c.demo[w].sub}</span>
            </button>
          ))}
        </div>
        <span className="t14 muted">Play one, then the other: hear the {iv === 'third' ? 'shimmer' : 'wobble'} stop.</span>
      </div>
      <div className="col" style={{ gap: 4 }}>
        <span className="t16">{RUNGS} steps · about {COURSE_MINUTES} min · one step a day</span>
        <span className="t14 muted">Headphones for steps 3–5, so the drone stays out of the microphone.</span>
        <CentHelp />
      </div>

      <ol className="card crs-steps" aria-label="Steps">
        {c.steps.map((s, i) => {
          const st = states[i];
          const n = i + 1;
          const open = n <= cur || done;
          const when = st.state === 'done' ? (st.day ? `done ${dayWord(st.day, today) === 'today' ? 'today' : dateWords(st.day, { weekday: 'short' })}` : 'done')
            : `${dayWord(st.day!, today)} · ${s.minutes} min`;
          return (
            <li key={n} className={st.state}>
              <button className="crs-step" disabled={!open} data-testid={`lab-rung-${n}`} aria-current={st.state === 'now' ? 'step' : undefined} onClick={() => go1(n)}>
                <Check state={st.state === 'done' ? 'done' : st.state === 'now' ? 'now' : 'todo'} n={n} />
                <span className="grow col" style={{ gap: 2 }}>
                  <span className="row between" style={{ alignItems: 'baseline', gap: 8 }}>
                    <strong className="t16">{s.name}<span className="sr-only">{st.state === 'done' ? ' (done)' : st.state === 'now' ? ' (next)' : ' (opens after the step before)'}</span></strong>
                    <span className={`t14 nowrap ${st.state === 'done' ? 'good-text' : st.state === 'now' ? 'crs-now' : 'muted'}`}>{when}</span>
                  </span>
                  <span className="t14 muted">{s.goal}</span>
                  {st.state !== 'done' && <span className="t14 muted">{s.rule}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {done ? (
        <button className="card crs-row" data-testid="lab-done-link" onClick={() => go({ name: 'intonation', interval: iv, done: true })}>
          <span className="grow col" style={{ gap: 2 }}>
            <strong className="t16">Course done ✓{t.passed?.[RUNGS] ? ` · ${dateWords(t.passed[RUNGS])}` : ''}</strong>
            <span className="t14 muted">{reviewLine(t.review?.due, rv, today)}</span>
          </span>
          <IconChevron size={20} color="var(--muted)" />
        </button>
      ) : (
        <span className="t14 muted">After the course: a quick check a week later, and a passage in your music to use it in.</span>
      )}

      <div className="crs-foot">
        {rv === 'due' ? (
          <button className="btn primary block two" data-testid="lab-continue" onClick={() => go({ name: 'intonation', interval: iv, check: true })}>
            <span><IconPlay size={18} /> Quick check</span><span className="sub">1 min · three holds</span>
          </button>
        ) : t.redo ? (
          <button className="btn primary block two" data-testid="lab-continue" onClick={() => go1(t.redo!)}>
            <span><IconPlay size={18} /> {RUNG_NAMES[t.redo - 1]}, once more</span><span className="sub">Step {t.redo} · {c.steps[t.redo - 1].minutes} min</span>
          </button>
        ) : done ? (
          <button className="btn block" data-testid="lab-continue" onClick={() => go1(RUNGS)}>Practise the chord again</button>
        ) : (
          <button className="btn primary block two" data-testid="lab-continue" onClick={() => go1(cur)}>
            <span><IconPlay size={18} /> {courseStatus(t) === 'new' ? 'Start' : 'Continue'}: {RUNG_NAMES[cur - 1]}</span>
            <span className="sub">Step {cur} · {c.steps[cur - 1].minutes} min</span>
          </button>
        )}
        <span className="t14 muted center">{syncEnabled() ? 'Saved to your account · picks up on any phone' : 'Saved on this phone (and with your choir account, once you join it)'}</span>
      </div>
    </main>
  );
}

/** "in 7 days", "tomorrow", "today". */
function inDays(today: string, day: string): string {
  const n = daysBetween(today, day);
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}

function reviewLine(due: string | undefined, rv: ReturnType<typeof reviewState>, today: string): string {
  if (rv === 'due') return 'Quick check today: one minute, three holds.';
  if (rv === 'booked' && due) return `Quick check ${dayWord(due, today) === 'tomorrow' ? 'tomorrow' : dateWords(due)}: one minute, three holds.`;
  if (rv === 'kept') return 'Quick check: it held ✓';
  if (rv === 'slipped') return 'Quick check: it slipped a little. Sing it by ear once more.';
  return 'See what you can do now.';
}

// ---------- step done (C4) ----------

/**
 * A quiet card when a step is passed: what you can do now, the course's progress, then (inside today's
 * session) today's next step; outside it, "next step tomorrow" and back to Train.
 */
function StepDone({ iv, rung, onKeep }: { iv: LabInterval; rung: number; onKeep: () => void }) {
  // (the last step: the course's own page follows, C6)
  if (rung >= RUNGS) return null;
  return <StepDoneSheet iv={iv} rung={rung} onKeep={onKeep} />;
}

function StepDoneSheet({ iv, rung, onKeep }: { iv: LabInterval; rung: number; onKeep: () => void }) {
  const c = COURSES[iv];
  const lab = loadLab();
  const ses = todaySession({ lab: true });
  const nx = ses?.next ?? null;
  const n = ses?.plan.steps.length ?? 0;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onKeep(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const next = rung < RUNGS ? rung + 1 : null;
  const sub = `${c.title} · ${c.steps[rung - 1].rule.replace(/^To pass: /, '')}`;
  return (
    <div className="psheet-scrim" data-testid="lab-step-done-scrim">
      <div ref={sheetRef} className="psheet crs-sheet" role="dialog" aria-modal="true" aria-labelledby="lab-done-h" data-testid="lab-passed">
        <span className="grab" aria-hidden="true" />
        <div className="crs-donecard">
          <span className="crs-star" aria-hidden="true">★</span>
          <div className="col" style={{ gap: 4 }}>
            <h2 id="lab-done-h">Step {rung} done ✓</h2>
            <span className="t14 muted">{sub}</span>
          </div>
        </div>
        <p className="t16" style={{ margin: 0 }}>{c.stepCanDo[rung - 1]}</p>
        <div className="row" style={{ gap: 12 }}>
          <CourseChecks iv={iv} lab={lab} />
          {next && <span className="t14 muted">Step {next} of the course waits for tomorrow.</span>}
        </div>
        {ses ? (
          <>
            {nx ? (
              <button className="btn primary block two" data-testid="today-next" onClick={() => goStep(nx, true)}>
                <span>Next: {stepShort(nx)}</span><span className="sub">step {ses.nextIndex + 1} of {n} · {nx.minutes} min</span>
              </button>
            ) : (
              <button className="btn primary block" data-testid="today-finish" onClick={() => { finishToday(); go({ name: 'home' }); }}>Finish for today</button>
            )}
            <button className="btn block" data-testid="lab-keep" onClick={onKeep}>Keep practising this step</button>
            {nx && <button className="link" data-testid="finish-today" onClick={() => { finishToday(); go({ name: 'home' }); }}>Finish for today</button>}
          </>
        ) : (
          <>
            <button className="btn primary block" data-testid="lab-to-train" onClick={() => go({ name: 'train' })}>Back to Train</button>
            <button className="btn block" data-testid="lab-keep" onClick={onKeep}>Keep practising this step</button>
            {next && <button className="link" data-testid="lab-go-next" onClick={() => go({ name: 'intonation', interval: iv, rung: next }, true)}>Or go on to step {next} now</button>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- the course done (C6) ----------

export interface MusicSpot { piece: PieceInfo; partId: string; spot: HeldSpot }

/** A passage of the singer's programme where their part holds this interval against another voice. */
export function spotInMusic(iv: LabInterval): MusicSpot | null {
  const voice = loadProfile().voice;
  let best: MusicSpot | null = null;
  for (const id of loadCycle().pieceIds) {
    const piece = getPiece(id);
    if (!piece) continue;
    const partId = chosenPartId(piece, voice);
    const spot = heldIntervalSpot(piece.score, partId, iv === 'fifth' ? 7 : 4);
    if (spot && (!best || spot.seconds > best.spot.seconds)) best = { piece, partId, spot };
  }
  return best;
}

function CourseDone({ iv, lab }: { iv: LabInterval; lab: LabProgress }) {
  const c = COURSES[iv];
  const t = lab[iv];
  const today = dayOf(new Date());
  const doneDay = t.passed?.[RUNGS] ?? today;
  const rv = reviewState(t, today);
  const music = useMemo(() => spotInMusic(iv), [iv]);
  const other: LabInterval = iv === 'fifth' ? 'third' : 'fifth';
  const otherOpen = lab[other].rung <= RUNGS;
  const ses = todaySession({ lab: true });
  const nx = ses?.next ?? null;
  const where = music ? `${shortTitle(music.piece.title)} ${barsLabel(music.piece.score, music.spot.m0, music.spot.m1)}` : '';
  const sing = () => {
    if (!music) return;
    const ms = music.piece.score.measures;
    go({ name: 'play', pieceId: music.piece.id, partId: music.partId, sectionId: 'drill', level: 1, step: 'slow', mode: '2d', from: ms[music.spot.m0].start, to: ms[music.spot.m1].start + ms[music.spot.m1].dur });
  };
  const toOther = () => go({ name: 'intonation', interval: other, rung: Math.min(lab[other].rung, RUNGS) });
  return (
    <main className="screen has-foot crs-page" data-testid="lab-course-done">
      <div className="topbar">
        <button className="icon-btn filled" aria-label="Back to the course" onClick={() => back({ name: 'intonation', interval: iv })}><IconBack /></button>
        <span className="t16 muted grow">Train · {c.title}</span>
      </div>
      <section className="band" aria-labelledby="crs-done-h">
        <span className="eb good-text">Course complete · {dateWords(doneDay)}</span>
        <h2 id="crs-done-h">{c.done}</h2>
        <div className="row" style={{ gap: 10 }}><CourseChecks iv={iv} lab={lab} /><span className="t14 muted">all {RUNGS} steps</span></div>
        <ul className="crs-cando">
          {c.canDo.map((x) => <li key={x} className="t16">{x}</li>)}
        </ul>
      </section>
      {music && (
        <section className="card voice" data-testid="lab-use-it" aria-labelledby="crs-use-h">
          <span className="eb">Use it in your music</span>
          <h3 id="crs-use-h" className="h3">{where}, the {iv === 'fifth' ? 'open fifths' : 'major thirds'}</h3>
          <span className="t16">
            {iv === 'fifth'
              ? `Your part and the ${music.spot.otherName.toLowerCase()} meet on open fifths here. Sing them slowly and listen for the still sound.`
              : `Your part and the ${music.spot.otherName.toLowerCase()} make major thirds here. Sing them slowly, a little lower than the piano, and listen for the ring.`}
          </span>
        </section>
      )}
      <section className="card crs-row" aria-label="Quick check">
        <span className="you-ic" aria-hidden="true"><IconClock /></span>
        <span className="grow col" style={{ gap: 2 }} data-testid="lab-review">
          <strong className="t16">{rv === 'due' ? 'Quick check today' : rv === 'kept' ? 'Quick check: it held ✓' : rv === 'slipped' ? 'Quick check: it slipped a little'
            : t.review ? `Quick check ${inDays(today, t.review.due)} · ${dateWords(t.review.due)}` : 'Quick check in a week'}</strong>
          <span className="t14 muted">{rv === 'slipped' ? 'Sing it by ear once more: step 4, until it locks again.' : 'One minute, three holds. If it has slipped, we suggest one step again.'}</span>
        </span>
        {(rv === 'due' || rv === 'slipped') && (
          <button className="btn small" data-testid="lab-review-go" onClick={() => go(rv === 'due' ? { name: 'intonation', interval: iv, check: true } : { name: 'intonation', interval: iv, rung: 4 })}>
            {rv === 'due' ? 'Start' : 'Step 4'}
          </button>
        )}
      </section>
      {otherOpen && (
        <section className="card" aria-labelledby="crs-next-h">
          <span className="t14 muted">Next course</span>
          <h3 id="crs-next-h" className="h3">{COURSES[other].title}</h3>
          <span className="t14 muted">{COURSES[other].line} {RUNGS} steps · about {COURSE_MINUTES} min.</span>
          <button className="link between" data-testid="lab-next-course" onClick={toOther}>
            <span>{courseStatus(lab[other]) === 'new' ? 'Start step 1: Listen' : `Continue: ${RUNG_NAMES[lab[other].rung - 1]}`}</span> <IconChevron size={18} />
          </button>
        </section>
      )}
      <div className="crs-foot">
        {nx ? (
          <>
            <button className="btn primary block two" data-testid="today-next" onClick={() => goStep(nx, true)}>
              <span>Next: {stepShort(nx)}</span><span className="sub">step {ses!.nextIndex + 1} of {ses!.plan.steps.length} · {nx.minutes} min</span>
            </button>
            {music && <button className="btn block" data-testid="lab-sing-spot" onClick={sing}>Sing {where} slowly</button>}
            <button className="link" data-testid="finish-today" onClick={() => { finishToday(); go({ name: 'home' }); }}>Finish for today</button>
          </>
        ) : ses ? (
          <>
            <button className="btn primary block" data-testid="today-finish" onClick={() => { finishToday(); go({ name: 'home' }); }}>Finish for today</button>
            {music && <button className="btn block" data-testid="lab-sing-spot" onClick={sing}>Sing {where} slowly</button>}
          </>
        ) : (
          <>
            {music
              ? <button className="btn primary block" data-testid="lab-sing-spot" onClick={sing}><IconPlay size={18} /> Sing {where} slowly</button>
              : otherOpen && <button className="btn primary block" data-testid="lab-next-course-go" onClick={toOther}>Start the {COURSES[other].title.toLowerCase()}</button>}
            <button className="btn block" data-testid="lab-to-train" onClick={() => go({ name: 'train' })}>Back to Train</button>
          </>
        )}
      </div>
    </main>
  );
}

// ---------- 1 · listen ----------

const EXAMPLES: Record<LabInterval, { key: string; title: string; off: number; hear: string }[]> = {
  third: [
    { key: 'pure', title: 'Pure third', off: 0, hear: 'Still. The two notes melt into one calm sound.' },
    { key: 'near', title: 'Nearly there', off: 6, hear: 'A slow pulse. Close: keep going.' },
    { key: 'piano', title: 'Piano third', off: pianoCents('mi') - pureCents('mi'), hear: 'A fast shimmer. That’s 14 cents too high for a pure chord.' },
  ],
  fifth: [
    { key: 'pure', title: 'Pure fifth', off: 0, hear: 'Still and open, almost one sound.' },
    { key: 'near', title: 'Nearly there', off: 6, hear: 'A slow pulse. Close: keep going.' },
    { key: 'far', title: 'Further off', off: 20, hear: 'A quick wobble. (The piano’s fifth is only 2 cents off pure: for fifths, it’s about locking it.)' },
  ],
};

function ListenRung({ iv, root, lab, record }: RungProps) {
  const deg = INTERVAL_DEGREE[iv];
  const drone = useDrone();
  const [playing, setPlaying] = useState<string | null>(null);
  const [mode, setMode] = useState<'learn' | 'check'>('learn');
  const stopTimer = useRef(0);
  useEffect(() => () => clearTimeout(stopTimer.current), []);

  async function play(key: string | null, tones: Record<string, number>, sec = 6) {
    const d = await drone.get();
    if (!d) return;
    clearTimeout(stopTimer.current);
    if (!key) { d.stop(); setPlaying(null); return; }
    d.stop();
    d.set(tones);
    setPlaying(key);
    stopTimer.current = window.setTimeout(() => { d.stop(); setPlaying(null); }, sec * 1000);
  }

  if (mode === 'check') return <ListenCheck iv={iv} root={root} lab={lab} record={record} play={play} playing={playing} />;
  const rootHz = midiToHz(root);
  return (
    <main className="screen crs-stepscreen" data-testid="lab-listen">
      <RungTop iv={iv} rung={1}>
        <GoalLines goal="Hear the pulse stop." how={<>Two notes that are nearly in tune make a pulse, a “wah-wah-wah”. The closer they get, the slower it pulses. Pure means no pulse at all.</>} />
      </RungTop>
      {EXAMPLES[iv].map((e) => {
        const on = playing === e.key;
        const hz = toneHz(root, deg, e.off);
        return (
          <div key={e.key} className="card" style={{ gap: 8, padding: 12, borderColor: on ? 'var(--voice)' : undefined }}>
            <div className="row">
              <button className="icon-btn filled" aria-label={`${on ? 'Stop' : 'Play'}: ${e.title}`} aria-pressed={on} data-testid={`lab-ex-${e.key}`}
                onClick={() => play(on ? null : e.key, { do: rootHz, x: hz })}>
                {on ? <IconPause /> : <IconPlay color="var(--voice)" />}
              </button>
              <div className="col grow" style={{ gap: 0 }}>
                <strong className="t16">{e.title}</strong>
                <span className="t14 muted">do + {DEG_NAME[deg]} · {wobbleWord(e.off)}</span>
              </div>
            </div>
            <Wave beats={shownBeats(e.off, deg, ['do'])} height={44} colour={e.off === 0 ? 'var(--good)' : 'var(--voice)'} label={`${e.title}: ${wobbleWord(e.off)}`} />
            <span className="t14">{e.hear}</span>
          </div>
        );
      })}
      <div className="notice info t14">Don't listen to the notes: listen to the space between them. Is it moving, or still?</div>
      <button className="btn primary block" data-testid="lab-check" onClick={() => { void play(null, {}); setMode('check'); }}>I hear it: check me</button>
    </main>
  );
}

/** Which of two chords is calmer? One is pure, one isn't (the piano's third; a fifth 12¢ off). */
function ListenCheck({ iv, root, lab, record, play, playing }: RungProps & {
  play: (key: string | null, tones: Record<string, number>, sec?: number) => Promise<void>; playing: string | null;
}) {
  const [round, setRound] = useState(() => newCheck(iv));
  const [heard, setHeard] = useState<Set<'A' | 'B'>>(new Set());
  const [answer, setAnswer] = useState<'A' | 'B' | null>(null);
  const [passed, setPassed] = useState(false);
  const results = lab[iv].logs[1] ?? [];
  const rootHz = midiToHz(root);
  const chord = (which: 'A' | 'B'): Record<string, number> => {
    const off = which === round.pure ? 0 : round.off;
    return iv === 'third'
      ? { do: rootHz, sol: toneHz(root, 'sol'), mi: toneHz(root, 'mi', off) }
      : { do: rootHz, sol: toneHz(root, 'sol', off) };
  };
  function choose(a: 'A' | 'B') {
    if (answer) return;
    setAnswer(a);
    void play(null, {});
    if (record(iv, 1, a === round.pure ? 0 : 1).opened) setPassed(true);
  }
  const right = answer != null && answer === round.pure;
  return (
    <main className="screen crs-stepscreen" data-testid="lab-quiz">
      <RungTop iv={iv} rung={1}>
        <GoalLines goal="Which is calmer?" how={<>One is pure, one isn't. Same notes, same sound: listen to {iv === 'third' ? 'the third' : 'the fifth'}.</>} />
      </RungTop>
      <Tries label="Right answers" results={results} ok={(v) => v === 0} total={CHECK_ROUNDS} more={moreToPass(1, results)} />
      <div className="row" style={{ gap: 12 }}>
        {(['A', 'B'] as const).map((w) => {
          const on = playing === `chord-${w}`;
          return (
            <button key={w} className="card grow" aria-pressed={on} data-testid={`lab-chord-${w}`}
              style={{ alignItems: 'center', minHeight: 150, justifyContent: 'center', borderColor: answer && w === round.pure ? 'var(--good)' : on ? 'var(--voice)' : undefined }}
              onClick={() => { setHeard((h) => new Set(h).add(w)); void play(on ? null : `chord-${w}`, chord(w), 3); }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, lineHeight: 1 }}>{w}</span>
              <span className="t14 muted">{answer ? (w === round.pure ? 'pure' : iv === 'third' ? 'piano' : 'off') : on ? 'playing…' : 'tap to hear'}</span>
            </button>
          );
        })}
      </div>
      {!answer ? (
        <div className="row" style={{ gap: 10 }}>
          {(['A', 'B'] as const).map((w) => (
            <button key={w} className="btn grow" disabled={heard.size < 2} data-testid={`lab-answer-${w}`} onClick={() => choose(w)}>{w} is calmer</button>
          ))}
        </div>
      ) : (
        <div className={right ? 'notice info' : 'notice'} role="status" data-testid="lab-quiz-feedback">
          <strong>{right ? `Yes: ${round.pure} is pure.` : `Not this time: ${round.pure} was pure.`}</strong>{' '}
          {iv === 'third' ? 'The piano’s third pulses against do several times a second.' : 'The other fifth was 12 cents off and pulsed.'} Play them again and listen for it.
        </div>
      )}
      {heard.size < 2 && !answer && <span className="t14 muted">Hear both first.</span>}
      {answer && (
        <button className="btn primary block" data-testid="lab-next" onClick={() => { void play(null, {}); setRound(newCheck(iv)); setHeard(new Set()); setAnswer(null); }}>
          Next pair
        </button>
      )}
      <span className="t14 muted">{COURSES[iv].steps[0].rule}.</span>
      {passed && <StepDone iv={iv} rung={1} onKeep={() => setPassed(false)} />}
    </main>
  );
}

function newCheck(iv: LabInterval) {
  const pure: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B';
  const off = iv === 'third' ? pianoCents('mi') - pureCents('mi') : (Math.random() < 0.5 ? -12 : 12);
  return { pure, off };
}

// ---------- 2 · tune it by hand ----------

function TuneRung({ iv, root, lab, record }: RungProps) {
  const deg = INTERVAL_DEGREE[iv];
  const drone = useDrone();
  // The slider's position is the offset from pure plus a hidden shift that changes every round:
  // pure is never in the same place, so only the ear can find it.
  const [round, setRound] = useState(newTuneRound);
  const [pos, setPos] = useState(round.start);
  const off = pos - round.shift;
  const [on, setOn] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [passed, setPassed] = useState(false);
  const lockedAt = useRef(0);
  const rootHz = midiToHz(root);
  const hz = toneHz(root, deg, off);
  // While it sounds, the moving note follows the slider.
  useEffect(() => { if (on) void drone.get().then((d) => d?.set({ do: rootHz, x: hz })); }, [on, hz]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: number) => setPos(Math.max(-SLIDER, Math.min(SLIDER, v)));
  async function start() { setOn(true); (await drone.get())?.set({ do: rootHz, x: hz }); }
  function lock() {
    if (done != null) return;
    lockedAt.current = Date.now();
    setDone(off);
    if (record(iv, 2, off).opened) setPassed(true);
  }
  async function next() {
    if (Date.now() - lockedAt.current < 600) return; // (a double tap on "That's it")
    const r = newTuneRound();
    setRound(r); setPos(r.start); setDone(null);
    setOn(true);
    (await drone.get())?.set({ do: rootHz, x: toneHz(root, deg, r.start - r.shift) });
  }
  const results = lab[iv].logs[2] ?? [];
  return (
    <main className="screen crs-stepscreen" data-testid="lab-tune">
      <RungTop iv={iv} rung={2}>
        <GoalLines goal={`Move ${DEG_NAME[deg]} until the pulse stops.`} how={<>No singing yet. The app plays do and an out-of-tune {DEG_NAME[deg]}; the picture shows how much it pulses.</>} />
      </RungTop>
      <Tries label="Pure tunings" results={results} ok={(v) => Math.abs(v) <= TOL_HAND} total={ROUNDS} more={moreToPass(2, results)} />
      <div className="card" style={{ gap: 8 }}>
        <div className="row between">
          <span className="t14 muted">What you hear</span>
          <span className="mono t14" style={{ color: Math.abs(off) <= TOL_HAND ? 'var(--good)' : 'var(--voice)' }} data-testid="lab-word">{on ? wobbleWord(off) : '–'}</span>
        </div>
        <Wave beats={on ? shownBeats(off, deg, ['do']) : null} label={on ? `Pulse: ${wobbleWord(off)}` : 'Not playing'} />
        <span className="t14 muted">One second of sound. A slower pulse means closer.</span>
      </div>
      {!on ? (
        <button className="btn primary block" data-testid="lab-start" onClick={() => void start()}>Play do and {DEG_NAME[deg]}</button>
      ) : (
        <>
          <div className="field">
            <span className="t14" style={{ fontWeight: 600 }} aria-hidden="true">Move {DEG_NAME[deg]}</span>
            <div className="row">
              <span className="t14 muted" aria-hidden="true">lower</span>
              <input type="range" className="grow" min={-SLIDER} max={SLIDER} step={0.5} value={pos} disabled={done != null}
                data-testid="lab-slider" aria-label={`Move ${DEG_NAME[deg]}: left is lower, right is higher`} aria-valuetext="no numbers: use your ears"
                onChange={(e) => set(Number(e.target.value))} style={{ height: 44, accentColor: 'var(--voice)' }} />
              <span className="t14 muted" aria-hidden="true">higher</span>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn grow" disabled={done != null} data-testid="lab-lower" onClick={() => set(pos - 1)}>A touch lower</button>
            <button className="btn grow" disabled={done != null} data-testid="lab-higher" onClick={() => set(pos + 1)}>A touch higher</button>
          </div>
        </>
      )}
      {done != null && <TryResult deg={deg} off={done} tol={TOL_HAND} title="Your tuning" />}
      {on && (done == null
        ? <button className="btn primary block" data-testid="lab-lock" onClick={lock}>That's it</button>
        : <button className="btn primary block" data-testid="lab-next" onClick={() => void next()}>Next round</button>)}
      <div className="row between wrap" style={{ gap: 4 }}>
        <span className="t14 muted">{COURSES[iv].steps[1].rule}.</span>
        <CentHelp />
      </div>
      {passed && <StepDone iv={iv} rung={2} onKeep={() => setPassed(false)} />}
    </main>
  );
}

/** The slider's half-range (cents). */
const SLIDER = 80;
/** A round: pure sits `shift` from the slider's middle (±25¢); the start is clearly off (15–40¢ above or below). */
function newTuneRound() {
  const shift = Math.round((Math.random() * 50 - 25) * 2) / 2;
  const m = 15 + Math.random() * 25;
  return { shift, start: shift + Math.round((Math.random() < 0.5 ? -m : m) * 2) / 2 };
}

// ---------- 3–5 · singing, and the quick check ----------

/** The quick check: three holds by ear (no picture), a week after the course. */
interface CheckMode { holds: number[]; kept: boolean | null }

function SingRung({ iv, root, lab, record, rung, check }: RungProps & { rung: number; check?: CheckMode }) {
  const chordRung = rung === 5 && !check;
  const [part, setPart] = useState<Degree>(INTERVAL_DEGREE[iv]);
  const [showWobble, setShowWobble] = useState(rung !== 4);
  const deg = chordRung ? part : INTERVAL_DEGREE[iv];
  // The app's notes: do (and sol for the third) under the singer; in the chord, the other two.
  const others: Degree[] = chordRung ? (['do', 'mi', 'sol'] as Degree[]).filter((d) => d !== deg) : iv === 'third' ? ['do', 'sol'] : ['do'];
  const drone = useDrone();
  const [state, setState] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  const [err, setErr] = useState('');
  /** How far the voice is from pure now (cents; null = nothing heard). */
  const [offNow, setOffNow] = useState<number | null>(null);
  const [held, setHeld] = useState(0);
  const [result, setResult] = useState<{ value: number; counted: boolean } | null>(null);
  const [passed, setPassed] = useState(false);
  const [hinting, setHinting] = useState(false);
  const unsub = useRef<(() => void) | null>(null);
  const hintTimer = useRef(0);
  // `locked`: a round just locked; the voice is still followed on screen, and the next round starts
  // by itself after a breath (BREATH_SEC without a voice) or with "Next round".
  const live = useRef({ hold: new HoldDetector(), recent: [] as { t: number; hz: number }[], paused: false, locked: false, lastVoice: 0, shown: 0 });
  const [lockedUi, setLockedUi] = useState(false);
  const verdictRef = useRef<HTMLDivElement | null>(null);
  const rootHz = midiToHz(root);
  const target = pureCents(deg);
  const tol = TOL_SING;
  const wobbleOn = chordRung ? showWobble : rung === 3;
  // What the mic's callbacks need now (they outlive renders: the part or the wobble switch may change).
  const cur = useRef({ deg, others, target, showWobble, record });
  cur.current = { deg, others, target, showWobble, record };

  useEffect(() => () => { unsub.current?.(); unsub.current = null; clearTimeout(hintTimer.current); }, []);
  // The chord's notes follow the chosen part; a new part is a new round.
  useEffect(() => {
    if (state !== 'on') return;
    void drone.get().then((d) => d?.set(Object.fromEntries(others.map((o) => [o, toneHz(root, o)]))));
    clearTimeout(hintTimer.current);
    setHinting(false);
    again();
  }, [part]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setState('starting');
    try {
      const d = await drone.get();
      if (!d) return;
      const t = await getTracker();
      if (!drone.alive.current) return; // (left while the mic opened)
      // (under do, whichever part is sung: the chord's part can change)
      const lowest = root - 5;
      t.configureFor(lowest);
      t.setLowestNote(lowest);
      t.setHint(() => root + cur.current.target / 100);
      d.set(Object.fromEntries(others.map((o) => [o, toneHz(root, o)])));
      const L = live.current;
      L.hold.reset();
      unsub.current?.();
      const off = t.onPitch((p) => {
        if (L.paused) return;
        const hz = p.midi != null ? midiToHz(p.midi) : null;
        const now = p.ctxTime;
        if (hz != null) {
          L.recent.push({ t: now, hz });
          L.recent = L.recent.filter((r) => r.t > now - 0.3);
        } else if (L.recent.length && now - L.recent[L.recent.length - 1].t > 0.3) L.recent = [];
        const { target: tg } = cur.current;
        if (hz != null) L.lastVoice = now;
        else if (L.locked && now - L.lastVoice > BREATH_SEC) {
          // A breath after a locked round: the next round starts.
          L.locked = false;
          L.hold.reset();
          setLockedUi(false);
        }
        const locked = L.locked ? null : L.hold.push(now, hz != null ? centsAbove(hz, rootHz, tg) : null);
        // (the screen at most ~15 times a second)
        if (performance.now() - L.shown > 66) {
          L.shown = performance.now();
          setOffNow(L.recent.length ? centsAbove(median(L.recent.map((r) => r.hz)), rootHz, tg) - tg : null);
          setHeld(L.locked ? 0 : L.hold.held());
        }
        if (locked != null) onLock(locked);
      });
      unsub.current = () => { off(); t.setHint(null); };
      setState('on');
    } catch (e) {
      setErr(micErrorText(e));
      setState('error');
    }
  }

  function onLock(c: number) {
    const L = live.current;
    L.locked = true;
    L.hold.reset();
    setLockedUi(true);
    setHeld(0);
    // (on a phone the result may be below the fold)
    window.setTimeout(() => verdictRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 50);
    const { target: tg, showWobble: sw, record: rec } = cur.current;
    const offBy = c - tg;
    // A different note (more than a semitone away) is no try; in the chord, rounds with the wobble shown are practice.
    const counted = Math.abs(offBy) <= 60 && (!chordRung || !sw);
    setResult({ value: c, counted });
    if (counted && rec(iv, rung, offBy).opened) setPassed(true);
  }

  /** A new round. */
  function again() {
    const L = live.current;
    L.hold.reset();
    L.recent = [];
    L.paused = false;
    L.locked = false;
    setLockedUi(false);
    setOffNow(null);
    setResult(null);
  }

  async function hint() {
    const d = await drone.get();
    if (!d) return;
    const L = live.current;
    L.paused = true;
    L.hold.reset();
    setHeld(0);
    setHinting(true);
    d.set({ ...Object.fromEntries(others.map((o) => [o, toneHz(root, o)])), hint: toneHz(root, deg) });
    clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => {
      if (!drone.alive.current) return;
      d.set(Object.fromEntries(cur.current.others.map((o) => [o, toneHz(root, o)])));
      setHinting(false);
      L.recent = [];
      L.paused = false;
    }, 2500);
  }

  // While a hold is under way: only the picture (or the ear) and the hold timer.
  const holding = state === 'on' && !lockedUi && held >= 0.3;
  const wrongNote = result != null && Math.abs(result.value - target) > 60;
  const note = DEG_NAME[deg];
  const goal = check ? `Sing ${note} by ear and hold it for ${HOLD_SEC} seconds, three times.`
    : rung === 3 ? `Sing ${note} so the ${iv === 'third' ? 'chord' : 'fifth'} goes still, then hold it for ${HOLD_SEC} seconds.`
      : rung === 4 ? `Sing ${note} by ear, then hold it for ${HOLD_SEC} seconds.`
        : `Lock your note into the chord, then hold it for ${HOLD_SEC} seconds.`;
  const how = deg === 'do' ? 'Hold do steady; the others are tuned to it.'
    : `Start a little ${deg === 'mi' ? 'above' : 'below'} ${note} on “nee”, straight tone, and slide ${deg === 'mi' ? 'down' : 'up'} slowly. Stop where ${wobbleOn ? 'the picture calms down' : 'it goes still'}, and hold.`;
  const results = check ? check.holds : lab[iv].logs[rung] ?? [];
  return (
    <main className="screen crs-stepscreen" data-testid={check ? 'lab-check-screen' : `lab-sing-${rung}`}>
      <RungTop iv={iv} rung={check ? 'check' : rung}>
        <GoalLines goal={goal} how={<>{rung === 4 || check ? 'No picture this time: only your ears. ' : chordRung ? 'The app sings the other two notes, already pure. ' : ''}{how}</>} />
      </RungTop>
      {check
        ? <Tries label="Holds" results={check.holds} ok={(v) => Math.abs(v) <= tol} total={CHECK_HOLDS} more={check.kept != null ? checkLine(check.holds) : `${CHECK_HOLDS - check.holds.length} to go`} />
        : <Tries label="Pure tries" results={results} ok={(v) => Math.abs(v) <= tol} total={ROUNDS} more={moreToPass(rung, results)} />}
      {chordRung && (
        <>
          <div className="seg" role="group" aria-label="You sing">
            {(['do', 'mi', 'sol'] as const).map((d) => (
              <button key={d} aria-pressed={d === part} data-testid={`lab-part-${d}`} onClick={() => setPart(d)}>
                {d === 'do' ? 'Do (root)' : d === 'mi' ? 'Mi (3rd)' : 'Sol (5th)'}
              </button>
            ))}
          </div>
          <label className="toggle-row">
            <span className="t14" style={{ fontWeight: 600 }}>Show the picture{showWobble ? ' (practice: rounds count with it off)' : ''}</span>
            <input type="checkbox" checked={showWobble} data-testid="lab-wobble-toggle" onChange={(e) => { setShowWobble(e.target.checked); again(); }} />
          </label>
        </>
      )}
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="pill">Drone: {others.map((o) => DEG_NAME[o]).join(' + ')}</span>
        <span className="pill voice">You: {note}</span>
      </div>
      {state !== 'on' ? (
        <div className="card" style={{ alignItems: 'center', gap: 10 }}>
          <span className="t14 muted" style={{ textAlign: 'center' }}>
            {state === 'error' ? err : 'Headphones on: the app’s notes must not reach the microphone. Your voice is analysed on this phone only.'}
          </span>
          <button className="btn voice" data-testid="lab-mic" disabled={state === 'starting'} onClick={() => void start()}>
            {state === 'starting' ? 'Starting…' : state === 'error' ? 'Try again' : 'Start: drone and microphone'}
          </button>
        </div>
      ) : (
        <div className="card" style={{ gap: 10 }}>
          {wobbleOn ? (
            <>
              <div className="row between">
                <span className="t14 muted">Your voice</span>
                <span className="mono t14" style={{ color: offNow != null && Math.abs(offNow) <= tol ? 'var(--good)' : 'var(--voice)' }} data-testid="lab-word">{wobbleWord(offNow)}</span>
              </div>
              <Wave beats={offNow == null ? null : shownBeats(offNow, deg, others)} label={`Your voice against the drone: ${wobbleWord(offNow)}`} />
              {!holding && <span className="t14 muted">Shows how much it pulses, never which way. Which way to move is for your ear.</span>}
            </>
          ) : (
            <div className="col" style={{ alignItems: 'center', gap: 6, padding: '12px 0' }}>
              <IconEar size={40} color="var(--muted)" />
              <strong className="t16">Listen for the moment it stops moving</strong>
            </div>
          )}
          <HoldRing held={held} done={lockedUi} />
        </div>
      )}
      {result && !holding && check?.kept == null && (
        <div ref={verdictRef} style={{ scrollMarginBottom: 16 }}>
          {wrongNote ? (
            <div className="notice col" role="status" data-testid="lab-verdict" style={{ gap: 4 }}>
              <strong>That was a different note</strong>
              <span className="t14">Aim for {note}: {hintInterval(deg)}. It doesn’t count as a try.</span>
            </div>
          ) : (
            <TryResult deg={deg} off={result.value - target} tol={tol} title={lockedUi ? 'Your last try' : 'Last round'} practice={!result.counted}
              note={lockedUi ? 'Sing again when you’re ready; the app is listening.' : undefined} />
          )}
        </div>
      )}
      {check && check.kept != null && <CheckDone iv={iv} kept={check.kept} holds={check.holds} />}
      {chordRung && state === 'on' && !holding && (
        <div className="notice info t14">
          <strong>Listen for the ghost note.</strong> When all three are pure, you may hear a soft hum two octaves below do. Nobody sings it: your ears make it.
        </div>
      )}
      {state === 'on' && !holding && check?.kept == null && (
        <div className="row" style={{ gap: 10 }}>
          {rung === 3 && !check && <button className="btn grow" disabled={hinting || lockedUi} data-testid="lab-hint" onClick={() => void hint()}><IconPlay size={16} color="currentColor" /> {hinting ? 'Listen…' : 'Hear it once'}</button>}
          {lockedUi && <button className="btn grow" data-testid="lab-next" onClick={() => again()}>Next round</button>}
        </div>
      )}
      {!holding && (
        <div className="row between wrap" style={{ gap: 4 }}>
          <span className="t14 muted">{check ? `Kept when ${CHECK_KEEP} of ${CHECK_HOLDS} holds are close to pure.` : `${COURSES[iv].steps[rung - 1].rule}.`} Straight tone, no vibrato.</span>
          <CentHelp />
        </div>
      )}
      {passed && !check && <StepDone iv={iv} rung={rung} onKeep={() => setPassed(false)} />}
    </main>
  );
}

/** Silence this long after a locked round (s) starts the next one. */
const BREATH_SEC = 0.4;

function hintInterval(d: Degree) {
  return d === 'mi' ? 'a major third above do' : d === 'sol' ? 'a fifth above do' : 'the root, under the other two';
}

function HoldRing({ held, done }: { held: number; done: boolean }) {
  const f = done ? 1 : Math.min(1, held / HOLD_SEC);
  const C = 2 * Math.PI * 30;
  return (
    <div className="row" style={{ gap: 14 }}>
      <svg width={72} height={72} viewBox="0 0 72 72" role="img" aria-label={done ? 'Round taken' : `Held ${held.toFixed(1)} of ${HOLD_SEC} seconds`} data-testid="lab-hold">
        <circle cx={36} cy={36} r={30} fill="none" stroke="var(--line)" strokeWidth={7} />
        <circle cx={36} cy={36} r={30} fill="none" stroke="var(--voice)" strokeWidth={7} strokeLinecap="round"
          strokeDasharray={`${(C * f).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 36 36)" />
        <text x={36} y={41} textAnchor="middle" style={{ fontSize: '0.9375rem' }} fontWeight={600} fill="var(--text)" fontFamily="var(--mono)">{done ? '✓' : `${(HOLD_SEC * f).toFixed(1)}s`}</text>
      </svg>
      <div className="col grow" style={{ gap: 2 }}>
        <strong className="t16">{done ? 'Got it: see where you landed below' : `Hold it steady for ${HOLD_SEC} s`}</strong>
        <span className="t14 muted">{done ? 'Still listening. Take a breath, then sing again for the next round.' : 'The app takes what you hold and shows where you landed.'}</span>
      </div>
    </div>
  );
}

// ---------- the quick check ----------

function QuickCheck({ iv, root, lab, onLab }: { iv: LabInterval; root: number; lab: LabProgress; onLab: (p: LabProgress) => void }) {
  const [holds, setHolds] = useState<number[]>([]);
  const [kept, setKept] = useState<boolean | null>(null);
  const ref = useRef<number[]>([]);
  const record = (_iv: LabInterval, _rung: number, v: number) => {
    if (ref.current.length >= CHECK_HOLDS) return { passed: false, opened: false };
    ref.current = [...ref.current, v];
    setHolds(ref.current);
    if (ref.current.length === CHECK_HOLDS) {
      const r = logCheck(loadLab(), iv, ref.current);
      saveLab(r.p);
      onLab(r.p);
      setKept(r.kept);
      syncProgressSoon();
    }
    return { passed: false, opened: false };
  };
  return <SingRung iv={iv} root={root} lab={lab} record={record} rung={4} check={{ holds, kept }} />;
}

function CheckDone({ iv, kept, holds }: { iv: LabInterval; kept: boolean; holds: number[] }) {
  const ses = todaySession({ lab: true });
  const nx = ses?.next ?? null;
  return (
    <div className={`card crs-result${kept ? ' good' : ''}`} role="status" data-testid="lab-check-done">
      <strong className="crs-feel">{kept ? 'It held ✓' : 'It slipped a little'}</strong>
      <span className="t16">{kept
        ? `${checkLine(holds)}: your ${iv === 'third' ? 'pure third' : 'pure fifth'} is still there.`
        : `${checkLine(holds)}. One step again brings it back: sing it by ear, until it locks.`}</span>
      {kept ? (
        nx ? <button className="btn primary block two" data-testid="today-next" onClick={() => goStep(nx, true)}><span>Next: {stepShort(nx)}</span><span className="sub">step {ses!.nextIndex + 1} of {ses!.plan.steps.length} · {nx.minutes} min</span></button>
          : <button className="btn primary block" data-testid="lab-to-train" onClick={() => go({ name: 'train' })}>Back to Train</button>
      ) : (
        <>
          <button className="btn primary block" data-testid="lab-redo" onClick={() => go({ name: 'intonation', interval: iv, rung: 4 }, true)}>Sing it by ear, once more</button>
          <button className="btn block" onClick={() => (nx ? goStep(nx, true) : go({ name: 'train' }))}>{nx ? 'Later: next step of today' : 'Later'}</button>
        </>
      )}
    </div>
  );
}
