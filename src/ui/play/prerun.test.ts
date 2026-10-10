import { describe, expect, it } from 'vitest';
import { stepSpec } from '../../progress/ladder';
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
    expect(passRule(stepSpec(4, 'tempo'))).toBe('85% of the notes right to pass.');
    expect(passRule(stepSpec(3, 'tempo'), { full: true })).toBe('Every passage needs 8 in 10 notes right. Any that slip are yours to fix on their own.');
    expect(shareWords(0.8)).toBe('8 in 10');
    expect(shareWords(0.85)).toBe('85%');
  });
});

describe('late entries', () => {
  it('the run’s first note and notes after a rest, late or not sung', () => {
    // notes: 0 (entry), 1 (legato), 2 after a 1 s rest (entry), 3 after a 1 s rest (entry)
    const part = [{ start: 0, dur: 1, measure: 0 }, { start: 1, dur: 1, measure: 0 }, { start: 3, dur: 1, measure: 1 }, { start: 5, dur: 1, measure: 2 }];
    const notes = [{ index: 0, onsetMs: 40 }, { index: 1, onsetMs: 400 }, { index: 2, onsetMs: 260 }, { index: 3, onsetMs: null }];
    expect(lateEntries(part, notes)).toEqual([{ index: 2, measure: 1, ms: 260 }, { index: 3, measure: 2, ms: null }]);
    expect(lateEntries(part, notes, 100)).toEqual([{ index: 3, measure: 2, ms: null }]);
  });
});
