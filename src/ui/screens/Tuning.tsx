// "Why choirs tune differently": a short explainer before the intonation courses, ten pages with
// Back / Next, a progress row and Skip. It starts on a string (a monochord: drag the bridge, find the
// octave and the fifth by ear), shows why (the waves), asks whether the piano plays the same (the
// octave yes, the fifth a hair apart), walks the circle of fifths to the comma, and ends with what a
// choir can do that a piano can't. Each page: a few plain sentences, a picture (SVG, drawn each frame
// while the page is shown; a still frame with reduced motion) and a sound to play or change (the
// lab's Drone: held tones rich in overtones, retuned while they sound). The numbers are in
// game/tuning.ts; the courses themselves in IntonationLab.tsx (docs/INTONATION.md).

import React, { useEffect, useRef, useState } from 'react';
import { back, go, TUNING_PAGES, type Route } from '../router';
import { IconBack, IconCheck, IconChevron, IconPause, IconPlay } from '../icons';
import { F_CLEF, G_CLEF, GLYPH_UNITS_PER_SPACE } from '../play/clefGlyphs';
import { getAudioContext, unlockAudio } from '../../audio/context';
import { Drone } from '../../audio/drone';
import { ChordPlayer } from '../../audio/cadence';
import { COURSES, COURSE_IDS, COURSE_MINUTES, courseStatus } from '../../game/courses';
import { RUNGS, loadLab, type LabInterval } from '../../game/intonation';
import {
  BRIDGE_MAX, BRIDGE_MIN, CADENCE, COMMA, FIFTHS_FROM_C, JUST, OPEN_HZ, PIANO, PIANO_FIFTH_FRAC, STACKED_C, TARGETS, beatRate, cadenceHz, centsToRatio,
  fifthDrift, foldInto, nearestTarget, oneDecimal, partHz, stringBeat, wobbleLabel, type StringTarget,
} from '../../game/tuning';

export const TUNING_TITLE = 'Why choirs tune differently';
/** How long the explainer takes, as the Train card says. */
export const TUNING_MINUTES = 10;
const SEEN_KEY = 'sh:tuningSeen';

/** Has the singer seen the explainer (to its last page, or skipped there) on this phone? */
export function tuningSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ }
}

/** The root of the chord on the choir page: A3, comfortable for every voice to hear. */
const ROOT = 220;
/** Per-tone level: two tones a little louder than three, so a chord isn't louder than an interval. */
const LEVEL2 = 0.14;
const LEVEL3 = 0.11;

export const PAGE_NAMES = [
  'The string', 'Why? The waves', 'Find them yourself', 'The big question', 'So why not make every interval just?', 'Now stack just fifths',
  'Share it out', 'Choirs have a luxury', 'Hear a cadence', 'What matters most',
];

/** "About 6 beats a second", "Still". */
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const pageRoute = (n: number): Route => (n <= 1 ? { name: 'tuning' } : { name: 'tuning', page: n });

