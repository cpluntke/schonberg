// Full score for wide screens: every voice of the piece on its own staff (divisi parts too), plus
// the accompaniment as a reduction on one or two staves, with barlines and notes of the same beat
// aligned across all staves. Pure layout (unit-tested); fullscore2d.ts draws it.
import type { Part, Score, ScoreNote, VoiceType } from '../../music/types';
import {
  accW, CLEF_W, NAME_GAP, SCROLL_STRETCH, TIME_W, breakSystems, joinStretches, stretches, buildMeasures, clefFor, eventSteps, hasAcc, hasSecond, keyChangeW, keyW,
  middleStep, nameWidths, naturalSpace, type Clef, type NameW, type LaidEvent, type LaidMeasure, type StaffMeasure, type StaffSystem,
} from './staff2d';

/** Which staves the score view shows on a wide screen. */
export type StaffShow = 'mine' | 'voices' | 'all';

/** Rule of thumb for a readable full score. */
export const MAX_VOICE_STAVES = 6;
export const MAX_INST_STAVES = 2;
/** The accompaniment is shown by default only for at most this many instrument parts… */
export const MAX_INST_PARTS = 2;
/** …playing at most this many notes per beat on average (a hymn-like organ part, not a busy orchestra). */
export const MAX_ACC_DENSITY = 4;

export interface StaffSpec {
  /** Part id, or 'acc' / 'acc:up' / 'acc:lo' for the accompaniment reduction. */
  id: string;
  part: Part;
  name: string;
  /** Label printed at the start of each system. */
  short: string;
  clef: Clef;
  kind: 'voice' | 'inst';
  /** A staff of the accompaniment reduction (braced, barlines through). */
  acc: boolean;
  own: boolean;
  /** The part has words. */
  hasLyrics: boolean;
}

const VT_RANK: Record<VoiceType, number> = { S: 0, A: 1, T: 2, B: 3, other: 4 };

/** Sung parts, top voice first (soprano → bass; divisi and solo parts keep the score's order). */
export function voiceParts(score: Pick<Score, 'parts'>): Part[] {
  const ps = score.parts.filter((p) => p.notes.length && p.voiceType !== 'other');
  return ps.map((p, i) => ({ p, i })).sort((a, b) => VT_RANK[a.p.voiceType] - VT_RANK[b.p.voiceType] || a.i - b.i).map((x) => x.p);
}

/** Instrument parts (organ, piano, pedal…), never the singer's own. */
export function instrumentParts(score: Pick<Score, 'parts'>, ownId: string): Part[] {
  return score.parts.filter((p) => p.voiceType === 'other' && p.notes.length && p.id !== ownId);
}

function mkPart(id: string, name: string, notes: ScoreNote[]): Part {
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  return { id, name, voiceType: 'other', notes, low: notes.length ? lo : 0, high: notes.length ? hi : 0 };
}

/** Name for the accompaniment: the instrument's ("Organ" for Organ + Organ Pedal), else "Accomp.". */
function accName(parts: Part[]): string {
  if (parts.length === 1) return parts[0].name;
  const first = parts.map((p) => p.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '');
  return first.every((w) => w && w === first[0]) ? parts[0].name.trim().split(/\s+/)[0] : 'Accompaniment';
}

/**
 * The accompaniment as a reduction: all instrument parts merged, on a grand staff split at middle C
 * (one staff when everything fits one clef). At most MAX_INST_STAVES staves whatever the scoring.
 */
export function accompaniment(parts: Part[]): Part[] {
  if (!parts.length) return [];
  const all = parts.flatMap((p) => p.notes).sort((a, b) => a.startBeat - b.startBeat || b.midi - a.midi);
  const name = accName(parts);
  const lo = Math.min(...all.map((n) => n.midi));
  const hi = Math.max(...all.map((n) => n.midi));
  if (lo >= 57) return [mkPart('acc', name, all)];
  if (hi <= 64) return [mkPart('acc', name, all)];
  return [mkPart('acc:up', name, all.filter((n) => n.midi >= 60)), mkPart('acc:lo', name, all.filter((n) => n.midi < 60))];
}

