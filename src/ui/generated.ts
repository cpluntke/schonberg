// Generated practice pieces (entry drills, 12-tone rows, leap drills). Their ids encode how to
// rebuild them, so deep links and reloads keep working.
import type { Score, ScoreNote, Measure, Part } from '../music/types';
import { getPiece, registerResolver, makePiece, chosenPartId, type PieceInfo } from './library';
import { entryDrill } from './excerpt';
import { rowOfTheDay, rowForms, rowToScore } from '../game/twelvetone';
import { hardestIntervals } from '../game/drills';
import { intervalName } from '../game/notation';
import { loadCycle, loadProfile } from '../progress/store';

const VOICE_RANGE: Record<string, [number, number]> = { S: [62, 77], A: [57, 72], T: [50, 65], B: [45, 60], other: [55, 70] };

export function dayId(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function dateFromId(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}

export function singerRange(): [number, number] {
  const p = loadProfile();
  if (p.rangeLow && p.rangeHigh && p.rangeHigh - p.rangeLow >= 12) return [p.rangeLow + 2, p.rangeHigh - 2];
  return VOICE_RANGE[p.voice] ?? VOICE_RANGE.other;
}

export const ROW_FORMS = ['P0', 'R0', 'I0', 'RI0'];

export function rowPiece(date: Date, form: string): PieceInfo {
  const row = rowOfTheDay(date);
  const forms = rowForms(row);
  const chosen = forms[form] ?? row;
  const [lo, hi] = singerRange();
  const id = dayId(date);
  const score = rowToScore(chosen, { low: lo, high: hi, seed: Number(id), date });
  score.id = `row-${id}-${form}`;
  score.title = `Zwölfton ${form}`;
  return makePiece(score, { builtin: true, title: score.title, composer: `Row of ${date.toLocaleDateString()}` });
}

/** One-part drill score from (from, to) note pairs, one pair per bar. */
export function leapDrillScore(id: string, title: string, pairs: { a: number; b: number; label: string }[], bpm = 66): Score {
  const q = 60 / bpm;
  const notes: ScoreNote[] = [];
  const measures: Measure[] = [];
  pairs.forEach((p, i) => {
    const t0 = i * 4 * q;
    measures.push({ index: i, number: String(i + 1), startBeat: i * 4, durBeats: 4, start: t0, dur: 4 * q, timeSig: [4, 4] });
    notes.push({ midi: p.a, start: t0, dur: 1.5 * q, startBeat: i * 4, durBeats: 1.5, measure: i, lyric: p.label, syllabic: 'single' });
    notes.push({ midi: p.b, start: t0 + 1.5 * q, dur: 1.5 * q, startBeat: i * 4 + 1.5, durBeats: 1.5, measure: i, lyric: '↦', syllabic: 'single' });
  });
  const ms = notes.map((n) => n.midi);
  const part: Part = { id: 'drill', name: 'Leaps', voiceType: 'other', notes, low: Math.min(...ms), high: Math.max(...ms) };
  return {
    id, title, composer: 'From your repertoire', source: 'builtin', parts: [part], measures,
    keys: [{ beat: 0, time: 0, fifths: 0, mode: 'major' }], tempos: [{ beat: 0, time: 0, bpm }], duration: pairs.length * 4 * q,
  };
}

export interface Leap {
  a: number; b: number; label: string; where: string;
  /** Where it is in the singer's music: the piece, the part and the bar (0-based) the leap lands in. */
  pieceId: string; partId: string; measure: number;
}

export function cycleLeaps(max = 12): Leap[] {
  const profile = loadProfile();
  const leaps: Leap[] = [];
  for (const id of loadCycle().pieceIds) {
    const pc = getPiece(id);
    if (!pc) continue;
    const part = pc.score.parts.find((x) => x.id === chosenPartId(pc, profile.voice));
    if (!part) continue;
    for (const h of hardestIntervals(part, 4)) {
      const a = part.notes[h.index - 1];
      const b = part.notes[h.index];
      if (!a || !b) continue;
      leaps.push({
        a: a.midi, b: b.midi,
        label: `${h.semitones > 0 ? '↑' : '↓'}${intervalName(Math.abs(h.semitones))}`,
        where: `${pc.title}, bar ${pc.score.measures[h.measure]?.number ?? h.measure + 1}`,
        pieceId: pc.id, partId: part.id, measure: h.measure,
      });
    }
  }
  return leaps.slice(0, max);
}

export function leapPiece(date = new Date()): PieceInfo | undefined {
  const pairs = cycleLeaps();
  if (!pairs.length) return undefined;
  const score = leapDrillScore(`leaps-${dayId(date)}`, 'Leap drill', pairs);
  return makePiece(score, { builtin: true, title: 'Leap drill', composer: 'Hardest intervals of your parts' });
}

export function entryPiece(base: PieceInfo, partId: string): PieceInfo | undefined {
  const s = entryDrill(base.score, partId);
  if (!s) return undefined;
  return makePiece(s, { builtin: true, title: `Entries: ${base.title}`, composer: base.composer });
}

registerResolver((id) => {
  let m = /^row-(\d{8})-(P0|R0|I0|RI0)$/.exec(id);
  if (m) {
    const d = dateFromId(m[1]);
    return d ? rowPiece(d, m[2]) : undefined;
  }
  m = /^leaps-(\d{8})$/.exec(id);
  if (m) return leapPiece(dateFromId(m[1]) ?? new Date());
  const k = id.indexOf('~entries~');
  if (k > 0) {
    const base = getPiece(id.slice(0, k));
    return base ? entryPiece(base, id.slice(k + 9)) : undefined;
  }
  return undefined;
});
