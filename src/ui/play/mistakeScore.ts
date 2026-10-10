// Results: a few bars of your own staff with the notes that weren't right marked: the note in red
// with a ring, a line at the height you sang it (like the voice ink while singing), and a short tag
// over it ("↓ clearly flat", "not sung"). Static, drawn with the score view's engraver (staff2d.ts).
import type { NotationMode } from '../../game/notation';
import type { Part, Score } from '../../music/types';
import type { DrawState } from './highway2d';
import { COLORS, fpx } from './palette';
import {
  INK, buildSysDraw, drawStaffFrame, drawStaffNotes, layoutStaff, lyricFontFor, nameFontFor, nameMeasure, sungStep, textRows,
  type Cached, type StaffLayout, type SysDraw, type SysGeo, type Vis,
} from './staff2d';
import { faultTag, type Fault } from './noteFault';

type Ctx = CanvasRenderingContext2D;

/** A note to mark: its index in the part, what went wrong, and how it was sung. */
export interface MistakeMark {
  index: number;
  fault: Fault;
  /** NoteResult.targetOffset (just intonation): the cents are measured from target + this. */
  targetOffset: number;
  /** The tag over the note, when not the fault's own ("flat · 3 of 5" on the section's cheat sheet). */
  tag?: string;
}

interface PlacedMark {
  mark: MistakeMark;
  x: number;
  /** Head and sung pitch, y relative to the middle line. */
  headDy: number;
  sungDy: number | null;
  /** The sung line's extent. */
  x0: number;
  x1: number;
  base: number;
  tag: string;
  tagW: number;
  tagX: number;
  row: number;
  lyricX: number;
}

export interface MistakeView {
  /** CSS px. */
  W: number;
  H: number;
  sp: number;
  L: Cached;
  geo: SysGeo;
  state: DrawState;
  vis: Vis;
  marks: PlacedMark[];
  /** Bars with a wrong note (measure indices). */
  wrongBars: Set<number>;
  tagFont: string;
  tagH: number;
  /** y of the bottom of the lowest row of tags. */
  tagBottom: number;
  /** x of each bar: [measure index, x0, x1]. */
  bars: [number, number, number][];
}

export interface MistakeOpts {
  /** Staff space (px); a range: the largest in it that fits `fitWidth` (else the smallest, scrolling). */
  sp: number | [number, number];
  /** Width available (CSS px): the snippet fills it when its bars fit, else it is as wide as they need. */
  fitWidth: number;
  notation: NotationMode;
  /** Note names under the notes (in the singer's notation). */
  names: boolean;
}

const LEFT = 6;
const RIGHT = 10;
const tagPx = (sp: number) => fpx(Math.max(12, Math.min(15, sp * 1.05)));

