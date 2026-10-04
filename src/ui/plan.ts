// Today's plan, shared by Home ("Next up") and the intro video's "Try it now" step.

import { chosenPartId, singableSections, getPiece, type PieceInfo } from './library';
import { getProgress, dueForReview, attemptLog, loadCycle, loadProfile, type Cycle } from '../progress/store';
import { pieceReadiness, nextStep } from '../progress/ladder';
import type { Route } from './router';

export interface PieceStatus {
  piece: PieceInfo;
  partId: string;
  partName: string;
  pct: number;
  minLevel: number;
  rehearsalReady: boolean;
  concertReady: boolean;
  due: string[];
  next: ReturnType<typeof nextStep>;
}

export function pieceStatus(piece: PieceInfo, voice: string): PieceStatus {
  const partId = chosenPartId(piece, voice);
  const part = piece.score.parts.find((x) => x.id === partId);
  const sections = singableSections(piece, partId);
  const prog = getProgress(piece.id, partId);
  const r = pieceReadiness(sections, prog);
  return {
    piece, partId, partName: part?.name ?? '', ...r,
    due: dueForReview(piece.id, partId, sections),
    next: nextStep(sections, prog),
  };
}

/**
 * Today's plan: pieces the next rehearsal works on come first (if they still need work), then
 * reviews, then the piece practised most recently. At most three.
 */
export function todaysPlan(statuses: PieceStatus[], cycle: Cycle = loadCycle()): PieceStatus[] {
  const lastPractised = new Map<string, number>();
  for (const e of attemptLog()) lastPractised.set(e.pieceId, Math.max(lastPractised.get(e.pieceId) ?? 0, e.at));
  const focusIds = new Set(cycle.focusPieceIds ?? []);
  const ordered = [...statuses].sort((a, b) =>
    (focusIds.has(b.piece.id) && !b.rehearsalReady ? 1 : 0) - (focusIds.has(a.piece.id) && !a.rehearsalReady ? 1 : 0)
    || (b.due.length ? 1 : 0) - (a.due.length ? 1 : 0)
    || (lastPractised.get(b.piece.id) ?? 0) - (lastPractised.get(a.piece.id) ?? 0));
  return ordered.filter((s) => s.next && (!s.concertReady || s.due.length)).slice(0, 3);
}

/** The run Home's "Next up" starts (null when there's nothing to practise). */
export function nextUpRoute(): { route: Route; piece: PieceInfo; level: number } | null {
  const cycle = loadCycle();
  const voice = loadProfile().voice;
  const statuses = cycle.pieceIds.map((id) => getPiece(id)).filter((p): p is PieceInfo => !!p).map((p) => pieceStatus(p, voice));
  const s = todaysPlan(statuses, cycle)[0];
  if (!s?.next) return null;
  return { route: { name: 'play', pieceId: s.piece.id, partId: s.partId, sectionId: s.next.sectionId, level: s.next.level, mode: '2d' }, piece: s.piece, level: s.next.level };
}
