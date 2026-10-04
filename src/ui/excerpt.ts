// Build drill scores out of excerpts of a real score (e.g. every entry of your part after a rest).
import type { Score, ScoreNote, Measure, Part } from '../music/types';
import { entryNotes } from '../game/drills';

export interface Window { from: number; to: number; label: string }

/**
 * Concatenate time windows of `score` into a new score. Each window becomes one "measure";
 * windows are separated by `gap` seconds of silence. Notes are clipped to their window.
 */
export function excerptScore(score: Score, windows: Window[], opts: { id: string; title: string; gap?: number }): Score {
  const gap = opts.gap ?? 1.2;
  const bpm = score.tempos[0]?.bpm ?? 90;
  const q = 60 / bpm;
  const measures: Measure[] = [];
  const parts: Part[] = score.parts.map((p) => ({ ...p, notes: [] as ScoreNote[] }));
  let t = 0;
  windows.forEach((w, wi) => {
    const len = w.to - w.from;
    measures.push({
      index: wi, number: w.label, startBeat: t / q, durBeats: (len + gap) / q, start: t, dur: len + gap, timeSig: [4, 4],
    });
    score.parts.forEach((p, pi) => {
      for (const n of p.notes) {
        const s = Math.max(n.start, w.from);
        const e = Math.min(n.start + n.dur, w.to);
        if (e - s < 0.05) continue;
        parts[pi].notes.push({
          ...n,
          start: t + (s - w.from),
          dur: e - s,
          startBeat: (t + (s - w.from)) / q,
          durBeats: (e - s) / q,
          measure: wi,
          lyric: s > n.start + 1e-6 ? undefined : n.lyric,
        });
      }
    });
    t += len + gap;
  });
  for (const p of parts) {
    const ms = p.notes.map((n) => n.midi);
    p.low = ms.length ? Math.min(...ms) : 0;
    p.high = ms.length ? Math.max(...ms) : 0;
  }
  return {
    ...score,
    id: opts.id,
    title: opts.title,
    source: 'builtin',
    parts,
    measures,
    keys: [{ ...(score.keys[0] ?? { fifths: 0, mode: 'major' as const }), beat: 0, time: 0 }],
    tempos: [{ beat: 0, time: 0, bpm }],
    duration: t,
  };
}

/**
 * Entry drill: for each entry of `partId` after a rest, take the 2 beats of harmony before it
 * plus the first ~1.5 s of the entry. Practised with your own part muted.
 */
export function entryDrill(score: Score, partId: string, max = 10): Score | null {
  const part = score.parts.find((p) => p.id === partId);
  if (!part) return null;
  const bpm = score.tempos[0]?.bpm ?? 90;
  const lead = Math.max(1.2, 2 * (60 / bpm));
  const idx = entryNotes(part, 0.6);
  // The first note of the piece is an entry too.
  if (part.notes.length && !idx.includes(0)) idx.unshift(0);
  const windows: Window[] = [];
  for (const i of idx.slice(0, max)) {
    const n = part.notes[i];
    const from = Math.max(0, n.start - lead);
    let to = n.start + Math.min(1.6, Math.max(0.6, n.dur));
    // include a following quick note or two so it's musical
    for (let k = i + 1; k < part.notes.length && part.notes[k].start < n.start + 1.6; k++) to = Math.max(to, Math.min(part.notes[k].start + part.notes[k].dur, n.start + 2.2));
    const m = score.measures[n.measure]?.number ?? String(n.measure + 1);
    windows.push({ from, to, label: `b.${m}` });
  }
  if (!windows.length) return null;
  return excerptScore(score, windows, { id: `${score.id}~entries~${partId}`, title: `Entries: ${score.title}` });
}