export function TuningScreen({ page }: { page: number }) {
  const p = Math.max(1, Math.min(TUNING_PAGES, Math.round(page) || 1));
  useEffect(() => { if (p === TUNING_PAGES) markSeen(); }, [p]);
  // (the pages replace each other: ← and the phone's back leave the explainer)
  const to = (n: number) => go(pageRoute(n), true);
  const leave = () => back({ name: 'tune' });
  const last = p === TUNING_PAGES;
  return (
    <main className="screen wide has-foot crs-page tun" data-testid="tuning" data-page={p}>
      <div className="topbar">
        <button className="icon-btn filled" aria-label="Back" onClick={leave}><IconBack /></button>
        <span className="t16 muted grow tun-where">{TUNING_TITLE}</span>
        {!last && <button className="link tun-skip" data-testid="tuning-skip" onClick={() => to(TUNING_PAGES)}>Skip</button>}
      </div>
      <nav className="tun-progress" aria-label="Pages">
        <ol>
          {PAGE_NAMES.map((name, i) => (
            <li key={name}>
              <button className={i + 1 < p ? 'done' : i + 1 === p ? 'now' : ''} aria-current={i + 1 === p ? 'step' : undefined}
                aria-label={`Page ${i + 1} of ${TUNING_PAGES}: ${name}`} data-testid={`tuning-dot-${i + 1}`} onClick={() => to(i + 1)}>
                <span aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <Page key={p} p={p} />
      <div className="crs-foot">
        <div className="tun-nav">
          {p > 1 && <button className="btn" data-testid="tuning-back" onClick={() => to(p - 1)}><IconBack size={18} /> Back</button>}
          {last
            ? <button className="btn primary" data-testid="tuning-done" onClick={leave}>Done</button>
            : <button className="btn primary" data-testid="tuning-next" onClick={() => to(p + 1)}>Next <IconChevron size={18} /></button>}
        </div>
      </div>
    </main>
  );
}

function Page({ p }: { p: number }) {
  switch (p) {
    case 1: return <StringPage />;
    case 2: return <WavesPage />;
    case 3: return <FindPage />;
    case 4: return <QuestionPage />;
    case 5: return <PianoFifthsPage />;
    case 6: return <JustFifthsPage />;
    case 7: return <ShareOutPage />;
    case 8: return <ChoirPage />;
    case 9: return <CadencePage />;
    default: return <PractisePage />;
  }
}

/**
 * A page: its heading and a few words beside (wide) or above (phone) its picture and sound; `after`:
 * words for once you've tried it (under the picture on a phone, under the words on wide screens).
 */
function PageBody({ n, children, figure, after }: { n: number; children: React.ReactNode; figure?: React.ReactNode; after?: React.ReactNode }) {
  return (
    <div className={figure ? 'tun-body' : 'tun-body solo'}>
      <div className="col tun-text">
        <span className="eb">{n} of {TUNING_PAGES}</span>
        <h1 className="tun-title" data-testid="tuning-title">{PAGE_NAMES[n - 1]}</h1>
        {children}
      </div>
      {figure && <div className="card tun-fig">{figure}</div>}
      {after && <div className="col tun-text tun-after">{after}</div>}
    </div>
  );
}

// ---------- sound and motion ----------

type Tones = Record<string, number>;

/** Stop when the app goes to the background. */
function useOnHidden(stop: () => void) {
  const ref = useRef(stop);
  ref.current = stop;
  useEffect(() => {
    const on = () => { if (document.hidden) ref.current(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
}

/**
 * This page's held tones: nothing until a tap (which unlocks audio), silent for good when the page
 * goes, stopped when the app goes to the background. `playing` is the id of what sounds.
 */
function useSound() {
  const ref = useRef<Drone | null>(null);
  const alive = useRef(true);
  const timer = useRef(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = () => { clearTimeout(timer.current); ref.current?.stop(); setPlaying(null); };
  useOnHidden(stop);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      ref.current?.dispose();
      ref.current = null;
    };
  }, []);
  /** Sound `tones` as `id` (afresh), for `ms` or until stopped. */
  const start = async (id: string, tones: Tones, ms = 0) => {
    await unlockAudio();
    if (!alive.current) return;
    if (!ref.current) ref.current = new Drone(getAudioContext(), 0.5);
    clearTimeout(timer.current);
    ref.current.stop();
    ref.current.set(tones, Object.keys(tones).length > 2 ? LEVEL3 : LEVEL2);
    setPlaying(id);
    if (ms) timer.current = window.setTimeout(() => { ref.current?.stop(); setPlaying(null); }, ms);
  };
  const toggle = (id: string, tones: Tones, ms = 0) => { if (playing === id) stop(); else void start(id, tones, ms); };
  /** Glide what sounds to new pitches (nothing when silent). */
  const retune = (tones: Tones) => { if (playing) ref.current?.set(tones, Object.keys(tones).length > 2 ? LEVEL3 : LEVEL2); };
  return { playing, start, toggle, stop, retune };
}

function useReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [r, setR] = useState(() => { try { return typeof matchMedia === 'function' && matchMedia(q).matches; } catch { return false; } });
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(q);
    const on = () => setR(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return r;
}

/**
 * A clock for an animation: grows by `rate` a second while the page is shown and motion is welcome
 * (0, a still frame, with reduced motion). Paused while the app is in the background.
 */
function useClock(rate = 1): number {
  const reduced = useReducedMotion();
  const [x, setX] = useState(0);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  useEffect(() => {
    if (reduced || !visible || typeof requestAnimationFrame !== 'function') return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      setX((v) => v + rateRef.current * dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, visible]);
  return reduced ? 0 : x;
}

/** A value that glides to `target` over `ms` (jumps with reduced motion). */
function useTween(target: number, ms = 650): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(target);
  const from = useRef(target);
  const cur = useRef(target);
  cur.current = v;
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== 'function') { setV(target); return; }
    from.current = cur.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      setV(from.current + (target - from.current) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return v;
}

/** Keep "2 : 1", "Fifth · 3" and "700 cents" from breaking across lines. */
const nb = (t: string) => t.replace(/ ([:·]) /g, '\u00a0$1\u00a0').replace(/(\d) (cents|keys)/g, '$1\u00a0$2');

/** A play / stop button for one sound, with a second line. */
function SoundButton({ id, playing, onClick, title, sub, testid }: { id: string; playing: string | null; onClick: () => void; title: string; sub?: string; testid?: string }) {
  const on = playing === id;
  return (
    <button className="btn two grow" aria-pressed={on} data-testid={testid} onClick={onClick}>
      <span className="row" style={{ gap: 6 }}>{on ? <IconPause size={16} /> : <IconPlay size={16} color="currentColor" />} {on ? 'Stop' : nb(title)}</span>
      {sub && <span className="sub">{nb(sub)}</span>}
    </button>
  );
}

/** Things to find, ticked as they're found. */
function Tasks({ items }: { items: { id: string; label: string; done: boolean }[] }) {
  return (
    <ul className="tun-tasks" aria-label="To find" aria-live="polite">
      {items.map((t) => (
        <li key={t.id} className={t.done ? 'done' : ''} data-testid={`tuning-task-${t.id}`} data-done={t.done}>
          <span className="tun-check" aria-hidden="true">{t.done && <IconCheck size={16} />}</span>
          <span>{t.label}<span className="sr-only">{t.done ? ': found' : ': not yet'}</span></span>
        </li>
      ))}
    </ul>
  );
}

// ---------- the string ----------

const SX0 = 16, SX1 = 324, SL = SX1 - SX0;
/** How fast the strings wiggle on screen: the whole string this many times a second, a part 1/frac times faster. */
const WIGGLE = 1.3;
const clampFrac = (f: number) => Math.min(BRIDGE_MAX, Math.max(BRIDGE_MIN, f));

/** "half the string", "two thirds of the string", "72.5% of the string". */
function fracWords(f: number): string {
  if (Math.abs(f - 0.5) < 0.0004) return 'half the string';
  if (Math.abs(f - 2 / 3) < 0.0004) return 'two thirds of the string';
  return `${(f * 100).toFixed(1)}% of the string`;
}

interface Mark { at: number; label: string; anchor?: 'start' | 'end' }

/** A string held at both ends, wiggling as a standing wave between `a` and `b` (svg x) at `y` while it sounds. */
function Wiggle({ a, b, y, amp, phase, colour }: { a: number; b: number; y: number; amp: number; phase: number; colour: string }) {
  const n = 40;
  const k = Math.cos(2 * Math.PI * phase);
  let line = '', top = '', bot = '';
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = (a + (b - a) * u).toFixed(1);
    const s = Math.sin(Math.PI * u);
    line += `${i ? 'L' : 'M'}${x} ${(y - amp * s * k).toFixed(1)}`;
    top += `${i ? 'L' : 'M'}${x} ${(y - amp * s).toFixed(1)}`;
    bot = `L${x} ${(y + amp * s).toFixed(1)}` + bot;
  }
  return (
    <g>
      {amp > 0 && <path d={`${top}${bot}Z`} fill={colour} opacity={0.13} />}
      <path d={line} fill="none" stroke={colour} strokeWidth={2.5} strokeLinecap="round" />
    </g>
  );
}

/**
 * The monochord: a string over two end bridges and a movable bridge, dragged (pointer: absolute; with
 * `fine`, slow drags move it finely, for the last cent) or moved with the keys. The part left of the
 * bridge wiggles while it sounds (half the string: twice as fast); `reference`: a second, whole string
 * above, sounding with it.
 */
function Monochord({ frac, onFrac, whole, part, marks, fine, reference, step }: {
  frac: number; onFrac: (f: number) => void; whole: boolean; part: boolean; marks: Mark[]; fine?: boolean; reference?: boolean; step: number;
}) {
  const t = useClock(1);
  const svg = useRef<SVGSVGElement | null>(null);
  const cur = useRef(frac);
  cur.current = frac;
  const drag = useRef<{ x: number; t: number; f: number; live: boolean; x0: number; cx: number; cy: number } | null>(null);
  const SY = reference ? 122 : 62;
  const RY = 46;
  const H = reference ? 170 : 110;
  const bx = SX0 + frac * SL;
  const toX = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    return ((clientX - r.left) / Math.max(1, r.width)) * 340;
  };
  const set = (f: number) => { const c = clampFrac(f); cur.current = c; onFrac(c); };
  // (a tap away from the bridge moves it there; on the bridge itself, a fine drag starts where it is)
  const jumpTo = (x: number) => { if (!fine || Math.abs(x - (SX0 + cur.current * SL)) > 22) set((x - SX0) / SL); };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const x = toX(e.clientX);
    // A finger may be starting to scroll the page: the bridge moves only once the finger goes
    // sideways (or on a tap); scrolling up or down cancels the pointer and leaves it where it was.
    const touch = e.pointerType === 'touch';
    if (!touch) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      jumpTo(x);
    }
    drag.current = { x, t: e.timeStamp, f: cur.current, live: !touch, x0: x, cx: e.clientX, cy: e.clientY };
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = toX(e.clientX);
    if (!d.live) {
      const dxPx = Math.abs(e.clientX - d.cx);
      if (dxPx < 4 || dxPx < Math.abs(e.clientY - d.cy)) return;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      jumpTo(d.x0);
      drag.current = { ...d, live: true, x: d.x0, t: e.timeStamp };
      return;
    }
    if (!fine) { set((x - SX0) / SL); return; }
    // slow hands, small steps: the speed sets how far the bridge follows the finger (1 : 1 when quick, 1 : 16 when slow)
    const dx = x - d.x;
    const v = Math.abs(dx) / Math.max(1, e.timeStamp - d.t);
    const gain = Math.min(1, Math.max(1 / 16, v / 0.15));
    drag.current = { ...d, x, t: e.timeStamp };
    set(cur.current + (dx * gain) / SL);
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    // A tap (a finger that never moved sideways) still moves the bridge there.
    if (d && !d.live && e.type === 'pointerup') jumpTo(d.x0);
  };
  const key = (e: React.KeyboardEvent) => {
    const big = e.shiftKey ? 10 : 1;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowDown') set(cur.current - step * big);
    else if (k === 'ArrowRight' || k === 'ArrowUp') set(cur.current + step * big);
    else if (k === 'PageDown') set(cur.current - step * 20);
    else if (k === 'PageUp') set(cur.current + step * 20);
    else if (k === 'Home') set(BRIDGE_MIN);
    else if (k === 'End') set(BRIDGE_MAX);
    else return;
    e.preventDefault();
  };
  const amp = 11;
  const showWhole = whole && !reference;
  return (
    <svg ref={svg} className="tun-svg tun-string" viewBox={`0 0 340 ${H}`} data-testid="tuning-string"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <title>{reference
        ? `Two strings: the whole string above; below, a bridge at ${fracWords(frac)}, the part left of it sounding.`
        : `A string with a movable bridge at ${fracWords(frac)}.`}</title>
      {reference && (
        <g>
          <text x={SX0} y={RY - 22} className="tun-label" fill="var(--muted)">Whole string</text>
          <Bridge x={SX0} y={RY} /><Bridge x={SX1} y={RY} />
          <Wiggle a={SX0} b={SX1} y={RY} amp={whole ? amp : 0} phase={t * WIGGLE} colour={whole ? 'var(--voice)' : 'var(--line-strong)'} />
          <text x={SX0} y={SY - 30} className="tun-label" fill="var(--muted)">With a bridge</text>
        </g>
      )}
      {marks.map((m) => {
        const x = SX0 + m.at * SL;
        return (
          <g key={m.label}>
            <line x1={x} x2={x} y1={SY - 24} y2={SY + 14} stroke="var(--good)" strokeWidth={2} strokeDasharray="3 3" />
            <text x={x + (m.anchor === 'end' ? 4 : m.anchor === 'start' ? -4 : 0)} y={SY - 29} textAnchor={m.anchor ?? 'middle'} className="tun-label" fontWeight={700} fill="var(--good)">{m.label}</text>
          </g>
        );
      })}
      <Bridge x={SX0} y={SY} /><Bridge x={SX1} y={SY} />
      {showWhole
        ? <Wiggle a={SX0} b={SX1} y={SY} amp={amp} phase={t * WIGGLE} colour="var(--voice)" />
        : (
          <>
            <Wiggle a={SX0} b={bx} y={SY} amp={part ? amp * Math.min(1, frac + 0.3) : 0} phase={(t * WIGGLE) / frac} colour={part ? 'var(--expert)' : 'var(--text)'} />
            <line x1={bx} x2={SX1} y1={SY} y2={SY} stroke="var(--line-strong)" strokeWidth={2.5} />
          </>
        )}
      <g className="tun-handle" role="slider" tabIndex={0} aria-label="Bridge" aria-orientation="horizontal" data-testid="tuning-bridge"
        aria-valuemin={BRIDGE_MIN} aria-valuemax={BRIDGE_MAX} aria-valuenow={Number(frac.toFixed(4))} aria-valuetext={`Bridge at ${fracWords(frac)}`}
        onKeyDown={key} opacity={showWhole ? 0.45 : 1}>
        <rect x={bx - 22} y={SY - 6} width={44} height={50} fill="transparent" />
        <circle className="tun-ring" cx={bx} cy={SY + 30} r={17} fill="none" stroke="var(--accent)" strokeWidth={2} />
        <path d={`M${bx} ${SY}L${bx - 8} ${SY + 17}H${bx + 8}Z`} fill="var(--accent)" />
        <circle cx={bx} cy={SY + 30} r={11} fill="var(--accent)" />
        <path d={`M${bx - 3} ${SY + 25}v10M${bx + 3} ${SY + 25}v10`} stroke="var(--accent-ink)" strokeWidth={1.5} strokeLinecap="round" />
      </g>
    </svg>
  );
}

function Bridge({ x, y }: { x: number; y: number }) {
  return <path d={`M${x} ${y}L${x - 7} ${y + 14}H${x + 7}Z`} fill="var(--line-strong)" />;
}

/** The labelled slider under the string (and a hair either way, with `nudge`). */
function BridgeSlider({ frac, onFrac, step, nudge }: { frac: number; onFrac: (f: number) => void; step: number; nudge?: boolean }) {
  const words = fracWords(frac);
  const input = (
    <input id="tun-bridge" type="range" min={BRIDGE_MIN} max={BRIDGE_MAX} step={step} value={frac} aria-valuetext={`Bridge at ${words}`}
      data-testid="tuning-bridge-slider" onChange={(e) => onFrac(clampFrac(Number(e.target.value)))} />
  );
  return (
    <div className="col tun-slider">
      <label className="row between t14" htmlFor="tun-bridge"><span>The bridge</span><span className="mono muted" aria-hidden="true">{words}</span></label>
      {nudge ? (
        <div className="row tun-nudge">
          <button className="btn icon" aria-label="Bridge a hair to the left" data-testid="tuning-nudge-left" onClick={() => onFrac(clampFrac(frac - step))}><IconBack size={18} /></button>
          {input}
          <button className="btn icon" aria-label="Bridge a hair to the right" data-testid="tuning-nudge-right" onClick={() => onFrac(clampFrac(frac + step))}><IconChevron size={18} /></button>
        </div>
      ) : input}
    </div>
  );
}

// ---------- 1. The string ----------

/** Near enough to count as found by ear on the first page (a fraction of the string: about 30–40 cents). */
const FIND_TOL = 0.012;
const MARKS: Record<StringTarget, Mark> = {
  octave: { at: 0.5, label: '½', anchor: 'end' },
  fifth: { at: 2 / 3, label: '⅔', anchor: 'start' },
};

function StringPage() {
  const s = useSound();
  const [frac, setFrac] = useState(0.84);
  const [found, setFound] = useState<Record<StringTarget, boolean>>({ octave: false, fifth: false });
  const [showAll, setShowAll] = useState(false);
  const hz = partHz(OPEN_HZ, frac);
  useEffect(() => { if (s.playing === 'part') s.retune({ part: hz }); }, [hz]); // eslint-disable-line react-hooks/exhaustive-deps
  // resting near a spot finds it (and the bridge settles onto it, the first time)
  useEffect(() => {
    const t = (['octave', 'fifth'] as const).find((k) => Math.abs(frac - TARGETS[k].frac) <= FIND_TOL);
    if (!t || found[t]) return;
    const id = window.setTimeout(() => { setFound((f) => ({ ...f, [t]: true })); setFrac(TARGETS[t].frac); }, 600);
    return () => clearTimeout(id);
  }, [frac, found]);
  const showMe = () => {
    setShowAll(true);
    setFrac(Math.abs(frac - 0.5) < 0.001 ? 2 / 3 : 0.5);
  };
  const marks = (['octave', 'fifth'] as const).filter((k) => found[k] || showAll).map((k) => MARKS[k]);
  return (
    <PageBody n={1} figure={<>
      <Monochord frac={frac} onFrac={setFrac} whole={s.playing === 'whole'} part={s.playing === 'part'} marks={marks} step={0.005} />
      <BridgeSlider frac={frac} onFrac={setFrac} step={0.001} />
      <div className="row tun-pair">
        <SoundButton id="whole" playing={s.playing} onClick={() => s.toggle('whole', { whole: OPEN_HZ }, 2500)} title="Whole string" sub="pluck" testid="tuning-whole" />
        <SoundButton id="part" playing={s.playing} onClick={() => s.toggle('part', { part: hz })} title="Left part" sub="then drag" testid="tuning-part" />
      </div>
      <Tasks items={[
        { id: 'octave', label: found.octave ? 'The same note, higher: at ½' : 'The same note, higher', done: found.octave },
        { id: 'fifth', label: found.fifth ? 'A fifth: at ⅔' : 'A fifth', done: found.fifth },
      ]} />
      {!(found.octave && found.fifth) && <button className="link tun-showme" data-testid="tuning-showme" onClick={showMe}>Show me</button>}
    </>}>
      <p className="t16">Imagine plucking or bowing a string: it vibrates, and you hear a note. Every string instrument works like this, and your voice does too: your vocal folds vibrate the same way.</p>
      <p className="t16">Now press the string down somewhere along it, like a violinist’s finger. Only part of it can vibrate, and the note goes up. Try it: drag the bridge, then play the whole string and the part left of the bridge.</p>
      <p className="t16 tun-ask">Where does it become the same note, higher? Where do you hear a fifth?</p>
    </PageBody>
  );
}

// ---------- 2. Why? The waves ----------

type Fit = 'octave' | 'fifth';
const FIT: Record<Fit, { ratio: number; label: string; part: string; repeat: number }> = {
  octave: { ratio: 2, label: '2 : 1', part: 'Half the string', repeat: 1 },
  fifth: { ratio: 1.5, label: '3 : 2', part: 'Two thirds', repeat: 2 },
};

function WavesPage() {
  const s = useSound();
  const [which, setWhich] = useState<Fit>('octave');
  const play = (w: Fit) => {
    setWhich(w);
    s.toggle(w, { lo: OPEN_HZ, [w]: OPEN_HZ * FIT[w].ratio }, 6000);
  };
  return (
    <PageBody n={2} figure={<>
      <FitWaves which={which} />
      <div className="row tun-pair">
        <SoundButton id="octave" playing={s.playing} onClick={() => play('octave')} title="Octave · 2 : 1" sub="half the string" testid="tuning-octave" />
        <SoundButton id="fifth" playing={s.playing} onClick={() => play('fifth')} title="Fifth · 3 : 2" sub="two thirds" testid="tuning-fifth" />
      </div>
    </>} after={<>
      <p className="t16 tun-callout">Intervals in such simple whole-number ratios are called <strong>just</strong>. Tuning by them is <strong>just intonation</strong>.</p>
    </>}>
      <p className="t16">Every note is a wave.</p>
      <p className="t16">Half the string: the wave goes up and down <strong>twice as often</strong>. 2 : 1, the octave.</p>
      <p className="t16">Two thirds: <strong>3 times for every 2</strong>. 3 : 2, the fifth.</p>
      <p className="t16">The waves line up again and again, so the two notes blend.</p>
    </PageBody>
  );
}

/** The whole string, the part and both together, scrolling slowly; dashed lines where the pattern repeats. */
function FitWaves({ which }: { which: Fit }) {
  const u = useClock(0.3);
  const { ratio, repeat, label, part } = FIT[which];
  const K = 4; // low-note cycles shown
  const X0 = 8, W = 324;
  const x = (s: number) => X0 + (s / K) * W;
  const path = (y0: number, amp: number, f: (s: number) => number) => {
    let d = '';
    for (let i = 0; i <= 240; i++) {
      const s = (i / 240) * K;
      d += `${i ? 'L' : 'M'}${x(s).toFixed(1)} ${(y0 - amp * f(s)).toFixed(1)}`;
    }
    return d;
  };
  const lo = (s: number) => Math.sin(2 * Math.PI * (s + u));
  const hi = (s: number) => Math.sin(2 * Math.PI * ratio * (s + u));
  // (the pattern repeats every `repeat` low cycles: where (s + u) is a multiple of it)
  const marks: { k: number; at: number }[] = [];
  for (let k = Math.ceil(u / repeat); k * repeat - u <= K; k++) marks.push({ k, at: k * repeat - u });
  return (
    <svg className="tun-svg" viewBox="0 0 340 236" role="img" data-testid="tuning-waves"
      aria-label={`The whole string’s wave, the wave of ${part.toLowerCase()} (${label}) and both together: they line up in a pattern that repeats every ${repeat === 1 ? 'wave' : `${repeat} waves`} of the whole string.`}>
      {marks.map((m) => <line key={m.k} x1={x(m.at)} x2={x(m.at)} y1={22} y2={232} stroke="var(--line-strong)" strokeDasharray="4 4" />)}
      <text x={X0} y={16} className="tun-label" fill="var(--voice)">Whole string</text>
      <path d={path(48, 20, lo)} fill="none" stroke="var(--voice)" strokeWidth={2} />
      <text x={X0} y={88} className="tun-label" fill="var(--expert)">{part} · {label}</text>
      <path d={path(120, 20, hi)} fill="none" stroke="var(--expert)" strokeWidth={2} />
      <text x={X0} y={162} className="tun-label" fill="var(--text)">Both together</text>
      <path d={path(198, 15, (s) => lo(s) + hi(s))} fill="none" stroke="var(--text)" strokeWidth={2} />
    </svg>
  );
}

// ---------- 3. Find them yourself ----------

/** Held within this many cents for HOLD_MS ticks a task. */
const HOLD_CENTS = 3;
const HOLD_MS = 1000;
/** Fine steps of the bridge on this page (a fraction of the string: about 1.3–1.7 cents). */
const FINE = 0.0005;

function FindPage() {
  const s = useSound();
  const [frac, setFrac] = useState(0.8);
  const [done, setDone] = useState<Record<StringTarget, boolean>>({ octave: false, fifth: false });
  const near = nearestTarget(frac);
  const b = stringBeat(OPEN_HZ, frac, near.target);
  const tones = (): Tones => ({ whole: OPEN_HZ, part: partHz(OPEN_HZ, frac) });
  useEffect(() => { s.retune(tones()); }, [frac]); // eslint-disable-line react-hooks/exhaustive-deps
  const within = Math.abs(near.off) <= HOLD_CENTS;
  useEffect(() => {
    if (!within || done[near.target]) return;
    const id = window.setTimeout(() => setDone((d) => ({ ...d, [near.target]: true })), HOLD_MS);
    return () => clearTimeout(id);
  }, [within, near.target, done]);
  const label = wobbleLabel(b);
  const rate = b > 12 ? 'Rough: too fast to count' : label === 'still' ? 'Still' : cap(label);
  const marks = (['octave', 'fifth'] as const).map((k) => MARKS[k]);
  return (
    <PageBody n={3} figure={<>
      <Monochord frac={frac} onFrac={setFrac} whole={s.playing === 'both'} part={s.playing === 'both'} marks={marks} fine reference step={FINE} />
      <div className="col tun-readout">
        <span className="t14 muted" data-testid="tuning-near">Near the {near.target}</span>
        <strong className="tun-rate" aria-live="polite" data-testid="tuning-rate">{rate}</strong>
      </div>
      <PulseView rate={Math.min(b, 12)} />
      <BridgeSlider frac={frac} onFrac={setFrac} step={FINE} nudge />
      <div className="row tun-pair">
        <SoundButton id="both" playing={s.playing} onClick={() => s.toggle('both', tones())} title="Play both strings" sub="then drag slowly" testid="tuning-find-play" />
      </div>
      <Tasks items={[
        { id: 'octave', label: done.octave ? 'The octave: still' : 'Make the octave still', done: done.octave },
        { id: 'fifth', label: done.fifth ? 'The fifth: still' : 'Make the fifth still', done: done.fifth },
      ]} />
    </>} after={done.octave && done.fifth ? <p className="t16 tun-callout" data-testid="tuning-found-both">Both found by ear: a just octave and a just fifth.</p> : undefined}>
      <p className="t16">The whole string keeps sounding. Drag the bridge slowly.</p>
      <p className="t16">Off the spot you hear a wah-wah-wah: a <strong>wobble</strong>, or <strong>beat</strong>. The two notes beat against each other. The further off, the faster the beats. On the spot the beating stops.</p>
      <p className="t16">Find where it goes <strong>still</strong>: first the octave, then the fifth.</p>
    </PageBody>
  );
}

/** Loudness over the last two seconds at the real rate of the beats, newest on the right, and a dot that swells with it. */
function PulseView({ rate }: { rate: number }) {
  const phase = useClock(rate);
  const depth = Math.min(1, rate / 0.6) * 0.9;
  const env = (ph: number) => 1 - depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * ph));
  const SPAN = 2, X0 = 4, W = 296, MID = 52, A = 40;
  let top = '', bot = '';
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * SPAN - SPAN; // seconds before now
    const e = env(phase + rate * t);
    const xx = (X0 + (i / 200) * W).toFixed(1);
    top += `${i ? 'L' : 'M'}${xx} ${(MID - A * e).toFixed(1)}`;
    bot = `L${xx} ${(MID + A * e).toFixed(1)}` + bot;
  }
  const now = env(phase);
  return (
    <svg className="tun-svg" viewBox="0 0 340 116" role="img" data-testid="tuning-pulse"
      aria-label={`How loud the sound is over the last two seconds: ${wobbleLabel(rate)}.`}>
      <line x1={X0} x2={X0 + W} y1={MID} y2={MID} stroke="var(--line)" />
      <path d={`${top}${bot}Z`} fill="var(--voice)" opacity={0.35} />
      <path d={top} fill="none" stroke="var(--voice)" strokeWidth={2} />
      <circle cx={322} cy={MID} r={4 + 12 * now} fill="var(--voice)" />
      <text x={X0} y={112} className="tun-label" fill="var(--muted)">2 seconds ago</text>
      <text x={336} y={112} textAnchor="end" className="tun-label" fill="var(--muted)">now</text>
    </svg>
  );
}

