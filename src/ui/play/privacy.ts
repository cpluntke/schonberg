// Settings → Privacy: leaving the leaderboard and stopping sharing take effect on this phone at once;
// removing what is already on the server is remembered until the server confirms it (offline, a busy
// server), and retried when the app starts or comes back.

import { loadCycle, loadProfile, readJSON, saveProfile, writeJSON } from '../../progress/store';
import { getLeaderboardBackend } from '../../progress/leaderboard';
import { sessionFor, startSharing, stopSharing, withdrawProgress } from '../../progress/choir';
import { postBoardEntrySoon } from './boardEntry';

const KEY = 'schonberg:privacyPending';
interface Pending { board?: { code: string; name: string }; share?: { code: string; name: string } }

const pending = (): Pending => readJSON<Pending>(KEY, {}, (v) => !!v && typeof v === 'object');
const save = (p: Pending) => writeJSON(KEY, p, false);

/** The board keeps names to 40 characters (utils/schonberg.py). */
const boardName = (n: string) => n.trim().slice(0, 40);

/** Removals still owed to the server; true when nothing is left to do. */
export async function retryPrivacyRemovals(): Promise<boolean> {
  const p = pending();
  if (p.board) {
    const backend = getLeaderboardBackend();
    try {
      if (backend.remove) await backend.remove(p.board.code, p.board.name);
      delete p.board;
    } catch { /* stays owed */ }
  }
  if (p.share) {
    try {
      await withdrawProgress(p.share.code, p.share.name);
      delete p.share;
    } catch (e) {
      // (refused for good, e.g. nothing shared under that name: retrying won't change it)
      const st = (e as { status?: number }).status ?? 0;
      if (st >= 400 && st < 500 && st !== 408 && st !== 429) delete p.share;
    }
  }
  save(p);
  return !p.board && !p.share;
}

/** Leave or rejoin the choir's leaderboard. Returns false when the server couldn't be told yet (it's retried). */
export async function setBoardHidden(hidden: boolean): Promise<boolean> {
  const p = loadProfile();
  saveProfile({ ...p, boardHidden: hidden });
  if (!hidden) {
    const q = pending();
    delete q.board;
    save(q);
    for (const id of loadCycle().pieceIds) postBoardEntrySoon(id);
    return true;
  }
  if (p.choirCode && p.name.trim()) save({ ...pending(), board: { code: p.choirCode, name: boardName(p.name) } });
  return retryPrivacyRemovals();
}

/** Stop or restart sharing with the section lead. Returns false when the withdrawal is still owed (it's retried). */
export async function setSharing(on: boolean): Promise<boolean> {
  if (on) {
    const q = pending();
    delete q.share;
    save(q);
    startSharing();
    return true;
  }
  const p = loadProfile();
  stopSharing();
  // (shared under the account's name when logged in to the choir, else the singer's own)
  const name = sessionFor(p.choirCode)?.account.name ?? p.name.trim();
  if (p.choirCode && name) save({ ...pending(), share: { code: p.choirCode, name } });
  return retryPrivacyRemovals();
}
