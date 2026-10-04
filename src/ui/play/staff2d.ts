// Canvas renderer for the practice "score view": your part as real sheet music (two systems like a
// page, a playhead moving through the top one) with your sung pitch drawn as ink at its exact staff
// height. Same inputs as the highway (DrawState); the layout is pure and unit-tested, the drawing
// sits on top.
//
// Coordinates: pitches are placed on diatonic "steps" (C4 = 28, 7 per octave). A float MIDI value
// maps to a float step by piecewise-linear interpolation between the seven letters' pitches in the
// current key (plus the accidental of the note being sung), so a note sung 30 cents flat sits just
// below its notehead and a perfectly sung C♮ in D major sits exactly on the C.
import type { KeySig, Part, Score } from '../../music/types';
import type { PitchSample } from '../../game/types';
import { beatToTime, timeToBeat } from '../../music/time';
import { spellPc } from '../../game/notation';
import { COLORS, gradeColor, wordInitial, type DrawState } from './highway2d';

const EPS = 0.01;
const mod = (n: number, m: number) => ((n % m) + m) % m;

// ---------------------------------------------------------------------------------------------
// Clefs, spelling, staff positions

export type Clef = 'treble' | 'treble8' | 'bass';

const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const LETTERS = 'CDEFGAB';

/** Clef for a part: by voice type, falling back to the range for instruments / unknown voices. */
export function clefFor(part: Pick<Part, 'voiceType' | 'notes' | 'low' | 'high'>): Clef {
  const ns = part.notes;
  const avg = ns.length ? ns.reduce((a, n) => a + n.midi, 0) / ns.length : 60;
  switch (part.voiceType) {
    case 'S':
    case 'A':
      return 'treble';
    case 'T':
      return avg < 50 ? 'bass' : 'treble8';
    case 'B':
      return 'bass';
    default:
      return avg >= 59 ? 'treble' : avg >= 52 ? 'treble8' : 'bass';
  }
}

/** Step (sounding) of the middle staff line. */
export function middleStep(clef: Clef): number {
  return clef === 'treble' ? 34 /* B4 */ : clef === 'treble8' ? 27 /* B3 */ : 22 /* D3 */;
}

/** Diatonic step and alteration of a sounding pitch, spelled in `key`. */
export function spell(midi: number, key: Pick<KeySig, 'fifths' | 'mode'>): { step: number; alt: number } {
  const m = Math.round(midi);
  const s = spellPc(m, key);
  const natural = m - s.accidental;
  const oct = Math.floor(natural / 12) - 1;
  return { step: oct * 7 + LETTERS.indexOf(s.letter), alt: s.accidental };
}

const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
/** Key-signature alteration per letter (index 0..6 = C..B). */
export function keyAlts(fifths: number): number[] {
  const a = [0, 0, 0, 0, 0, 0, 0];
  const n = Math.max(-7, Math.min(7, Math.round(fifths)));
  if (n > 0) for (let i = 0; i < n; i++) a[SHARP_ORDER[i]] = 1;
  if (n < 0) for (let i = 0; i < -n; i++) a[SHARP_ORDER[6 - i]] = -1;
  return a;
}

/**
 * Float MIDI → float diatonic step. `alts[letter]` is the alteration in effect for each letter
 * (key signature, with the sung note's own accidental); between two neighbouring letters the step
 * is interpolated linearly in pitch.
 */
export function midiToStep(m: number, alts: number[]): number {
  const oct0 = Math.floor(m / 12) - 2;
  let prevP = -Infinity;
  let prevS = 0;
  for (let o = oct0; o <= oct0 + 3; o++) {
    for (let l = 0; l < 7; l++) {
      const s = o * 7 + l;
      const p = Math.max((o + 1) * 12 + LETTER_PC[l] + (alts[l] ?? 0), prevP);
      if (m <= p && prevP > -Infinity) {
        return p - prevP < 1e-9 ? s : prevS + (m - prevP) / (p - prevP);
      }
      prevP = p;
      prevS = s;
    }
  }
  return prevS;
}

/** The key in force at a beat. */
export function keyAtBeat(score: Pick<Score, 'keys'>, beat: number): KeySig {
  let k: KeySig = score.keys[0] ?? { beat: 0, time: 0, fifths: 0, mode: 'major' };
  for (const x of score.keys) if (x.beat <= beat + 1e-6) k = x;
  return k;
}

// ---------------------------------------------------------------------------------------------
// Rhythm: written values, splitting into notatable pieces

export interface Written {
  /** Base value in quarter notes: 4 = whole, 2 = half, 1 = quarter, 0.5 = eighth… */
  base: number;
  dots: number;
  /** 3 for a triplet. */
  tuplet?: number;
}

const BASES = [4, 2, 1, 0.5, 0.25, 0.125, 0.0625];
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/** The written value of a duration in quarter beats, or null when it needs a tie. */
export function writtenValue(d: number): Written | null {
  for (const b of BASES) {
    if (near(d, b)) return { base: b, dots: 0 };
    if (near(d, b * 1.5)) return { base: b, dots: 1 };
    if (b <= 2 && near(d, b * 1.75)) return { base: b, dots: 2 };
  }
  for (const b of BASES) if (b <= 2 && near(d, (b * 2) / 3)) return { base: b, dots: 0, tuplet: 3 };
  return null;
}

/** Largest notatable value ≤ d. */
function largestWritten(d: number): number | null {
  let best: number | null = null;
  for (const b of BASES) {
    for (const v of [b, b * 1.5, b * 1.75, (b * 2) / 3]) {
      if (v <= d + EPS && writtenValue(v) && (best == null || v > best)) best = v;
    }
  }
  return best;
}

export interface Piece extends Written {
  start: number;
  dur: number;
}

/**
 * Split a note or rest (start/dur in beats, inside one bar) into notatable pieces. `origin` is the
 * beat where the bar's metre starts (earlier than the bar for a pickup) and `unit` the beat length.
 * Notes stay whole when they can (syncopations are fine to read); otherwise they're split at the
 * next beat, then into whole beats. Rests are split to show the beat.
 */
export function splitDuration(start: number, dur: number, origin: number, unit: number, rest: boolean): Piece[] {
  const out: Piece[] = [];
  let s = start;
  let d = dur;
  for (let guard = 0; d > 0.03 && guard < 24; guard++) {
    const off = s - origin;
    const into = mod(off, unit);
    const onBeat = into < EPS || unit - into < EPS;
    const toBeat = onBeat ? unit : unit - into;
    let take: number | null = null;
    const whole = writtenValue(d);
    if (rest) {
      if (!onBeat && d > toBeat + EPS) take = writtenValue(toBeat) ? toBeat : largestWritten(toBeat);
      else if (whole && (d <= unit + EPS || mod(off + EPS, d) < 2 * EPS)) take = d;
      else {
        for (const v of [4, 3, 2, 1.5, 1, 0.5, 0.25, 0.125]) {
          if (v <= d + EPS && (v < unit - EPS || mod(off + EPS, v) < 2 * EPS) && writtenValue(v)) { take = v; break; }
        }
      }
    } else if (whole) take = d;
    else if (!onBeat && d > toBeat + EPS) take = writtenValue(toBeat) ? toBeat : largestWritten(toBeat);
    else {
      for (let k = Math.floor((d + EPS) / unit); k >= 1 && take == null; k--) if (writtenValue(k * unit)) take = k * unit;
    }
    if (take == null) take = largestWritten(d);
    if (take == null || take < 0.03) break;
    out.push({ start: s, dur: take, ...writtenValue(take)! });
    s += take;
    d -= take;
  }
  return out;
}

/** Beat length (in quarters) for rests and syncopation, and the span beams group over. */
export function meterUnits(ts: [number, number]): { unit: number; beam: number } {
  const [n, d] = ts;
  if (d === 8 && n % 3 === 0) return { unit: 1.5, beam: 1.5 };
  if (d === 8) return { unit: 0.5, beam: 1 };
  if (d === 2) return { unit: 2, beam: 1 };
  if (d === 16) return { unit: 0.25, beam: 0.5 };
  return { unit: 4 / d, beam: 4 / d };
}

// ---------------------------------------------------------------------------------------------
// Events per bar

