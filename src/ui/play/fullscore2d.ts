// The score view on a wide screen: the full score (all voices, plus the accompaniment when it stays
// readable), several bars per system, your own staff highlighted and the only one with your voice
// drawn on it. Narrow screens (phones) get the single-staff view (staff2d.ts) unchanged.
import type { KeySig, Part } from '../../music/types';
import { nameKeysSig } from '../../progress/keymarks';
import type { NotationMode } from '../../game/notation';
import { beatToTime, timeToBeat } from '../../music/time';
import { COLORS, type DrawState } from './highway2d';
import {
  INK, buildSysDraw, drawBarline, drawBubble, drawCountdown, drawOutlines, drawStaff2D, drawStaffFrame, drawStaffNotes,
  drawTrace, fontGeneration, lyricFontFor, measureSpan, middleStep, nameFontFor, nameMeasure, namesOn, spell, systemAt,
  scrollOffset, textRows, updateTrace, xAtBeat,
  type Cached, type StaffLayout, type StaffSystem, type SysGeo, type Vis,
} from './staff2d';
import { doublings, layoutFullScore, planStaves, type FullLayout, type StaffShow, type StaffSpec } from './fullscore';

type Ctx = CanvasRenderingContext2D;

/** Narrowest canvas (CSS px) that gets the full score; phones (also in landscape) stay single-staff. */
export const FULL_MIN_W = 860;
/** Staff space (px): never larger than this on a laptop, and no system smaller than SP_MIN. */
const SP_MAX = 9;
const SP_GOOD = 7;
const SP_MIN = 5.6;
/** Extra space between two systems (staff spaces). */
const SYS_GAP = 2.2;
/** Two systems are worth a slightly smaller staff (words only under yours). */
const SP_TWO = 6.2;