/** Average notes per beat of the instrument parts over the beats where they play. */
export function accompanimentDensity(parts: Part[]): number {
  const notes = parts.flatMap((p) => p.notes);
  if (!notes.length) return 0;
  const a = Math.min(...notes.map((n) => n.startBeat));
  const b = Math.max(...notes.map((n) => n.startBeat + n.durBeats));
  return notes.length / Math.max(1, b - a);
}

/** Short label for a staff: S, A, T, B (A1, A2 for divisi; "A solo"), "Org.", "Ped.", "Pno."… */
export function shortName(p: Pick<Part, 'name' | 'voiceType'>): string {
  const n = p.name.trim();
  if (p.voiceType === 'other') {
    if (/pedal|pédale|pedale/i.test(n)) return 'Ped.';
    if (/piano|klavier|pianoforte/i.test(n)) return 'Pno.';
    if (/organ|orgel|orgue/i.test(n)) return 'Org.';
    if (/accomp/i.test(n)) return 'Acc.';
    const w = n.split(/\s+/)[0] ?? '';
    return w.length <= 5 ? w : w.slice(0, 4) + '.';
  }
  if (/solo/i.test(n)) return `${p.voiceType} solo`;
  const m = /(?:\s|^|[^A-Za-z])(1|2|3|4|I{1,3}|IV)\s*$/.exec(n);
  if (m) {
    const roman: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4' };
    return p.voiceType + (roman[m[1]] ?? m[1]);
  }
  return p.voiceType;
}

const avgMidi = (p: Part) => (p.notes.length ? p.notes.reduce((a, n) => a + n.midi, 0) / p.notes.length : 60);

/**
 * Staves for a choice of what to show: voices top to bottom (bracketed), then the instruments: the
 * accompaniment reduction (braced) and, when the singer practises an instrument line, that line on
 * its own staff, above or below the reduction by pitch.
 */
export function planStaves(score: Pick<Score, 'parts'>, ownId: string, show: StaffShow): StaffSpec[] {
  const own = score.parts.find((p) => p.id === ownId);
  const staff = (p: Part): StaffSpec => ({
    id: p.id, part: p, name: p.name, short: shortName(p), clef: clefFor(p), kind: p.voiceType === 'other' ? 'inst' : 'voice',
    acc: false, own: p.id === ownId, hasLyrics: p.notes.some((n) => n.lyric),
  });
  if (show === 'mine') return own ? [staff(own)] : [];
  const out = voiceParts(score).map(staff);
  const ownInst = own && own.voiceType === 'other' && own.notes.length ? staff(own) : null;
  const acc: StaffSpec[] = show === 'all' ? accompaniment(instrumentParts(score, ownId)).map((p) => ({
    id: p.id, part: p, name: p.name, short: shortName(p), clef: p.id === 'acc:up' ? 'treble' : p.id === 'acc:lo' ? 'bass' : clefFor(p),
    kind: 'inst', acc: true, own: false, hasLyrics: false,
  })) : [];
  if (ownInst && acc.length && avgMidi(ownInst.part) < avgMidi({ notes: acc.flatMap((x) => x.part.notes) } as Part)) out.push(...acc, ownInst);
  else out.push(...(ownInst ? [ownInst] : []), ...acc);
  return out;
}

/**
 * What to show when the singer hasn't chosen: all voices plus the accompaniment when that stays
 * readable (≤ 6 voice staves, ≤ 2 instrument parts on ≤ 2 staves, ≤ 4 notes a beat), else the
 * voices only (the singer can still add the accompaniment).
 */
export function defaultShow(score: Pick<Score, 'parts'>, ownId: string): StaffShow {
  const v = voiceParts(score).length;
  const inst = instrumentParts(score, ownId);
  const i = accompaniment(inst).length;
  return i > 0 && v <= MAX_VOICE_STAVES && i <= MAX_INST_STAVES && inst.length <= MAX_INST_PARTS
    && accompanimentDensity(inst) <= MAX_ACC_DENSITY ? 'all' : 'voices';
}

/** Does the piece have anything beyond the singer's own staff to show? */
export function hasOtherStaves(score: Pick<Score, 'parts'>, ownId: string): { voices: boolean; accompaniment: boolean } {
  return { voices: voiceParts(score).some((p) => p.id !== ownId), accompaniment: instrumentParts(score, ownId).length > 0 };
}

