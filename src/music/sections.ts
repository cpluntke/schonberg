// Split a score into practice sections (phrases).
// Hard boundaries: rehearsal marks and double bars. Long stretches are split into phrases of
// ~targetBars (4..12) preferring barlines where the voices rest or hold a long note.
import type { Score, Section } from './types';

const MIN_BARS = 4;
const MAX_BARS = 12;

/** 0..1: how good a phrase boundary the barline before measure `m` is. */
function boundaryQuality(score: Score, m: number): number {
  const B = score.measures[m]?.startBeat;
  if (B === undefined) return 1;
  let parts = score.parts.filter((p) => p.voiceType !== 'other' && p.notes.length);
  if (!parts.length) parts = score.parts.filter((p) => p.notes.length);
  if (!parts.length) return 0.5;
  let sum = 0;
  for (const p of parts) {
    let q = 0.1;
    let crossing = false;
    let lastEnding: (typeof p.notes)[number] | undefined;
    let next: (typeof p.notes)[number] | undefined;
    for (const n of p.notes) {
      const end = n.startBeat + n.durBeats;
      if (n.startBeat < B - 1e-6 && end > B + 1e-6) crossing = true;
      if (end <= B + 1e-6) lastEnding = n;
      if (n.startBeat >= B - 1e-6 && !next) next = n;
    }
    if (crossing) q = 0;
    else {
      const restBefore = !lastEnding || lastEnding.startBeat + lastEnding.durBeats < B - 0.24;
      const restAfter = !next || next.startBeat > B + 0.24;
      if (restBefore || restAfter) q = 1;
      else if (lastEnding!.durBeats >= 2) q = 0.7;
      else if (lastEnding!.durBeats >= 1) q = 0.4;
    }
    sum += q;
  }
  return sum / parts.length;
}

function splitSegment(score: Score, a: number, b: number, target: number, scale: number): [number, number][] {
  const n = b - a + 1;
  const MIN = MIN_BARS * scale;
  const MAX = MAX_BARS * scale;
  if (n <= MAX && n <= Math.round(target * 1.5)) return [[a, b]];
  // DP over chunk boundaries
  const best: number[] = new Array(n + 1).fill(Infinity);
  const prev: number[] = new Array(n + 1).fill(-1);
  best[0] = 0;
  const qCache = new Map<number, number>();
  const q = (m: number) => {
    if (!qCache.has(m)) qCache.set(m, boundaryQuality(score, m));
    return qCache.get(m)!;
  };
  for (let i = 1; i <= n; i++) {
    for (let len = MIN; len <= MAX && len <= i; len++) {
      const j = i - len;
      if (best[j] === Infinity) continue;
      let cost = best[j] + ((len - target) / (2 * scale)) ** 2;
      if (i < n) cost += 3 * (1 - q(a + i));
      if (cost < best[i]) {
        best[i] = cost;
        prev[i] = j;
      }
    }
  }
  if (best[n] === Infinity) return [[a, b]];
  const out: [number, number][] = [];
  for (let i = n; i > 0; i = prev[i]) out.unshift([a + prev[i], a + i - 1]);
  return out;
}

export function computeSections(score: Score, opts?: { targetBars?: number }): Section[] {
  const ms = score.measures;
  if (!ms.length) return [];
  const scale = 1; // hook for meter-dependent phrase lengths (kept at 1: phrases are 4–12 bars)
  const target = Math.max(MIN_BARS, Math.min(MAX_BARS, opts?.targetBars ?? 8)) * scale;

  // hard segments
  let segs: { a: number; b: number; mark?: string }[] = [];
  let start = 0;
  for (let i = 1; i <= ms.length; i++) {
    const hard = i === ms.length || !!ms[i].rehearsalMark || !!ms[i - 1].doubleBar;
    if (hard) {
      segs.push({ a: start, b: i - 1, mark: ms[start].rehearsalMark });
      start = i;
    }
  }
  // no 1-bar segments: merge into the following segment (or previous if last)
  const merged: typeof segs = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.b - s.a + 1 < 2 && segs.length > 1) {
      if (i + 1 < segs.length) {
        segs[i + 1] = { a: s.a, b: segs[i + 1].b, mark: segs[i + 1].mark ?? s.mark };
        continue;
      }
      const p = merged[merged.length - 1];
      if (p) {
        p.b = s.b;
        continue;
      }
    }
    merged.push({ ...s });
  }
  segs = merged;
  // short unmarked segments (2–3 bars between double bars) join a neighbour when that stays ≤ MAX
  for (let i = 0; i < segs.length && segs.length > 1; i++) {
    const s = segs[i];
    const len = s.b - s.a + 1;
    if (len >= MIN_BARS * scale) continue;
    const prev = segs[i - 1];
    const next = segs[i + 1];
    if (prev && !s.mark && s.b - prev.a + 1 <= MAX_BARS * scale) {
      prev.b = s.b;
      segs.splice(i--, 1);
    } else if (next && !next.mark && next.b - s.a + 1 <= MAX_BARS * scale) {
      next.a = s.a;
      next.mark = s.mark;
      segs.splice(i--, 1);
    }
  }

  const sections: Section[] = [];
  const barLabel = (a: number, b: number) => {
    const na = ms[a].number;
    const nb = ms[b].number;
    return a === b ? `Bar ${na}` : `Bars ${na}–${nb}`;
  };
  for (const s of segs) {
    const chunks = splitSegment(score, s.a, s.b, target, scale);
    chunks.forEach(([a, b]) => {
      let label: string;
      if (s.mark) label = chunks.length === 1 ? s.mark : `${s.mark} · ${barLabel(a, b)}`;
      else label = barLabel(a, b);
      const index = sections.length;
      sections.push({
        id: `s${index}-m${a}-${b}`,
        index,
        label,
        startMeasure: a,
        endMeasure: b,
        start: ms[a].start,
        end: ms[b].start + ms[b].dur,
      });
    });
  }
  return sections;
}