export interface StaffEvent extends Piece {
  kind: 'note' | 'rest';
  /** Whole-bar rest (drawn centred). */
  measureRest?: boolean;
  noteIndex?: number;
  midi?: number;
  step?: number;
  alt?: number;
  /** Alteration to print in front of the note (0 = natural), or null. */
  accidental?: number | null;
  tieStart?: boolean;
  tieEnd?: boolean;
  /** First written piece of the ScoreNote (carries the lyric). */
  first?: boolean;
  lyric?: string;
  syllabic?: 'single' | 'begin' | 'middle' | 'end';
  stemUp?: boolean;
  /** Index of the beam group in StaffMeasure.beams. */
  beam?: number;
}

export interface StaffMeasure {
  index: number;
  number: string;
  startBeat: number;
  endBeat: number;
  key: KeySig;
  timeSig: [number, number];
  /** Key or time signature differ from the previous bar (printed at the bar's start). */
  keyChange: boolean;
  timeChange: boolean;
  prevFifths: number;
  doubleBar: boolean;
  events: StaffEvent[];
  /** Beam groups: indices into `events`. */
  beams: number[][];
}

/** Print accidentals relative to the key signature; they carry through the bar. */
export function markAccidentals(events: StaffEvent[], fifths: number): void {
  const ka = keyAlts(fifths);
  const state = new Map<number, number>();
  for (const e of events) {
    if (e.kind !== 'note' || e.step == null) continue;
    if (e.tieEnd) {
      // A tie into the bar doesn't need (or set) an accidental.
      e.accidental = null;
      continue;
    }
    const cur = state.get(e.step) ?? ka[mod(e.step, 7)];
    if ((e.alt ?? 0) !== cur) {
      e.accidental = e.alt ?? 0;
      state.set(e.step, e.alt ?? 0);
    } else e.accidental = null;
  }
}

/** Beam 8ths and shorter within a beat (rests break beams). Sets stem directions too. */
export function beamGroups(events: StaffEvent[], origin: number, beamSpan: number, mid: number): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  let curWin = -1;
  const flush = () => {
    if (cur.length >= 2) groups.push(cur);
    cur = [];
  };
  events.forEach((e, i) => {
    const beamable = e.kind === 'note' && e.base <= 0.5;
    if (!beamable) {
      flush();
      return;
    }
    const win = Math.floor((e.start - origin) / beamSpan + EPS);
    if (win !== curWin) flush();
    curWin = win;
    cur.push(i);
    // A note that runs past its beat window ends the group.
    if (e.start + e.dur - origin > (win + 1) * beamSpan + EPS) flush();
  });
  flush();
  for (const e of events) if (e.kind === 'note') e.stemUp = (e.step ?? mid) < mid;
  groups.forEach((g, gi) => {
    let far = 0;
    for (const i of g) {
      const off = (events[i].step ?? mid) - mid;
      if (Math.abs(off) > Math.abs(far)) far = off;
    }
    const up = far < 0;
    for (const i of g) {
      events[i].stemUp = up;
      events[i].beam = gi;
    }
  });
  return groups;
}