/** Is a choice of what to show more than the singer's own staff (so the full score is drawn)? */
export function isFullScore(score: Pick<Score, 'parts'>, ownId: string, show: StaffShow): boolean {
  return planStaves(score, ownId, show).length > 1;
}

/**
 * Notes of another part that double one of yours (same onset, same pitch class: a unison or an
 * octave): other note index → your note index. Off book they would give your hidden note away.
 */
export function doublings(own: Part, other: Part): Map<number, number> {
  const at = new Map<number, { pc: number; i: number }[]>();
  own.notes.forEach((n, i) => {
    const k = Math.round(n.startBeat * 48);
    (at.get(k) ?? at.set(k, []).get(k)!).push({ pc: ((Math.round(n.midi) % 12) + 12) % 12, i });
  });
  const out = new Map<number, number>();
  other.notes.forEach((n, j) => {
    const pc = ((Math.round(n.midi) % 12) + 12) % 12;
    const hit = at.get(Math.round(n.startBeat * 48))?.find((x) => x.pc === pc);
    if (hit) out.set(j, hit.i);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Joint horizontal layout

export interface FullOpts {
  width: number;
  sp: number;
  textW: (s: string) => number;
  /** Staves whose lyrics are printed (their syllables take room). */
  lyricIds: Set<string>;
  /** Note names under one staff (your own): its id and the names' widths. */
  names?: { id: string; w: NameW };
  maxBars?: number;
  /** x of the staff lines' start (room for names and brackets to its left). */
  left: number;
  /** Each system starts with the previous one's last bar (one system per screen: turn a bar early). */
  overlap?: boolean;
  right?: number;
  /** One long line scrolling past the playhead, in stretches of this many bars (no line breaks). */
  scroll?: number;
}

export interface FullStaff {
  spec: StaffSpec;
  clef: Clef;
  mid: number;
  minStep: number;
  maxStep: number;
  /** One per system, all sharing the system's x positions. */
  systems: StaffSystem[];
}

export interface FullLayout {
  sp: number;
  left: number;
  staves: FullStaff[];
  /** Number of systems (each staff has this many). */
  count: number;
}

interface JointWidth {
  changeW: number;
  lead: number;
  onsets: number[];
  /** x of each onset after the lead (px, natural). */
  rel: number[];
  total: number;
}

const ONSET_EPS = 1e-3;

function onsetIndex(onsets: number[], t: number): number {
  let lo = 0;
  let hi = onsets.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (onsets[m] <= t + ONSET_EPS) lo = m;
    else hi = m - 1;
  }
  return lo;
}

/**
 * Natural width of bar k over all staves: every onset of any staff gets a column; the space after a
 * column is the most any note sounding through it asks for (its natural space, in proportion to
 * the part of it that falls there); then lyrics and accidentals push columns apart where needed.
 */
function jointWidth(bars: StaffMeasure[], lyricOn: boolean[], sp: number, textW: (s: string) => number, inside: boolean,
  nameOn: (NameW | undefined)[] = []): JointWidth {
  const sm0 = bars[0];
  let changeW = 0;
  if (inside && sm0.keyChange) changeW += keyChangeW(sm0.key.fifths, sm0.prevFifths) * sp;
  if (inside && sm0.timeChange) changeW += TIME_W * sp;
  const a = sm0.startBeat;
  const b = sm0.endBeat;
  const raw: number[] = [a];
  for (const sm of bars) for (const e of sm.events) if (!e.measureRest) raw.push(e.start);
  raw.sort((x, y) => x - y);
  const onsets: number[] = [];
  for (const t of raw) if (!onsets.length || t - onsets[onsets.length - 1] > ONSET_EPS) onsets.push(t);
  const n = onsets.length;
  const next = (i: number) => (i + 1 < n ? onsets[i + 1] : b);
  const gap = new Array<number>(n).fill(0);
  const extra = new Array<number>(n).fill(0);
  let lead = 0;
  let anyRest = false;
  // Lyric constraints: [from onset, to onset (n = bar end), distance].
  const cons: [number, number, number][] = [];
  bars.forEach((sm, si) => {
    const evs = sm.events;
    const lw = lyricOn[si] ? evs.map((e) => (e.lyric ? textW(e.lyric) : 0)) : evs.map(() => 0);
    const nw = nameWidths(sm, nameOn[si]);
    if (evs[0]?.measureRest) anyRest = true;
    else lead = Math.max(lead, 1.3 * sp + accW(evs[0]) * sp, lw[0] / 2 + 0.4 * sp, nw[0] / 2 + 0.4 * sp);
    for (let j = 0; j < evs.length; j++) {
      const e = evs[j];
      if (e.measureRest) continue;
      const i0 = onsetIndex(onsets, e.start);
      const end = e.start + e.dur;
      const nat = naturalSpace(e.dur) * sp;
      for (let i = i0; i < n && onsets[i] < end - ONSET_EPS; i++) {
        const seg = Math.min(next(i), end) - onsets[i];
        gap[i] = Math.max(gap[i], (nat * seg) / e.dur);
      }
      let x = 0;
      if (e.dots) x += 0.35 * sp * e.dots;
      if (e.kind === 'note' && hasSecond(e)) x += 1.1 * sp;
      extra[i0] = Math.max(extra[i0], x);
      if (i0 > 0 && hasAcc(e)) gap[i0 - 1] = Math.max(gap[i0 - 1], (1.5 + accW(e) + 0.4) * sp);
      const hyph = e.syllabic === 'begin' || e.syllabic === 'middle';
      if (j + 1 < evs.length) {
        if (lw[j] || lw[j + 1]) cons.push([i0, onsetIndex(onsets, evs[j + 1].start), lw[j] / 2 + lw[j + 1] / 2 + (hyph ? 1.4 : 0.6) * sp]);
        if (nw[j] || nw[j + 1]) cons.push([i0, onsetIndex(onsets, evs[j + 1].start), nw[j] / 2 + nw[j + 1] / 2 + NAME_GAP * sp]);
      } else {
        if (lw[j]) cons.push([i0, n, lw[j] / 2 + 0.5 * sp + (hyph ? 0.6 * sp : 0)]);
        if (nw[j]) cons.push([i0, n, nw[j] / 2 + 0.5 * sp]);
      }
    }
  });
  if (lead === 0) lead = 2.2 * sp;
  for (let i = 0; i < n; i++) gap[i] += extra[i];
  const rel = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    rel[i] = rel[i - 1] + gap[i - 1];
    for (const [f, t, d] of cons) if (t === i) rel[i] = Math.max(rel[i], rel[f] + d);
  }
  let end = rel[n];
  if (anyRest) end = Math.max(end, 5 * sp);
  return { changeW, lead, onsets, rel: rel.slice(0, n), total: changeW + lead + end };
}

/**
 * Greedy system breaking where every system after the first starts again with the previous
 * system's last bar. With one system on screen the page then turns as that bar begins, and the
 * bar you're in is still there, at the start of the new system: you always see at least a bar ahead.
 */
export function breakSystemsOverlap(first: number[], rest: number[], avail: number, maxBars: number): number[][] {
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
    if (j >= first.length) break;
    i = sys.length >= 2 ? j - 1 : j;
  }
  return out;
}

