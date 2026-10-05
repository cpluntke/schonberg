// The score view on a wide screen: the full score (all voices, plus the accompaniment when it stays
// readable), several bars per system, your own staff highlighted and the only one with your voice
// drawn on it. Narrow screens (phones) get the single-staff view (staff2d.ts) unchanged.
import type { KeySig, Part } from '../../music/types';
import { beatToTime, timeToBeat } from '../../music/time';
import { COLORS, type DrawState } from './highway2d';
import {
  INK, buildSysDraw, drawBarline, drawBubble, drawCountdown, drawOutlines, drawStaff2D, drawStaffFrame, drawStaffNotes,
  drawTrace, fontGeneration, lyricFontFor, measureSpan, middleStep, spell, systemAt, updateTrace, xAtBeat,
  type Cached, type StaffLayout, type SysGeo, type Vis,
} from './staff2d';
import { layoutFullScore, planStaves, type FullLayout, type StaffShow, type StaffSpec } from './fullscore';

type Ctx = CanvasRenderingContext2D;

/** Narrowest canvas (CSS px) that gets the full score; phones (also in landscape) stay single-staff. */
export const FULL_MIN_W = 860;
/** Staff space (px): never larger than this on a laptop, and no system smaller than SP_MIN. */
const SP_MAX = 9;
const SP_GOOD = 7;
const SP_MIN = 5.6;
/** Extra space between two systems (staff spaces). */
const SYS_GAP = 2.2;

/** What the score view drew (for the screen around it). */
export interface ScoreViewInfo {
  full: boolean;
  /** Staves drawn (1 = your part only). */
  staves: number;
  accompaniment: boolean;
  /** Lyrics under every voice (else only under yours). */
  lyricsAll: boolean;
  systems: number;
}

const OTHER = { note: '#AEB5DB', lyric: '#9AA2CB' };
const OWN_BAND = 'rgba(76,201,240,0.075)';

interface StaffRow {
  spec: StaffSpec;
  /** Top line, in staff spaces from the system's top. */
  y: number;
  above: number;
  below: number;
  lyrics: boolean;
  L: Cached;
  /** DrawState for another voice's staff (plain, its own notes). */
  s: DrawState | null;
}

interface FullCache {
  key: string;
  F: FullLayout;
  rows: StaffRow[];
  own: number;
  sp: number;
  /** Height of a system (px, without the gap). */
  sysH: number;
  fit: number;
  info: ScoreViewInfo;
  nameFont: string;
  /** Static layers of systems (see staticLayer), at layerDpr. */
  layers: Map<number, HTMLCanvasElement | OffscreenCanvas>;
  layerDpr: number;
}
let full: FullCache | null = null;
/** Layouts that didn't fit (key → null) so they aren't tried again every frame. */
let noFit: string | null = null;

/** Vertical room of a staff (staff spaces), from the notes of the section. */
function extents(spec: StaffSpec, key: KeySig, from: number, to: number, lyrics: boolean, first: boolean) {
  const mid = middleStep(spec.clef);
  let lo = mid - 4;
  let hi = mid + 4;
  for (const n of spec.part.notes) {
    if (n.start + n.dur <= from || n.start >= to) continue;
    const st = spell(n.midi, key).step;
    if (st < lo) lo = st;
    if (st > hi) hi = st;
  }
  let above = Math.max(spec.own ? 2.6 : 1.5, (hi - (mid + 4)) / 2 + 1.5);
  if (first) above = Math.max(above, 2.7); // bar numbers
  const noteBelow = ((mid - 4) - lo) / 2;
  const lyricOff = Math.max(2.9, noteBelow + 2.4);
  const below = lyrics ? lyricOff + 1.0 : Math.max(1.5, noteBelow + 1.5);
  return { above, below, lyricOff };
}

function candidates(show: StaffShow): { show: StaffShow; lyrics: 'all' | 'own' }[] {
  if (show === 'all') return [{ show: 'all', lyrics: 'all' }, { show: 'all', lyrics: 'own' }, { show: 'voices', lyrics: 'all' }, { show: 'voices', lyrics: 'own' }];
  return [{ show: 'voices', lyrics: 'all' }, { show: 'voices', lyrics: 'own' }];
}

function stripLyrics(p: Part): Part {
  return { ...p, notes: p.notes.map((n) => (n.lyric ? { ...n, lyric: undefined, syllabic: undefined } : n)) };
}

