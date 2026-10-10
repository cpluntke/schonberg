// The Choir tab (the UX review's D2): the next rehearsal's one action, this week in your section and
// the short board. Pure functions over the leaderboard's entries and the pieces' next steps.

import type { LeaderboardEntry } from '../progress/leaderboard';
import { stepLabel, type NextStep } from '../progress/ladder';
import { lowerLabel } from './path';
import { shortTitle } from './today';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * This week in your section: of the singers of your voice on the choir's board (entries combined
 * over the programme, one per singer), how many have points this week. You count with your own
 * entry (computed on this phone), whether or not you're on the board.
 */
export function sectionWeek(entries: LeaderboardEntry[], voice: string, me: LeaderboardEntry | null): { practised: number; total: number; me: boolean } {
  const mine = entries.filter((e) => e.voice === voice && !(me && same(e.name, me.name)));
  const all = me && me.voice === voice ? [...mine, me] : mine;
  return { practised: all.filter((e) => e.weeklyScore > 0).length, total: all.length, me: !!me && me.voice === voice && me.weeklyScore > 0 };
}

export interface WeekRow { rank: number; entry: LeaderboardEntry; me: boolean }

/**
 * The short board: the top `n` by this week's points (singers with none left out), and you (with
 * your place) when you're further down. Your own entry replaces the board's copy of you.
 */
export function weekBoard(entries: LeaderboardEntry[], me: LeaderboardEntry | null, n = 3): WeekRow[] {
  const others = entries.filter((e) => !(me && same(e.name, me.name)));
  const all = (me ? [...others, me] : others).filter((e) => e.weeklyScore > 0 || e === me);
  const ranked = [...all].sort((a, b) => b.weeklyScore - a.weeklyScore || a.name.localeCompare(b.name));
  const rows = ranked.map((entry, i) => ({ rank: i + 1, entry, me: entry === me }));
  const top = rows.slice(0, n);
  const mine = rows.find((r) => r.me);
  return mine && !top.includes(mine) ? [...top, mine] : top;
}

/** The rehearsal card's one action: "Dieu! bars 14–21 in tempo", and the sentence above it. */
export function focusAction(title: string, next: NextStep, label: (id: string) => string): { button: string; line: string } {
  const t = shortTitle(title);
  if (next.sectionId === 'all') {
    return { button: `${t} · ${next.kind === 'review' ? 'review: ' : ''}sing it all`, line: `${title}: ${next.reason}` };
  }
  const bars = lowerLabel(label(next.sectionId));
  if (next.kind !== 'section') {
    return { button: `${t} · ${next.kind === 'fix' ? 'fix' : 'review'} ${bars}`, line: next.reason };
  }
  const where = label(next.sectionId);
  const line = next.step === 'tempo' ? `${where}: slow is done; next: sing it in tempo.`
    : next.level === 1 ? `${where}: next: learn the notes slowly, on “doo”.`
      : `${where}: next: ${stepLabel(next.level, next.step)}.`;
  return { button: `${t} ${bars} ${next.step === 'tempo' ? 'in tempo' : 'slow'}`, line };
}
