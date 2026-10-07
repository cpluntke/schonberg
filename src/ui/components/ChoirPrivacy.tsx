// Settings → Privacy, for choir members: leaderboard, "Practising now", sharing with the section lead.

import React, { useState } from 'react';
import { toast, useProfile } from '../hooks';
import { startSharing, stopSharing } from '../../progress/choir';
import { setBoardHidden } from '../play/boardEntry';
import { shareMyProgress } from '../play/shareProgress';

export function ChoirPrivacy() {
  const [profile, update] = useProfile();
  const [busy, setBusy] = useState(false);
  if (!profile.choirCode) return null;
  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await f(); toast(done); } catch (e) { toast((e as Error).message); } finally { setBusy(false); update({}); }
  };
  const sharing = !!profile.shareProgress && !profile.shareOptOut;
  return (
    <div className="col" style={{ gap: 8 }} data-testid="choir-privacy">
      <label className="toggle-row">
        <span>Show me on the choir's leaderboard
          <span className="tiny muted" style={{ display: 'block' }}>Everyone in the choir sees your first name, voice and readiness for each piece. Off: your entries are taken off the board.</span>
        </span>
        <input type="checkbox" checked={!profile.boardHidden} disabled={busy} data-testid="privacy-board"
          onChange={(e) => void run(() => setBoardHidden(!e.target.checked), e.target.checked ? 'You are back on the leaderboard' : 'You are off the leaderboard')} />
      </label>
      <label className="toggle-row">
        <span>Count me in “Practising now”
          <span className="tiny muted" style={{ display: 'block' }}>While you sing, others see one more singer of your voice part on Home: a count only, never your name.</span>
        </span>
        <input type="checkbox" checked={!profile.presenceHidden} disabled={busy} data-testid="privacy-presence"
          onChange={(e) => update({ presenceHidden: !e.target.checked })} />
      </label>
      <label className="toggle-row">
        <span>Share my practice with my section lead
          <span className="tiny muted" style={{ display: 'block' }}>
            It tells your section lead what the section should rehearse. Bars and levels arrive only as totals for the whole
            section: the lead never sees which singer sang which bars or had which problems. Only your voice range carries
            your name (for dividing parts).
          </span>
        </span>
        <input type="checkbox" checked={sharing} disabled={busy} data-testid="privacy-share"
          onChange={(e) => {
            if (e.target.checked) { startSharing(); update({}); void shareMyProgress(true); toast('Sharing with your section lead again'); return; }
            if (!confirm('Stop sharing with your section lead?\n\nWhat you share is anonymous within your section: your lead sees totals (which bars are hard for the section), never your own bars or mistakes. It helps them plan rehearsals for everyone, you included.\n\nStop anyway? What you shared so far is removed.')) return;
            void run(stopSharing, 'Not sharing any more; what you shared was removed');
          }} />
      </label>
      {!sharing && profile.shareOptOut && (
        <span className="tiny muted" data-testid="privacy-share-off">Your section's totals leave you out, so they show less of what the section needs. You can switch it back on any time.</span>
      )}
    </div>
  );
}
