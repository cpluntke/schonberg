// The Train tab: drills from your music (the leap drill) and the Zwölfton row of the day. The
// Intonation tab (IntonationHome): why choirs tune differently, today's course step (the warm-up),
// the courses (the active one and one suggestion; all of them behind "All courses") and the tools
// (check a note, the drone). Also All courses and the drone screen. The courses themselves are in IntonationLab.tsx (docs/INTONATION.md).
import React, { useEffect, useRef, useState } from 'react';
import { back, go, setDrillHome } from '../router';
import { useProfile, useStoreVersion } from '../hooks';
import { registerVirtual, useLibrary } from '../library';
import { cycleLeaps, leapPiece } from '../generated';
import { rowOfTheDay } from '../../game/twelvetone';
import { RUNGS, RUNG_NAMES, loadLab, rootFor, type LabInterval, type LabProgress } from '../../game/intonation';
import { COURSES, COURSE_IDS, COURSE_MINUTES, activeCourse, courseStatus, courseWarmUp, reviewState, suggestedCourse } from '../../game/courses';
import { IconBack, IconChevron, IconGauge, IconLoop, IconPause, IconPlay } from '../icons';
import { YouButton } from '../components/YouSheet';
import { letterName } from '../components/Tuner';
import { computeToday, dateWords, goStep, shortTitle, tickContext } from '../today';
import { dayOf, labStep, stepDone } from '../../progress/today';
import { lastLeapRun, loadLeapRuns } from '../../progress/leaps';
import { CourseChecks, courseRecommended } from './IntonationLab';
import { TUNING_TITLE, tuningSeen } from './Tuning';
import { getAudioContext, unlockAudio } from '../../audio/context';
import { Drone } from '../../audio/drone';
import { midiToHz } from '../../audio/pitch';

const sym = (p: number) => (p === 10 ? 't' : p === 11 ? 'e' : String(p));
/** "Dieu! qu'il la fait bon regarder, bar 12" → "Dieu!, bar 12": the bar number stays in view at 390 px. */
export function shortWhere(where: string): string {
  const m = /^(.*), (bar .+)$/.exec(where);
  return m ? `${shortTitle(m[1])}, ${m[2]}` : where;
}

/** A pulse line (the drone's icon). */
const IconPulse = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12h4l2-6 4 12 2-6h6" />
  </svg>
);

