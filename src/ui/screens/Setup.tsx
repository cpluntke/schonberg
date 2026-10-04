import React, { useState } from 'react';
import { useProfile, useStoreVersion } from '../hooks';
import { loadCycle, saveCycle } from '../../progress/store';
import { allPieces } from '../library';
import { IntroVideoButton, introSeen } from '../components/IntroVideo';
import { go, back } from '../router';
import { RangeCheck } from '../components/RangeCheck';
import { getTracker } from '../play/session';
import { getAudioContext, unlockAudio } from '../../audio/context';
import { measureLatency } from '../../audio/latency';
import type { VoiceType } from '../../music/types';
import type { NotationMode } from '../../game/notation';
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

/** Once the singer sets their own dates, it's no longer the demo cycle. */
function renamed<T extends { name: string }>(c: T): T {
  return c.name === 'Demo cycle' ? { ...c, name: 'This cycle' } : c;
}

export function Setup() {
  const [profile, update] = useProfile();
  useStoreVersion();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name);
  const [range, setRange] = useState<{ lo: number; hi: number } | null>(
    profile.rangeLow && profile.rangeHigh ? { lo: profile.rangeLow, hi: profile.rangeHigh } : null,
  );
  const [lat, setLat] = useState<{ state: 'idle' | 'running' | 'done' | 'fail'; beat: number; ms: number }>({ state: 'idle', beat: 0, ms: profile.latencyMs });
  const steps = 4;

  async function runLatency() {
    setLat({ state: 'running', beat: 0, ms: 0 });
    try {
      await unlockAudio();
      const t = await getTracker();
      t.configureFor(null); // full window: any voice, down to the bass range
      const res = await measureLatency(getAudioContext(), t, (i) => setLat((l) => ({ ...l, beat: i + 1 })));
      if (res.ok) {
        update({ latencyMs: Math.round(res.latencyMs), latencySource: 'measured' });
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
          {!introSeen() && <IntroVideoButton label="New here? Watch the 1½-minute intro" className="btn block" />}
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
              <input type="date" value={loadCycle().rehearsalDate ?? ''} onChange={(e) => saveCycle(renamed({ ...loadCycle(), rehearsalDate: e.target.value || undefined }))} />
            </label>
            <label className="field grow"><span>Concert (optional)</span>
              <input type="date" value={loadCycle().concertDate ?? ''} onChange={(e) => saveCycle(renamed({ ...loadCycle(), concertDate: e.target.value || undefined }))} />
            </label>
          </div>
          {(() => {
            const c = loadCycle();
            const d = new Date();
            const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (c.rehearsalDate && c.concertDate && c.concertDate < c.rehearsalDate) return <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>The concert is before the rehearsal: check the dates.</span>;
            if ([c.rehearsalDate, c.concertDate].some((d) => d && d < today)) return <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>That date is in the past.</span>;
            return null;
          })()}
          <span className="tiny muted">With dates, Home tells you how many sections to learn per day.</span>
          <div className="col">
            <span className="small">Pieces your choir is singing this cycle</span>
            <div className="chips" role="group" aria-label="Pieces in this cycle">
              {allPieces().map((pc) => {
                const on = loadCycle().pieceIds.includes(pc.id);
                return (
                  <button key={pc.id} className="chip" aria-pressed={on} onClick={() => {
                    const c = loadCycle();
                    c.pieceIds = on ? c.pieceIds.filter((x) => x !== pc.id) : [...c.pieceIds, pc.id];
                    saveCycle(c);
                  }}>{pc.title.length > 26 ? pc.title.slice(0, 24) + '…' : pc.title}</button>
                );
              })}
            </div>
            <span className="tiny muted">Your own scores can be imported later in the Library.</span>
          </div>
          <button className="btn primary block" style={{ marginTop: 'auto' }} onClick={() => setStep(1)}>Continue</button>
        </>
      )}

      {step === 1 && (
        <RangeCheck
          onSkip={() => setStep(2)}
          onDone={(r) => {
            // Keep it right away, even if setup isn't finished.
            if (r) { setRange(r); update({ rangeLow: r.lo, rangeHigh: r.hi }); }
            setStep(2);
          }}
        />
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