function getFull(c: Ctx, W: number, H: number, s: DrawState, show: StaffShow): FullCache | null {
  const key = `${s.score.id}|${s.part.id}|${s.part.notes.length}|${s.from}|${s.to}|${W}|${H}|${fontGeneration()}|${show}`;
  if (full && full.key === key) return full;
  if (noFit === key) return null;
  const [m0, m1] = measureSpan(s.score, s.from, s.to);
  const key0 = s.key;
  const avail = H - 12;
  // Most systems that stay readable: all staves with words under every voice if possible, then
  // words only under yours, then without the accompaniment; two or three systems when they fit at
  // a good size, else one.
  type Pick = { specs: StaffSpec[]; ex: ReturnType<typeof extents>[]; lyr: boolean[]; n: number; sp: number; lyrics: 'all' | 'own'; show: StaffShow };
  let pick: Pick | null = null;
  const tries: Pick[] = [];
  for (const cand of candidates(show)) {
    const specs = planStaves(s.score, s.part.id, cand.show);
    if (specs.length < 2 || !specs.some((x) => x.own)) continue;
    const lyr = specs.map((x) => x.hasLyrics && (x.own || cand.lyrics === 'all'));
    const ex = specs.map((x, i) => extents(x, key0, s.from, s.to, lyr[i], i === 0));
    const U = ex.reduce((a, e) => a + e.above + 4 + e.below, 0);
    for (let n = 3; n >= 1; n--) tries.push({ specs, ex, lyr, n, sp: Math.min(SP_MAX, avail / (n * (U + SYS_GAP))), lyrics: cand.lyrics, show: cand.show });
  }
  // The first choice that is comfortably readable (several systems, else one), else any that's legible.
  pick = tries.find((t) => (t.n > 1 && t.sp >= SP_GOOD) || (t.n === 1 && t.sp >= SP_GOOD - 0.5))
    ?? tries.find((t) => t.n === 1 && t.sp >= SP_MIN) ?? null;
  if (!pick) {
    noFit = key;
    return null;
  }
  let sp = pick.sp;
  const { specs, ex, lyr } = pick;
  const nameFont = (size: number) => `700 ${Math.round(size)}px "Bricolage Grotesque", system-ui, sans-serif`;
  const nameSize = Math.max(11, Math.min(14, sp * 1.45));
  c.font = nameFont(nameSize);
  const nameW = Math.max(...specs.map((x) => c.measureText(x.short).width));
  const left = Math.round(10 + nameW + 2.4 * sp);
  const lyricIds = new Set(specs.filter((_, i) => lyr[i]).map((x) => x.id));
  let F: FullLayout;
  for (let guard = 0; ; guard++) {
    c.font = lyricFontFor(sp);
    const textW = (t: string) => c.measureText(t).width;
    F = layoutFullScore(s.score, specs, m0, m1, { width: W, sp, textW, lyricIds, left, maxBars: 12 });
    let worst = Infinity;
    for (const sy of F.staves[0]?.systems ?? []) worst = Math.min(worst, sy.squeeze);
    if (worst >= 0.85 || sp <= SP_MIN + 1e-6 || guard >= 4) break;
    sp = Math.max(SP_MIN, sp * 0.92);
  }
  let y = 0;
  const rows: StaffRow[] = F.staves.map((fs, i) => {
    const e = ex[i];
    y += e.above;
    const layout: StaffLayout = { clef: fs.clef, mid: fs.mid, sp, systems: fs.systems, minStep: fs.minStep, maxStep: fs.maxStep };
    const L: Cached = {
      key, layout, above: e.above, below: e.below, band: 0, lyricFont: lyricFontFor(sp), lyricOff: e.lyricOff, sys: [], textW: new Map(),
    };
    const row: StaffRow = {
      spec: fs.spec, y, above: e.above, below: e.below, lyrics: lyr[i], L,
      s: fs.spec.own ? null : { ...s, part: lyr[i] ? fs.spec.part : stripLyrics(fs.spec.part), range: null, hide: undefined, live: null, samples: [] },
    };
    y += 4 + e.below;
    return row;
  });
  const own = rows.findIndex((r) => r.spec.own);
  const sysH = y * sp;
  const fit = Math.max(1, Math.floor(avail / (sysH + SYS_GAP * sp)));
  full = {
    key, F, rows, own, sp, sysH, fit, nameFont: nameFont(nameSize), layers: new Map(), layerDpr: 0,
    info: {
      full: true, staves: rows.length, accompaniment: rows.some((r) => r.spec.kind === 'inst'),
      lyricsAll: pick.lyrics === 'all' || rows.filter((r) => r.spec.hasLyrics).length <= 1, systems: fit,
    },
  };
  return full;
}

