import React, { useEffect, useState } from 'react';
import { trackStep } from '../../progress/metrics';
import { useProfile, useStoreVersion } from '../hooks';
import { loadCycle, saveCycle, type Profile } from '../../progress/store';
import { apiBase, cachedChoir, choirCycleNow, leaveChoir } from '../../progress/choir';
import { JoinChoir } from './Choir';
import { allPieces } from '../library';
import { IntroVideoButton, introSeen } from '../components/IntroVideo';
import { go, back } from '../router';
import { RangeCheck } from '../components/RangeCheck';
import { micErrorText } from '../components/Tuner';
import { getTracker } from '../play/session';
import { shareMyProgress } from '../play/shareProgress';
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
  const [lat, setLat] = useState<{ state: 'idle' | 'running' | 'done' | 'fail'; beat: number; ms: number; mic?: string }>({ state: 'idle', beat: 0, ms: profile.latencyMs });
  const steps = 5;
  // Onboarding funnel (anonymous usage statistics): only the first setup of this install counts.
  const [firstSetup] = useState(() => !profile.onboarded);
  useEffect(() => { if (firstSetup) trackStep('setup_started'); }, [firstSetup]);
  const step1st = (s: Parameters<typeof trackStep>[0]) => { if (firstSetup) trackStep(s); };

  async function runLatency() {
    setLat({ state: 'running', beat: 0, ms: 0 });
    try {
      await unlockAudio();
      const t = await getTracker();
      t.configureFor(null); // full window: any voice, down to the bass range
      t.setLowestNote(null); // input filters for any voice
      t.setHint(null);
      const res = await measureLatency(getAudioContext(), t, (i) => setLat((l) => ({ ...l, beat: i + 1 })));
      if (res.ok) {
        update({ latencyMs: Math.round(res.latencyMs), latencySource: 'measured' });
        setLat({ state: 'done', beat: 0, ms: Math.round(res.latencyMs) });
      } else setLat({ state: 'fail', beat: 0, ms: 0 });
    } catch (e) {
      console.error(e);
      // No microphone (blocked, none, not https): say so, not "sing louder".
      setLat({ state: 'fail', beat: 0, ms: 0, mic: (e as { code?: string } | null)?.code ? micErrorText(e) : undefined });
    }
  }

  // A choir member is on the choir's leaderboard by first name: Skip can't go past the name.
  const needsName = !!profile.choirCode && !name.trim();
  function skip() {
    if (needsName) setStep(1);
    else finish();
  }

  function finish() {
    update({ name: name.trim(), onboarded: true, ...(range ? { rangeLow: range.lo, rangeHigh: range.hi } : {}) });
    go({ name: 'home' }, true);
  }

  return (
    <main className="screen" style={{ paddingBottom: 24 }}>
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => (step > 0 ? setStep(step - 1) : back())}><IconBack /></button>
        <span className="eyebrow grow">{step === 0 ? 'Setup' : 'Voice setup'} · {step + 1} of {steps}</span>
        <button className="btn ghost small" onClick={skip} data-testid="setup-skip">Skip</button>
      </div>
      <div className="steps" aria-hidden="true">
        {Array.from({ length: steps }, (_, i) => <span key={i} className={i < step ? 'done' : i === step ? 'cur' : ''} />)}
      </div>

      {step === 0 && (
        <ChoirStep profile={profile} update={update} onNext={() => { step1st('choir_step'); setStep(1); }} />
      )}

      {step === 1 && (
        <>
          <h1 className="hero">Who's singing?</h1>
          {!apiBase() && !introSeen() && <IntroVideoButton label="New here? Watch the 2½-minute intro" className="btn block" />}
          <label className="field">
            <span>Your name (shown on the choir leaderboard)</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" autoComplete="given-name" maxLength={40} autoFocus={needsName} />
          </label>
          {needsName && <span className="small" role="status" style={{ color: 'var(--accent-text)' }}>Your choir's leaderboard needs your first name.</span>}
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
          <span className="tiny muted">With dates, Home tells you how many passages to learn per day.</span>
          <div className="col">
            <span className="small">{choirCycleNow(cachedChoir()) && profile.choirCode && loadCycle().preset === `choir:${profile.choirCode}` ? `Pieces ${cachedChoir()!.name} is singing (from the choir; change them any time)` : 'Pieces your choir is singing this cycle'}</span>
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
            <span className="tiny muted">Your own scores can be imported later under Pieces.</span>
          </div>
          <button className="btn primary block" style={{ marginTop: 'auto' }} disabled={needsName}
            onClick={() => { update({ name: name.trim() }); setStep(2); }}>Continue</button>
        </>
      )}

      {step === 2 && (
        <RangeCheck
          onSkip={() => { step1st('range_skipped'); setStep(3); }}
          onDone={(r, reach) => {
            // Keep it right away, even if setup isn't finished.
            if (r) {
              setRange(r);
              update({ rangeLow: r.lo, rangeHigh: r.hi, rangeReachLow: reach?.lo, rangeReachHigh: reach?.hi, rangeAt: Date.now() });
              void shareMyProgress(true); // the section lead sees the new range now, not after the next run
            }
            step1st(r ? 'range_done' : 'range_skipped');
            setStep(3);
          }}
        />
      )}

      {step === 3 && (
        <>
          <h1 className="hero">Headphones &amp; delay</h1>
          <div className="card">
            <div className="row"><IconCheck color="var(--voice)" /><span><strong>Put on headphones.</strong> <span className="muted small">Wired is best. Without them the mic hears the other voices.</span></span></div>
            <div className="row"><IconCheck color="var(--voice)" /><span><strong>Measure the delay.</strong> <span className="muted small">You'll hear 6 clicks. Sing a short “ta” exactly on each click.</span></span></div>
          </div>
          <div className="card" style={{ alignItems: 'center' }}>
            {lat.state === 'running' ? (
              <>
                <span className="tuner-note" style={{ fontSize: '4rem' }}>{lat.beat || '…'}</span>
                <span className="small muted">Sing “ta” on every click</span>
              </>
            ) : lat.state === 'done' ? (
              <>
                <span className="mono" style={{ fontSize: '2.5rem', fontWeight: 600 }}>{lat.ms} ms</span>
                <span className="small muted">Saved. Scoring compensates for this delay.</span>
              </>
            ) : lat.state === 'fail' ? (
              <span className="small" role="status" style={{ color: 'var(--accent-text)', textAlign: 'center' }}>{lat.mic ?? 'Couldn\'t hear enough “ta”s. Sing louder and closer to the mic, then try again, or skip this step.'}</span>
            ) : (
              <span className="small muted">{profile.latencyMs ? `Current setting: ${profile.latencyMs} ms` : 'Not measured yet.'}</span>
            )}
            <button className="btn voice" disabled={lat.state === 'running'} onClick={runLatency}>
              {lat.state === 'done' || lat.state === 'fail' ? 'Measure again' : 'Start the clicks'}
            </button>
          </div>
          <button className="btn primary block" style={{ marginTop: 'auto' }} onClick={() => { step1st(lat.state === 'done' ? 'delay_done' : 'delay_skipped'); setStep(4); }}>Continue</button>
        </>
      )}

      {step === 4 && (
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

/** First step: the choir code (connects programme, scores and leaderboard), or practise alone. */
function ChoirStep({ profile, update, onNext }: { profile: Profile; update: (p: Partial<Profile>) => void; onNext: () => void }) {
  const choir = cachedChoir();
  const joined = !!profile.choirCode && choir?.code === profile.choirCode;
  if (!apiBase()) {
    return (
      <>
        <h1 className="hero">Welcome</h1>
        <span className="muted">This copy of the app works on its own: no choir server is connected.</span>
        <button className="btn primary block" style={{ marginTop: 'auto' }} onClick={onNext}>Continue</button>
      </>
    );
  }
  return (
    <>
      <h1 className="hero">Your choir</h1>
      {!introSeen() && <IntroVideoButton label="New here? Watch the 2½-minute intro" className="btn block" />}
      {joined ? (
        <div className="card" data-testid="setup-choir-joined">
          <span className="eyebrow">Joined</span>
          <strong style={{ fontSize: '1.25rem' }}>{choir!.name}</strong>
          {(choirCycleNow(choir) || choir!.pieces.length > 0) && (
            <span className="small muted">
              {choirCycleNow(choir) ? `Programme: ${choirCycleNow(choir)!.name}. ` : ''}{choir!.pieces.length ? (choir!.pieces.length === 1 ? '1 score from the choir is on its way to your phone.' : `${choir!.pieces.length} scores from the choir are on their way to your phone.`) : ''}
            </span>
          )}
          <span className="small" data-testid="setup-share-note">Being in the choir means sharing your practice: your section lead and the admins see which bars are hard for your section (as section totals; in a small section they may still tell which are yours) and your voice range by name, and everyone in the choir sees your first name, voice and readiness on the leaderboard.</span>
          <button className="linklike small" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={() => { leaveChoir(); update({}); }}>Wrong choir? Use a different code</button>
        </div>
      ) : (
        <div className="card">
          <span className="muted">Got a code from your choir? It brings in your choir's programme and its scores, and puts you on the choir's leaderboard: everyone in the choir sees your first name, voice and progress.</span>
          <JoinChoir onJoined={() => update({})} />
        </div>
      )}
      <button className="btn primary block" style={{ marginTop: 'auto' }} onClick={onNext} data-testid="choir-step-next">
        {joined ? 'Continue' : 'Practise on my own'}
      </button>
      {!joined && <span className="tiny muted" style={{ textAlign: 'center' }}>You can join a choir later on the Choir tab.</span>}
    </>
  );
}
