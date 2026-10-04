import React, { useEffect, useRef, useState } from 'react';
import { IconPlay } from '../icons';
import { go, type Route } from '../router';
import { allPieces, getPiece, chosenPartId, singableSections } from '../library';
import { loadCycle, loadProfile } from '../../progress/store';

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

/** A button that opens the 2-minute onboarding video in a full-screen player. */
export function IntroVideoButton({ label = 'Watch the 2-minute intro', className = 'btn block', compact = false }: { label?: string; className?: string; compact?: boolean }) {
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
    <div role="dialog" aria-modal="true" aria-label="Intro video" className="overlay" style={{ position: 'fixed', zIndex: 60, background: 'rgba(5,6,13,0.94)', flexDirection: 'column', gap: 12, justifyContent: 'flex-start', overflowY: 'auto' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: '100%', maxWidth: 900, marginTop: 'auto', flex: 'none' }}>
        {failed ? (
          <div className="notice">The video couldn't be loaded. Check your connection and try again.</div>
        ) : (
          <video ref={ref} poster={INTRO_POSTER} controls playsInline preload="metadata"
            style={{ width: '100%', borderRadius: 14, background: '#000', aspectRatio: '16 / 9' }}
            onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration && v.currentTime > v.duration * 0.8) markSeen(); }}
            onEnded={() => { markSeen(); }}
            data-testid="intro-video">
            {/* H.264 for Safari/iOS, VP9 for browsers without H.264 (e.g. some Chromium builds). */}
            <source src={INTRO_SRC} type='video/mp4; codecs="avc1.64001F, mp4a.40.2"' />
            <source src={INTRO_WEBM} type='video/webm; codecs="vp9, opus"' onError={() => setFailed(true)} />
          </video>
        )}
      </div>
      <TryItNow onClose={onClose} />
      <button className="btn" onClick={onClose} autoFocus>Close</button>
      <span className="tiny muted" style={{ marginBottom: 'auto' }}>Tip: turn your phone sideways for a bigger picture.</span>
    </div>
  );
}

/** Level 1 of the first section of the first piece in the cycle (what the video's last step asks for). */
export function firstRunRoute(): Route | null {
  const profile = loadProfile();
  const piece = loadCycle().pieceIds.map((id) => getPiece(id)).find(Boolean) ?? allPieces()[0];
  if (!piece) return null;
  const partId = chosenPartId(piece, profile.voice);
  const section = singableSections(piece, partId)[0];
  if (!section) return null;
  return { name: 'play', pieceId: piece.id, partId, sectionId: section.id, level: 1, mode: '2d' };
}

/** The two things the intro ends on, as buttons right under the video. */
function TryItNow({ onClose }: { onClose: () => void }) {
  const profile = loadProfile();
  const setupDone = profile.onboarded && profile.latencyMs > 0;
  const first = firstRunRoute();
  const firstPiece = first && first.name === 'play' ? getPiece(first.pieceId) : undefined;
  const step = (n: number, done: boolean, title: string, sub: string, label: string, onGo: () => void, primary: boolean) => (
    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
      <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 14, flex: 'none', display: 'grid', placeItems: 'center', fontWeight: 700,
        background: done ? 'var(--good, #3fb950)' : 'var(--accent, #f0883e)', color: '#05060d' }}>{done ? '✓' : n}</span>
      <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
        <strong className="small">{title}</strong>
        <span className="tiny muted">{sub}</span>
      </span>
      <button className={`btn small${primary ? ' primary' : ''}`} onClick={() => { onClose(); onGo(); }}>{label}</button>
    </div>
  );
  return (
    <div className="card" style={{ width: '100%', maxWidth: 900, gap: 10, flex: 'none' }} data-testid="intro-next-steps">
      <span className="eyebrow">Try it now · about 5 minutes</span>
      {step(1, setupDone, 'Put on headphones, do the voice setup', 'Choir code, a short do-re-mi, and the delay check', setupDone ? 'Redo' : 'Start voice setup',
        () => go({ name: 'setup' }), !setupDone)}
      {first && step(2, false, 'Sing level 1 of your first section', firstPiece ? `${firstPiece.title}: slow, with your part playing` : 'Slow, with your part playing', 'Sing it',
        () => go(first), setupDone)}
    </div>
  );
}