/**
 * The score view: the full score on a wide canvas when the singer wants more than their own part
 * and it fits readably, else the single staff. Returns what was drawn.
 */
export function drawScoreView(c: Ctx, W: number, H: number, s: DrawState): ScoreViewInfo {
  if (!import.meta.env.DEV) return drawScoreViewInner(c, W, H, s);
  // Dev builds: the last frames' draw times, for the QA script (qa/fullscore-shots.mjs).
  const t = performance.now();
  const info = drawScoreViewInner(c, W, H, s);
  const g = globalThis as { __scoreDrawMs?: number[] };
  (g.__scoreDrawMs ??= []).push(performance.now() - t);
  if (g.__scoreDrawMs.length > 600) g.__scoreDrawMs.splice(0, 300);
  return info;
}

function drawScoreViewInner(c: Ctx, W: number, H: number, s: DrawState): ScoreViewInfo {
  const show = s.staves ?? 'all';
  const F = W >= FULL_MIN_W && show !== 'mine' ? getFull(c, W, H, s, show) : null;
  if (!F) {
    drawStaff2D(c, W, H, s);
    return { full: false, staves: 1, accompaniment: false, lyricsAll: false, systems: 0 };
  }
  drawFull(c, W, H, s, F);
  return F.info;
}

/** Margin (staff spaces) of a system's layer above and below the system. */
const LAYER_M = 3;
const PLAIN: Vis = { vis: () => 'show', isPast: () => false, isNow: () => false, inRange: () => false, plain: OTHER };

function systemGeos(F: FullCache, j: number, sysTop: number, s: DrawState): SysGeo[] {
  return F.rows.map((r) => {
    const top = sysTop + r.y * F.sp;
    return { j, sys: r.L.layout.systems[j], sd: sysDraw(r, j, (r.s ?? s).part.notes), top, mid: top + 2 * F.sp } as SysGeo;
  });
}

/** Staves, names, brackets, barlines and the other voices' notes and words. */
function drawStatic(c: Ctx, F: FullCache, geos: SysGeo[], s: DrawState) {
  drawSystemFrame(c, F, geos, s, geos[0].j);
  F.rows.forEach((r, i) => {
    if (r.s) drawStaffNotes(c, geos[i], r.L.layout, r.L, r.s, PLAIN);
  });
}

/** The static part of system j, rendered once at device resolution (null without a canvas API). */
function staticLayer(F: FullCache, j: number, W: number, dpr: number, s: DrawState): HTMLCanvasElement | OffscreenCanvas | null {
  const have = F.layers.get(j);
  if (have) return have;
  const w = Math.ceil(W * dpr);
  const h = Math.ceil((F.sysH + 2 * LAYER_M * F.sp) * dpr);
  let cv: HTMLCanvasElement | OffscreenCanvas | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(w, h);
    else if (typeof document !== 'undefined') {
      cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
    }
  } catch { cv = null; }
  const lc = cv?.getContext('2d') as Ctx | null | undefined;
  if (!cv || !lc) return null;
  lc.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawStatic(lc, F, systemGeos(F, j, LAYER_M * F.sp, s), s);
  F.layers.set(j, cv);
  return cv;
}

function sysDraw(row: StaffRow, j: number, notes: Part['notes']) {
  return (row.L.sys[j] ??= buildSysDraw(row.L.layout.systems[j], row.L.layout, notes));
}

