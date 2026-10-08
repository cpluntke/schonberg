import { describe, expect, it } from 'vitest';
import { CONSONANT_MAX, scoreAttempt, type ScoringContext } from './scoring';
import { makePart, makeScore } from './testutil';
import type { PitchSample, ScoringOptions } from './types';

// Four 0.4 s notes, legato (150 bpm).
const part = makePart('A', [[60, 1], [62, 1], [64, 1], [65, 1]], 150);
const ctx: ScoringContext = { score: makeScore([part], 150), part, range: [0, 3] };
const opts: ScoringOptions = { toleranceCents: 30, tuning: 'equal', octaveTolerant: false, rate: 1 };

/**
 * Notes 0, 2, 3 sung in tune throughout. Note 1 (D4): until `voiceAt` s after its start, `gap` (a
 * consonant: loud and unpitched; or silence), starting `gapFrom` s after the start (the previous vowel
 * is held until then); then `sung` (MIDI) to the end.
 */
function take(o: { voiceAt: number; gapFrom?: number; gapRms: number; sung?: number | null }): PitchSample[] {
  const out: PitchSample[] = [];
  const n1 = part.notes[1];
  for (let t = 0; t <= 1.6 + 1e-9; t += 0.02) {
    const i = Math.min(3, Math.floor(t / 0.4 + 1e-9));
    let midi: number | null = part.notes[i].midi;
    let rms = 0.05;
    if (i === 1) {
      const dt = t - n1.start;
      if (dt < (o.gapFrom ?? 0)) midi = part.notes[0].midi;
      else if (dt < o.voiceAt) { midi = null; rms = o.gapRms; }
      else midi = o.sung === undefined ? n1.midi : o.sung;
      if (midi === null && dt >= o.voiceAt) rms = o.gapRms;
    }
    out.push({ time: t, midi, clarity: midi === null ? 0.3 : 0.95, rms });
  }
  return out;
}

const note1 = (s: PitchSample[]) => scoreAttempt(ctx, s, opts).notes[1];

describe('consonant on the beat', () => {
  it('a loud unpitched run from the beat into the voice extends the arrival window', () => {
    // "sa" with the s on the beat for 0.26 s: silence there costs the note, the s doesn't.
    const silent = note1(take({ voiceAt: 0.26, gapRms: 0.001 }));
    const hiss = note1(take({ voiceAt: 0.26, gapRms: 0.02 }));
    expect(silent.grade === 'ok' || silent.grade === 'miss').toBe(true);
    expect(hiss.hitRatio).toBeGreaterThan(silent.hitRatio + 0.15);
    expect(['good', 'perfect']).toContain(hiss.grade);
    // A consonant that ends within the plain window changes nothing.
    const short = take({ voiceAt: 0.1, gapRms: 0.02 });
    expect(note1(short)).toEqual(note1(take({ voiceAt: 0.1, gapRms: 0.001 })));
  });

  it('the previous vowel held to the beat, then the consonant, counts too', () => {
    const silent = note1(take({ gapFrom: 0.04, voiceAt: 0.26, gapRms: 0.001 }));
    const hiss = note1(take({ gapFrom: 0.04, voiceAt: 0.26, gapRms: 0.02 }));
    expect(hiss.hitRatio).toBeGreaterThan(silent.hitRatio + 0.15);
  });

  it('is never more than half the note, nor more than CONSONANT_MAX', () => {
    expect(CONSONANT_MAX).toBeLessThanOrEqual(0.25);
    // Voice only in the last 20 % of the note: still not good.
    const late = note1(take({ voiceAt: 0.32, gapRms: 0.02 }));
    expect(late.grade === 'ok' || late.grade === 'miss').toBe(true);
  });

  it('a consonant that starts late (silence on the beat) is not excused', () => {
    const lateCons = note1(take({ gapFrom: 0, voiceAt: 0.26, gapRms: 0.001 }));
    // silence until 0.16, then a hiss until 0.26: starts after the plain cap (0.14 s)
    const s = take({ voiceAt: 0.26, gapRms: 0.001 }).map((x) => {
      const dt = x.time - part.notes[1].start;
      return dt >= 0.16 && dt < 0.26 ? { ...x, rms: 0.02 } : x;
    });
    expect(note1(s).hitRatio).toBeCloseTo(lateCons.hitRatio, 5);
  });

  it('a consonant from the voice to the end of the note (a final s, or the next one sung early) is excused', () => {
    // Note 1 sung until 0.2 s, then a hiss (legato into note 2); and the same before a rest.
    const end = (rms: number) => take({ voiceAt: 0, gapRms: 0.001 }).map((x) => {
      const dt = x.time - part.notes[1].start;
      return dt >= 0.2 && dt < 0.4 ? { ...x, midi: null, rms } : x;
    });
    expect(note1(end(0.02)).hitRatio).toBeGreaterThan(note1(end(0.001)).hitRatio + 0.15);
    expect(['good', 'perfect']).toContain(note1(end(0.02)).grade);
    const restPart = makePart('A', [[60, 1], [62, 1], [null, 1], [65, 1]], 150);
    const rctx: ScoringContext = { score: makeScore([restPart], 150), part: restPart, range: [0, 2] };
    const r = (rms: number) => scoreAttempt(rctx, end(rms).filter((x) => x.time < 0.8 || x.time >= 1.2), opts).notes[1];
    expect(r(0.02).hitRatio).toBeGreaterThan(r(0.001).hitRatio + 0.15);
    // ...but not more than half the note: voice for the first 30 % only stays below good.
    const short = take({ voiceAt: 0, gapRms: 0.001 }).map((x) => {
      const dt = x.time - part.notes[1].start;
      return dt >= 0.12 && dt < 0.4 ? { ...x, midi: null, rms: 0.02 } : x;
    });
    expect(['ok', 'miss']).toContain(note1(short).grade);
  });

  it('hissing instead of singing, or a wrong note after the consonant, is still a miss', () => {
    expect(note1(take({ voiceAt: 0.4, gapRms: 0.02 })).grade).toBe('miss');
    expect(note1(take({ voiceAt: 0.2, gapRms: 0.02, sung: 63 })).grade).toBe('miss');
  });
});
