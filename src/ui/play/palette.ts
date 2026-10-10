// The colours and text size of everything drawn on a canvas (the highway, the score view, the full
// score, the mistake score, the words lane). One object per renderer, changed in place when the
// singer switches Settings → Display (ui/theme.ts calls setCanvasTheme): renderers read them every
// frame, so nothing is allocated per frame and no renderer keeps a copy. Layout and static-layer
// caches include canvasGeneration() in their keys, so they are rebuilt after a switch.
import type { Grade } from '../../game/types';

export type ThemeName = 'dark' | 'light';

/** The highway's colours (also the base of the score view's). */
export interface HighwayColors {
  bg: string;
  row: string;
  rowKey: string;
  label: string;
  /** Note names off the key (the highway's gutter). */
  labelDim: string;
  target: string;
  targetSoft: string;
  targetText: string;
  voice: string;
  voiceDeep: string;
  /** The halo around the live voice dot. */
  voiceHalo: string;
  miss: string;
  ghost: string;
  text: string;
  measure: string;
  /** The playhead ("now" line). */
  playhead: string;
  /** Behind the pitch bubble and the "Do = G" hints. */
  bubble: string;
  /** Text on a filled note (sung, or being sung). */
  onFill: string;
  /** The voice trace's halo (so it reads across a notehead of its own colour). */
  traceHalo: string;
  /** `bg` fully transparent (the soft edge where a scrolling line slides under the clef). */
  bgClear: string;
}

/** The engraver's ink (score view, mistake score). */
export interface StaffInk {
  staff: string;
  bar: string;
  note: string;
  clef: string;
  lyric: string;
  lyricPast: string;
  barNo: string;
  outTune: string;
  rest: string;
  traceRest: string;
  /** The full score: the other voices' notes and words, your staff's band. */
  otherNote: string;
  otherLyric: string;
  ownBand: string;
  /** The playhead's softer line through the other staves of the full score. */
  playheadSoft: string;
  /** The mistake score: the wrong bar's tint, the tag text, the tag's backdrop and its text. */
  wrongBar: string;
  wrongHead: string;
  tagBg: string;
  tagText: string;
}

const DARK_HIGHWAY: HighwayColors = {
  bg: '#0F1226',
  row: '#1A1F3D',
  rowKey: '#141833',
  label: '#A8B0D6',
  labelDim: '#6B739C',
  target: '#FF7A45',
  targetSoft: '#2A1A16',
  targetText: '#FFB08F',
  voice: '#4CC9F0',
  voiceDeep: '#1D4F63',
  voiceHalo: 'rgba(76,201,240,0.25)',
  miss: '#FF5D73',
  ghost: '#4A5288',
  text: '#EEF0FF',
  measure: '#262B4D',
  playhead: 'rgba(238,240,255,0.85)',
  bubble: '#0B0D1A',
  onFill: '#0B0D1A',
  traceHalo: 'rgba(15,18,38,0.85)',
  bgClear: 'rgba(15,18,38,0)',
};

// Light: the same roles on paper. Text colours keep ≥ 4.5:1 on the page (palette.test.ts).
const LIGHT_HIGHWAY: HighwayColors = {
  bg: '#FFFFFF',
  row: '#E3E6F0',
  rowKey: '#F1F3F9',
  label: '#4E5576',
  labelDim: '#6E7493',
  target: '#C2410C',
  targetSoft: '#FDE8DE',
  targetText: '#A63C0C',
  voice: '#0E7490',
  voiceDeep: '#8BCBDC',
  voiceHalo: 'rgba(14,116,144,0.22)',
  miss: '#BE123C',
  ghost: '#9AA1C0',
  text: '#12142B',
  measure: '#D3D7E6',
  playhead: 'rgba(18,20,43,0.78)',
  bubble: '#FFFFFF',
  onFill: '#FFFFFF',
  traceHalo: 'rgba(255,255,255,0.9)',
  bgClear: 'rgba(255,255,255,0)',
};

