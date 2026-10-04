import { describe, it, expect } from 'vitest';
import { makePart, makeScore } from './testutil';
import { scoreAttempt } from './scoring';
import type { PitchSample } from './types';
import type { Part } from '../music/types';

// Synthetic singer: consonant gap at each note start, ±40c vibrato, optional drag / scoop.
function sing(part: Part, o: { lagMs?: number; consMs?: number; dragMs?: number; scoopCents?: number }): PitchSample[] {
  const out: PitchSample[] = [];
  const end = part.notes[part.notes.length - 1].start + part.notes[part.notes.length - 1].dur;
  const off = ((o.lagMs ?? 50) + (o.dragMs ?? 0)) / 1000;
  for (let t = 0; t < end + 0.5; t += 0.02) {
    const u = t - off;
    const i = part.notes.findIndex((n, k) => u >= n.start && (k === part.notes.length - 1 ? u < n.start + n.dur : u < part.notes[k + 1].start));
    let midi: number | null = null;
    if (i >= 0) {
      const n = part.notes[i];
      const into = u - n.start - (o.consMs ?? 70) / 1000;
      if (into >= 0) {
        let c = 40 * Math.sin(2 * Math.PI * 5.5 * t);
        if (o.scoopCents && into < 0.15) c -= o.scoopCents * (1 - into / 0.15);
        midi = n.midi + c / 100;
      }
    }
    out.push({ time: t, midi, clarity: midi == null ? 0.2 : 0.95, rms: midi == null ? 0.002 : 0.1 });
  }
  return out;
}

const melody = makePart('S', [[60, 1], [62, 1], [64, 1], [65, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 2]], 72);
const score = makeScore([melody], 72);
const ctx = { score, part: melody, range: [0, melody.notes.length - 1] as [number, number] };
const opts = { toleranceCents: 25, tuning: 'equal' as const, octaveTolerant: false };
const kinds = (s: PitchSample[]) => scoreAttempt(ctx, s, opts).insights.map((i) => i.kind);

describe('coach notes for timing vs. scooping', () => {
  it('an on-time singer with consonants is not told they are behind the beat', () => {
    expect(kinds(sing(melody, {}))).not.toContain('behind-beat');
  });
  it('a dragging singer (+150 ms) is told they are behind the beat', () => {
    expect(kinds(sing(melody, { dragMs: 150 }))).toContain('behind-beat');
  });
  it('a scooping singer is told about scooping, not dragging', () => {
    const k = kinds(sing(melody, { scoopCents: 150 }));
    expect(k).toContain('scooping');
    expect(k).not.toContain('behind-beat');
  });
});
