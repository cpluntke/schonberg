// "Why choirs tune differently": a 5-minute explainer before the intonation courses, six pages with
// Back / Next, a progress row and Skip. Each page: a few plain sentences, an animation (SVG, drawn
// each frame while the page is shown; a still frame with reduced motion) and a sound to play or
// change (the lab's Drone: held tones rich in overtones, retuned while they sound). The numbers are
// in game/tuning.ts; the courses themselves in IntonationLab.tsx (docs/INTONATION.md).

import React, { useEffect, useRef, useState } from 'react';
import { back, go, TUNING_PAGES, type Route } from '../router';
import { IconBack, IconChevron, IconPause, IconPlay } from '../icons';
import { getAudioContext, unlockAudio } from '../../audio/context';
import { Drone } from '../../audio/drone';
import { COURSES, COURSE_IDS, COURSE_MINUTES, courseStatus } from '../../game/courses';
import { RUNGS, loadLab, type LabInterval } from '../../game/intonation';
import {
  COMMA, FIFTHS_FROM_C, PIANO, PURE, STACKED_C, beatRate, centsToRatio, centsWords, fifthDrift, foldInto, oneDecimal, upperHz, wobbleLabel,
} from '../../game/tuning';

export const TUNING_TITLE = 'Why choirs tune differently';
const SEEN_KEY = 'sh:tuningSeen';

/** Has the singer seen the explainer (to its last page, or skipped there) on this phone? */
export function tuningSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ }
}

/** The root of every sound here: A3, comfortable for every voice to hear. */
const ROOT = 220;
/** Per-tone level: two tones a little louder than three, so a chord isn't louder than an interval. */
const LEVEL2 = 0.14;
const LEVEL3 = 0.11;

const PAGE_NAMES = [
  'Two notes that fit', 'The wobble', 'Cents', 'So why not tune everything pure?', 'Now stack pure fifths', 'Share it out',
  'Choirs have a luxury', 'What matters most',
];

/** "About 6 wobbles a second", "Still". */
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const pageRoute = (n: number): Route => (n <= 1 ? { name: 'tuning' } : { name: 'tuning', page: n });

export function TuningScreen({ page }: { page: number }) {
  const p = Math.max(1, Math.min(TUNING_PAGES, Math.round(page) || 1));
  useEffect(() => { if (p === TUNING_PAGES) markSeen(); }, [p]);
  // (the pages replace each other: ← and the phone's back leave the explainer)
  const to = (n: number) => go(pageRoute(n), true);
  const leave = () => back({ name: 'train' });
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
    case 1: return <FitPage />;
    case 2: return <WobblePage />;
    case 3: return <CentsPage />;
    case 4: return <PianoFifthsPage />;
    case 5: return <PureFifthsPage />;
    case 6: return <ShareOutPage />;
    case 7: return <ChoirPage />;
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

/**
 * This page's held tones: nothing until a tap (which unlocks audio), silent for good when the page
 * goes, stopped when the app goes to the background. `playing` is the id of what sounds.
 */
function useSound() {
  const ref = useRef<Drone | null>(null);
  const alive = useRef(true);
  const timer = useRef(0);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    const onVis = () => {
      if (!document.hidden) return;
      clearTimeout(timer.current);
      ref.current?.stop();
      setPlaying(null);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(timer.current);
      ref.current?.dispose();
      ref.current = null;
    };
  }, []);
  const stop = () => { clearTimeout(timer.current); ref.current?.stop(); setPlaying(null); };
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

/** A play / stop button for one sound, with a second line. */
function SoundButton({ id, playing, onClick, title, sub, testid }: { id: string; playing: string | null; onClick: () => void; title: string; sub?: string; testid?: string }) {
  const on = playing === id;
  return (
    <button className="btn two grow" aria-pressed={on} data-testid={testid} onClick={onClick}>
      <span className="row" style={{ gap: 6 }}>{on ? <IconPause size={16} /> : <IconPlay size={16} color="currentColor" />} {on ? 'Stop' : title}</span>
      {sub && <span className="sub">{sub}</span>}
    </button>
  );
}

