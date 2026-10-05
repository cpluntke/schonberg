import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'piece'; pieceId: string }
  | { name: 'play'; pieceId: string; partId: string; sectionId: string; level: number; mode: '2d' | '3d'; from?: number; to?: number; words?: boolean }
  | { name: 'results' }
  | { name: 'setup' }
  | { name: 'settings' }
  | { name: 'ranks' }
  | { name: 'expert' }
  | { name: 'tuner' }
  | { name: 'diagnostics' }
  | { name: 'lyrics'; pieceId: string; partId: string }
  | { name: 'memorymap'; pieceId: string; partId: string }
  | { name: 'choir' }
  | { name: 'choiradmin' }
  | { name: 'section' }
  | { name: 'superadmin' }
  | { name: 'invite'; token?: string };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const seg = path.split('/').filter(Boolean).map((x) => {
    try { return decodeURIComponent(x); } catch { return x; }
  });
  const q = new URLSearchParams(query);
  switch (seg[0]) {
    case 'library': return { name: 'library' };
    case 'piece': if (seg[1]) return { name: 'piece', pieceId: seg[1] }; break;
    case 'play':
    case 'arcade':
      if (seg.length >= 4) {
        const fromN = Number(q.get('from'));
        const toN = Number(q.get('to'));
        const okRange = q.get('from') != null && q.get('to') != null && Number.isFinite(fromN) && Number.isFinite(toN) && fromN >= 0 && toN > fromN;
        const lv = Math.round(Number(q.get('level') ?? 1));
        const mode = seg[0] === 'arcade' ? '3d' : '2d';
        // Arcade is a reward from level 2 up; clamp hand-edited levels.
        const level = Math.max(mode === '3d' ? 2 : 0, Math.min(mode === '3d' ? 4 : 5, Number.isFinite(lv) ? lv : 1));
        return {
          name: 'play', pieceId: seg[1], partId: seg[2], sectionId: seg[3], level, mode,
          from: okRange ? fromN : undefined, to: okRange ? toN : undefined,
          ...(q.get('words') === '1' ? { words: true } : {}),
        };
      }
      break;
    case 'lyrics': if (seg[1] && seg[2]) return { name: 'lyrics', pieceId: seg[1], partId: seg[2] }; break;
    case 'memorymap': if (seg[1] && seg[2]) return { name: 'memorymap', pieceId: seg[1], partId: seg[2] }; break;
    case 'results': return { name: 'results' };
    case 'setup': return { name: 'setup' };
    case 'settings': return { name: 'settings' };
    case 'ranks': return { name: 'ranks' };
    case 'expert': return { name: 'expert' };
    case 'tuner': return { name: 'tuner' };
    case 'diagnostics': return { name: 'diagnostics' };
    case 'choir': return { name: 'choir' };
    case 'choiradmin': return { name: 'choiradmin' };
    case 'section': return { name: 'section' };
    case 'superadmin': return { name: 'superadmin' };
    case 'invite': return seg[1] ? { name: 'invite', token: seg[1] } : { name: 'invite' };
  }
  return { name: 'home' };
}

export function href(r: Route): string {
  const e = encodeURIComponent;
  switch (r.name) {
    case 'piece': return `#/piece/${e(r.pieceId)}`;
    case 'play': {
      const q = new URLSearchParams({ level: String(r.level) });
      if (r.from != null) q.set('from', String(r.from));
      if (r.to != null) q.set('to', String(r.to));
      if (r.words) q.set('words', '1');
      return `#/${r.mode === '3d' ? 'arcade' : 'play'}/${e(r.pieceId)}/${e(r.partId)}/${e(r.sectionId)}?${q}`;
    }
    case 'lyrics':
    case 'memorymap': return `#/${r.name}/${e(r.pieceId)}/${e(r.partId)}`;
    case 'invite': return r.token ? `#/invite/${e(r.token)}` : '#/invite';
    default: return r.name === 'home' ? '#/' : `#/${r.name}`;
  }
}

export function go(r: Route, replace = false) {
  const h = href(r);
  if (replace) location.replace(h);
  else location.hash = h;
}

export function back(fallback: Route = { name: 'home' }) {
  let navd = false;
  try { navd = sessionStorage.getItem('sh:navd') === '1'; } catch { /* storage blocked */ }
  if (history.length > 1 && navd) history.back();
  else go(fallback, true);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      try { sessionStorage.setItem('sh:navd', '1'); } catch { /* storage blocked */ }
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
