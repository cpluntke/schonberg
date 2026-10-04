// MusicXML (score-partwise / score-timewise) → Score.
//
// Notes:
// - Repeats (<repeat>, voltas, D.C./D.S.) are ignored: the score is played linearly as written.
// - Grace notes and cue notes are ignored.
// - Tenor parts in treble-8vb clef are already written at sounding octave in MusicXML (octave 3),
//   so clef-octave-change is NOT applied; only <transpose> (chromatic + octave-change) is.
import type { KeySig, Measure, Part, Score, ScoreNote, VoiceType } from './types';
import { beatToTime, buildTempoMap, DEFAULT_BPM } from './time';

const EPS = 1e-6;

// ---------------------------------------------------------------------------
// small DOM helpers (namespace-agnostic, direct children only)

function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (!name || c.localName === name) out.push(c);
  }
  return out;
}
function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
  return null;
}
function txt(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? '';
}
function num(el: Element | null | undefined, dflt = 0): number {
  const v = parseFloat(txt(el));
  return isFinite(v) ? v : dflt;
}
function path(el: Element | null | undefined, ...names: string[]): Element | null {
  let cur: Element | null | undefined = el;
  for (const n of names) {
    cur = kid(cur, n);
    if (!cur) return null;
  }
  return cur ?? null;
}

// ---------------------------------------------------------------------------
// voice-type guessing (shared with midi.ts)

const INSTRUMENT_RE =
  /\b(piano|pianoforte|pf\.?|klavier|orgel|organ|org\.|harmonium|harp|harfe|cembalo|harpsichord|keyboard|reduction|rehearsal|accomp|continuo|violin|viola|cello|violoncello|kontrabass|contrabass|double bass|flute|fl[oö]te|oboe|clarinet|klarinette|bassoon|fagott|horn|trumpet|trompete|trombone|posaune|tuba|timpani|pauken|percussion|guitar|gitarre|strings)\b/i;
const KEYBOARD_RE = /\b(piano|pianoforte|pf\.?|klavier|orgel|organ|org\.|harmonium|cembalo|harpsichord|keyboard|reduction|rehearsal|accomp)/i;

/** Guess S/A/T/B from a name; returns undefined if the name gives no hint. */
export function voiceTypeFromName(name: string): VoiceType | undefined {
  const n = name.trim();
  if (!n) return undefined;
  if (/basso\s*continuo|continuo|bass\s*guitar|contrabass|double\s*bass|kontrabass|bass\s*clarinet|bassklarinette/i.test(n)) return 'other';
  if (INSTRUMENT_RE.test(n)) return 'other';
  if (/(sopran|soprano|sopr\b|canto|cantus|dessus|treble|discant|superius)/i.test(n)) return 'S';
  if (/(\balt\b|\balto|\balti\b|contralto|altus|mezzo|\bcontra\b)/i.test(n)) return 'A';
  if (/(t[eé]nor|ténor)/i.test(n)) return 'T';
  if (/(\bbass(?:es|e|i|o|us)?\b|\bbajos?\b|bariton|baryton|\bbässe\b)/i.test(n)) return 'B';
  // abbreviations: "S.", "S1", "S 2", "A.", "T. 1", "B", "Bar."
  const m = n.match(/^([SATB])(?:\.|\s*\d|\s*[IV]+\b|$)/);
  if (m) return m[1] as VoiceType;
  if (/^bar\.?\s*$/i.test(n)) return 'B';
  return undefined;
}

export function voiceTypeFromRange(midis: number[]): VoiceType {
  if (!midis.length) return 'other';
  const s = [...midis].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  if (med >= 67) return 'S';
  if (med >= 60) return 'A';
  if (med >= 52) return 'T';
  return 'B';
}

export function guessVoiceType(name: string, midis: number[]): VoiceType {
  return voiceTypeFromName(name) ?? voiceTypeFromRange(midis);
}

export function isKeyboardName(name: string): boolean {
  return KEYBOARD_RE.test(name);
}

/** Stable short hash (FNV-1a, hex). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// raw per-part parsing

interface RawNote {
  beat: number; // quarter offset from measure start
  dur: number; // quarters
  midi: number | null; // null = rest
  visible: boolean;
  voice: string;
  staff: string;
  chord: boolean;
  tieStart: boolean;
  tieStop: boolean;
  lyric?: string;
  syllabic?: ScoreNote['syllabic'];
  lyricNumber?: string;
}

interface RawMeasure {
  number: string;
  implicit: boolean;
  len: number;
  notes: RawNote[];
  tempos: { beat: number; bpm: number }[];
  rehearsal?: string;
  doubleBarRight: boolean;
  doubleBarLeft: boolean;
  keys: { beat: number; fifths: number; mode: 'major' | 'minor' }[];
  time?: [number, number];
}

interface RawPart {
  id: string;
  name: string;
  staves: number;
  transposed: boolean;
  /** semitones applied by <transpose><octave-change> (last value seen) */
  octaveShift: number;
  measures: RawMeasure[];
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const UNIT_BEATS: Record<string, number> = {
  maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125,
};

