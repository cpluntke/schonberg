// The app's tabs (Today · Pieces · Train · Choir, plus Admin / Section for staff logins) and which
// tab a screen belongs to. Pure functions: App.tsx draws the tab bar (a sidebar on wide screens).
//
// Rules (also in docs/architecture.md, "ui/ navigation"):
// - The four tab roots (and the staff screens, for staff) show the tab bar on phones. Every other
//   screen is a sub-screen with its own back arrow: no tab bar on phones, the sidebar stays on wide
//   screens (with the tab it belongs to lit). Practice screens (Play, Results, the words, the
//   lyrics quiz, the memory map) and voice setup have neither.
// - A sub-screen lights the tab it belongs to: Your progress → Today; Ranks → Choir; Expert, the
//   tuner, the intonation lab → Train. Screens reached from several tabs light the tab they were
//   opened from: a piece (Today, Pieces or Choir; opened straight from a link: Pieces), Settings and
//   Diagnostics (from the avatar's "You" sheet, on every tab; opened from a link: Today).

import type { Route } from './router';

export type TabName = 'home' | 'pieces' | 'train' | 'choir';
export const TAB_NAMES: readonly TabName[] = ['home', 'pieces', 'train', 'choir'];
export const TAB_LABEL: Record<TabName, string> = { home: 'Today', pieces: 'Pieces', train: 'Train', choir: 'Choir' };

export const isTab = (name: string): name is TabName => (TAB_NAMES as readonly string[]).includes(name);

const ADMIN = ['choiradmin', 'section', 'choirinsights', 'superadmin', 'usage'];
export const isAdminRoute = (name: string) => ADMIN.includes(name);

/** Sub-screens and the tab they belong to (a piece: see tabOf). */
const PARENT: Partial<Record<Route['name'], TabName>> = {
  progress: 'home',
  ranks: 'choir',
  expert: 'train',
  tuner: 'train',
  intonation: 'train',
};

/** Screens reached from several tabs: they light the tab they were opened from, else this one. */
const FROM: Partial<Record<Route['name'], TabName>> = { piece: 'pieces', settings: 'home', diagnostics: 'home' };

/**
 * The tab lit for a route (null: a staff screen, which lights its own tab, or a screen without one).
 * `fromTab`: the tab shown last before this screen (null when the app was opened on it).
 */
export function tabOf(route: Pick<Route, 'name'>, fromTab: TabName | null = null): TabName | null {
  if (isTab(route.name)) return route.name;
  const from = FROM[route.name];
  if (from) return fromTab ?? from;
  return PARENT[route.name] ?? null;
}

/** Phones: the tab bar under the tab roots (and the staff screens). */
export function showsTabBar(route: Pick<Route, 'name'>): boolean {
  return isTab(route.name) || isAdminRoute(route.name);
}

/** Wide screens: the sidebar on the tab roots, the staff screens and every sub-screen (not while practising or in setup). */
export function showsSidebar(route: Route): boolean {
  if (showsTabBar(route) || route.name in FROM) return true;
  // (the lab's steps listen and sing: like a practice screen; its ladder is a sub-screen)
  if (route.name === 'intonation') return !route.rung;
  return route.name in PARENT;
}

/** Initials for the avatar: "Clara Weiss" → "CW", "Clara" → "CL" (two letters read as a name), nothing → the voice. */
export function avatarInitials(name: string, voice: string): string {
  const w = name.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return voice || '♪';
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}
