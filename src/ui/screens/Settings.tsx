import { toleranceWords } from '../../game/pitchwords';
import React, { useRef, useState } from 'react';
import { setLastRun } from '../play/runExport';
import { useProfile, useStoreVersion, toast, daysUntil, useWide } from '../hooks';
import { nextRehearsal, WEEKDAYS } from '../../progress/rehearsal';
import { getPiece } from '../library';
import { back, go } from '../router';
import { IconBack } from '../icons';
import { loadCycle, saveCycle, exportBackup, importBackup } from '../../progress/store';
import { cachedChoir, loadSuperSession, superLogout } from '../../progress/choir';
import { useSession } from './Choir';
import { effectiveTolerance } from '../../progress/ladder';
import { NOTATIONS } from './Setup';
import { noteLabel } from '../../game/notation';
import { IntroVideoButton } from '../components/IntroVideo';
import { AccountSync } from '../components/AccountSync';
import { UsageStats } from '../components/UsageStats';
import { weekGoalOf } from '../today';

export function Settings() {
  const [profile, update] = useProfile();
  const wide = useWide();
  useStoreVersion();
  useSession(); // the super-admin login below
  const cycle = loadCycle();
  const [backupText, setBackupText] = useState('');
  // The delay field while typing ('' when cleared), so it never shows "0120".
  const [delayText, setDelayText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dMajor = { beat: 0, time: 0, fifths: 2, mode: 'major' as const };

  const setCycle = (patch: Partial<typeof cycle>) => {
    const c = { ...loadCycle(), ...patch };
    if (c.name === 'Demo cycle' && (patch.rehearsalDate || patch.concertDate || patch.rehearsalWeekday != null)) c.name = 'This cycle';
    saveCycle(c);
  };

  function download() {
    const blob = new Blob([exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `schonberg-hero-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function restore(text: string) {
    // Check the file first: only a real backup asks to replace anything.
    const bad = backupProblem(text);
    if (bad) {
      toast(bad);
      return;
    }
    if (!confirm('Replace your current progress and settings with this backup?')) return;
    try {
      importBackup(text);
      toast('Backup restored');
      setBackupText('');
    } catch (e) {
      toast((e as Error).message || 'That is not a valid backup');
    }
  }

  return (
    <main className="screen wide settings">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => back()}><IconBack /></button>
        <h1>Settings</h1>
      </div>

      {/* In the order of the You sheet's rows (each opens its part here). Wide screens: two columns of cards. */}
      <div className="lay settings-cols">
      <div className="lay settings-col">
      <section className="col" style={{ gap: 8 }} id="settings-voice">
        <h2 className="eyebrow">You &amp; voice</h2>
        <div className="toggle-row"><span>Name</span><span className="muted">{profile.name || '–'}</span></div>
        <div className="toggle-row"><span>Voice part</span>
          <select aria-label="Voice part" value={profile.voice} onChange={(e) => update({ voice: e.target.value as typeof profile.voice })}
            style={{ minHeight: 40, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 8px' }}>
            <option value="S">Soprano</option><option value="A">Alto</option><option value="T">Tenor</option><option value="B">Bass</option>
          </select>
        </div>
        <label className="toggle-row"><span>Headphone/mic delay (ms)</span>
          <input type="number" min={0} max={600} step={5} value={delayText ?? String(profile.latencyMs)} aria-label="Delay in milliseconds"
            onChange={(e) => {
              const ms = Math.max(0, Math.min(600, Math.round(Number(e.target.value)) || 0));
              setDelayText(e.target.value.trim() === '' ? '' : String(ms));
              update({ latencyMs: ms, latencySource: 'measured' });
            }}
            onBlur={() => setDelayText(null)}
            style={{ width: 90, minHeight: 40, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 8px' }} />
        </label>
        <label className="toggle-row"><span>Practice beat<span className="tiny muted" style={{ display: 'block' }}>A soft click keeps the tempo where you sing on your own.</span></span>
          <select aria-label="Practice beat" value={profile.beat ?? 'alone'} onChange={(e) => update({ beat: e.target.value as 'off' | 'alone' | 'always' })}
            style={{ minHeight: 40, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 8px' }}>
            <option value="alone">When I sing alone</option>
            <option value="always">Always</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="toggle-row"><span>Keep a recording of my last run<span className="tiny muted" style={{ display: 'block' }}>Only on this phone, so you can share it if the scoring seems off.</span></span>
          <input type="checkbox" checked={profile.keepRecording !== false} onChange={(e) => { update({ keepRecording: e.target.checked }); if (!e.target.checked) setLastRun(null); }} />
        </label>
        <div className="row">
          <button className="btn small grow" onClick={() => go({ name: 'setup' })}>Run voice setup again</button>
          <button className="btn small grow" onClick={() => go({ name: 'tuner' })}>Tuner</button>
        </div>
      </section>

      <section className="col" style={{ gap: 8 }} id="settings-practice" data-testid="settings-week-goal">
        <h2 className="eyebrow" id="settings-goal-label">Your week</h2>
        <span className="t14">Days a week you mean to practise (a rehearsal you were at counts too)</span>
        <div className="seg" role="group" aria-labelledby="settings-goal-label">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button key={n} aria-pressed={weekGoalOf(profile.weekGoal) === n} aria-label={`${n} day${n === 1 ? '' : 's'} a week`} onClick={() => update({ weekGoal: n })}>{n}</button>
          ))}
        </div>
        <button className="link start" data-testid="settings-progress" onClick={() => go({ name: 'progress' })}>See your progress ›</button>
      </section>

      <section className="col" style={{ gap: 8 }}>
        <h2 className="eyebrow">Note names</h2>
        <div className="choice-grid">
          {NOTATIONS.map((n) => (
            <button key={n.mode} className="choice" aria-pressed={profile.notation === n.mode} onClick={() => update({ notation: n.mode })}>
              <span className="big">{[62, 64, 66, 67].map((m) => noteLabel(m, n.mode, dMajor).text).join(' ')}</span>
              <span className="sub">{n.sub}</span>
            </button>
          ))}
        </div>
        <span className="small muted" data-testid="notation-example">Shown with the same four notes, D E F♯ G (in D major), as an example. In practice, movable do and the numbers follow each piece's own key, key changes included.</span>
      </section>

      <section className="col" style={{ gap: 8 }}>
        <h2 className="eyebrow">Strictness</h2>
        <div className="seg" role="group" aria-label="Strictness">
          {(['forgiving', 'standard', 'strict'] as const).map((s) => (
            <button key={s} aria-pressed={profile.strictness === s} onClick={() => update({ strictness: s })}>
              {s[0].toUpperCase() + s.slice(1)}
              <span className="sub">{effectiveTolerance(4, 'tempo', s)} cents at Level 4</span>
            </button>
          ))}
        </div>
        <span className="small muted">
          Scales the pitch tolerance of every level: at Level 4 · Concert a note may now be up to {toleranceWords(effectiveTolerance(4, 'tempo', profile.strictness))} off
          (at Level 1 · Notes up to {toleranceWords(effectiveTolerance(1, 'slow', profile.strictness))}). Levels passed on “forgiving” still count.
        </span>
      </section>

      <section className="col" style={{ gap: 8 }}>
        <h2 className="eyebrow">Tuning target</h2>
        <button className="choice" aria-pressed={profile.tuning === 'equal'} onClick={() => update({ tuning: 'equal' })}>
          <span className="big" style={{ fontSize: 15 }}>Equal temperament</span>
          <span className="sub">Score against the piano</span>
        </button>
        <button className="choice" aria-pressed={profile.tuning === 'just'} onClick={() => update({ tuning: 'just' })}>
          <span className="big" style={{ fontSize: 15 }}>Just intonation (chord-aware)</span>
          <span className="sub">Major thirds 14¢ low, fifths pure: tuned to the chord the others are singing</span>
        </button>
      </section>

      <section className="col" style={{ gap: 8 }} id="settings-cycle">
        <h2 className="eyebrow">This cycle</h2>
        <label className="field"><span>Name</span>
          <input type="text" value={cycle.name} onChange={(e) => setCycle({ name: e.target.value })} placeholder="e.g. Spring concert" />
        </label>
        {!profile.choirCode && <span className="tiny muted">A new name starts a new cycle: your “notes right this cycle” start again from 0.</span>}
        <div className="row">
          <label className="field grow"><span>Rehearsals</span>
            <select value={cycle.rehearsalWeekday ?? -1} aria-label="Rehearsal day"
              onChange={(e) => { const v = Number(e.target.value); setCycle({ rehearsalWeekday: v < 0 ? undefined : v, rehearsalTime: cycle.rehearsalTime ?? '19:30' }); }}>
              <option value={-1}>One-off date</option>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>Every {d}</option>)}
            </select>
          </label>
          {cycle.rehearsalWeekday != null ? (
            <label className="field grow"><span>Time</span>
              <input type="time" value={cycle.rehearsalTime ?? '19:30'} onChange={(e) => setCycle({ rehearsalTime: e.target.value || '19:30' })} />
            </label>
          ) : (
            <label className="field grow"><span>Next rehearsal</span>
              <input type="date" value={cycle.rehearsalDate ?? ''} onChange={(e) => setCycle({ rehearsalDate: e.target.value || undefined })} />
            </label>
          )}
        </div>
        <label className="field"><span>Concert</span>
          <input type="date" value={cycle.concertDate ?? ''} onChange={(e) => setCycle({ concertDate: e.target.value || undefined })} />
        </label>
        {(() => { const nr = nextRehearsal(cycle); return nr ? <span className="small muted">Next rehearsal: {nr.at.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span> : null; })()}
        {cycle.concertDate && nextRehearsal(cycle) && cycle.concertDate < nextRehearsal(cycle)!.iso && (
          <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>The concert is before the next rehearsal: check the dates.</span>
        )}
        {[cycle.rehearsalWeekday == null ? cycle.rehearsalDate : undefined, cycle.concertDate].some((d) => d && (daysUntil(d) ?? 0) < 0) && (
          <span className="small" style={{ color: 'var(--accent-text)' }}>A date is in the past. Set the next rehearsal so Home can pace your practice.</span>
        )}
        {cycle.pieceIds.some((id) => getPiece(id)) && (
          <div className="col" style={{ gap: 0 }}>
            <span className="small">The next rehearsal works on…</span>
            {cycle.pieceIds.map((id) => {
              const pc = getPiece(id);
              if (!pc) return null;
              const on = (cycle.focusPieceIds ?? []).includes(id);
              return (
                <label key={id} className="toggle-row">
                  <span className="ellipsis">{pc.title}{pc.composer && <span className="muted small"> · {pc.composer}</span>}</span>
                  <input type="checkbox" checked={on} onChange={() => setCycle({ focusPieceIds: on ? (cycle.focusPieceIds ?? []).filter((x) => x !== id) : [...(cycle.focusPieceIds ?? []), id] })} />
                </label>
              );
            })}
          </div>
        )}
        <button className="btn small" onClick={() => go({ name: 'pieces' })}>Choose the cycle's pieces</button>
      </section>
      </div>

      <div className="lay settings-col">
      <section className="col" style={{ gap: 8 }} id="settings-choir">
        <h2 className="eyebrow">Your choir</h2>
        <button className="btn block" onClick={() => go({ name: 'choir' })} data-testid="settings-choir">
          {profile.choirCode ? `Choir: ${cachedChoir()?.name ?? profile.choirCode}` : 'Join your choir'}
        </button>
        {cycle.preset?.startsWith('choir:') && <span className="tiny muted">The programme (This cycle) comes from your choir; your changes there last until the choir publishes a new one.</span>}
      </section>

      <AccountSync />

      <section className="col" style={{ gap: 8 }} id="settings-display-block">
        <h2 className="eyebrow">Practice display</h2>
        <div className="seg" role="group" aria-label="Practice display" data-testid="settings-display">
          {([[undefined, 'Automatic'], ['score', 'Score'], ['highway', 'Highway']] as const).map(([d, label]) => (
            <button key={label} aria-pressed={profile.display === d} onClick={() => update({ display: d, displayChosen: d !== undefined, scoreDefaultNote: false })}>{label}</button>
          ))}
        </div>
        <span className="small muted">
          {profile.display === 'highway' ? 'Your notes as bars moving towards a line, with your voice as a line.'
            : `Your part as sheet music, with your voice drawn on the staff${profile.display ? '' : ' (the default at every level)'}.`} You can also switch before each run.
        </span>
        {profile.display !== 'highway' && (
          <>
            <span className="small" id="settings-scroll-label">Sheet music while you sing</span>
            <div className="seg" role="group" aria-labelledby="settings-scroll-label" data-testid="settings-scroll">
              <button aria-pressed={!profile.scorePages} onClick={() => update({ scorePages: undefined })}>Scrolls</button>
              <button aria-pressed={!!profile.scorePages} onClick={() => update({ scorePages: true })}>Turns pages</button>
            </div>
            <span className="small muted">
              {profile.scorePages ? 'Line after line, like a printed page: the next line slides in when you reach the end of one.'
                : 'One long line gliding past a fixed “now” line, with the clef and key kept at the left: nothing jumps while you sing.'}
            </span>
          </>
        )}
        {wide && profile.display !== 'highway' && (
          <>
            <span className="small" id="settings-staves-label">Sheet music on a wide screen (laptop, tablet in landscape) shows</span>
            <div className="seg" role="group" aria-labelledby="settings-staves-label" data-testid="settings-staves">
              {([[undefined, 'Automatic'], ['mine', 'My part'], ['voices', 'All voices'], ['all', '+ Accomp.']] as const).map(([d, label]) => (
                <button key={label} aria-pressed={profile.scoreStaves === d} onClick={() => update({ scoreStaves: d })}>{label}</button>
              ))}
            </div>
            <span className="small muted">
              {profile.scoreStaves === 'mine' ? 'Only your part, large.'
                : profile.scoreStaves === 'voices' ? 'The full score of the voices, your part highlighted.'
                  : profile.scoreStaves === 'all' ? 'All voices and the piano or organ, your part highlighted (the accompaniment drops out if the screen is too small).'
                    : 'All voices, plus the piano or organ when the score stays readable (up to 6 voices, a not-too-busy accompaniment).'}
            </span>
          </>
        )}
      </section>

      <UsageStats />

      <section className="col" style={{ gap: 8 }} id="settings-help">
        <h2 className="eyebrow">Help</h2>
        <span className="small muted">The intro shows the voice setup, the practice screen, the levels and what to do after a run.</span>
        <IntroVideoButton label="Watch the intro video again" className="btn small" compact />
        <button className="btn small" onClick={() => go({ name: 'diagnostics' })}>Diagnostics &amp; problem report</button>
      </section>

      <section className="col" style={{ gap: 8 }} id="settings-data">
        <h2 className="eyebrow">Your data: a backup file</h2>
        <span className="small muted">Without a choir account your progress lives only on this device. A backup file keeps everything, including your full practice history, to move it to another phone yourself (imported scores need to be imported again).</span>
        <div className="row">
          <button className="btn small grow" onClick={download}>Save backup file</button>
          <button className="btn small grow" onClick={() => fileRef.current?.click()}>Restore from file</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} aria-label="Backup file"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) restore(await f.text()); e.target.value = ''; }} />
        <details>
          <summary className="small muted">Paste a backup instead</summary>
          <label className="field" style={{ marginTop: 8 }}>
            <textarea value={backupText} onChange={(e) => setBackupText(e.target.value)} aria-label="Backup JSON" />
          </label>
          <button className="btn small" disabled={!backupText.trim()} onClick={() => restore(backupText)}>Restore</button>
        </details>
      </section>
      </div>
      </div>

      <section className="col small muted settings-about" style={{ gap: 4 }}>
        <span>Schönberg Hero · your practice stays on this device. Only your choir's leaderboard, the progress you share with your section lead, a live “practising now” count by voice part (no name), with a choir account the progress kept with it (above), and, if switched on, the anonymous usage counts (daily, and every few minutes while in use; Privacy) reach the choir server.</span>
        <span>Built-in score: an original warm-up chorale. Scores from your choir's library show their edition and licence on their page.</span>
      </section>

      {/* A super-admin login on this phone (the login itself: #/superadmin, or Diagnostics). Singers never see this. */}
      {loadSuperSession() && (
        <div className="row wrap tiny muted" style={{ justifyContent: 'center', gap: 4 }} data-testid="settings-super">
          <span>Logged in as super admin ·</span>
          <button className="linklike tiny" style={{ minHeight: 44 }} data-testid="settings-super-logout"
            onClick={() => { void superLogout().then(() => toast('Logged out of super admin')); }}>Log out of super admin</button>
        </div>
      )}
    </main>
  );
}

/** Why `text` can't be restored (null for a Schönberg Hero backup). Same checks as importBackup. */
export function backupProblem(text: string): string | null {
  let b: unknown;
  try { b = JSON.parse(text); } catch { return 'This is not a valid backup file (bad JSON).'; }
  const o = b as { app?: unknown; data?: unknown } | null;
  if (!o || typeof o !== 'object' || o.app !== 'schonberg-hero' || !o.data || typeof o.data !== 'object') return 'This is not a Schönberg Hero backup.';
  return null;
}
