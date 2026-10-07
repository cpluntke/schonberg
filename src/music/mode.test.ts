import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makePart, makeScore } from '../game/testutil';
import { importScoreFile, upgradeStored } from './import';
import { inferModes, looksMinor, modeEvidence } from './mode';
import type { Score } from './types';

const root = resolve(__dirname, '../..');
async function load(rel: string): Promise<Score> {
  const b = readFileSync(resolve(root, rel));
  return importScoreFile(rel, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

/** Melody over a bass, one key signature: [melody midis], bass midis (one per 4 melody notes). */
function score(fifths: number, melody: number[], bass: number[], mode: 'major' | 'minor' = 'major'): Score {
  const s = makeScore([makePart('s', melody.map((m) => [m, 1])), makePart('b', bass.map((m) => [m, 4]))]);
  s.keys = [{ beat: 0, time: 0, fifths, mode }];
  return s;
}

// A minor (no key signature): A C E G♯ … ending on A over A; the leading tone G♯ appears.
const aMinorMelody = [69, 72, 71, 68, 69, 76, 74, 72, 71, 68, 69, 71, 72, 71, 68, 69];
const aMinorBass = [45, 52, 40, 45];
// C major: C E G … ending on C over C, no G♯.
const cMajorMelody = [72, 74, 76, 77, 79, 77, 76, 74, 72, 71, 72, 74, 76, 74, 71, 72];
const cMajorBass = [48, 41, 43, 48];

describe('mode inference', () => {
  it('turns "major" into the relative minor when the music ends on its tonic and uses its leading tone', () => {
    const s = score(0, aMinorMelody, aMinorBass);
    inferModes(s);
    expect(s.keys[0].mode).toBe('minor');
  });

  it('leaves major pieces major', () => {
    const s = score(0, cMajorMelody, cMajorBass);
    inferModes(s);
    expect(s.keys[0].mode).toBe('major');
  });

  it('needs the leading tone: ending on the relative tonic alone (Aeolian / a deceptive end) is not enough', () => {
    const s = score(0, aMinorMelody.map((m) => (m === 68 ? 67 : m)), aMinorBass);
    inferModes(s);
    expect(s.keys[0].mode).toBe('major');
  });

  it('never turns a stated minor into major, and ignores tiny stretches', () => {
    const s = score(0, cMajorMelody, cMajorBass, 'minor');
    inferModes(s);
    expect(s.keys[0].mode).toBe('minor');
    const short = score(0, [69, 68, 69], [45]);
    inferModes(short);
    expect(short.keys[0].mode).toBe('major');
  });

  it('ending on the major tonic rules minor out, even with many raised 5ths', () => {
    expect(looksMinor({ notes: 100, finalBass: 0, firstBass: 9, leadingTone: 0.1 }, 0)).toBe(false);
    // half cadence at the end, but it starts on the minor tonic with a frequent leading tone
    expect(looksMinor({ notes: 100, finalBass: 4, firstBass: 9, leadingTone: 0.04 }, 0)).toBe(true);
    expect(looksMinor({ notes: 100, finalBass: 4, firstBass: 9, leadingTone: 0.01 }, 0)).toBe(false);
  });

  it('judges each key signature on its own stretch', () => {
    const s = score(0, [...aMinorMelody, ...cMajorMelody], [...aMinorBass, ...cMajorBass]);
    s.keys = [{ beat: 0, time: 0, fifths: 0, mode: 'major' }, { beat: 16, time: 16, fifths: 0, mode: 'major' }];
    inferModes(s);
    expect(s.keys.map((k) => k.mode)).toEqual(['minor', 'major']);
  });

  it('evidence: final and first bass, leading-tone share (C♯ minor: B♯)', () => {
    const notes = [{ midi: 49, startBeat: 0, durBeats: 4 }, { midi: 60, startBeat: 0, durBeats: 1 }, { midi: 61, startBeat: 1, durBeats: 3 }];
    expect(modeEvidence(notes, 4)).toMatchObject({ notes: 3, finalBass: 1, firstBass: 1 });
    expect(modeEvidence(notes, 4).leadingTone).toBeCloseTo(1 / 3);
  });

  it('library: Vierne (C♯ minor, file says E major) becomes minor; major pieces stay major', async () => {
    expect((await load('library/scores/vierne-kyrie.mxl')).keys[0]).toMatchObject({ fifths: 4, mode: 'minor' });
    expect((await load('library/scores/brahms-schaffe.mxl')).keys[0].mode).toBe('major');
    expect((await load('library/scores/bruckner-locus-iste.mxl')).keys[0].mode).toBe('major');
    expect((await load('public/pieces/warmup-chorale.musicxml')).keys[0].mode).toBe('major');
  }, 30_000);

  it('stored scores from an older importer get the mode on load; up-to-date ones are left alone', () => {
    const old = score(0, aMinorMelody, aMinorBass);
    expect(upgradeStored(old).keys[0].mode).toBe('minor');
    const cur = { ...score(0, aMinorMelody, aMinorBass), parseVersion: 2 };
    expect(upgradeStored(cur).keys[0].mode).toBe('major');
  });
});