function parseMetronome(met: Element): number | null {
  const units = kids(met, 'beat-unit');
  const pm = kid(met, 'per-minute');
  if (units.length !== 1 || !pm) return null; // metric modulation etc. → ignore
  const m = txt(pm).match(/\d+(\.\d+)?/);
  if (!m) return null;
  let beats = UNIT_BEATS[txt(units[0])] ?? 1;
  const dots = kids(met, 'beat-unit-dot').length;
  let add = beats / 2;
  for (let i = 0; i < dots; i++) {
    beats += add;
    add /= 2;
  }
  return parseFloat(m[0]) * beats;
}

function lyricText(ly: Element): string {
  // <text> [<elision/> <syllabic/> <text>]...
  let out = '';
  let pendingElision = false;
  let first = true;
  for (const c of kids(ly)) {
    if (c.localName === 'elision') pendingElision = true;
    else if (c.localName === 'text') {
      const t = (c.textContent ?? '').replace(/\u00ad/g, '').trim();
      if (!first) out += pendingElision ? '‿' : ' ';
      out += t;
      first = false;
      pendingElision = false;
    }
  }
  return out.trim();
}

/** Iterate measure content containers for a part: works for partwise and (converted) timewise. */
interface MeasureSrc {
  number: string;
  implicit: boolean;
  el: Element; // element whose children are notes/attributes/...
}

