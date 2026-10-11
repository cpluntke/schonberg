// Canvas renderer for the practice "score view": your part as real sheet music (two systems like a
// page, a playhead moving through the top one) with your sung pitch drawn as ink at its exact staff
// height. Same inputs as the highway (DrawState); the layout is pure and unit-tested, the drawing
// sits on top.
//
// Coordinates: pitches are placed on diatonic "steps" (C4 = 28, 7 per octave). A float MIDI value
// maps to a float step by piecewise-linear interpolation between the seven letters' pitches in the
// current key (plus the accidental of the note being sung), so a note sung 30 cents flat sits just
// below its notehead and a perfectly sung C♮ in D major sits exactly on the C.
import { F_CLEF, G_CLEF, GLYPH_UNITS_PER_SPACE } from './clefGlyphs';
import type { KeySig, NoteSpelling, Part, Score, TempoEvent } from '../../music/types';
import type { PitchSample } from '../../game/types';
import { beatToTime, timeToBeat } from '../../music/time';
import { keyHint, movesWithKey, noteLabel, spellNote, type NotationMode } from '../../game/notation';
import { keyAtBeatIn } from '../../music/keymarks';
import { nameKeysOf, nameKeysSig } from '../../progress/keymarks';
import { wordInitial, type DrawState } from './highway2d';
import { COLORS, INK, STAFF_GRADE, TRACE_COLORS, canvasGeneration, fpx } from './palette';

export { INK, STAFF_GRADE } from './palette';

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

