// The intonation lab (preview: admins only). Find a pure fifth and a pure major third by ear, one
// interval at a time, up a ladder where the help fades: listen, tune by hand, sing with the pulse
// shown, sing blind, sing it in a chord. docs/INTONATION.md has the why.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { back, go, type Route } from '../router';
import { useProfile } from '../hooks';
import { useStaff } from './Admin';
import type { Staff } from '../../progress/choir';
import { IconBack, IconCheck, IconEar, IconPause, IconPlay } from '../icons';
import { getAudioContext, unlockAudio } from '../../audio/context';
import { Drone } from '../../audio/drone';
import { midiToHz } from '../../audio/pitch';
import { getTracker } from '../play/session';
import { micErrorText } from '../components/Tuner';
import {
  CHECK_PASS, CHECK_ROUNDS, HOLD_SEC, HoldDetector, INTERVAL_DEGREE, PASS, ROUNDS, RUNGS, RUNG_NAMES, RATIO, TOL_HAND, TOL_SING,
  centsAbove, labInProgramme, loadLab, logRound, median, pianoCents, pureCents, rootFor, saveLab, shownBeats, wobbleWord,
  type Degree, type LabInterval, type LabProgress,
} from '../../game/intonation';

type LabRoute = Extract<Route, { name: 'intonation' }>;

/** Who gets the lab: choir admins and the super admin always (preview); singers while their choir's programme has it. */
export const labEnabled = (staff: Staff) => staff.admin || staff.superAdmin || labInProgramme();

const IV_NAME: Record<LabInterval, string> = { fifth: 'Pure fifth', third: 'Pure major third' };
const DEG_NAME: Record<Degree, string> = { do: 'do', mi: 'mi', sol: 'sol' };
const RUNG_SUB = [
  'What a pure interval sounds like, and what to listen for. Then a quick check.',
  'The app plays both notes; you move one until the pulse stops.',
  'Sing against the drone; the screen shows how much it pulses.',
  'The same, ears only. You see where you landed afterwards.',
  'The app sings the other notes of the chord; you lock yours in.',
];
const RUNG_HELP = ['ears', 'no singing', 'feedback', 'no feedback', 'with others'];

export function IntonationLab({ route }: { route: LabRoute }) {
  const staff = useStaff();
  const [profile] = useProfile();
  const [lab, setLab] = useState<LabProgress>(loadLab);
  const root = rootFor(profile.voice, profile.rangeLow, profile.rangeHigh);
  // (from storage, not this render's copy: the mic's callbacks outlive renders)
  const record = (iv: LabInterval, rung: number, value: number) => {
    const r = logRound(loadLab(), iv, rung, value);
    saveLab(r.p);
    setLab(r.p);
    return r.passed;
  };

  if (!labEnabled(staff)) {
    return (
      <main className="screen">
        <div className="topbar">
          <button className="icon-btn" aria-label="Back" onClick={() => back({ name: 'home' })}><IconBack /></button>
          <h1>Intonation lab</h1>
        </div>
        <div className="notice info">The intonation lab isn't open yet. It's coming soon.</div>
      </main>
    );
  }
  const iv = route.interval ?? (lab.fifth.rung > RUNGS ? 'third' : 'fifth');
  const rung = route.rung;
  if (!route.interval || !rung || rung > lab[iv].rung) return <Ladder iv={iv} lab={lab} />;
  const props = { iv, root, lab, record };
  return rung === 1 ? <ListenRung {...props} />
    : rung === 2 ? <TuneRung {...props} />
    : <SingRung {...props} rung={rung} />;
}

// ---------- the ladder ----------

