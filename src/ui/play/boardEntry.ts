// My entry on the choir's leaderboard: posted when Ranks opens on a piece and, so the board doesn't
// lag behind real practice, after each finished run (at most once a minute per piece).

import { loadCycle, loadProfile } from '../../progress/store';
import { computeMyEntry, getLeaderboardBackend, type LeaderboardEntry } from '../../progress/leaderboard';
import { getPiece, chosenPartId, singableSections, type PieceInfo } from '../library';
import type { VoiceType } from '../../music/types';

const MIN_GAP_MS = 60_000;

/** My entry for a piece, for the part my voice sings (also snapshots today's readiness). */
export function myBoardEntry(piece: PieceInfo, voice: VoiceType = loadProfile().voice): LeaderboardEntry {
  const partId = chosenPartId(piece, voice);
  return computeMyEntry(piece.id, partId, singableSections(piece, partId));
}

/**
 * Post my entry to my choir's board. Every choir member with a name is on it (part of joining the
 * choir); only a real (server) board, since posting to the local store would bump the store version.
 */
export async function postBoardEntry(entry: LeaderboardEntry): Promise<void> {
  const p = loadProfile();
  const backend = getLeaderboardBackend();
  if (p.choirCode && p.name && !p.boardHidden && backend.kind === 'http') await backend.put(p.choirCode, entry);
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const last = new Map<string, number>();

/** After a run on a programme piece: post its entry soon (computed when sent), at most once a minute. Never throws. */
export function postBoardEntrySoon(pieceId: string): void {
  if (timers.has(pieceId) || !loadCycle().pieceIds.includes(pieceId)) return;
  const wait = Math.max(0, (last.get(pieceId) ?? 0) + MIN_GAP_MS - Date.now());
  timers.set(pieceId, setTimeout(() => {
    timers.delete(pieceId);
    last.set(pieceId, Date.now());
    const piece = getPiece(pieceId);
    if (piece) postBoardEntry(myBoardEntry(piece)).catch((e) => console.warn('leaderboard', e));
  }, wait));
}
