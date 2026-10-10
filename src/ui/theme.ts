// Settings → Display: appearance (dark, light, or the phone's) and text size, applied app-wide.
//
// - Colours: CSS tokens on :root (styles.css), switched by data-theme="light" on <html>; the canvas
//   renderers' palette (play/palette.ts) follows; so do <meta name="theme-color"> and the status bar.
// - Text size: every font size in the CSS is in rem; data-text="large" | "larger" on <html> scales
//   the root (115 %, 130 %). Canvas labels scale by the same factor (palette.ts fpx).
// - Default: dark (unset). The app has always been dark and its look (and the intro video) is dark;
//   "Match the phone" and Light are a tap away in Settings → Display.
// Both settings live in the profile and travel with a choir account (sync.ts PROFILE_KEYS).
import { useEffect, useLayoutEffect, useState } from 'react';
import type { Profile } from '../progress/store';
import { canvasGeneration, onCanvasTheme, setCanvasTheme, type ThemeName } from './play/palette';

export type Appearance = NonNullable<Profile['appearance']>;
export type TextSize = NonNullable<Profile['textSize']>;

export const APPEARANCES: { id: Appearance; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'Match the phone' },
];
export const TEXT_SIZES: { id: TextSize; label: string; scale: number }[] = [
  { id: 'standard', label: 'Standard', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.15 },
  { id: 'larger', label: 'Larger', scale: 1.3 },
];

/** The theme to show: the singer's choice, the phone's for "Match the phone"; dark when unset or unknown. */
export function resolveTheme(appearance: unknown, phonePrefersLight: boolean): ThemeName {
  if (appearance === 'light') return 'light';
  if (appearance === 'system') return phonePrefersLight ? 'light' : 'dark';
  return 'dark';
}

/** The text size in force ('standard' when unset or unknown). */
export function textSizeOf(size: unknown): TextSize {
  return TEXT_SIZES.find((t) => t.id === size)?.id ?? 'standard';
}

/** Root scale of a text size (1 when unset or unknown). */
export function textScale(size: unknown): number {
  return TEXT_SIZES.find((t) => t.id === size)?.scale ?? 1;
}

/** The browser's status bar / title bar colour (= --bg of the theme). */
export const THEME_COLOR: Record<ThemeName, string> = { dark: '#0B0D1A', light: '#F5F6FA' };

/** A colour (a CSS colour or var()) at `pct` % opacity. */
export const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const LIGHT_QUERY = '(prefers-color-scheme: light)';
function phonePrefersLight(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia(LIGHT_QUERY).matches; } catch { return false; }
}

/**
 * Apply display settings to the page: <html data-theme / data-text>, the theme-color meta and iOS's
 * status bar style, and the canvas palette. Idempotent. Returns the theme shown.
 */
export function applyDisplay(p: Pick<Profile, 'appearance' | 'textSize'>, prefersLight = phonePrefersLight(),
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): ThemeName {
  const theme = resolveTheme(p.appearance, prefersLight);
  const size = textSizeOf(p.textSize);
  if (doc) {
    const root = doc.documentElement;
    if (theme === 'light') root.dataset.theme = 'light';
    else delete root.dataset.theme;
    if (size === 'standard') delete root.dataset.text;
    else root.dataset.text = size;
    for (const m of Array.from(doc.querySelectorAll('meta[name="theme-color"]'))) m.setAttribute('content', THEME_COLOR[theme]);
    doc.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', theme === 'light' ? 'default' : 'black-translucent');
  }
  setCanvasTheme(theme, textScale(size));
  return theme;
}

/**
 * Keeps the page in step with the profile's display settings and, for "Match the phone", with the
 * phone switching between light and dark (App renders it once).
 */
export function useDisplaySync(p: Pick<Profile, 'appearance' | 'textSize'>): void {
  useLayoutEffect(() => {
    applyDisplay(p);
    if (p.appearance !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia(LIGHT_QUERY);
    const on = () => applyDisplay(p);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [p.appearance, p.textSize]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Re-render when the canvas colours or text size change (for canvases drawn once, not every frame). */
export function useCanvasGeneration(): number {
  const [g, setG] = useState(canvasGeneration);
  useEffect(() => onCanvasTheme(() => setG(canvasGeneration())), []);
  return g;
}
