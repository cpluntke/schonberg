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
/** Running averages in a row that must stay within 60¢ for a note to count as held (judgeFollowed). */
const STEADY_STRETCH = 5;
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
  const bins: Bins = new Map(pitches.map((p) => [p, { c: [], db: [], core: [], groups: [] }]));
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
    // half cycle at the end), and the note's last full cycle, so a drift towards the end isn't cut off.
    addGroups(b.groups, core);
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
  return verdicts(root, pitches, bins, tol, minN);
}

type Bins = Map<number, { c: number[]; db: number[]; core: number[]; groups: number[] }>;

/** Per-cycle averages of a sung note's core readings, for its steadiness (see judgePattern). */
function addGroups(groups: number[], core: number[]): void {
  for (let i = 0; i + GROUP <= core.length; i += GROUP) groups.push(core.slice(i, i + GROUP).reduce((x, y) => x + y, 0) / GROUP);
  if (core.length > GROUP && core.length % GROUP >= 4) groups.push(core.slice(-GROUP).reduce((x, y) => x + y, 0) / GROUP);
}

function verdicts(root: number, pitches: number[], bins: Bins, tol: number, minN: number): PatternResult {
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
  /** A new note starts when the average of the last `splitTail` readings is this far (semitones) from the note so far… */
  split: 1.0,
  splitTail: 6,
  /** …once the note so far has this many readings (about one vibrato cycle: its median is its centre). */
  splitAfter: 9,
  /** A sung note this near the expected one counts as it; how well it was sung is judged afterwards. */
  match: 0.8,
  /** …once it has settled: its running average (over ~180 ms) moved less than this over the last 80 ms (a slide or a flick through the note isn't singing it). */
  settledMax: 0.3,
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

interface Seg { ms: number[]; rs: Reading[]; ts: number[]; ref: number; t0: number; t1: number; step: number | null; wrongCounted: boolean; lastVoiced: number; seen: boolean }

/**
 * A sung note's pitch: the median of its last readings, each folded to the octave most of them are
 * in (relative to `ref`, the note expected), so a stray octave slip of the tracker — also on the very
 * first reading — doesn't move the note to another octave.
 */
function folded(ms: number[], ref: number): number[] {
  const octs = new Map<number, number>();
  for (const m of ms) { const o = Math.round((m - ref) / 12); octs.set(o, (octs.get(o) ?? 0) + 1); }
  let maj = 0;
  let best = -1;
  for (const [o, n] of octs) if (n > best || (n === best && Math.abs(o) < Math.abs(maj))) { best = n; maj = o; }
  return ms.map((m) => m - 12 * (Math.round((m - ref) / 12) - maj));
}
const centreOf = (s: Pick<Seg, 'ms' | 'ref'>) => median(folded(s.ms.slice(-25), s.ref));

/** Means over `w` readings ending at each of the last `n` readings (fewer when there are fewer readings). */
function runningMeans(xs: number[], w: number, n: number): number[] {
  const out: number[] = [];
  for (let e = Math.max(w, xs.length - n + 1); e <= xs.length; e++) out.push(xs.slice(e - w, e).reduce((a, x) => a + x, 0) / w);
  return out;
}

/** The note has settled: its running average (~180 ms, or what there is) barely moved over the last 80 ms. */
function settled(s: Pick<Seg, 'ms' | 'ref'>): boolean {
  const f = folded(s.ms.slice(-13), s.ref);
  if (f.length < 7) return false;
  const ms = runningMeans(f, Math.min(9, f.length - 4), 5);
  return ms.length >= 5 && Math.max(...ms) - Math.min(...ms) <= FOLLOW.settledMax;
}

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
  private matched: Reading[][] = [];
  /** Centre of the segment each step was matched with. */
  private matchedAt: number[] = [];
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
      if (this.seg && t - this.seg.lastVoiced > FOLLOW.gap) this.closeSeg(true);
    } else {
      this.voiced(r.midi, r, t);
    }
    if (!this.end) this.checkTime(t);
    return this.end;
  }

  /** The notes sung in order: the pattern note each was sung for, and its readings. */
  steps(): { pitch: number; rs: Reading[] }[] {
    return this.matched.map((rs, k) => ({ pitch: this.expected[k], rs })).filter((x) => x.rs);
  }

  /** The readings of the notes sung in order (a gap between notes), for judgePattern. */
  readings(): Reading[] {
    const out: Reading[] = [];
    for (const rs of this.matched) out.push(...rs, { midi: null, rms: 0 });
    return out;
  }

  private newSeg(ms: number[], rs: Reading[], ts: number[]): Seg {
    const ref = this.expected[Math.min(this.step, this.expected.length - 1)];
    return { ms, rs, ts, ref, t0: ts[0], t1: ts[ts.length - 1], step: null, wrongCounted: false, lastVoiced: ts[ts.length - 1], seen: false };
  }

  private voiced(m: number, r: Reading, t: number): void {
    const s = this.seg;
    if (!s) {
      this.seg = this.newSeg([m], [r], [t]);
      this.judgeSeg(t);
      return;
    }
    s.ms.push(m);
    s.rs.push(r);
    s.ts.push(t);
    s.t1 = t;
    s.lastVoiced = t;
    // A new note starts when the last ~120 ms (an average: vibrato, even a wide one, evens out)
    // sit a semitone or more from the note so far.
    const n = s.ms.length;
    if (n >= FOLLOW.splitAfter + FOLLOW.splitTail) {
      const all = folded(s.ms.slice(-25 - FOLLOW.splitTail), s.ref);
      const tail = all.slice(-FOLLOW.splitTail);
      const body = median(all.slice(0, -FOLLOW.splitTail));
      const avg = tail.reduce((a, x) => a + x, 0) / tail.length;
      if (Math.abs(avg - body) >= FOLLOW.split) {
        // The new note starts at the first of those readings already nearer it than the old note.
        const now = tail.slice(-3).reduce((a, x) => a + x, 0) / 3;
        const j = Math.max(0, tail.findIndex((x) => Math.abs(x - now) < Math.abs(x - body)));
        const k = n - FOLLOW.splitTail + j;
        const next = { ms: s.ms.splice(k), rs: s.rs.splice(k), ts: s.ts.splice(k) };
        s.t1 = s.ts[s.ts.length - 1];
        s.lastVoiced = s.t1;
        this.closeSeg(false);
        if (this.end) return;
        this.seg = this.newSeg(next.ms, next.rs, next.ts);
      }
    }
    this.judgeSeg(t);
  }

  /** A note held long enough: the next expected one, the one before (held again), or a wrong one. */
  private judgeSeg(t: number): void {
    const s = this.seg!;
    const dur = s.t1 - s.t0;
    if (dur < FOLLOW.settle) return;
    if (this.firstVoice === null) { this.firstVoice = s.t0; this.lastProgress = s.t0; }
    this.lastVoice = t;
    const c = centreOf(s);
    if (s.step !== null) {
      if (s.step === this.expected.length - 1 && dur >= FOLLOW.lastHold) this.end = 'done';
      return;
    }
    const want = this.expected[this.step];
    if (want !== undefined && Math.abs(c - want) <= FOLLOW.match && !settled(s)) return; // on its way: wait
    if (want !== undefined && Math.abs(c - want) <= FOLLOW.match) {
      s.step = this.step;
      if (s.wrongCounted) this.wrongs--; // (it was the scoop into this note)
      this.matched[this.step] = s.rs;
      this.matchedAt[this.step] = c;
      this.step++;
      this.lastProgress = t;
      if (s.step === this.expected.length - 1 && dur >= FOLLOW.lastHold) this.end = 'done';
      return;
    }
    const prev = this.expected[this.step - 1];
    if (prev !== undefined && Math.abs(c - prev) <= FOLLOW.match) {
      // The last note again: a new "la", or the note itself after a scoop into it was matched. The
      // one nearer the note stands for it (the scoop is the glide in, not the note).
      if (!s.seen) {
        s.seen = true;
        const k = this.step - 1;
        // (either way it is that note: the last one ends the answer like the first time)
        s.step = k;
        if (Math.abs(c - prev) < Math.abs(this.matchedAt[k] - prev)) {
          this.matched[k] = s.rs;
          this.matchedAt[k] = c;
        }
        if (k === this.expected.length - 1 && dur >= FOLLOW.lastHold) this.end = 'done';
      }
      return;
    }
    // All five sung, and now something else: the answer is over.
    if (this.step >= this.expected.length) { this.end = 'done'; return; }
    if (!s.wrongCounted && dur >= FOLLOW.wrongBrief) {
      s.wrongCounted = true;
      if (++this.wrongs >= FOLLOW.wrongCount) this.end = 'wrong';
    }
    if (dur >= FOLLOW.wrongHold) this.end = 'wrong';
  }

  /** `gap`: the voice stopped (else another note starts). */
  private closeSeg(gap: boolean): void {
    const s = this.seg;
    this.seg = null;
    // A short last note (too short to be judged while sung) that ends with the voice: it was sung.
    const last = this.expected.length - 1;
    if (s && gap && s.step === null && this.step === last && s.t1 - s.t0 >= 0.1 && Math.abs(centreOf(s) - this.expected[last]) <= FOLLOW.match) {
      s.step = last;
      this.matched[last] = s.rs;
      this.matchedAt[last] = centreOf(s);
      this.step++;
    }
    // The last note, sung and ended (the voice stopped, or it was held long enough): the answer is
    // complete. A short one followed by more voice may be a scoop into the last note: wait.
    if (s && s.step === this.expected.length - 1 && (gap || s.t1 - s.t0 >= FOLLOW.lastHold)) this.end = 'done';
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

/**
 * Judge a followed answer. Each sung note is judged against the note it was sung for (the follower
 * knows which), so a wide vibrato isn't split between two pattern notes; the scoop or glide into it is
 * left out up to where it settles (the last reading of its first part more than 50¢ off). As in judgePattern: a note sung
 * mostly in another octave isn't credited, steadiness from per-cycle averages. The notes of a round
 * not met count as reached at best ("shaky"), never as the steady range.
 */
export function judgeFollowed(root: number, f: PatternFollower, opts: { tolerance?: number; minReadings?: number } = {}): PatternResult {
  const pitches = [...new Set(PATTERN)].map((x) => root + x);
  const bins: Bins = new Map(pitches.map((p) => [p, { c: [], db: [], core: [], groups: [] }]));
  const unsteady = new Set<number>();
  for (const { pitch, rs } of f.steps()) {
    const b = bins.get(pitch);
    const voiced = rs.filter((r): r is { midi: number; rms: number } => r.midi !== null && Number.isFinite(r.midi));
    if (!b || !voiced.length) continue;
    let inOctave = 0;
    const c = voiced.map((r) => {
      const d = r.midi - pitch;
      const oct = Math.round(d / 12);
      if (oct === 0) inOctave++;
      return (d - 12 * oct) * 100;
    });
    if (inOctave * 2 < c.length) continue;
    const settled = median(c.slice(Math.floor(c.length / 3)));
    // (after the last reading of its first part still more than 50¢ off: a glide may pass through the note on its way)
    // (on a moving average over about a vibrato cycle, so a wide vibrato isn't taken for a glide)
    const avg = (i: number) => { const w = c.slice(Math.max(0, i - 4), i + 5); return w.reduce((x, y) => x + y, 0) / w.length; };
    let from = 0;
    for (let i = 0; i < Math.floor(c.length * 0.6); i++) if (Math.abs(avg(i) - settled) > 50) from = i + 1;
    const body = c.slice(from);
    const core = body.length >= GLIDE_OUT + 4 ? body.slice(0, body.length - GLIDE_OUT) : body;
    b.c.push(...c);
    b.db.push(...voiced.map((r) => 20 * Math.log10(Math.max(r.rms, 1e-5))));
    b.core.push(...core);
    addGroups(b.groups, core);
    // Held, not slid through: a stretch of ~0.26 s (five running averages over ~180 ms) within 60¢.
    const means = runningMeans(c, 9, c.length);
    let ok = false;
    for (let i = 0; i + STEADY_STRETCH <= means.length && !ok; i++) {
      const w = means.slice(i, i + STEADY_STRETCH);
      ok = Math.max(...w) - Math.min(...w) <= 60;
    }
    if (!ok) unsteady.add(pitch);
  }
  const v = verdicts(root, pitches, bins, opts.tolerance ?? 50, opts.minReadings ?? 4);
  // (a note never held is at best reached: 'shaky')
  const notes = v.notes.map((n) => (n.verdict === 'good' && unsteady.has(n.midi) ? { ...n, verdict: 'shaky' as Verdict } : n));
  const r = { ...v, notes, verdict: v.verdict === 'good' && notes.some((n) => n.verdict !== 'good') ? 'shaky' as Verdict : v.verdict };
  if (f.end === 'done') return r;
  return { ...r, verdict: 'missed', unmet: f.end ?? 'slow', notes: r.notes.map((n) => (n.verdict === 'good' ? { ...n, verdict: 'shaky' as Verdict } : n)) };
}
