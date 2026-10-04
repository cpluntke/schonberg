// Voice range check as a guided exercise: the app plays a short pattern (1-2-3-2-1), the singer
// sings it back, a step higher (or lower) each round. Each round is judged for pitch, steadiness
// and loudness, so the range we keep is where the voice is still in tune and steady, not the
// highest squeak.

/** Semitones of the pattern above its root: do-re-mi-re-do. */
export const PATTERN = [0, 2, 4, 2, 0];
/** Seconds per pattern note. */
export const NOTE_SEC = 0.45;
/** Semitones between rounds. */
export const STEP = 2;

export interface Reading { midi: number | null; rms: number }

export type Verdict = 'good' | 'shaky' | 'missed';

export interface PatternResult {
  root: number;
  /** Per distinct pitch of the pattern (root, +2, +4): what the singer did. */
  notes: { midi: number; cents: number | null; spread: number | null; db: number | null; verdict: Verdict }[];
  verdict: Verdict;
  /** Median loudness of the sung notes (dB). */
  db: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Judge a sung-back pattern from the readings of the response window. Readings are sorted to the
 * nearest pattern pitch (timing doesn't matter, the pitches are distinct); each pitch needs enough
 * readings, a small median error and a steady tone.
 */
export function judgePattern(root: number, readings: Reading[], opts: { tolerance?: number; minReadings?: number } = {}): PatternResult {
  const tol = opts.tolerance ?? 50;
  const minN = opts.minReadings ?? 4;
  const pitches = [...new Set(PATTERN)].map((x) => root + x);
  const bins = new Map<number, { c: number[]; db: number[] }>(pitches.map((p) => [p, { c: [], db: [] }]));
  for (const r of readings) {
    if (r.midi === null || !Number.isFinite(r.midi)) continue;
    // Octave slips of the tracker are folded; anything more than a semitone from every pattern
    // pitch is ignored (glides, other sounds).
    let best: number | null = null;
    let bestD = Infinity;
    for (const p of pitches) {
      let d = r.midi - p;
      d -= 12 * Math.round(d / 12);
      if (Math.abs(d) < Math.abs(bestD)) { bestD = d; best = p; }
    }
    if (best === null || Math.abs(bestD) > 1) continue;
    bins.get(best)!.c.push(bestD * 100);
    bins.get(best)!.db.push(20 * Math.log10(Math.max(r.rms, 1e-5)));
  }
  const notes = pitches.map((p) => {
    const b = bins.get(p)!;
    if (b.c.length < minN) return { midi: p, cents: null, spread: null, db: null, verdict: 'missed' as Verdict };
    const cents = median(b.c);
    const spread = median(b.c.map((x) => Math.abs(x - cents)));
    const verdict: Verdict = Math.abs(cents) <= tol && spread <= 30 ? 'good' : 'shaky';
    return { midi: p, cents: Math.round(cents), spread: Math.round(spread), db: Math.round(median(b.db)), verdict };
  });
  const verdict: Verdict = notes.some((n) => n.verdict === 'missed') ? (notes.every((n) => n.verdict === 'missed') ? 'missed' : 'shaky')
    : notes.every((n) => n.verdict === 'good') ? 'good' : 'shaky';
  const dbs = notes.map((n) => n.db).filter((x): x is number => x !== null);
  return { root, notes, verdict, db: dbs.length ? Math.round(median(dbs)) : null };
}

/** Next round going up (+) or down (−) from the last; stop after two poor rounds in a row. */
export function shouldStop(results: PatternResult[]): boolean {
  const n = results.length;
  if (n < 2) return n === 1 && results[0].verdict === 'missed';
  return results[n - 1].verdict !== 'good' && results[n - 2].verdict !== 'good';
}

export interface RangeSummary {
  /** In tune and steady (the range the app uses). */
  steady: { lo: number; hi: number } | null;
  /** Reached, but less steady or quiet. */
  reach: { lo: number; hi: number } | null;
  /** Per note: best verdict seen. */
  notes: Map<number, Verdict>;
}

/** Combine all rounds: the steady range is where the notes were sung well. */
export function summarize(rounds: PatternResult[]): RangeSummary {
  const notes = new Map<number, Verdict>();
  const rank: Record<Verdict, number> = { good: 2, shaky: 1, missed: 0 };
  for (const r of rounds) for (const n of r.notes) {
    const cur = notes.get(n.midi);
    if (cur === undefined || rank[n.verdict] > rank[cur]) notes.set(n.midi, n.verdict);
  }
  const good = [...notes].filter(([, v]) => v === 'good').map(([m]) => m);
  const sung = [...notes].filter(([, v]) => v !== 'missed').map(([m]) => m);
  return {
    steady: good.length ? { lo: Math.min(...good), hi: Math.max(...good) } : null,
    reach: sung.length ? { lo: Math.min(...sung), hi: Math.max(...sung) } : null,
    notes,
  };
}

/** Voice type whose usual range best fits a sung range. */
export function suggestVoice(lo: number, hi: number): 'S' | 'A' | 'T' | 'B' {
  const mid = (lo + hi) / 2;
  if (mid >= 67) return 'S';
  if (mid >= 61) return 'A';
  if (mid >= 54) return 'T';
  return 'B';
}
