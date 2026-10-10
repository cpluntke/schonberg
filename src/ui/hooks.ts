import { useEffect, useState, useCallback } from 'react';
import { loadProfile, saveProfile, subscribe, type Profile } from '../progress/store';

/**
 * Today's date ('YYYY-MM-DD'): re-renders when the day changes under an open screen (midnight, or the
 * app coming back from the background, a PWA resumed the next morning).
 */
export function useDay(): string {
  const key = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [day, setDay] = useState(key);
  useEffect(() => {
    let t = 0;
    const check = () => setDay(key());
    const arm = () => {
      clearTimeout(t);
      const n = new Date();
      const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1).getTime();
      t = window.setTimeout(() => { check(); arm(); }, Math.max(1000, next - n.getTime()));
    };
    const onShow = () => { if (!document.hidden) { check(); arm(); } };
    arm();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); };
  }, []);
  return day;
}

export function useStoreVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => subscribe(() => setV((x) => x + 1)), []);
  return v;
}

export function useProfile(): [Profile, (patch: Partial<Profile>) => void] {
  useStoreVersion();
  const profile = loadProfile();
  const update = useCallback((patch: Partial<Profile>) => {
    saveProfile({ ...loadProfile(), ...patch });
  }, []);
  return [profile, update];
}

let toastTimer: number | undefined;
const toastListeners = new Set<(m: string | null) => void>();
export function toast(msg: string) {
  toastListeners.forEach((l) => l(msg));
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastListeners.forEach((l) => l(null)), 2600);
}
export function useToast(): string | null {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => {
    toastListeners.add(setM);
    return () => { toastListeners.delete(setM); };
  }, []);
  return m;
}

export function formatDate(d: string | undefined): string {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function daysUntil(d: string | undefined, now = new Date()): number | null {
  if (!d) return null;
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt.getTime())) return null;
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

export function initials(s: string): string {
  const w = s.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return '♪';
  return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}

/** Wide screen (laptop, tablet in landscape): the play screen uses the width for the full score. */
/** Does the media query `q` match (and re-render when that changes)? */
export function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, [q]);
  return on;
}

export function useWide(): boolean {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return wide;
}
