import React, { useRef, useState } from 'react';
import { useProfile, useStoreVersion } from '../hooks';
import { loadCycle, saveCycle } from '../../progress/store';
import { go, back } from '../router';
import { Tuner, letterName } from '../components/Tuner';
import { getTracker } from '../play/session';
import { getAudioContext, unlockAudio } from '../../audio/context';
import { measureLatency } from '../../audio/latency';
import type { VoiceType } from '../../music/types';
import type { NotationMode } from '../../game/notation';
import type { RawPitch } from '../../audio/pitch';
import { IconBack, IconCheck } from '../icons';

const VOICES: { v: VoiceType; name: string; range: string }[] = [
  { v: 'S', name: 'Soprano', range: 'C4–A5' },
  { v: 'A', name: 'Alto', range: 'G3–D5' },
  { v: 'T', name: 'Tenor', range: 'C3–A4' },
  { v: 'B', name: 'Bass', range: 'E2–D4' },
];

export const NOTATIONS: { mode: NotationMode; big: string; sub: string }[] = [
  { mode: 'letter', big: 'C D E F', sub: 'Letters' },
  { mode: 'fixed', big: 'Do Re Mi', sub: 'Fixed do' },
  { mode: 'movable', big: 'Do Re Mi', sub: 'Movable do (la-minor)' },
  { mode: 'jianpu', big: '1 2 3 4', sub: 'Jianpu (numbered)' },
  { mode: 'pc', big: '0 1 2 … e', sub: 'Pitch classes' },
];

function suggestVoice(lo: number, hi: number): VoiceType {
  const mid = (lo + hi) / 2;
  if (mid >= 67) return 'S';
  if (mid >= 61) return 'A';
  if (mid >= 54) return 'T';
  return 'B';
}

