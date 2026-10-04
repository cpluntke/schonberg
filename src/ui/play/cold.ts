import type { PieceInfo } from '../library';
import { go } from '../router';
import { getBars } from '../../progress/bars';
import { pickColdStart } from '../../game/coldstart';

/** Drop the singer into a random bar (weak bars more often) for a cold start. */
export function startColdStart(piece: PieceInfo, partId: string, avoidFrom?: number, replace = false): boolean {
  const part = piece.score.parts.find((p) => p.id === partId);
  if (!part) return false;
  const avoid = avoidFrom == null ? undefined : piece.score.measures.findIndex((m) => Math.abs(m.start - avoidFrom) < 1e-3);
  const c = pickColdStart(piece.score, part, getBars(piece.id, partId), { avoid });
  if (!c) return false;
  go({ name: 'play', pieceId: piece.id, partId, sectionId: 'cold', level: 5, mode: '2d', from: c.from, to: c.to }, replace);
  return true;
}