/** What the score view drew (for the screen around it). */
export interface ScoreViewInfo {
  full: boolean;
  /** What's shown, for screen readers ("Full score: S A T B + organ, your part: alto"). */
  label: string;
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
  /** Off book: this staff's notes that double yours (their index → yours). */
  doubled: Map<number, number> | null;
  /** How the static layer draws this staff (without the doublings). */
  plain: Vis;
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

/** A duration that is written as a triplet (its "3" goes above the staff). */
const isTriplet = (d: number) => Math.abs(d * 3 - Math.round(d * 3)) < 0.02 && Math.abs(d * 4 - Math.round(d * 4)) > 0.02;

/** Vertical room of a staff (staff spaces), from the notes of the section. */
function extents(spec: StaffSpec, key: KeySig, from: number, to: number, lyrics: boolean, first: boolean, names: NotationMode | null = null) {
  const mid = middleStep(spec.clef);
  let lo = mid - 4;
  let hi = mid + 4;
  let tup = false;
  for (const n of spec.part.notes) {
    if (n.start + n.dur <= from || n.start >= to) continue;
    const st = spell(n.midi, key, n.spelling).step;
    if (st < lo) lo = st;
    if (st > hi) hi = st;
    if (!tup && isTriplet(n.durBeats)) tup = true;
  }
  let above = Math.max(spec.own ? 2.6 : 1.5, (hi - (mid + 4)) / 2 + 1.5);
  // Triplet numbers sit above the stems: keep them out of the words of the staff above.
  if (tup) above = Math.max(above + 1.6, 3.4);
  if (first) above = Math.max(above, 2.7); // bar numbers
  const noteBelow = ((mid - 4) - lo) / 2;
  // Your staff with note names: their row under it (sized for a typical full-score staff space).
  const { nameOff, lyricOff } = textRows(noteBelow, SP_GOOD, { min: 2.9, pad: 2.4, names: !!names, notation: names ?? 'letter' });
  const below = lyrics ? lyricOff + 1.0 : nameOff != null ? nameOff + 1.0 : Math.max(1.5, noteBelow + 1.5);
  return { above, below, lyricOff, nameOff };
}

/** Off book, other voices' words would be your words: none, and no accompaniment (it doubles you). */
function shows(show: StaffShow, offBook: boolean): StaffShow[] {
  return offBook || show === 'voices' ? ['voices'] : ['all', 'voices'];
}

function stripLyrics(p: Part): Part {
  return { ...p, notes: p.notes.map((n) => (n.lyric ? { ...n, lyric: undefined, syllabic: undefined } : n)) };
}

function getFull(c: Ctx, W: number, H: number, s: DrawState, show: StaffShow): FullCache | null {
  const offBook = !!s.hide;
  const names = namesOn(s) ? s.notation : null;
  const key = `${s.score.id}|${s.part.id}|${s.part.notes.length}|${s.from}|${s.to}|${W}|${H}|${fontGeneration()}|${show}|${offBook}|${names ?? '-'}|${s.notation}|${nameKeysSig(s.score)}|${s.scroll ? 'scroll' : 'page'}`;
  if (full && full.key === key) return full;
  if (noFit === key) return null;
  const [m0, m1] = measureSpan(s.score, s.from, s.to);
  const key0 = s.key;
  const avail = H - 12;
  // What to draw, for each choice of staves (the singer's first): at least two systems, so the
  // next line is always in view: with words under every voice at a good size, else words only
  // under yours at a slightly smaller size. Only then one system (it turns a bar early, see
  // breakSystemsOverlap), and only then fewer staves.
  type Pick = { specs: StaffSpec[]; ex: ReturnType<typeof extents>[]; lyr: boolean[]; n: number; sp: number; lyrics: 'all' | 'own'; show: StaffShow };
  let pick: Pick | null = null;
  const sized = (sh: StaffShow, lyrics: 'all' | 'own', n: number): Pick | null => {
    const specs = planStaves(s.score, s.part.id, sh);
    if (specs.length < 2 || !specs.some((x) => x.own)) return null;
    const lyr = specs.map((x) => x.hasLyrics && (x.own || (lyrics === 'all' && !offBook)));
    const ex = specs.map((x, i) => extents(x, key0, s.from, s.to, lyr[i], i === 0, x.own ? names : null));
    const U = ex.reduce((a, e) => a + e.above + 4 + e.below, 0);
    return { specs, ex, lyr, n, sp: Math.min(SP_MAX, avail / (n * (U + SYS_GAP))), lyrics, show: sh };
  };
  // (a scrolling score is one line: all the height for it)
  const rules: [('all' | 'own'), number, number][] = s.scroll ? [['all', 1, SP_GOOD - 0.5], ['own', 1, SP_GOOD - 0.5]] : [
    ['all', 3, SP_GOOD], ['all', 2, SP_GOOD], ['own', 3, SP_TWO], ['own', 2, SP_TWO], ['all', 1, SP_GOOD - 0.5], ['own', 1, SP_GOOD - 0.5],
  ];
  for (const sh of shows(show, offBook)) {
    for (const [lyrics, n, min] of rules) {
      const t = sized(sh, lyrics, n);
      if (t && t.sp >= min) { pick = t; break; }
    }
    if (pick) break;
  }
  if (!pick) {
    for (const sh of shows(show, offBook)) {
      const t = sized(sh, 'own', 1);
      if (t && t.sp >= SP_MIN) { pick = t; break; }
    }
  }
  if (!pick) {
    noFit = key;
    if (full) releaseLayers(full);
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
    const own = specs.find((x) => x.own);
    const nm = names && own ? { id: own.id, w: nameMeasure(c, nameFontFor(sp), names) } : undefined;
    F = layoutFullScore(s.score, specs, m0, m1, { width: W, sp, textW, lyricIds, names: nm, left, maxBars: 12, overlap: pick.n === 1, ...(s.scroll ? { scroll: SCROLL_BARS } : {}) });
    if (s.scroll) break;
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
      nameOff: e.nameOff, nameFont: e.nameOff != null ? nameFontFor(sp) : undefined,
    };
    // Off book: notes doubling yours (unison or octave, same onset) are drawn only once yours show.
    const dbl = offBook && !fs.spec.own ? doublings(s.part, fs.spec.part) : null;
    const row: StaffRow = {
      spec: fs.spec, y, above: e.above, below: e.below, lyrics: lyr[i], L,
      s: fs.spec.own ? null : { ...s, part: lyr[i] ? fs.spec.part : stripLyrics(fs.spec.part), range: null, hide: undefined, live: null, samples: [] },
      doubled: dbl && dbl.size ? dbl : null,
      plain: dbl && dbl.size ? { ...PLAIN, vis: (j: number) => (dbl.has(j) ? 'none' : 'show') } : PLAIN,
    };
    y += 4 + e.below;
    return row;
  });
  const own = rows.findIndex((r) => r.spec.own);
  const sysH = y * sp;
  const lowerName = (x: string) => x.toLowerCase();
  const voicesTxt = rows.filter((r) => r.spec.kind === 'voice').map((r) => r.spec.short).join(' ');
  const accRow = rows.find((r) => r.spec.acc);
  const instOwn = rows.find((r) => r.spec.kind === 'inst' && !r.spec.acc);
  const label = `Full score: ${voicesTxt}${instOwn ? `${voicesTxt ? ' + ' : ''}${lowerName(instOwn.spec.name)}` : ''}`
    + `${accRow ? ` + ${lowerName(accRow.spec.name)}` : ''}, your part: ${lowerName(s.part.name)}`;
  const fit = Math.max(1, Math.floor(avail / (sysH + SYS_GAP * sp)));
  if (full) releaseLayers(full);
  full = {
    key, F, rows, own, sp, sysH, fit, nameFont: nameFont(nameSize), layers: new Map(), layerDpr: 0,
    info: {
      full: true, staves: rows.length, accompaniment: rows.some((r) => r.spec.acc), label,
      lyricsAll: rows.every((r) => !r.spec.hasLyrics || r.lyrics), systems: fit,
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
    if (full?.layers.size) releaseLayers(full);
    drawStaff2D(c, W, H, s);
    return { full: false, label: `Sheet music: ${s.part.name}`, staves: 1, accompaniment: false, lyricsAll: false, systems: 0 };
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
    if (r.s) drawStaffNotes(c, geos[i], r.L.layout, r.L, r.s, r.plain);
  });
}