export function Setup() {
  const [profile, update] = useProfile();
  useStoreVersion();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name);
  const [range, setRange] = useState<{ lo: number; hi: number } | null>(
    profile.rangeLow && profile.rangeHigh ? { lo: profile.rangeLow, hi: profile.rangeHigh } : null,
  );
  const stable = useRef<{ midi: number; since: number } | null>(null);
  const [lat, setLat] = useState<{ state: 'idle' | 'running' | 'done' | 'fail'; beat: number; ms: number }>({ state: 'idle', beat: 0, ms: profile.latencyMs });
  const steps = 4;

  function onReading(p: RawPitch) {
    if (p.midi == null) { stable.current = null; return; }
    const r = Math.round(p.midi);
    const now = performance.now();
    if (!stable.current || Math.abs(stable.current.midi - p.midi) > 0.6) { stable.current = { midi: p.midi, since: now }; return; }
    if (now - stable.current.since > 350) {
      setRange((cur) => {
        if (!cur) return { lo: r, hi: r };
        if (r < cur.lo || r > cur.hi) return { lo: Math.min(cur.lo, r), hi: Math.max(cur.hi, r) };
        return cur;
      });
    }
  }

  async function runLatency() {
    setLat({ state: 'running', beat: 0, ms: 0 });
    try {
      await unlockAudio();
      const t = await getTracker();
      const res = await measureLatency(getAudioContext(), t, (i) => setLat((l) => ({ ...l, beat: i + 1 })));
      if (res.ok) {
        update({ latencyMs: Math.round(res.latencyMs) });
        setLat({ state: 'done', beat: 0, ms: Math.round(res.latencyMs) });
      } else setLat({ state: 'fail', beat: 0, ms: 0 });
    } catch (e) {
      console.error(e);
      setLat({ state: 'fail', beat: 0, ms: 0 });
    }
  }

  function finish() {
    update({ name: name.trim(), onboarded: true, ...(range ? { rangeLow: range.lo, rangeHigh: range.hi } : {}) });
    go({ name: 'home' }, true);
  }

  return (
    <main className="screen" style={{ paddingBottom: 24 }}>
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => (step > 0 ? setStep(step - 1) : back())}><IconBack /></button>
        <span className="eyebrow grow">Voice setup · {step + 1} of {steps}</span>
        <button className="btn ghost small" onClick={finish}>Skip</button>
      </div>
      <div className="steps" aria-hidden="true">
        {Array.from({ length: steps }, (_, i) => <span key={i} className={i < step ? 'done' : i === step ? 'cur' : ''} />)}
      </div>

      {step === 0 && (
        <>
          <h1 className="hero">Who's singing?</h1>
          <label className="field">
            <span>Your name (shown on the choir leaderboard)</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" autoComplete="given-name" maxLength={40} />
          </label>
          <div className="col">
            <span className="small">Your voice part</span>
            <div className="choice-grid">
              {VOICES.map((v) => (
                <button key={v.v} className="choice" aria-pressed={profile.voice === v.v} onClick={() => update({ voice: v.v })}>
                  <span className="big">{v.name}</span><span className="sub">{v.range}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <label className="field grow"><span>Next rehearsal (optional)</span>
              <input type="date" value={loadCycle().rehearsalDate ?? ''} onChange={(e) => saveCycle({ ...loadCycle(), rehearsalDate: e.target.value || undefined })} />
            </label>
            <label className="field grow"><span>Concert (optional)</span>
              <input type="date" value={loadCycle().concertDate ?? ''} onChange={(e) => saveCycle({ ...loadCycle(), concertDate: e.target.value || undefined })} />
            </label>
          </div>
          <span className="tiny muted">With dates, Home tells you how many sections to learn per day.</span>
          <button className="btn primary block" style={{ marginTop: 'auto' }} onClick={() => setStep(1)}>Continue</button>
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="hero">Sing a comfortable “ah”</h1>
          <Tuner notation="letter" onReading={onReading} />
          <div className="col">
            <div className="row between small">
              <strong>Your range so far</strong>
              <span className="mono muted">{range ? `${letterName(range.lo)} – ${letterName(range.hi)}` : '–'}</span>
            </div>
            <RangeStrip range={range} />
            <span className="small muted">
              Slide slowly from your lowest to your highest comfortable note.
              {range && range.hi - range.lo >= 7 ? ` That sounds like a ${VOICES.find((v) => v.v === suggestVoice(range.lo, range.hi))?.name.toLowerCase()} range.` : ''}
            </span>
          </div>
          <div className="row" style={{ marginTop: 'auto' }}>
            {range && <button className="btn" onClick={() => setRange(null)}>Reset range</button>}
            <button className="btn primary grow" onClick={() => setStep(2)}>Continue</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="hero">Headphones &amp; delay</h1>
          <div className="card">
            <div className="row"><IconCheck color="#4CC9F0" /><span><strong>Put on headphones.</strong> <span className="muted small">Wired is best. Without them the mic hears the other voices.</span></span></div>
            <div className="row"><IconCheck color="#4CC9F0" /><span><strong>Measure the delay.</strong> <span className="muted small">You'll hear 6 clicks. Sing a short “ta” exactly on each click.</span></span></div>
          </div>
          <div className="card" style={{ alignItems: 'center' }}>
            {lat.state === 'running' ? (
              <>
                <span className="tuner-note" style={{ fontSize: 64 }}>{lat.beat || '…'}</span>
                <span className="small muted">Sing “ta” on every click</span>
              </>
            ) : lat.state === 'done' ? (
              <>
                <span className="mono" style={{ fontSize: 40, fontWeight: 600 }}>{lat.ms} ms</span>
                <span className="small muted">Saved. Scoring compensates for this delay.</span>
              </>
            ) : lat.state === 'fail' ? (
              <span className="small" style={{ color: 'var(--accent-text)', textAlign: 'center' }}>Couldn't hear enough “ta”s. Sing louder and closer to the mic, then try again, or skip this step.</span>
            ) : (
              <span className="small muted">{profile.latencyMs ? `Current setting: ${profile.latencyMs} ms` : 'Not measured yet.'}</span>
            )}
            <button className="btn voice" disabled={lat.state === 'running'} onClick={runLatency}>
              {lat.state === 'done' || lat.state === 'fail' ? 'Measure again' : 'Start the clicks'}
            </button>
          </div>
          <button className="btn primary block" style={{ marginTop: 'auto' }} onClick={() => setStep(3)}>Continue</button>
        </>
      )}

      {step === 3 && (
        <>
          <h1 className="hero">How do you read notes?</h1>
          <div className="choice-grid">
            {NOTATIONS.map((n) => (
              <button key={n.mode} className="choice" aria-pressed={profile.notation === n.mode} onClick={() => update({ notation: n.mode })}>
                <span className="big">{n.big}</span><span className="sub">{n.sub}</span>
              </button>
            ))}
          </div>
          <span className="small muted">You can change this at any time in Settings. Movable do and jianpu follow key changes in the score.</span>
          <button className="btn primary block" style={{ marginTop: 'auto' }} onClick={finish} data-testid="setup-done">Done: let's sing</button>
        </>
      )}
    </main>
  );
}

function RangeStrip({ range }: { range: { lo: number; hi: number } | null }) {
  const LO = 36; // C2
  const HI = 84; // C6
  const keys = [];
  for (let m = LO; m <= HI; m++) {
    if ([1, 3, 6, 8, 10].includes(m % 12)) continue;
    const inR = range && m >= range.lo && m <= range.hi;
    keys.push(<span key={m} style={{ flex: '1 1 0', borderRadius: 3, background: inR ? 'var(--voice-deep)' : 'var(--surface-2)', borderBottom: m % 12 === 0 ? '2px solid var(--muted)' : undefined }} />);
  }
  return <div style={{ display: 'flex', gap: 2, height: 36 }} aria-hidden="true">{keys}</div>;
}
