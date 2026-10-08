import { describe, expect, it } from 'vitest';
import type { Measure } from '../../music/types';
import { skipTarget } from './skip';

// 4/4 at 60 bpm: bars of 4 s.
const bars = (n: number, dur = 4): Measure[] => Array.from({ length: n }, (_, i) => ({ index: i, number: String(i + 1), startBeat: i * 4, durBeats: 4, start: i * dur, dur, timeSig: [4, 4] as [number, number] }));
const note = (start: number, dur = 1) => ({ start, dur });

describe('skipping a long rest', () => {
  const ms = bars(20);
  // Sings bar 1, rests bars 2–9, comes in on beat 3 of bar 10 (t = 38).
  const part = { notes: [note(0), note(1), note(2), note(3, 1), note(38), note(39)] as never };
  it('lands at the start of a bar, one to two bars before the entry', () => {
    expect(skipTarget(ms, part, 4.5, 80)).toEqual({ target: 32, entry: 38 }); // bar 9 (one bar + two beats of lead-in)
    const onBeat = { notes: [note(0), note(40)] as never };
    expect(skipTarget(ms, onBeat, 2, 80)).toEqual({ target: 36, entry: 40 }); // entry on a downbeat: exactly one bar
  });
  it('not while singing, not for a short rest, not past the end, not when nothing is left', () => {
    expect(skipTarget(ms, part, 2.5, 80)).toBeNull(); // a note sounds
    expect(skipTarget(ms, part, 26, 80)).toBeNull(); // only 6 s (1.5 bars) to save
    expect(skipTarget(ms, part, 4.5, 30)).toBeNull(); // the entry is after the run's end
    expect(skipTarget(ms, part, 40, 80)).toBeNull(); // no more notes
    expect(skipTarget(ms, part, 4.1, 80, 0.3)).toBeNull(); // the last note's tail hasn't reached the scoring yet
    expect(skipTarget(ms, part, 4.31, 80, 0.3)).toEqual({ target: 32, entry: 38 });
  });
  it('at a fast tempo, the lead-in is at least three seconds', () => {
    const fast = bars(40, 1.6); // bars of 1.6 s
    expect(skipTarget(fast, { notes: [note(0), note(32)] as never }, 2, 80)).toEqual({ target: 28.8, entry: 32 }); // 2 bars = 3.2 s
  });
  it('from before the first note (a long opening rest) too', () => {
    expect(skipTarget(ms, { notes: [note(50)] as never }, 0, 80)).toEqual({ target: 44, entry: 50 });
  });
});