/** Lay out bars m0..m1 of every staff into systems of width `width`, aligned across staves. */
export function layoutFullScore(score: Score, staves: StaffSpec[], m0: number, m1: number, o: FullOpts): FullLayout {
  const sp = o.sp;
  const left = o.left;
  const right = o.right ?? 8;
  const avail = o.width - left - right;
  const maxBars = o.maxBars ?? 8;
  const sms = staves.map((st) => buildMeasures(score, st.part, m0, m1, st.clef));
  const lyricOn = staves.map((st) => o.lyricIds.has(st.id));
  const nameOn = staves.map((st) => (o.names && o.names.id === st.id ? o.names.w : undefined));
  const nBars = Math.max(0, m1 - m0 + 1);
  const barsAt = (k: number) => sms.map((x) => x[k]);
  const inner: JointWidth[] = [];
  const opening: JointWidth[] = [];
  for (let k = 0; k < nBars; k++) {
    inner.push(jointWidth(barsAt(k), lyricOn, sp, o.textW, true, nameOn));
    opening.push(jointWidth(barsAt(k), lyricOn, sp, o.textW, false, nameOn));
  }
  const ref = sms[0] ?? [];
  const prefixW = (k: number) => {
    const sm = ref[k];
    const kw = sm.keyChange ? keyChangeW(sm.key.fifths, sm.prevFifths) : keyW(sm.key.fifths);
    return (CLEF_W + kw + (sm.timeChange ? TIME_W : 0) + 0.4) * sp;
  };
  const scroll = o.scroll != null && o.scroll > 0;
  const groups = !nBars || !staves.length ? []
    : scroll ? stretches(nBars, o.scroll!)
    : (o.overlap ? breakSystemsOverlap : breakSystems)(opening.map((w, k) => prefixW(k) + w.total), inner.map((w) => w.total), avail, maxBars);
  let carryX = 0;
  const out: FullStaff[] = staves.map((spec, si) => {
    let minStep = middleStep(spec.clef) - 4;
    let maxStep = middleStep(spec.clef) + 4;
    for (const sm of sms[si]) for (const e of sm.events) for (const st of eventSteps(e)) {
      minStep = Math.min(minStep, st);
      maxStep = Math.max(maxStep, st);
    }
    return { spec, clef: spec.clef, mid: middleStep(spec.clef), minStep, maxStep, systems: [] };
  });
  groups.forEach((g, gi) => {
    const firstSm = ref[g[0]];
    const clefX = left + 0.3 * sp;
    const keyX = left + CLEF_W * sp;
    const timeX = keyX + (firstSm.keyChange ? keyChangeW(firstSm.key.fifths, firstSm.prevFifths) : keyW(firstSm.key.fifths)) * sp;
    // Scrolling: one line, each stretch starting where the last ended (clefs and keys stay pinned).
    const prefixEnd = scroll && gi > 0 ? carryX : left + prefixW(g[0]);
    const widths = g.map((k, idx) => (idx === 0 && (!scroll || gi === 0) ? opening[k] : inner[k]));
    const natural = widths.reduce((acc, w) => acc + w.total, 0);
    const room = left + avail - prefixEnd;
    let f = scroll ? SCROLL_STRETCH : room / Math.max(1, natural);
    if (!scroll && gi === groups.length - 1 && f > 1) f = Math.min(f, 1.4);
    // Shared geometry: bar edges and every onset's x.
    let x = prefixEnd;
    const bars: { k: number; x0: number; x1: number; changeX: number | null; xs: number[]; w: JointWidth }[] = [];
    const bp: { beat: number; x: number }[] = [];
    g.forEach((k, idx) => {
      const w = widths[idx];
      const x0 = x;
      const xs = w.rel.map((r) => x0 + (w.changeW + w.lead + r) * f);
      w.onsets.forEach((t, i) => bp.push({ beat: t, x: xs[i] }));
      x = x0 + w.total * f;
      bars.push({ k, x0, x1: x, changeX: w.changeW > 0 ? x0 + 0.5 * sp : null, xs, w });
    });
    const endBeat = ref[g[g.length - 1]].endBeat;
    bp.push({ beat: endBeat, x });
    carryX = x;
    out.forEach((fs, si) => {
      const measures: LaidMeasure[] = bars.map(({ k, x0, x1, changeX, xs, w }) => {
        const sm = sms[si][k];
        const events: LaidEvent[] = sm.events.map((ev) => ({
          ev,
          x: ev.measureRest ? x0 + w.changeW * f + ((w.total - w.changeW) * f) / 2 : xs[onsetIndex(w.onsets, ev.start)],
        }));
        return { sm, x0, x1, changeX, events };
      });
      fs.systems.push({
        measures, startBeat: firstSm.startBeat, endBeat, key: firstSm.key,
        cancelFifths: firstSm.keyChange ? firstSm.prevFifths : 0,
        timeSig: firstSm.timeChange ? firstSm.timeSig : null,
        clefX, keyX, timeX, prefixEnd, x1: x, bp, squeeze: f,
        ...(scroll ? { cont: true } : {}),
      });
    });
  });
  if (scroll) for (const fs of out) joinStretches(fs.systems);
  return { sp, left, staves: out, count: groups.length };
}