/** Bars [m0, m1] of a part as notatable events: rests fill gaps, notes split at barlines with ties. */
export function buildMeasures(score: Score, part: Part, m0: number, m1: number, clef: Clef = clefFor(part)): StaffMeasure[] {
  const mid = middleStep(clef);
  const ms = score.measures;
  const buckets: { s: number; e: number; i: number }[][] = [];
  for (let mi = m0; mi <= m1; mi++) buckets.push([]);
  part.notes.forEach((n, i) => {
    const ns = n.startBeat;
    const ne = n.startBeat + n.durBeats;
    let mi = Math.max(m0, Math.min(n.measure, ms.length - 1));
    while (mi > m0 && ms[mi].startBeat > ns + 1e-6) mi--;
    for (; mi <= m1; mi++) {
      const a = ms[mi].startBeat;
      const b = a + ms[mi].durBeats;
      if (a >= ne - 1e-6) break;
      if (b <= ns + 1e-6) continue;
      buckets[mi - m0].push({ s: Math.max(ns, a), e: Math.min(ne, b), i });
    }
  });
  const out: StaffMeasure[] = [];
  let prevKey: number | null = null;
  let prevTs: string | null = null;
  const firstOfNote = new Set<number>();
  for (let mi = m0; mi <= m1; mi++) {
    const m = ms[mi];
    const key = keyAtBeat(score, m.startBeat);
    const ts = m.timeSig;
    const a = m.startBeat;
    const b = a + m.durBeats;
    const nominal = (ts[0] * 4) / ts[1];
    const origin = mi === 0 && m.durBeats < nominal - EPS ? b - nominal : a;
    const { unit, beam } = meterUnits(ts);
    const segs = buckets[mi - m0].sort((x, y) => x.s - y.s);
    const events: StaffEvent[] = [];
    const pushRest = (s: number, e: number) => {
      for (const p of splitDuration(s, e - s, origin, unit, true)) events.push({ ...p, kind: 'rest' });
    };
    let t = a;
    for (let k = 0; k < segs.length; k++) {
      const sg = segs[k];
      const end = Math.min(sg.e, k + 1 < segs.length ? segs[k + 1].s : sg.e);
      if (end - sg.s < 0.03) continue;
      if (sg.s - t > 0.03) pushRest(t, sg.s);
      const n = part.notes[sg.i];
      const sp = spell(n.midi, key);
      const pieces = splitDuration(sg.s, end - sg.s, origin, unit, false);
      pieces.forEach((p, pi) => {
        const isFirst = !firstOfNote.has(sg.i);
        firstOfNote.add(sg.i);
        const continues = pi < pieces.length - 1 || n.startBeat + n.durBeats > end + 0.03;
        events.push({
          ...p, kind: 'note', noteIndex: sg.i, midi: n.midi, step: sp.step, alt: sp.alt,
          tieStart: continues, tieEnd: !isFirst, first: isFirst,
          lyric: isFirst ? n.lyric : undefined, syllabic: isFirst ? n.syllabic : undefined,
        });
      });
      t = Math.max(t, end);
    }
    if (b - t > 0.03) {
      if (!events.length) events.push({ kind: 'rest', start: a, dur: m.durBeats, base: 4, dots: 0, measureRest: true });
      else pushRest(t, b);
    }
    markAccidentals(events, key.fifths);
    const beams = beamGroups(events, origin, beam, mid);
    const tsKey = ts.join('/');
    out.push({
      index: mi, number: m.number, startBeat: a, endBeat: b, key, timeSig: ts,
      keyChange: prevKey != null && prevKey !== key.fifths, timeChange: prevTs == null || prevTs !== tsKey,
      prevFifths: prevKey ?? key.fifths, doubleBar: !!m.doubleBar || mi === ms.length - 1,
      events, beams,
    });
    prevKey = key.fifths;
    prevTs = tsKey;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Horizontal layout: system breaking and time → x

/** Greedy system breaking. `first[i]`: width of bar i opening a system (with its prefix); `rest[i]`: inside one. */
export function breakSystems(first: number[], rest: number[], avail: number, maxBars: number): number[][] {
  const out: number[][] = [];
  let i = 0;
  while (i < first.length) {
    const sys = [i];
    let w = first[i];
    let j = i + 1;
    while (j < first.length && sys.length < maxBars && w + rest[j] <= avail) {
      w += rest[j];
      sys.push(j);
      j++;
    }
    out.push(sys);
    i = j;
  }
  return out;
}

export interface LaidEvent {
  ev: StaffEvent;
  x: number;
}
export interface LaidMeasure {
  sm: StaffMeasure;
  x0: number;
  x1: number;
  /** x of a key/time change printed at the bar's start (inside the system). */
  changeX: number | null;
  events: LaidEvent[];
}
export interface StaffSystem {
  measures: LaidMeasure[];
  startBeat: number;
  endBeat: number;
  key: KeySig;
  timeSig: [number, number] | null;
  clefX: number;
  keyX: number;
  timeX: number;
  prefixEnd: number;
  x1: number;
  /** time → x breakpoints (beats ascending): every onset, then the system's end. */
  bp: { beat: number; x: number }[];
}
export interface StaffLayout {
  clef: Clef;
  mid: number;
  sp: number;
  systems: StaffSystem[];
  minStep: number;
  maxStep: number;
}

export interface LayoutOpts {
  width: number;
  sp: number;
  /** Width in px of a lyric syllable in the lyric font. */
  textW: (s: string) => number;
  maxBars?: number;
  left?: number;
  right?: number;
}

/** Natural horizontal space after an event (in staff spaces), before lyric/accidental constraints. */
export function naturalSpace(durBeats: number): number {
  return 1.45 + 1.3 * Math.log2(1 + 2 * durBeats);
}

const CLEF_W = 3.5;
const TIME_W = 2.5;
const keyW = (fifths: number) => (fifths ? Math.abs(fifths) * 0.85 + 0.7 : 0.3);
const ACC_W = 1.25;

function measureWidths(sm: StaffMeasure, sp: number, textW: (s: string) => number, inside: boolean) {
  const evs = sm.events;
  const lw = evs.map((e) => (e.lyric ? textW(e.lyric) : 0));
  const gaps: number[] = [];
  let changeW = 0;
  if (inside && sm.keyChange) changeW += keyW(Math.max(Math.abs(sm.key.fifths), Math.abs(sm.prevFifths))) * sp;
  if (inside && sm.timeChange) changeW += TIME_W * sp;
  let lead = Math.max(1.3 * sp + (evs[0]?.accidental != null ? ACC_W * sp : 0), lw[0] / 2 + 0.4 * sp);
  if (evs[0]?.measureRest) lead = 2.2 * sp;
  for (let j = 0; j < evs.length; j++) {
    const e = evs[j];
    let g = naturalSpace(e.dur) * sp;
    if (e.measureRest) g = 5 * sp;
    if (e.dots) g += 0.35 * sp * e.dots;
    if (j + 1 < evs.length) {
      const nx = evs[j + 1];
      if (nx.accidental != null) g = Math.max(g, (1.5 + ACC_W + 0.4) * sp);
      if (lw[j] || lw[j + 1]) {
        const hyph = e.syllabic === 'begin' || e.syllabic === 'middle';
        g = Math.max(g, lw[j] / 2 + lw[j + 1] / 2 + (hyph ? 1.4 : 0.6) * sp);
      }
    } else {
      g = Math.max(g, lw[j] / 2 + 0.5 * sp + (e.syllabic === 'begin' || e.syllabic === 'middle' ? 0.6 * sp : 0));
    }
    gaps.push(g);
  }
  const total = changeW + lead + gaps.reduce((a, b) => a + b, 0);
  return { changeW, lead, gaps, total };
}

/** Lay out bars m0..m1 of `part` into systems of width `width`. */
export function layoutStaff(score: Score, part: Part, m0: number, m1: number, o: LayoutOpts): StaffLayout {
  const clef = clefFor(part);
  const mid = middleStep(clef);
  const sp = o.sp;
  const left = o.left ?? 6;
  const right = o.right ?? 8;
  const avail = o.width - left - right;
  const maxBars = o.maxBars ?? 4;
  const sms = buildMeasures(score, part, m0, m1, clef);
  let minStep = mid - 4;
  let maxStep = mid + 4;
  for (const sm of sms) for (const e of sm.events) if (e.step != null) {
    minStep = Math.min(minStep, e.step);
    maxStep = Math.max(maxStep, e.step);
  }
  const prefixW = (k: number) => {
    const sm = sms[k];
    return (CLEF_W + keyW(sm.key.fifths) + (sm.timeChange ? TIME_W : 0) + 0.4) * sp;
  };
  const inner = sms.map((sm) => measureWidths(sm, sp, o.textW, true));
  const opening = sms.map((sm) => measureWidths(sm, sp, o.textW, false));
  const groups = breakSystems(opening.map((w, k) => prefixW(k) + w.total), inner.map((w) => w.total), avail, maxBars);
  const systems: StaffSystem[] = groups.map((g, gi) => {
    const firstSm = sms[g[0]];
    const clefX = left + 0.3 * sp;
    const keyX = left + CLEF_W * sp;
    const timeX = keyX + keyW(firstSm.key.fifths) * sp;
    const prefixEnd = left + prefixW(g[0]);
    const widths = g.map((k, idx) => (idx === 0 ? opening[k] : inner[k]));
    const natural = widths.reduce((a, w) => a + w.total, 0);
    const room = left + avail - prefixEnd;
    let f = room / Math.max(1, natural);
    const last = gi === groups.length - 1;
    if (last && f > 1) f = Math.min(f, 1.4);
    let x = prefixEnd;
    const measures: LaidMeasure[] = [];
    const bp: { beat: number; x: number }[] = [];
    g.forEach((k, idx) => {
      const sm = sms[k];
      const w = widths[idx];
      const x0 = x;
      const changeX = w.changeW > 0 ? x0 + 0.5 * sp : null;
      let ex = x0 + (w.changeW + w.lead) * f;
      const events: LaidEvent[] = sm.events.map((ev, j) => {
        const le = { ev, x: ev.measureRest ? x0 + (w.changeW * f) + (w.lead + w.gaps[0]) * f / 2 : ex };
        ex += w.gaps[j] * f;
        return le;
      });
      for (const le of events) bp.push({ beat: le.ev.start, x: le.ev.measureRest ? x0 + (w.changeW + w.lead) * f : le.x });
      x = x0 + w.total * f;
      measures.push({ sm, x0, x1: x, changeX, events });
    });
    const endBeat = sms[g[g.length - 1]].endBeat;
    bp.push({ beat: endBeat, x });
    return {
      measures, startBeat: firstSm.startBeat, endBeat, key: firstSm.key,
      timeSig: firstSm.timeChange ? firstSm.timeSig : null,
      clefX, keyX, timeX, prefixEnd, x1: x, bp,
    };
  });
  return { clef, mid, sp, systems, minStep, maxStep };
}

/** x of a beat on a system (piecewise linear between onsets; clamped to the system). */
export function xAtBeat(sys: Pick<StaffSystem, 'bp'>, beat: number): number {
  const bp = sys.bp;
  if (!bp.length) return 0;
  if (beat <= bp[0].beat) return bp[0].x;
  const last = bp[bp.length - 1];
  if (beat >= last.beat) return last.x;
  let lo = 0;
  let hi = bp.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (bp[m].beat <= beat) lo = m;
    else hi = m;
  }
  const a = bp[lo];
  const b = bp[hi];
  return b.beat - a.beat < 1e-9 ? b.x : a.x + ((beat - a.beat) / (b.beat - a.beat)) * (b.x - a.x);
}

/** Index of the system showing `beat` (the last one starting at or before it). */
export function systemAt(systems: Pick<StaffSystem, 'startBeat'>[], beat: number): number {
  let k = 0;
  for (let i = 0; i < systems.length; i++) if (systems[i].startBeat <= beat + 1e-6) k = i;
  return k;
}

/** Bars covering the score-time span [from, to). */
export function measureSpan(score: Pick<Score, 'measures'>, from: number, to: number): [number, number] {
  const ms = score.measures;
  if (!ms.length) return [0, -1];
  let a = ms.findIndex((m) => from < m.start + m.dur - 1e-6);
  if (a < 0) a = ms.length - 1;
  let b = a;
  while (b + 1 < ms.length && ms[b + 1].start < to - 1e-3) b++;
  return [a, b];
}

/**
 * Staff step of a sung pitch at a moment: the key signature's letters, with the alteration of the
 * note being sung (if any). Far-off octaves are folded towards the target (a tenor singing the
 * soprano line an octave down still draws on the staff).
 *
 * Near the target, small deviations are magnified (about ×2 at the note, fading out by ~1.5
 * semitones; still monotonic, exact on the note and further away): on a phone a staff step is only ~4 px, so
 * 30 cents would otherwise move the line by a single pixel.
 */
export function sungStep(midi: number, key: Pick<KeySig, 'fifths'>, target?: { midi: number; step: number; alt: number } | null): number {
  const alts = keyAlts(key.fifths);
  let m = midi;
  if (!target) return midiToStep(m, alts);
  alts[mod(target.step, 7)] = target.alt;
  if (Math.abs(m - target.midi) > 7) m -= 12 * Math.round((m - target.midi) / 12);
  const cents = (m - target.midi) * 100;
  return midiToStep(m, alts) + MAGNIFY * (cents / 200) * Math.exp(-((cents / 70) ** 2));
}
/** Extra gain near the target (must stay < 1.49 to keep the mapping monotonic over augmented seconds). */
const MAGNIFY = 1.4;

// ---------------------------------------------------------------------------------------------
// Glyphs (drawn in staff-space units; y grows downwards)

type Ctx = CanvasRenderingContext2D;

function treblePath(): Path2D {
  // Unit = one staff space; origin on the G line; y up (flipped when drawn).
  const p = new Path2D();
  p.moveTo(0.32, -0.08);
  p.bezierCurveTo(0.42, 0.55, -0.1, 1.0, -0.55, 0.7);
  p.bezierCurveTo(-1.05, 0.35, -0.98, -0.72, -0.2, -0.98);
  p.bezierCurveTo(0.55, -1.2, 1.15, -0.55, 0.98, 0.18);
  p.bezierCurveTo(0.85, 0.9, 0.05, 1.45, -0.22, 2.35);
  p.bezierCurveTo(-0.5, 3.25, -0.1, 4.35, 0.38, 4.5);
  p.bezierCurveTo(0.78, 4.6, 0.78, 3.75, 0.42, 3.25);
  p.bezierCurveTo(0.2, 2.9, 0.06, 2.4, 0.08, 1.6);
  p.lineTo(0.28, -2.05);
  p.bezierCurveTo(0.34, -2.75, -0.2, -2.98, -0.55, -2.65);
  return p;
}
let TREBLE: Path2D | null = null;

function drawTreble(c: Ctx, x: number, gLineY: number, sp: number, color: string, eight: boolean) {
  TREBLE ??= treblePath();
  c.save();
  c.translate(x + 1.0 * sp, gLineY);
  c.scale(sp, -sp);
  c.strokeStyle = color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = 0.24;
  c.stroke(TREBLE);
  c.fillStyle = color;
  c.beginPath();
  c.arc(-0.38, -2.38, 0.3, 0, Math.PI * 2);
  c.fill();
  c.restore();
  if (eight) {
    c.fillStyle = color;
    c.font = `700 ${Math.round(sp * 1.15)}px Georgia, serif`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText('8', x + 1.2 * sp, gLineY + 3.05 * sp);
    c.textAlign = 'left';
  }
}

function drawBass(c: Ctx, x: number, fLineY: number, sp: number, color: string) {
  c.save();
  c.translate(x + 0.45 * sp, fLineY);
  c.scale(sp, sp);
  c.fillStyle = color;
  c.strokeStyle = color;
  c.beginPath();
  c.arc(0.05, 0.05, 0.38, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 0.24;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(-0.25, 0.0);
  c.bezierCurveTo(-0.2, -0.9, 1.1, -1.2, 1.5, -0.35);
  c.bezierCurveTo(1.85, 0.6, 1.0, 1.9, -0.35, 2.8);
  c.stroke();
  c.beginPath();
  c.arc(2.2, -0.5, 0.18, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(2.2, 0.5, 0.18, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Accidental glyph centred at (x, y). */
function drawAccidental(c: Ctx, x: number, y: number, sp: number, alt: number, color: string) {
  c.save();
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineCap = 'butt';
  const thin = Math.max(1, 0.11 * sp);
  const thick = Math.max(1.5, 0.28 * sp);
  if (alt === 1) {
    c.lineWidth = thin;
    for (const dx of [-0.22, 0.22]) {
      c.beginPath();
      c.moveTo(x + dx * sp, y - 1.3 * sp + (dx > 0 ? -0.1 * sp : 0));
      c.lineTo(x + dx * sp, y + 1.3 * sp + (dx > 0 ? -0.1 * sp : 0));
      c.stroke();
    }
    c.lineWidth = thick;
    for (const dy of [-0.42, 0.42]) {
      c.beginPath();
      c.moveTo(x - 0.48 * sp, y + (dy + 0.13) * sp);
      c.lineTo(x + 0.48 * sp, y + (dy - 0.13) * sp);
      c.stroke();
    }
  } else if (alt === -1 || alt === -2) {
    const offs = alt === -2 ? [-0.32, 0.32] : [0];
    for (const o of offs) {
      const fx = x + (o - 0.25) * sp;
      c.lineWidth = thin;
      c.beginPath();
      c.moveTo(fx, y - 1.75 * sp);
      c.lineTo(fx, y + 0.5 * sp);
      c.stroke();
      c.beginPath();
      c.moveTo(fx, y + 0.5 * sp);
      c.bezierCurveTo(fx + 0.85 * sp, y - 0.05 * sp, fx + 0.75 * sp, y - 0.75 * sp, fx, y - 0.2 * sp);
      c.lineTo(fx, y + 0.05 * sp);
      c.bezierCurveTo(fx + 0.45 * sp, y - 0.45 * sp, fx + 0.6 * sp, y - 0.05 * sp, fx, y + 0.5 * sp);
      c.fill();
      c.lineWidth = Math.max(1, 0.14 * sp);
      c.stroke();
    }
  } else if (alt === 0) {
    c.lineWidth = thin;
    c.beginPath();
    c.moveTo(x - 0.25 * sp, y - 1.3 * sp);
    c.lineTo(x - 0.25 * sp, y + 0.5 * sp);
    c.moveTo(x + 0.25 * sp, y - 0.5 * sp);
    c.lineTo(x + 0.25 * sp, y + 1.3 * sp);
    c.stroke();
    c.lineWidth = thick * 0.9;
    for (const dy of [-0.38, 0.38]) {
      c.beginPath();
      c.moveTo(x - 0.25 * sp, y + (dy + 0.12) * sp);
      c.lineTo(x + 0.25 * sp, y + (dy - 0.12) * sp);
      c.stroke();
    }
  } else if (alt === 2) {
    c.lineWidth = Math.max(1.4, 0.2 * sp);
    c.beginPath();
    c.moveTo(x - 0.4 * sp, y - 0.4 * sp);
    c.lineTo(x + 0.4 * sp, y + 0.4 * sp);
    c.moveTo(x + 0.4 * sp, y - 0.4 * sp);
    c.lineTo(x - 0.4 * sp, y + 0.4 * sp);
    c.stroke();
  }
  c.restore();
}

function drawNotehead(c: Ctx, x: number, y: number, sp: number, base: number) {
  c.beginPath();
  if (base >= 4) {
    c.ellipse(x, y, 0.78 * sp, 0.48 * sp, 0, 0, Math.PI * 2);
    c.ellipse(x, y, 0.3 * sp, 0.4 * sp, 0.9, 0, Math.PI * 2);
    c.fill('evenodd');
  } else if (base >= 2) {
    c.ellipse(x, y, 0.64 * sp, 0.45 * sp, -0.35, 0, Math.PI * 2);
    c.ellipse(x, y, 0.5 * sp, 0.2 * sp, -0.55, 0, Math.PI * 2);
    c.fill('evenodd');
  } else {
    c.ellipse(x, y, 0.64 * sp, 0.45 * sp, -0.35, 0, Math.PI * 2);
    c.fill();
  }
}

function drawRest(c: Ctx, x: number, midY: number, sp: number, base: number, dots: number) {
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (base >= 4) {
    c.fillRect(x - 0.6 * sp, midY - 1 * sp, 1.2 * sp, 0.5 * sp);
  } else if (base >= 2) {
    c.fillRect(x - 0.6 * sp, midY - 0.5 * sp, 1.2 * sp, 0.5 * sp);
  } else if (base >= 1) {
    c.lineWidth = Math.max(1.2, 0.2 * sp);
    c.beginPath();
    c.moveTo(x - 0.25 * sp, midY - 1.5 * sp);
    c.lineTo(x + 0.35 * sp, midY - 0.75 * sp);
    c.stroke();
    c.lineWidth = Math.max(2, 0.38 * sp);
    c.beginPath();
    c.moveTo(x + 0.3 * sp, midY - 0.75 * sp);
    c.lineTo(x - 0.2 * sp, midY - 0.15 * sp);
    c.stroke();
    c.lineWidth = Math.max(1.2, 0.2 * sp);
    c.beginPath();
    c.moveTo(x - 0.22 * sp, midY - 0.15 * sp);
    c.lineTo(x + 0.35 * sp, midY + 0.55 * sp);
    c.bezierCurveTo(x - 0.2 * sp, midY + 0.35 * sp, x - 0.4 * sp, midY + 0.9 * sp, x + 0.05 * sp, midY + 1.3 * sp);
    c.stroke();
  } else {
    const flags = base >= 0.5 ? 1 : base >= 0.25 ? 2 : 3;
    c.lineWidth = Math.max(1, 0.15 * sp);
    const top = midY - 0.5 * sp;
    c.beginPath();
    c.moveTo(x + 0.45 * sp, top);
    c.lineTo(x - 0.05 * sp - (flags - 1) * 0.25 * sp, top + (1.3 + (flags - 1)) * sp);
    c.stroke();
    for (let f = 0; f < flags; f++) {
      const fy = top + f * sp;
      const fx = x + 0.45 * sp - f * 0.25 * sp;
      c.beginPath();
      c.arc(fx - 0.62 * sp, fy - 0.05 * sp, 0.2 * sp, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(fx - 0.62 * sp, fy + 0.12 * sp);
      c.quadraticCurveTo(fx - 0.2 * sp, fy + 0.25 * sp, fx, fy);
      c.stroke();
    }
  }
  for (let d = 0; d < dots; d++) {
    c.beginPath();
    c.arc(x + (0.95 + d * 0.5) * sp, midY - 0.5 * sp, 0.15 * sp, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

function drawFlags(c: Ctx, sx: number, ey: number, sp: number, n: number, up: boolean) {
  const d = up ? 1 : -1;
  for (let f = 0; f < n; f++) {
    const y0 = ey + d * f * 0.8 * sp;
    c.beginPath();
    c.moveTo(sx, y0);
    c.bezierCurveTo(sx + 0.1 * sp, y0 + d * 1.0 * sp, sx + 1.2 * sp, y0 + d * 1.3 * sp, sx + 0.75 * sp, y0 + d * 2.7 * sp);
    c.bezierCurveTo(sx + 0.95 * sp, y0 + d * 1.6 * sp, sx + 0.35 * sp, y0 + d * 1.4 * sp, sx, y0 + d * 1.1 * sp);
    c.closePath();
    c.fill();
  }
}

/** Key signature offsets (steps from the middle line) for treble; bass is two steps lower. */
const KEY_SHARPS = [4, 1, 5, 2, -1, 3, 0];
const KEY_FLATS = [0, 3, -1, 2, -2, 1, -3];

function drawKeySig(c: Ctx, x: number, midY: number, sp: number, fifths: number, clef: Clef, color: string, cancel = 0) {
  const shift = clef === 'bass' ? -2 : 0;
  let cx = x;
  // Naturals cancelling the previous key's accidentals that the new key doesn't keep.
  if (cancel) {
    const from = Math.sign(cancel) === Math.sign(fifths) ? Math.abs(fifths) : 0;
    for (let i = from; i < Math.abs(cancel); i++) {
      const off = (cancel > 0 ? KEY_SHARPS : KEY_FLATS)[i] + shift;
      drawAccidental(c, cx + 0.45 * sp, midY - (off * sp) / 2, sp, 0, color);
      cx += 0.85 * sp;
    }
  }
  for (let i = 0; i < Math.abs(fifths); i++) {
    const off = (fifths > 0 ? KEY_SHARPS : KEY_FLATS)[i] + shift;
    drawAccidental(c, cx + 0.5 * sp, midY - (off * sp) / 2, sp, fifths > 0 ? 1 : -1, color);
    cx += 0.85 * sp;
  }
}

function drawTimeSig(c: Ctx, x: number, midY: number, sp: number, ts: [number, number], color: string) {
  c.fillStyle = color;
  c.font = `900 ${Math.round(sp * 2.2)}px Georgia, "Times New Roman", serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const cx = x + 1.0 * sp;
  c.fillText(String(ts[0]), cx, midY - 1.0 * sp + 1);
  c.fillText(String(ts[1]), cx, midY + 1.0 * sp + 1);
  c.textAlign = 'left';
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

// ---------------------------------------------------------------------------------------------
// Drawing

const INK = {
  staff: '#5B638F',
  bar: '#7E86B4',
  note: '#E8EBFF',
  clef: '#B9C0E6',
  lyric: '#D5DAF5',
  lyricPast: '#7C84AE',
  barNo: '#8790BC',
  outTune: '#FFB08F',
  rest: '#8A93C2',
};

interface Cached {
  key: string;
  layout: StaffLayout;
  above: number;
  below: number;
  band: number;
  lyricFont: string;
  lyricOff: number;
}
let cache: Cached | null = null;

function lyricFontFor(sp: number) {
  return `600 ${Math.round(Math.max(11, Math.min(15, sp * 1.45)))}px "Bricolage Grotesque", system-ui, sans-serif`;
}

function getLayout(c: Ctx, W: number, H: number, s: DrawState): Cached {
  const key = `${s.score.id}|${s.part.id}|${s.part.notes.length}|${s.from}|${s.to}|${W}|${H}`;
  if (cache && cache.key === key) return cache;
  const [m0, m1] = measureSpan(s.score, s.from, s.to);
  const clef = clefFor(s.part);
  const mid = middleStep(clef);
  // Vertical extents of the section's notes (in staff spaces), to size the systems.
  let lo = mid - 4;
  let hi = mid + 4;
  const nA = s.range ? s.range[0] : 0;
  const nB = s.range ? s.range[1] : -1;
  for (let i = nA; i <= nB; i++) {
    const st = spell(s.part.notes[i].midi, s.key).step;
    lo = Math.min(lo, st);
    hi = Math.max(hi, st);
  }
  const above = Math.max(3.0, (hi - (mid + 4)) / 2 + 2.0);
  const lyricOff = Math.max(3.2, ((mid - 4) - lo) / 2 + 2.6); // bottom line → lyric baseline
  const below = lyricOff + 1.3;
  const perSys = above + 4 + below;
  const sp = Math.max(6.5, Math.min(11, (H - 8) / (2 * perSys), W / 44));
  c.font = lyricFontFor(sp);
  const textW = (t: string) => c.measureText(t).width;
  const layout = layoutStaff(s.score, s.part, m0, m1, { width: W, sp, textW, maxBars: W < 520 ? 3 : 4 });
  cache = { key, layout, above, below, band: perSys * sp, lyricFont: lyricFontFor(sp), lyricOff };
  return cache;
}

interface SysGeo {
  sys: StaffSystem;
  top: number; // top staff line
  mid: number; // middle line y
  y: (step: number) => number;
}

/** Note being sung at a beat on a system (null in rests). */
function eventAt(sys: StaffSystem, beat: number): StaffEvent | null {
  for (const m of sys.measures) {
    if (beat < m.sm.startBeat - 1e-6 || beat >= m.sm.endBeat - 1e-6) continue;
    let hit: StaffEvent | null = null;
    for (const le of m.events) if (le.ev.start <= beat + 1e-6) hit = le.ev;
    return hit && hit.kind === 'note' && beat < hit.start + hit.dur + 1e-6 ? hit : null;
  }
  return null;
}

export function drawStaff2D(c: Ctx, W: number, H: number, s: DrawState) {
  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, W, H);
  const L = getLayout(c, W, H, s);
  const { layout } = L;
  const sp = layout.sp;
  const systems = layout.systems;
  if (!systems.length) return;
  const tempos = s.score.tempos;
  const beat = timeToBeat(tempos, s.pos);
  const k = systemAt(systems, beat);
  const band = L.band;
  const pad = Math.max(4, Math.min(16, (H - 2 * band) / 3));
  // Turning to the next system: slide up over ~0.35 s (real time).
  const t0 = beatToTime(tempos, systems[k].startBeat);
  const u = k > 0 ? Math.max(0, Math.min(1, (s.pos - t0) / (0.35 * Math.max(0.3, s.rate)))) : 1;
  const shift = (1 - (1 - (1 - u) ** 3)) * band;
  const slots = Math.max(1, Math.floor((H - pad) / band));

  const notes = s.part.notes;
  const [ra, rb] = s.range ?? [0, -1];
  const inRange = (i: number) => s.range != null && i >= ra && i <= rb;
  const isPast = (i: number) => notes[i].start + notes[i].dur <= s.pos;
  const isNow = (i: number) => inRange(i) && notes[i].start <= s.pos && s.pos < notes[i].start + notes[i].dur;
  const vis = (i: number): 'show' | 'letters' | 'none' => ((isPast(i) && inRange(i)) || !s.hide ? 'show' : s.hide(i));

  const geos: SysGeo[] = [];
  // The previous system only while it slides out of view.
  for (let j = k - (shift > 0.5 ? 1 : 0); j <= k + slots; j++) {
    if (j < 0 || j >= systems.length) continue;
    const top = pad + (j - k) * band + shift + L.above * sp;
    if (top - L.above * sp > H || top + (4 + L.below) * sp < 0) continue;
    const midY = top + 2 * sp;
    geos.push({ sys: systems[j], top, mid: midY, y: (st: number) => midY - ((st - layout.mid) * sp) / 2 });
  }

  for (const g of geos) drawSystem(c, g, layout, L, s, { vis, isPast, isNow, inRange });

  // Pitch trace, on every visible system up to now.
  for (const g of geos) drawTrace(c, g, s, L, beat);

  // Playhead on the current system.
  const cur = geos.find((g) => g.sys === systems[k]);
  if (cur) {
    const sys = cur.sys;
    const px = beat < sys.startBeat ? sys.prefixEnd - 0.2 * sp : xAtBeat(sys, beat);
    const yTop = cur.top - Math.max(1.5, L.above - 1.2) * sp;
    const yBot = cur.top + (4 + L.lyricOff - 1.4) * sp;
    c.fillStyle = 'rgba(238,240,255,0.85)';
    c.fillRect(Math.round(px) - 1, yTop, 2, yBot - yTop);
    c.beginPath();
    c.moveTo(px - 0.55 * sp, yTop - 0.6 * sp);
    c.lineTo(px + 0.55 * sp, yTop - 0.6 * sp);
    c.lineTo(px, yTop + 0.1 * sp);
    c.closePath();
    c.fill();
    drawCountdown(c, cur, s, L);
    drawBubble(c, cur, s, L, px);
  }
}

interface Vis {
  vis: (i: number) => 'show' | 'letters' | 'none';
  isPast: (i: number) => boolean;
  isNow: (i: number) => boolean;
  inRange: (i: number) => boolean;
}

function noteColor(s: DrawState, i: number, v: Vis): string {
  if (!v.inRange(i)) return INK.note;
  if (v.isPast(i)) {
    const g = s.live?.noteGrade(i);
    return g ? gradeColor(g) : INK.note; // not graded yet (the voice arrives a moment later)
  }
  if (v.isNow(i)) return COLORS.target;
  return INK.note;
}

function drawSystem(c: Ctx, g: SysGeo, layout: StaffLayout, L: Cached, s: DrawState, v: Vis) {
  const { sys, top, mid } = g;
  const sp = layout.sp;
  const lw = Math.max(1, Math.round(sp * 0.1));
  // Staff lines.
  c.fillStyle = INK.staff;
  for (let l = 0; l < 5; l++) c.fillRect(sys.clefX - 0.3 * sp, Math.round(top + l * sp), sys.x1 - sys.clefX + 0.3 * sp, lw);
  // Clef, key, time.
  if (layout.clef === 'bass') drawBass(c, sys.clefX, top + sp, sp, INK.clef);
  else drawTreble(c, sys.clefX, top + 3 * sp, sp, INK.clef, layout.clef === 'treble8');
  drawKeySig(c, sys.keyX, mid, sp, sys.key.fifths, layout.clef, INK.clef);
  if (sys.timeSig) drawTimeSig(c, sys.timeX, mid, sp, sys.timeSig, INK.clef);

  // Barlines + numbers.
  c.font = `600 ${Math.round(Math.max(9, sp * 0.95))}px "JetBrains Mono", monospace`;
  c.textBaseline = 'alphabetic';
  sys.measures.forEach((m, mi) => {
    const last = mi === sys.measures.length - 1;
    c.fillStyle = INK.bar;
    const bx = Math.round(m.x1) - 1;
    if (m.sm.doubleBar) {
      const final = last && m.sm.index === s.score.measures.length - 1;
      c.fillRect(bx - (final ? 0.75 : 0.5) * sp, top, lw, 4 * sp + lw);
      c.fillRect(bx - (final ? 0.35 * sp : 0), top, final ? 0.4 * sp : lw, 4 * sp + lw);
    } else c.fillRect(bx, top, lw + 0.5, 4 * sp + lw);
    c.fillStyle = INK.barNo;
    const nx = mi === 0 ? sys.clefX : m.x0 - 0.2 * sp;
    if (m.sm.number !== '0') c.fillText(m.sm.number, nx, top - 1.75 * sp);
    if (m.changeX != null) {
      let cx = m.changeX;
      if (m.sm.keyChange) {
        drawKeySig(c, cx, mid, sp, m.sm.key.fifths, layout.clef, INK.clef, m.sm.prevFifths);
        cx += keyW(Math.max(Math.abs(m.sm.key.fifths), Math.abs(m.sm.prevFifths))) * sp;
      }
      if (m.sm.timeChange) drawTimeSig(c, cx, mid, sp, m.sm.timeSig, INK.clef);
    }
  });

  // Notes.
  const headRx = 0.62 * sp;
  const stemW = Math.max(1, 0.12 * sp);
  const allEvents: { le: LaidEvent; m: LaidMeasure }[] = [];
  for (const m of sys.measures) for (const le of m.events) allEvents.push({ le, m });
  // Bars where some note is still hidden: rests hidden too (off book: empty bars).
  const hiddenBar = new Set<number>();
  for (const m of sys.measures) for (const le of m.events) if (le.ev.noteIndex != null && v.vis(le.ev.noteIndex) !== 'show') hiddenBar.add(m.sm.index);

  const stemEnds = new Map<StaffEvent, number>();
  // Beams first (they decide stem lengths).
  for (const m of sys.measures) {
    m.sm.beams.forEach((grp) => {
      const les = grp.map((i) => m.events[i]);
      if (les.some((le) => v.vis(le.ev.noteIndex!) !== 'show')) return; // falls back to flags
      const up = les[0].ev.stemUp!;
      const d = up ? -1 : 1;
      const sx = (le: LaidEvent) => (up ? le.x + headRx - stemW / 2 : le.x - headRx + stemW / 2);
      const hy = (le: LaidEvent) => g.y(le.ev.step!);
      const x0 = sx(les[0]);
      const x1 = sx(les[les.length - 1]);
      const maxBeams = Math.max(...les.map((le) => beamCount(le.ev.base)));
      const len = 3.3 + Math.max(0, maxBeams - 2) * 0.75;
      let y0 = hy(les[0]) + d * len * sp;
      let y1 = hy(les[les.length - 1]) + d * len * sp;
      const maxRise = Math.min(1.0 * sp, Math.abs(x1 - x0) * 0.25);
      if (Math.abs(y1 - y0) > maxRise) y1 = y0 + Math.sign(y1 - y0) * maxRise;
      const at = (x: number) => (x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
      // Every stem at least 2.6 spaces long...
      let fix = 0;
      for (const le of les) {
        const need = hy(le) + d * (2.6 + Math.max(0, maxBeams - 1) * 0.75) * sp;
        const diff = up ? at(sx(le)) - need : need - at(sx(le));
        if (diff > fix) fix = diff;
      }
      // ...and the beam reaches at least the middle line.
      for (const le of les) {
        const diff = up ? at(sx(le)) - mid : mid - at(sx(le));
        if (diff > fix) fix = diff;
      }
      y0 -= d * fix;
      y1 -= d * fix;
      const bt = 0.46 * sp;
      const gap = 0.76 * sp;
      const colors = les.map((le) => noteColor(s, le.ev.noteIndex!, v));
      const beamColor = colors.every((x) => x === colors[0]) ? colors[0] : INK.note;
      c.fillStyle = beamColor;
      c.globalAlpha = les.every((le) => !v.inRange(le.ev.noteIndex!)) ? 0.35 : 1;
      const beamSeg = (xa: number, xb: number, level: number) => {
        const off = -d * level * gap;
        const ya = at(xa) + off;
        const yb = at(xb) + off;
        c.beginPath();
        c.moveTo(xa, ya);
        c.lineTo(xb, yb);
        c.lineTo(xb, yb + d * bt);
        c.lineTo(xa, ya + d * bt);
        c.closePath();
        c.fill();
      };
      // Stems end at the outer edge of the primary beam.
      for (const le of les) stemEnds.set(le.ev, at(sx(le)));
      beamSeg(x0, x1, 0);
      for (let lvl = 1; lvl < maxBeams; lvl++) {
        for (let q = 0; q < les.length; q++) {
          if (beamCount(les[q].ev.base) <= lvl) continue;
          const nextHas = q + 1 < les.length && beamCount(les[q + 1].ev.base) > lvl;
          const prevHas = q > 0 && beamCount(les[q - 1].ev.base) > lvl;
          if (nextHas) beamSeg(sx(les[q]), sx(les[q + 1]), lvl);
          else if (!prevHas) {
            const stub = 1.1 * sp;
            if (q === 0) beamSeg(sx(les[q]), sx(les[q]) + stub, lvl);
            else beamSeg(sx(les[q]) - stub, sx(les[q]), lvl);
          }
        }
      }
      c.globalAlpha = 1;
    });
  }

  for (const { le, m } of allEvents) {
    const e = le.ev;
    const x = le.x;
    if (e.kind === 'rest') {
      const pastRest = beatToTime(s.score.tempos, e.start + e.dur) <= s.pos;
      if (hiddenBar.has(m.sm.index) && !pastRest) continue;
      c.fillStyle = INK.rest;
      c.strokeStyle = INK.rest;
      drawRest(c, x, mid, sp, e.base, e.dots);
      continue;
    }
    const i = e.noteIndex!;
    const visib = v.vis(i);
    if (visib !== 'show') continue;
    const col = noteColor(s, i, v);
    const dim = !v.inRange(i);
    const now = v.isNow(i);
    const y = g.y(e.step!);
    c.globalAlpha = dim ? 0.35 : 1;
    // Ledger lines.
    c.fillStyle = INK.staff;
    const off = e.step! - layout.mid;
    if (Math.abs(off) >= 6) {
      const dir = Math.sign(off);
      for (let o = 6; o <= Math.abs(off); o += 2) {
        const ly = g.y(layout.mid + dir * o);
        c.fillRect(x - headRx - 0.4 * sp, Math.round(ly), 2 * headRx + 0.8 * sp, lw);
      }
    }
    c.fillStyle = col;
    if (now) {
      c.save();
      c.shadowColor = COLORS.target;
      c.shadowBlur = Math.max(10, sp * 1.6);
      drawNotehead(c, x, y, sp, e.base);
      drawNotehead(c, x, y, sp, e.base);
      c.restore();
    } else drawNotehead(c, x, y, sp, e.base);
    // Accidental.
    if (e.accidental != null) drawAccidental(c, x - headRx - 0.75 * sp, y, sp, e.accidental, col);
    // Dots (moved into the space when the note sits on a line).
    for (let d = 0; d < e.dots; d++) {
      const dy = mod(off, 2) === 0 ? -0.5 * sp : 0;
      c.beginPath();
      c.arc(x + headRx + (0.45 + d * 0.45) * sp, y + dy, 0.16 * sp, 0, Math.PI * 2);
      c.fill();
    }
    // Stem + flags.
    if (e.base < 4) {
      const up = e.stemUp!;
      const sx = up ? x + headRx - stemW / 2 : x - headRx + stemW / 2;
      let ey = stemEnds.get(e);
      const beamed = ey != null;
      if (ey == null) {
        const fl = beamCount(e.base);
        const len = (3.3 + Math.max(0, fl - 1) * 0.6) * sp;
        ey = y + (up ? -len : len);
        // Long stems reach the middle line.
        if (up && ey > mid) ey = mid;
        if (!up && ey < mid) ey = mid;
      }
      c.fillRect(sx - stemW / 2, Math.min(y, ey), stemW, Math.abs(ey - y));
      if (!beamed && e.base <= 0.5) drawFlags(c, sx, ey, sp, beamCount(e.base), up);
    }
    c.globalAlpha = 1;
  }

  // Ties (also across the system edge).
  c.globalAlpha = 1;
  for (let q = 0; q < allEvents.length; q++) {
    const e = allEvents[q].le.ev;
    if (e.kind !== 'note') continue;
    const i = e.noteIndex!;
    if (v.vis(i) !== 'show') continue;
    const y = g.y(e.step!);
    const side = e.stemUp ? 1 : -1;
    c.fillStyle = noteColor(s, i, v);
    c.globalAlpha = v.inRange(i) ? 1 : 0.35;
    if (e.tieStart) {
      const nx = allEvents[q + 1]?.le.ev.noteIndex === i ? allEvents[q + 1].le.x : sys.x1 + 0.6 * sp;
      drawTie(c, allEvents[q].le.x + 0.75 * sp, nx - 0.75 * sp, y + side * 0.65 * sp, side, sp);
    }
    if (e.tieEnd && q === 0) drawTie(c, sys.prefixEnd - 0.8 * sp, allEvents[q].le.x - 0.75 * sp, y + side * 0.65 * sp, side, sp);
    c.globalAlpha = 1;
  }

  // Triplet numbers.
  c.font = `italic 700 ${Math.round(sp * 1.25)}px Georgia, serif`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  for (const m of sys.measures) {
    let grp: LaidEvent[] = [];
    let sum = 0;
    const flushT = () => {
      if (grp.length && grp.every((le) => le.ev.kind === 'rest' || v.vis(le.ev.noteIndex!) === 'show')) {
        const xa = grp[0].x;
        const xb = grp[grp.length - 1].x;
        let yTop = top - 0.6 * sp;
        for (const le of grp) {
          if (le.ev.step == null) continue;
          const y = g.y(le.ev.step);
          const end = stemEnds.get(le.ev) ?? (le.ev.stemUp ? y - 3.3 * sp : y);
          yTop = Math.min(yTop, y - 0.8 * sp, end - 0.4 * sp);
        }
        c.fillStyle = INK.clef;
        c.fillText('3', (xa + xb) / 2 + 0.3 * sp, yTop);
      }
      grp = [];
      sum = 0;
    };
    for (const le of m.events) {
      if (!le.ev.tuplet) {
        flushT();
        continue;
      }
      grp.push(le);
      sum += le.ev.dur;
      if (Math.abs(sum * 2 - Math.round(sum * 2)) < 0.02) flushT();
    }
    flushT();
  }
  c.textAlign = 'left';

  drawLyrics(c, g, s, L, v, allEvents.map((x) => x.le));
}

function beamCount(base: number): number {
  return base >= 1 ? 0 : base >= 0.5 ? 1 : base >= 0.25 ? 2 : base >= 0.125 ? 3 : 4;
}

function drawTie(c: Ctx, xa: number, xb: number, y: number, side: number, sp: number) {
  if (xb - xa < 0.6 * sp) return;
  const h = Math.min(1.0 * sp, 0.25 * sp + (xb - xa) * 0.08) * side;
  const th = 0.18 * sp * side;
  const mx = (xa + xb) / 2;
  c.beginPath();
  c.moveTo(xa, y);
  c.quadraticCurveTo(mx, y + 2 * h, xb, y);
  c.quadraticCurveTo(mx, y + 2 * h - 2 * th, xa, y);
  c.fill();
}

function drawLyrics(c: Ctx, g: SysGeo, s: DrawState, L: Cached, v: Vis, les: LaidEvent[]) {
  const sp = L.layout.sp;
  const by = g.top + (4 + L.lyricOff) * sp;
  c.font = L.lyricFont;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'center';
  const placed: { le: LaidEvent; text: string; x0: number; x1: number; syl?: string; i: number }[] = [];
  for (const le of les) {
    const e = le.ev;
    if (e.kind !== 'note' || !e.first) continue;
    const i = e.noteIndex!;
    const n = s.part.notes[i];
    const visib = v.vis(i);
    if (visib === 'none') continue;
    let text = n.lyric ?? '';
    if (visib === 'letters') {
      text = wordInitial(n);
      c.save();
      c.font = `800 ${Math.round(sp * 1.6)}px "Bricolage Grotesque", sans-serif`;
      c.fillStyle = v.isNow(i) ? COLORS.target : COLORS.targetText;
      if (text) c.fillText(text, le.x, by);
      c.restore();
      continue;
    }
    if (!text) continue;
    const now = v.isNow(i);
    c.fillStyle = !v.inRange(i) ? INK.lyricPast : now ? COLORS.targetText : v.isPast(i) ? INK.lyricPast : INK.lyric;
    if (now) {
      c.save();
      c.font = L.lyricFont.replace(/^600/, '800');
      c.fillText(text, le.x, by);
      c.restore();
    } else c.fillText(text, le.x, by);
    const w = c.measureText(text).width;
    placed.push({ le, text, x0: le.x - w / 2, x1: le.x + w / 2, syl: n.syllabic, i });
  }
  c.textAlign = 'left';
  // Hyphens between syllables of a word; extender lines under melismas.
  c.fillStyle = INK.lyricPast;
  const hy = by - 0.45 * sp;
  for (let q = 0; q < placed.length; q++) {
    const p = placed[q];
    const nx = placed[q + 1];
    if (p.syl === 'begin' || p.syl === 'middle') {
      const xa = p.x1;
      const xb = nx ? nx.x0 : g.sys.x1;
      if (xb - xa > 0.8 * sp) {
        const hw = Math.min(0.6 * sp, (xb - xa) * 0.4);
        c.fillRect((xa + xb) / 2 - hw / 2, hy, hw, Math.max(1, 0.14 * sp));
      }
    } else {
      // Melisma: following notes without a syllable until the next word.
      let lastX = -1;
      const start = les.indexOf(p.le);
      for (let r = start + 1; r < les.length; r++) {
        const e = les[r].ev;
        if (e.kind !== 'note') break;
        if (e.first && s.part.notes[e.noteIndex!].lyric) break;
        lastX = les[r].x;
      }
      if (lastX > p.x1 + 0.5 * sp) c.fillRect(p.x1 + 0.2 * sp, by, lastX + 0.6 * sp - p.x1 - 0.2 * sp, Math.max(1, 0.1 * sp));
    }
  }
}

function drawTrace(c: Ctx, g: SysGeo, s: DrawState, L: Cached, beatNow: number) {
  const { sys } = g;
  const sp = L.layout.sp;
  const tempos = s.score.tempos;
  const tA = beatToTime(tempos, sys.startBeat);
  const tB = Math.min(beatToTime(tempos, sys.endBeat), s.pos + 0.05);
  if (tB <= tA || beatNow < sys.startBeat - 1e-6) return;
  const smp = s.samples;
  // First sample at or after tA (samples are in time order).
  let lo = 0;
  let hi = smp.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (smp[m].time < tA) lo = m + 1;
    else hi = m;
  }
  const yMin = g.top - (L.above - 0.6) * sp;
  const yMax = g.top + (4 + L.lyricOff - 1.5) * sp;
  c.lineWidth = Math.max(2.5, 0.34 * sp);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  let prev: { x: number; y: number; t: number } | null = null;
  let color = '';
  // In tune or not is judged on ~one vibrato cycle (like the scoring), so vibrato centred on the
  // note doesn't stripe the line.
  const win: { t: number; m: number; ev: StaffEvent | null }[] = [];
  c.beginPath();
  for (let q = lo; q < smp.length; q++) {
    const sm: PitchSample = smp[q];
    if (sm.time > tB) break;
    if (sm.midi == null) {
      prev = null;
      continue;
    }
    const b = timeToBeat(tempos, sm.time);
    const ev = eventAt(sys, b);
    const key = keyAtBeat(s.score, b);
    const hidden = !!ev && ev.noteIndex != null && !!s.hide && s.hide(ev.noteIndex) !== 'show'
      && s.part.notes[ev.noteIndex].start + s.part.notes[ev.noteIndex].dur > s.pos;
    const step = sungStep(sm.midi, key, ev && !hidden ? { midi: ev.midi!, step: ev.step!, alt: ev.alt! } : null);
    const x = xAtBeat(sys, b);
    const y = Math.max(yMin, Math.min(yMax, g.y(step)));
    while (win.length && (sm.time - win[0].t > 0.18 || win[0].ev !== ev)) win.shift();
    win.push({ t: sm.time, m: sm.midi, ev });
    let col: string;
    if (!ev || hidden) col = '#8C96CC';
    else {
      const avg = win.reduce((a, w) => a + w.m, 0) / win.length;
      let cents = (avg - ev.midi!) * 100;
      if (Math.abs(cents) > 700) cents = ((cents % 1200) + 1800) % 1200 - 600;
      col = Math.abs(cents) <= s.tolerance ? COLORS.voice : INK.outTune;
    }
    if (prev && sm.time - prev.t <= 0.12) {
      if (col !== color) {
        c.stroke();
        c.strokeStyle = col;
        color = col;
        c.beginPath();
        c.moveTo(prev.x, prev.y);
      }
      c.lineTo(x, y);
    } else {
      if (col !== color) {
        c.stroke();
        c.strokeStyle = col;
        color = col;
        c.beginPath();
      }
      c.moveTo(x, y);
      c.lineTo(x + 0.01, y);
    }
    prev = { x, y, t: sm.time };
  }
  c.stroke();
}

function drawBubble(c: Ctx, g: SysGeo, s: DrawState, L: Cached, px: number) {
  const sp = L.layout.sp;
  const last = s.samples[s.samples.length - 1];
  if (!last || last.midi == null || s.pos - last.time >= 0.2) return;
  const notes = s.part.notes;
  let heard = -1;
  if (s.range) {
    const [h0, h1] = s.range;
    for (let i = h0; i <= h1; i++) {
      if (notes[i].start > last.time) break;
      if (last.time < notes[i].start + notes[i].dur) heard = i;
    }
  }
  const lb = timeToBeat(s.score.tempos, last.time);
  const ev = eventAt(g.sys, lb);
  const hiddenEv = !!ev && ev.noteIndex != null && !!s.hide && s.hide(ev.noteIndex) !== 'show'
    && notes[ev.noteIndex].start + notes[ev.noteIndex].dur > s.pos;
  const step = sungStep(last.midi, keyAtBeat(s.score, lb), ev && !hiddenEv ? { midi: ev.midi!, step: ev.step!, alt: ev.alt! } : null);
  const yMin = g.top - (L.above - 0.6) * sp;
  const yMax = g.top + (4 + L.lyricOff - 1.5) * sp;
  const py = Math.max(yMin, Math.min(yMax, g.y(step)));
  // Live voice dot at the playhead.
  c.fillStyle = 'rgba(76,201,240,0.28)';
  c.beginPath();
  c.arc(px, py, Math.max(7, 0.9 * sp), 0, Math.PI * 2);
  c.fill();
  c.fillStyle = COLORS.voice;
  c.beginPath();
  c.arc(px, py, Math.max(3.5, 0.45 * sp), 0, Math.PI * 2);
  c.fill();
  if (heard < 0 || (s.hide && s.hide(heard) !== 'show' && notes[heard].start + notes[heard].dur > s.pos)) return;
  const target = notes[heard].midi;
  let sum = 0;
  let cnt = 0;
  for (let q = s.samples.length - 1; q >= 0 && last.time - s.samples[q].time < 0.2 && s.samples[q].time >= notes[heard].start; q--) {
    const mm = s.samples[q].midi;
    if (mm != null && Math.abs(mm - last.midi) < 1.5) {
      sum += mm;
      cnt++;
    }
  }
  const shown = cnt ? sum / cnt : last.midi;
  let cents = (shown - target) * 100;
  if (Math.abs(cents) > 600) cents = ((cents % 1200) + 1800) % 1200 - 600;
  const rc = Math.round(Math.abs(cents));
  const txt = `${rc === 0 ? '±' : cents > 0 ? '+' : '−'}${rc}¢`;
  c.font = '600 12px "JetBrains Mono", monospace';
  c.textBaseline = 'middle';
  const tw = c.measureText(txt).width;
  const bw = tw + 14;
  // Above the staff, next to the top of the playhead: it never hides the notes you're about to sing.
  let bx = px + 0.9 * sp;
  if (bx + bw > g.sys.x1 + 6) bx = px - 0.9 * sp - bw;
  const by = g.top - Math.max(11, (L.above - 0.9) * sp * 0.5 + 6);
  const ok = Math.abs(cents) <= s.tolerance;
  c.fillStyle = '#0B0D1A';
  roundRect(c, bx, by - 11, bw, 22, 7);
  c.fill();
  c.strokeStyle = ok ? COLORS.voice : COLORS.target;
  c.lineWidth = 1;
  c.stroke();
  c.fillStyle = ok ? COLORS.voice : COLORS.targetText;
  c.fillText(txt, bx + 7, by + 1);
}

/** Entry countdown above the staff when your next note comes after a rest. */
function drawCountdown(c: Ctx, g: SysGeo, s: DrawState, L: Cached) {
  if (!s.range) return;
  const sp = L.layout.sp;
  const notes = s.part.notes;
  const [a, b] = s.range;
  for (let i = a; i <= b; i++) {
    const n = notes[i];
    if (n.start < s.pos) continue;
    const prev = i > 0 ? notes[i - 1] : null;
    const afterRest = !prev || n.start - (prev.start + prev.dur) >= 0.6;
    const bt = Math.max(0.15, s.beatSec);
    const ahead = n.start - s.pos;
    if (afterRest && ahead <= 3 * bt && s.pos >= s.from - 0.01) {
      const kk = Math.ceil(ahead / bt - 1e-6);
      if (kk > 0) {
        const nb = timeToBeat(s.score.tempos, n.start);
        const x = nb < g.sys.endBeat ? xAtBeat(g.sys, nb) : g.sys.x1 - 0.8 * sp;
        c.font = `800 ${Math.round(Math.max(16, sp * 2))}px "Bricolage Grotesque", sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'alphabetic';
        c.fillStyle = COLORS.target;
        c.globalAlpha = 0.95;
        c.fillText(String(kk), x, g.top - (L.above - 1.9) * sp);
        c.globalAlpha = 1;
        c.textAlign = 'left';
      }
    }
    break;
  }
}