/** Lay out bars m0..m1 of `part` on one line with the marks. */
export function layoutMistakes(c: Ctx, score: Score, part: Part, m0: number, m1: number, marks: MistakeMark[], o: MistakeOpts): MistakeView {
  const lay = (sp: number, width: number) => {
    c.font = lyricFontFor(sp);
    const textW = (t: string) => c.measureText(t).width;
    const nameW = o.names ? nameMeasure(c, nameFontFor(sp), o.notation) : undefined;
    return layoutStaff(score, part, m0, m1, { width, sp, textW, nameW, maxBars: 999, left: LEFT, right: RIGHT });
  };
  /** Width the bars need at their natural spacing. */
  const natural = (sp: number) => {
    const sys = lay(sp, 1e5).systems[0];
    return sys ? sys.prefixEnd + (sys.x1 - sys.prefixEnd) / sys.squeeze + RIGHT + 1 : 0;
  };
  let sp: number;
  if (Array.isArray(o.sp)) {
    const [lo, hi] = o.sp;
    const w = natural(hi);
    // (text doesn't shrink with the staff: settle in two steps)
    sp = w <= o.fitWidth ? hi : Math.max(lo, hi * (o.fitWidth / w));
    if (sp > lo && natural(sp) > o.fitWidth) sp = Math.max(lo, sp * (o.fitWidth / natural(sp)));
  } else sp = o.sp;
  const need = natural(sp);
  const W = Math.max(o.fitWidth, Math.ceil(need));
  const layout: StaffLayout = lay(sp, need <= o.fitWidth ? o.fitWidth : Math.ceil(need));
  const sys = layout.systems[0];
  const sd: SysDraw = buildSysDraw(sys, layout, part.notes);
  const mid0 = layout.mid;
  const yOf = (st: number) => -((st - mid0) * sp) / 2;
  const headRx = 0.62 * sp;

  // Where each mark goes.
  c.font = `700 ${tagPx(sp)}px "Bricolage Grotesque", system-ui, sans-serif`;
  const tagFont = c.font;
  const placed: PlacedMark[] = [];
  for (const mk of marks) {
    const eg = sd.evs.find((g) => g.ev.kind === 'note' && g.ev.first && g.heads.some((h) => h.i === mk.index))
      ?? sd.evs.find((g) => g.heads.some((h) => h.i === mk.index));
    if (!eg) continue;
    const head = eg.heads.find((h) => h.i === mk.index)!;
    const ev = eg.ev;
    const written = ev.noteIndex === mk.index ? { step: ev.step!, alt: ev.alt ?? 0 } : ev.chord?.find((h) => h.noteIndex === mk.index);
    const n = part.notes[mk.index];
    let sungDy: number | null = null;
    const f = mk.fault;
    if (f.cents != null && f.kind !== 'octave' && written) {
      const midi = n.midi + (f.cents + mk.targetOffset) / 100;
      sungDy = yOf(sungStep(midi, eg.m.sm.key, { midi: n.midi, step: written.step, alt: written.alt }));
    }
    const tag = mk.tag ?? faultTag(f);
    const tagW = c.measureText(tag).width + 0.9 * sp + 8;
    // (from just right of the head, so the head doesn't hide it)
    // (…to just before the next note's head)
    const x0 = head.x + headRx + 0.25 * sp;
    placed.push({
      mark: mk, x: head.x, headDy: head.dy, sungDy, x0, x1: Math.max(x0 + 1.3 * sp, eg.xEnd - headRx - 0.45 * sp), base: ev.base,
      tag, tagW, tagX: Math.max(2, Math.min(W - 2 - tagW, head.x - tagW / 2)), row: 0, lyricX: eg.x,
    });
  }
  // Tags in rows: one that would overlap the one before goes a row up.
  const rows: number[] = [];
  for (const p of [...placed].sort((a, b) => a.tagX - b.tagX)) {
    let r = 0;
    while (rows[r] != null && rows[r] > p.tagX - 4) r++;
    p.row = r;
    rows[r] = p.tagX + p.tagW;
  }

  // Vertical extents (y relative to the middle line).
  let inkTop = -2 * sp;
  let lowStep = mid0 - 4;
  for (const g of sd.evs) inkTop = Math.min(inkTop, g.top);
  for (const sm of sys.measures) for (const le of sm.events) if (le.ev.step != null) lowStep = Math.min(lowStep, le.ev.step);
  let sungLow = 0;
  for (const p of placed) if (p.sungDy != null) { inkTop = Math.min(inkTop, p.sungDy - 0.6 * sp); sungLow = Math.max(sungLow, p.sungDy); }
  const numPx = Math.round(Math.max(9, sp * 0.95));
  const barNoTop = -2 * sp - 1.75 * sp - numPx;
  const tagH = tagPx(sp) + 8;
  const tagBottom = placed.length ? Math.min(barNoTop - 4, inkTop - 0.5 * sp) : barNoTop;
  const nRows = placed.length ? rows.length : 0;
  const topY = tagBottom - nRows * (tagH + 3) - 6;
  const noteBelow = Math.max(((mid0 - 4) - lowStep) / 2, (sungLow - 2 * sp) / sp + 0.4);
  const hasLyrics = sys.measures.some((m) => m.events.some((le) => le.ev.kind === 'note' && le.ev.first && !!part.notes[le.ev.noteIndex!]?.lyric));
  const { nameOff, lyricOff } = textRows(noteBelow, sp, { min: 3.0, pad: 2.6, names: o.names, notation: o.notation });
  const belowSp = hasLyrics ? lyricOff + 1.1 : nameOff != null ? nameOff + 1.1 : Math.max(1.4, noteBelow + 1.2);
  const H = Math.ceil(-topY + 2 * sp + belowSp * sp);
  const mid = Math.round(-topY);

  const L: Cached = {
    key: 'mistakes', layout, above: 0, below: 0, band: 0, lyricFont: lyricFontFor(sp), lyricOff,
    nameOff: o.names ? nameOff : undefined, nameFont: o.names ? nameFontFor(sp) : undefined, sys: [sd], textW: new Map(),
  };
  const wrong = new Set(placed.map((p) => p.mark.index));
  const state: DrawState = {
    score, part, range: [0, part.notes.length - 1], pos: -Infinity, rate: 1, samples: [],
    // Only the wrong notes are "graded" (red); the others stay plain ink.
    live: { noteGrade: (i: number) => (wrong.has(i) ? 'miss' : undefined) } as unknown as DrawState['live'],
    notation: o.notation, showNames: o.names, key: sys.key, tolerance: 50, ghostParts: [], lo: 0, hi: 0, from: 0, to: 0, beatSec: 0.5,
  };
  const vis: Vis = { vis: () => 'show', isPast: (i) => wrong.has(i), isNow: () => false, inRange: () => true };
  return {
    W, H, sp, L, geo: { j: 0, sys, sd, top: mid - 2 * sp, mid }, state, vis, marks: placed,
    wrongBars: new Set(marks.map((m) => part.notes[m.index]?.measure).filter((m): m is number => m != null)),
    tagFont, tagH, tagBottom: mid + tagBottom, bars: sys.measures.map((m) => [m.sm.index, m.x0, m.x1]),
  };
}