function Ladder({ iv, lab }: { iv: LabInterval; lab: LabProgress }) {
  const cur = lab[iv].rung;
  return (
    <main className="screen" data-testid="lab-ladder">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => back({ name: 'home' })}><IconBack /></button>
        <h1>Intonation lab</h1>
        <span className="badge" style={{ marginLeft: 'auto' }}>Preview</span>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <strong style={{ fontSize: 22, lineHeight: 1.15 }}>Hear it, tune it, sing it</strong>
        <span className="small muted">Each interval is a ladder: first your ears, then your hands, then your voice. Help fades as you climb.</span>
      </div>
      <div className="seg" role="group" aria-label="Interval">
        {(['fifth', 'third'] as const).map((k) => (
          <button key={k} aria-pressed={k === iv} data-testid={`lab-track-${k}`} onClick={() => go({ name: 'intonation', interval: k }, true)}>
            {IV_NAME[k]}
            <span className="sub">{lab[k].rung > RUNGS ? 'done ✓' : k === 'fifth' ? '+2¢ vs piano' : '−14¢ vs piano'}</span>
          </button>
        ))}
      </div>
      <ol className="col" style={{ gap: 0, listStyle: 'none', padding: 0, margin: 0 }}>
        {RUNG_NAMES.map((name, i) => {
          const n = i + 1, done = n < cur, now = n === cur, open = n <= cur;
          return (
            <li key={n} className="row" style={{ alignItems: 'stretch', gap: 12 }}>
              <div className="col" style={{ alignItems: 'center', gap: 0, width: 32, flex: 'none' }}>
                <span className="mono" aria-hidden="true" style={{
                  width: 32, height: 32, borderRadius: 16, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600,
                  border: `2px solid ${done ? 'var(--good)' : now ? 'var(--accent)' : 'var(--line)'}`,
                  background: done ? 'var(--good)' : now ? 'var(--accent-soft)' : 'transparent',
                  color: done ? 'var(--accent-ink)' : now ? 'var(--accent)' : 'var(--muted)',
                }}>{done ? <IconCheck size={16} /> : n}</span>
                {n < RUNGS && <span style={{ width: 2, flex: 1, minHeight: 12, background: done ? 'var(--good)' : 'var(--line)' }} />}
              </div>
              <button className="list-row grow" disabled={!open} data-testid={`lab-rung-${n}`} aria-current={now ? 'step' : undefined}
                style={{ textAlign: 'left', alignItems: 'flex-start', padding: '4px 0 14px', opacity: open ? 1 : 0.55, flexDirection: 'column', gap: 2 }}
                onClick={() => go({ name: 'intonation', interval: iv, rung: n })}>
                <span className="row between" style={{ width: '100%' }}>
                  <strong style={{ color: now ? 'var(--accent-text)' : undefined }}>{name}<span className="sr-only">{done ? ' (done)' : now ? ' (next)' : !open ? ' (locked)' : ''}</span></strong>
                  <span className="tiny muted mono">{RUNG_HELP[i]}</span>
                </span>
                <span className="small muted">{RUNG_SUB[i]}{!open ? ' (opens after the step before)' : ''}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <button className="btn primary block" data-testid="lab-continue"
        onClick={() => go({ name: 'intonation', interval: iv, rung: Math.min(cur, RUNGS) })}>
        {cur > RUNGS ? 'Practise the chord again' : `Continue: ${RUNG_NAMES[cur - 1].toLowerCase()}`}
      </button>
      <span className="tiny muted">Use headphones for the singing steps: the app's notes must not reach the microphone. Progress stays on this phone.</span>
    </main>
  );
}

// ---------- shared pieces ----------

interface RungProps { iv: LabInterval; root: number; lab: LabProgress; record: (iv: LabInterval, rung: number, v: number) => boolean }

function RungTop({ iv, rung, title, children }: { iv: LabInterval; rung: number; title: string; children?: React.ReactNode }) {
  return (
    <>
      <div className="topbar">
        <button className="icon-btn" aria-label="Back to the ladder" onClick={() => back({ name: 'intonation', interval: iv })}><IconBack /></button>
        <h1>{title}</h1>
      </div>
      <span className="tiny muted mono">{IV_NAME[iv]} · step {rung} of {RUNGS}</span>
      {children}
    </>
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
      aria-label={`You: ${Math.round(value)} cents above do. Pure: ${Math.round(pure)}${showPiano ? `, the piano: ${piano}` : ''}.`}>
      <rect x={x(pure - tol)} y={44} width={x(pure + tol) - x(pure - tol)} height={24} rx={6} fill="var(--good)" opacity={0.16} />
      <line x1={10} x2={310} y1={56} y2={56} stroke="var(--line)" strokeWidth={2} />
      <line x1={x(pure)} x2={x(pure)} y1={22} y2={70} stroke="var(--good)" strokeWidth={2.5} />
      <text x={x(pure)} y={16} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--good)">pure {Math.round(pure)}</text>
      {showPiano && <>
        <line x1={x(piano)} x2={x(piano)} y1={22} y2={70} stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 3" />
        <text x={x(piano)} y={16} textAnchor="middle" fontSize={12} fill="var(--muted)">piano {piano}</text>
      </>}
      <circle cx={x(value)} cy={56} r={8} fill="var(--voice)" stroke="var(--bg)" strokeWidth={3} />
      <text x={Math.max(40, Math.min(280, x(value)))} y={96} textAnchor="middle" fontSize={13} fontWeight={800} fill="var(--voice)">
        you {Math.round(value)}{value < lo ? ' ◂' : value > hi ? ' ▸' : ''}
      </text>
    </svg>
  );
}

function verdict(deg: Degree, off: number, tol: number): { title: string; good: boolean; text: string } {
  const pure = pureCents(deg), piano = pianoCents(deg);
  if (Math.abs(off) <= tol) return { title: 'Pure: you found it', good: true, text: `${Math.abs(Math.round(off))}¢ from pure. Remember how still that sounded.` };
  if (Math.abs(piano - pure) >= 3 && Math.abs(pure + off - piano) <= 4) return { title: 'That’s the piano’s note', good: false, text: 'Most of us learned it from the piano. Go lower, until the pulse settles.' };
  return { title: off > 0 ? 'A little high' : 'A little low', good: false, text: `${Math.abs(Math.round(off))}¢ ${off > 0 ? 'above' : 'below'} pure: some pulse is left.` };
}

/** The last rounds of a rung as dots (pure / not). */
function Rounds({ results, tol, total = ROUNDS }: { results: number[]; tol: number; total?: number }) {
  const last = results.slice(-total);
  return (
    <div className="row" style={{ gap: 6 }} role="img" aria-label={`${last.filter((v) => Math.abs(v) <= tol).length} of the last ${last.length} pure`}>
      {Array.from({ length: total }, (_, i) => {
        const v = last[i];
        const bg = v == null ? 'var(--line)' : Math.abs(v) <= tol ? 'var(--good)' : 'var(--bad)';
        return <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: bg }} />;
      })}
    </div>
  );
}

