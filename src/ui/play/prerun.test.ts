import { describe, expect, it } from 'vitest';
import { entriesOnTime, stepSpec } from '../../progress/ladder';
import { lateEntries, passRule, shareWords, taskSentence } from './prerun';

describe('the task as one sentence', () => {
  it('says what, how, how fast and with what support', () => {
    expect(taskSentence(stepSpec(1, 'slow'), 'bars 22–29')).toBe('Sing bars 22–29 on “doo”, slowly (70%), with your part playing.');
    expect(taskSentence(stepSpec(1, 'tempo'), 'bars 22–29')).toBe('Sing bars 22–29 on “doo”, in tempo, with your part playing.');
    expect(taskSentence(stepSpec(2, 'slow'), 'bars 1–5')).toBe('Sing bars 1–5 with the words, slowly (70%), with your part playing.');
    expect(taskSentence(stepSpec(3, 'tempo'), 'the whole piece')).toBe('Sing the whole piece with the words, in tempo, your part muted: the other voices play.');
    expect(taskSentence(stepSpec(4, 'tempo'), 'bars 1–5')).toBe('Sing bars 1–5 with the words and no note names, in tempo, from the starting chord, the other voices playing.');
    expect(taskSentence(stepSpec(5, 'tempo'), 'bars 1–5')).toBe('Sing bars 1–5 from memory, in tempo, from the starting chord, the other voices playing.');
    expect(taskSentence(stepSpec(1, 'slow'), 'bar 25', 0.5)).toBe('Sing bar 25 on “doo”, slowly (50%), with your part playing.');
  });
});

describe('the pass rule in words', () => {
  it('every note, a share, entries, the whole piece', () => {
    expect(passRule(stepSpec(1, 'slow'))).toBe('All notes right to pass.');
    expect(passRule(stepSpec(1, 'tempo'))).toBe('8 in 10 notes right, entries on time.');
    expect(passRule(stepSpec(2, 'tempo'))).toBe('8 in 10 notes right to pass.');
    expect(passRule(stepSpec(4, 'tempo'))).toBe('85 in 100 notes right to pass.');
    expect(passRule(stepSpec(3, 'tempo'), { full: true })).toBe('Every passage needs 8 in 10 notes right. Any that slip are yours to fix on their own.');
    expect(shareWords(0.8)).toBe('8 in 10');
    expect(shareWords(0.85)).toBe('85 in 100');
  });
});

describe('late entries', () => {
  // notes: 0 (entry), 1 (legato), 2 after a 1 s rest (entry), 3 after a 1 s rest (entry), 4 after a rest (entry, unsure)
  const part = [{ start: 0, dur: 1, measure: 0 }, { start: 1, dur: 1, measure: 0 }, { start: 3, dur: 1, measure: 1 }, { start: 5, dur: 1, measure: 2 }, { start: 7, dur: 1, measure: 3 }];
  it('names the entries the check judged late or unsung, with its bound', () => {
    const notes = [
      { index: 0, onsetMs: 40, voicedRatio: 1 }, { index: 1, onsetMs: 400, voicedRatio: 1 }, { index: 2, onsetMs: 260, voicedRatio: 1 },
      { index: 3, onsetMs: null, voicedRatio: 0 }, { index: 4, onsetMs: 900, voicedRatio: 0.3, unsure: 'short' as const },
    ];
    // (entry 1 is legato: no entry; entry 4 is unsure: left out, as entriesOnTime does)
    expect(lateEntries(part, notes)).toEqual([{ index: 2, measure: 1, ms: 260 }, { index: 3, measure: 2, ms: null }]);
    expect(entriesOnTime(part, notes)).toMatchObject({ ok: false, entries: 3, missed: 1 });
    expect(lateEntries(part, notes, 100)).toEqual([{ index: 3, measure: 2, ms: null }]);
  });
  it('a sung entry that never landed in tune is not "not sung"', () => {
    const notes = [{ index: 0, onsetMs: 30, voicedRatio: 1 }, { index: 2, onsetMs: null, voicedRatio: 0.8 }];
    expect(lateEntries(part, notes)).toEqual([]);
    expect(entriesOnTime(part, notes).ok).toBe(true);
  });
  it('a lone timed entry gets twice the bound; a late mean with no single late entry names the latest', () => {
    expect(lateEntries(part, [{ index: 0, onsetMs: 300, voicedRatio: 1 }])).toEqual([]);
    expect(lateEntries(part, [{ index: 0, onsetMs: 400, voicedRatio: 1 }])).toEqual([{ index: 0, measure: 0, ms: 400 }]);
    expect(entriesOnTime(part, [{ index: 0, onsetMs: 300, voicedRatio: 1 }]).ok).toBe(true);
    const notes = [{ index: 0, onsetMs: 170, voicedRatio: 1 }, { index: 2, onsetMs: 178, voicedRatio: 1 }, { index: 3, onsetMs: 200, voicedRatio: 1 }];
    expect(entriesOnTime(part, notes).ok).toBe(false);
    expect(lateEntries(part, notes)).toEqual([{ index: 3, measure: 2, ms: 200 }]);
  });
});