function parseRawPart(id: string, name: string, srcs: MeasureSrc[]): RawPart {
  let divisions = 1;
  let chromatic = 0;
  let octaveChange = 0;
  let staves = 1;
  let transposed = false;
  const measures: RawMeasure[] = [];

  for (const src of srcs) {
    const rm: RawMeasure = {
      number: src.number,
      implicit: src.implicit,
      len: 0,
      notes: [],
      tempos: [],
      doubleBarRight: false,
      doubleBarLeft: false,
      keys: [],
    };
    let cursor = 0; // quarters
    let lastOnset = 0;
    const advance = (q: number) => {
      cursor += q;
      if (cursor < 0) cursor = 0;
      rm.len = Math.max(rm.len, cursor);
    };

    for (const c of kids(src.el)) {
      switch (c.localName) {
        case 'attributes': {
          const d = kid(c, 'divisions');
          if (d) divisions = num(d, 1) || 1;
          const st = kid(c, 'staves');
          if (st) staves = Math.max(staves, num(st, 1));
          const tr = kid(c, 'transpose');
          if (tr) {
            chromatic = num(kid(tr, 'chromatic'));
            octaveChange = num(kid(tr, 'octave-change'));
            if (chromatic || octaveChange) transposed = true;
          }
          for (const k of kids(c, 'key')) {
            const f = kid(k, 'fifths');
            if (!f) continue;
            const mode = txt(kid(k, 'mode')).toLowerCase() === 'minor' ? 'minor' : 'major';
            rm.keys.push({ beat: cursor, fifths: num(f), mode });
          }
          const t = kid(c, 'time');
          if (t) {
            const b = kid(t, 'beats');
            const bt = kid(t, 'beat-type');
            if (b && bt) {
              // "3+2" style beats
              const beats = txt(b).split('+').reduce((s, x) => s + (parseFloat(x) || 0), 0);
              rm.time = [beats || 4, num(bt, 4) || 4];
            }
          }
          break;
        }
        case 'backup':
          advance(-num(kid(c, 'duration')) / divisions);
          break;
        case 'forward':
          advance(num(kid(c, 'duration')) / divisions);
          break;
        case 'direction': {
          const off = kid(c, 'offset') ? num(kid(c, 'offset')) / divisions : 0;
          const at = Math.max(0, cursor + off);
          const snd = kid(c, 'sound');
          let bpm: number | null = null;
          if (snd?.hasAttribute('tempo')) bpm = parseFloat(snd.getAttribute('tempo')!);
          for (const dt of kids(c, 'direction-type')) {
            const reh = kid(dt, 'rehearsal');
            if (reh && txt(reh) && rm.rehearsal === undefined) rm.rehearsal = txt(reh);
            const met = kid(dt, 'metronome');
            if (met && (bpm === null || !isFinite(bpm))) bpm = parseMetronome(met);
          }
          if (bpm !== null && isFinite(bpm) && bpm > 0) rm.tempos.push({ beat: at, bpm });
          break;
        }
        case 'sound': {
          if (c.hasAttribute('tempo')) {
            const bpm = parseFloat(c.getAttribute('tempo')!);
            if (isFinite(bpm) && bpm > 0) rm.tempos.push({ beat: cursor, bpm });
          }
          break;
        }
        case 'barline': {
          const style = txt(kid(c, 'bar-style'));
          const loc = c.getAttribute('location') ?? 'right';
          if (/^(light-light|light-heavy|heavy-light|heavy-heavy)$/.test(style)) {
            if (loc === 'left') rm.doubleBarLeft = true;
            else if (loc === 'right') rm.doubleBarRight = true;
          }
          break;
        }
        case 'note': {
          const isGrace = !!kid(c, 'grace');
          const isCue = !!kid(c, 'cue');
          const isChord = !!kid(c, 'chord');
          const dur = num(kid(c, 'duration')) / divisions;
          if (isGrace) break;
          const onset = isChord ? lastOnset : cursor;
          if (!isChord) {
            lastOnset = cursor;
            advance(dur);
          }
          if (isCue) break;
          const restEl = kid(c, 'rest');
          const pitchEl = kid(c, 'pitch');
          let midi: number | null = null;
          if (pitchEl) {
            const step = txt(kid(pitchEl, 'step')).toUpperCase();
            const alter = Math.round(num(kid(pitchEl, 'alter')));
            const octave = num(kid(pitchEl, 'octave'), 4);
            midi = (octave + 1) * 12 + (STEP[step] ?? 0) + alter + chromatic + 12 * octaveChange;
          } else if (!restEl) {
            // unpitched (percussion) → treat as rest
            midi = null;
          }
          let tieStart = false;
          let tieStop = false;
          for (const t of kids(c, 'tie')) {
            if (t.getAttribute('type') === 'start') tieStart = true;
            if (t.getAttribute('type') === 'stop') tieStop = true;
          }
          for (const n of kids(c, 'notations')) {
            for (const t of kids(n, 'tied')) {
              const ty = t.getAttribute('type');
              if (ty === 'start' || ty === 'continue') tieStart = true;
              if (ty === 'stop' || ty === 'continue') tieStop = true;
            }
          }
          const rn: RawNote = {
            beat: onset,
            dur,
            midi,
            visible: c.getAttribute('print-object') !== 'no',
            voice: txt(kid(c, 'voice')) || '1',
            staff: txt(kid(c, 'staff')) || '1',
            chord: isChord,
            tieStart,
            tieStop,
          };
          if (midi !== null) {
            // choose lyric later per part (verse selection); store all candidates on the note
            const lyrics = kids(c, 'lyric').filter((l) => l.getAttribute('print-object') !== 'no');
            if (lyrics.length) {
              (rn as RawNote & { _lyrics?: Element[] })._lyrics = lyrics;
            }
          }
          rm.notes.push(rn);
          break;
        }
      }
    }
    measures.push(rm);
  }

  // Verse selection. MusicXML lyric "number" is used both for verses and (by some exporters) for
  // alternate placement lines of the same verse. Primary = lowest number. Another number counts as a
  // real (other) verse only if it appears on the same note as the primary; otherwise it is a placement
  // variant and is used where the primary is missing.
  const numOf = (l: Element) => l.getAttribute('number') || '1';
  const cmpNum = (a: string, b: string) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || a.localeCompare(b);
  const all = new Set<string>();
  type WithLy = RawNote & { _lyrics?: Element[] };
  for (const m of measures) for (const n of m.notes) for (const l of (n as WithLy)._lyrics ?? []) all.add(numOf(l));
  const primary = [...all].sort(cmpNum)[0];
  const otherVerses = new Set<string>();
  for (const m of measures)
    for (const n of m.notes) {
      const nums = ((n as WithLy)._lyrics ?? []).map(numOf);
      if (nums.includes(primary)) for (const x of nums) if (x !== primary) otherVerses.add(x);
    }
  for (const m of measures)
    for (const n of m.notes) {
      const ls = (n as WithLy)._lyrics;
      if (!ls) continue;
      delete (n as WithLy)._lyrics;
      const l =
        ls.find((x) => numOf(x) === primary) ??
        [...ls].sort((x, y) => cmpNum(numOf(x), numOf(y))).find((x) => !otherVerses.has(numOf(x)));
      if (!l) continue;
      const t = lyricText(l);
      if (!t) continue;
      n.lyric = t;
      n.lyricNumber = numOf(l);
      const syl = txt(kid(l, 'syllabic'));
      n.syllabic = syl === 'begin' || syl === 'middle' || syl === 'end' ? syl : 'single';
    }

  return { id, name, staves, transposed, octaveShift: 12 * octaveChange, measures };
}