// ---------- 1. Two notes that fit ----------

type Fit = 'octave' | 'fifth';
const FIT: Record<Fit, { ratio: number; label: string; repeat: number }> = {
  octave: { ratio: 2, label: '2 : 1', repeat: 1 },
  fifth: { ratio: 1.5, label: '3 : 2', repeat: 2 },
};

function FitPage() {
  const s = useSound();
  const [which, setWhich] = useState<Fit>('fifth');
  const play = (w: Fit) => {
    setWhich(w);
    s.toggle(w, { lo: ROOT, [w]: ROOT * FIT[w].ratio }, 6000);
  };
  return (
    <PageBody n={1} figure={<>
      <FitWaves which={which} />
      <div className="row tun-pair">
        <SoundButton id="fifth" playing={s.playing} onClick={() => play('fifth')} title="Fifth · 3 : 2" sub="3 to every 2" testid="tuning-fifth" />
        <SoundButton id="octave" playing={s.playing} onClick={() => play('octave')} title="Octave · 2 : 1" sub="twice as fast" testid="tuning-octave" />
      </div>
    </>}>
      <p className="t16">Every note is a vibration.</p>
      <p className="t16">In a fifth, the top note vibrates 3 times for every 2 of the bottom one. The waves line up, again and again, and the two notes blend into one calm sound.</p>
    </PageBody>
  );
}

/** The low note, the high note and both together, scrolling slowly; dashed lines where the pattern repeats. */
function FitWaves({ which }: { which: Fit }) {
  const u = useClock(0.3);
  const { ratio, repeat, label } = FIT[which];
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
      aria-label={`The low note, the high note (${label}) and both together: the waves line up in a pattern that repeats every ${repeat === 1 ? 'cycle' : `${repeat} cycles`} of the low note.`}>
      {marks.map((m) => <line key={m.k} x1={x(m.at)} x2={x(m.at)} y1={22} y2={232} stroke="var(--line-strong)" strokeDasharray="4 4" />)}
      <text x={X0} y={16} className="tun-label" fill="var(--voice)">Low note</text>
      <path d={path(48, 20, lo)} fill="none" stroke="var(--voice)" strokeWidth={2} />
      <text x={X0} y={88} className="tun-label" fill="var(--expert)">High note · {label}</text>
      <path d={path(120, 20, hi)} fill="none" stroke="var(--expert)" strokeWidth={2} />
      <text x={X0} y={162} className="tun-label" fill="var(--text)">Both together</text>
      <path d={path(198, 15, (s) => lo(s) + hi(s))} fill="none" stroke="var(--text)" strokeWidth={2} />
    </svg>
  );
}

// ---------- 2. The wobble ----------

const fifthHz = (off: number) => upperHz(ROOT, [3, 2], off);

