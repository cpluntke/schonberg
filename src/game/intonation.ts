// The intonation lab: finding a pure (just) fifth and major third by ear.
//
// Two notes that are nearly in tune "beat": a pair of their overtones lands a few hertz apart and
// the sound pulses. For a fifth (3:2) the root's 3rd partial meets the fifth's 2nd; for a major
// third (5:4) the root's 5th meets the third's 4th. Pure = the pulse stops. The lab shows that pulse
// (how much, never which way) instead of a tuning needle.
//
// Each interval is a ladder (docs/INTONATION.md): listen, tune by hand, sing with the pulse shown,
// sing it by ear, sing it in a chord.

import type { VoiceType } from '../music/types';
import { loadCycle, rawGet, rawSet } from '../progress/store';
import { addDays, dayOf } from '../progress/today';

export type LabInterval = 'fifth' | 'third';
/** A chord tone, as scale degrees of a major triad. */
export type Degree = 'do' | 'mi' | 'sol';

/** Pure ratios of the triad's tones above do. */
export const RATIO: Record<Degree, [number, number]> = { do: [1, 1], mi: [5, 4], sol: [3, 2] };
/** Equal-tempered (piano) semitones above do. */
export const ET_SEMIS: Record<Degree, number> = { do: 0, mi: 4, sol: 7 };

export const INTERVAL_DEGREE: Record<LabInterval, Degree> = { fifth: 'sol', third: 'mi' };

/**
 * The lab's id in a choir's programme (a cycle's pieceIds): an admin adds it like a piece, and the
 * choir's singers get it while that cycle runs. Not a score: everything that lists the programme's
 * scores skips it (getPiece knows no such id).
 */
export const LAB_ID = 'lab:intonation';
export const LAB_TITLE = 'Intonation lab';
/** In this phone's programme from its choir (the running cycle)? */
export const labInProgramme = () => {
  const c = loadCycle();
  return !!c.preset?.startsWith('choir:') && c.pieceIds.includes(LAB_ID);
};
/** The programme's pieces without the lab (for counts). */
export const scoresOf = (ids: string[]) => ids.filter((id) => id !== LAB_ID);

export const cents = (ratio: number) => 1200 * Math.log2(ratio);
/** The pure tone's distance from do (cents): 0, 386.3, 702.0. */
export const pureCents = (d: Degree) => cents(RATIO[d][0] / RATIO[d][1]);
/** The piano's (cents): 0, 400, 700. */
export const pianoCents = (d: Degree) => ET_SEMIS[d] * 100;

export const RUNGS = 5;
export const RUNG_NAMES = ['Listen', 'Tune it by hand', 'Sing it, with the wobble', 'Sing it by ear', 'In the chord'] as const;

/** Rounds that count towards a rung (the last ROUNDS), and how many of them must be pure. */
export const ROUNDS = 4;
export const PASS = 3;
/** "Pure" when tuning by hand (cents). */
export const TOL_HAND = 5;
/** "Pure" when singing: a held voice wavers more than a slider. */
export const TOL_SING = 8;
/** Listening check: rounds and how many must be right. */
export const CHECK_ROUNDS = 6;
export const CHECK_PASS = 5;

