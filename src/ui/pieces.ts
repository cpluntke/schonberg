// The Pieces tab (the UX review's D1): which pieces go where, and each piece's status line in the
// fixture's words ("Level 3 reached ✓", "Working on Level 1 · slow · 3 of 4 passages"). Pure.

import { stepWord } from '../progress/ladder';
import { sameWork, type WantedPiece } from '../progress/store';
import { MILESTONES, type PathStatus } from './path';

export interface PieceLike { id: string; title: string; builtin: boolean; own: boolean }

export interface PieceGroups<P extends PieceLike> {
  /** The programme's pieces (the cycle's), the singer's own imports left out (they have their own group). */
  programme: P[];
  /** Programme pieces without a score in the app yet. */
  coming: WantedPiece[];
  /** The singer's own imports, those in the programme first. */
  own: P[];
  /** Everything else on this phone (the choir's scores outside this programme, the built-in warm-up). */
  more: P[];
}

export function groupPieces<P extends PieceLike>(all: P[], cycle: { pieceIds: string[]; wanted?: WantedPiece[] }): PieceGroups<P> {
  const byId = new Map(all.map((p) => [p.id, p]));
  const inCycle = cycle.pieceIds.map((id) => byId.get(id)).filter((p): p is P => !!p);
  const programme = inCycle.filter((p) => !p.own);
  const own = [...inCycle.filter((p) => p.own), ...all.filter((p) => p.own && !cycle.pieceIds.includes(p.id))];
  const more = all.filter((p) => !p.own && !cycle.pieceIds.includes(p.id));
  const coming = (cycle.wanted ?? []).filter((w) => !inCycle.some((p) => sameWork(p.title, w.title)));
  return { programme, coming, own, more };
}

/** A piece's row: what it's working on (muted) or the level it reached (green). */
export function pieceRowStatus(ps: PathStatus, started: boolean, sections: number): { text: string; done: boolean } {
  const W = ps.working;
  if (!W) return ps.pieceLevel > 0 ? { text: `Level ${ps.pieceLevel} reached ✓`, done: true } : { text: 'Nothing to sing in this part', done: false };
  if (ps.fixes.length) {
    const k = ps.fixes.length;
    return { text: `Working on Level ${W.level} · ${k === 1 ? 'one passage' : `${k} passages`} to fix`, done: false };
  }
  if (sections > 1 && ps.allInTempo) return { text: `Level ${W.level} in every passage · sing it all through`, done: false };
  const onIt = ps.done.length > 0 || ps.half;
  if (!onIt && ps.pieceLevel > 0) return { text: `Level ${ps.pieceLevel} reached ✓`, done: true };
  if (!onIt && !started) return { text: 'Not started', done: false };
  const count = sections > 1 && ps.done.length > 0 ? ` · ${ps.done.length} of ${sections} passages` : '';
  return { text: `Working on Level ${W.level} · ${stepWord(W.step)}${count}`, done: false };
}

/** "Rehearsal-ready since Thu 8 Oct" (the highest milestone the piece reached, when its date is known). */
export function readySince(pieceLevel: number, reached: Record<number, number> | undefined, words: (t: number) => string): string | null {
  for (const m of [5, 4, 3] as const) {
    if (pieceLevel >= m) return reached?.[m] != null ? `${MILESTONES[m]} since ${words(reached[m])}` : MILESTONES[m];
  }
  return null;
}
