import { describe, expect, it } from 'vitest';
import { focusAction, sectionWeek, weekBoard } from './choirTab';
import type { LeaderboardEntry } from '../progress/leaderboard';
import type { NextStep } from '../progress/ladder';

const e = (name: string, voice: LeaderboardEntry['voice'], weeklyScore: number): LeaderboardEntry =>
  ({ name, voice, pieceId: '*all', readiness: 0.3, weeklyScore, streak: 0, improved: 0, updatedAt: 1, v: 2 });

describe('sectionWeek', () => {
  const board = [e('Noa', 'A', 912), e('Jonas', 'T', 708), e('Ina', 'A', 0), e('clara', 'A', 10), e('Mia', 'A', 40)];
  it('counts the singers of your voice with points this week, you with your own entry', () => {
    expect(sectionWeek(board, 'A', e('Clara', 'A', 640))).toEqual({ practised: 3, total: 4, me: true });
    expect(sectionWeek(board, 'A', e('Clara', 'A', 0))).toEqual({ practised: 2, total: 4, me: false });
  });
  it('without an entry of your own: the board alone', () => {
    expect(sectionWeek(board, 'A', null)).toEqual({ practised: 3, total: 4, me: false });
    expect(sectionWeek([], 'B', null)).toEqual({ practised: 0, total: 0, me: false });
  });
});

describe('weekBoard', () => {
  const board = [e('Noa', 'A', 912), e('Jonas', 'T', 708), e('Ina', 'A', 0), e('Clara', 'A', 5), e('Ben', 'B', 800), e('Mia', 'S', 650)];
  it('the top three by points this week, with you in place', () => {
    const me = e('Clara', 'A', 640);
    const rows = weekBoard(board, me);
    expect(rows.map((r) => [r.rank, r.entry.name, r.me])).toEqual([[1, 'Noa', false], [2, 'Ben', false], [3, 'Jonas', false], [5, 'Clara', true]]);
  });
  it('you within the top three appear once; nobody without points', () => {
    const rows = weekBoard(board, e('Clara', 'A', 900));
    expect(rows.map((r) => r.entry.name)).toEqual(['Noa', 'Clara', 'Ben']);
    expect(weekBoard([e('Ina', 'A', 0)], null)).toEqual([]);
  });
});

describe('focusAction', () => {
  const label = (id: string) => ({ s2: 'Bars 14–21', s3: 'Bars 22–29' } as Record<string, string>)[id] ?? id;
  const next = (o: Partial<NextStep>): NextStep => ({ sectionId: 's2', level: 1, step: 'tempo', kind: 'section', reason: '', ...o });
  it('a passage in tempo: the D2 mockup', () => {
    expect(focusAction("Dieu! qu'il la fait bon regarder", next({}), label)).toEqual({
      button: 'Dieu! bars 14–21 in tempo', line: 'Bars 14–21: slow is done; next: sing it in tempo.',
    });
  });
  it('slow, fixes, reviews and the whole piece', () => {
    expect(focusAction('Abendlied', next({ sectionId: 's3', step: 'slow' }), label).button).toBe('Abendlied bars 22–29 slow');
    expect(focusAction('Abendlied', next({ step: 'slow', level: 2 }), label).line).toBe('Bars 14–21: next: Level 2 · Words · slow.');
    expect(focusAction('Abendlied', next({ kind: 'fix', reason: 'Fix it.' }), label)).toEqual({ button: 'Abendlied · fix bars 14–21', line: 'Fix it.' });
    expect(focusAction('Abendlied', next({ sectionId: 'all', kind: 'full', reason: 'Sing it all.' }), label).button).toBe('Abendlied · sing it all');
  });
});
