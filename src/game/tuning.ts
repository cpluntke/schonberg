// "Why choirs tune differently": the numbers behind the explainer before the intonation courses
// (ui/screens/Tuning.tsx). Pure functions only: cents and ratios, the string and its bridge, beat
// rates, the comma, the cadence's two tunings and the words for beats. docs/INTONATION.md has the
// why of the courses.

import { beatHz, cents } from './intonation';

/** A frequency ratio as cents (1200 to the octave). */
export const ratioToCents = (ratio: number): number => cents(ratio);
/** Cents as a frequency ratio. */
export const centsToRatio = (c: number): number => 2 ** (c / 1200);

/** The just intervals in cents (and the piano's, 100 to the semitone). */
export const JUST = {
  fifth: ratioToCents(3 / 2), // 701.955
  third: ratioToCents(5 / 4), // 386.314
  minorThird: ratioToCents(6 / 5), // 315.641
} as const;
export const PIANO = { fifth: 700, third: 400, minorThird: 300 } as const;

/** Twelve just fifths overshoot seven octaves by this much (the Pythagorean comma, about 23.5 cents). */
export const COMMA = 12 * JUST.fifth - 7 * 1200;
/** Three just major thirds fall this much short of an octave (about 41.1 cents). */
export const THIRDS_GAP = 1200 - 3 * JUST.third;

/** One decimal, as the explainer shows numbers ("13.7", "2", "23.5"). */
export const oneDecimal = (x: number): string => {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/**
 * Beats a second of an upper note `hiHz` over `loHz` near the just ratio n:m (n over m, e.g. 3:2):
 * |m·hi − n·lo|. A fifth over f: |2x − 3f|; a major third: |4x − 5f|.
 */
export const beatRate = (loHz: number, hiHz: number, ratio: [number, number]): number => beatHz(loHz, hiHz, ratio);

/** The upper note of a just ratio over `rootHz`, moved by `offCents`. */
export const upperHz = (rootHz: number, ratio: [number, number], offCents = 0): number => rootHz * (ratio[0] / ratio[1]) * centsToRatio(offCents);

/** "still", "under 1 beat a second", "about 1 beat a second", "about 6 beats a second". */
export function wobbleLabel(perSecond: number): string {
  const b = Math.abs(perSecond);
  if (b < 0.35) return 'still';
  if (b < 0.75) return 'under 1 beat a second';
  const n = Math.round(b);
  return `about ${n} beat${n === 1 ? '' : 's'} a second`;
}

/** A slider's spoken value: "just", "12 cents sharp", "1 cent flat". */
export function centsWords(c: number): string {
  const r = Math.round(c);
  if (r === 0) return 'just';
  const a = Math.abs(r);
  return `${a} cent${a === 1 ? '' : 's'} ${r > 0 ? 'sharp' : 'flat'}`;
}

/**
 * The points of a walk around the octave circle in equal steps of `step` cents (12 just fifths, or 3
 * just thirds): each point's place in the octave (0–1200) and how far it has come in all.
 */
export function circleWalk(step: number, n: number): { at: number; total: number }[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ total: i * step, at: ((i * step) % 1200 + 1200) % 1200 }));
}

/** The circle of fifths from C: twelve steps up a fifth, the twelfth back on C (as B♯), seven octaves up. */
export const FIFTHS_FROM_C = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'E♯', 'B♯'] as const;

/** How far k just fifths have drifted above the piano's (1.955 cents each; 12 make the comma, 23.46). */
export const fifthDrift = (k: number): number => k * (JUST.fifth - PIANO.fifth);

/** The C reached by twelve just fifths, folded down seven octaves, as a ratio to the C you started on (1.01364). */
export const STACKED_C = 1.5 ** 12 / 2 ** 7;

/** `hz` moved by octaves into [lo, 2·lo). */
export function foldInto(hz: number, lo: number): number {
  let h = hz;
  while (h >= 2 * lo) h /= 2;
  while (h < lo) h *= 2;
  return h;
}

