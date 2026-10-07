import React, { useEffect, useState } from 'react';
import { back } from '../router';
import { IconBack } from '../icons';
import { useProfile, toast } from '../hooks';
import { getAudioContext, unlockAudio, outputLatencySec } from '../../audio/context';
import { getTracker, estimateLatencyMs } from '../play/session';
import { errorLog, clearErrorLog } from '../errorlog';
import { attemptLog } from '../../progress/store';
import { allPieces } from '../library';
import { letterName } from '../components/Tuner';


interface MicReport {
  label: string;
  settings: Record<string, unknown>;
  readingsPerSec: number;
  voicedPct: number;
  medianRms: number;
  lastNote: string;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function Diagnostics() {
  const [profile] = useProfile();
  const [mic, setMic] = useState<MicReport | null>(null);
  const [micState, setMicState] = useState<'idle' | 'running' | 'error'>('idle');
  const [micErr, setMicErr] = useState('');
  const [storage, setStorage] = useState<{ persisted?: boolean; usageMB?: number; quotaMB?: number }>({});
  const [errors, setErrors] = useState(errorLog());

  useEffect(() => {
    (async () => {
      try {
        const persisted = await navigator.storage?.persisted?.();
        const est = await navigator.storage?.estimate?.();
        setStorage({ persisted, usageMB: est?.usage ? est.usage / 1e6 : undefined, quotaMB: est?.quota ? est.quota / 1e6 : undefined });
      } catch { /* unsupported */ }
    })();
  }, []);

  let ctxInfo: Record<string, unknown> = {};
  try {
    const ctx = getAudioContext();
    ctxInfo = {
      sampleRate: ctx.sampleRate, state: ctx.state,
      baseLatencyMs: Math.round((ctx.baseLatency || 0) * 1000),
      outputLatencyMs: Math.round(outputLatencySec(ctx) * 1000),
    };
  } catch (e) {
    ctxInfo = { error: String(e) };
  }

  const env = {
    build: typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev',
    userAgent: navigator.userAgent,
    standalone: matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    secure: window.isSecureContext,
    screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}`,
    language: navigator.language,
  };

  async function testMic() {
    setMicState('running');
    setMicErr('');
    try {
      await unlockAudio();
      const t = await getTracker();
      t.configureFor(null); // full window: any voice, down to the bass range
      t.setLowestNote(null);
      t.setHint(null);
      const track = t.stream.getAudioTracks()[0];
      const readings: { midi: number | null; rms: number }[] = [];
      const start = performance.now();
      const unsub = t.onPitch((p) => readings.push({ midi: p.midi, rms: p.rms }));
      await new Promise((r) => setTimeout(r, 3000));
      unsub();
      const secs = (performance.now() - start) / 1000;
      const voiced = readings.filter((r) => r.midi != null);
      const last = [...voiced].reverse()[0];
      setMic({
        label: track?.label || '(no label)',
        settings: (track?.getSettings?.() ?? {}) as Record<string, unknown>,
        readingsPerSec: Math.round(readings.length / secs),
        voicedPct: readings.length ? Math.round((voiced.length / readings.length) * 100) : 0,
        medianRms: Number(median(readings.map((r) => r.rms)).toFixed(4)),
        lastNote: last?.midi != null ? letterName(last.midi) : '–',
      });
      setMicState('idle');
    } catch (e) {
      setMicErr(String((e as Error).message || e));
      setMicState('error');
    }
  }

  async function persist() {
    try {
      const ok = await navigator.storage?.persist?.();
      setStorage((s) => ({ ...s, persisted: ok }));
      toast(ok ? 'Storage is now persistent' : 'The browser declined (install the app to the home screen to keep data safe)');
    } catch {
      toast('Not supported in this browser');
    }
  }

  const report = {
    env,
    audio: { ...ctxInfo, latencySettingMs: profile.latencyMs, latencyEstimateMs: estimateLatencyMs() },
    mic,
    storage: { ...storage, attempts: attemptLog().length, pieces: allPieces().length },
    profile: { voice: profile.voice, notation: profile.notation, strictness: profile.strictness, tuning: profile.tuning, onboarded: profile.onboarded },
    errors: errors.slice(-10),
  };
  const reportText = JSON.stringify(report, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportText);
      toast('Report copied: paste it into a message');
    } catch {
      toast('Copy failed: select the text below and copy it manually');
    }
  }

  return (
    <main className="screen">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => back({ name: 'settings' })}><IconBack /></button>
        <h1>Diagnostics</h1>
      </div>
      <p className="small muted">If something doesn't work on your phone, run the mic test with your headphones on, then send the report to whoever set this up.</p>

      <div className="card">
        <strong>Microphone test (3 s)</strong>
        <span className="small muted">Sing or hum a steady note while it runs.</span>
        <button className="btn voice" onClick={testMic} disabled={micState === 'running'} data-testid="diag-mic">
          {micState === 'running' ? 'Listening…' : 'Test microphone'}
        </button>
        {micState === 'error' && <span className="small" style={{ color: 'var(--accent-text)' }}>{micErr}</span>}
        {mic && (
          <div className="small mono col" style={{ gap: 2 }}>
            <span>{mic.label}</span>
            <span>{mic.readingsPerSec} readings/s · voiced {mic.voicedPct}% · level {mic.medianRms} · last note {mic.lastNote}</span>
            <span>
              echoCancellation {String(mic.settings.echoCancellation)} · noiseSuppression {String(mic.settings.noiseSuppression)} · autoGain {String(mic.settings.autoGainControl)}
            </span>
            {mic.readingsPerSec < 30 && <span style={{ color: 'var(--accent-text)' }}>Few readings: the phone may be throttling the app.</span>}
            {mic.settings.echoCancellation === true && <span style={{ color: 'var(--accent-text)' }}>The browser kept echo cancellation on: pitch may be less accurate.</span>}
          </div>
        )}
      </div>

      <div className="card">
        <strong>Storage</strong>
        <span className="small">
          {storage.persisted ? 'Persistent: your progress is safe.' : 'Not persistent: the browser may clear your progress if storage runs low (Safari after a few weeks unused).'}
        </span>
        {!storage.persisted && <button className="btn small" onClick={persist}>Keep my data</button>}
      </div>

      <div className="card">
        <div className="row between"><strong>Errors ({errors.length})</strong>
          {errors.length > 0 && <button className="btn ghost small" onClick={() => { clearErrorLog(); setErrors([]); }}>Clear</button>}</div>
        {errors.length === 0 ? <span className="small muted">No errors recorded.</span> : (
          <div className="col tiny mono" style={{ gap: 6, maxHeight: 200, overflow: 'auto' }}>
            {errors.slice(-8).reverse().map((e, i) => <span key={i}>{new Date(e.at).toLocaleString()} [{e.where}] {e.msg.split('\n')[0]}</span>)}
          </div>
        )}
      </div>

      <button className="btn primary block" onClick={copy}>Copy diagnostics report</button>
      <textarea readOnly value={reportText} aria-label="Diagnostics report" style={{ minHeight: 200, fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 10, padding: 10 }} />
    </main>
  );
}