/** Release a replaced cache's layer bitmaps now (iOS keeps canvas memory until the size is zeroed). */
function releaseLayers(F: FullCache) {
  for (const cv of F.layers.values()) { cv.width = 0; cv.height = 0; }
  F.layers.clear();
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

/** Bars per stretch of a scrolling score (only the stretches in view are drawn). */
const SCROLL_BARS = 2;

/** The full score as one line scrolling smoothly to the left past a fixed playhead. */
function drawFullScroll(c: Ctx, W: number, H: number, s: DrawState, F: FullCache) {
  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, W, H);
  const { rows, sp } = F;
  const ownRow = rows[F.own];
  const systems = ownRow.L.layout.systems;
  if (!systems.length) return;
  const beat = timeToBeat(s.score.tempos, s.pos);
  const { off, px, k } = scrollOffset(systems, beat, W, sp);
  const sysTop = Math.round(Math.max(6, (H - F.sysH) / 2));
  const notes = s.part.notes;
  const [ra, rb] = s.range ?? [0, -1];
  const inRange = (i: number) => s.range != null && i >= ra && i <= rb;
  const isPast = (i: number) => notes[i].start + notes[i].dur <= s.pos;
  const isNow = (i: number) => inRange(i) && notes[i].start <= s.pos && s.pos < notes[i].start + notes[i].dur;
  const vis = (i: number): 'show' | 'letters' | 'none' => ((isPast(i) && inRange(i)) || !s.hide ? 'show' : s.hide(i));
  const v: Vis = { vis, isPast, isNow, inRange };
  const pinned = systems[0].prefixEnd;
  if (F.layers.size) releaseLayers(F);

  c.save();
  c.translate(-off, 0);
  const ownGeos: SysGeo[] = [];
  for (let j = 0; j < systems.length; j++) {
    const sy = systems[j];
    if (sy.x1 - off < pinned - 2 * sp || sy.prefixEnd - off > W + 2 * sp) continue;
    const geos = systemGeos(F, j, sysTop, s);
    drawStatic(c, F, geos, s);
    rows.forEach((r, i) => {
      const d = r.doubled;
      if (!d || !r.s) return;
      const live: Vis = { ...PLAIN, notesOnly: true, vis: (q: number) => (d.has(q) && vis(d.get(q)!) === 'show' ? 'show' : 'none') };
      drawStaffNotes(c, geos[i], r.L.layout, r.L, r.s, live);
    });
    drawStaffNotes(c, geos[F.own], ownRow.L.layout, ownRow.L, s, v);
    ownGeos.push(geos[F.own]);
  }
  updateTrace(s, ownRow.L);
  for (const g of ownGeos) drawTrace(c, g, s, ownRow.L, beat);
  for (const g of ownGeos) drawOutlines(c, g, s, v, sp);
  const cur = ownGeos.find((g) => g.j === k) ?? ownGeos[0];
  const first = rows[0];
  const last = rows[rows.length - 1];
  const yTop = sysTop + (first.y - 1.4) * sp;
  const yBot = sysTop + (last.y + 4 + Math.min(1.2, last.below)) * sp;
  c.fillStyle = 'rgba(238,240,255,0.7)';
  c.fillRect(Math.round(px) - 1, yTop, 2, yBot - yTop);
  if (cur) {
    c.fillStyle = 'rgba(238,240,255,0.95)';
    c.fillRect(Math.round(px) - 1, cur.top - 1.2 * sp, 2, (6.4 + Math.max(0, ownRow.L.lyricOff - 1.6)) * sp);
  }
  c.beginPath();
  c.moveTo(px - 0.6 * sp, yTop - 0.7 * sp);
  c.lineTo(px + 0.6 * sp, yTop - 0.7 * sp);
  c.lineTo(px, yTop + 0.1 * sp);
  c.closePath();
  c.fill();
  if (cur) {
    drawCountdown(c, cur, s, ownRow.L, px, cur.top - Math.max(1.2, ownRow.above - 1.2) * sp);
    drawBubble(c, cur, s, ownRow.L, px);
  }
  c.restore();

  // The pinned start: names, brackets, clefs and the keys in force now, over the music sliding under.
  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, pinned, H);
  const pinGeos: SysGeo[] = rows.map((r) => {
    const top = sysTop + r.y * sp;
    const rs = r.L.layout.systems;
    const here = rs[Math.min(k, rs.length - 1)];
    const sys: StaffSystem = {
      ...rs[0], cont: false, measures: [], x1: pinned, key: here.measures[0]?.sm.key ?? rs[0].key, cancelFifths: 0,
      timeSig: off < 1 ? (rs[0].measures[0]?.sm.timeSig ?? null) : null,
    };
    return { j: -1, sys, sd: { evs: [], beams: [], ties: [], tups: [] }, top, mid: top + 2 * sp };
  });
  drawSystemFrame(c, F, pinGeos, s, -1);
}