function drawFull(c: Ctx, W: number, H: number, s: DrawState, F: FullCache) {
  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, W, H);
  const { rows, sp } = F;
  const ownRow = rows[F.own];
  const systems = ownRow.L.layout.systems;
  if (!systems.length) return;
  const tempos = s.score.tempos;
  const beat = timeToBeat(tempos, s.pos);
  const k = systemAt(systems, beat);
  const fit = F.fit;
  const base = F.sysH + SYS_GAP * sp;
  const spare = H - 12 - fit * base;
  const band = base + (fit > 1 ? Math.min(0.3 * base, spare / fit) : 0);
  const pad = Math.max(6, Math.min(fit > 1 ? 24 : 48, (H - fit * band) / 2 + (fit > 1 ? (band - base) / 2 : 0)));
  const t0 = beatToTime(tempos, systems[k].startBeat);
  const u = k > 0 ? Math.max(0, Math.min(1, (s.pos - t0) / (0.35 * Math.max(0.3, s.rate)))) : 1;
  const shift = (1 - (1 - (1 - u) ** 3)) * band;

  const notes = s.part.notes;
  const [ra, rb] = s.range ?? [0, -1];
  const inRange = (i: number) => s.range != null && i >= ra && i <= rb;
  const isPast = (i: number) => notes[i].start + notes[i].dur <= s.pos;
  const isNow = (i: number) => inRange(i) && notes[i].start <= s.pos && s.pos < notes[i].start + notes[i].dur;
  const vis = (i: number): 'show' | 'letters' | 'none' => ((isPast(i) && inRange(i)) || !s.hide ? 'show' : s.hide(i));
  const v: Vis = { vis, isPast, isNow, inRange };
  const dpr = c.getTransform().a || 1;
  if (F.layerDpr !== dpr) {
    F.layers.clear();
    F.layerDpr = dpr;
  }

  const ownGeos: SysGeo[] = [];
  const shown = new Set<number>();
  for (let j = k - (shift > 0.5 ? 1 : 0); j < k + fit; j++) {
    if (j < 0 || j >= systems.length) continue;
    // On whole device pixels, so the cached layer and the live drawing line up exactly.
    const sysTop = Math.round((pad + (j - k) * band + shift) * dpr) / dpr;
    if (sysTop > H || sysTop + F.sysH < 0) continue;
    shown.add(j);
    const geos = systemGeos(F, j, sysTop, s);
    // Everything but your notes is the same every frame: drawn once per system into a layer.
    const layer = staticLayer(F, j, W, dpr, s);
    if (layer) c.drawImage(layer, 0, sysTop - LAYER_M * sp, W, layer.height / dpr);
    else drawStatic(c, F, geos, s);
    drawStaffNotes(c, geos[F.own], ownRow.L.layout, ownRow.L, s, v);
    ownGeos.push(geos[F.own]);
  }
  for (const j of [...F.layers.keys()]) if (!shown.has(j) && j !== k + fit) F.layers.delete(j);

  // Your voice, on your staff only.
  updateTrace(s, ownRow.L);
  for (const g of ownGeos) drawTrace(c, g, s, ownRow.L, beat);
  for (const g of ownGeos) drawOutlines(c, g, s, v, sp);

  // Playhead through every staff of the current system.
  const cur = ownGeos.find((g) => g.j === k);
  if (cur) {
    const sys = cur.sys;
    const px = beat < sys.startBeat ? sys.prefixEnd - 0.2 * sp : xAtBeat(sys, beat);
    const sysTop = cur.top - ownRow.y * sp;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const yTop = sysTop + (first.y - 1.4) * sp;
    const yBot = sysTop + (last.y + 4 + Math.min(1.2, last.below)) * sp;
    c.fillStyle = 'rgba(238,240,255,0.7)';
    c.fillRect(Math.round(px) - 1, yTop, 2, yBot - yTop);
    // Brighter across your staff.
    c.fillStyle = 'rgba(238,240,255,0.95)';
    c.fillRect(Math.round(px) - 1, cur.top - 1.2 * sp, 2, (6.4 + Math.max(0, ownRow.L.lyricOff - 1.6)) * sp);
    c.beginPath();
    c.moveTo(px - 0.6 * sp, yTop - 0.7 * sp);
    c.lineTo(px + 0.6 * sp, yTop - 0.7 * sp);
    c.lineTo(px, yTop + 0.1 * sp);
    c.closePath();
    c.fill();
    drawCountdown(c, cur, s, ownRow.L, px, cur.top - Math.max(1.2, ownRow.above - 1.2) * sp);
    drawBubble(c, cur, s, ownRow.L, px);
  }
}

