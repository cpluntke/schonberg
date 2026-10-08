import { useEffect, useRef, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'piece'; pieceId: string }
  | {
    name: 'play'; pieceId: string; partId: string; sectionId: string; level: number; mode: '2d' | '3d'; from?: number; to?: number; words?: boolean;
    /** Practise slowly: start at this tempo (0.4..1, slower than the level's: practice only). */
    rate?: number;
    /** Listening (level 0) before singing: the level to sing next. */
    after?: number;
  }
  | { name: 'results' }
  | { name: 'setup' }
  | { name: 'settings' }
  | { name: 'ranks' }
  | { name: 'expert' }
  | { name: 'tuner' }
  /** The intonation lab: its ladder, or one interval's rung (1–5). */
  | { name: 'intonation'; interval?: 'fifth' | 'third'; rung?: number }
  | { name: 'diagnostics' }
  | { name: 'lyrics'; pieceId: string; partId: string }
  | { name: 'memorymap'; pieceId: string; partId: string }
  | { name: 'choir' }
  | { name: 'choiradmin' }
  | { name: 'section' }
  | { name: 'choirinsights' }
  | { name: 'usage' }
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
        const rq = Number(q.get('rate'));
        const rateQ = q.get('rate') != null && Number.isFinite(rq) && rq >= 0.4 && rq < 1 ? Math.round(rq * 100) / 100 : null;
        const aq = Math.round(Number(q.get('after')));
        const afterQ = q.get('after') != null && aq >= 1 && aq <= 5 ? aq : null;
        const mode = seg[0] === 'arcade' ? '3d' : '2d';
        // Arcade is a reward from level 2 up; clamp hand-edited levels.
        const level = Math.max(mode === '3d' ? 2 : 0, Math.min(mode === '3d' ? 4 : 5, Number.isFinite(lv) ? lv : 1));
        return {
          name: 'play', pieceId: seg[1], partId: seg[2], sectionId: seg[3], level, mode,
          from: okRange ? fromN : undefined, to: okRange ? toN : undefined,
          ...(q.get('words') === '1' ? { words: true } : {}),
          ...(rateQ != null ? { rate: rateQ } : {}),
          ...(afterQ != null && level === 0 ? { after: afterQ } : {}),
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
    case 'intonation': {
      const iv = seg[1] === 'fifth' || seg[1] === 'third' ? seg[1] : null;
      const rung = Math.round(Number(seg[2]));
      if (iv && rung >= 1 && rung <= 5) return { name: 'intonation', interval: iv, rung };
      return iv ? { name: 'intonation', interval: iv } : { name: 'intonation' };
    }
    case 'diagnostics': return { name: 'diagnostics' };
    case 'choir': return { name: 'choir' };
    case 'choiradmin': return { name: 'choiradmin' };
    case 'section': return { name: 'section' };
    case 'choirinsights': return { name: 'choirinsights' };
    case 'usage': return { name: 'usage' };
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
      if (r.rate != null) q.set('rate', String(r.rate));
      if (r.after != null) q.set('after', String(r.after));
      return `#/${r.mode === '3d' ? 'arcade' : 'play'}/${e(r.pieceId)}/${e(r.partId)}/${e(r.sectionId)}?${q}`;
    }
    case 'lyrics':
    case 'memorymap': return `#/${r.name}/${e(r.pieceId)}/${e(r.partId)}`;
    case 'invite': return r.token ? `#/invite/${e(r.token)}` : '#/invite';
    case 'intonation': return `#/intonation${r.interval ? `/${r.interval}${r.rung ? `/${r.rung}` : ''}` : ''}`;
    default: return r.name === 'home' ? '#/' : `#/${r.name}`;
  }
}

/*
 * History on the practice screens (Play, Results, the words, the lyrics quiz, the memory map).
 *
 * Fixed rule: every practice screen sits one level above its piece's page, and practice screens
 * replace each other. The history stack is always  … → (Home / Library / …) → Piece → practice screen,
 * so ←, the browser's back and Android's back button all land on the piece, never on an old Results.
 *
 * How: a practice entry carries `history.state.shUp`, the href of the page directly below it.
 * - Entering a practice screen from its piece pushes one entry (stamped).
 * - Entering it from anywhere else (Home's "Practise now", a choir insight…) first pushes the piece's
 *   entry, then the practice screen: back reaches the piece, back again where you were. Both entries
 *   are added in the same tap, so Chrome's "skip entries added without a gesture" rule leaves them be.
 * - From one practice screen to another (Play → Results → Again → Play…) the entry is replaced and
 *   keeps its stamp.
 * - Leaving to the page below (← / "Back to the piece") steps back in history when the stamp says the
 *   piece is right below, and otherwise (a link opened cold, an entry from an older version) replaces
 *   the entry with the piece. Nothing is pushed, so there are no loops.
 * Practice routes are changed with pushState/replaceState (no hashchange), so the router is told by
 * an 'sh:route' event; traversals (back/forward) arrive as popstate/hashchange.
 *
 * While a run is being sung, a "guard" entry (same URL, `shGuard`) sits on top: the back button pops
 * it instead of leaving, and the screen pauses (useBackGuard). Any navigation away first drops it.
 */