/** Octaves climbed after k fifths up (7 semitones each). */
export const octavesUp = (k: number): number => Math.floor((7 * k) / 12);

// ---------- the string (a monochord) ----------

/** The open string: G3, comfortable for every voice to hear; its octave and fifth (G4, D4) too. */
export const OPEN_HZ = 196;
/** Where the bridge can go: the part left of it, as a fraction of the whole string. */
export const BRIDGE_MIN = 0.4;
export const BRIDGE_MAX = 0.95;

/** The pitch of the part of the string left of the bridge, `frac` of it long: f / frac. */
export const partHz = (openHz: number, frac: number): number => openHz / frac;
/** How far the part sounds above the whole string, in cents. */
export const fracToCents = (frac: number): number => ratioToCents(1 / frac);
/** The string fraction that sounds `c` cents above the whole string (1200: ½; 701.955: ⅔). */
export const centsToFrac = (c: number): number => 1 / centsToRatio(c);

/** The two just intervals on the string: half of it (2 : 1) and two thirds (3 : 2). */
export type StringTarget = 'octave' | 'fifth';
export const TARGETS: Record<StringTarget, { frac: number; ratio: [number, number]; cents: number }> = {
  octave: { frac: 1 / 2, ratio: [2, 1], cents: 1200 },
  fifth: { frac: 2 / 3, ratio: [3, 2], cents: JUST.fifth },
};
/** The piano's fifth on the string: 1 / 2^(7/12) = 0.66742, a hair right of ⅔ (0.66667). Its octave: ½, the same. */
export const PIANO_FIFTH_FRAC = centsToFrac(PIANO.fifth);

/** How far the part is from a just interval over the whole string, in cents (+: sharp, the bridge too far left). */
export const offJust = (frac: number, t: StringTarget): number => fracToCents(frac) - TARGETS[t].cents;

/** The just interval nearest the bridge (in cents) and how far off it is. */
export function nearestTarget(frac: number): { target: StringTarget; off: number } {
  const o = offJust(frac, 'octave'), f = offJust(frac, 'fifth');
  return Math.abs(o) <= Math.abs(f) ? { target: 'octave', off: o } : { target: 'fifth', off: f };
}

/**
 * Beats a second between the whole string (f) and the part x = f / frac, near a just interval:
 * the octave |x − 2f|, the fifth |2x − 3f|.
 */
export const stringBeat = (openHz: number, frac: number, t: StringTarget): number => beatRate(openHz, partHz(openHz, frac), TARGETS[t].ratio);

// ---------- the cadence: I–IV–V–I, on the piano and in a choir ----------

/** I–IV–V–I in C major, four voices (bass, tenor, alto, soprano; MIDI), each chord with its root. */
export const CADENCE = [
  { name: 'I', key: 'C', root: 48, notes: [48, 55, 64, 72] },
  { name: 'IV', key: 'F', root: 53, notes: [53, 57, 65, 72] },
  { name: 'V', key: 'G', root: 55, notes: [43, 55, 62, 71] },
  { name: 'I', key: 'C', root: 48, notes: [48, 55, 64, 72] },
] as const;

/**
 * How far a chord tone sits from the piano when the major chord on `root` is tuned just on its root
 * (the root stays at the piano's pitch): the root and its octaves 0, the fifth +1.96, the major third −13.69 cents.
 */
export function justOffset(midi: number, root: number): number {
  const iv = (((midi - root) % 12) + 12) % 12;
  if (iv === 7) return JUST.fifth - PIANO.fifth;
  if (iv === 4) return JUST.third - PIANO.third;
  return 0;
}

const pianoHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** The cadence's chords in Hz: every note at its piano pitch, or each chord tuned just on its own root. */
export function cadenceHz(tuning: 'equal' | 'just'): number[][] {
  return CADENCE.map((c) => c.notes.map((m) => pianoHz(m) * (tuning === 'just' ? centsToRatio(justOffset(m, c.root)) : 1)));
}
