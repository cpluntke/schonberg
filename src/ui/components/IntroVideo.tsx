import React, { useEffect, useRef, useState } from 'react';
import { IconPlay } from '../icons';

const BASE = import.meta.env.BASE_URL || './';
export const INTRO_SRC = `${BASE}media/onboarding.mp4`;
export const INTRO_WEBM = `${BASE}media/onboarding.webm`;
export const INTRO_POSTER = `${BASE}media/onboarding.jpg`;

/** Remember that the singer has seen (most of) the intro. */
export function introSeen(): boolean {
  try { return localStorage.getItem('sh:introSeen') === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem('sh:introSeen', '1'); } catch { /* ignore */ }
}

/** A button that opens the 100-second onboarding video in a full-screen player. */
export function IntroVideoButton({ label = 'Watch the 1½-minute intro', className = 'btn block', compact = false }: { label?: string; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} data-testid="intro-open">
        <IconPlay size={compact ? 14 : 18} color="currentColor" /> {label}
      </button>
      {open && <IntroVideoModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function IntroVideoModal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = ref.current;
    v?.play().catch(() => { /* autoplay with sound may be blocked; controls are shown */ });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Intro video" className="overlay" style={{ position: 'fixed', zIndex: 60, background: 'rgba(5,6,13,0.94)', flexDirection: 'column', gap: 12 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: '100%', maxWidth: 900 }}>
        {failed ? (
          <div className="notice">The video couldn't be loaded. Check your connection and try again.</div>
        ) : (
          <video ref={ref} poster={INTRO_POSTER} controls playsInline preload="metadata"
            style={{ width: '100%', borderRadius: 14, background: '#000', aspectRatio: '16 / 9' }}
            onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration && v.currentTime > v.duration * 0.8) markSeen(); }}
            onEnded={() => { markSeen(); }}
            data-testid="intro-video">
            {/* H.264 for Safari/iOS, VP9 for browsers without H.264 (e.g. some Chromium builds). */}
            <source src={INTRO_SRC} type='video/mp4; codecs="avc1.640028, mp4a.40.2"' />
            <source src={INTRO_WEBM} type='video/webm; codecs="vp9, opus"' onError={() => setFailed(true)} />
          </video>
        )}
      </div>
      <button className="btn" onClick={onClose} autoFocus>Close</button>
      <span className="tiny muted">Tip: turn your phone sideways for a bigger picture.</span>
    </div>
  );
}