/** Draw a laid-out snippet (canvas already scaled to CSS px). */
export function drawMistakes(c: Ctx, V: MistakeView) {
  const { sp, geo, L, state, vis } = V;
  // (read each time: the colours follow Settings → Display)
  const MISS = COLORS.miss;
  const SUNG = INK.outTune;
  const { top, mid } = geo;
  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, V.W, V.H);
  // Bars with a wrong note: a faint red band behind the staff.
  for (const [m, x0, x1] of V.bars) {
    if (!V.wrongBars.has(m)) continue;
    c.fillStyle = INK.wrongBar;
    rounded(c, x0 + 1, top - 1.1 * sp, x1 - x0 - 2, 6.2 * sp, 0.6 * sp);
    c.fill();
  }
  drawStaffFrame(c, geo, L.layout, state, { barlines: true, numbers: true });
  // What was sung: a line at its height through the note's length (under the notes).
  c.lineCap = 'round';
  for (const p of V.marks) {
    if (p.sungDy == null) continue;
    // (a faint guide at the note's own height, as while singing: the line under it is flat, over it sharp)
    c.strokeStyle = MISS;
    c.globalAlpha = 0.55;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(p.x0, Math.round(mid + p.headDy) + 0.5);
    c.lineTo(p.x1, Math.round(mid + p.headDy) + 0.5);
    c.stroke();
    c.strokeStyle = SUNG;
    c.globalAlpha = 0.9;
    c.lineWidth = Math.max(2.5, 0.34 * sp);
    c.beginPath();
    c.moveTo(p.x0, mid + p.sungDy);
    c.lineTo(p.x1, mid + p.sungDy);
    c.stroke();
    c.globalAlpha = 1;
  }
  drawStaffNotes(c, geo, L.layout, L, state, vis);
  for (const p of V.marks) {
    const hy = mid + p.headDy;
    // Ring round the note (dashed: not sung at all).
    c.strokeStyle = MISS;
    c.lineWidth = Math.max(1.5, 0.16 * sp);
    if (p.mark.fault.kind === 'missed') c.setLineDash([0.45 * sp, 0.35 * sp]);
    c.beginPath();
    c.ellipse(p.x, hy, 1.25 * sp, 1.0 * sp, 0, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    // The lyric under it, in the tag's colour.
    const ly = state.part.notes[p.mark.index]?.lyric;
    if (ly) {
      c.font = L.lyricFont;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillStyle = INK.wrongHead;
      c.fillText(ly, p.lyricX, top + (4 + L.lyricOff) * sp);
      c.textAlign = 'left';
    }
  }
  // Tags over the notes, joined to them by a dotted line.
  c.font = V.tagFont;
  c.textBaseline = 'middle';
  c.textAlign = 'center';
  for (const p of V.marks) {
    const yb = V.tagBottom - p.row * (V.tagH + 3);
    const yt = yb - V.tagH;
    const cx = p.tagX + p.tagW / 2;
    const reach = Math.min(mid + p.headDy, p.sungDy != null ? mid + p.sungDy : Infinity) - 1.15 * sp;
    if (reach > yb + 2) {
      c.strokeStyle = MISS;
      c.globalAlpha = 0.7;
      c.lineWidth = 1.25;
      c.setLineDash([2, 3]);
      c.beginPath();
      c.moveTo(p.x, yb);
      c.lineTo(p.x, reach);
      c.stroke();
      c.setLineDash([]);
      c.globalAlpha = 1;
    }
    c.fillStyle = INK.tagBg;
    rounded(c, p.tagX, yt, p.tagW, V.tagH, V.tagH / 2);
    c.fill();
    c.strokeStyle = MISS;
    c.lineWidth = 1.25;
    c.stroke();
    c.fillStyle = INK.tagText;
    c.fillText(p.tag, cx, (yt + yb) / 2 + 0.5);
  }
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
}

function rounded(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}