/** The pair of partials that beat when `hi` is near `ratio` (n/m, reduced) above `lo`: |m·hi − n·lo| Hz. */
export function beatHz(loHz: number, hiHz: number, ratio: [number, number]): number {
  const [n, m] = ratio;
  return Math.abs(m * hiHz - n * loHz);
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** The pure ratio between two chord tones (higher over lower, reduced). */
export function pairRatio(a: Degree, b: Degree): [number, number] {
  const [an, ad] = RATIO[a];
  const [bn, bd] = RATIO[b];
  // a/b = (an·bd)/(ad·bn)
  let n = an * bd, m = ad * bn;
  if (n < m) [n, m] = [m, n];
  const g = gcd(n, m);
  return [n / g, m / g];
}

/** A tone at `hz` meant as `deg`, against the others of the chord, pure on `rootHz` (do). */
export function wobble(hz: number, deg: Degree, rootHz: number, others: Degree[]): number {
  // An octave slip still means this chord tone: fold it to its place in the chord first.
  const want = rootHz * RATIO[deg][0] / RATIO[deg][1];
  let h = hz;
  while (h > want * Math.SQRT2) h /= 2;
  while (h < want / Math.SQRT2) h *= 2;
  let worst = 0;
  for (const o of others) {
    if (o === deg) continue;
    const ohz = rootHz * RATIO[o][0] / RATIO[o][1];
    const [n, m] = pairRatio(deg, o);
    worst = Math.max(worst, beatHz(Math.min(h, ohz), Math.max(h, ohz), [n, m]));
  }
  return worst;
}

/**
 * The pulse to show for a tone `offCents` from pure: as it would beat on a do of D3, whatever the
 * singer's do. (The real rate grows with the pitch; the screen and its words follow the cents, so a
 * soprano and a bass within the same tolerance see the same.)
 */
export const SHOW_ROOT_HZ = 146.83;
export function shownBeats(offCents: number, deg: Degree, others: Degree[]): number {
  const hz = SHOW_ROOT_HZ * RATIO[deg][0] / RATIO[deg][1] * 2 ** (offCents / 1200);
  return wobble(hz, deg, SHOW_ROOT_HZ, others);
}

/** How far from pure reads, in words (cents; null = nothing heard). */
export function wobbleWord(offCents: number | null): string {
  if (offCents == null) return 'listening…';
  const a = Math.abs(offCents);
  return a <= 2.5 ? 'still' : a <= TOL_SING ? 'almost still' : a <= 20 ? 'pulsing' : 'fast buzz';
}

/** Cents of `hz` above `rootHz`, folded to the octave nearest `target` (an octave slip still counts). */
export function centsAbove(hz: number, rootHz: number, target: number): number {
  let c = cents(hz / rootHz);
  while (c - target > 600) c -= 1200;
  while (c - target < -600) c += 1200;
  return c;
}

/** Do (MIDI) for this singer: inside their measured range when known, else the voice's middle. */
export function rootFor(voice: VoiceType, rangeLow?: number, rangeHigh?: number): number {
  if (rangeLow != null && rangeHigh != null && rangeHigh - rangeLow >= 10) {
    const mid = Math.round((rangeLow + rangeHigh) / 2) - 4;
    return Math.max(rangeLow + 1, Math.min(rangeHigh - 9, mid));
  }
  return voice === 'S' ? 62 : voice === 'A' ? 57 : voice === 'T' ? 50 : voice === 'B' ? 45 : 55;
}

/**
 * Hold-to-lock: readings of a sung tone (time in s, cents above do or null when nothing is heard).
 * A steady stretch of HOLD_SEC locks; a slide or a break starts it over.
 */
export const HOLD_SEC = 2;
/** A reading this far from the stretch's median breaks it (cents): a slide, a new note. */
const STEADY_CENTS = 18;
/** Readings are averaged over this long first (s): about two cycles of a 5–7 Hz vibrato. */
const VIBRATO_SEC = 0.34;
/** A hold whose start and end differ by more than this (cents) is still a slide. */
const DRIFT_CENTS = 6;
/** Silence or unclear readings this long break it (s). */
const GAP_SEC = 0.2;

export class HoldDetector {
  /** The steady stretch: smoothed (c) and raw (r) readings. */
  private run: { t: number; c: number; r: number }[] = [];
  private raw: { t: number; c: number }[] = [];
  private lastVoiced = -Infinity;

  reset() { this.run = []; this.raw = []; this.lastVoiced = -Infinity; }

  /** Feed one reading; returns the locked value (median of the stretch, cents) once held long enough. */
  push(t: number, reading: number | null): number | null {
    if (reading == null) {
      if (t - this.lastVoiced > GAP_SEC) { this.run = []; this.raw = []; }
      return null;
    }
    this.lastVoiced = t;
    // A voice's vibrato swings around the note it means: judge its centre (the mean over ~2 cycles).
    this.raw.push({ t, c: reading });
    this.raw = this.raw.filter((r) => r.t > t - VIBRATO_SEC);
    const c = this.raw.reduce((a, r) => a + r.c, 0) / this.raw.length;
    if (this.run.length >= 3 && Math.abs(c - median(this.run.map((r) => r.c))) > STEADY_CENTS) this.run = [];
    this.run.push({ t, c, r: reading });
    if (this.held() >= HOLD_SEC) {
      // Still drifting (a slow slide, homing in)? Then it isn't held yet: keep only the newer part.
      const start = this.run[0].t, end = this.run[this.run.length - 1].t;
      const head = median(this.run.filter((r) => r.t <= start + 0.5).map((r) => r.c));
      const tail = median(this.run.filter((r) => r.t >= end - 0.5).map((r) => r.c));
      if (Math.abs(tail - head) > DRIFT_CENTS) {
        this.run = this.run.filter((r) => r.t >= start + 0.25);
        return null;
      }
      // The settled part: the last 1.5 s (the start of a hold still homes in).
      const v = median(this.run.filter((r) => r.t >= end - 1.5).map((r) => r.r));
      this.run = [];
      return v;
    }
    return null;
  }

  /** How long the current steady stretch has lasted (s). */
  held(): number {
    return this.run.length < 2 ? 0 : this.run[this.run.length - 1].t - this.run[0].t;
  }

  /** The current stretch's median, while one is going. */
  current(): number | null {
    return this.run.length ? median(this.run.map((r) => r.c)) : null;
  }
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

// ---- Progress (this phone, and the choir account: sync.ts `lab`) ----

/**
 * The quick check a week after a course is done (rungs 3–4 in one minute): `due` (a day), `checked`
 * (the day it was taken) and whether it held (`kept`). A slip suggests rung 4 once more (`LabTrack.redo`).
 */
export interface LabReview { due: string; checked?: string; kept?: boolean }
export interface LabTrack {
  rung: number;
  logs: Record<number, number[]>;
  /** The day each rung was passed (YYYY-MM-DD). */
  passed?: Record<number, string>;
  /** The last round logged (ms). */
  at?: number;
  review?: LabReview;
  /** After a slipped check: the rung to pass once more (4, "Sing it by ear"). */
  redo?: number;
}
export type LabProgress = Record<LabInterval, LabTrack>;

/** The quick check comes this many days after a course (or a redo) is done. */
export const REVIEW_DAYS = 7;
/** The quick check: this many holds, and how many must be close to pure. */
export const CHECK_HOLDS = 3;
export const CHECK_KEEP = 2;

const KEY = 'sh:intonation';
const fresh = (): LabProgress => ({ fifth: { rung: 1, logs: {} }, third: { rung: 1, logs: {} } });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY_RE.test(v);

/** One track from stored (or synced) JSON: anything malformed is dropped. */
export function cleanTrack(t: unknown): LabTrack | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  if (typeof o.rung !== 'number' || !Number.isFinite(o.rung)) return null;
  const logs: Record<number, number[]> = {};
  if (o.logs && typeof o.logs === 'object') {
    for (const [r, v] of Object.entries(o.logs as Record<string, unknown>)) {
      const n = Number(r);
      if (Array.isArray(v) && n >= 1 && n <= RUNGS) logs[n] = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(-CHECK_ROUNDS);
    }
  }
  const out: LabTrack = { rung: Math.max(1, Math.min(RUNGS + 1, Math.round(o.rung))), logs };
  if (o.passed && typeof o.passed === 'object') {
    const passed: Record<number, string> = {};
    for (const [r, d] of Object.entries(o.passed as Record<string, unknown>)) if (Number(r) >= 1 && Number(r) <= RUNGS && isDay(d)) passed[Number(r)] = d;
    if (Object.keys(passed).length) out.passed = passed;
  }
  if (typeof o.at === 'number' && Number.isFinite(o.at) && o.at > 0) out.at = o.at;
  const rv = o.review as Record<string, unknown> | undefined;
  if (rv && typeof rv === 'object' && isDay(rv.due)) {
    out.review = { due: rv.due };
    if (isDay(rv.checked)) { out.review.checked = rv.checked; out.review.kept = rv.kept === true; }
  }
  if (o.redo === 4 && out.rung > RUNGS) out.redo = 4;
  return out;
}

export function loadLab(): LabProgress {
  try {
    const raw = JSON.parse(rawGet(KEY) ?? 'null') as Partial<Record<LabInterval, unknown>> | null;
    const p = fresh();
    for (const k of ['fifth', 'third'] as const) {
      const t = cleanTrack(raw?.[k]);
      if (t) p[k] = t;
    }
    return p;
  } catch { return fresh(); }
}

/** (store.ts keeps it in memory when the phone's storage is full or blocked) */
export function saveLab(p: LabProgress) { rawSet(KEY, JSON.stringify(p)); }

/**
 * Log one round's result (how far from pure, cents; for the listening check 0 = right, 1 = wrong)
 * and open the next rung when this one is passed. Returns the updated progress and whether it passed.
 * Passing a rung stamps its day; passing the last one books the quick check a week later; passing
 * the rung to redo after a slipped check books a new one.
 */
export function logRound(p: LabProgress, iv: LabInterval, rung: number, value: number, now = Date.now()): { p: LabProgress; passed: boolean } {
  const t = p[iv];
  const keep = rung === 1 ? CHECK_ROUNDS : ROUNDS;
  const logs = { ...t.logs, [rung]: [...(t.logs[rung] ?? []), value].slice(-keep) };
  const passed = rungPassed(rung, logs[rung]);
  const opens = passed && t.rung === rung;
  const day = dayOf(now);
  const next: LabTrack = { ...t, logs, rung: opens ? rung + 1 : t.rung, at: now };
  if (opens) next.passed = { ...t.passed, [rung]: day };
  if (opens && rung === RUNGS) next.review = { due: addDays(day, REVIEW_DAYS) };
  if (passed && t.redo === rung) {
    delete next.redo;
    next.review = { due: addDays(day, REVIEW_DAYS) };
  }
  return { p: { ...p, [iv]: next }, passed };
}

/**
 * The quick check's result (the cents off pure of its holds): kept when CHECK_KEEP of them were
 * close to pure. A slip asks for rung 4 once more (its rounds start afresh).
 */
export function logCheck(p: LabProgress, iv: LabInterval, holds: number[], now = Date.now()): { p: LabProgress; kept: boolean } {
  const t = p[iv];
  const kept = holds.filter((v) => Math.abs(v) <= TOL_SING).length >= CHECK_KEEP;
  const day = dayOf(now);
  const next: LabTrack = { ...t, at: now, review: { due: t.review?.due ?? day, checked: day, kept } };
  if (!kept) {
    next.redo = 4;
    next.logs = { ...t.logs, 4: [] };
  } else delete next.redo;
  return { p: { ...p, [iv]: next }, kept };
}

export function rungPassed(rung: number, results: number[]): boolean {
  if (rung === 1) return results.length >= CHECK_ROUNDS && results.filter((v) => v === 0).length >= CHECK_PASS;
  const tol = rung === 2 ? TOL_HAND : TOL_SING;
  const last = results.slice(-ROUNDS);
  return last.filter((v) => Math.abs(v) <= tol).length >= PASS;
}

/** Rounds still needed to pass a rung if every one from now on is pure (0 once passed). */
export function roundsToPass(rung: number, results: number[]): number {
  let r = [...results];
  for (let n = 0; n <= CHECK_ROUNDS; n++) {
    if (rungPassed(rung, r)) return n;
    r = [...r, 0].slice(-(rung === 1 ? CHECK_ROUNDS : ROUNDS));
  }
  return CHECK_ROUNDS;
}
