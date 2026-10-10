import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyDisplay, resolveTheme, textScale, textSizeOf, THEME_COLOR } from './theme';
import { COLORS, INK, PALETTES, STAFF_GRADE, TRACE_COLORS, canvasGeneration, canvasTextScale, canvasTheme, fpx, setCanvasTheme } from './play/palette';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, 'styles.css'), 'utf8');

/** The colour tokens of a block of styles.css (`:root {` or `:root[data-theme='light'] {`). */
function tokens(head: string): Record<string, string> {
  const at = css.indexOf(head);
  const body = css.slice(at + head.length, css.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('display settings', () => {
  beforeEach(() => { setCanvasTheme('dark', 1); });

  it('appearance: dark unless the singer chose light, or the phone is light with "Match the phone"', () => {
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('sepia', true)).toBe('dark');
  });

  it('text size: standard 100 %, large 115 %, larger 130 %; anything else is standard', () => {
    expect(textScale(undefined)).toBe(1);
    expect(textScale('large')).toBe(1.15);
    expect(textScale('larger')).toBe(1.3);
    expect(textScale('huge')).toBe(1);
    expect(textSizeOf('larger')).toBe('larger');
    expect(textSizeOf(3)).toBe('standard');
  });

  it('applies to the page: <html> attributes, the status bar colour and the canvas palette', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#0B0D1A"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">';
    const g = canvasGeneration();
    expect(applyDisplay({ appearance: 'light', textSize: 'larger' }, false, document)).toBe('light');
    const root = document.documentElement;
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.text).toBe('larger');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(THEME_COLOR.light);
    expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')!.getAttribute('content')).toBe('default');
    expect(canvasTheme()).toBe('light');
    expect(canvasTextScale()).toBe(1.3);
    expect(canvasGeneration()).toBeGreaterThan(g);
    expect(COLORS.bg).toBe(PALETTES.light.highway.bg);
    expect(INK.note).toBe(PALETTES.light.ink.note);
    expect(STAFF_GRADE.ok).toBe(PALETTES.light.grade.ok);
    expect(TRACE_COLORS[1]).toBe(PALETTES.light.highway.voice);
    expect(fpx(15)).toBe(20);

    applyDisplay({ appearance: 'system', textSize: undefined }, false, document);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.dataset.text).toBeUndefined();
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(THEME_COLOR.dark);
    expect(COLORS.bg).toBe(PALETTES.dark.highway.bg);
    expect(fpx(15)).toBe(15);
  });

  it('the status bar colour is each theme\'s page colour', () => {
    expect(THEME_COLOR.dark.toLowerCase()).toBe(tokens(':root {').bg);
    expect(THEME_COLOR.light.toLowerCase()).toBe(tokens(":root[data-theme='light'] {").bg);
  });
});

describe('contrast (WCAG AA: 4.5:1 for text)', () => {
  const dark = tokens(':root {');
  const light = { ...dark, ...tokens(":root[data-theme='light'] {") };

  it('every colour token has a light value', () => {
    const missing = Object.keys(dark).filter((k) => !(k in tokens(":root[data-theme='light'] {")));
    expect(missing).toEqual([]);
  });

  for (const [name, t] of [['dark', dark], ['light', light]] as const) {
    it(`${name}: text colours on every ground`, () => {
      const grounds = ['bg', 'bg-2', 'surface', 'surface-2'];
      const fails: string[] = [];
      for (const fg of ['text', 'muted', 'accent-text', 'voice', 'good', 'bad']) {
        for (const bg of grounds) if (contrast(t[fg], t[bg]) < 4.5) fails.push(`${fg} on ${bg}: ${contrast(t[fg], t[bg]).toFixed(2)}`);
      }
      // Tinted grounds and what is written on them.
      const pairs: [string, string][] = [
        ['accent-ink', 'accent'], ['accent-ink', 'voice'], ['accent-ink', 'good'], ['accent-ink', 'bad'], ['accent-ink', 'expert'],
        ['accent-text', 'accent-soft'], ['text', 'accent-soft'], ['voice', 'voice-bg'], ['text', 'voice-bg'], ['good', 'good-bg'], ['text', 'good-bg'],
        ['expert', 'expert-bg'], ['text', 'expert-bg'], ['expert-text', 'expert-ground'], ['expert-muted', 'expert-ground'],
        ['expert-text', 'expert-surface'], ['text', 'bad-bg'], ['muted', 'accent-soft'], ['muted', 'voice-bg'],
        ['gold', 'gold-bg'], ['text', 'gold-bg'],
      ];
      for (const [fg, bg] of pairs) if (contrast(t[fg], t[bg]) < 4.5) fails.push(`${fg} on ${bg}: ${contrast(t[fg], t[bg]).toFixed(2)}`);
      expect(fails).toEqual([]);
    });

    it(`${name}: the canvases' text and notes on their ground`, () => {
      const p = PALETTES[name];
      const bg = p.highway.bg;
      for (const c of [p.highway.label, p.highway.targetText, p.highway.text, p.ink.note, p.ink.lyric, p.ink.clef, p.highway.voice]) {
        expect(contrast(c, bg)).toBeGreaterThanOrEqual(4.5);
      }
      for (const g of ['good', 'ok', 'miss'] as const) expect(contrast(p.grade[g], bg)).toBeGreaterThanOrEqual(4.5);
      // Secondary marks (bar numbers, past words, the target note) at least 3:1 (graphics, large text).
      for (const c of [p.ink.barNo, p.ink.lyricPast, p.highway.target, p.ink.staff, p.highway.labelDim]) expect(contrast(c, bg)).toBeGreaterThanOrEqual(3);
      // The page around the canvas is the canvas' own ground or close to it.
      expect(contrast(bg, name === 'dark' ? dark.canvas : light.canvas)).toBeLessThan(1.1);
    });
  }
});

describe('colours and sizes come from the theme', () => {
  /** Files that may name colours: the palettes, and a few things that are the same in both themes. */
  const ALLOWED = new Set([
    'play/palette.ts', 'theme.ts', // the palettes themselves
    'play/arcade3d.ts', // the arcade's night scene, the same in both themes
    'components/ChoirLogo.tsx', // a logo's white tile
    'components/IntroVideo.tsx', // the video's black letterbox
    'screens/MemoryMap.tsx', // its print style (black on white paper)
  ]);
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });

  it('no screen, component or renderer writes a colour of its own', () => {
    const bad: string[] = [];
    for (const f of files(here)) {
      const rel = path.relative(here, f).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/['"`(:\s](#[0-9a-fA-F]{3,8})\b|rgba?\(\s*\d/g)) bad.push(`${rel}: ${m[0].trim()}`);
    }
    expect(bad).toEqual([]);
  });

  it('styles.css: colours only in the token blocks, font sizes only in rem', () => {
    const body = css.slice(css.indexOf('/* Text size'));
    expect(body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([]);
    expect(body.match(/font(-size)?:[^;]*\d+px/g) ?? []).toEqual([]);
  });

  it('inline font sizes are in rem (they grow with the text size)', () => {
    const bad: string[] = [];
    for (const f of files(here)) {
      if (!f.endsWith('.tsx')) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/fontSize[:=] ?\{?\s*\d+/g)) bad.push(`${path.relative(here, f)}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });
});