/** Staves, clefs, signatures, barlines, brackets, names and your staff's band for one system. */
function drawSystemFrame(c: Ctx, F: FullCache, geos: SysGeo[], s: DrawState, j: number) {
  const { rows, sp } = F;
  const lw = Math.max(1, Math.round(sp * 0.1));
  const sys0 = geos[0].sys;
  const left = sys0.clefX - 0.3 * sp;
  // Your staff: a soft band behind it (from above its notes to below its words).
  const og = geos[F.own];
  const or = rows[F.own];
  c.fillStyle = OWN_BAND;
  c.fillRect(left - 2.2 * sp, og.top - (or.above - 0.4) * sp, sys0.x1 - left + 2.6 * sp, (or.above - 0.4 + 4 + or.below + 0.1) * sp);
  c.fillStyle = COLORS.voice;
  c.fillRect(left - 2.2 * sp, og.top - (or.above - 0.4) * sp, 3, (or.above - 0.4 + 4 + or.below + 0.1) * sp);

  rows.forEach((r, i) => drawStaffFrame(c, geos[i], r.L.layout, s, { barlines: false, numbers: i === 0 }));

  // Barlines: through the accompaniment's grand staff, per staff for the voices (room for words).
  const nM = s.score.measures.length;
  const h4 = 4 * sp + lw;
  let i = 0;
  while (i < rows.length) {
    let i1 = i;
    if (rows[i].spec.kind === 'inst') while (i1 + 1 < rows.length && rows[i1 + 1].spec.kind === 'inst') i1++;
    const top = geos[i].top;
    const bot = geos[i1].top + h4;
    const ms = geos[i].sys.measures;
    ms.forEach((m, mi) => drawBarline(c, m, mi === ms.length - 1, nM, top, bot - top, sp, lw));
    i = i1 + 1;
  }
  // System start: one line joining all staves.
  const yTop = geos[0].top;
  const yBot = geos[geos.length - 1].top + h4;
  c.fillStyle = INK.bar;
  c.fillRect(left, yTop, lw, yBot - yTop);

  // Bracket over the voices, brace over the accompaniment's two staves.
  const voices = rows.map((r, q) => (r.spec.kind === 'voice' ? q : -1)).filter((q) => q >= 0);
  if (voices.length > 1) drawBracket(c, left - 0.9 * sp, geos[voices[0]].top, geos[voices[voices.length - 1]].top + h4, sp, INK.clef);
  const inst = rows.map((r, q) => (r.spec.kind === 'inst' ? q : -1)).filter((q) => q >= 0);
  if (inst.length > 1) drawBrace(c, left - 1.6 * sp, geos[inst[0]].top, geos[inst[inst.length - 1]].top + h4, sp, INK.clef);

  // Names, right-aligned before the brackets.
  c.font = F.nameFont;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  const nx = left - 2.0 * sp - (inst.length > 1 ? 0.3 * sp : 0);
  const done = new Set<string>();
  rows.forEach((r, q) => {
    if (r.spec.kind === 'inst') {
      if (done.has('inst')) return;
      done.add('inst');
      const y = (geos[inst[0]].mid + geos[inst[inst.length - 1]].mid) / 2;
      c.fillStyle = INK.lyric;
      c.fillText(r.spec.short, nx, y);
      return;
    }
    c.fillStyle = r.spec.own ? COLORS.voice : INK.lyric;
    c.fillText(r.spec.short, nx, geos[q].mid);
  });
  c.textAlign = 'left';
  void j;
}

function drawBracket(c: Ctx, x: number, y0: number, y1: number, sp: number, color: string) {
  const t = Math.max(2.5, 0.42 * sp);
  const ext = 0.6 * sp;
  c.fillStyle = color;
  c.fillRect(x, y0 - ext, t, y1 - y0 + 2 * ext);
  // Hooks.
  for (const [y, d] of [[y0 - ext, -1], [y1 + ext, 1]] as const) {
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + 1.0 * sp, y, x + 1.6 * sp, y + d * 0.9 * sp);
    c.quadraticCurveTo(x + 1.0 * sp, y - d * 0.35 * sp, x, y - d * 0.45 * sp);
    c.closePath();
    c.fill();
  }
}

function drawBrace(c: Ctx, x: number, y0: number, y1: number, sp: number, color: string) {
  const h = y1 - y0;
  const ym = (y0 + y1) / 2;
  const w = Math.max(0.9 * sp, Math.min(1.4 * sp, h * 0.08));
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x + w, y0);
  c.bezierCurveTo(x - 0.1 * w, y0 + h * 0.08, x + 0.9 * w, y0 + h * 0.4, x, ym);
  c.bezierCurveTo(x + 0.9 * w, y1 - h * 0.4, x - 0.1 * w, y1 - h * 0.08, x + w, y1);
  c.bezierCurveTo(x + 0.3 * w, y1 - h * 0.1, x + 1.3 * w, y1 - h * 0.38, x + 0.05 * w, ym);
  c.bezierCurveTo(x + 1.3 * w, y0 + h * 0.38, x + 0.3 * w, y0 + h * 0.1, x + w, y0);
  c.fill();
}