// ---------------------------------------------------------------------------
// splitting a part into singable lanes

interface LaneNote {
  start: number; // absolute beat
  dur: number;
  midi: number;
  measure: number;
  tieStart: boolean;
  tieStop: boolean;
  lyric?: string;
  syllabic?: ScoreNote['syllabic'];
}

function groupOnsets(notes: RawNote[]): RawNote[][] {
  // notes of one voice in one measure → onset groups (chords), rests are their own groups
  const groups: RawNote[][] = [];
  const byBeat = new Map<string, RawNote[]>();
  for (const n of notes) {
    const key = n.beat.toFixed(5) + (n.midi === null ? 'r' : 'n');
    let g = byBeat.get(key);
    if (!g) {
      g = [];
      byBeat.set(key, g);
      groups.push(g);
    }
    g.push(n);
  }
  groups.sort((a, b) => a[0].beat - b[0].beat);
  return groups;
}

function splitLanes(rp: RawPart, measureStarts: number[]): LaneNote[][] {
  // voice order by mean pitch (highest first)
  const voiceStats = new Map<string, { sum: number; n: number }>();
  for (const m of rp.measures)
    for (const n of m.notes) {
      if (n.midi === null) continue;
      const s = voiceStats.get(n.voice) ?? { sum: 0, n: 0 };
      s.sum += n.midi;
      s.n++;
      voiceStats.set(n.voice, s);
    }
  const voiceOrder = [...voiceStats.entries()].sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n).map((e) => e[0]);
  if (!voiceOrder.length) return [];

  // per measure: present voices (with visible content) and their chord widths
  type Slot = { voice: string; j: number; groups: RawNote[][] };
  const perMeasureSlots: Slot[][] = [];
  let L = 1;
  rp.measures.forEach((m) => {
    const slots: Slot[] = [];
    for (const v of voiceOrder) {
      // content = pitched notes or visible rests; a voice with only hidden rests counts as absent
      const vn = m.notes.filter((n) => n.voice === v && (n.midi !== null || n.visible));
      if (!vn.length) continue;
      const groups = groupOnsets(vn);
      const width = Math.max(1, ...groups.map((g) => (g[0].midi === null ? 1 : g.length)));
      for (let j = 0; j < width; j++) slots.push({ voice: v, j, groups });
    }
    perMeasureSlots.push(slots);
    L = Math.max(L, slots.length);
  });

  const lanes: LaneNote[][] = Array.from({ length: L }, () => []);
  perMeasureSlots.forEach((slots, mi) => {
    if (!slots.length) return;
    const ms = measureStarts[mi];
    for (let lane = 0; lane < L; lane++) {
      const si = L === 1 || slots.length === L ? Math.min(lane, slots.length - 1) : Math.round((lane * (slots.length - 1)) / (L - 1));
      const slot = slots[si];
      for (const g of slot.groups) {
        if (g[0].midi === null) continue;
        const sorted = [...g].sort((a, b) => (b.midi ?? 0) - (a.midi ?? 0));
        const n = sorted[Math.min(slot.j, sorted.length - 1)];
        const lyr = n.lyric !== undefined ? n : g.find((x) => x.lyric !== undefined);
        lanes[lane].push({
          start: ms + n.beat,
          dur: n.dur,
          midi: n.midi!,
          measure: mi,
          tieStart: n.tieStart,
          tieStop: n.tieStop,
          lyric: lyr?.lyric,
          syllabic: lyr?.syllabic,
        });
      }
    }
  });
  return lanes;
}

function mergeTies(notes: LaneNote[]): LaneNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.midi - a.midi);
  const out: LaneNote[] = [];
  const open = new Map<number, LaneNote>(); // midi → last note with pending tie
  for (const n of sorted) {
    const prev = open.get(n.midi);
    if (prev && (prev.tieStart || n.tieStop) && Math.abs(prev.start + prev.dur - n.start) < 1e-3) {
      // merge; keep the first syllable only
      prev.dur = n.start + n.dur - prev.start;
      prev.tieStart = n.tieStart;
      continue;
    }
    const copy = { ...n };
    out.push(copy);
    open.set(n.midi, copy);
  }
  return out;
}

