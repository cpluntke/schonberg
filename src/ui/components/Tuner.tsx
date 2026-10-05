import React, { useEffect, useRef, useState } from 'react';
import { getTracker } from '../play/session';
import { unlockAudio } from '../../audio/context';
import { noteLabel, type NotationMode } from '../../game/notation';
import type { RawPitch } from '../../audio/pitch';

const LETTERS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function letterName(midi: number): string {
  const m = Math.round(midi);
  return `${LETTERS[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export interface TunerReading { midi: number | null; hz: number | null; rms: number }

/** Live pitch display. Starts the shared mic tracker on the first tap. */
export function Tuner({ notation, onReading, autoStart = false }: {
  notation: NotationMode;
  onReading?: (r: RawPitch) => void;
  autoStart?: boolean;
}) {
  const [state, setState] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  const [err, setErr] = useState('');
  const [reading, setReading] = useState<TunerReading>({ midi: null, hz: null, rms: 0 });
  const cbRef = useRef(onReading);
  cbRef.current = onReading;
  const unsubRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; unsubRef.current?.(); unsubRef.current = null; };
  }, []);

  async function startMic() {
    setState('starting');
    try {
      await unlockAudio();
      const t = await getTracker();
      t.configureFor(null); // full window: any voice, down to the bass range
      if (!mountedRef.current) return;
      unsubRef.current?.();
      let last = 0;
      unsubRef.current = t.onPitch((p) => {
        cbRef.current?.(p);
        const now = performance.now();
        if (now - last > 60) {
          last = now;
          setReading({ midi: p.midi, hz: p.hz, rms: p.rms });
        }
      });
      setState('on');
    } catch (e) {
      setErr(micErrorText(e));
      setState('error');
    }
  }

  useEffect(() => {
    if (autoStart) startMic();
    return () => unsubRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const m = reading.midi;
  const nearest = m != null ? Math.round(m) : null;
  const cents = m != null && nearest != null ? Math.round((m - nearest) * 100) : 0;
  const lab = nearest != null ? noteLabel(nearest, notation, { fifths: 0, mode: 'major' }).text : '–';
  const letter = nearest != null ? letterName(nearest) : '';

  return (
    <div className="card" style={{ alignItems: 'center', gap: 14, padding: '22px 18px' }}>
      {state !== 'on' ? (
        <>
          <span className="small muted" style={{ textAlign: 'center' }}>
            {state === 'error' ? err : 'Your pitch is analysed on this device. No audio leaves your phone.'}
          </span>
          <button className="btn voice" onClick={startMic} disabled={state === 'starting'} data-testid="mic-start">
            {state === 'starting' ? 'Starting…' : state === 'error' ? 'Try again' : 'Turn on microphone'}
          </button>
        </>
      ) : (
        <>
          <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
            <span className="tuner-note" data-testid="tuner-note">{lab}</span>
            {notation !== 'letter' && <span style={{ fontSize: 24, fontWeight: 600, color: 'var(--muted)' }}>{letter}</span>}
            {notation === 'letter' && nearest != null && <span style={{ fontSize: 28, fontWeight: 600, color: 'var(--muted)' }}>{Math.floor(nearest / 12) - 1}</span>}
          </div>
          <span className="mono small" style={{ color: 'var(--voice)' }}>{reading.hz ? `${reading.hz.toFixed(1)} Hz` : 'sing a comfortable “ah”'}</span>
          <div className="meter" aria-label={`${cents} cents`}>
            <div className="track" />
            <div className="zone" style={{ left: '37.5%', width: '25%' }} />
            <div className="center" />
            {m != null && <div className="needle" style={{ left: `calc(${50 + cents}% - 2px)` }} />}
            <div className="row between tiny muted mono" style={{ position: 'absolute', left: 0, right: 0, top: 40 }}>
              <span>−50¢</span><span>{m != null ? `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${Math.abs(cents)}¢` : ''}</span><span>+50¢</span>
            </div>
          </div>
          <div className="bar thin" style={{ width: '100%' }} aria-label="Input level"><span style={{ width: `${Math.min(100, reading.rms * 400)}%` }} /></div>
        </>
      )}
    </div>
  );
}

/** What to tell the singer when the microphone can't be opened (the tuner, the range and delay checks). */
export function micErrorText(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  return code === 'denied' ? 'Microphone access was blocked. Allow it in the browser’s site settings, then try again.'
    : code === 'insecure' ? 'The microphone only works over https.' : 'No microphone could be opened.';
}
