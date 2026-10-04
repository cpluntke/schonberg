// Robustness invariants for an imported Score (used by the corpus / hardening tests).
// Returns human-readable violations; an empty list means the score is safe for the player,
// scorer and section UI.
import type { Score, Section } from './types';

const TOL = 1e-6;

/** Error messages the importer may throw for genuinely unsupported input (shown to the user). */
export const USER_FACING_ERROR = /invalid musicxml|not a musicxml|no parts|no musicxml document|unsupported|no notes|not a midi|invalid midi|empty/i;

export function invariantViolations(score: Score, sections?: Section[]): string[] {
  const v: string[] = [];
  const fin = (x: number) => typeof x === 'number' && Number.isFinite(x);
  if (!fin(score.duration) || score.duration < 0) v.push(`duration ${score.duration}`);
  if (typeof score.title !== 'string' || !score.title) v.push('title missing');
  if (typeof score.composer !== 'string') v.push('composer not a string');

  // tempos
  if (!score.tempos.length) v.push('no tempo events');
  score.tempos.forEach((t, i) => {
    if (!fin(t.bpm) || t.bpm <= 0) v.push(`tempo ${i} bpm ${t.bpm}`);
    if (!fin(t.time) || !fin(t.beat)) v.push(`tempo ${i} time/beat not finite`);
    if (i && t.beat < score.tempos[i - 1].beat - TOL) v.push(`tempo ${i} out of order`);
  });
  score.keys.forEach((k, i) => {
    if (!fin(k.time) || !fin(k.beat)) v.push(`key ${i} not finite`);
    if (k.fifths < -7 || k.fifths > 7 || !Number.isInteger(k.fifths)) v.push(`key ${i} fifths ${k.fifths}`);
    if (i && k.time < score.keys[i - 1].time - TOL) v.push(`key ${i} out of order`);
  });

  // measures: contiguous from 0
  const ms = score.measures;
  if (!ms.length) v.push('no measures');
  ms.forEach((m, i) => {
    if (m.index !== i) v.push(`measure ${i} index ${m.index}`);
    if (![m.start, m.dur, m.startBeat, m.durBeats].every(fin)) v.push(`measure ${i} not finite`);
    if (!(m.durBeats > 0) || !(m.dur > 0)) v.push(`measure ${i} (${m.number}) non-positive length ${m.durBeats}`);
    if (typeof m.number !== 'string') v.push(`measure ${i} number not a string`);
    if (!m.timeSig.every((x) => fin(x) && x > 0)) v.push(`measure ${i} timeSig ${m.timeSig}`);
    if (i === 0 && (Math.abs(m.start) > TOL || Math.abs(m.startBeat) > TOL)) v.push('first measure does not start at 0');
    if (i > 0) {
      const p = ms[i - 1];
      if (Math.abs(p.startBeat + p.durBeats - m.startBeat) > 1e-6) v.push(`measure ${i} not contiguous (beats)`);
      if (Math.abs(p.start + p.dur - m.start) > 1e-6) v.push(`measure ${i} not contiguous (time)`);
    }
  });

  // parts / notes
  const ids = new Set<string>();
  for (const p of score.parts) {
    if (ids.has(p.id)) v.push(`duplicate part id ${p.id}`);
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name) v.push(`part ${p.id} has no name`);
    const sung = p.voiceType !== 'other';
    let prevEnd = -Infinity;
    p.notes.forEach((n, i) => {
      const tag = `${p.id}#${i}`;
      if (![n.start, n.dur, n.startBeat, n.durBeats, n.midi].every(fin)) v.push(`${tag} not finite`);
      if (!(n.dur > 0) || !(n.durBeats > 0)) v.push(`${tag} non-positive duration ${n.durBeats}`);
      if (!Number.isInteger(n.midi) || n.midi < 0 || n.midi > 127) v.push(`${tag} midi ${n.midi}`);
      if (n.start < -TOL) v.push(`${tag} negative start`);
      if (n.start + n.dur > score.duration + 1e-6) v.push(`${tag} ends after score duration`);
      if (!Number.isInteger(n.measure) || n.measure < 0 || n.measure >= ms.length) v.push(`${tag} measure ${n.measure}`);
      else {
        const m = ms[n.measure];
        if (n.startBeat < m.startBeat - 1e-6 || n.startBeat > m.startBeat + m.durBeats + 1e-6) v.push(`${tag} not inside its measure`);
      }
      if (i && n.start < p.notes[i - 1].start - TOL) v.push(`${tag} not sorted`);
      if (n.lyric !== undefined && typeof n.lyric !== 'string') v.push(`${tag} lyric not a string`);
      if (n.syllabic !== undefined && !['single', 'begin', 'middle', 'end'].includes(n.syllabic)) v.push(`${tag} syllabic ${n.syllabic}`);
      if (sung && n.startBeat < prevEnd - 1e-3) v.push(`${tag} overlaps previous note in sung part ${p.name}`);
      prevEnd = Math.max(prevEnd, n.startBeat + n.durBeats);
    });
    if (p.notes.length) {
      const midis = p.notes.map((n) => n.midi);
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of midis) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      if (p.low !== lo || p.high !== hi) v.push(`part ${p.id} low/high mismatch`);
    }
    for (const d of p.directions ?? []) if (!fin(d.time) || typeof d.text !== 'string') v.push(`part ${p.id} bad direction`);
  }

  // sections cover the measures without gaps or overlaps
  if (sections) {
    if (ms.length && !sections.length) v.push('no sections');
    let next = 0;
    sections.forEach((s, i) => {
      if (s.index !== i) v.push(`section ${i} index`);
      if (s.startMeasure !== next) v.push(`section ${i} starts at ${s.startMeasure}, expected ${next}`);
      if (s.endMeasure < s.startMeasure) v.push(`section ${i} empty`);
      if (!fin(s.start) || !fin(s.end) || s.end <= s.start) v.push(`section ${i} bad times`);
      if (typeof s.label !== 'string' || !s.label) v.push(`section ${i} no label`);
      next = s.endMeasure + 1;
    });
    if (sections.length && next !== ms.length) v.push(`sections end at ${next}, measures ${ms.length}`);
  }
  return v;
}