/** Diatonic step and alteration of a sounding pitch: as written (`written`, from the source) or spelled in `key`. */
export function spell(midi: number, key: Pick<KeySig, 'fifths' | 'mode'>, written?: Pick<NoteSpelling, 'letter' | 'alter'> | null): { step: number; alt: number } {
  const m = Math.round(midi);
  const s = spellNote(m, key, written);
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
      // Rests show the metre: each one starts on a multiple of its own length, never a dotted
      // value in simple time (a dotted beat in compound time), and one shorter than a beat stays
      // inside its beat. So 3 beats of rest in 4/4 are a half + a quarter, not a dotted half.
      const compound = Math.abs(unit - 1.5 * Math.pow(2, Math.round(Math.log2(unit / 1.5)))) < EPS;
      const plain = [4, 2, 1, 0.5, 0.25, 0.125, 0.0625];
      const cands = compound ? [unit * 2, unit, ...plain.filter((v) => v < unit - EPS)] : plain;
      for (const v of cands) {
        if (v > d + EPS || mod(off + EPS, v) >= 2 * EPS) continue;
        if (v < unit - EPS && (onBeat ? 0 : into) + v > unit + EPS) continue;
        if (!writtenValue(v)) continue;
        take = v;
        break;
      }
      if (take == null) {
        if (!onBeat && d > toBeat + EPS) take = writtenValue(toBeat) ? toBeat : largestWritten(toBeat);
        else if (whole && d <= unit + EPS) take = d;
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
  /** That accidental is a courtesy one (drawn in parentheses), see markAccidentals. */
  courtesy?: boolean;
  /** The accidental the source printed on the note (first piece only), and whether it was cautionary. */
  srcAcc?: number;
  srcCourtesy?: boolean;
  tieStart?: boolean;
  tieEnd?: boolean;
  /** First written piece of the ScoreNote (carries the lyric). */
  first?: boolean;
  lyric?: string;
  syllabic?: 'single' | 'begin' | 'middle' | 'end';
  stemUp?: boolean;
  /** Index of the beam group in StaffMeasure.beams. */
  beam?: number;
  /** Other notes sounding with this one (a chord on one stem; instrument parts). */
  chord?: ChordNote[];
}

/** A further note of a chord (the event's own fields describe its main note). */
export interface ChordNote {
  noteIndex: number;
  midi: number;
  step: number;
  alt: number;
  accidental?: number | null;
  courtesy?: boolean;
  srcAcc?: number;
  srcCourtesy?: boolean;
  tieStart: boolean;
  tieEnd: boolean;
  first: boolean;
}

/** Steps of every notehead of an event (main note first). */
export function eventSteps(e: Pick<StaffEvent, 'step' | 'chord'>): number[] {
  const out = e.step == null ? [] : [e.step];
  if (e.chord) for (const c of e.chord) out.push(c.step);
  return out;
}

/** Does the event hold note `i` (as its main note or in its chord)? */
export function eventHas(e: Pick<StaffEvent, 'noteIndex' | 'chord'>, i: number): boolean {
  return e.noteIndex === i || !!e.chord?.some((c) => c.noteIndex === i);
}

export interface StaffMeasure {
  index: number;
  number: string;
  startBeat: number;
  endBeat: number;
  key: KeySig;
  /** The key the note names follow here (the key signature, or an admin's key mark). */
  nameKey: KeySig;
  /** The names' do moved here (or this is the first bar shown): a "Do = …" hint is printed. */
  nameChange: boolean;
  timeSig: [number, number];
  /** Key or time signature differ from the previous bar (printed at the bar's start). */
  keyChange: boolean;
  timeChange: boolean;
  prevFifths: number;
  doubleBar: boolean;
  events: StaffEvent[];
  /** Beam groups: indices into `events`. */
  beams: number[][];
  /** Accidentals still in force at the bar's end (for the next bar's courtesy accidentals). */
  carry: Carried;
}

/** Letters (0..6 = C..B) that end a bar altered against the key signature → the alterations. */
export type Carried = Map<number, Set<number>>;

type Head = { step?: number; alt?: number; tieEnd?: boolean; accidental?: number | null; courtesy?: boolean; srcAcc?: number; srcCourtesy?: boolean };

/**
 * Accidentals of a bar, relative to the key signature `fifths`:
 * - an accidental holds for that pitch (letter and octave) until the barline; a note tied over the
 *   barline keeps its alteration without repeating the accidental;
 * - courtesy accidental: when a letter ended the previous bar (`prev`, in any octave) with an
 *   alteration other than the one it has now, its first (untied) note in this bar shows its
 *   accidental again, in parentheses (D♮ | D♯ in E major: the ♯ is printed after the barline);
 * - an accidental the source printed (`srcAcc`, e.g. its own cautionary ones) is always shown.
 * Returns what this bar hands on to the next one.
 */
export function markAccidentals(events: StaffEvent[], fifths: number, prev?: Carried): Carried {
  const ka = keyAlts(fifths);
  const state = new Map<number, number>();
  /** Alteration of each step's latest note (also tied ones). */
  const sounding = new Map<number, number>();
  const seen = new Set<number>();
  const mark = (h: Head) => {
    h.courtesy = undefined;
    if (h.step == null) return;
    const alt = h.alt ?? 0;
    const letter = mod(h.step, 7);
    sounding.set(h.step, alt);
    if (h.tieEnd) {
      // A tie into the bar doesn't need (or set) an accidental.
      h.accidental = null;
      return;
    }
    const first = !seen.has(letter);
    seen.add(letter);
    const cur = state.get(h.step) ?? ka[letter];
    if (alt !== cur) {
      h.accidental = alt;
      state.set(h.step, alt);
    } else if (first && [...(prev?.get(letter) ?? [])].some((a) => a !== alt)) {
      h.accidental = alt;
      h.courtesy = true;
    } else if (h.srcAcc === alt) {
      // printed in the source although the rules above don't need it: the engraver's choice
      h.accidental = alt;
      if (h.srcCourtesy) h.courtesy = true;
    } else h.accidental = null;
  };
  for (const e of events) {
    if (e.kind !== 'note') continue;
    mark(e);
    if (e.chord) for (const c of e.chord) mark(c);
  }
  const carry: Carried = new Map();
  for (const [step, alt] of sounding) {
    const letter = mod(step, 7);
    if (alt === ka[letter]) continue;
    if (!carry.has(letter)) carry.set(letter, new Set());
    carry.get(letter)!.add(alt);
  }
  return carry;
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
  // Stem direction: away from the head farthest from the middle line.
  const far = (es: StaffEvent[]) => {
    let f = 0;
    for (const e of es) for (const st of eventSteps(e)) if (Math.abs(st - mid) > Math.abs(f)) f = st - mid;
    return f;
  };
  for (const e of events) if (e.kind === 'note') e.stemUp = far([e]) < 0;
  groups.forEach((g, gi) => {
    const f = far(g.map((i) => events[i]));
    const up = f < 0;
    for (const i of g) {
      events[i].stemUp = up;
      events[i].beam = gi;
    }
  });
  return groups;
}

/** Shortest rest of an overlapped note (beats) that is still drawn, tied, in the next chord. */
const MIN_HELD = 0.2;

/** Bars [m0, m1] of a part as notatable events: rests fill gaps, notes split at barlines with ties. */
export function buildMeasures(score: Score, part: Part, m0: number, m1: number, clef: Clef = clefFor(part), withPrev = true): StaffMeasure[] {
  const mid = middleStep(clef);
  const ms = score.measures;
  const buckets: { s: number; e: number; i: number }[][] = [];
  for (let mi = m0; mi <= m1; mi++) buckets.push([]);
  // A slight overlap with a later note (legato in a MIDI file) just ends the note there; a note
  // held well into later ones (instrument parts) keeps sounding.
  const ends = part.notes.map((n, i) => {
    let e = n.startBeat + n.durBeats;
    for (let j = i + 1; j < part.notes.length && part.notes[j].startBeat < e - 1e-6; j++) {
      const o = part.notes[j].startBeat;
      if (o > n.startBeat + 0.03 && e - o < MIN_HELD) e = o;
    }
    return e;
  });
  part.notes.forEach((n, i) => {
    const ns = n.startBeat;
    const ne = ends[i];
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
  // The bar before m0 (not shown) still decides m0's courtesy accidentals.
  let carry: Carried | undefined = withPrev && m0 > 0 && m0 <= ms.length ? buildMeasures(score, part, m0 - 1, m0 - 1, clef, false)[0]?.carry : undefined;
  let prevKey: number | null = null;
  let prevTs: string | null = null;
  const firstOfNote = new Set<number>();
  /** Notes trimmed at an overlap: their later bars are dropped too. */
  const dropped = new Set<number>();
  const nks = nameKeysOf(score);
  for (let mi = m0; mi <= m1; mi++) {
    const m = ms[mi];
    const key = keyAtBeat(score, m.startBeat);
    const nameKey = keyAtBeatIn(nks, m.startBeat);
    const nameChange = mi === m0 || (mi > 0 && keyAtBeatIn(nks, ms[mi - 1].startBeat).fifths !== nameKey.fifths);
    const ts = m.timeSig;
    const a = m.startBeat;
    const b = a + m.durBeats;
    const nominal = (ts[0] * 4) / ts[1];
    const origin = mi === 0 && m.durBeats < nominal - EPS ? b - nominal : a;
    const { unit, beam } = meterUnits(ts);
    const segs = buckets[mi - m0].filter((sg) => !dropped.has(sg.i)).sort((x, y) => x.s - y.s);
    const events: StaffEvent[] = [];
    const pushRest = (s: number, e: number) => {
      for (const p of splitDuration(s, e - s, origin, unit, true)) events.push({ ...p, kind: 'rest' });
    };
    let t = a;
    // Notes starting together become one chord; a note still sounding when the next one starts
    // is cut there and continues, tied, in the next chord (polyphonic instrument parts).
    const work = segs.slice();
    const insert = (x: { s: number; e: number; i: number }) => {
      let q = 0;
      while (q < work.length && work[q].s <= x.s + 1e-9) q++;
      work.splice(q, 0, x);
    };
    while (work.length) {
      const s0 = work[0].s;
      let grp: { s: number; e: number; i: number }[] = [];
      while (work.length && work[0].s - s0 < 0.03) grp.push(work.shift()!);
      grp = grp.filter((g) => g.e - s0 >= 0.03);
      // One head per pitch; the highest note leads (or the one carrying a syllable).
      const seen = new Set<number>();
      grp = grp.sort((x, y) => part.notes[y.i].midi - part.notes[x.i].midi).filter((g) => {
        const mm = part.notes[g.i].midi;
        if (seen.has(mm)) return false;
        seen.add(mm);
        return true;
      });
      if (!grp.length) continue;
      const li = grp.findIndex((g) => part.notes[g.i].lyric);
      if (li > 0) grp.unshift(...grp.splice(li, 1));
      const end = Math.min(work.length ? work[0].s : Infinity, ...grp.map((g) => g.e));
      if (s0 - t > 0.03) pushRest(t, s0);
      const pieces = splitDuration(s0, end - s0, origin, unit, false);
      // A note cut short by the next onset continues (tied) only when a real part of it is left;
      // a slight overlap (legato in a MIDI file) is just trimmed, without a tie.
      const heads = grp.map((g) => {
        const n = part.notes[g.i];
        const cut = g.e > end + 0.03;
        const keep = cut && g.e - end >= MIN_HELD;
        if (cut && !keep) dropped.add(g.i);
        return { g, n, sp: spell(n.midi, key, n.spelling), more: cut ? keep : ends[g.i] > g.e + 0.03 };
      });
      pieces.forEach((p, pi) => {
        const lastPiece = pi === pieces.length - 1;
        const hs = heads.map(({ g, n, sp: hsp, more }) => {
          const isFirst = !firstOfNote.has(g.i);
          firstOfNote.add(g.i);
          const src: { srcAcc?: number; srcCourtesy?: boolean } = isFirst && n.spelling?.acc != null
            ? { srcAcc: n.spelling.acc, ...(n.spelling.courtesy ? { srcCourtesy: true } : {}) } : {};
          return { noteIndex: g.i, midi: n.midi, step: hsp.step, alt: hsp.alt, tieStart: !lastPiece || more, tieEnd: !isFirst, first: isFirst, ...src, n };
        });
        const [h0, ...rest] = hs;
        events.push({
          ...p, kind: 'note', noteIndex: h0.noteIndex, midi: h0.midi, step: h0.step, alt: h0.alt,
          tieStart: h0.tieStart, tieEnd: h0.tieEnd, first: h0.first,
          ...(h0.srcAcc != null ? { srcAcc: h0.srcAcc, srcCourtesy: h0.srcCourtesy } : {}),
          lyric: h0.first ? h0.n.lyric : undefined, syllabic: h0.first ? h0.n.syllabic : undefined,
          ...(rest.length ? { chord: rest.map(({ n: _n, ...c }) => c) } : {}),
        });
      });
      for (const g of grp) if (g.e > end + 0.03 && !dropped.has(g.i)) insert({ s: end, e: g.e, i: g.i });
      t = Math.max(t, end);
    }
    if (b - t > 0.03) {
      if (!events.length) events.push({ kind: 'rest', start: a, dur: m.durBeats, base: 4, dots: 0, measureRest: true });
      else pushRest(t, b);
    }
    carry = markAccidentals(events, key.fifths, carry);
    const beams = beamGroups(events, origin, beam, mid);
    const tsKey = ts.join('/');
    out.push({
      index: mi, number: m.number, startBeat: a, endBeat: b, key, nameKey, nameChange, timeSig: ts,
      keyChange: prevKey != null && prevKey !== key.fifths, timeChange: prevTs == null || prevTs !== tsKey,
      prevFifths: prevKey ?? key.fifths, doubleBar: !!m.doubleBar || mi === ms.length - 1,
      events, beams, carry,
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
  /** Key signature cancelled (with naturals) at the start of this system, 0 = none. */
  cancelFifths: number;
  timeSig: [number, number] | null;
  clefX: number;
  keyX: number;
  timeX: number;
  prefixEnd: number;
  x1: number;
  /** time → x breakpoints (beats ascending): every onset, then the system's end. */
  bp: { beat: number; x: number }[];
  /** Horizontal scale against the natural spacing (< 1: squeezed). */
  squeeze: number;
  /**
   * A stretch of one long scrolling line (see `scroll` in LayoutOpts): no clef or signatures of its
   * own (they stay pinned at the left, at clefX/keyX/timeX), its staff starts at prefixEnd.
   */
  cont?: boolean;
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
  /** Note names under the notes: width in px of a note's name (they take room like syllables). */
  nameW?: NameW;
  maxBars?: number;
  left?: number;
  right?: number;
  /** One long line that scrolls past the playhead, in stretches of this many bars (no line breaks). */
  scroll?: number;
}

/** Horizontal scale of a scrolling line against the natural spacing (a little airier than a page). */
export const SCROLL_STRETCH = 1.12;
/** Split bars 0..n-1 into consecutive stretches of `size` bars. */
export function stretches(n: number, size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i += size) out.push(Array.from({ length: Math.min(size, n - i) }, (_, j) => i + j));
  return out;
}

/**
 * A scrolling line's stretches meet seamlessly: each one's time → x map ends at the next stretch's
 * first note (not at its own barline, which would make the line jump at every hand-over).
 */
export function joinStretches(systems: Pick<StaffSystem, 'bp'>[]): void {
  for (let i = 0; i + 1 < systems.length; i++) {
    const bp = systems[i].bp;
    const next = systems[i + 1].bp[0];
    if (bp.length && next) bp[bp.length - 1] = { beat: bp[bp.length - 1].beat, x: next.x };
  }
}

/** Natural horizontal space after an event (in staff spaces), before lyric/accidental constraints. */
export function naturalSpace(durBeats: number): number {
  return 1.45 + 1.3 * Math.log2(1 + 2 * durBeats);
}

export const CLEF_W = 3.5;
export const TIME_W = 2.5;
export const keyW = (fifths: number) => (fifths ? Math.abs(fifths) * 0.85 + 0.7 : 0.3);
/** Naturals needed to cancel `prev` when the key changes to `fifths`. */
const cancelCount = (fifths: number, prev: number) =>
  Math.sign(prev) === Math.sign(fifths) ? Math.max(0, Math.abs(prev) - Math.abs(fifths)) : Math.abs(prev);
/** Width of a key change (naturals, then the new signature). */
export const keyChangeW = (fifths: number, prev: number) => {
  const n = cancelCount(fifths, prev) + Math.abs(fifths);
  return n ? n * 0.85 + 0.7 : 0.3;
};
export const hasAcc = (e: StaffEvent | undefined) => !!e && (e.accidental != null || !!e.chord?.some((c) => c.accidental != null));
/** Room for an event's accidentals (staff spaces): wider for one in parentheses. */
export const accW = (e: StaffEvent | undefined): number => {
  if (!hasAcc(e)) return 0;
  const paren = (e!.accidental != null && e!.courtesy) || !!e!.chord?.some((c) => c.accidental != null && c.courtesy);
  return ACC_W + (paren ? PAREN_W : 0);
};
/** Two heads a step apart in a chord: one sits on the other side of the stem. */
export const hasSecond = (e: StaffEvent) => {
  const st = eventSteps(e).sort((a, b) => a - b);
  for (let i = 1; i < st.length; i++) if (st[i] - st[i - 1] === 1) return true;
  return false;
};
export const ACC_W = 1.25;
/** Extra room for the parentheses of a courtesy accidental. */
export const PAREN_W = 0.75;
/** Least gap between two note names (staff spaces). */
export const NAME_GAP = 0.45;

/** Width in px of the name of a note (`midi` in `key`, spelled as `written`), as printed under the staff. */
export type NameW = (midi: number, key: KeySig, written?: Pick<NoteSpelling, 'letter' | 'alter'>) => number;

/** The spelling an event's (main) note is drawn with, for its name. */
export const eventSpelling = (e: Pick<StaffEvent, 'step' | 'alt'>): Pick<NoteSpelling, 'letter' | 'alter'> | undefined =>
  e.step == null ? undefined : { letter: mod(e.step, 7), alter: e.alt ?? 0 };

/** Widths of the note names of a bar's events (0 for rests and tied continuations). */
export function nameWidths(sm: StaffMeasure, nameW: NameW | undefined): number[] {
  return sm.events.map((e) => (nameW && e.kind === 'note' && e.first && e.midi != null ? nameW(e.midi, sm.nameKey, eventSpelling(e)) : 0));
}

function measureWidths(sm: StaffMeasure, sp: number, textW: (s: string) => number, inside: boolean, nameW?: NameW) {
  const evs = sm.events;
  const lw = evs.map((e) => (e.lyric ? textW(e.lyric) : 0));
  const nw = nameWidths(sm, nameW);
  const gaps: number[] = [];
  let changeW = 0;
  if (inside && sm.keyChange) changeW += keyChangeW(sm.key.fifths, sm.prevFifths) * sp;
  if (inside && sm.timeChange) changeW += TIME_W * sp;
  let lead = Math.max(1.3 * sp + accW(evs[0]) * sp, lw[0] / 2 + 0.4 * sp, (nw[0] ?? 0) / 2 + 0.4 * sp);
  if (evs[0]?.measureRest) lead = 2.2 * sp;
  for (let j = 0; j < evs.length; j++) {
    const e = evs[j];
    let g = naturalSpace(e.dur) * sp;
    if (e.measureRest) g = 5 * sp;
    if (e.dots) g += 0.35 * sp * e.dots;
    if (e.kind === 'note' && hasSecond(e)) g += 1.1 * sp;
    if (j + 1 < evs.length) {
      const nx = evs[j + 1];
      if (hasAcc(nx)) g = Math.max(g, (1.5 + accW(nx) + 0.4) * sp);
      if (lw[j] || lw[j + 1]) {
        const hyph = e.syllabic === 'begin' || e.syllabic === 'middle';
        g = Math.max(g, lw[j] / 2 + lw[j + 1] / 2 + (hyph ? 1.4 : 0.6) * sp);
      }
      if (nw[j] || nw[j + 1]) g = Math.max(g, nw[j] / 2 + nw[j + 1] / 2 + NAME_GAP * sp);
    } else {
      g = Math.max(g, lw[j] / 2 + 0.5 * sp + (e.syllabic === 'begin' || e.syllabic === 'middle' ? 0.6 * sp : 0), nw[j] / 2 + 0.5 * sp);
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
  for (const sm of sms) for (const e of sm.events) for (const st of eventSteps(e)) {
    minStep = Math.min(minStep, st);
    maxStep = Math.max(maxStep, st);
  }
  const prefixW = (k: number) => {
    const sm = sms[k];
    // A key change at the start of a system also cancels the old key with naturals.
    const kw = sm.keyChange ? keyChangeW(sm.key.fifths, sm.prevFifths) : keyW(sm.key.fifths);
    return (CLEF_W + kw + (sm.timeChange ? TIME_W : 0) + 0.4) * sp;
  };
  const inner = sms.map((sm) => measureWidths(sm, sp, o.textW, true, o.nameW));
  const opening = sms.map((sm) => measureWidths(sm, sp, o.textW, false, o.nameW));
  const scroll = o.scroll != null && o.scroll > 0;
  const groups = scroll ? stretches(sms.length, o.scroll!)
    : breakSystems(opening.map((w, k) => prefixW(k) + w.total), inner.map((w) => w.total), avail, maxBars);
  let carryX = 0;
  // Scrolling: the pinned start holds the widest key signature of the section (it shows the key in
  // force as the line moves on).
  const pinKeyW = Math.max(...sms.map((sm) => keyW(sm.key.fifths)), 0);
  const systems: StaffSystem[] = groups.map((g, gi) => {
    const firstSm = sms[g[0]];
    const clefX = left + 0.3 * sp;
    const keyX = left + CLEF_W * sp;
    const timeX = keyX + (scroll ? pinKeyW : firstSm.keyChange ? keyChangeW(firstSm.key.fifths, firstSm.prevFifths) : keyW(firstSm.key.fifths)) * sp;
    // Scrolling: one line, each stretch starting where the last ended (the clef and key stay pinned).
    const prefixEnd = scroll ? (gi > 0 ? carryX : left + (CLEF_W + pinKeyW + (firstSm.timeChange ? TIME_W : 0) + 0.4) * sp) : left + prefixW(g[0]);
    const widths = g.map((k, idx) => (idx === 0 && (!scroll || gi === 0) ? opening[k] : inner[k]));
    const natural = widths.reduce((a, w) => a + w.total, 0);
    const room = left + avail - prefixEnd;
    let f = scroll ? SCROLL_STRETCH : room / Math.max(1, natural);
    const last = gi === groups.length - 1;
    if (!scroll && last && f > 1) f = Math.min(f, 1.4);
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
    carryX = x;
    return {
      measures, startBeat: firstSm.startBeat, endBeat, key: firstSm.key,
      cancelFifths: firstSm.keyChange ? firstSm.prevFifths : 0,
      timeSig: firstSm.timeChange ? firstSm.timeSig : null,
      clefX, keyX, timeX, prefixEnd, x1: x, bp, squeeze: f,
      ...(scroll ? { cont: true } : {}),
    };
  });
  if (scroll) joinStretches(systems);
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
 * Between the target and its neighbouring letters, deviations are magnified: the pitch is warped
 * monotonically inside that interval (about MAGNIFY staff steps per semitone right at the note,
 * easing off towards the neighbour), so 30 cents off shows as about half a step on a phone, on
 * either side of the note. It is exact on the note, exact on the neighbouring letters and beyond,
 * and keeps the order of pitches whatever the size of the interval (also augmented seconds).
 */
export function sungStep(midi: number, key: Pick<KeySig, 'fifths'>, target?: { midi: number; step: number; alt: number } | null): number {
  const alts = keyAlts(key.fifths);
  let m = midi;
  if (!target) return midiToStep(m, alts);
  alts[mod(target.step, 7)] = target.alt;
  if (Math.abs(m - target.midi) > 7) m -= 12 * Math.round((m - target.midi) / 12);
  const d = m - target.midi;
  if (Math.abs(d) < 1e-9) return target.step;
  const dir = d > 0 ? 1 : -1;
  const letterPitch = (st: number) => (Math.floor(st / 7) + 1) * 12 + LETTER_PC[mod(st, 7)] + (alts[mod(st, 7)] ?? 0);
  let nb = target.step + dir;
  let gap = (letterPitch(nb) - target.midi) * dir; // semitones to the neighbouring letter
  // A written note enharmonic with its neighbour in the key (B♯ with C♮, B♭ in B major): the
  // letter after that one is the neighbour, else the ink would jump past the notehead.
  if (gap < 0.5) {
    nb += dir;
    gap = (letterPitch(nb) - target.midi) * dir;
  }
  if (gap < 0.5 || Math.abs(d) >= gap) return midiToStep(m, alts);
  const s1 = midiToStep(letterPitch(nb), alts);
  const span = Math.max(1, Math.abs(s1 - target.step));
  const u = Math.abs(d) / gap;
  const k = Math.max(0, (MAGNIFY * gap) / span - 1);
  return target.step + (s1 - target.step) * (((1 + k) * u) / (1 + k * u));
}
/** Staff steps per semitone right at the target (plain staff: 0.5 for a whole tone, 1 for a semitone). */
const MAGNIFY = 3;

// ---------------------------------------------------------------------------------------------
// Glyphs (drawn in staff-space units; y grows downwards)

type Ctx = CanvasRenderingContext2D;

let TREBLE: Path2D | null = null;
let BASS: Path2D | null = null;

/** Draws a font outline (Bravura units, y up) with its origin at (x, lineY). */
function drawGlyph(c: Ctx, path: Path2D, x: number, lineY: number, sp: number, color: string) {
  const k = sp / GLYPH_UNITS_PER_SPACE;
  c.save();
  c.translate(x, lineY);
  c.scale(k, -k);
  c.fillStyle = color;
  c.fill(path);
  c.restore();
}

export function drawTreble(c: Ctx, x: number, gLineY: number, sp: number, color: string, eight: boolean) {
  TREBLE ??= new Path2D(G_CLEF);
  drawGlyph(c, TREBLE, x + 0.1 * sp, gLineY, sp, color);
  if (eight) {
    c.fillStyle = color;
    c.font = `700 ${Math.round(sp * 1.15)}px Georgia, serif`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText('8', x + 1.35 * sp, gLineY + 2.7 * sp);
    c.textAlign = 'left';
  }
}

function drawBass(c: Ctx, x: number, fLineY: number, sp: number, color: string) {
  BASS ??= new Path2D(F_CLEF);
  drawGlyph(c, BASS, x + 0.1 * sp, fLineY, sp, color);
}

/** Accidental glyph centred at (x, y); a courtesy one (`paren`) in parentheses. */
function drawAccidental(c: Ctx, x: number, y: number, sp: number, alt: number, color: string, paren = false) {
  c.save();
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineCap = 'butt';
  if (paren) {
    // Parentheses hugging the glyph (a flat's bowl sits right of its stem, low).
    const l = alt < 0 ? -0.62 - (alt === -2 ? 0.32 : 0) : alt === 0 ? -0.62 : -0.78;
    const r = alt < 0 ? 0.68 + (alt === -2 ? 0.32 : 0) : alt === 0 ? 0.62 : 0.78;
    const cy = alt < 0 ? y - 0.35 * sp : y;
    c.lineWidth = Math.max(1, 0.12 * sp);
    for (const [px, dir] of [[x + l * sp, 1], [x + r * sp, -1]] as const) {
      c.beginPath();
      c.moveTo(px + dir * 0.18 * sp, cy - 1.05 * sp);
      c.quadraticCurveTo(px - dir * 0.22 * sp, cy, px + dir * 0.18 * sp, cy + 1.05 * sp);
      c.stroke();
    }
  }
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

/** Outline of a notehead (drawn over the voice trace so the head keeps its shape). */
function strokeNotehead(c: Ctx, x: number, y: number, sp: number, base: number) {
  c.beginPath();
  if (base >= 4) c.ellipse(x, y, 0.78 * sp, 0.48 * sp, 0, 0, Math.PI * 2);
  else c.ellipse(x, y, 0.64 * sp, 0.45 * sp, -0.35, 0, Math.PI * 2);
  c.stroke();
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

// ---------------------------------------------------------------------------------------------
// Drawing

// INK (the engraver's colours) and STAFF_GRADE (blue when sung well, yellow when close, red when
// missed: the highway's dark "ok" blue all but disappears as a thin notehead) live in palette.ts,
// with their light-theme versions.

// Lyric and bar-number widths depend on the web fonts: lay out again once they have loaded.
let fontGen = 0;
try {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (fonts) {
    const bump = () => { fontGen++; };
    fonts.ready?.then(bump, () => {});
    fonts.addEventListener?.('loadingdone', bump);
  }
} catch { /* no font loading API */ }
/** Bumped when web fonts finish loading (text widths change: lay out again), and with the canvas
 *  theme or text size (palette.ts: colours of cached layers, sizes of the words). */
export const fontGeneration = () => `${fontGen}.${canvasGeneration()}`;

// ---------------------------------------------------------------------------------------------
// Per-system geometry (static for a layout; y relative to the middle staff line, down = +)

interface HeadG {
  i: number;
  x: number;
  dy: number;
  /** Steps from the middle line. */
  off: number;
  acc: number | null;
  /** The accidental is a courtesy one: drawn in parentheses. */
  paren: boolean;
  accX: number;
  tieStart: boolean;
  tieEnd: boolean;
}
interface EvG {
  ev: StaffEvent;
  m: LaidMeasure;
  x: number;
  /** Noteheads (empty for rests). */
  heads: HeadG[];
  up: boolean;
  stemX: number;
  /** Stem from the head at its root… */
  stemFrom: number;
  /** …to its free end (flags), or to the beam when the beam is drawn. */
  freeEnd: number;
  beamEnd: number | null;
  beam: BeamG | null;
  /** Ledger lines: flat [x0, x1, dy] triples. */
  ledgers: number[];
  dotX: number;
  /** x where the event ends (next onset, or the system's end). */
  xEnd: number;
  /** Highest ink of the event (dy), stems and beams included. */
  top: number;
}
interface BeamG {
  evs: EvG[];
  /** Flat [xa, ya, xb, yb] quads (dy); thickness `bt` towards `d`. */
  segs: number[];
  bt: number;
  d: number;
}
interface TieG {
  i: number;
  xa: number;
  xb: number;
  dy: number;
  side: number;
}
interface TupG {
  evs: EvG[];
  x: number;
  dy: number;
}
export interface SysDraw {
  evs: EvG[];
  beams: BeamG[];
  ties: TieG[];
  tups: TupG[];
}

export function buildSysDraw(sys: StaffSystem, layout: StaffLayout, notes: Part['notes']): SysDraw {
  const sp = layout.sp;
  const yOf = (st: number) => -((st - layout.mid) * sp) / 2;
  const headRx = 0.62 * sp;
  const stemW = Math.max(1, 0.12 * sp);
  const evs: EvG[] = [];
  const beams: BeamG[] = [];
  for (const m of sys.measures) {
    const first = evs.length;
    for (const le of m.events) {
      const e = le.ev;
      const g: EvG = {
        ev: e, m, x: le.x, heads: [], up: !!e.stemUp, stemX: 0, stemFrom: 0, freeEnd: 0, beamEnd: null, beam: null,
        ledgers: [], dotX: le.x + headRx, xEnd: xAtBeat(sys, e.start + e.dur), top: -2 * sp,
      };
      evs.push(g);
      if (e.kind !== 'note' || e.step == null) continue;
      const up = g.up;
      const raw = [
        { i: e.noteIndex!, step: e.step, acc: e.accidental ?? null, paren: !!e.courtesy, tieStart: !!e.tieStart, tieEnd: !!e.tieEnd },
        ...(e.chord ?? []).map((h) => ({ i: h.noteIndex, step: h.step, acc: h.accidental ?? null, paren: !!h.courtesy, tieStart: h.tieStart, tieEnd: h.tieEnd })),
      ].sort((a, b) => (up ? a.step - b.step : b.step - a.step));
      // From the stem's root: a head a step from the previous one goes on the other side of the stem.
      let prevStep = NaN;
      let prevDisp = false;
      let dispLeft = false;
      for (const h of raw) {
        const disp: boolean = Math.abs(h.step - prevStep) === 1 && !prevDisp;
        const x = disp ? le.x + (up ? 1 : -1) * (2 * headRx - stemW) : le.x;
        if (disp && !up) dispLeft = true;
        if (disp && up) g.dotX = Math.max(g.dotX, x + headRx);
        g.heads.push({ i: h.i, x, dy: yOf(h.step), off: h.step - layout.mid, acc: h.acc, paren: h.acc != null && h.paren, accX: 0, tieStart: h.tieStart, tieEnd: h.tieEnd });
        prevStep = h.step;
        prevDisp = disp;
      }
      // Accidentals: top to bottom, in columns so that close ones don't collide.
      const cols: number[][] = [];
      const withAcc = g.heads.filter((h) => h.acc != null).sort((a, b) => b.off - a.off);
      const colW = withAcc.some((h) => h.paren) ? 1.0 + PAREN_W : 1.0;
      for (const h of withAcc) {
        let col = 0;
        while (cols[col]?.some((o) => Math.abs(o - h.off) < 6)) col++;
        (cols[col] ??= []).push(h.off);
        h.accX = le.x - headRx - 0.75 * sp - (h.paren ? 0.5 * PAREN_W * sp : 0) - col * colW * sp - (dispLeft ? 2 * headRx - stemW : 0);
      }
      // Ledger lines (one per height, as wide as the heads on it).
      const led = new Map<number, [number, number]>();
      for (const h of g.heads) {
        if (Math.abs(h.off) < 6) continue;
        const dir = Math.sign(h.off);
        for (let o = 6; o <= Math.abs(h.off); o += 2) {
          const k = dir * o;
          const cur = led.get(k);
          const x0 = h.x - headRx - 0.4 * sp;
          const x1 = h.x + headRx + 0.4 * sp;
          led.set(k, cur ? [Math.min(cur[0], x0), Math.max(cur[1], x1)] : [x0, x1]);
        }
      }
      for (const [k, [x0, x1]] of led) g.ledgers.push(x0, x1, yOf(layout.mid + k));
      const dys = g.heads.map((h) => h.dy);
      const tip = up ? Math.min(...dys) : Math.max(...dys);
      g.stemFrom = up ? Math.max(...dys) : Math.min(...dys);
      g.stemX = up ? le.x + headRx - stemW / 2 : le.x - headRx + stemW / 2;
      const fl = beamCount(e.base);
      let end = tip + (up ? -1 : 1) * (3.3 + Math.max(0, fl - 1) * 0.6) * sp;
      if (up && end > 0) end = 0; // long stems reach the middle line
      if (!up && end < 0) end = 0;
      g.freeEnd = end;
      g.top = Math.min(...dys) - 0.5 * sp;
      if (e.base < 4 && up) g.top = Math.min(g.top, end - (e.base <= 0.5 ? 0.3 * sp : 0));
    }
    // Beams (they decide stem lengths).
    for (const grp of m.sm.beams) {
      const les = grp.map((i) => evs[first + i]);
      const up = les[0].up;
      const d = up ? -1 : 1;
      const sx = (g: EvG) => g.stemX;
      const hy = (g: EvG) => (up ? Math.min(...g.heads.map((h) => h.dy)) : Math.max(...g.heads.map((h) => h.dy)));
      const x0 = sx(les[0]);
      const x1 = sx(les[les.length - 1]);
      const maxBeams = Math.max(...les.map((g) => beamCount(g.ev.base)));
      const len = 3.3 + Math.max(0, maxBeams - 2) * 0.75;
      let y0 = hy(les[0]) + d * len * sp;
      let y1 = hy(les[les.length - 1]) + d * len * sp;
      const maxRise = Math.min(1.0 * sp, Math.abs(x1 - x0) * 0.25);
      if (Math.abs(y1 - y0) > maxRise) y1 = y0 + Math.sign(y1 - y0) * maxRise;
      const at = (x: number) => (x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
      // Every stem at least 2.6 spaces long, and the beam reaches at least the middle line.
      let fix = 0;
      for (const g of les) {
        const need = hy(g) + d * (2.6 + Math.max(0, maxBeams - 1) * 0.75) * sp;
        fix = Math.max(fix, up ? at(sx(g)) - need : need - at(sx(g)), up ? at(sx(g)) : -at(sx(g)));
      }
      y0 -= d * fix;
      y1 -= d * fix;
      const gap = 0.76 * sp;
      const segs: number[] = [];
      const seg = (xa: number, xb: number, level: number) => {
        const off = -d * level * gap;
        segs.push(xa, at(xa) + off, xb, at(xb) + off);
      };
      seg(x0, x1, 0);
      for (let lvl = 1; lvl < maxBeams; lvl++) {
        for (let q = 0; q < les.length; q++) {
          if (beamCount(les[q].ev.base) <= lvl) continue;
          const nextHas = q + 1 < les.length && beamCount(les[q + 1].ev.base) > lvl;
          const prevHas = q > 0 && beamCount(les[q - 1].ev.base) > lvl;
          if (nextHas) seg(sx(les[q]), sx(les[q + 1]), lvl);
          else if (!prevHas) {
            const stub = 1.1 * sp;
            if (q === 0) seg(sx(les[q]), sx(les[q]) + stub, lvl);
            else seg(sx(les[q]) - stub, sx(les[q]), lvl);
          }
        }
      }
      const bg: BeamG = { evs: les, segs, bt: 0.46 * sp, d };
      beams.push(bg);
      for (const g of les) {
        g.beam = bg;
        g.beamEnd = at(sx(g));
        if (up) g.top = Math.min(g.top, g.beamEnd - (maxBeams - 1) * gap - 0.2 * sp);
      }
    }
  }
  // Ties: to the next head of the same note, or over the system's edge when the note goes on. On a
  // scrolling line the next stretch carries on right after this one: the tie goes to its head there
  // (and that stretch draws no tie coming in).
  const ties: TieG[] = [];
  const seenNote = new Set<number>();
  const si = layout.systems.indexOf(sys);
  const nextSys = sys.cont ? layout.systems[si + 1] : undefined;
  const headInNext = (i: number): number | null => {
    for (const m of nextSys?.measures ?? []) for (const le of m.events) {
      if (le.ev.noteIndex === i || le.ev.chord?.some((c) => c.noteIndex === i)) return le.x;
    }
    return null;
  };
  for (let q = 0; q < evs.length; q++) {
    const g = evs[q];
    const n = g.heads.length;
    g.heads.forEach((h, hi) => {
      const side = n > 1 ? (h.dy <= (g.heads.reduce((a, x) => a + x.dy, 0) / n) ? -1 : 1) : g.up ? 1 : -1;
      const dy = h.dy + side * 0.65 * sp;
      const note = notes[h.i];
      if (h.tieEnd && !seenNote.has(h.i) && note && note.startBeat < sys.startBeat - 1e-6 && !(sys.cont && si > 0)) {
        ties.push({ i: h.i, xa: sys.prefixEnd - 0.8 * sp, xb: h.x - 0.75 * sp, dy, side });
      }
      seenNote.add(h.i);
      if (!h.tieStart) return;
      let to: HeadG | null = null;
      for (let r = q + 1; r < evs.length && !to; r++) to = evs[r].heads.find((x) => x.i === h.i) ?? null;
      if (to) ties.push({ i: h.i, xa: h.x + 0.75 * sp, xb: to.x - 0.75 * sp, dy, side });
      else if (note && note.startBeat + note.durBeats > sys.endBeat + 0.03) {
        const nx = headInNext(h.i);
        ties.push({ i: h.i, xa: h.x + 0.75 * sp, xb: nx != null ? nx - 0.75 * sp : sys.x1 + 0.6 * sp, dy, side });
      }
      void hi;
    });
  }
  // Triplet numbers.
  const tups: TupG[] = [];
  let mi = 0;
  for (const m of sys.measures) {
    const mEvs = evs.slice(mi, mi + m.events.length);
    mi += m.events.length;
    let grp: EvG[] = [];
    let sum = 0;
    const flush = () => {
      if (grp.length) {
        let yTop = -2.6 * sp;
        for (const g of grp) if (g.heads.length) yTop = Math.min(yTop, g.top - 0.4 * sp, Math.min(...g.heads.map((h) => h.dy)) - 0.8 * sp);
        tups.push({ evs: grp, x: (grp[0].x + grp[grp.length - 1].x) / 2 + 0.3 * sp, dy: yTop });
      }
      grp = [];
      sum = 0;
    };
    for (const g of mEvs) {
      if (!g.ev.tuplet) {
        flush();
        continue;
      }
      grp.push(g);
      sum += g.ev.dur;
      if (Math.abs(sum * 2 - Math.round(sum * 2)) < 0.02) flush();
    }
    flush();
  }
  return { evs, beams, ties, tups };
}

// ---------------------------------------------------------------------------------------------
// Layout cache

export interface Cached {
  key: string;
  layout: StaffLayout;
  above: number;
  below: number;
  band: number;
  lyricFont: string;
  lyricOff: number;
  /** Note names on (your own staff, levels 1–3): bottom line → their baseline, and their font. */
  nameOff?: number;
  nameFont?: string;
  sys: (SysDraw | undefined)[];
  textW: Map<string, number>;
}
let cache: Cached | null = null;

export function lyricFontFor(sp: number) {
  return `600 ${lyricPx(sp)}px "Bricolage Grotesque", system-ui, sans-serif`;
}

// (Phones: a staff space of 14 px gives 15 px note names and 18 px words; laptops' full score keeps
// its 10–11 px. Both grow with Settings → Display → Text size.)
// (a phone-sized staff, 12 px spaces and up, never has names under 15 px or words under 16 px)
const lyricPx = (sp: number) => fpx(sp >= 12 ? Math.max(16, Math.min(18, sp * 1.3)) : Math.max(11, Math.min(15, sp * 1.45)));
const namePx = (sp: number) => fpx(Math.max(sp >= 12 ? 15 : 10, Math.min(17, sp * 1.1)));

/** Note names: a little smaller than the words, in their own row between the staff and the words. */
export function nameFontFor(sp: number) {
  return `700 ${namePx(sp)}px "Bricolage Grotesque", system-ui, sans-serif`;
}

/** Are note names printed on your staff? (Levels 1–3; never while bars are hidden off book.) */
export const namesOn = (s: Pick<DrawState, 'showNames' | 'hide'>) => s.showNames && !s.hide;

/**
 * Rows under a staff whose lowest notehead is `noteBelow` spaces under the bottom line, at staff
 * space `sp`: the words' baseline at least `min` and `pad` under it (spaces under the bottom line)
 * and, with names on, the names' baseline in a row of their own above the words.
 */
export function textRows(noteBelow: number, sp: number, o: { min: number; pad: number; names: boolean; notation: NotationMode }): { nameOff?: number; lyricOff: number } {
  if (!o.names) return { lyricOff: Math.max(o.min, noteBelow + o.pad) };
  const n = namePx(sp) / sp;
  const l = lyricPx(sp) / sp;
  // Jianpu's octave dots sit above or below the digit: a little more room.
  const dots = o.notation === 'jianpu' ? 0.45 : 0;
  // The names' capitals clear the notes as the words' would; the words' capitals clear the names.
  const nameOff = Math.max(o.min - 0.1, noteBelow + o.pad - 0.1 + Math.max(0, 0.72 * n - 0.8)) + dots;
  return { nameOff, lyricOff: nameOff + Math.max(1.75, 0.72 * l + 0.6 * n) + dots };
}

/** Width measure for note names in `font` (cached per text). */
export function nameMeasure(c: Ctx, font: string, notation: NotationMode): NameW {
  const memo = new Map<string, number>();
  return (midi, key, written) => {
    const t = noteLabel(midi, notation, key, written).text;
    let w = memo.get(t);
    if (w == null) {
      const f = c.font;
      c.font = font;
      w = c.measureText(t).width;
      c.font = f;
      memo.set(t, w);
    }
    return w;
  };
}

/** A phone held upright (its canvas can be about square on a small phone under big text), or a tall view. */
export const uprightView = (W: number, H: number) => (W < 600 ? H > W * 0.6 : H > W * 1.15);

/** Turning pages on an upright phone keeps two systems down to this staff space (px). */
export const PAGE_MIN_SP = 9.5;

/** Staff-space size: a portrait phone gets two big systems (or two rows of the scrolling line), filling
 *  the height, so the sung line's height against the notes reads and the note names are 15 px+
 *  (a 390 px phone: 15 px spaces, a 60 px staff); landscape shows two smaller systems. */
export function staffSpace(W: number, H: number, perSys: number, scroll = true): { sp: number; floor: number } {
  if (uprightView(W, H)) {
    // Two systems when they fit at a 12 px staff space (turning pages: down to 9.5 px, so the next
    // line is always in view at a turn); a small phone with big text, scrolling: one, larger.
    const two = (H - 8) / (2 * perSys);
    const sp = Math.max(6.5, Math.min(16, W / 26, two >= (scroll ? 12 : PAGE_MIN_SP) ? two : scroll ? (H - 8) / perSys : PAGE_MIN_SP));
    return { sp, floor: Math.max(6.5, Math.min(sp, W / 34)) };
  }
  const sp = Math.max(6.5, Math.min(12, (H - 8) / (2 * perSys), W / 44));
  return { sp, floor: Math.max(6.5, Math.min(sp, W / 44)) };
}

function getLayout(c: Ctx, W: number, H: number, s: DrawState): Cached {
  const names = namesOn(s);
  const key = `${s.score.id}|${s.part.id}|${s.part.notes.length}|${s.from}|${s.to}|${W}|${H}|${fontGeneration()}|${names ? s.notation : '-'}|${s.notation}|${nameKeysSig(s.score)}|${s.scroll ? 'scroll' : 'page'}`;
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
    const st = spell(s.part.notes[i].midi, s.key, s.part.notes[i].spelling).step;
    lo = Math.min(lo, st);
    hi = Math.max(hi, st);
  }
  const above = Math.max(3.4, (hi - (mid + 4)) / 2 + 2.6);
  // Bottom line → note names' and lyrics' baselines (names: sized for a typical staff, then again
  // for the one chosen).
  const noteBelow = ((mid - 4) - lo) / 2;
  const rows = (q: number) => textRows(noteBelow, q, { min: 3.2, pad: 2.6, names, notation: s.notation });
  let { nameOff, lyricOff } = rows(12);
  let below = lyricOff + 1.3;
  let perSys = above + 4 + below;
  let { sp, floor } = staffSpace(W, H, perSys, !!s.scroll);
  let layout!: StaffLayout;
  const lay = () => {
    // Bigger staff, but a bar never squeezed much below its natural width (shrink until it fits).
    for (let guard = 0; ; guard++) {
      const nameW = names ? nameMeasure(c, nameFontFor(sp), s.notation) : undefined;
      c.font = lyricFontFor(sp);
      const textW = (t: string) => c.measureText(t).width;
      layout = layoutStaff(s.score, s.part, m0, m1, { width: W, sp, textW, nameW, maxBars: W < 520 ? 3 : W < 860 ? 4 : 6, ...(s.scroll ? { scroll: SCROLL_BARS } : {}) });
      // (a scrolling line is never squeezed: it is as long as it needs to be)
      if (s.scroll) break;
      let worst = Infinity;
      for (const sy of layout.systems) worst = Math.min(worst, sy.squeeze);
      if (worst >= 0.9 || sp <= floor + 1e-6 || guard >= 6) break;
      sp = Math.max(floor, sp * 0.92);
    }
    if (names) {
      ({ nameOff, lyricOff } = rows(sp));
      below = lyricOff + 1.3;
      perSys = above + 4 + below;
    }
  };
  lay();
  // Turning pages upright: two whole systems (the rows were sized for a typical staff; once more if
  // the names and words at this size make a system too tall for two).
  if (!s.scroll && uprightView(W, H) && 2 * perSys * sp > H - 8 && sp > PAGE_MIN_SP + 1e-6) {
    sp = Math.max(PAGE_MIN_SP, ((H - 8) / (2 * perSys)) * 0.99);
    floor = Math.min(floor, sp);
    lay();
  }
  cache = {
    key, layout, above, below, band: perSys * sp, lyricFont: lyricFontFor(sp), lyricOff,
    nameOff, nameFont: names ? nameFontFor(sp) : undefined,
    sys: [], textW: new Map(),
  };
  return cache;
}

function sysDraw(L: Cached, j: number, s: DrawState): SysDraw {
  return (L.sys[j] ??= buildSysDraw(L.layout.systems[j], L.layout, s.part.notes));
}

export interface SysGeo {
  j: number;
  sys: StaffSystem;
  sd: SysDraw;
  top: number; // top staff line
  mid: number; // middle line y
}

/** Note being sung at a beat on a system (null in rests). */
export function eventAt(sys: StaffSystem, beat: number): StaffEvent | null {
  for (const m of sys.measures) {
    if (beat < m.sm.startBeat - 1e-6 || beat >= m.sm.endBeat - 1e-6) continue;
    let hit: StaffEvent | null = null;
    for (const le of m.events) if (le.ev.start <= beat + 1e-6) hit = le.ev;
    return hit && hit.kind === 'note' && beat < hit.start + hit.dur + 1e-6 ? hit : null;
  }
  return null;
}

/** The head of a chord closest to a sung pitch (octaves folded), as a sungStep target. */
function nearestHead(ev: StaffEvent, midi: number): { midi: number; step: number; alt: number; noteIndex: number } {
  const fold = (d: number) => (Math.abs(d) > 7 ? d - 12 * Math.round(d / 12) : d);
  let best = { midi: ev.midi!, step: ev.step!, alt: ev.alt!, noteIndex: ev.noteIndex! };
  if (!ev.chord) return best;
  let bd = Math.abs(fold(midi - ev.midi!));
  for (const h of ev.chord) {
    const d = Math.abs(fold(midi - h.midi));
    if (d < bd) {
      bd = d;
      best = { midi: h.midi, step: h.step, alt: h.alt, noteIndex: h.noteIndex };
    }
  }
  return best;
}

export interface Vis {
  vis: (i: number) => 'show' | 'letters' | 'none';
  isPast: (i: number) => boolean;
  isNow: (i: number) => boolean;
  inRange: (i: number) => boolean;
  /** Another voice in the full score: drawn plainly in these colours (no grades, no glow). */
  plain?: { note: string; lyric: string };
  /** Draw only the notes (an overlay on a staff already drawn: no rests, triplet numbers or words). */
  notesOnly?: boolean;
}

/** Opacity of a note: notes outside your section are faded (not in another voice's plain staff). */
const alphaOf = (v: Vis, i: number) => (v.plain || v.inRange(i) ? 1 : 0.35);

/** Bars per stretch of a scrolling line (only the stretches in view are drawn). */
const SCROLL_BARS = 2;
/** Where the playhead stays on a scrolling line: this far across the music (after the pinned clef). */
export const SCROLL_ANCHOR = 0.33;

/**
 * Horizontal offset of a scrolling line at beat `beat`: the playhead stays at SCROLL_ANCHOR of the
 * view while the music moves left; at the start and at the end the line stays put and the playhead moves.
 */
export function scrollOffset(systems: StaffSystem[], beat: number, W: number, sp: number, at?: { tempos: TempoEvent[]; pos: number }): { off: number; px: number; k: number } {
  const k = systemAt(systems, beat);
  const first = systems[0];
  // (before the first bar, e.g. the count-in: just right of the pinned clef, where it can be seen)
  const xOf = (b: number) => (b < first.startBeat ? first.prefixEnd + 0.5 * sp : xAtBeat(systems[systemAt(systems, b)], b));
  const px = xOf(beat);
  // The line moves at the speed of the music averaged over about a second (notes aren't spaced in
  // proportion to time: following the playhead exactly, it would crawl through long notes and rush
  // through quick ones). The playhead drifts a little around its place instead.
  let xs = px;
  if (at) {
    let acc = 0;
    for (let i = 0; i < SMOOTH_N; i++) acc += xOf(timeToBeat(at.tempos, at.pos + ((i + 0.5) / SMOOTH_N - 0.5) * SMOOTH_SEC));
    xs = acc / SMOOTH_N;
  }
  const pinned = first.prefixEnd;
  const anchor = pinned + (W - pinned) * SCROLL_ANCHOR;
  const end = systems[systems.length - 1].x1;
  const maxOff = Math.max(0, end + 12 - W);
  return { off: Math.max(0, Math.min(maxOff, xs - anchor)), px, k };
}
/** Window (score seconds) and samples of the scroll speed's averaging. */
const SMOOTH_SEC = 1.2;
const SMOOTH_N = 16;

/** The pinned start of a scrolling line: staff lines, clef and the key (and time) in force at `beat`. */
export function drawPinned(c: Ctx, g: Pick<SysGeo, 'top' | 'mid'>, layout: Pick<StaffLayout, 'sp' | 'clef'>, first: StaffSystem, key: KeySig, s: Pick<DrawState, 'score' | 'notation'>, showTime: boolean, H: number, y0 = 0) {
  const sp = layout.sp;
  const w = first.prefixEnd;
  c.fillStyle = COLORS.bg;
  c.fillRect(0, y0, w, H - y0);
  // Soft edge where the music slides under the clef.
  const grad = c.createLinearGradient(w, 0, w + 1.6 * sp, 0);
  grad.addColorStop(0, COLORS.bg);
  grad.addColorStop(1, COLORS.bgClear);
  c.fillStyle = grad;
  c.fillRect(w, y0, 1.6 * sp, H - y0);
  const pin: StaffSystem = {
    ...first, cont: false, measures: [], x1: w, key, cancelFifths: 0,
    timeSig: showTime ? (first.measures[0]?.sm.timeSig ?? null) : null,
  };
  drawStaffFrame(c, { sys: pin, top: g.top, mid: g.mid }, layout, s, { barlines: false, numbers: false });
}

export function drawStaff2D(c: Ctx, W: number, H: number, s: DrawState) {
  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, W, H);
  if (s.scroll) { drawStaffScroll(c, W, H, s); return; }
  const L = getLayout(c, W, H, s);
  const { layout } = L;
  const sp = layout.sp;
  const systems = layout.systems;
  if (!systems.length) return;
  const tempos = s.score.tempos;
  const beat = timeToBeat(tempos, s.pos);
  const k = systemAt(systems, beat);
  // Only systems that fit whole (the lowest one's lyrics are never cut off), spread over the height.
  const fit = Math.max(1, Math.floor((H - 8) / L.band));
  const band = L.band + (fit > 1 ? Math.min(0.3 * L.band, (H - 8 - fit * L.band) / fit) : 0);
  const pad = Math.max(4, Math.min(18, (H - fit * band) / 2 + (fit > 1 ? (band - L.band) / 2 : 0)));
  // Turning to the next system: slide up over ~0.35 s (real time).
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

  const geos: SysGeo[] = [];
  // The previous system only while it slides out of view.
  for (let j = k - (shift > 0.5 ? 1 : 0); j < k + fit; j++) {
    if (j < 0 || j >= systems.length) continue;
    const top = pad + (j - k) * band + shift + L.above * sp;
    if (top - L.above * sp > H || top + (4 + L.below) * sp < 0) continue;
    geos.push({ j, sys: systems[j], sd: sysDraw(L, j, s), top, mid: top + 2 * sp });
  }

  for (const g of geos) drawSystem(c, g, layout, L, s, v);

  // Pitch trace, on every visible system up to now; then the outlines of the notes it crosses.
  updateTrace(s, L);
  for (const g of geos) drawTrace(c, g, s, L, beat);
  for (const g of geos) drawOutlines(c, g, s, v, sp);

  // Playhead on the current system.
  const cur = geos.find((g) => g.j === k);
  if (cur) {
    const sys = cur.sys;
    const px = beat < sys.startBeat ? sys.prefixEnd - 0.2 * sp : xAtBeat(sys, beat);
    const yTop = cur.top - Math.max(1.5, L.above - 1.2) * sp;
    const yBot = cur.top + (4 + L.lyricOff - 1.4) * sp;
    c.fillStyle = COLORS.playhead;
    c.fillRect(Math.round(px) - 1, yTop, 2, yBot - yTop);
    c.beginPath();
    c.moveTo(px - 0.55 * sp, yTop - 0.6 * sp);
    c.lineTo(px + 0.55 * sp, yTop - 0.6 * sp);
    c.lineTo(px, yTop + 0.1 * sp);
    c.closePath();
    c.fill();
    drawCountdown(c, cur, s, L, px, yTop);
    drawBubble(c, cur, s, L, px);
  }
}

/** The single staff as one line scrolling smoothly to the left past a fixed playhead. */
function drawStaffScroll(c: Ctx, W: number, H: number, s: DrawState) {
  const L = getLayout(c, W, H, s);
  const { layout } = L;
  const sp = layout.sp;
  const systems = layout.systems;
  if (!systems.length) return;
  const beat = timeToBeat(s.score.tempos, s.pos);
  const { off, px, k } = scrollOffset(systems, beat, W, sp, { tempos: s.score.tempos, pos: s.pos });
  // A tall phone: the line goes on in a second row underneath, what comes after the right edge
  // (both rows glide together), so the next bars are in view at a staff size that reads.
  const rows = uprightView(W, H) && H - 8 >= 2 * L.band ? 2 : 1;
  const gap = rows === 2 ? Math.min(0.3 * L.band, (H - 8 - 2 * L.band) / 3) : 0;
  const block = rows * L.band + gap;
  const top = Math.round(Math.max(4, (H - block) / 2) + L.above * sp);

  const notes = s.part.notes;
  const [ra, rb] = s.range ?? [0, -1];
  const inRange = (i: number) => s.range != null && i >= ra && i <= rb;
  const isPast = (i: number) => notes[i].start + notes[i].dur <= s.pos;
  const isNow = (i: number) => inRange(i) && notes[i].start <= s.pos && s.pos < notes[i].start + notes[i].dur;
  const vis = (i: number): 'show' | 'letters' | 'none' => ((isPast(i) && inRange(i)) || !s.hide ? 'show' : s.hide(i));
  const v: Vis = { vis, isPast, isNow, inRange };

  const pinned = systems[0].prefixEnd;
  const geos: SysGeo[] = [];
  for (let j = 0; j < systems.length; j++) {
    const sy = systems[j];
    if (sy.x1 - off < pinned - 2 * sp || sy.prefixEnd - off > W + 2 * sp) continue;
    geos.push({ j, sys: sy, sd: sysDraw(L, j, s), top, mid: top + 2 * sp });
  }
  c.save();
  c.translate(-off, 0);
  for (const g of geos) drawSystem(c, g, layout, L, s, v);
  updateTrace(s, L);
  for (const g of geos) drawTrace(c, g, s, L, beat);
  for (const g of geos) drawOutlines(c, g, s, v, sp);
  const cur = geos.find((g) => g.j === k) ?? geos[0];
  const yTop = top - Math.max(1.5, L.above - 1.2) * sp;
  const yBot = top + (4 + L.lyricOff - 1.4) * sp;
  c.fillStyle = COLORS.playhead;
  c.fillRect(Math.round(px) - 1, yTop, 2, yBot - yTop);
  c.beginPath();
  c.moveTo(px - 0.55 * sp, yTop - 0.6 * sp);
  c.lineTo(px + 0.55 * sp, yTop - 0.6 * sp);
  c.lineTo(px, yTop + 0.1 * sp);
  c.closePath();
  c.fill();
  if (cur) {
    drawCountdown(c, cur, s, L, px, yTop, pinned + off + 0.5 * sp);
    drawBubble(c, cur, s, L, px, off + W - 0.5 * sp);
  }
  c.restore();
  let split = H;
  if (rows === 2) {
    // Row 2: the line from row 1's right edge on, notes only (no voice, no playhead).
    const off2 = off + W - pinned;
    const top2 = top + L.band + gap;
    split = Math.round(top2 - L.above * sp - gap / 2);
    let key2: KeySig | null = null;
    c.save();
    c.translate(-off2, 0);
    for (let j = 0; j < systems.length; j++) {
      const sy = systems[j];
      if (sy.x1 - off2 < pinned - 2 * sp || sy.prefixEnd - off2 > W + 2 * sp) continue;
      // (the key in force at row 2's left edge: the bar there, not the stretch's start)
      if (!key2 && sy.x1 - off2 > pinned) {
        const m = sy.measures.find((q) => q.x1 - off2 > pinned);
        key2 = m ? keyAtBeat(s.score, m.sm.startBeat) : sy.key;
      }
      drawSystem(c, { j, sys: sy, sd: sysDraw(L, j, s), top: top2, mid: top2 + 2 * sp }, layout, L, s, v);
    }
    c.restore();
    if (key2) drawPinned(c, { top: top2, mid: top2 + 2 * sp }, layout, systems[0], key2, s, false, H, split);
    else {
      // (past the end of the music: nothing in row 2)
      c.fillStyle = COLORS.bg;
      c.fillRect(0, split, W, H - split);
    }
  }
  drawPinned(c, { top, mid: top + 2 * sp }, layout, systems[0], keyAtBeat(s.score, beat), s, off < 1, split);
  void k;
}

function noteColor(s: DrawState, i: number, v: Vis): string {
  if (v.plain) return v.plain.note;
  if (!v.inRange(i)) return INK.note;
  if (v.isPast(i)) {
    const g = s.live?.noteGrade(i);
    return g ? STAFF_GRADE[g] : INK.note; // not graded yet (the voice arrives a moment later)
  }
  if (v.isNow(i)) return COLORS.target;
  return INK.note;
}

function drawSystem(c: Ctx, g: SysGeo, layout: StaffLayout, L: Cached, s: DrawState, v: Vis) {
  drawStaffFrame(c, g, layout, s, { barlines: true, numbers: true });
  drawStaffNotes(c, g, layout, L, s, v);
}

/** Staff lines, clef, key and time signatures (also changes inside the system), barlines, bar numbers. */
export function drawStaffFrame(c: Ctx, g: Pick<SysGeo, 'sys' | 'top' | 'mid'>, layout: Pick<StaffLayout, 'sp' | 'clef'>, s: Pick<DrawState, 'score' | 'notation'>,
  o: { barlines: boolean; numbers: boolean }) {
  const { sys, top, mid } = g;
  const sp = layout.sp;
  const lw = Math.max(1, Math.round(sp * 0.1));
  // Staff lines (a stretch of a scrolling line: from its first bar on, the clef is pinned elsewhere).
  c.fillStyle = INK.staff;
  const x0 = sys.cont ? sys.prefixEnd : sys.clefX - 0.3 * sp;
  for (let l = 0; l < 5; l++) c.fillRect(x0, Math.round(top + l * sp), sys.x1 - x0, lw);
  // Clef, key (cancelling the old one when it changes here), time.
  if (!sys.cont) {
    if (layout.clef === 'bass') drawBass(c, sys.clefX, top + sp, sp, INK.clef);
    else drawTreble(c, sys.clefX, top + 3 * sp, sp, INK.clef, layout.clef === 'treble8');
    drawKeySig(c, sys.keyX, mid, sp, sys.key.fifths, layout.clef, INK.clef, sys.cancelFifths);
    if (sys.timeSig) drawTimeSig(c, sys.timeX, mid, sp, sys.timeSig, INK.clef);
  }

  // Barlines + numbers.
  const numFont = `600 ${fpx(Math.max(10, sp * 0.95))}px "JetBrains Mono", monospace`;
  for (let mi = 0; mi < sys.measures.length; mi++) {
    const m = sys.measures[mi];
    const last = mi === sys.measures.length - 1;
    if (o.barlines) drawBarline(c, m, last, s.score.measures.length, top, 4 * sp + lw, sp, lw);
    // (Set every bar: a time signature drawn in the bar before changes the font.)
    c.font = numFont;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.fillStyle = INK.barNo;
    const nx = sys.cont ? m.x0 + 0.25 * sp : mi === 0 ? sys.clefX : m.x0 - 0.2 * sp;
    if (o.numbers && m.sm.number !== '0') c.fillText(m.sm.number, nx, top - 1.75 * sp);
    // Where the names' do is (first bar shown) or moves to: "Do = G" next to the bar number.
    const hint = o.numbers && m.sm.nameChange && movesWithKey(s.notation) ? keyHint(s.notation, m.sm.nameKey) : null;
    if (hint) {
      const hx = nx + (m.sm.number !== '0' ? c.measureText(m.sm.number).width + 0.5 * sp : 0);
      const fs = fpx(Math.max(11, sp * 1.05));
      c.font = `700 ${fs}px system-ui, sans-serif`;
      // (on a backdrop: high notes' stems and beams can reach up here)
      c.fillStyle = COLORS.bg;
      c.globalAlpha = 0.85;
      c.fillRect(hx - 2, top - 1.75 * sp - fs * 0.85, c.measureText(hint).width + 4, fs * 1.1);
      c.globalAlpha = 1;
      c.fillStyle = COLORS.text;
      c.fillText(hint, hx, top - 1.75 * sp);
    }
    if (m.changeX != null) {
      let cx = m.changeX;
      if (m.sm.keyChange) {
        drawKeySig(c, cx, mid, sp, m.sm.key.fifths, layout.clef, INK.clef, m.sm.prevFifths);
        cx += keyChangeW(m.sm.key.fifths, m.sm.prevFifths) * sp;
      }
      if (m.sm.timeChange) drawTimeSig(c, cx, mid, sp, m.sm.timeSig, INK.clef);
    }
  }
}

/** Barline at the end of bar `m` from y `top`, `h` long (double / final where the score has them). */
export function drawBarline(c: Ctx, m: LaidMeasure, last: boolean, nMeasures: number, top: number, h: number, sp: number, lw: number) {
  c.fillStyle = INK.bar;
  const bx = Math.round(m.x1) - 1;
  if (m.sm.doubleBar) {
    const final = last && m.sm.index === nMeasures - 1;
    c.fillRect(bx - (final ? 0.75 : 0.5) * sp, top, lw, h);
    c.fillRect(bx - (final ? 0.35 * sp : 0), top, final ? 0.4 * sp : lw, h);
  } else c.fillRect(bx, top, lw + 0.5, h);
}

/** Notes, rests, beams, ties, triplets and lyrics of one staff on one system. */
export function drawStaffNotes(c: Ctx, g: SysGeo, layout: StaffLayout, L: Cached, s: DrawState, v: Vis) {
  const { sd, mid } = g;
  const sp = layout.sp;
  const lw = Math.max(1, Math.round(sp * 0.1));
  const headRx = 0.62 * sp;
  const stemW = Math.max(1, 0.12 * sp);
  const shown = (e: StaffEvent) => v.vis(e.noteIndex!) === 'show';
  const beamShown = (b: BeamG) => b.evs.every((x) => shown(x.ev));
  // Bars where some note is still hidden: rests hidden too (off book: empty bars).
  let hiddenBars: number[] | null = null;
  if (s.hide) {
    for (const e of sd.evs) {
      if (e.ev.noteIndex != null && !shown(e.ev) && !(hiddenBars ??= []).includes(e.m.sm.index)) hiddenBars.push(e.m.sm.index);
    }
  }

  // Beams.
  for (const b of sd.beams) {
    if (!beamShown(b)) continue; // falls back to flags
    let col = noteColor(s, b.evs[0].ev.noteIndex!, v);
    for (const e of b.evs) if (noteColor(s, e.ev.noteIndex!, v) !== col) { col = INK.note; break; }
    c.fillStyle = col;
    c.globalAlpha = b.evs.every((e) => alphaOf(v, e.ev.noteIndex!) < 1) ? 0.35 : 1;
    for (let q = 0; q < b.segs.length; q += 4) {
      const xa = b.segs[q], ya = mid + b.segs[q + 1], xb = b.segs[q + 2], yb = mid + b.segs[q + 3];
      c.beginPath();
      c.moveTo(xa, ya);
      c.lineTo(xb, yb);
      c.lineTo(xb, yb + b.d * b.bt);
      c.lineTo(xa, ya + b.d * b.bt);
      c.closePath();
      c.fill();
    }
    c.globalAlpha = 1;
  }

  for (const eg of sd.evs) {
    const e = eg.ev;
    const x = eg.x;
    if (e.kind === 'rest') {
      if (v.notesOnly) continue;
      const pastRest = beatToTime(s.score.tempos, e.start + e.dur) <= s.pos;
      if (hiddenBars?.includes(eg.m.sm.index) && !pastRest) continue;
      c.fillStyle = INK.rest;
      c.strokeStyle = INK.rest;
      drawRest(c, x, mid, sp, e.base, e.dots);
      continue;
    }
    if (!shown(e)) continue;
    const main = e.noteIndex!;
    const col = noteColor(s, main, v);
    // A faint guide at the note's exact height while and after it is sung: the voice line just
    // under it is flat, just over it sharp.
    for (const h of eg.heads) {
      if (h.i !== main || !v.inRange(h.i) || s.part.notes[h.i].start > s.pos) continue;
      c.fillStyle = col;
      c.globalAlpha = 0.6;
      c.fillRect(h.x + headRx, Math.round(mid + h.dy) - 0.5, Math.max(0, eg.xEnd - h.x - headRx - 0.3 * sp), 1);
    }
    c.globalAlpha = alphaOf(v, main);
    // Ledger lines.
    c.fillStyle = INK.staff;
    for (let q = 0; q < eg.ledgers.length; q += 3) c.fillRect(eg.ledgers[q], Math.round(mid + eg.ledgers[q + 2]), eg.ledgers[q + 1] - eg.ledgers[q], lw);
    for (const h of eg.heads) {
      const hc = h.i === main ? col : noteColor(s, h.i, v);
      const y = mid + h.dy;
      c.fillStyle = hc;
      if (v.isNow(h.i)) {
        c.shadowColor = COLORS.target;
        c.shadowBlur = Math.max(12, sp * 1.8);
        drawNotehead(c, h.x, y, sp, e.base);
        c.shadowBlur = 0;
      } else drawNotehead(c, h.x, y, sp, e.base);
      if (h.acc != null) drawAccidental(c, h.accX, y, sp, h.acc, hc, h.paren);
      // Dots (moved into the space when the note sits on a line).
      for (let d = 0; d < e.dots; d++) {
        const dy = mod(h.off, 2) === 0 ? -0.5 * sp : 0;
        c.beginPath();
        c.arc(eg.dotX + (0.45 + d * 0.45) * sp, y + dy, 0.16 * sp, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Stem + flags.
    if (e.base < 4) {
      c.fillStyle = col;
      const beamed = !!eg.beam && beamShown(eg.beam);
      const ey = mid + (beamed ? eg.beamEnd! : eg.freeEnd);
      const y0 = mid + eg.stemFrom;
      c.fillRect(eg.stemX - stemW / 2, Math.min(y0, ey), stemW, Math.abs(ey - y0));
      if (!beamed && e.base <= 0.5) drawFlags(c, eg.stemX, ey, sp, beamCount(e.base), eg.up);
    }
    c.globalAlpha = 1;
  }

  // Ties.
  for (const t of sd.ties) {
    if (v.vis(t.i) !== 'show') continue;
    c.fillStyle = noteColor(s, t.i, v);
    c.globalAlpha = alphaOf(v, t.i);
    drawTie(c, t.xa, t.xb, mid + t.dy, t.side, sp);
  }
  c.globalAlpha = 1;

  // Triplet numbers.
  if (v.notesOnly) return;
  if (sd.tups.length) {
    c.font = `italic 700 ${Math.round(sp * 1.25)}px Georgia, serif`;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillStyle = INK.clef;
    for (const t of sd.tups) if (t.evs.every((e) => e.ev.kind === 'rest' || shown(e.ev))) c.fillText('3', t.x, mid + t.dy);
    c.textAlign = 'left';
  }

  // Level 1 is sung on "doo": the words stay for orientation, dimmed.
  if (s.dimLyrics && !v.plain) {
    c.save();
    c.globalAlpha *= DIM_LYRICS;
    drawLyrics(c, g, s, L, v);
    c.restore();
  } else drawLyrics(c, g, s, L, v);
  if (L.nameOff != null && L.nameFont && !v.plain) drawNames(c, g, s, L, v);
}

/** Note names (in your notation) in a row under your staff, one under each note it starts. */
function drawNames(c: Ctx, g: SysGeo, s: DrawState, L: Cached, v: Vis) {
  const sp = L.layout.sp;
  const by = g.top + (4 + L.nameOff!) * sp;
  c.font = L.nameFont!;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'center';
  const notes = s.part.notes;
  for (const eg of g.sd.evs) {
    const e = eg.ev;
    if (e.kind !== 'note' || !e.first || e.midi == null) continue;
    const i = e.noteIndex!;
    if (v.vis(i) !== 'show') continue;
    const lab = noteLabel(notes[i].midi, s.notation, eg.m.sm.nameKey, eventSpelling(e));
    const now = v.isNow(i);
    c.fillStyle = !v.inRange(i) || (v.isPast(i) && !now) ? INK.lyricPast : now ? COLORS.target : COLORS.label;
    c.globalAlpha = alphaOf(v, i);
    c.fillText(lab.text, eg.x, by);
    const dots = lab.dotsAbove || lab.dotsBelow;
    if (dots) {
      const r = Math.max(1.2, 0.13 * sp);
      for (let d = 0; d < dots; d++) {
        const dy = lab.dotsAbove ? by - 1.25 * sp - d * 0.4 * sp : by + 0.45 * sp + d * 0.4 * sp;
        c.beginPath();
        c.arc(eg.x, dy, r, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  c.globalAlpha = 1;
  c.textAlign = 'left';
}

/** Outlines over the noteheads the voice trace runs through (sung or being sung). */
export function drawOutlines(c: Ctx, g: SysGeo, s: DrawState, v: Vis, sp: number) {
  c.lineWidth = Math.max(1.3, 0.13 * sp);
  for (const eg of g.sd.evs) {
    if (!eg.heads.length || v.vis(eg.ev.noteIndex!) !== 'show') continue;
    for (const h of eg.heads) {
      if (!v.inRange(h.i) || s.part.notes[h.i].start > s.pos) continue;
      c.strokeStyle = noteColor(s, h.i, v);
      strokeNotehead(c, h.x, g.mid + h.dy, sp, eg.ev.base);
    }
  }
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

function textWidth(c: Ctx, L: Cached, font: string, t: string): number {
  const k = font + '|' + t;
  let w = L.textW.get(k);
  if (w == null) {
    w = c.measureText(t).width;
    L.textW.set(k, w);
  }
  return w;
}

/** Opacity of the words while they are only for orientation (level 1, sung on "doo"). */
export const DIM_LYRICS = 0.45;

function drawLyrics(c: Ctx, g: SysGeo, s: DrawState, L: Cached, v: Vis) {
  const sp = L.layout.sp;
  const by = g.top + (4 + L.lyricOff) * sp;
  const evs = g.sd.evs;
  c.font = L.lyricFont;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'center';
  const notes = s.part.notes;
  const hy = by - 0.45 * sp;
  const thick = Math.max(1, 0.14 * sp);
  for (let q = 0; q < evs.length; q++) {
    const e = evs[q].ev;
    if (e.kind !== 'note' || !e.first) continue;
    const i = e.noteIndex!;
    const n = notes[i];
    const visib = v.vis(i);
    if (visib === 'none') continue;
    const x = evs[q].x;
    if (visib === 'letters') {
      const text = wordInitial(n);
      if (!text) continue;
      c.save();
      c.font = `800 ${Math.round(sp * 1.6)}px "Bricolage Grotesque", sans-serif`;
      c.fillStyle = v.isNow(i) ? COLORS.target : COLORS.targetText;
      c.fillText(text, x, by);
      c.restore();
      continue;
    }
    const text = n.lyric ?? '';
    if (!text) continue;
    const now = v.isNow(i);
    c.fillStyle = v.plain ? v.plain.lyric : !v.inRange(i) ? INK.lyricPast : now ? COLORS.targetText : v.isPast(i) ? INK.lyricPast : INK.lyric;
    let w: number;
    if (now) {
      const f = L.lyricFont.replace(/^600/, '800');
      c.font = f;
      c.fillText(text, x, by);
      w = textWidth(c, L, f, text);
      c.font = L.lyricFont;
    } else {
      c.fillText(text, x, by);
      w = textWidth(c, L, L.lyricFont, text);
    }
    const x1 = x + w / 2;
    // Hyphen to the next syllable of the word (only when that syllable is shown); extender line
    // under a melisma (only over notes that are shown).
    c.fillStyle = INK.lyricPast;
    if (n.syllabic === 'begin' || n.syllabic === 'middle') {
      let nx: EvG | null = null;
      for (let r = q + 1; r < evs.length && !nx; r++) {
        const re = evs[r].ev;
        if (re.kind === 'note' && re.first && notes[re.noteIndex!].lyric) nx = evs[r];
      }
      if (nx && v.vis(nx.ev.noteIndex!) !== 'show') continue;
      const xb = nx ? nx.x - textWidth(c, L, L.lyricFont, notes[nx.ev.noteIndex!].lyric!) / 2 : Math.min(g.sys.x1, x1 + 2.2 * sp);
      if (xb - x1 > 0.8 * sp) {
        const hw = Math.min(0.6 * sp, (xb - x1) * 0.4);
        c.fillRect((x1 + xb) / 2 - hw / 2, hy, hw, thick);
      }
    } else {
      let lastX = -1;
      for (let r = q + 1; r < evs.length; r++) {
        const re = evs[r].ev;
        if (re.kind !== 'note') break;
        if (re.first && notes[re.noteIndex!].lyric) break;
        if (v.vis(re.noteIndex!) !== 'show') break;
        lastX = evs[r].x;
      }
      if (lastX > x1 + 0.5 * sp) c.fillRect(x1 + 0.2 * sp, by, lastX + 0.6 * sp - x1 - 0.2 * sp, Math.max(1, 0.1 * sp));
    }
  }
  c.textAlign = 'left';
}

// ---------------------------------------------------------------------------------------------
// Voice trace: each sample's position and colour are worked out once (and again only while its
// note is still being sung), then each frame just strokes the cached points.

const TR_HIDE = -1;
const TR_REST = 0;
const TR_IN = 1;
const TR_OUT = 2;
/** Half-width (s) of the trace's smoothing window. */
const SMOOTH = 0.09;

interface TraceCache {
  samples: PitchSample[] | null;
  key: string;
  /** Samples [0, done) are final. */
  done: number;
  sys: number[];
  x: number[];
  dy: number[];
  col: number[];
  ev: (StaffEvent | null)[];
}
const tr: TraceCache = { samples: null, key: '', done: 0, sys: [], x: [], dy: [], col: [], ev: [] };

export function updateTrace(s: DrawState, L: Cached) {
  const smp = s.samples;
  const lkey = `${L.key}|${s.tolerance}|${s.range?.join(',')}`;
  if (tr.samples !== smp || tr.key !== lkey || smp.length < tr.done) {
    tr.samples = smp;
    tr.key = lkey;
    tr.done = 0;
    tr.sys.length = tr.x.length = tr.dy.length = tr.col.length = tr.ev.length = 0;
  }
  const { layout } = L;
  const sp = layout.sp;
  const systems = layout.systems;
  const tempos = s.score.tempos;
  const notes = s.part.notes;
  const yMin = -(2 + L.above - 0.6) * sp;
  const yMax = (2 + (L.nameOff ?? L.lyricOff) - 1.5) * sp;
  const dyOf = (st: number) => -((st - layout.mid) * sp) / 2;
  let allFinal = true;
  for (let q = tr.done; q < smp.length; q++) {
    const sm = smp[q];
    let sys = 0;
    let x = 0;
    let dy = 0;
    let col = TR_HIDE;
    let ev: StaffEvent | null = null;
    if (sm.midi != null) {
      const b = timeToBeat(tempos, sm.time);
      sys = systemAt(systems, b);
      const sy = systems[sys];
      if (b <= sy.endBeat + 1e-6) {
        ev = eventAt(sy, b);
        const hidden = !!ev && ev.noteIndex != null && !!s.hide && s.hide(ev.noteIndex) !== 'show'
          && notes[ev.noteIndex].start + notes[ev.noteIndex].dur > s.pos;
        // Smoothed over about one vibrato cycle (±90 ms, no jumps to other notes): the line shows
        // where the voice is centred, so a few cents flat or sharp reads instead of a scribble.
        let sum = 0;
        let n = 0;
        for (let r = q; r >= 0 && sm.time - smp[r].time <= SMOOTH; r--) {
          const mm = smp[r].midi;
          if (mm != null && Math.abs(mm - sm.midi) < 0.8) { sum += mm; n++; }
        }
        for (let r = q + 1; r < smp.length && smp[r].time - sm.time <= SMOOTH; r++) {
          const mm = smp[r].midi;
          if (mm != null && Math.abs(mm - sm.midi) < 0.8) { sum += mm; n++; }
        }
        const m = sum / n;
        const key = keyAtBeat(s.score, b);
        x = xAtBeat(sy, b);
        if (ev && !hidden) {
          const tgt = nearestHead(ev, m);
          dy = Math.max(yMin, Math.min(yMax, dyOf(sungStep(m, key, tgt))));
          // In tune or not is judged on ~one vibrato cycle (like the scoring), so vibrato centred
          // on the note doesn't stripe the line.
          let ws = 0;
          let wn = 0;
          for (let r = q; r >= 0 && sm.time - smp[r].time <= 0.18; r--) {
            const mm = smp[r].midi;
            if (mm == null || (r < q && tr.ev[r] !== ev)) continue;
            ws += mm;
            wn++;
          }
          let cents = (ws / wn - tgt.midi) * 100;
          if (Math.abs(cents) > 700) cents = ((cents % 1200) + 1800) % 1200 - 600;
          col = Math.abs(cents) <= s.tolerance ? TR_IN : TR_OUT;
        } else {
          // Rests (or a hidden note): your voice at its staff height, folded by octaves onto the
          // staff when it would be off it (a tenor singing a soprano line); hidden if it can't be.
          let mm = m;
          dy = dyOf(sungStep(mm, key));
          for (let f = 0; f < 3 && (dy < yMin || dy > yMax); f++) {
            mm += dy > yMax ? 12 : -12;
            dy = dyOf(sungStep(mm, key));
          }
          col = dy < yMin || dy > yMax ? TR_HIDE : TR_REST;
        }
      }
    }
    tr.sys[q] = sys;
    tr.x[q] = x;
    tr.dy[q] = dy;
    tr.col[q] = col;
    tr.ev[q] = ev;
    const final = sm.time < s.pos - 0.3 && (!ev || ev.noteIndex == null || notes[ev.noteIndex].start + notes[ev.noteIndex].dur <= s.pos);
    if (allFinal && final) tr.done = q + 1;
    else allFinal = false;
  }
}

export function drawTrace(c: Ctx, g: SysGeo, s: DrawState, L: Cached, beatNow: number) {
  const { sys } = g;
  const sp = L.layout.sp;
  const tempos = s.score.tempos;
  if (beatNow < sys.startBeat - 1e-6) return;
  const tA = beatToTime(tempos, sys.startBeat);
  const tB = Math.min(beatToTime(tempos, sys.endBeat), s.pos + 0.05);
  if (tB <= tA) return;
  const smp = s.samples;
  // First sample at or after tA (samples are in time order).
  let lo = 0;
  let hi = smp.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (smp[m].time < tA) lo = m + 1;
    else hi = m;
  }
  let end = lo;
  while (end < smp.length && smp[end].time <= tB) end++;
  if (end <= lo) return;
  const w = Math.max(2, 0.16 * sp);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  // Two passes: a dark halo (so the line reads across a notehead of its own colour), then the line.
  for (let pass = 0; pass < 2; pass++) {
    c.lineWidth = pass === 0 ? w + 2.5 : w;
    let color = -2;
    let prevQ = -1;
    c.beginPath();
    if (pass === 0) c.strokeStyle = COLORS.traceHalo;
    for (let q = lo; q < end; q++) {
      const col = tr.col[q];
      if (col === TR_HIDE || tr.sys[q] !== g.j) {
        prevQ = -1;
        continue;
      }
      const x = tr.x[q];
      const y = g.mid + tr.dy[q];
      const joined = prevQ >= 0 && smp[q].time - smp[prevQ].time <= 0.12;
      if (pass === 1 && col !== color) {
        c.stroke();
        c.strokeStyle = TRACE_COLORS[col];
        color = col;
        c.beginPath();
        if (joined) c.moveTo(tr.x[prevQ], g.mid + tr.dy[prevQ]);
      }
      if (joined) c.lineTo(x, y);
      else {
        c.moveTo(x, y);
        c.lineTo(x + 0.01, y);
      }
      prevQ = q;
    }
    c.stroke();
  }
}

export function drawBubble(c: Ctx, g: SysGeo, s: DrawState, L: Cached, px: number, _rightX = g.sys.x1) {
  const sp = L.layout.sp;
  const last = s.samples[s.samples.length - 1];
  if (!last || last.midi == null || s.pos - last.time >= 0.2) return;
  const notes = s.part.notes;
  // Live voice dot at the playhead (the trace's last point when it is on this system).
  const q = s.samples.length - 1;
  let py: number;
  if (tr.samples === s.samples && q < tr.col.length && tr.sys[q] === g.j && tr.col[q] !== TR_HIDE) py = g.mid + tr.dy[q];
  else {
    const lb = timeToBeat(s.score.tempos, last.time);
    const ev = eventAt(g.sys, lb);
    const hiddenEv = !!ev && ev.noteIndex != null && !!s.hide && s.hide(ev.noteIndex) !== 'show'
      && notes[ev.noteIndex].start + notes[ev.noteIndex].dur > s.pos;
    const step = sungStep(last.midi, keyAtBeat(s.score, lb), ev && !hiddenEv ? nearestHead(ev, last.midi) : null);
    const yMin = g.top - (L.above - 0.6) * sp;
    const yMax = g.top + (4 + (L.nameOff ?? L.lyricOff) - 1.5) * sp;
    py = Math.max(yMin, Math.min(yMax, g.mid - ((step - L.layout.mid) * sp) / 2));
  }
  c.fillStyle = COLORS.voiceHalo;
  c.beginPath();
  c.arc(px, py, Math.max(6, 0.75 * sp), 0, Math.PI * 2);
  c.fill();
  c.fillStyle = COLORS.voice;
  c.beginPath();
  c.arc(px, py, Math.max(3, 0.32 * sp), 0, Math.PI * 2);
  c.fill();
}

/** Entry countdown when your next note comes after a rest: beside the playhead's head, on the side
 *  already sung (the notes coming up stay clear). */
export function drawCountdown(c: Ctx, g: SysGeo, s: DrawState, L: Cached, px: number, yTop: number, leftX = g.sys.clefX) {
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
        const size = Math.round(Math.max(16, sp * 1.9));
        c.font = `800 ${size}px "Bricolage Grotesque", sans-serif`;
        c.textBaseline = 'alphabetic';
        c.fillStyle = COLORS.target;
        const left = px - 0.8 * sp - size * 0.6 > leftX;
        c.textAlign = left ? 'right' : 'left';
        c.fillText(String(kk), left ? px - 0.8 * sp : px + 0.8 * sp, yTop + 0.35 * size);
        c.textAlign = 'left';
      }
    }
    break;
  }
}