function drawFull(c: Ctx, W: number, H: number, s: DrawState, F: FullCache) {
  if (s.scroll) { drawFullScroll(c, W, H, s, F); return; }
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
    releaseLayers(F);
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
    rows.forEach((r, i) => {
      const d = r.doubled;
      if (!d || !r.s) return;
      const live: Vis = { ...PLAIN, notesOnly: true, vis: (q: number) => (d.has(q) && vis(d.get(q)!) === 'show' ? 'show' : 'none') };
      drawStaffNotes(c, geos[i], r.L.layout, r.L, r.s, live);
    });
    drawStaffNotes(c, geos[F.own], ownRow.L.layout, ownRow.L, s, v);
    ownGeos.push(geos[F.own]);
  }
  for (const [j, cv] of [...F.layers]) {
    if (shown.has(j)) continue;
    // Release the bitmap now (iOS keeps canvas memory until the size is zeroed).
    cv.width = 0;
    cv.height = 0;
    F.layers.delete(j);
  }

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
  // (a stretch of a scrolling score: its band from its first bar; the start is drawn pinned)
  const bandX = sys0.cont ? sys0.prefixEnd : left - 2.2 * sp;
  c.fillStyle = OWN_BAND;
  c.fillRect(bandX, og.top - (or.above - 0.4) * sp, sys0.x1 - bandX + (sys0.cont ? 0 : 0.4 * sp), (or.above - 0.4 + 4 + or.below + 0.1) * sp);
  if (!sys0.cont) {
    c.fillStyle = COLORS.voice;
    c.fillRect(left - 2.2 * sp, og.top - (or.above - 0.4) * sp, 3, (or.above - 0.4 + 4 + or.below + 0.1) * sp);
  }

  rows.forEach((r, i) => drawStaffFrame(c, geos[i], r.L.layout, s, { barlines: false, numbers: i === 0 }));
  if (sys0.cont) {
    // Barlines only (the start with its bracket and names is pinned).
    const nM0 = s.score.measures.length;
    const h40 = 4 * sp + lw;
    let i0 = 0;
    while (i0 < rows.length) {
      let i1 = i0;
      if (rows[i0].spec.acc) while (i1 + 1 < rows.length && rows[i1 + 1].spec.acc) i1++;
      const ms = geos[i0].sys.measures;
      ms.forEach((m, mi) => drawBarline(c, m, mi === ms.length - 1, nM0, geos[i0].top, geos[i1].top + h40 - geos[i0].top, sp, lw));
      i0 = i1 + 1;
    }
    return;
  }

  // Barlines: through the accompaniment's grand staff, per staff for the voices (room for words).
  const nM = s.score.measures.length;
  const h4 = 4 * sp + lw;
  let i = 0;
  while (i < rows.length) {
    let i1 = i;
    if (rows[i].spec.acc) while (i1 + 1 < rows.length && rows[i1 + 1].spec.acc) i1++;
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
  const inst = rows.map((r, q) => (r.spec.acc ? q : -1)).filter((q) => q >= 0);
  if (inst.length > 1) drawBrace(c, left - 1.6 * sp, geos[inst[0]].top, geos[inst[inst.length - 1]].top + h4, sp, INK.clef);

  // Names, right-aligned before the brackets.
  c.font = F.nameFont;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  const nx = left - 2.0 * sp - (inst.length > 1 ? 0.3 * sp : 0);
  const done = new Set<string>();
  rows.forEach((r, q) => {
    if (r.spec.acc) {
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