// ---------- 4. The big question ----------

function QuestionPage() {
  const s = useSound();
  const [shown, setShown] = useState(false);
  return (
    <PageBody n={4} figure={<>
      <div className="col tun-pair">
        <SoundButton id="just" playing={s.playing} testid="tuning-just-fifth" title="Your just fifth" sub="3 : 2, as on the string"
          onClick={() => s.toggle('just', { do: OPEN_HZ, sol: OPEN_HZ * 1.5 }, 5000)} />
        <SoundButton id="piano" playing={s.playing} testid="tuning-piano-fifth" title="The piano’s fifth" sub="700 cents"
          onClick={() => s.toggle('piano', { do: OPEN_HZ, sol: OPEN_HZ * centsToRatio(PIANO.fifth) }, 5000)} />
      </div>
      {!shown
        ? <button className="btn voice tun-tap" data-testid="tuning-reveal" onClick={() => setShown(true)}>Show the answer</button>
        : (
          <div className="col tun-answer" data-testid="tuning-answer" aria-live="polite">
            <div className="tun-fact"><strong>The octave</strong><span>Exactly the same: half the string.</span></div>
            <div className="tun-fact"><strong>The fifth</strong><span>A hair apart: the piano’s is <b>700 cents</b>, the just one <b>702</b>.</span></div>
            <StringZoom />
            <p className="t14 muted">Cents: 100 from one piano key to the next.</p>
          </div>
        )}
    </>}>
      <p className="tun-question">Is that the same octave and the same fifth the piano plays?</p>
    </PageBody>
  );
}

