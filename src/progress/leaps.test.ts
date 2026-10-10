import { describe, it, expect, beforeEach } from 'vitest';
import { addLeapRun, hardestLeap, lastLeapRun, leapOutcomes, loadLeapRuns, whenWord } from './leaps';
import { _resetAllForTests } from './store';

const n = (index: number, grade: 'perfect' | 'good' | 'ok' | 'miss', cents: number | null) => ({ index, grade, cents });

beforeEach(() => { localStorage.clear(); _resetAllForTests(); });

describe('the leap drill: leap by leap', () => {
  it('a leap landed when both its notes were right; the hardest is the one that missed by most', () => {
    const notes = [n(0, 'good', 2), n(1, 'good', -5), n(2, 'good', 0), n(3, 'miss', -30), n(4, 'good', 0), n(5, 'miss', 60), n(6, 'good', 0)];
    const out = leapOutcomes(notes as never, 4);
    expect(out.map((o) => o.landed)).toEqual([true, false, false, false]);
    expect(hardestLeap(out)).toMatchObject({ i: 3, cents: null }); // (not heard at all: the landing note is missing)
    expect(hardestLeap(out.slice(0, 3))).toMatchObject({ i: 2, cents: 60, note: 'landing' });
    // The note it leaps from missed: that's the one named.
    expect(leapOutcomes([n(0, 'miss', -70), n(1, 'good', 0)] as never, 1)[0]).toEqual({ i: 0, landed: false, note: 'start', cents: -70 });
    expect(hardestLeap(out.slice(0, 1))).toBeNull();
  });

  it('keeps the last runs: "last time" is the run before this one', () => {
    expect(lastLeapRun(loadLeapRuns())).toBeNull();
    addLeapRun({ at: 1000, landed: 4, total: 8 });
    addLeapRun({ at: 2000, landed: 6, total: 8 });
    const runs = loadLeapRuns();
    expect(lastLeapRun(runs)).toEqual({ at: 2000, landed: 6, total: 8 });
    expect(lastLeapRun(runs, 2000)).toEqual({ at: 1000, landed: 4, total: 8 });
    for (let i = 0; i < 30; i++) addLeapRun({ at: 3000 + i, landed: 1, total: 8 });
    expect(loadLeapRuns()).toHaveLength(20);
  });

  it('when, in words', () => {
    const now = new Date('2026-10-10T09:58:00').getTime();
    expect(whenWord(new Date('2026-10-10T08:00:00').getTime(), now)).toBe('earlier today');
    expect(whenWord(new Date('2026-10-09T20:00:00').getTime(), now)).toBe('yesterday');
    expect(whenWord(new Date('2026-10-07T20:00:00').getTime(), now)).toBe('Wed');
    expect(whenWord(new Date('2026-09-20T20:00:00').getTime(), now)).toBe('20 Sept');
  });
});
