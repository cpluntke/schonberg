// Key marks: where a choir sings its solfège / 1-7 numbers in another key than the key signature says.
// A score modulates without a new key signature (only accidentals), or its file names the wrong mode:
// an admin marks "from bar 41, G major" and the singers' do moves to G there. The staff keeps the
// written key signature; only the note names (movable do, jianpu) and the "Do = …" hints follow the marks.

import type { KeySig, Score } from './types';

export interface KeyMark {
  /** 0-based bar (index into Score.measures) the mark starts at. */
  bar: number;
  /** The key from that bar on (-7..7, as in KeySig); left out: back to the key signature. */
  fifths?: number;
  mode?: 'major' | 'minor';
}

/** Marks as stored (local or from the server): well-formed ones only, one per bar, sorted. */
export function cleanMarks(raw: unknown, bars = Infinity): KeyMark[] {
  if (!Array.isArray(raw)) return [];
  const byBar = new Map<number, KeyMark>();
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const { bar, fifths, mode } = m as Record<string, unknown>;
    if (typeof bar !== 'number' || !Number.isInteger(bar) || bar < 0 || bar >= bars) continue;
    if (fifths == null) byBar.set(bar, { bar });
    else if (typeof fifths === 'number' && Number.isInteger(fifths) && fifths >= -7 && fifths <= 7 && (mode === 'major' || mode === 'minor')) {
      byBar.set(bar, { bar, fifths, mode });
    }
  }
  return [...byBar.values()].sort((a, b) => a.bar - b.bar);
}

function writtenKeyAt(keys: KeySig[], beat: number): KeySig {
  let k: KeySig = keys[0] ?? { beat: 0, time: 0, fifths: 0, mode: 'major' };
  for (const x of keys) if (x.beat <= beat + 1e-6) k = x;
  return k;
}

/**
 * The keys the note names follow: the key signatures, with the marks laid over them. At each point
 * the latest change wins: a mark lasts until the next mark or the next written key signature.
 */
export function nameKeys(score: Pick<Score, 'keys' | 'measures'>, marks: KeyMark[]): KeySig[] {
  if (!marks.length) return score.keys;
  const keys = score.keys.length ? score.keys : [{ beat: 0, time: 0, fifths: 0, mode: 'major' as const }];
  type Ev = { beat: number; time: number; key: () => Pick<KeySig, 'fifths' | 'mode'>; mark: boolean };
  const evs: Ev[] = keys.map((k) => ({ beat: k.beat, time: k.time, key: () => k, mark: false }));
  for (const m of marks) {
    const meas = score.measures[m.bar];
    if (!meas) continue;
    const beat = meas.startBeat;
    const fifths = m.fifths;
    evs.push({
      beat, time: meas.start, mark: true,
      key: fifths == null ? () => writtenKeyAt(keys, beat) : () => ({ fifths, mode: m.mode ?? 'major' }),
    });
  }
  // Same beat: the mark after the key signature (the admin's choice wins).
  evs.sort((a, b) => a.beat - b.beat || Number(a.mark) - Number(b.mark));
  const out: KeySig[] = [];
  for (const e of evs) {
    const { fifths, mode } = e.key();
    const k: KeySig = { beat: e.beat, time: e.time, fifths, mode };
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - k.beat) < 1e-6) out.pop();
    const prev = out[out.length - 1];
    if (!prev || prev.fifths !== k.fifths || prev.mode !== k.mode) out.push(k);
  }
  return out;
}

/** The key of the note names at `beat`. */
export function keyAtBeatIn(keys: KeySig[], beat: number): KeySig {
  return writtenKeyAt(keys, beat);
}

/** The key of the note names at score time `time`. */
export function keyAtTimeIn(keys: KeySig[], time: number): KeySig {
  let k: KeySig = keys[0] ?? { beat: 0, time: 0, fifths: 0, mode: 'major' };
  for (const x of keys) if (x.time <= time + 1e-6) k = x;
  return k;
}