/** The string with ½ and ⅔ marked, and a magnifier on ⅔: the piano's fifth sits at 0.6674, a hair right of 0.6667. */
function StringZoom() {
  const SY = 34;
  const x = (f: number) => SX0 + f * SL;
  // the magnified window: 0.6650 to 0.6690 of the string across the whole width
  const Z0 = 0.665, Z1 = 0.669, ZY = 132;
  const zx = (f: number) => SX0 + ((f - Z0) / (Z1 - Z0)) * SL;
  const bx0 = x(Z0) - 4, bx1 = x(Z1) + 4;
  const zoom = Math.round(1 / (Z1 - Z0));
  return (
    <svg className="tun-svg" viewBox="0 0 340 180" role="img" data-testid="tuning-zoom"
      aria-label="On the string the octave is half the string, on the piano too. The just fifth sits at two thirds (0.6667); the piano’s fifth at 0.6674, a hair to the right.">
      <Bridge x={SX0} y={SY} /><Bridge x={SX1} y={SY} />
      <line x1={SX0} x2={SX1} y1={SY} y2={SY} stroke="var(--text)" strokeWidth={2} />
      <line x1={x(0.5)} x2={x(0.5)} y1={SY - 16} y2={SY + 10} stroke="var(--good)" strokeWidth={2} />
      <text x={x(0.5) - 4} y={SY - 20} textAnchor="end" className="tun-label" fontWeight={700} fill="var(--good)">½ both</text>
      <rect x={bx0} y={SY - 12} width={bx1 - bx0} height={24} rx={4} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
      <text x={bx1 + 4} y={SY - 16} className="tun-label" fontWeight={700} fill="var(--accent-text)">⅔</text>
      <path d={`M${bx0} ${SY + 12}L${SX0} ${ZY - 30}M${bx1} ${SY + 12}L${SX1} ${ZY - 30}`} stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" fill="none" />
      <rect x={SX0 - 6} y={ZY - 30} width={SL + 12} height={64} rx={8} fill="var(--surface-2)" stroke="var(--accent)" strokeWidth={1.5} />
      <line x1={SX0} x2={SX1} y1={ZY} y2={ZY} stroke="var(--text)" strokeWidth={2} />
      <line x1={zx(2 / 3)} x2={zx(2 / 3)} y1={ZY - 22} y2={ZY + 12} stroke="var(--good)" strokeWidth={3} />
      <text x={zx(2 / 3) - 6} y={ZY - 10} textAnchor="end" className="tun-label" fontWeight={700} fill="var(--good)">just 0.6667</text>
      <line x1={zx(PIANO_FIFTH_FRAC)} x2={zx(PIANO_FIFTH_FRAC)} y1={ZY - 22} y2={ZY + 12} stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 3" />
      <text x={zx(PIANO_FIFTH_FRAC) + 6} y={ZY - 10} className="tun-label" fill="var(--muted)">piano {PIANO_FIFTH_FRAC.toFixed(4)}</text>
      <text x={SX0} y={ZY + 46} className="tun-label" fill="var(--muted)">{zoom}× closer</text>
    </svg>
  );
}

