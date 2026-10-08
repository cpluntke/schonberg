// Voice range check as a guided exercise: the app plays a short pattern (1-2-3-2-1), the singer
// sings it back at their own pace, a step higher (or lower) each round. The answer is followed note
// by note (PatternFollower): it ends when all five notes were sung in order, or as not met when a
// clearly different note is held, nothing is heard, or it takes too long. Each round is judged for
// pitch, steadiness and loudness, so the range we keep is where the voice is still in tune and
// steady, not the highest squeak.

/** Semitones of the pattern above its root: do-re-mi-re-do. */
export const PATTERN = [0, 2, 4, 2, 0];
/** Seconds per pattern note: slow enough to settle on each note, also at the top of the range. */
export const NOTE_SEC = 0.75;
/** Readings (20 ms each) at the start and end of each sung note that are the glide in and out. */
const GLIDE_IN = 5;
const GLIDE_OUT = 3;
/** Steadiness limit (cents): half the range of the note's ~180 ms pitch averages. */
export const STEADY_MAX = 30;
/** Readings per average: about one vibrato cycle (9 × 20 ms), so an even vibrato averages out. */
const GROUP = 9;
/** Semitones between rounds. */
export const STEP = 2;

export interface Reading { midi: number | null; rms: number }

export type Verdict = 'good' | 'shaky' | 'missed';

