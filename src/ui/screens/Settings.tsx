import React, { useRef, useState } from 'react';
import { useProfile, useStoreVersion, toast } from '../hooks';
import { go } from '../router';
import { loadCycle, saveCycle, exportBackup, importBackup } from '../../progress/store';
import { effectiveTolerance } from '../../progress/ladder';
import { NOTATIONS } from './Setup';
import { noteLabel } from '../../game/notation';

export function Settings() {
  const [profile, update] = useProfile();
  useStoreVersion();
  const cycle = loadCycle();
  const [backupText, setBackupText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const dMajor = { beat: 0, time: 0, fifths: 2, mode: 'major' as const };

  const setCycle = (patch: Partial<typeof cycle>) => saveCycle({ ...loadCycle(), ...patch });

  function download() {
    const blob = new Blob([exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `schonberg-hero-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function restore(text: string) {
    try {
      importBackup(text);
      toast('Backup restored');
      setBackupText('');
    } catch (e) {
      toast((e as Error).message || 'That is not a valid backup');
    }
  }

  return (
    <main className="screen">
      <div className="topbar"><h1>Settings</h1></div>

      <section className="col" style={{ gap: 8 }}>
        <h2 className="eyebrow">Note names</h2>
        <div className="choice-grid">
          {NOTATIONS.map((n) => (
            <button key={n.mode} className="choice" aria-pressed={profile.notation === n.mode} onClick={() => update({ notation: n.mode })}>
              <span className="big">{[62, 64, 66, 67].map((m) => noteLabel(m, n.mode, dMajor).text).join(' ')}</span>
              <span className="sub">{n.sub}{n.mode === 'jianpu' || n.mode === 'movable' ? ' · in D major' : ''}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="col" style={{ gap: 8 }}>
        <h2 className="eyebrow">Strictness</h2>
        <div className="seg" role="group" aria-label="Strictness">
          {(['forgiving', 'standard', 'strict'] as const).map((s) => (
            <button key={s} aria-pressed={profile.strictness === s} onClick={() => update({ strictness: s })}>
              {s[0].toUpperCase() + s.slice(1)}
              <span className="sub mono">L4 ±{effectiveTolerance(4, s)}¢</span>
            </button>
          ))}
        </div>
        <span className="small muted">Scales the pitch tolerance of every level. Levels passed on “forgiving” still count.</span>
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

      <section className="col" style={{ gap: 8 }}>
        <h2 className="eyebrow">This cycle</h2>
        <label className="field"><span>Name</span>
          <input type="text" value={cycle.name} onChange={(e) => setCycle({ name: e.target.value })} placeholder="e.g. Spring concert" />
        </label>
        <div className="row">
          <label className="field grow"><span>Next rehearsal</span>
            <input type="date" value={cycle.rehearsalDate ?? ''} onChange={(e) => setCycle({ rehearsalDate: e.target.value || undefined })} />
          </label>
          <label className="field grow"><span>Concert</span>
            <input type="date" value={cycle.concertDate ?? ''} onChange={(e) => setCycle({ concertDate: e.target.value || undefined })} />
          </label>
        </div>
        <button className="btn small" onClick={() => go({ name: 'library' })}>Choose the cycle's pieces</button>
      </section>

      <section className="col" style={{ gap: 8 }}>
        <h2 className="eyebrow">Voice &amp; audio</h2>
        <div className="toggle-row"><span>Name</span><span className="muted">{profile.name || '–'}</span></div>
        <div className="toggle-row"><span>Voice part</span>
          <select aria-label="Voice part" value={profile.voice} onChange={(e) => update({ voice: e.target.value as typeof profile.voice })}
            style={{ minHeight: 40, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 8px' }}>
            <option value="S">Soprano</option><option value="A">Alto</option><option value="T">Tenor</option><option value="B">Bass</option>
          </select>
        </div>
        <label className="toggle-row"><span>Headphone/mic delay (ms)</span>
          <input type="number" min={0} max={600} step={5} value={profile.latencyMs} aria-label="Delay in milliseconds"
            onChange={(e) => update({ latencyMs: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
            style={{ width: 90, minHeight: 40, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 8px' }} />
        </label>
        <div className="row">
          <button className="btn small grow" onClick={() => go({ name: 'setup' })}>Run voice setup again</button>
          <button className="btn small grow" onClick={() => go({ name: 'tuner' })}>Tuner</button>
        </div>
      </section>

      <section className="col" style={{ gap: 8 }}>
        <h2 className="eyebrow">Backup</h2>
        <span className="small muted">Your progress lives on this device. Save a backup to move it to another phone (imported scores need to be imported again).</span>
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

      <section className="col small muted" style={{ gap: 4 }}>
        <span>Schönberg Hero · runs entirely on your device.</span>
        <span>Built-in scores: public-domain editions from the PDMX dataset (MuseScore community, CC BY 4.0 dataset) and original study pieces.</span>
      </section>
    </main>
  );
}