// ---------- 5–7. So why not make every interval just? (the comma, by hand) ----------

const C3 = 130.81;
const C4 = 2 * C3;
/** Degrees of the circle per cent of drift: to scale, as on a clock face of the octave (1200 cents = 360°: the comma ≈ 7°). */
const DEG_PER_CENT = 360 / 1200;

/**
 * The circle of fifths from C as a slow spiral (each turn a little further in: octaves up). `steps`
 * fifths walked (fractional while it glides), each `extra` cents wider than the piano's. With `gap`,
 * the overshoot past C after twelve is drawn as an open wedge.
 */
function FifthsCircle({ steps, extra, gap, label, children }: { steps: number; extra: number; gap?: boolean; label: string; children?: React.ReactNode }) {
  const C = 160, R0 = 116, shrink = 2.5;
  const ang = (s: number) => 30 * s + DEG_PER_CENT * extra * s;
  const pt = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
  };
  const f = (n: number) => n.toFixed(1);
  let d = '';
  for (let i = 0; i <= 144; i++) {
    const st = (i / 144) * steps;
    const [px, py] = pt(ang(st), R0 - shrink * st);
    d += `${i ? 'L' : 'M'}${f(px)} ${f(py)}`;
  }
  const lit = Math.floor(steps + 0.001);
  const [nx, ny] = pt(ang(steps), R0 - shrink * steps - 26);
  const [hx, hy] = pt(ang(steps), R0 - shrink * steps);
  const wedgeTo = 360 + 12 * extra * DEG_PER_CENT;
  const showGap = gap && steps >= 11.99 && extra > 0.02;
  const [w1x, w1y] = pt(360, R0 + 8), [w2x, w2y] = pt(wedgeTo, R0 + 8);
  const [rx0, ry0] = pt(0, R0 - 40), [rx1, ry1] = pt(0, R0 + 12);
  return (
    <svg className="tun-svg tun-circle" viewBox="0 0 320 320" role="img" aria-label={label} data-testid="tuning-circle">
      <circle cx={C} cy={C} r={R0 + 8} fill="none" stroke="var(--line)" />
      {showGap && <path d={`M${C} ${C}L${f(w1x)} ${f(w1y)}A${R0 + 8} ${R0 + 8} 0 0 1 ${f(w2x)} ${f(w2y)}Z`} fill="var(--accent)" opacity={0.22} />}
      {showGap && <path d={`M${f(w1x)} ${f(w1y)}A${R0 + 8} ${R0 + 8} 0 0 1 ${f(w2x)} ${f(w2y)}`} fill="none" stroke="var(--accent)" strokeWidth={5} strokeLinecap="round" />}
      {FIFTHS_FROM_C.slice(0, 12).map((nm, i) => {
        const on = i <= lit || (i === 0 && lit >= 12);
        const [tx, ty] = pt(30 * i, R0 + 26);
        const [a1, b1] = pt(30 * i, R0 + 3), [a2, b2] = pt(30 * i, R0 + 13);
        return (
          <g key={nm}>
            <line x1={a1} y1={b1} x2={a2} y2={b2} stroke={on ? 'var(--voice)' : 'var(--muted)'} strokeWidth={on ? 2.5 : 1.5} />
            <text x={tx} y={ty + 5} textAnchor="middle" className="tun-label" fontWeight={on ? 800 : 400} fill={on ? 'var(--voice)' : 'var(--muted)'}>{nm}</text>
          </g>
        );
      })}
      <line x1={rx0} y1={ry0} x2={rx1} y2={ry1} stroke="var(--line-strong)" strokeDasharray="3 4" />
      {steps > 0 && <path d={d} fill="none" stroke="var(--voice)" strokeWidth={2.5} strokeLinecap="round" />}
      {Array.from({ length: lit + 1 }, (_, i) => {
        const [px, py] = pt(ang(i), R0 - shrink * i);
        return <circle key={i} cx={px} cy={py} r={3.5} fill="var(--voice)" />;
      })}
      <line x1={nx} y1={ny} x2={hx} y2={hy} stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={hx} cy={hy} r={6} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
      {children}
    </svg>
  );
}