function PassedNote({ iv, rung }: { iv: LabInterval; rung: number }) {
  const next = rung < RUNGS ? rung + 1 : null;
  const other: LabInterval = iv === 'fifth' ? 'third' : 'fifth';
  const otherOpen = loadLab()[other].rung <= RUNGS;
  return (
    <div className="notice info col" style={{ gap: 8 }} data-testid="lab-passed">
      <strong>{next ? `Step ${rung} done. “${RUNG_NAMES[next - 1]}” is open.` : `${IV_NAME[iv]}: the whole ladder is done.`}</strong>
      <button className="btn primary small" style={{ alignSelf: 'flex-start' }}
        onClick={() => go(next ? { name: 'intonation', interval: iv, rung: next } : { name: 'intonation', interval: otherOpen ? other : iv }, true)}>
        {next ? `Go to step ${next}` : otherOpen ? `On to the ${other}` : 'Back to the ladder'}
      </button>
    </div>
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
    <main className="screen" data-testid="lab-listen">
      <RungTop iv={iv} rung={1} title="What to listen for">
        <span className="small muted">Two notes that are nearly in tune make a pulse, a “wah-wah-wah”. The closer they get, the slower it pulses. Pure means no pulse at all.</span>
      </RungTop>
      {EXAMPLES[iv].map((e) => {
        const on = playing === e.key;
        const hz = toneHz(root, deg, e.off);
        return (
          <div key={e.key} className="card" style={{ gap: 8, padding: 12, borderColor: on ? 'var(--accent)' : undefined }}>
            <div className="row">
              <button className="icon-btn filled" aria-label={`${on ? 'Stop' : 'Play'}: ${e.title}`} aria-pressed={on} data-testid={`lab-ex-${e.key}`}
                onClick={() => play(on ? null : e.key, { do: rootHz, x: hz })}>
                {on ? <IconPause /> : <IconPlay color="var(--accent)" />}
              </button>
              <div className="col grow" style={{ gap: 0 }}>
                <strong>{e.title}</strong>
                <span className="small muted">do + {DEG_NAME[deg]}{e.off ? ` ${e.off > 0 ? '+' : ''}${Math.round(e.off)}¢` : ''}</span>
              </div>
            </div>
            <Wave beats={shownBeats(e.off, deg, ['do'])} height={44} colour={e.off === 0 ? 'var(--good)' : 'var(--voice)'} label={`${e.title}: ${wobbleWord(e.off)}`} />
            <span className="small">{e.hear}</span>
          </div>
        );
      })}
      <div className="notice info small">Don't listen to the notes: listen to the space between them. Is it moving, or still?</div>
      <button className="btn primary block" data-testid="lab-check" onClick={() => { void play(null, {}); setMode('check'); }}>I hear it: check me</button>
    </main>
  );
}