export interface PatternResult {
  root: number;
  /** The answer did not get through the pattern (the round is not met, verdict 'missed'). */
  unmet?: FollowEnd;
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
  const bins = new Map<number, { c: number[]; db: number[]; core: number[]; groups: number[] }>(pitches.map((p) => [p, { c: [], db: [], core: [], groups: [] }]));
  // Readings arrive in time order: consecutive readings on the same pitch form one sung note. The
  // glide into and out of each note is left out of the pitch and steadiness judgement (it's how
  // anyone moves between notes, and it gets wider high up), as long as enough of the note is left.
  // Each sung note must be in the pattern's octave: a note sung an octave down (or up) isn't the
  // note asked for, so it isn't credited. Within a note sung in the right octave, the tracker's
  // brief octave slips are folded back.
  let run: { pitch: number; c: number[]; db: number[]; inOctave: number } | null = null;
  const closeRun = () => {
    if (!run) return;
    const r = run;
    run = null;
    if (r.inOctave * 2 < r.c.length) return;
    const b = bins.get(r.pitch)!;
    b.c.push(...r.c);
    b.db.push(...r.db);
    const core = r.c.length >= GLIDE_IN + GLIDE_OUT + 4 ? r.c.slice(GLIDE_IN, r.c.length - GLIDE_OUT) : r.c;
    b.core.push(...core);
    // Averages over whole vibrato cycles within this sung note (never across two notes, never a
    // half cycle at the end).
    for (let i = 0; i + GROUP <= core.length; i += GROUP) b.groups.push(core.slice(i, i + GROUP).reduce((x, y) => x + y, 0) / GROUP);
    // …and the note's last full cycle, so a drift towards the end isn't cut off.
    if (core.length > GROUP && core.length % GROUP >= 4) b.groups.push(core.slice(-GROUP).reduce((x, y) => x + y, 0) / GROUP);
  };
  for (const r of readings) {
    if (r.midi === null || !Number.isFinite(r.midi)) { closeRun(); continue; }
    // Readings are matched to the nearest pattern pitch class (octave slips of the tracker are
    // folded, see above); anything more than a semitone from every pattern pitch is ignored
    // (glides, other sounds).
    let best: number | null = null;
    let bestD = Infinity;
    let bestOct = 0;
    for (const p of pitches) {
      let d = r.midi - p;
      const oct = Math.round(d / 12);
      d -= 12 * oct;
      if (Math.abs(d) < Math.abs(bestD)) { bestD = d; best = p; bestOct = oct; }
    }
    if (best === null || Math.abs(bestD) > 1) { closeRun(); continue; }
    if (run && run.pitch !== best) closeRun();
    if (!run) run = { pitch: best, c: [], db: [], inOctave: 0 };
    run.c.push(bestD * 100);
    run.db.push(20 * Math.log10(Math.max(r.rms, 1e-5)));
    if (bestOct === 0) run.inOctave++;
  }
  closeRun();
  const notes = pitches.map((p) => {
    const b = bins.get(p)!;
    if (b.c.length < minN) return { midi: p, cents: null, spread: null, db: null, verdict: 'missed' as Verdict };
    const core = b.core.length >= minN ? b.core : b.c;
    const cents = median(core);
    // How far the held pitch wanders: half the range of its per-cycle averages (a drift through
    // the note or a slow wobble shows up; an even vibrato averages out).
    const groups = b.groups;
    const spread = groups.length >= 2 ? (Math.max(...groups) - Math.min(...groups)) / 2 : median(core.map((x) => Math.abs(x - cents))) / 2;
    const verdict: Verdict = Math.abs(cents) <= tol && spread <= STEADY_MAX ? 'good' : 'shaky';
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

// ------------------------------------------------------------------ the answer, at the singer's own pace

/** Limits for following a sung-back pattern (seconds, semitones). */
export const FOLLOW = {
  /** A pitch held this long is a sung note (shorter ones are the glide between notes). */
  settle: 0.14,
  /** Readings within this many semitones of a note's running median belong to it (vibrato, scoops). */
  hold: 0.6,
  /** A sung note this near the expected one counts as it; how well it was sung is judged afterwards. */
  match: 0.8,
  /** A different note held this long is clearly wrong… */
  wrongHold: 0.5,
  /** …and so are this many different notes held at least `wrongBrief`. */
  wrongCount: 2,
  wrongBrief: 0.25,
  /** No note sung within this long after the cue. */
  startWithin: 6,
  /** A pause this long before the last note: the answer stopped. */
  silenceMax: 2.5,
  /** This long without getting to the next note: stuck (e.g. a note out of reach). */
  stallMax: 5,
  /** The whole answer. */
  total: 20,
  /** The last note is complete after this long (or when the voice stops). */
  lastHold: 0.4,
  /** A gap in the voice longer than this ends a sung note (a new "la"). */
  gap: 0.12,
} as const;

/** How an answer ended: all five notes in order, or not met (a different note, nothing, stopped, too slow). */
export type FollowEnd = 'done' | 'wrong' | 'silent' | 'stopped' | 'slow';

interface Seg { xs: number[]; rs: Reading[]; t0: number; t1: number; step: number | null; wrongCounted: boolean; lastVoiced: number }

const fold = (m: number, around: number) => m - 12 * Math.round((m - around) / 12);
const centre = (xs: number[]) => median(xs.slice(-25));

/**
 * Follows a sung-back pattern reading by reading (any tempo): which of the expected notes have been
 * sung, in order, and when the answer is over. Readings are the tracker's, about every 20 ms, with
 * their time in seconds since the cue.
 */
export class PatternFollower {
  readonly expected: number[];
  /** Expected notes sung so far, in order. */
  step = 0;
  end: FollowEnd | null = null;
  private seg: Seg | null = null;
  private pending: { m: number; r: Reading; t: number }[] = [];
  private matched: Reading[][] = [];
  private wrongs = 0;
  private firstVoice: number | null = null;
  private lastVoice = 0;
  private lastProgress = 0;

  constructor(expected: number[]) {
    this.expected = expected;
  }

  push(r: Reading, t: number): FollowEnd | null {
    if (this.end) return this.end;
    if (r.midi === null || !Number.isFinite(r.midi)) {
      this.pending = [];
      if (this.seg && t - this.seg.lastVoiced > FOLLOW.gap) this.closeSeg();
    } else {
      this.voiced(r.midi, r, t);
    }
    if (!this.end) this.checkTime(t);
    return this.end;
  }

  /** The readings of the notes sung in order (a gap between notes), for judgePattern. */
  readings(): Reading[] {
    const out: Reading[] = [];
    for (const rs of this.matched) out.push(...rs, { midi: null, rms: 0 });
    return out;
  }

  private voiced(m: number, r: Reading, t: number): void {
    const s = this.seg;
    if (s) {
      const c = centre(s.xs);
      const f = fold(m, c);
      if (Math.abs(f - c) <= FOLLOW.hold) {
        // (a reading or two that strayed and came back were a glitch: they stay in the note)
        for (const p of this.pending) { s.xs.push(fold(p.m, c)); s.rs.push(p.r); }
        this.pending = [];
        s.xs.push(f);
        s.rs.push(r);
        s.t1 = t;
        s.lastVoiced = t;
        this.judgeSeg(t);
        return;
      }
      // Three readings in a row away from the note (and together): a new note starts.
      this.pending.push({ m, r, t });
      const pc = median(this.pending.map((p) => p.m));
      if (this.pending.some((p) => Math.abs(fold(p.m, pc) - pc) > FOLLOW.hold)) this.pending = this.pending.slice(-1);
      if (this.pending.length < 3) return;
      this.closeSeg();
      if (this.end) return;
    } else {
      this.pending.push({ m, r, t });
    }
    const pc = median(this.pending.map((p) => p.m));
    this.seg = {
      xs: this.pending.map((p) => fold(p.m, pc)), rs: this.pending.map((p) => p.r),
      t0: this.pending[0].t, t1: t, step: null, wrongCounted: false, lastVoiced: t,
    };
    this.pending = [];
    this.judgeSeg(t);
  }

  /** A note held long enough: the next expected one, the one before (held again), or a wrong one. */
  private judgeSeg(t: number): void {
    const s = this.seg!;
    const dur = s.t1 - s.t0;
    if (dur < FOLLOW.settle) return;
    if (this.firstVoice === null) { this.firstVoice = s.t0; this.lastProgress = s.t0; }
    this.lastVoice = t;
    const c = centre(s.xs);
    if (s.step !== null) {
      if (s.step === this.expected.length - 1 && dur >= FOLLOW.lastHold) this.end = 'done';
      return;
    }
    const want = this.expected[this.step];
    if (want !== undefined && Math.abs(c - want) <= FOLLOW.match) {
      s.step = this.step;
      if (s.wrongCounted) this.wrongs--; // (it was the scoop into this note)
      this.matched[this.step] = s.rs;
      this.step++;
      this.lastProgress = t;
      if (s.step === this.expected.length - 1 && dur >= FOLLOW.lastHold) this.end = 'done';
      return;
    }
    const prev = this.expected[this.step - 1];
    if (prev !== undefined && Math.abs(c - prev) <= FOLLOW.match) return; // the last note again (a new "la")
    if (!s.wrongCounted && dur >= FOLLOW.wrongBrief) {
      s.wrongCounted = true;
      if (++this.wrongs >= FOLLOW.wrongCount) this.end = 'wrong';
    }
    if (dur >= FOLLOW.wrongHold) this.end = 'wrong';
  }

  private closeSeg(): void {
    const s = this.seg;
    this.seg = null;
    // The last note, sung and ended: the answer is complete.
    if (s && s.step === this.expected.length - 1) this.end = 'done';
  }

  private checkTime(t: number): void {
    if (this.firstVoice === null) {
      if (t > FOLLOW.startWithin) this.end = 'silent';
      return;
    }
    if (t > FOLLOW.total || t - this.lastProgress > FOLLOW.stallMax) this.end = 'slow';
    else if (t - this.lastVoice > FOLLOW.silenceMax) this.end = 'stopped';
  }
}

/** Judge a followed answer: as before when all five notes were sung in order, else not met. */
export function judgeFollowed(root: number, f: PatternFollower): PatternResult {
  const r = judgePattern(root, f.readings());
  return f.end === 'done' ? r : { ...r, verdict: 'missed', unmet: f.end ?? 'slow' };
}