/** Centre words of the circle: a big line and a small one. */
function Centre({ big, small, tone = 'var(--text)' }: { big: string; small?: string; tone?: string }) {
  return (
    <>
      <text x={160} y={small ? 158 : 168} textAnchor="middle" className="tun-big" fill={tone}>{big}</text>
      {small && <text x={160} y={184} textAnchor="middle" className="tun-label" fill="var(--muted)">{small}</text>}
    </>
  );
}

/** Twelve fifths up from C, one tap at a time; each tap plays the fifth it adds. `just`: 702 cents, else the piano's 700. */
function useFifthWalk(just: boolean) {
  const s = useSound();
  const [k, setK] = useState(0);
  const shown = useTween(k, 450);
  const ratio = just ? 1.5 : centsToRatio(700);
  const add = () => {
    if (k >= 12) { setK(0); s.stop(); return; }
    const nk = k + 1;
    setK(nk);
    const lo = foldInto(C3 * ratio ** (nk - 1), C3);
    void s.start('step', { lo, hi: lo * ratio }, 1400);
  };
  const bothCs = () => s.toggle('cs', { c: C4, c2: C4 * (just ? STACKED_C : 1.0000001) }, 8000);
  return { s, k, shown, add, bothCs };
}

function PianoFifthsPage() {
  const w = useFifthWalk(false);
  const done = w.k >= 12;
  return (
    <PageBody n={5} figure={<>
      <FifthsCircle steps={w.shown} extra={0} label={done ? 'Twelve piano fifths from C land exactly on C again, seven octaves up: the circle closes.' : `${w.k} of 12 fifths up from C.`}>
        {w.k === 0 ? <Centre big="C" small="start here" />
          : done ? <Centre big="C again" small="7 octaves up · it closes" tone="var(--good)" />
            : <Centre big={FIFTHS_FROM_C[w.k]} small={`fifth ${w.k} of 12`} />}
      </FifthsCircle>
      <div className="row tun-pair">
        <button className="btn voice grow tun-tap" data-testid="tuning-add-fifth" onClick={w.add}>{done ? 'Start again' : '+ a fifth'}</button>
        {done && <SoundButton id="cs" playing={w.s.playing} onClick={w.bothCs} title="Play both Cs" sub="the same note" testid="tuning-both-cs" />}
      </div>
      <span className="t14 muted center" aria-live="polite">{done ? 'Back on C, 7 octaves up. Piano fifths close the circle exactly.' : `${12 - w.k} to go · each tap plays the fifth`}</span>
    </>}>
      <p className="t16 tun-ask">Go up a fifth 12 times from C. Where do you land?</p>
      <p className="t16">Tap to find out. First with the piano’s fifths: 700 cents each.</p>
    </PageBody>
  );
}

function JustFifthsPage() {
  const w = useFifthWalk(true);
  const done = w.k >= 12;
  const drift = fifthDrift(w.k);
  return (
    <PageBody n={6} figure={<>
      <FifthsCircle steps={w.shown} extra={JUST.fifth - 700} gap label={done
        ? `Twelve just fifths from C overshoot C by ${oneDecimal(COMMA)} cents: the circle doesn't close. That gap is the Pythagorean comma.`
        : `${w.k} of 12 just fifths up from C: ${oneDecimal(drift)} cents above the piano's.`}>
        {w.k === 0 ? <Centre big="C" small="start here" />
          : done ? <Centre big={`${oneDecimal(COMMA)} cents`} small="too far: the comma" tone="var(--accent-text)" />
            : <Centre big={`+${oneDecimal(drift)}`} small={`cents · ${FIFTHS_FROM_C[w.k]}, fifth ${w.k}`} tone="var(--accent-text)" />}
      </FifthsCircle>
      <div className="row tun-pair">
        <button className="btn voice grow tun-tap" data-testid="tuning-add-fifth" onClick={w.add}>{done ? 'Start again' : '+ a just fifth'}</button>
        {done && <SoundButton id="cs" playing={w.s.playing} onClick={w.bothCs} title="Play both Cs" sub="hear them beat" testid="tuning-both-cs" />}
      </div>
      <span className="t14 muted center" aria-live="polite">{done ? 'The gap is the Pythagorean comma. Your C and the stacked C beat against each other.' : 'Watch the needle drift: about 2 cents a tap.'}</span>
    </>}>
      <p className="t16 tun-ask">Each just fifth is 702 cents: 2 more than the piano’s.</p>
      <p className="t16">Tap 12 times. Where do you land now?</p>
    </PageBody>
  );
}