export function Train() {
  useProfile();
  useStoreVersion();
  useLibrary();
  const leaps = cycleLeaps();
  const row = rowOfTheDay(new Date());
  const lastLeaps = lastLeapRun(loadLeapRuns());

  function playLeaps() {
    const p = leapPiece();
    if (!p) return;
    registerVirtual(p);
    setDrillHome('train'); // (leaving the drill comes back here)
    // (level 1 is the slow step: "Slow, with guide", as in Expert mode)
    go({ name: 'play', pieceId: p.id, partId: 'drill', sectionId: 'all', level: 1, mode: '2d', step: 'slow' });
  }

  return (
    <main className="screen wide train">
      <div className="row between tab-head">
        <h1 className="hero">Train</h1>
        <YouButton />
      </div>
      <span className="t16 muted" style={{ marginTop: -8 }}>Drills built from your music, and a challenge, a few minutes a day.</span>

      <div className="lay train-cols">
        <div className="col crs-col">
          <section className="col crs-section" aria-labelledby="train-music-h">
            <div className="row between">
              <h2 id="train-music-h">From your music</h2>
              <span className="t14 muted">built from your parts</span>
            </div>
            <div className="card crs-list" data-testid="train-leaps">
              {leaps.length ? (
                <button className="crs-item" data-testid="train-leaps-go" onClick={playLeaps}>
                  <span className="you-ic" aria-hidden="true"><IconLoop /></span>
                  <span className="grow col" style={{ gap: 2 }}>
                    <strong className="t16">Your tricky leaps</strong>
                    <span className="t14 muted">{leaps.length} leap{leaps.length === 1 ? '' : 's'}{lastLeaps ? ` · last time ${lastLeaps.landed} of ${lastLeaps.total}` : ` · e.g. ${shortWhere(leaps[0].where)}`}</span>
                  </span>
                  <span className="t14 muted nowrap">2 min</span>
                </button>
              ) : (
                <span className="t14 muted crs-item">Put pieces into your programme (Pieces) to get a drill of their hardest leaps.</span>
              )}
              <button className="crs-item" data-testid="train-more-drills" onClick={() => go({ name: 'expert' })}>
                <span className="grow col" style={{ gap: 2 }}>
                  <strong className="t16">More drills</strong>
                  <span className="t14 muted">Entries, intervals and more, in expert mode</span>
                </span>
                <IconChevron size={20} color="var(--muted)" />
              </button>
            </div>
          </section>
        </div>

        <div className="col crs-col">
          <section className="col crs-section" aria-labelledby="train-challenge-h">
            <h2 id="train-challenge-h">Challenge</h2>
            <button className="card expert train-row" style={{ textAlign: 'left', color: 'inherit' }} data-testid="train-row" onClick={() => go({ name: 'expert' })}>
              <span className="grow col" style={{ gap: 8 }}>
                <span className="row between">
                  <strong className="t16">Zwölfton of the day</strong>
                  <span className="badge expert">Expert</span>
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 3 }} aria-hidden="true">
                  {row.map((pc, i) => (
                    <span key={i} className="mono" style={{ minHeight: 26, borderRadius: 6, background: 'var(--expert-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'min(0.875rem, 3.6vw)', color: 'var(--expert-text)' }}>{sym(pc)}</span>
                  ))}
                </span>
                <span className="t14" style={{ color: 'var(--expert-text)' }}>12 notes, no key · the same row for the whole choir today.</span>
              </span>
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}

/**
 * The Intonation tab: why choirs tune differently, today's course step (the warm-up), the courses,
 * and the tools (check a note, the drone).
 */
export function IntonationHome() {
  useProfile();
  useStoreVersion();
  const lab = loadLab();
  const recommended = courseRecommended();
  const active = activeCourse(lab);
  const suggested = suggestedCourse(lab, active);
  const doneCourses = COURSE_IDS.filter((k) => courseStatus(lab[k]) === 'done');
  const warm = useWarmUp(lab, recommended);

  return (
    <main className="screen wide train" data-testid="intonation-home">
      <div className="row between tab-head">
        <h1 className="hero">Intonation</h1>
        <YouButton />
      </div>
      <span className="t16 muted" style={{ marginTop: -8 }}>Hear and sing pure intervals, so the chords you sing ring. A few minutes a day.</span>

      <div className="lay train-cols">
        <div className="col crs-col">
          <TuningEntry />
          {warm && <WarmUpCard w={warm} />}
          <section className="col crs-section" aria-labelledby="train-courses-h" data-testid="train-courses">
            <div className="row between">
              <h2 id="train-courses-h">Courses</h2>
              <span className="t14 muted">one step a day</span>
            </div>
            {active && <CourseCard iv={active} lab={lab} kind="active" recommended={recommended} />}
            {suggested && <CourseCard iv={suggested} lab={lab} kind={active ? 'next' : 'start'} recommended={recommended} />}
            {!active && !suggested && doneCourses.map((k) => <CourseCard key={k} iv={k} lab={lab} kind="done" recommended={recommended} />)}
            <button className="link between crs-all" data-testid="train-all-courses" onClick={() => go({ name: 'courses' })}>
              <span><span className="crs-alllabel">All courses ({COURSE_IDS.length})</span>{doneCourses.length > 0 && <span className="muted"> · incl. {doneCourses.map((k) => `${COURSES[k].title} ✓`).join(', ')}</span>}</span>
              <IconChevron size={18} />
            </button>
          </section>
        </div>

        <div className="col crs-col">
          <section className="col crs-section" aria-labelledby="tune-tools-h">
            <h2 id="tune-tools-h">Tools</h2>
            <div className="crs-tools">
              <button className="btn crs-tool" data-testid="train-tuner" onClick={() => go({ name: 'tuner' })}><IconGauge size={20} /> Check a note</button>
              <button className="btn crs-tool" data-testid="train-drone" onClick={() => go({ name: 'drone' })}><IconPulse size={20} /> Drone</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

/** "Why choirs tune differently · 5 min": a card above the courses until it's been seen, then a quiet link. */
function TuningEntry() {
  if (tuningSeen()) {
    return (
      <button className="link tun-seen" data-testid="train-tuning" onClick={() => go({ name: 'tuning' })}>
        <span>{TUNING_TITLE} · 5 min</span>
        <IconChevron size={18} />
      </button>
    );
  }
  return (
    <button className="card crs-card tun-entry" data-testid="train-tuning" onClick={() => go({ name: 'tuning' })}>
      <span className="row between"><span className="eb">Start here · with sound</span><span className="t14 muted nowrap">5 min</span></span>
      <strong className="crs-card-title">{TUNING_TITLE}</strong>
      <span className="t14 muted">Why pianos and choirs tune differently, and what to listen for. Short screens to tap and hear.</span>
      <span className="row between" style={{ gap: 8 }}>
        <strong className="t16">Read and listen</strong>
        <IconChevron size={20} color="var(--muted)" />
      </span>
    </button>
  );
}

interface WarmUp { iv: LabInterval; rung: number; check?: boolean; redo?: boolean; minutes: number; start: () => void }

/**
 * Today's warm-up: today's plan's course step while it isn't done; without one in the plan, the
 * course's next step unless a step of it was already passed today (one step a day).
 */
function useWarmUp(lab: LabProgress, recommended: boolean): WarmUp | null {
  const today = dayOf(new Date());
  const t = computeToday(recommended);
  const i = t.plan.steps.findIndex((s) => s.kind === 'lab');
  if (i >= 0) {
    const s = t.plan.steps[i];
    if (t.status.done[i] || !s.lab) return null;
    return { iv: s.lab.interval, rung: s.lab.rung, check: s.lab.check, redo: !!s.lab.redo, minutes: s.minutes, start: () => goStep(s) };
  }
  const w = courseWarmUp(lab, recommended, today);
  if (!w || (w.done && !w.check && !w.redo)) return null;
  if (!w.check && Object.values(lab[w.interval].passed ?? {}).includes(today)) return null;
  const s = labStep(w);
  if (stepDone(s, tickContext(today))) return null;
  return { iv: w.interval, rung: w.rung, check: w.check, redo: w.redo, minutes: s.minutes, start: () => go(s.route) };
}

function WarmUpCard({ w }: { w: WarmUp }) {
  const c = COURSES[w.iv];
  const step = c.steps[w.rung - 1];
  const title = w.check ? `${c.title} · quick check` : `${c.title} · step ${w.rung} of ${RUNGS}`;
  const text = w.check ? 'One minute, three holds by ear: is it still there?'
    : `${step.name}${w.redo ? ', once more' : ''}: ${step.goal.charAt(0).toLowerCase()}${step.goal.slice(1)}`;
  return (
    <section className="card crs-warm" data-testid="train-lab" aria-labelledby="train-lab-h">
      <div className="row between">
        <span className="eb">Today's warm-up</span>
        <span className="t14 muted">{w.minutes} min</span>
      </div>
      <h2 id="train-lab-h" className="crs-warm-title">{title}</h2>
      <span className="t16">{text}</span>
      {(w.rung >= 3 || w.check) && <span className="t14 muted">Headphones on</span>}
      <button className="btn primary block" data-testid="train-lab-go" onClick={w.start}>
        <IconPlay size={18} /> {w.check ? `Quick check · ${w.minutes} min` : `${lab1(w)} · ${w.minutes} min`}
      </button>
    </section>
  );
}
const lab1 = (w: WarmUp) => (w.redo ? `Step ${w.rung} once more` : w.rung === 1 && !w.check ? 'Start step 1' : `Continue step ${w.rung}`);

/** A course on Train: the active one (its steps and the next one), the one to start, or a finished one. */
function CourseCard({ iv, lab, kind, recommended }: { iv: LabInterval; lab: LabProgress; kind: 'active' | 'next' | 'start' | 'done'; recommended: boolean }) {
  const c = COURSES[iv];
  const t = lab[iv];
  const today = dayOf(new Date());
  const cur = Math.min(t.rung, RUNGS);
  const rv = reviewState(t, today);
  // (the choir recommends the courses: the badge goes on the one to do now)
  const badge = recommended && (kind === 'active' || kind === 'start') ? { text: 'Your choir recommends', cls: 'crs-rec' }
    : kind === 'next' || kind === 'start' ? { text: kind === 'next' ? 'Suggested next' : 'Suggested', cls: 'crs-sug' } : null;
  return (
    <button className="card crs-card" data-testid={`train-course-${iv}`} onClick={() => go({ name: 'intonation', interval: iv })}>
      {badge && <span className={badge.cls}>{badge.text}</span>}
      <strong className="crs-card-title">{c.title}</strong>
      <span className="t14 muted">{c.line}</span>
      {kind === 'active' && (
        <span className="row" style={{ gap: 10 }}><CourseChecks iv={iv} lab={lab} /><span className="t14 muted">step {cur} of {RUNGS}</span></span>
      )}
      <span className="divider" aria-hidden="true" />
      <span className="row between" style={{ gap: 8 }}>
        <span className="col" style={{ gap: 2 }}>
          {kind === 'active' && <span className="t14 muted">Next</span>}
          {kind !== 'active' && kind !== 'done' && <span className="t14 muted">{RUNGS} steps · about {COURSE_MINUTES} min</span>}
          <strong className="t16">
            {kind === 'active' ? `${t.redo ? `${RUNG_NAMES[t.redo - 1]}, once more` : RUNG_NAMES[cur - 1]} · ${c.steps[cur - 1].minutes} min`
              : kind === 'done' ? (rv === 'booked' && t.review ? `Done ✓ · quick check ${dateWords(t.review.due)}` : rv === 'due' ? 'Done ✓ · quick check today' : rv === 'slipped' ? 'Sing it by ear, once more' : 'Done ✓')
                : 'Start: Listen'}
          </strong>
        </span>
        <IconChevron size={20} color="var(--muted)" />
      </span>
    </button>
  );
}

// ---------- All courses ----------

export function AllCourses() {
  useStoreVersion();
  const lab = loadLab();
  const today = dayOf(new Date());
  const recommended = courseRecommended();
  return (
    <main className="screen crs-page" data-testid="all-courses">
      <div className="topbar">
        <button className="icon-btn filled" aria-label="Back" onClick={() => back({ name: 'tune' })}><IconBack /></button>
        <h1>All courses</h1>
      </div>
      <span className="t16 muted">Each course is a few short steps, about {COURSE_MINUTES} minutes in all: one step a day is plenty.{recommended ? ' Your choir recommends the intonation courses.' : ''}</span>
      {COURSE_IDS.map((k) => {
        const t = lab[k];
        const st = courseStatus(t);
        const rv = reviewState(t, today);
        return (
          <button key={k} className="card crs-card" data-testid={`course-${k}`} onClick={() => go({ name: 'intonation', interval: k })}>
            <span className="eb">Intonation</span>
            <strong className="crs-card-title">{COURSES[k].title}</strong>
            <span className="t14 muted">{COURSES[k].line}</span>
            <span className="row between" style={{ gap: 8 }}>
              {st === 'new' ? <span className="t14 muted">{RUNGS} steps · about {COURSE_MINUTES} min</span> : <CourseChecks iv={k} lab={lab} />}
              <span className={`t14 ${st === 'done' ? 'good-text' : 'muted'}`}>
                {st === 'done' ? (rv === 'booked' && t.review ? `done ✓ · check ${dateWords(t.review.due)}` : rv === 'kept' ? 'done ✓ · check held' : rv === 'slipped' ? 'step 4 once more' : 'done ✓') : st === 'active' ? `step ${t.rung} of ${RUNGS}` : 'not started'}
              </span>
            </span>
          </button>
        );
      })}
    </main>
  );
}

// ---------- the drone ----------

/** A held do (and sol, a pure fifth above) at a pitch of your choice, to sing against. */
export function DroneScreen() {
  const [profile] = useProfile();
  const [root, setRoot] = useState(() => rootFor(profile.voice, profile.rangeLow, profile.rangeHigh));
  const [fifth, setFifth] = useState(false);
  const [on, setOn] = useState(false);
  const ref = useRef<Drone | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ref.current?.dispose(); ref.current = null; };
  }, []);
  const tones = (r: number, f: boolean): Record<string, number> => (f ? { do: midiToHz(r), sol: midiToHz(r) * 1.5 } : { do: midiToHz(r) });
  // While it sounds, it follows the note and the fifth.
  useEffect(() => { if (on) ref.current?.set(tones(root, fifth)); }, [root, fifth, on]);
  async function toggle() {
    if (on) { ref.current?.stop(); setOn(false); return; }
    await unlockAudio();
    if (!alive.current) return;
    if (!ref.current) ref.current = new Drone(getAudioContext());
    ref.current.set(tones(root, fifth));
    setOn(true);
  }
  const name = letterName(root);
  return (
    <main className="screen crs-page" data-testid="drone-screen">
      <div className="topbar">
        <button className="icon-btn filled" aria-label="Back" onClick={() => back({ name: 'tune' })}><IconBack /></button>
        <h1>Drone</h1>
      </div>
      <span className="t16 muted">A steady note to sing against: hold your note over it and listen for the pulse to stop.</span>
      <div className="card" style={{ gap: 14 }}>
        <div className="row between">
          <button className="btn crs-step-btn" aria-label="A semitone lower" data-testid="drone-lower" onClick={() => setRoot((r) => Math.max(36, r - 1))}>−</button>
          <span className="col" style={{ alignItems: 'center', gap: 0 }}>
            <strong className="crs-drone-note" data-testid="drone-note" aria-live="polite">{name}</strong>
            <span className="t14 muted">do{fifth ? ` + sol (${letterName(root + 7)})` : ''}</span>
          </span>
          <button className="btn crs-step-btn" aria-label="A semitone higher" data-testid="drone-higher" onClick={() => setRoot((r) => Math.min(72, r + 1))}>+</button>
        </div>
        <div className="seg" role="group" aria-label="Notes">
          <button aria-pressed={!fifth} data-testid="drone-do" onClick={() => setFifth(false)}>Do</button>
          <button aria-pressed={fifth} data-testid="drone-fifth" onClick={() => setFifth(true)}>Do + sol</button>
        </div>
      </div>
      <button className="btn primary block" data-testid="drone-toggle" aria-pressed={on} onClick={() => void toggle()}>
        {on ? <><IconPause size={18} /> Stop</> : <><IconPlay size={18} /> Play the drone</>}
      </button>
      <span className="t14 muted">Sol is tuned pure (a 3:2 fifth), not as on the piano. With headphones, the tuner and the drone don’t get in each other’s way.</span>
    </main>
  );
}
