import React, { useEffect, useRef, useState } from 'react';
import { Tuner, letterName } from './Tuner';
import { getTracker, estimateLatencyMs } from '../play/session';
import { getAudioContext, unlockAudio } from '../../audio/context';
import { scheduleClick, scheduleVoice, synthBus } from '../../audio/synth';
import { NOTE_SEC, PATTERN, STEP, judgePattern, shouldStop, suggestVoice, summarize, type PatternResult, type Verdict } from '../../game/rangecheck';
import type { RawPitch } from '../../audio/pitch';
import { useProfile } from '../hooks';

type Phase = 'comfortable' | 'middle' | 'high' | 'low' | 'done';
type RoundState = 'idle' | 'listen' | 'sing' | 'judging';

const COLOR: Record<Verdict, string> = { good: 'var(--voice)', shaky: '#E8B86A', missed: '#FF7A45' };
const MAX_ROUNDS = 8;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The voice range check, as four short guided steps: one comfortable note, then a little pattern
 * (1-2-3-2-1) the app plays and you sing back, in the middle, going up a step at a time, and going
 * down. Each round is judged for pitch, steadiness and loudness.
 */
export function RangeCheck({ onDone, onSkip }: { onDone: (range: { lo: number; hi: number } | null) => void; onSkip: () => void }) {
  const [profile] = useProfile();
  const [phase, setPhase] = useState<Phase>('comfortable');
  const [comfy, setComfy] = useState<number | null>(null);
  const [hold, setHold] = useState(0);
  const [round, setRound] = useState<RoundState>('idle');
  const [rounds, setRounds] = useState<{ phase: Phase; r: PatternResult }[]>([]);
  const [error, setError] = useState('');
  const stopRef = useRef(false);
  const cancelRef = useRef(false);
  const stable = useRef<{ midi: number; since: number; xs: number[] } | null>(null);
  useEffect(() => {
    cancelRef.current = false; // (re)mounted, e.g. after React's development double-mount
    return () => { cancelRef.current = true; };
  }, []);

  // Step 1: hold a comfortable note for 1.5 s.
  function onReading(p: RawPitch) {
    if (phase !== 'comfortable' || comfy !== null) return;
    if (p.midi == null) { stable.current = null; setHold(0); return; }
    const now = performance.now();
    if (!stable.current || Math.abs(stable.current.midi - p.midi) > 0.5) { stable.current = { midi: p.midi, since: now, xs: [p.midi] }; setHold(0); return; }
    stable.current.xs.push(p.midi);
    const f = Math.min(1, (now - stable.current.since) / 1500);
    setHold(f);
    if (f >= 1) {
      const xs = [...stable.current.xs].sort((a, b) => a - b);
      setComfy(Math.round(xs[xs.length >> 1]));
    }
  }

  /** Play one pattern, listen to the answer, judge it. `dir` −1 = the pattern goes down from `top`. */
  async function playRound(top: number, dir: 1 | -1, ph: Phase): Promise<PatternResult | null> {
    try {
      await unlockAudio();
      const ctx = getAudioContext();
      const tracker = await getTracker();
      tracker.configureFor(null);
      const notes = PATTERN.map((x) => top + dir * x);
      const judgeRoot = dir > 0 ? top : top - 4;
      const out = synthBus(ctx);
      const t0 = ctx.currentTime + 0.25;
      notes.forEach((m, k) => scheduleVoice(ctx, out, m, t0 + k * NOTE_SEC, NOTE_SEC * 0.9, { timbre: 'guide' }));
      const respStart = t0 + PATTERN.length * NOTE_SEC + 0.55;
      scheduleClick(ctx, out, respStart - 0.02, true, 0.35);
      const lat = (profile.latencyMs || estimateLatencyMs()) / 1000;
      const respEnd = respStart + PATTERN.length * NOTE_SEC + 0.6;
      const readings: { midi: number | null; rms: number }[] = [];
      const off = tracker.onPitch((p) => {
        const t = p.ctxTime - lat;
        if (t >= respStart + 0.05 && t <= respEnd) readings.push({ midi: p.midi, rms: p.rms });
      });
      setRound('listen');
      await sleep(Math.max(0, (respStart - ctx.currentTime) * 1000));
      if (cancelRef.current) { off(); return null; }
      setRound('sing');
      await sleep(Math.max(0, (respEnd + lat - ctx.currentTime) * 1000 + 100));
      off();
      if (cancelRef.current) return null;
      setRound('judging');
      const r = judgePattern(judgeRoot, readings);
      setRounds((rs) => [...rs, { phase: ph, r }]);
      setRound('idle');
      return r;
    } catch (e) {
      console.error(e);
      setError('The microphone or audio could not be started.');
      setRound('idle');
      return null;
    }
  }

  async function runPhase(ph: Phase) {
    if (comfy === null) return;
    stopRef.current = false;
    // "Again" replaces this step's rounds.
    setRounds((rs) => rs.filter((x) => x.phase !== ph));
    if (ph === 'middle') {
      await playRound(comfy - 2, 1, ph);
      return;
    }
    const dir = ph === 'high' ? 1 : -1;
    const done: PatternResult[] = [];
    // Up: patterns from your comfortable note upwards; down: from it downwards.
    let top = ph === 'high' ? comfy : comfy;
    for (let i = 0; i < MAX_ROUNDS && !cancelRef.current; i++) {
      const r = await playRound(top, dir as 1 | -1, ph);
      if (!r) return;
      done.push(r);
      if (stopRef.current || shouldStop(done)) break;
      top += dir * STEP;
      await sleep(400);
    }
    if (!cancelRef.current) setRound('idle');
  }

  const summary = summarize(rounds.map((x) => x.r));
  // A "range" of a note or two isn't worth keeping.
  const usable = !!summary.steady && summary.steady.hi - summary.steady.lo >= 3;
  const busy = round !== 'idle';
  const stepNo = { comfortable: 1, middle: 2, high: 3, low: 4, done: 4 }[phase];
  const phaseRounds = rounds.filter((x) => x.phase === phase);
  const lastDone = phaseRounds.length > 0 && !busy;

  return (
    <div className="col" style={{ gap: 14 }} data-testid="range-check">
      <div className="row tiny" style={{ gap: 6, flexWrap: 'wrap' }} aria-label={`Range check, part ${stepNo} of 4`}>
        {['Comfortable', 'Middle', 'Up', 'Down'].map((n, k) => (
          <span key={n} style={{ fontWeight: k + 1 === stepNo ? 800 : 500, color: k + 1 === stepNo ? 'var(--accent)' : k + 1 < stepNo ? 'var(--voice)' : 'var(--muted)' }}>
            {k + 1 < stepNo ? '✓ ' : ''}{n}{k < 3 ? ' ·' : ''}
          </span>
        ))}
      </div>
      {phase === 'comfortable' && (
        <>
          <h1 className="hero" style={{ margin: 0 }}>Sing one comfortable note</h1>
          <span className="small">Any “ah” that feels easy, and hold it for two seconds.</span>
          <Tuner notation="letter" onReading={onReading} />
          {comfy === null ? (
            <div className="bar" aria-label="Holding"><span style={{ width: `${hold * 100}%` }} /></div>
          ) : (
            <div className="notice info" role="status">Got it: <strong>{letterName(comfy)}</strong>. Next, a short tune to sing back.</div>
          )}
          <div className="row" style={{ marginTop: 'auto' }}>
            <button className="btn ghost" onClick={onSkip}>Skip the range check</button>
            <button className="btn primary grow" disabled={comfy === null} onClick={() => setPhase('middle')} data-testid="range-next">Next</button>
          </div>
        </>
      )}

      {(phase === 'middle' || phase === 'high' || phase === 'low') && (
        <>
          <h1 className="hero" style={{ margin: 0 }}>
            {phase === 'middle' ? 'Listen, then sing it back' : phase === 'high' ? 'Going up, a step at a time' : 'Going down, a step at a time'}
          </h1>
          <span className="small">
            {phase === 'middle' && 'Five notes, around your comfortable note. Sing them back on “la” after the click.'}
            {phase === 'high' && <>Each round starts a step higher. <strong>Only what's comfortable: stop when it gets tight. Don't push.</strong></>}
            {phase === 'low' && <>Each round starts a step lower. Low notes get quieter, that's fine. <strong>Stop when it starts to croak.</strong></>}
          </span>
          <div className="card" style={{ alignItems: 'center', textAlign: 'center', gap: 6 }} aria-live="polite">
            <span style={{ fontSize: 28, fontWeight: 800, color: round === 'sing' ? 'var(--accent)' : undefined }}>
              {round === 'listen' ? 'Listen…' : round === 'sing' ? 'Your turn: sing it back' : round === 'judging' ? '…' : lastDone ? 'Round done' : 'Ready'}
            </span>
            <span className="tiny muted">Headphones help: the app only listens while it's your turn.</span>
          </div>
          {phaseRounds.length > 0 && (
            <div className="row wrap" style={{ gap: 6 }}>
              {phaseRounds.map(({ r }, k) => {
                const lo = r.root;
                const hi = r.root + 4;
                return (
                  <span key={k} className="chip" style={{ borderColor: COLOR[r.verdict], color: COLOR[r.verdict] }}>
                    {letterName(lo)}–{letterName(hi)} {r.verdict === 'good' ? '✓' : r.verdict === 'shaky' ? '~' : '✗'}
                  </span>
                );
              })}
            </div>
          )}
          {phaseRounds.length > 0 && !busy && phaseRounds[phaseRounds.length - 1].r.verdict !== 'good' && (
            <span className="tiny muted">
              {phaseRounds[phaseRounds.length - 1].r.notes.filter((n) => n.verdict !== 'good').map((n) =>
                `${letterName(n.midi)}: ${n.verdict === 'missed' ? 'not heard' : `${n.cents! > 0 ? '+' : ''}${n.cents}¢${n.spread! > 30 ? ', unsteady' : ''}`}`).join(' · ')}
            </span>
          )}
          <div className="row" style={{ marginTop: 'auto' }}>
            {(phase === 'high' || phase === 'low') && busy && (
              <button className="btn grow" onClick={() => { stopRef.current = true; }} data-testid="range-stop">
                {phase === 'high' ? "That's my top" : "That's my bottom"}
              </button>
            )}
            {!busy && (
              <>
                {phaseRounds.length ? (
                  <>
                    <button className="btn" onClick={() => runPhase(phase)}>Again</button>
                    <button className="btn primary grow" data-testid="range-next"
                      onClick={() => setPhase(phase === 'middle' ? 'high' : phase === 'high' ? 'low' : 'done')}>
                      {phase === 'low' ? 'See my range' : 'Next'}
                    </button>
                  </>
                ) : (
                  <button className="btn primary grow" data-testid="range-start" onClick={() => runPhase(phase)}>Start</button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {phase === 'done' && (
        <>
          <h1 className="hero" style={{ margin: 0 }}>Your range</h1>
          <VerdictStrip notes={summary.notes} />
          <div className="col small" style={{ gap: 4 }}>
            <span><strong>In tune and steady:</strong> {usable ? `${letterName(summary.steady!.lo)} – ${letterName(summary.steady!.hi)}` : 'not enough to tell yet. Try again with headphones, singing each note back clearly.'}
              {summary.steady && summary.steady.hi - summary.steady.lo >= 7 ? ` (that sounds like ${{ S: 'a soprano', A: 'an alto', T: 'a tenor', B: 'a bass' }[suggestVoice(summary.steady.lo, summary.steady.hi)]})` : ''}</span>
            {summary.reach && summary.steady && (summary.reach.lo < summary.steady.lo || summary.reach.hi > summary.steady.hi) && (
              <span className="muted">You also reached {letterName(summary.reach.lo)} – {letterName(summary.reach.hi)}, less steadily (amber).</span>
            )}
            <span className="tiny muted">The app uses the steady range, e.g. to pick the right analysis for your voice. Run it again any time from Settings.</span>
          </div>
          <div className="row" style={{ marginTop: 'auto' }}>
            <button className="btn" onClick={() => { setRounds([]); setComfy(null); setPhase('comfortable'); }}>Start over</button>
            <button className="btn primary grow" onClick={() => onDone(usable ? summary.steady : null)} data-testid="range-done">Continue</button>
          </div>
        </>
      )}
      {error && <div className="notice" role="alert">{error}</div>}
    </div>
  );
}

function VerdictStrip({ notes }: { notes: Map<number, Verdict> }) {
  const keys = [];
  for (let m = 36; m <= 84; m++) {
    if ([1, 3, 6, 8, 10].includes(m % 12) && !notes.has(m)) continue;
    const v = notes.get(m);
    keys.push(<span key={m} title={letterName(m)} style={{ flex: '1 1 0', borderRadius: 3, background: v ? COLOR[v] : 'var(--surface-2)', borderBottom: m % 12 === 0 ? '2px solid var(--muted)' : undefined }} />);
  }
  return <div style={{ display: 'flex', gap: 2, height: 36 }} aria-hidden="true">{keys}</div>;
}