function ShareOutPage() {
  const s = useSound();
  const [shared, setShared] = useState(false);
  const t = useTween(shared ? 1 : 0, 1800);
  const extra = (JUST.fifth - 700) * (1 - t);
  const fifth = (): Tones => ({ do: C4, sol: C4 * centsToRatio(700 + extra) });
  useEffect(() => { if (s.playing === 'fifth') s.retune(fifth()); }, [extra]); // eslint-disable-line react-hooks/exhaustive-deps
  const closed = t > 0.995;
  return (
    <PageBody n={7} figure={<>
      <FifthsCircle steps={12} extra={extra} gap label={closed ? 'The comma shared out: every fifth 2 cents narrow, and the circle closes.' : `Twelve fifths of ${oneDecimal(700 + extra)} cents: ${oneDecimal(12 * extra)} cents past C.`}>
        {closed ? <Centre big="It closes" small="every fifth 700 cents" tone="var(--good)" />
          : <Centre big={`${oneDecimal(12 * extra)} cents`} small="left over" tone="var(--accent-text)" />}
      </FifthsCircle>
      <span className="t16 center mono" data-testid="tuning-each-fifth">Each fifth: {(700 + extra).toFixed(1)} cents</span>
      <div className="row tun-pair">
        <button className="btn voice grow tun-tap" data-testid="tuning-share" onClick={() => setShared(!shared)}>{shared ? 'Back to just fifths' : 'Share it out'}</button>
        <SoundButton id="fifth" playing={s.playing} onClick={() => s.toggle('fifth', fifth())} title="Play a fifth" sub="almost still" testid="tuning-share-fifth" />
      </div>
      <div className="row tun-pair">
        <SoundButton id="chord" playing={s.playing} onClick={() => s.toggle('chord', { do: C4, mi: C4 * centsToRatio(400), sol: C4 * centsToRatio(700) }, 6000)}
          title="The piano’s major chord" sub="its third shimmers" testid="tuning-share-chord" />
      </div>
      {closed && (
        <p className="t16 tun-callout tun-et" data-testid="tuning-et">
          When this difference is distributed equally, it is called <strong>equal temperament</strong>. Every octave is 1200 cents, every fifth is 700 cents, every major third is 400 cents.
        </p>
      )}
    </>} after={closed ? <>
      <p className="t16">That’s how pianos are tuned. Every key works, but the piano and most modern instruments are a little out of tune everywhere.</p>
      <p className="t16">The thirds pay most: 13.7 cents too wide, so they shimmer.</p>
    </> : undefined}>
      <p className="t16 tun-ask">For the octaves to add up, that extra has to go somewhere.</p>
      <p className="t16">Tap “Share it out”.</p>
    </PageBody>
  );
}

// ---------- 8. Choirs have a luxury ----------

const GAP3 = PIANO.third - JUST.third; // 13.7

function ChoirPage() {
  const s = useSound();
  // how far below the piano's third mi sits: 0 (the piano) to 13.7 (just)
  const [low, setLow] = useState(0);
  const [glide, setGlide] = useState<number | null>(null);
  const shown = useTween(glide ?? low, 1400);
  const value = glide == null ? low : shown;
  useEffect(() => {
    if (glide == null) return;
    if (Math.abs(shown - glide) < 0.05) { setLow(glide); setGlide(null); }
  }, [shown, glide]);
  const miHz = ROOT * centsToRatio(PIANO.third - value);
  const chord = (): Tones => ({ do: ROOT, mi: miHz, sol: ROOT * 1.5 });
  useEffect(() => { s.retune(chord()); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = beatRate(ROOT, miHz, [5, 4]);
  const atJust = value >= GAP3 - 0.05;
  const words = value < 0.05 ? 'the piano’s third' : atJust ? `just third: ${oneDecimal(GAP3)} cents below the piano` : `${oneDecimal(value)} cents below the piano`;
  return (
    <PageBody n={8} figure={<>
      <PulseView rate={b} />
      <strong className="tun-rate" aria-live="polite" data-testid="tuning-chord-rate">{wobbleLabel(b) === 'still' ? 'Still: the chord rings' : cap(wobbleLabel(b))}</strong>
      <label className="col tun-slider" htmlFor="tun-third">
        <span className="row between t14"><span>The third (mi)</span><span className="mono" aria-hidden="true">{value < 0.05 ? 'piano' : `−${oneDecimal(value)} cents`}</span></span>
        <input id="tun-third" type="range" min={0} max={Number(GAP3.toFixed(1))} step={0.1} value={Number(value.toFixed(1))} aria-valuetext={words} data-testid="tuning-third-slider"
          onChange={(e) => { setGlide(null); setLow(Number(e.target.value)); }} />
        <span className="row between t14 muted" aria-hidden="true"><span>piano</span><span>just</span></span>
      </label>
      <div className="row tun-pair">
        <SoundButton id="chord" playing={s.playing} onClick={() => s.toggle('chord', chord())} title="Play" sub="the chord" testid="tuning-chord" />
        <button className="btn tun-reset" data-testid="tuning-make-just" onClick={() => setGlide(atJust ? 0 : GAP3)}>{atJust ? 'Back to the piano' : 'Make it just'}</button>
      </div>
    </>} after={<>
      <table className="tun-table" aria-label="Just intervals, against the piano">
        <thead><tr><th scope="col">In a chord</th><th scope="col">Against the piano</th></tr></thead>
        <tbody>
          <tr><th scope="row">Major third</th><td>about 14 cents lower</td></tr>
          <tr><th scope="row">Fifth</th><td>a hair higher (2 cents)</td></tr>
          <tr><th scope="row">Minor third</th><td>about 16 cents higher</td></tr>
        </tbody>
      </table>
      <p className="t14 muted">It’s the note’s place in the chord that counts, not its name: an E sits lower in C major (the third) than in E major (the root).</p>
    </>}>
      <p className="t16 tun-ask">Choirs don’t have fixed keys.</p>
      <p className="t16">We can tune every chord on its own, so every interval in it can be just, and the chord rings. Make the third just and hear the shimmer stop.</p>
    </PageBody>
  );
}

// ---------- 9. Hear a cadence ----------

type Version = 'equal' | 'just';
const VERSION_NAME: Record<Version, string> = { equal: 'Piano', just: 'Choir' };
const CADENCE_MIDI = CADENCE.map((c) => c.notes);

/** The cadence played on the ChordPlayer: which version and chord sound now (for the highlight). */
function useCadence() {
  const ref = useRef<ChordPlayer | null>(null);
  const alive = useRef(true);
  const timers = useRef<number[]>([]);
  const [playing, setPlaying] = useState<Version | 'both' | null>(null);
  const [now, setNow] = useState<{ v: Version; i: number } | null>(null);
  const clear = () => { timers.current.forEach((t) => clearTimeout(t)); timers.current = []; };
  const stop = () => { clear(); ref.current?.stop(); setPlaying(null); setNow(null); };
  useOnHidden(stop);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clear(); ref.current?.dispose(); ref.current = null; };
  }, []);
  const play = async (which: Version | 'both') => {
    if (playing === which) { stop(); return; }
    await unlockAudio();
    if (!alive.current) return;
    const ctx = getAudioContext();
    if (!ref.current) ref.current = new ChordPlayer(ctx);
    clear();
    ref.current.stop();
    setPlaying(which);
    let at = ctx.currentTime + 0.12;
    const at0 = ctx.currentTime;
    const ms = (t: number) => Math.max(0, (t - at0) * 1000);
    for (const v of which === 'both' ? (['equal', 'just'] as const) : [which]) {
      const r = ref.current.play(cadenceHz(v), CADENCE_MIDI, at);
      r.starts.forEach((st, i) => timers.current.push(window.setTimeout(() => setNow({ v, i }), ms(st))));
      at = r.end + 0.5;
    }
    timers.current.push(window.setTimeout(() => { setPlaying(null); setNow(null); }, ms(at - 0.5)));
  };
  return { playing, now, play };
}