function WobblePage() {
  const s = useSound();
  const [off, setOff] = useState(12);
  const b = beatRate(ROOT, fifthHz(off), [3, 2]);
  useEffect(() => { s.retune({ do: ROOT, sol: fifthHz(off) }); }, [off]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = centsWords(off);
  return (
    <PageBody n={2} figure={<>
      <PulseView rate={b} />
      <strong className="tun-rate" aria-live="polite" data-testid="tuning-rate">{cap(wobbleLabel(b))}</strong>
      <label className="col tun-slider" htmlFor="tun-fifth">
        <span className="row between t14"><span>Top note</span><span className="mono" aria-hidden="true">{words}</span></span>
        <input id="tun-fifth" type="range" min={-30} max={30} step={1} value={off} aria-valuetext={words} data-testid="tuning-fifth-slider"
          onChange={(e) => setOff(Number(e.target.value))} />
        <span className="row between t14 muted" aria-hidden="true"><span>lower</span><span>pure</span><span>higher</span></span>
      </label>
      <div className="row tun-pair">
        <SoundButton id="fifth" playing={s.playing} onClick={() => s.toggle('fifth', { do: ROOT, sol: fifthHz(off) })} title="Play the fifth" sub="then slide" testid="tuning-play" />
        <button className="btn tun-reset" disabled={off === 0} onClick={() => setOff(0)}>Make it pure</button>
      </div>
    </>}>
      <p className="t16">Play the fifth and move the slider. Off pure, the sound pulses: a wobble. The further off, the faster.</p>
      <p className="t16">At pure it stops: calm and still. That’s the sound we’re after.</p>
    </PageBody>
  );
}

/** Loudness over the last two seconds at the real wobble rate, newest on the right, and a dot that swells with it. */
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

// ---------- 3. Cents ----------

type Zoom = 'octave' | 'fifth' | 'third';
const VIEW: Record<Zoom, [number, number]> = { octave: [-30, 1230], fifth: [689, 713], third: [372, 414] };
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function CentsPage() {
  const s = useSound();
  const [zoom, setZoom] = useState<Zoom>('octave');
  const pick = (z: Zoom) => { setZoom(z); s.stop(); };
  const iv = zoom === 'third' ? 'third' : 'fifth';
  return (
    <PageBody n={3} figure={<>
      <div className="seg" role="group" aria-label="Show">
        {(['octave', 'fifth', 'third'] as const).map((z) => (
          <button key={z} aria-pressed={zoom === z} data-testid={`tuning-zoom-${z}`} onClick={() => pick(z)}>
            {z === 'octave' ? 'Whole octave' : z === 'fifth' ? 'Fifth' : 'Major third'}
          </button>
        ))}
      </div>
      <Ruler zoom={zoom} />
      {zoom === 'octave' ? (
        <div className="row tun-pair">
          <SoundButton id="octave" playing={s.playing} onClick={() => s.toggle('octave', { lo: ROOT, hi: ROOT * 2 }, 5000)} title="Play the octave" sub="1200 cents · pure on the piano too" testid="tuning-cents-octave" />
        </div>
      ) : (
        <div className="row tun-pair">
          <SoundButton id="piano" playing={s.playing} testid="tuning-cents-piano" title={`Piano · ${PIANO[iv]}`} sub="cents above do"
            onClick={() => s.toggle('piano', { do: ROOT, up: ROOT * centsToRatio(PIANO[iv]) }, 5000)} />
          <SoundButton id="pure" playing={s.playing} testid="tuning-cents-pure" title={`Pure · ${oneDecimal(PURE[iv])}`} sub="cents above do"
            onClick={() => s.toggle('pure', { do: ROOT, up: ROOT * centsToRatio(PURE[iv]) }, 5000)} />
        </div>
      )}
    </>}>
      <p className="t16">One piano key to the next is <strong>100 cents</strong>. An octave is 1200.</p>
      <p className="t16">In a held chord, trained ears hear 5 to 10 cents. Zoom in: pure and piano aren’t quite the same.</p>
    </PageBody>
  );
}

/** One octave as a ruler: the 12 keys every 100 cents, the pure fifth and third against the piano's. Zooms in. */
function Ruler({ zoom }: { zoom: Zoom }) {
  const lo = useTween(VIEW[zoom][0]);
  const hi = useTween(VIEW[zoom][1]);
  const span = hi - lo;
  const X0 = 10, W = 320;
  const x = (c: number) => X0 + ((c - lo) / span) * W;
  const inView = (c: number) => c >= lo - 0.01 && c <= hi + 0.01;
  const fine = span < 120;
  const ticks: { c: number; h: number; label?: string }[] = [];
  if (fine) {
    for (let c = Math.ceil(lo); c <= hi; c++) ticks.push({ c, h: c % 10 === 0 ? 14 : c % 5 === 0 ? 9 : 5, label: c % 10 === 0 ? String(c) : undefined });
  } else {
    for (let k = 0; k <= 12; k++) ticks.push({ c: k * 100, h: [1, 3, 6, 8, 10].includes(k % 12) ? 9 : 14, label: [0, 400, 700, 1200].includes(k * 100) ? String(k * 100) : undefined });
  }
  const pairs = [
    { name: 'fifth', pure: PURE.fifth, piano: PIANO.fifth, gap: '2 cents' },
    { name: 'third', pure: PURE.third, piano: PIANO.third, gap: '13.7 cents' },
  ] as const;
  const focus = zoom === 'octave' ? null : pairs.find((q) => q.name === zoom)!;
  const AXIS = 96;
  return (
    <svg className="tun-svg" viewBox="0 0 340 150" role="img" data-testid="tuning-ruler"
      aria-label={zoom === 'octave'
        ? 'One octave, 1200 cents, with the 12 piano keys every 100 cents. The pure fifth (702) sits next to the piano’s 700; the pure major third (386.3) below the piano’s 400.'
        : `Zoomed in: the pure ${zoom === 'fifth' ? 'fifth at 702 cents, 2 cents above the piano’s 700' : 'major third at 386.3 cents, 13.7 cents below the piano’s 400'}.`}>
      <line x1={X0} x2={X0 + W} y1={AXIS} y2={AXIS} stroke="var(--line-strong)" strokeWidth={2} />
      {ticks.filter((t) => inView(t.c)).map((t) => (
        <g key={`${fine ? 'f' : 'k'}${t.c}`}>
          <line x1={x(t.c)} x2={x(t.c)} y1={AXIS} y2={AXIS + t.h} stroke="var(--muted)" strokeWidth={1.5} />
          {t.label && <text x={x(t.c)} y={AXIS + 30} textAnchor="middle" className="tun-label mono" fill="var(--muted)">{t.label}</text>}
        </g>
      ))}
      {/* key names above the white keys (the whole octave) */}
      {!fine && [0, 2, 4, 5, 7, 9, 11, 12].map((k) => (
        <text key={`n${k}`} x={x(k * 100)} y={AXIS - 66} textAnchor="middle" className="tun-label" fill="var(--muted)">{NOTE_NAMES[k % 12]}</text>
      ))}
      {pairs.map((q) => (
        <g key={q.name}>
          {inView(q.piano) && <line x1={x(q.piano)} x2={x(q.piano)} y1={AXIS - 36} y2={AXIS} stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 3" />}
          {inView(q.pure) && <line x1={x(q.pure)} x2={x(q.pure)} y1={AXIS - 36} y2={AXIS + 4} stroke="var(--good)" strokeWidth={3} />}
          {!fine && <text x={x((q.pure + q.piano) / 2)} y={AXIS - 40} textAnchor="middle" className="tun-label" fontWeight={700} fill="var(--good)">{q.name === 'fifth' ? '5th' : '3rd'}</text>}
        </g>
      ))}
      {focus && fine && (() => {
        const a = x(Math.min(focus.pure, focus.piano)), b = x(Math.max(focus.pure, focus.piano));
        const pureLeft = focus.pure < focus.piano;
        return (
          <g>
            <path d={`M${a} ${AXIS - 46}V${AXIS - 52}H${b}V${AXIS - 46}`} fill="none" stroke="var(--text)" strokeWidth={1.5} />
            <text x={(a + b) / 2} y={AXIS - 58} textAnchor="middle" className="tun-label" fontWeight={700} fill="var(--text)">{focus.gap}</text>
            <text x={x(focus.pure) + (pureLeft ? -6 : 6)} y={AXIS - 24} textAnchor={pureLeft ? 'end' : 'start'} className="tun-label" fontWeight={700} fill="var(--good)">pure {oneDecimal(focus.pure)}</text>
            <text x={x(focus.piano) + (pureLeft ? 6 : -6)} y={AXIS - 24} textAnchor={pureLeft ? 'start' : 'end'} className="tun-label" fill="var(--muted)">piano {focus.piano}</text>
          </g>
        );
      })()}
      <text x={X0} y={146} className="tun-label" fill="var(--muted)">cents above do</text>
    </svg>
  );
}

// ---------- 4–6. So why not tune everything pure? (the comma, by hand) ----------

const C3 = 130.81;
const C4 = 2 * C3;
/** Degrees of the circle per cent of drift: the drift is drawn larger than life (23.5 cents ≈ a third of a step). */
const DEG_PER_CENT = 1;

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

/** Twelve fifths up from C, one tap at a time; each tap plays the fifth it adds. `pure`: 702 cents, else the piano's 700. */
function useFifthWalk(pure: boolean) {
  const s = useSound();
  const [k, setK] = useState(0);
  const shown = useTween(k, 450);
  const ratio = pure ? 1.5 : centsToRatio(700);
  const add = () => {
    if (k >= 12) { setK(0); s.stop(); return; }
    const nk = k + 1;
    setK(nk);
    const lo = foldInto(C3 * ratio ** (nk - 1), C3);
    void s.start('step', { lo, hi: lo * ratio }, 1400);
  };
  const bothCs = () => s.toggle('cs', { c: C4, c2: C4 * (pure ? STACKED_C : 1.0000001) }, 8000);
  return { s, k, shown, add, bothCs };
}

function PianoFifthsPage() {
  const w = useFifthWalk(false);
  const done = w.k >= 12;
  return (
    <PageBody n={4} figure={<>
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

function PureFifthsPage() {
  const w = useFifthWalk(true);
  const done = w.k >= 12;
  const drift = fifthDrift(w.k);
  return (
    <PageBody n={5} figure={<>
      <FifthsCircle steps={w.shown} extra={PURE.fifth - 700} gap label={done
        ? `Twelve pure fifths from C overshoot C by ${oneDecimal(COMMA)} cents: the circle doesn't close. That gap is the Pythagorean comma.`
        : `${w.k} of 12 pure fifths up from C: ${oneDecimal(drift)} cents above the piano's.`}>
        {w.k === 0 ? <Centre big="C" small="start here" />
          : done ? <Centre big={`${oneDecimal(COMMA)} cents`} small="too far: the comma" tone="var(--accent-text)" />
            : <Centre big={`+${oneDecimal(drift)}`} small={`cents · ${FIFTHS_FROM_C[w.k]}, fifth ${w.k}`} tone="var(--accent-text)" />}
      </FifthsCircle>
      <div className="row tun-pair">
        <button className="btn voice grow tun-tap" data-testid="tuning-add-fifth" onClick={w.add}>{done ? 'Start again' : '+ a pure fifth'}</button>
        {done && <SoundButton id="cs" playing={w.s.playing} onClick={w.bothCs} title="Play both Cs" sub="hear them wobble" testid="tuning-both-cs" />}
      </div>
      <span className="t14 muted center" aria-live="polite">{done ? 'The gap is the Pythagorean comma. Your C and the stacked C wobble against each other.' : 'Watch the needle drift: about 2 cents a tap.'}</span>
      <span className="t14 muted center">(the drift is drawn larger than life)</span>
    </>}>
      <p className="t16 tun-ask">Each pure fifth is 702 cents: 2 more than the piano’s.</p>
      <p className="t16">Tap 12 times. Where do you land now?</p>
    </PageBody>
  );
}

function ShareOutPage() {
  const s = useSound();
  const [shared, setShared] = useState(false);
  const t = useTween(shared ? 1 : 0, 1800);
  const extra = (PURE.fifth - 700) * (1 - t);
  const fifth = (): Tones => ({ do: C4, sol: C4 * centsToRatio(700 + extra) });
  useEffect(() => { if (s.playing === 'fifth') s.retune(fifth()); }, [extra]); // eslint-disable-line react-hooks/exhaustive-deps
  const closed = t > 0.995;
  return (
    <PageBody n={6} figure={<>
      <FifthsCircle steps={12} extra={extra} gap label={closed ? 'The comma shared out: every fifth 2 cents narrow, and the circle closes.' : `Twelve fifths of ${oneDecimal(700 + extra)} cents: ${oneDecimal(12 * extra)} cents past C.`}>
        {closed ? <Centre big="It closes" small="every fifth 700 cents" tone="var(--good)" />
          : <Centre big={`${oneDecimal(12 * extra)} cents`} small="left over" tone="var(--accent-text)" />}
      </FifthsCircle>
      <span className="t16 center mono" data-testid="tuning-each-fifth">Each fifth: {(700 + extra).toFixed(1)} cents</span>
      <div className="row tun-pair">
        <button className="btn voice grow tun-tap" data-testid="tuning-share" onClick={() => setShared(!shared)}>{shared ? 'Pure again' : 'Share it out'}</button>
        <SoundButton id="fifth" playing={s.playing} onClick={() => s.toggle('fifth', fifth())} title="Play a fifth" sub="almost still" testid="tuning-share-fifth" />
      </div>
      <div className="row tun-pair">
        <SoundButton id="chord" playing={s.playing} onClick={() => s.toggle('chord', { do: C4, mi: C4 * centsToRatio(400), sol: C4 * centsToRatio(700) }, 6000)}
          title="The piano’s major chord" sub="its third shimmers" testid="tuning-share-chord" />
      </div>
    </>} after={<>
      <p className="t16">Pianos share it out: every fifth is a tiny bit narrow. That’s <strong>equal temperament</strong>. Every key works, but everything is a little out of tune.</p>
      <p className="t16">The thirds pay most: 13.7 cents too wide, so they shimmer.</p>
    </>}>
      <p className="t16 tun-ask">For the octaves to add up, that extra has to go somewhere.</p>
      <p className="t16">Tap “Share it out”.</p>
    </PageBody>
  );
}

// ---------- 7. Choirs have a luxury ----------

const GAP3 = PIANO.third - PURE.third; // 13.7

function ChoirPage() {
  const s = useSound();
  // how far below the piano's third mi sits: 0 (the piano) to 13.7 (pure)
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
  const atPure = value >= GAP3 - 0.05;
  const words = value < 0.05 ? 'the piano’s third' : atPure ? `pure: ${oneDecimal(GAP3)} cents below the piano` : `${oneDecimal(value)} cents below the piano`;
  return (
    <PageBody n={7} figure={<>
      <PulseView rate={b} />
      <strong className="tun-rate" aria-live="polite" data-testid="tuning-chord-rate">{wobbleLabel(b) === 'still' ? 'Still: the chord rings' : cap(wobbleLabel(b))}</strong>
      <label className="col tun-slider" htmlFor="tun-third">
        <span className="row between t14"><span>The third (mi)</span><span className="mono" aria-hidden="true">{value < 0.05 ? 'piano' : `−${oneDecimal(value)} cents`}</span></span>
        <input id="tun-third" type="range" min={0} max={Number(GAP3.toFixed(1))} step={0.1} value={Number(value.toFixed(1))} aria-valuetext={words} data-testid="tuning-third-slider"
          onChange={(e) => { setGlide(null); setLow(Number(e.target.value)); }} />
        <span className="row between t14 muted" aria-hidden="true"><span>piano</span><span>pure</span></span>
      </label>
      <div className="row tun-pair">
        <SoundButton id="chord" playing={s.playing} onClick={() => s.toggle('chord', chord())} title="Play" sub="the chord" testid="tuning-chord" />
        <button className="btn tun-reset" data-testid="tuning-make-pure" onClick={() => setGlide(atPure ? 0 : GAP3)}>{atPure ? 'Back to the piano' : 'Make it pure'}</button>
      </div>
    </>} after={<>
      <table className="tun-table" aria-label="Pure, against the piano">
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
      <p className="t16">We can tune every chord on its own, so we can sound amazing: pure. Make the third pure and hear the shimmer stop.</p>
    </PageBody>
  );
}

// ---------- 8. What matters most ----------

const WHY: Record<LabInterval, { rank: number; why: string; go: string }> = {
  fifth: { rank: 1, why: 'The frame of the chord. Lock it, and do and sol sound like one calm note.', go: 'Start here' },
  third: { rank: 2, why: 'The chord’s colour and ring. Sing it about 14 cents lower than the piano.', go: 'Then this one' },
};

function PractisePage() {
  const lab = loadLab();
  return (
    <PageBody n={8}>
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