const PRACTICE: Route['name'][] = ['play', 'results', 'lyrics', 'memorymap'];
export const isPractice = (r: Route) => PRACTICE.includes(r.name);

/** The page a practice screen sits on: its piece (a virtual drill's real piece), or expert mode for its drills. */
export function practiceParent(r: Route): Route | null {
  if (r.name !== 'play' && r.name !== 'lyrics' && r.name !== 'memorymap') return null;
  if (/^(row|leaps)-/.test(r.pieceId)) return { name: 'expert' };
  return { name: 'piece', pieceId: r.pieceId.split('~')[0] };
}

type HState = { shUp?: string; shGuard?: string | boolean; shDup?: boolean; mistakeZoom?: boolean } | null;
const hstate = (): HState => {
  const s = history.state as unknown;
  return s && typeof s === 'object' ? (s as HState) : null;
};
// A guard belongs to the page load that pushed it. One that survived a reload (or a tab the phone
// discarded) sits on a duplicate of the Play entry whose lower entries belong to the old page: it's
// no guard any more (popping it would reload Play), so it becomes a plain entry marked as a duplicate,
// and leaving steps two back, past the old Play entry, to the piece.
const LOAD = Math.random().toString(36).slice(2);
const guarded = () => hstate()?.shGuard === LOAD;
try {
  const st = hstate();
  if (st?.shGuard) {
    history.replaceState({ ...st, shGuard: undefined, shDup: true }, '', location.href);
    // Step down onto the real Play entry right away (one more quick load of the same screen), so the
    // back button later lands on the piece, not on this leftover. If that can't happen, ← still
    // skips it (shDup).
    if (history.length > 1) history.back();
  }
} catch { /* ignore */ }
const same = (a: Route, b: Route) => href(a) === href(b);
const notify = () => window.dispatchEvent(new Event('sh:route'));

let droppingGuard = false;
/** True while the router itself is popping a run's guard entry (the screen must not treat it as "back"). */
export const isDroppingGuard = () => droppingGuard;

/** Run `then` once no guard entry is on top (pops it first when there is one). */
function settle(then: () => void) {
  if (!guarded()) { then(); return; }
  droppingGuard = true;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', finish);
    clearTimeout(t);
    // (after every popstate listener has seen the flag)
    setTimeout(() => { droppingGuard = false; }, 0);
    then();
  };
  window.addEventListener('popstate', finish);
  const t = window.setTimeout(finish, 800);
  history.back();
}

/** While a run is sung: an entry the back button pops instead of leaving the screen (call in the tap that starts it). */
export function pushGuard() {
  const st = hstate();
  if (guarded()) return;
  try { history.pushState({ ...(st ?? {}), shDup: undefined, shGuard: LOAD }, '', location.href); } catch { /* ignore */ }
}

/** Drop the run's guard entry, if any (the run ended without leaving the screen). */
export function dropGuard(then: () => void = () => {}) { settle(then); }

export function go(r: Route, replace = false) {
  const h = href(r);
  const cur = parseHash(location.hash);
  if (isPractice(cur) || guarded()) {
    settle(() => {
      const { shUp: up, shDup: dup } = hstate() ?? {};
      if (isPractice(r)) {
        // Practice screens replace each other, keeping what lies below (and only that: a screen opened
        // cold has nothing below it, and a stamp would make ← step out of the app).
        const parent = practiceParent(r);
        history.replaceState({ shUp: parent && up !== href(parent) ? undefined : up, shDup: dup }, '', h);
        notify();
      } else if (up && up === h) {
        history.go(dup ? -2 : -1); // the page below: step back, don't stack it again
      } else if (replace) location.replace(h);
      else location.hash = h;
    });
    return;
  }
  if (isPractice(r)) {
    const parent = practiceParent(r);
    if (parent) {
      // The piece goes right below the practice screen (pushed first when we're not on it).
      if (!same(cur, parent)) history.pushState(null, '', href(parent));
      history.pushState({ shUp: href(parent) }, '', h);
      notify();
      return;
    }
  }
  if (replace) location.replace(h);
  else location.hash = h;
}

/** ← on a practice screen: to the page below it (its piece), by stepping back when it's there. */
export function leaveTo(r: Route) {
  settle(() => {
    const st = hstate();
    if (st?.shUp === href(r)) history.go(st.shDup ? -2 : -1);
    else go(r, true);
  });
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
    let last = location.hash;
    const on = () => {
      // A guard entry (same URL) or a popstate that also fires hashchange: nothing new to show.
      if (location.hash === last) return;
      last = location.hash;
      try { sessionStorage.setItem('sh:navd', '1'); } catch { /* storage blocked */ }
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
      // …and once the new screen is drawn (a taller screen replacing Play could keep an odd offset).
      requestAnimationFrame(() => window.scrollTo(0, 0));
    };
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    window.addEventListener('sh:route', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
      window.removeEventListener('sh:route', on);
    };
  }, []);
  return route;
}

/**
 * On a screen that sings (Play, the words): the back button popped the run's guard entry and we're
 * still here. `onBack` pauses a running run (and shows the pause sheet) or leaves for the piece.
 */
export function useBackGuard(onBack: () => void) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    const mine = location.hash;
    const on = () => {
      if (droppingGuard || guarded() || hstate()?.mistakeZoom || location.hash !== mine) return;
      ref.current();
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
}