function CadencePage() {
  const c = useCadence();
  const ids = (v: Version | 'both') => (c.playing === v ? v : null);
  return (
    <PageBody n={9} figure={<>
      <GrandStaff active={c.now?.i ?? null} />
      <span className="t14 muted center tun-now" aria-live="polite" data-testid="tuning-cadence-now">
        {c.now ? `${VERSION_NAME[c.now.v]}: ${CADENCE[c.now.i].name} (${CADENCE[c.now.i].key} major)` : 'I · IV · V · I in C major'}
      </span>
      <div className="col tun-pair">
        <SoundButton id="equal" playing={ids('equal')} onClick={() => void c.play('equal')} title="Piano: equal temperament" sub="every note at its piano pitch" testid="tuning-cadence-equal" />
        <SoundButton id="just" playing={ids('just')} onClick={() => void c.play('just')} title="Choir: just intonation" sub="each chord tuned on its own" testid="tuning-cadence-just" />
        <SoundButton id="both" playing={ids('both')} onClick={() => void c.play('both')} title="Both, one after the other" sub="piano first" testid="tuning-cadence-both" />
      </div>
    </>}>
      <p className="t16">Four chords, I–IV–V–I. Listen to the thirds: on the piano they shimmer; tuned just, each chord rings still.</p>
      <p className="t16">A choir retunes every chord as it goes. A piano can’t.</p>
    </PageBody>
  );
}

/** I–IV–V–I as whole notes on a grand staff, the chord that sounds lit. */
function GrandStaff({ active }: { active: number | null }) {
  const SP = 9;
  const TOP = 22; // the treble staff's top line (F5)
  const BTOP = TOP + 4 * SP + 6 * SP; // the bass staff's top line (A3)
  // diatonic steps from C0: E4 30 … F5 38 on the treble staff, G2 18 … A3 26 on the bass staff
  const step = (m: number) => { const pc = m % 12; return (Math.floor(m / 12) - 1) * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][pc]; };
  const y = (m: number, treble: boolean) => (treble ? TOP + (38 - step(m)) * (SP / 2) : BTOP + (26 - step(m)) * (SP / 2));
  const X0 = 6, X1 = 334, COL0 = 64, COL = (X1 - COL0) / 4;
  const k = SP / GLYPH_UNITS_PER_SPACE;
  const lines = (top: number) => [0, 1, 2, 3, 4].map((i) => top + i * SP);
  const bottom = BTOP + 4 * SP;
  return (
    <svg className="tun-svg tun-staff" viewBox={`0 0 340 ${bottom + 52}`} role="img" data-testid="tuning-staff"
      aria-label="A cadence in C major on a grand staff, four chords in whole notes: I (C), IV (F), V (G), I (C).">
      {CADENCE.map((c, i) => (
        <rect key={`hl${i}`} className="tun-hl" x={COL0 + i * COL + 3} y={TOP - 14} width={COL - 6} height={bottom - TOP + 60} rx={8}
          fill="var(--accent)" opacity={active === i ? 0.16 : 0} />
      ))}
      {[...lines(TOP), ...lines(BTOP)].map((ly) => <line key={ly} x1={X0} x2={X1} y1={ly} y2={ly} stroke="var(--muted)" strokeWidth={1} opacity={0.75} />)}
      <line x1={X0} x2={X0} y1={TOP} y2={bottom} stroke="var(--muted)" strokeWidth={1.5} />
      {[1, 2, 3].map((i) => <line key={`bar${i}`} x1={COL0 + i * COL} x2={COL0 + i * COL} y1={TOP} y2={bottom} stroke="var(--muted)" strokeWidth={1} opacity={0.75} />)}
      <line x1={X1} x2={X1} y1={TOP} y2={bottom} stroke="var(--muted)" strokeWidth={1} />
      <line x1={X1 - 4} x2={X1 - 4} y1={TOP} y2={bottom} stroke="var(--muted)" strokeWidth={1} />
      <path d={G_CLEF} fill="var(--text)" transform={`translate(${X0 + 6} ${TOP + 3 * SP}) scale(${k} ${-k})`} />
      <path d={F_CLEF} fill="var(--text)" transform={`translate(${X0 + 6} ${BTOP + SP}) scale(${k} ${-k})`} />
      {CADENCE.map((c, i) => {
        const cx = COL0 + (i + 0.5) * COL;
        const on = active === i;
        const colour = on ? 'var(--accent)' : 'var(--text)';
        return (
          <g key={i} data-testid={`tuning-chord-${i + 1}`} data-on={on}>
            {c.notes.map((m, v) => {
              const cy = y(m, v >= 2);
              return (
                <g key={v}>
                  <ellipse cx={cx} cy={cy} rx={0.78 * SP} ry={0.5 * SP} fill={colour} />
                  <ellipse cx={cx} cy={cy} rx={0.36 * SP} ry={0.24 * SP} transform={`rotate(-50 ${cx} ${cy})`} fill="var(--surface)" />
                </g>
              );
            })}
            <text x={cx} y={bottom + 26} textAnchor="middle" className="tun-big" fill={on ? 'var(--accent-text)' : 'var(--text)'}>{c.name}</text>
            <text x={cx} y={bottom + 44} textAnchor="middle" className="tun-label" fill="var(--muted)">{c.key}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- 10. What matters most ----------

const WHY: Record<LabInterval, { rank: number; why: string; go: string }> = {
  fifth: { rank: 1, why: 'The frame of the chord. Lock it, and do and sol sound like one calm note.', go: 'Start here' },
  third: { rank: 2, why: 'The chord’s colour and ring. Sing it about 14 cents lower than the piano.', go: 'Then this one' },
};

function PractisePage() {
  const lab = loadLab();
  return (
    <PageBody n={10}>
      <p className="t16">Two intervals matter most. Learn to feel them in this order.</p>
      <div className="col tun-courses">
        {COURSE_IDS.map((iv: LabInterval) => {
          const c = COURSES[iv];
          const st = courseStatus(lab[iv]);
          return (
            <button key={iv} className="card crs-card tun-rankcard" data-testid={`tuning-course-${iv}`} onClick={() => go({ name: 'intonation', interval: iv })}>
              <span className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <span className="tun-rank" aria-hidden="true">{WHY[iv].rank}</span>
                <span className="col grow" style={{ gap: 4 }}>
                  <strong className="crs-card-title"><span className="sr-only">Number {WHY[iv].rank}: </span>{c.title}</strong>
                  <span className="t16">{WHY[iv].why}</span>
                </span>
              </span>
              <span className="divider" aria-hidden="true" />
              <span className="row between" style={{ gap: 8 }}>
                <span className="col" style={{ gap: 0 }}>
                  <strong className="t16">{st === 'done' ? 'Done ✓' : st === 'active' ? `Continue: step ${Math.min(lab[iv].rung, RUNGS)} of ${RUNGS}` : `${WHY[iv].go}: the course`}</strong>
                  <span className="t14 muted">{RUNGS} steps · about {COURSE_MINUTES} min · one a day</span>
                </span>
                <IconChevron size={20} color="var(--muted)" />
              </span>
            </button>
          );
        })}
      </div>
    </PageBody>
  );
}
