// "Why choirs tune differently": the numbers behind the explainer before the intonation courses
// (ui/screens/Tuning.tsx). Pure functions only: cents and ratios, beat rates, the comma and the
// three thirds, and the words for a wobble. docs/INTONATION.md has the why of the courses.

import { beatHz, cents } from './intonation';

/** A frequency ratio as cents (1200 to the octave). */
export const ratioToCents = (ratio: number): number => cents(ratio);
/** Cents as a frequency ratio. */
export const centsToRatio = (c: number): number => 2 ** (c / 1200);

/** The pure intervals in cents (and the piano's, 100 to the semitone). */
export const PURE = {
  fifth: ratioToCents(3 / 2), // 701.955
  third: ratioToCents(5 / 4), // 386.314
  minorThird: ratioToCents(6 / 5), // 315.641
} as const;
export const PIANO = { fifth: 700, third: 400, minorThird: 300 } as const;

/** Twelve pure fifths overshoot seven octaves by this much (the Pythagorean comma, about 23.5 cents). */
export const COMMA = 12 * PURE.fifth - 7 * 1200;
/** Three pure major thirds fall this much short of an octave (about 41.1 cents). */
export const THIRDS_GAP = 1200 - 3 * PURE.third;

/** One decimal, as the explainer shows numbers ("13.7", "2", "23.5"). */
export const oneDecimal = (x: number): string => {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/**
 * Wobbles a second of an upper note `hiHz` over `loHz` near the pure ratio n:m (n over m, e.g. 3:2):
 * |m·hi − n·lo|. A fifth over f: |2x − 3f|; a major third: |4x − 5f|.
 */
export const beatRate = (loHz: number, hiHz: number, ratio: [number, number]): number => beatHz(loHz, hiHz, ratio);

/** The upper note of a pure ratio over `rootHz`, moved by `offCents`. */
export const upperHz = (rootHz: number, ratio: [number, number], offCents = 0): number => rootHz * (ratio[0] / ratio[1]) * centsToRatio(offCents);

/** "still", "under 1 wobble a second", "about 1 wobble a second", "about 6 wobbles a second". */
export function wobbleLabel(perSecond: number): string {
  const b = Math.abs(perSecond);
  if (b < 0.35) return 'still';
  if (b < 0.75) return 'under 1 wobble a second';
  const n = Math.round(b);
  return `about ${n} wobble${n === 1 ? '' : 's'} a second`;
}

/** A slider's spoken value: "just", "12 cents sharp", "1 cent flat". */
export function centsWords(c: number): string {
  const r = Math.round(c);
  if (r === 0) return 'just';
  const a = Math.abs(r);
  return `${a} cent${a === 1 ? '' : 's'} ${r > 0 ? 'sharp' : 'flat'}`;
}

/**
 * The points of a walk around the octave circle in equal steps of `step` cents (12 pure fifths, or 3
 * pure thirds): each point's place in the octave (0–1200) and how far it has come in all.
 */
export function circleWalk(step: number, n: number): { at: number; total: number }[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ total: i * step, at: ((i * step) % 1200 + 1200) % 1200 }));
}

/** The circle of fifths from C: twelve steps up a fifth, the twelfth back on C (as B♯), seven octaves up. */
export const FIFTHS_FROM_C = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'E♯', 'B♯'] as const;

/** How far k pure fifths have drifted above the piano's (1.955 cents each; 12 make the comma, 23.46). */
export const fifthDrift = (k: number): number => k * (PURE.fifth - PIANO.fifth);

/** The C reached by twelve pure fifths, folded down seven octaves, as a ratio to the C you started on (1.01364). */
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
