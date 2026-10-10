// Piece status for Home and the plan (ui/today.ts), and the intro video's "Try it now" step.

import { chosenPartId, singableSections, getPiece, type PieceInfo } from './library';
import { getProgress, dueForReview, attemptLog, loadCycle, loadProfile, allProgress, upgradeFullRuns, type Cycle } from '../progress/store';
import { pieceReadiness, nextStep, fullRunDue, type Readiness } from '../progress/ladder';
import type { Route } from './router';
import { wordsDoneFor } from '../progress/words';
import { dayOf, loadToday, planStatus } from '../progress/today';
import { computePlan, tickContext } from './today';

export interface PieceStatus extends Readiness {
  piece: PieceInfo;
  partId: string;
  partName: string;
  /** Sections due for review. */
  due: string[];
  /** The full run is due for review. */
  fullDue: boolean;
  /** More than one section: the piece level comes from full runs. */
  multi: boolean;
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
    fullDue: fullRunDue(sections, prog),
    multi: sections.length > 1,
    next: nextStep(sections, prog, Date.now(), wordsDoneFor(piece.id, partId, part, sections)),
  };
}

/**
 * Today's plan: pieces the next rehearsal works on come first (if they still need work), then
 * passages to fix after a full run and reviews, then the piece practised most recently. At most three.
 */
/** Something that can't wait: a section to fix after a full run, or a review. */
function urgent(s: PieceStatus): boolean {
  return s.next?.kind === 'fix' || s.next?.kind === 'review' || s.due.length > 0 || s.fullDue;
}

export function todaysPlan(statuses: PieceStatus[], cycle: Cycle = loadCycle()): PieceStatus[] {
  const lastPractised = new Map<string, number>();
  for (const e of attemptLog()) lastPractised.set(e.pieceId, Math.max(lastPractised.get(e.pieceId) ?? 0, e.at));
  const focusIds = new Set(cycle.focusPieceIds ?? []);
  const ordered = [...statuses].sort((a, b) =>
    (focusIds.has(b.piece.id) && !b.rehearsalReady ? 1 : 0) - (focusIds.has(a.piece.id) && !a.rehearsalReady ? 1 : 0)
    || (urgent(b) ? 1 : 0) - (urgent(a) ? 1 : 0)
    || (lastPractised.get(b.piece.id) ?? 0) - (lastPractised.get(a.piece.id) ?? 0));
  return ordered.filter((s) => s.next && (!s.concertReady || urgent(s))).slice(0, 3);
}

/**
 * The run today's plan starts with (its first piece step not done yet; the intro video's "Try it
 * now"), null when there's nothing to practise.
 */
export function nextUpRoute(): { route: Route; piece: PieceInfo; level: number } | null {
  const now = new Date();
  const day = dayOf(now);
  const plan = loadToday(day)?.plan ?? computePlan(now, false);
  const status = planStatus(plan, tickContext(day));
  const s = plan.steps.find((x, i) => x.kind !== 'lab' && x.route.name === 'play' && !status.done[i]);
  const piece = s?.pieceId ? getPiece(s.pieceId) : undefined;
  if (s && piece && s.route.name === 'play') return { route: s.route as Route, piece, level: s.level };
  // (nothing left today: the first programme piece's next step)
  const cycle = loadCycle();
  const voice = loadProfile().voice;
  const statuses = cycle.pieceIds.map((id) => getPiece(id)).filter((p): p is PieceInfo => !!p).map((p) => pieceStatus(p, voice));
  const t = todaysPlan(statuses, cycle)[0];
  if (!t?.next) return null;
  return { route: { name: 'play', pieceId: t.piece.id, partId: t.partId, sectionId: t.next.sectionId, level: t.next.level, step: t.next.step, mode: '2d' }, piece: t.piece, level: t.next.level };
}

/**
 * Progress saved under the earlier level rules (a second full run after the fixes; no clean-run
 * stars): bring every piece in the library up to date (store.upgradeFullRuns). Cheap and idempotent:
 * run when the library is ready and after progress arrives from another phone.
 */
export function upgradeAllFullRuns(): void {
  for (const p of allProgress()) {
    const piece = p.pieceId ? getPiece(p.pieceId) : undefined;
    if (!piece || !piece.score.parts.some((x) => x.id === p.partId)) continue;
    try { upgradeFullRuns(p.pieceId, p.partId, singableSections(piece, p.partId)); } catch (e) { console.error(e); }
  }
}