/** Which of two chords is calmer? One is pure, one isn't (the piano's third; a fifth 12¢ off). */
function ListenCheck({ iv, root, lab, record, play, playing }: RungProps & {
  play: (key: string | null, tones: Record<string, number>, sec?: number) => Promise<void>; playing: string | null;
}) {
  const deg = INTERVAL_DEGREE[iv];
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
    if (record(iv, 1, a === round.pure ? 0 : 1)) setPassed(true);
  }
  const right = answer != null && answer === round.pure;
  return (
    <main className="screen" data-testid="lab-quiz">
      <RungTop iv={iv} rung={1} title="Which is calmer?">
        <span className="small muted">One is pure, one isn't. Same notes, same sound: listen to {iv === 'third' ? 'the third' : 'the fifth'}.</span>
      </RungTop>
      <Rounds results={results.map((v) => (v === 0 ? 0 : 99))} tol={0} total={CHECK_ROUNDS} />
      <div className="row" style={{ gap: 12 }}>
        {(['A', 'B'] as const).map((w) => {
          const on = playing === `chord-${w}`;
          return (
            <button key={w} className="card grow" aria-pressed={on} data-testid={`lab-chord-${w}`}
              style={{ alignItems: 'center', minHeight: 150, justifyContent: 'center', borderColor: answer && w === round.pure ? 'var(--good)' : on ? 'var(--accent)' : undefined }}
              onClick={() => { setHeard((h) => new Set(h).add(w)); void play(on ? null : `chord-${w}`, chord(w), 3); }}>
              <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{w}</span>
              <span className="small muted">{answer ? (w === round.pure ? 'pure' : iv === 'third' ? 'piano' : 'off') : on ? 'playing…' : 'tap to hear'}</span>
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
      {heard.size < 2 && !answer && <span className="tiny muted">Hear both first.</span>}
      {passed && <PassedNote iv={iv} rung={1} />}
      {answer && (
        <button className="btn primary block" data-testid="lab-next" onClick={() => { void play(null, {}); setRound(newCheck(iv)); setHeard(new Set()); setAnswer(null); }}>
          Next pair
        </button>
      )}
      <span className="tiny muted">To pass: {CHECK_PASS} of the last {CHECK_ROUNDS} right.</span>
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
    if (record(iv, 2, off)) setPassed(true);
  }
  async function next() {
    if (Date.now() - lockedAt.current < 600) return; // (a double tap on "That's it")
    const r = newTuneRound();
    setRound(r); setPos(r.start); setDone(null);
    setOn(true);
    (await drone.get())?.set({ do: rootHz, x: toneHz(root, deg, r.start - r.shift) });
  }
  const v = done != null ? verdict(deg, done, TOL_HAND) : null;
  return (
    <main className="screen" data-testid="lab-tune">
      <RungTop iv={iv} rung={2} title="Tune it by hand">
        <span className="small muted">No singing yet. The app plays do and an out-of-tune {DEG_NAME[deg]}. Move {DEG_NAME[deg]} until the pulse stops.</span>
      </RungTop>
      <Rounds results={lab[iv].logs[2] ?? []} tol={TOL_HAND} />
      <div className="card" style={{ gap: 8 }}>
        <div className="row between">
          <strong className="small">What you hear</strong>
          <span className="mono small" style={{ color: Math.abs(off) <= TOL_HAND ? 'var(--good)' : 'var(--muted)' }} data-testid="lab-word">{on ? wobbleWord(off) : '–'}</span>
        </div>
        <Wave beats={on ? shownBeats(off, deg, ['do']) : null} label={on ? `Pulse: ${wobbleWord(off)}` : 'Not playing'} />
        <span className="tiny muted">One second of sound. A slower pulse means closer.</span>
      </div>
      {!on ? (
        <button className="btn primary block" data-testid="lab-start" onClick={() => void start()}>Play do and {DEG_NAME[deg]}</button>
      ) : (
        <>
          <div className="field">
            <span className="small" style={{ fontWeight: 600 }} aria-hidden="true">Move {DEG_NAME[deg]}</span>
            <div className="row">
              <span className="small muted" aria-hidden="true">lower</span>
              <input type="range" className="grow" min={-SLIDER} max={SLIDER} step={0.5} value={pos} disabled={done != null}
                data-testid="lab-slider" aria-label={`Move ${DEG_NAME[deg]}: left is lower, right is higher`} aria-valuetext="no numbers: use your ears"
                onChange={(e) => set(Number(e.target.value))} style={{ height: 44, accentColor: 'var(--accent)' }} />
              <span className="small muted" aria-hidden="true">higher</span>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn grow" disabled={done != null} data-testid="lab-lower" onClick={() => set(pos - 1)}>A touch lower</button>
            <button className="btn grow" disabled={done != null} data-testid="lab-higher" onClick={() => set(pos + 1)}>A touch higher</button>
          </div>
        </>
      )}
      {v && done != null && (
        <div className={v.good ? 'notice info col' : 'notice col'} style={{ gap: 6 }} role="status" data-testid="lab-verdict">
          <strong>{v.title}</strong>
          <Landed deg={deg} value={pureCents(deg) + done} tol={TOL_HAND} />
          <span className="small">{v.text}</span>
        </div>
      )}
      {passed && <PassedNote iv={iv} rung={2} />}
      {on && (done == null
        ? <button className="btn primary block" data-testid="lab-lock" onClick={lock}>That's it</button>
        : <button className="btn primary block" data-testid="lab-next" onClick={() => void next()}>Next round</button>)}
      <span className="tiny muted">To pass: {PASS} of the last {ROUNDS} within {TOL_HAND}¢ of pure.</span>
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

// ---------- 3–5 · singing ----------

function SingRung({ iv, root, lab, record, rung }: RungProps & { rung: number }) {
  const chordRung = rung === 5;
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
  const live = useRef({ hold: new HoldDetector(), recent: [] as { t: number; hz: number }[], paused: false, locked: false, shown: 0 });
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
        const locked = L.hold.push(now, hz != null ? centsAbove(hz, rootHz, tg) : null);
        // (the screen at most ~15 times a second)
        if (performance.now() - L.shown > 66) {
          L.shown = performance.now();
          setOffNow(L.recent.length ? centsAbove(median(L.recent.map((r) => r.hz)), rootHz, tg) - tg : null);
          setHeld(L.hold.held());
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
    L.paused = true;
    L.locked = true;
    setHeld(0);
    const { target: tg, showWobble: sw, record: rec } = cur.current;
    const offBy = c - tg;
    // A different note (more than a semitone away) is no try; in the chord, rounds with the wobble shown are practice.
    const counted = Math.abs(offBy) <= 60 && (!chordRung || !sw);
    setResult({ value: c, counted });
    if (counted && rec(iv, rung, offBy)) setPassed(true);
  }

  /** A new round. */
  function again() {
    const L = live.current;
    L.hold.reset();
    L.recent = [];
    L.paused = false;
    L.locked = false;
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
      if (!L.locked) L.paused = false;
    }, 2500);
  }

  const v = result ? (Math.abs(result.value - target) > 60
    ? { title: 'That was a different note', good: false, text: `Aim for ${DEG_NAME[deg]}: ${hintInterval(deg)}.` }
    : verdict(deg, result.value - target, tol)) : null;
  const title = rung === 3 ? 'Sing it, with the wobble' : rung === 4 ? 'Sing it blind' : 'In the chord';
  const how = deg === 'do' ? 'Hold do steady; the others are tuned to it.'
    : `Start a little ${deg === 'mi' ? 'above' : 'below'} ${DEG_NAME[deg]} on “nee”, straight tone, and slide slowly. Stop where it goes still, and hold.`;
  return (
    <main className="screen" data-testid={`lab-sing-${rung}`}>
      <RungTop iv={iv} rung={rung} title={title}>
        <span className="small muted">{rung === 4 ? 'The screen won’t help this time. ' : chordRung ? 'The app sings the other two notes, already pure. ' : ''}{how}</span>
      </RungTop>
      <Rounds results={lab[iv].logs[rung] ?? []} tol={tol} />
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
            <span className="small" style={{ fontWeight: 600 }}>Show the wobble{showWobble ? ' (practice: rounds count with it off)' : ''}</span>
            <input type="checkbox" checked={showWobble} data-testid="lab-wobble-toggle" onChange={(e) => { setShowWobble(e.target.checked); again(); }} />
          </label>
        </>
      )}
      <div className="row wrap" style={{ gap: 6 }}>
        {others.map((o) => <span key={o} className="pill small">App: {DEG_NAME[o]}</span>)}
        <span className="pill small" style={{ color: 'var(--voice)' }}>You: {DEG_NAME[deg]}</span>
      </div>
      {state !== 'on' ? (
        <div className="card" style={{ alignItems: 'center', gap: 10 }}>
          <span className="small muted" style={{ textAlign: 'center' }}>
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
                <strong className="small">The wobble</strong>
                <span className="mono small" style={{ color: offNow != null && Math.abs(offNow) <= tol ? 'var(--good)' : 'var(--muted)' }} data-testid="lab-word">{wobbleWord(offNow)}</span>
              </div>
              <Wave beats={offNow == null ? null : shownBeats(offNow, deg, others)} label={`Your voice against the drone: ${wobbleWord(offNow)}`} />
              <span className="tiny muted">Shows how much it pulses, never which way. Which way to move is for your ear.</span>
            </>
          ) : (
            <div className="col" style={{ alignItems: 'center', gap: 6, padding: '12px 0' }}>
              <IconEar size={40} color="var(--muted)" />
              <strong>Listen for the moment it stops moving</strong>
            </div>
          )}
          <HoldRing held={result ? 0 : held} />
        </div>
      )}
      {v && result && (
        <div className={v.good ? 'notice info col' : 'notice col'} style={{ gap: 6 }} role="status" data-testid="lab-verdict">
          <strong>{v.title}{!result.counted && Math.abs(result.value - target) <= 60 ? ' (practice round)' : ''}</strong>
          {Math.abs(result.value - target) <= 60 && <Landed deg={deg} value={result.value} tol={tol} />}
          <span className="small">{v.text}</span>
        </div>
      )}
      {chordRung && state === 'on' && (
        <div className="notice info small">
          <strong>Listen for the ghost note.</strong> When all three are pure, you may hear a soft hum two octaves below do. Nobody sings it: your ears make it.
        </div>
      )}
      {passed && <PassedNote iv={iv} rung={rung} />}
      {state === 'on' && (
        <div className="row" style={{ gap: 10 }}>
          {rung === 3 && <button className="btn grow" disabled={hinting || !!result} data-testid="lab-hint" onClick={() => void hint()}>{hinting ? 'Listen…' : 'Hear it once'}</button>}
          {result && <button className="btn primary grow" data-testid="lab-next" onClick={() => again()}>Next round</button>}
        </div>
      )}
      <span className="tiny muted">To pass: {PASS} of the last {ROUNDS} within {tol}¢ of pure{chordRung ? ', with the wobble off' : ''}. Hold it {HOLD_SEC} s, straight tone (no vibrato).</span>
    </main>
  );
}

