// The app's tabs (Today · Pieces · Train · Choir, plus Admin / Section for staff logins) and which
// tab a screen belongs to. Pure functions: App.tsx draws the tab bar (a sidebar on wide screens).
//
// Rules (also in docs/architecture.md, "ui/ navigation"):
// - The four tab roots (and the staff screens, for staff) show the tab bar on phones. Every other
//   screen is a sub-screen with its own back arrow: no tab bar on phones, the sidebar stays on wide
//   screens (with the tab it belongs to lit). Practice screens (Play, Results, the words, the
//   lyrics quiz, the memory map) and voice setup have neither.
// - A sub-screen lights the tab it belongs to: Ranks → Choir; Expert, the tuner, the drone, the
//   courses (the intonation lab) → Train. Screens reached from several tabs light the tab they were opened from: a piece (Today,
//   Pieces or Choir; opened straight from a link: Pieces), Settings, Diagnostics and Your progress
//   (from the avatar's "You" sheet, on every tab; opened from a link: Today). That tab is stamped on
//   the screen's history entry, so back and forward across several tabs keep it.

import type { Route } from './router';

export type TabName = 'home' | 'pieces' | 'train' | 'choir';
export const TAB_NAMES: readonly TabName[] = ['home', 'pieces', 'train', 'choir'];
export const TAB_LABEL: Record<TabName, string> = { home: 'Today', pieces: 'Pieces', train: 'Train', choir: 'Choir' };

export const isTab = (name: string): name is TabName => (TAB_NAMES as readonly string[]).includes(name);

const ADMIN = ['choiradmin', 'section', 'choirinsights', 'superadmin', 'usage'];
export const isAdminRoute = (name: string) => ADMIN.includes(name);

/** Sub-screens and the tab they belong to (a piece: see tabOf). */
const PARENT: Partial<Record<Route['name'], TabName>> = {
  ranks: 'choir',
  expert: 'train',
  tuner: 'train',
  intonation: 'train',
  courses: 'train',
  drone: 'train',
  tuning: 'train',
};

/** Screens reached from several tabs: they light the tab they were opened from, else this one. */
const FROM: Partial<Record<Route['name'], TabName>> = { piece: 'pieces', settings: 'home', diagnostics: 'home', progress: 'home' };

/** A screen that lights the tab it was opened from (its history entry remembers that tab). */
export const isFromScreen = (name: string): boolean => name in FROM;

/** The tab stamped on the current history entry (App.tsx stamps it when a FROM screen is entered). */
export function stampedTab(): TabName | null {
  try {
    const t = (history.state as { shTab?: string } | null)?.shTab;
    return t && isTab(t) ? t : null;
  } catch {
    return null;
  }
}

/** The tab shown last (this browser tab's session). */
export function lastTab(): TabName | null {
  try {
    const t = sessionStorage.getItem('sh:fromTab');
    return t && isTab(t) ? t : null;
  } catch {
    return null;
  }
}

/** Where ← on a FROM screen opened cold goes: the tab it lights. */
export function backTab(name: Route['name']): Route {
  return { name: tabOf({ name }, stampedTab() ?? lastTab()) ?? 'home' } as Route;
}

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
  // (a course's steps and its quick check listen and sing: like a practice screen; its page is a sub-screen)
  if (route.name === 'intonation') return !route.rung && !route.check;
  return route.name in PARENT;
}

/** Initials for the avatar: "Clara Weiss" → "CW", "Clara" → "CL" (two letters read as a name), nothing → the voice. */
export function avatarInitials(name: string, voice: string): string {
  const w = name.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return voice || '♪';
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}