/** Remove simultaneous duplicates (same start+midi) in a single-line lane; keep longest. */
function dedupeLane(notes: LaneNote[]): LaneNote[] {
  const out: LaneNote[] = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.start - n.start) < EPS && last.midi === n.midi) {
      if (n.dur > last.dur) last.dur = n.dur;
      continue;
    }
    out.push(n);
  }
  return out;
}

function laneSignature(notes: LaneNote[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of notes) m.set(n.start.toFixed(4), n.midi);
  return m;
}

/** Notes of `a` that differ from `b` (by onset/pitch): count and number of distinct measures. */
function laneDiff(a: LaneNote[], b: LaneNote[]): { notes: number; bars: number } {
  const sb = laneSignature(b);
  let d = 0;
  const bars = new Set<number>();
  for (const n of a)
    if (sb.get(n.start.toFixed(4)) !== n.midi) {
      d++;
      bars.add(n.measure);
    }
  return { notes: d, bars: bars.size };
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

function laneNames(base: string, count: number): string[] {
  const abbr: Record<string, string> = { S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' };
  const ab = base.trim().match(/^([SATB])\.?$/);
  if (ab) base = abbr[ab[1]];
  if (count <= 1) return [base];
  // explicit list "Soprano/Alto", "Soprano & Alto", "S, A"
  const tokens = base
    .split(/\s*(?:\/|&|\+|,|\band\b|\bund\b|\bet\b|\be\b|\by\b)\s*/i)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === count && tokens.every((t) => /[a-zA-ZÀ-ÿ]{2,}|^[SATB]\.?$/.test(t) && !/^[IVX]+$/.test(t))) {
    // expand abbreviations
    const exp: Record<string, string> = { S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' };
    return tokens.map((t) => exp[t.replace('.', '')] ?? t);
  }
  // voice words in name: "Soprano Alto", "Tenor Bass"
  const words: string[] = [];
  const re = /(sopran[oi]?|alt[oi]?|contralto|t[eé]nor[ei]?|bass[oi]?|basse|bariton[eo]?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(base))) words.push(m[0][0].toUpperCase() + m[0].slice(1));
  if (words.length === count && new Set(words.map((w) => w.toLowerCase())).size === count) return words;
  // "Tenor 1/2", "Tenor I-II" → "Tenor 1", "Tenor 2"
  const list = base.match(/^(.*?)\s*(?:\d+|[IVX]+)\s*(?:[-/,&+–]\s*(?:\d+|[IVX]+)\s*)+$/);
  if (list && list[1].trim()) return Array.from({ length: count }, (_, i) => `${list[1].trim()} ${i + 1}`);
  // "Bass I" (a single numbered part split again) → "Bass I (1)", "Bass I (2)"
  if (/\s(?:\d+|[IVX]+)\.?$/.test(base)) return Array.from({ length: count }, (_, i) => `${base} (${i + 1})`);
  return Array.from({ length: count }, (_, i) => `${base} ${i + 1}`);
}

// ---------------------------------------------------------------------------
// timewise → measure sources

function partwiseSources(root: Element): Map<string, MeasureSrc[]> {
  const out = new Map<string, MeasureSrc[]>();
  for (const p of kids(root, 'part')) {
    const id = p.getAttribute('id') ?? `P${out.size + 1}`;
    out.set(
      id,
      kids(p, 'measure').map((m, i) => ({ number: m.getAttribute('number') ?? String(i + 1), implicit: m.getAttribute('implicit') === 'yes', el: m })),
    );
  }
  return out;
}

function timewiseSources(root: Element): Map<string, MeasureSrc[]> {
  const out = new Map<string, MeasureSrc[]>();
  kids(root, 'measure').forEach((m, i) => {
    for (const p of kids(m, 'part')) {
      const id = p.getAttribute('id') ?? 'P1';
      if (!out.has(id)) out.set(id, []);
      out.get(id)!.push({ number: m.getAttribute('number') ?? String(i + 1), implicit: m.getAttribute('implicit') === 'yes', el: p });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------

/** Strip BOM / XML declaration encoding issues / DOCTYPE so DOMParser never tries to fetch a DTD. */
export function cleanXml(xml: string): string {
  let s = xml.replace(/^﻿/, '');
  s = s.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '');
  // encoding declarations are irrelevant once decoded into a JS string (UTF-16 declarations confuse some parsers)
  s = s.replace(/^\s*<\?xml[^?]*\?>/, '<?xml version="1.0"?>');
  return s.trimStart();
}

export function parseMusicXML(xml: string, opts?: { id?: string }): Score {
  const doc = new DOMParser().parseFromString(cleanXml(xml), 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('Invalid MusicXML: ' + (err.textContent ?? '').slice(0, 200));
  const root = doc.documentElement;
  let sources: Map<string, MeasureSrc[]>;
  if (root.localName === 'score-partwise') sources = partwiseSources(root);
  else if (root.localName === 'score-timewise') sources = timewiseSources(root);
  else throw new Error(`Not a MusicXML score (root element <${root.localName}>)`);

  // part list
  const partNames = new Map<string, string>();
  const plist = kid(root, 'part-list');
  let pi = 0;
  for (const sp of kids(plist, 'score-part')) {
    pi++;
    const id = sp.getAttribute('id') ?? `P${pi}`;
    const name =
      txt(kid(sp, 'part-name')) ||
      txt(kid(sp, 'part-abbreviation')) ||
      txt(path(sp, 'score-instrument', 'instrument-name')) ||
      `Part ${pi}`;
    partNames.set(id, name.replace(/\s+/g, ' '));
  }

  const rawParts: RawPart[] = [];
  for (const [id, srcs] of sources) rawParts.push(parseRawPart(id, partNames.get(id) ?? id, srcs));
  if (!rawParts.length) throw new Error('MusicXML contains no parts');

  // ---- global measure grid
  const nMeasures = Math.max(...rawParts.map((p) => p.measures.length));
  const measures: Measure[] = [];
  let ts: [number, number] = [4, 4];
  let beat = 0;
  for (let i = 0; i < nMeasures; i++) {
    const rms = rawParts.map((p) => p.measures[i]).filter(Boolean);
    const t = rms.find((m) => m.time)?.time;
    if (t) ts = t;
    const tsLen = (ts[0] * 4) / ts[1];
    const len = Math.max(0, ...rms.map((m) => m.len));
    const implicit = rms.some((m) => m.implicit);
    let dur: number;
    if (len <= EPS) dur = tsLen;
    else if (implicit || i === nMeasures - 1) dur = len;
    else dur = len < tsLen - EPS ? tsLen : len;
    const first = rms[0];
    const m: Measure = {
      index: i,
      number: first?.number ?? String(i + 1),
      startBeat: beat,
      durBeats: dur,
      start: 0,
      dur: 0,
      timeSig: [ts[0], ts[1]],
    };
    const reh = rms.find((x) => x.rehearsal)?.rehearsal;
    if (reh) m.rehearsalMark = reh;
    if (rms.some((x) => x.doubleBarRight)) m.doubleBar = true;
    if (i > 0 && rms.some((x) => x.doubleBarLeft)) measures[i - 1].doubleBar = true;
    measures.push(m);
    beat += dur;
  }
  const totalBeats = beat;

  // ---- tempo map (first part wins on conflicts)
  const tempoEvents: { beat: number; bpm: number }[] = [];
  for (let p = rawParts.length - 1; p >= 0; p--)
    rawParts[p].measures.forEach((m, i) => {
      for (const t of m.tempos) tempoEvents.push({ beat: measures[i].startBeat + t.beat, bpm: t.bpm });
    });
  // stable: sort by beat but keep part-0 last for same beat
  const tempos = buildTempoMap(tempoEvents.map((e, k) => ({ ...e, k })).sort((a, b) => a.beat - b.beat || a.k - b.k), DEFAULT_BPM);
  for (const m of measures) {
    m.start = beatToTime(tempos, m.startBeat);
    m.dur = beatToTime(tempos, m.startBeat + m.durBeats) - m.start;
  }

  // ---- keys: from the first non-transposed part that has keys
  const keyPart = rawParts.find((p) => !p.transposed && p.measures.some((m) => m.keys.length)) ?? rawParts.find((p) => p.measures.some((m) => m.keys.length));
  const keys: KeySig[] = [];
  keyPart?.measures.forEach((m, i) => {
    for (const k of m.keys) {
      const b = measures[i].startBeat + k.beat;
      const last = keys[keys.length - 1];
      if (last && last.fifths === k.fifths && last.mode === k.mode) continue;
      if (last && Math.abs(last.beat - b) < EPS) keys.pop();
      keys.push({ beat: b, time: beatToTime(tempos, b), fifths: k.fifths, mode: k.mode });
    }
  });
  if (!keys.length || keys[0].beat > EPS) keys.unshift({ beat: 0, time: 0, fifths: keys[0]?.fifths ?? 0, mode: keys[0]?.mode ?? 'major' });

  // ---- parts
  const measureStarts = measures.map((m) => m.startBeat);
  const parts: Part[] = [];
  const mkNote = (n: LaneNote): ScoreNote => {
    const start = beatToTime(tempos, n.start);
    const end = beatToTime(tempos, n.start + n.dur);
    const sn: ScoreNote = { midi: n.midi, start, dur: end - start, startBeat: n.start, durBeats: n.dur, measure: n.measure };
    if (n.lyric) {
      sn.lyric = n.lyric;
      sn.syllabic = n.syllabic ?? 'single';
    }
    return sn;
  };
  const finishPart = (id: string, name: string, voiceType: VoiceType, notes: ScoreNote[]): Part => {
    notes.sort((a, b) => a.start - b.start || b.midi - a.midi);
    const midis = notes.map((n) => n.midi);
    return { id, name, voiceType, notes, low: midis.length ? Math.min(...midis) : 0, high: midis.length ? Math.max(...midis) : 0 };
  };

  // ---- octave sanity for tenor parts (common exporter quirks)
  const medianOf = (xs: number[]) => {
    const m = [...xs].sort((a, b) => a - b);
    return m.length ? m[m.length >> 1] : NaN;
  };
  const rawMidis = (rp: RawPart) => rp.measures.flatMap((x) => x.notes).filter((n) => n.midi !== null).map((n) => n.midi!);
  const shiftPart = (rp: RawPart, k: number) => {
    for (const m of rp.measures) for (const n of m.notes) if (n.midi !== null) n.midi += k;
  };
  const typed = rawParts.map((rp) => ({ rp, vt: voiceTypeFromName(rp.name), med: medianOf(rawMidis(rp)) }));
  const bassMeds = typed.filter((t) => t.vt === 'B').map((t) => t.med);
  for (const t of typed) {
    if (t.vt !== 'T' || isNaN(t.med)) continue;
    // a spurious <transpose octave-change=-1> on a tenor written at sounding pitch puts it below the basses
    if (t.rp.octaveShift < 0 && bassMeds.some((b) => b > t.med)) shiftPart(t.rp, -t.rp.octaveShift);
    // tenor in plain treble clef (implied 8vb, no clef-octave-change, no transpose)
    else if (t.rp.octaveShift === 0 && t.med >= 67) shiftPart(t.rp, -12);
  }

  const unnamed = new Set<string>();
  for (const rp of rawParts) {
    const allNotes = rp.measures.flatMap((m) => m.notes.filter((n) => n.midi !== null));
    const hasLyrics = allNotes.some((n) => n.lyric);
    const nameType = voiceTypeFromName(rp.name);
    const accompaniment =
      allNotes.length > 0 && (isKeyboardName(rp.name) || (nameType === 'other' && !hasLyrics) || (rp.staves >= 2 && !hasLyrics && nameType === undefined));
    if (!allNotes.length) {
      parts.push(finishPart(rp.id, rp.name, 'other', []));
      continue;
    }
    if (accompaniment) {
      // keep all notes (chords) in one part; merge ties per pitch
      const ln: LaneNote[] = [];
      rp.measures.forEach((m, mi) => {
        for (const n of m.notes)
          if (n.midi !== null)
            ln.push({ start: measureStarts[mi] + n.beat, dur: n.dur, midi: n.midi, measure: mi, tieStart: n.tieStart, tieStop: n.tieStop });
      });
      parts.push(finishPart(rp.id, rp.name, 'other', mergeTies(ln).map(mkNote)));
      continue;
    }

    let lanes = splitLanes(rp, measureStarts).map((l) => dedupeLane(mergeTies(l)));
    // drop lanes that are (almost) identical to an already kept lane (e.g. a divisi chord or two):
    // the minor divisi notes fold into the upper line rather than creating a near-duplicate part
    const kept: LaneNote[][] = [];
    for (const l of lanes) {
      if (!l.length) continue;
      const tooSimilar = kept.some((k) => {
        const d = laneDiff(l, k);
        if (d.notes === 0) return true;
        const bars = new Set(l.map((n) => n.measure)).size;
        return bars >= 8 && (d.bars <= 2 || d.notes < l.length * 0.08);
      });
      if (!tooSimilar) kept.push(l);
    }
    lanes = kept;
    // borrow lyrics from sibling lanes for lanes that have (almost) none
    if (lanes.length > 1) {
      for (const l of lanes) {
        for (const n of l) {
          if (n.lyric || n.tieStop) continue;
          for (const o of lanes) {
            if (o === l) continue;
            const src = o.find((x) => Math.abs(x.start - n.start) < 1e-4 && x.lyric);
            if (src) {
              n.lyric = src.lyric;
              n.syllabic = src.syllabic;
              break;
            }
          }
        }
      }
    }
    const names = laneNames(rp.name, lanes.length);
    lanes.forEach((l, i) => {
      const id = lanes.length > 1 ? `${rp.id}-${i + 1}` : rp.id;
      const nm = names[i] ?? `${rp.name} ${ROMAN[i] ?? i + 1}`;
      const vt = guessVoiceType(nm, l.map((n) => n.midi));
      if (voiceTypeFromName(nm) === undefined) unnamed.add(id);
      parts.push(finishPart(id, nm, vt === 'other' && hasLyrics ? voiceTypeFromRange(l.map((n) => n.midi)) : vt, l.map(mkNote)));
    });
  }

  // ---- parts without a voice name: rank by pitch when it is a plain 4-part texture; rename generic names
  const un = parts.filter((p) => unnamed.has(p.id) && p.voiceType !== 'other');
  const med = (p: Part) => medianOf(p.notes.map((n) => n.midi));
  if (un.length === 4) {
    const order: VoiceType[] = ['S', 'A', 'T', 'B'];
    [...un].sort((a, b) => med(b) - med(a)).forEach((p, i) => (p.voiceType = order[i]));
  }
  const VOICE_NAME: Record<string, string> = { S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' };
  const generic = /^(midi|part|instrument|staff|track|voice|stimme|voix|p|music|untitled)?[\s_.-]*\d*$/i;
  const nameCount = new Map<string, number>();
  for (const p of parts) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);
  for (const p of un) {
    if (generic.test(p.name) || (nameCount.get(p.name) ?? 0) > 1) {
      const base = VOICE_NAME[p.voiceType];
      const same = un.filter((q) => q.voiceType === p.voiceType);
      p.name = same.length > 1 ? `${base} ${same.indexOf(p) + 1}` : base;
    }
  }

  // ---- title / composer
  const credits = kids(root, 'credit');
  const creditOf = (type: string) =>
    credits.find((c) => kids(c, 'credit-type').some((t) => txt(t) === type)) ?? null;
  const creditText = (c: Element | null) => (c ? kids(c, 'credit-words').map(txt).filter(Boolean).join(' ') : '');
  const meaningful = (t: string) => (t.match(/\p{L}/gu)?.length ?? 0) >= 2;
  let title = [txt(kid(root, 'movement-title')), txt(path(root, 'work', 'work-title')), creditText(creditOf('title'))].find(meaningful) ?? '';
  if (!title) {
    // largest-font credit words with letters
    let bestSize = -1;
    for (const c of credits) {
      if (kids(c, 'credit-type').some((t) => /composer|lyricist|rights|arranger|page/.test(txt(t)))) continue;
      for (const w of kids(c, 'credit-words')) {
        const sz = parseFloat(w.getAttribute('font-size') ?? '0') || 0;
        if (meaningful(txt(w)) && sz > bestSize) {
          title = txt(w);
          bestSize = sz;
        }
      }
    }
  }
  title = title.replace(/\s+/g, ' ').trim() || 'Untitled';
  const creators = kids(kid(root, 'identification'), 'creator');
  let composer = txt(creators.find((c) => c.getAttribute('type') === 'composer')) || creditText(creditOf('composer'));
  if (!composer) {
    // e.g. a subtitle "Anton Bruckner (1824-1896)"
    for (const c of credits)
      for (const w of kids(c, 'credit-words')) if (!composer && /\(\s*\d{4}\s*[-–]\s*\d{4}\s*\)/.test(txt(w))) composer = txt(w);
  }
  composer = composer.replace(/\s+/g, ' ').trim();

  const noteCount = parts.reduce((s, p) => s + p.notes.length, 0);
  const lastEnd = Math.max(0, ...parts.flatMap((p) => p.notes.map((n) => n.start + n.dur)));
  const duration = Math.max(lastEnd, beatToTime(tempos, totalBeats));

  return {
    id: opts?.id ?? 'xml-' + hashString(`${title}|${composer}|${noteCount}|${totalBeats.toFixed(3)}`),
    title,
    composer,
    source: 'musicxml',
    parts,
    measures,
    keys,
    tempos,
    duration,
  };
}