function hintInterval(d: Degree) {
  return d === 'mi' ? 'a major third above do' : d === 'sol' ? 'a fifth above do' : 'the root, under the other two';
}

function HoldRing({ held }: { held: number }) {
  const f = Math.min(1, held / HOLD_SEC);
  const C = 2 * Math.PI * 30;
  return (
    <div className="row" style={{ gap: 14 }}>
      <svg width={72} height={72} viewBox="0 0 72 72" role="img" aria-label={`Held ${held.toFixed(1)} of ${HOLD_SEC} seconds`} data-testid="lab-hold">
        <circle cx={36} cy={36} r={30} fill="none" stroke="var(--line)" strokeWidth={7} />
        <circle cx={36} cy={36} r={30} fill="none" stroke="var(--accent)" strokeWidth={7} strokeLinecap="round"
          strokeDasharray={`${(C * f).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 36 36)" />
        <text x={36} y={41} textAnchor="middle" fontSize={15} fontWeight={600} fill="var(--text)" fontFamily="var(--mono)">{(HOLD_SEC * f).toFixed(1)}s</text>
      </svg>
      <div className="col grow" style={{ gap: 2 }}>
        <strong className="small">Hold it steady for {HOLD_SEC} s</strong>
        <span className="tiny muted">The app takes what you hold and shows where you landed.</span>
      </div>
    </div>
  );
}
