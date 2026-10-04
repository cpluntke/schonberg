import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'piece'; pieceId: string }
  | { name: 'play'; pieceId: string; partId: string; sectionId: string; level: number; mode: '2d' | '3d'; from?: number; to?: number }
  | { name: 'results' }
  | { name: 'setup' }
  | { name: 'settings' }
  | { name: 'ranks' }
  | { name: 'expert' }
  | { name: 'tuner' };

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
        const from = q.get('from');
        const to = q.get('to');
        return {
          name: 'play', pieceId: seg[1], partId: seg[2], sectionId: seg[3],
          level: Number(q.get('level') ?? 1), mode: seg[0] === 'arcade' ? '3d' : '2d',
          from: from != null ? Number(from) : undefined, to: to != null ? Number(to) : undefined,
        };
      }
      break;
    case 'results': return { name: 'results' };
    case 'setup': return { name: 'setup' };
    case 'settings': return { name: 'settings' };
    case 'ranks': return { name: 'ranks' };
    case 'expert': return { name: 'expert' };
    case 'tuner': return { name: 'tuner' };
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
      return `#/${r.mode === '3d' ? 'arcade' : 'play'}/${e(r.pieceId)}/${e(r.partId)}/${e(r.sectionId)}?${q}`;
    }
    default: return r.name === 'home' ? '#/' : `#/${r.name}`;
  }
}

export function go(r: Route, replace = false) {
  const h = href(r);
  if (replace) location.replace(h);
  else location.hash = h;
}

export function back(fallback: Route = { name: 'home' }) {
  if (history.length > 1 && sessionStorage.getItem('sh:navd') === '1') history.back();
  else go(fallback, true);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      sessionStorage.setItem('sh:navd', '1');
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
