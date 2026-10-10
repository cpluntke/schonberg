// Settings → Privacy, for choir members: leaderboard, "Practising now", sharing with the section lead.

import React, { useState } from 'react';
import { toast, useProfile } from '../hooks';
import { setBoardHidden, setSharing } from '../play/privacy';
import { shareMyProgress } from '../play/shareProgress';

const LATER = ' (the server could not be reached: the app tries again when it is back)';

export function ChoirPrivacy() {
  const [profile, update] = useProfile();
  const [busy, setBusy] = useState(false);
  if (!profile.choirCode) return null;
  const run = async (f: () => Promise<boolean>, done: string, later: string) => {
    setBusy(true);
    try { toast((await f()) ? done : later + LATER); } catch (e) { toast((e as Error).message); } finally { setBusy(false); update({}); }
  };
  const sharing = !!profile.shareProgress && !profile.shareOptOut;
  return (
    <div className="col" style={{ gap: 8 }} data-testid="choir-privacy">
      <label className="toggle-row">
        <span>Show me on the choir's leaderboard
          <span className="tiny muted" style={{ display: 'block' }}>Everyone in the choir sees your first name, voice and readiness for each piece. Off: your entries are taken off the board.</span>
        </span>
        <input type="checkbox" checked={!profile.boardHidden} disabled={busy} data-testid="privacy-board"
          onChange={(e) => void run(() => setBoardHidden(!e.target.checked), e.target.checked ? 'You are back on the leaderboard' : 'You are off the leaderboard',
            'Off the leaderboard on this phone; your entries are removed from the board as soon as possible')} />
      </label>
      <label className="toggle-row">
        <span>Count me in “Practising now”
          <span className="tiny muted" style={{ display: 'block' }}>While you sing, others see one more singer of your voice part on Today and the Choir tab: a count only, never your name.</span>
        </span>
        <input type="checkbox" checked={!profile.presenceHidden} disabled={busy} data-testid="privacy-presence"
          onChange={(e) => update({ presenceHidden: !e.target.checked })} />
      </label>
      <label className="toggle-row">
        <span>Share my practice with my section lead
          <span className="tiny muted" style={{ display: 'block' }}>
            It tells your section lead what the section should rehearse. Bars, levels and the notes that keep going wrong arrive only as totals for the
            section (from 3 singers sharing), never listed per singer; in a small section a lead may still guess which are
            yours. Your voice range is shown with your name (for dividing parts).
          </span>
        </span>
        <input type="checkbox" checked={sharing} disabled={busy} data-testid="privacy-share"
          onChange={(e) => {
            if (e.target.checked) { void setSharing(true).then(() => { update({}); void shareMyProgress(true); toast('Sharing with your section lead again'); }); return; }
            if (!confirm('Stop sharing with your section lead?\n\nYour lead sees bars, levels and the notes that keep going wrong only as totals for the section, not listed per singer (in a very small section they may still guess yours). It shows them what to rehearse with everyone, you included. Only your voice range carries your name.\n\nStop anyway? What you shared so far is removed.')) return;
            void run(() => setSharing(false), 'Not sharing any more; what you shared was removed', 'Not sharing any more; what you shared is removed as soon as possible');
          }} />
      </label>
      {!sharing && profile.shareOptOut && (
        <span className="tiny muted" data-testid="privacy-share-off">Your section's totals leave you out, so they show less of what the section needs. You can switch it back on any time.</span>
      )}
    </div>
  );
}