const DARK_INK: StaffInk = {
  staff: '#5B638F',
  bar: '#7E86B4',
  note: '#E8EBFF',
  clef: '#B9C0E6',
  lyric: '#D5DAF5',
  lyricPast: '#7C84AE',
  barNo: '#8790BC',
  outTune: '#FFB08F',
  rest: '#8A93C2',
  traceRest: '#8C96CC',
  otherNote: '#AEB5DB',
  otherLyric: '#9AA2CB',
  ownBand: 'rgba(76,201,240,0.075)',
  playheadSoft: 'rgba(238,240,255,0.7)',
  wrongBar: 'rgba(255,93,115,0.11)',
  wrongHead: '#FFB3BE',
  tagBg: '#3B1520',
  tagText: '#FFD3DA',
};

const LIGHT_INK: StaffInk = {
  staff: '#848BA8',
  bar: '#6E7594',
  note: '#161933',
  clef: '#2E3350',
  lyric: '#23273F',
  lyricPast: '#6E7493',
  barNo: '#5B6282',
  outTune: '#C2410C',
  rest: '#5B6282',
  traceRest: '#848BA8',
  otherNote: '#4E5576',
  otherLyric: '#5B6282',
  ownBand: 'rgba(14,116,144,0.07)',
  playheadSoft: 'rgba(18,20,43,0.55)',
  wrongBar: 'rgba(190,18,60,0.08)',
  wrongHead: '#BE123C',
  tagBg: '#FDE2E7',
  tagText: '#8A0F2E',
};

/** Grades of sung notes on the staff (blue well sung, yellow close, red missed). */
const DARK_GRADE: Record<Grade, string> = { perfect: '#4CC9F0', good: '#4CC9F0', ok: '#F2D15C', miss: '#FF5D73' };
const LIGHT_GRADE: Record<Grade, string> = { perfect: '#0E7490', good: '#0E7490', ok: '#A16207', miss: '#BE123C' };

export const PALETTES: Record<ThemeName, { highway: HighwayColors; ink: StaffInk; grade: Record<Grade, string> }> = {
  dark: { highway: DARK_HIGHWAY, ink: DARK_INK, grade: DARK_GRADE },
  light: { highway: LIGHT_HIGHWAY, ink: LIGHT_INK, grade: LIGHT_GRADE },
};

/** The renderers' live colours (changed in place by setCanvasTheme). */
export const COLORS: HighwayColors = { ...DARK_HIGHWAY };
export const INK: StaffInk = { ...DARK_INK };
export const STAFF_GRADE: Record<Grade, string> = { ...DARK_GRADE };
/** The voice trace by state: in a rest, in tune, out of tune (staff2d's TR_REST, TR_IN, TR_OUT). */
export const TRACE_COLORS: string[] = [DARK_INK.traceRest, DARK_HIGHWAY.voice, DARK_INK.outTune];

let theme: ThemeName = 'dark';
let scale = 1;
let gen = 0;
const listeners = new Set<() => void>();

/** Called after every change of colours or text size; returns the unsubscribe. */
export function onCanvasTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The canvas theme in use. */
export const canvasTheme = (): ThemeName => theme;
/** Text scale of canvas labels (Settings → Display → Text size): 1, 1.15 or 1.3. */
export const canvasTextScale = (): number => scale;
/** Bumped on every change of colours or text size (part of the renderers' cache keys). */
export const canvasGeneration = (): number => gen;
/** A font size (CSS px) at the singer's text size, rounded to whole px. */
export const fpx = (px: number): number => Math.round(px * scale);

export function setCanvasTheme(name: ThemeName, textScale = scale): void {
  if (name === theme && textScale === scale) return;
  theme = name;
  scale = textScale;
  const p = PALETTES[name];
  Object.assign(COLORS, p.highway);
  Object.assign(INK, p.ink);
  Object.assign(STAFF_GRADE, p.grade);
  TRACE_COLORS[0] = p.ink.traceRest;
  TRACE_COLORS[1] = p.highway.voice;
  TRACE_COLORS[2] = p.ink.outTune;
  gen++;
  listeners.forEach((l) => l());
}
