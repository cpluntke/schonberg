// #/invite/<token>: someone was invited to be a choir admin or a section lead (or got a new-password
// link). They choose their name and a password; the account is created and they're logged in.

import React, { useEffect, useState } from 'react';
import { useProfile } from '../hooks';
import { go } from '../router';
import { syncChoirNow } from '../library';
import { IconBack } from '../icons';
import { acceptInvite, apiBase, ChoirApiError, joinChoir, leaveChoir, loadSession, lookupInvite, type InviteInfo, type Session } from '../../progress/choir';
import { loadProfile } from '../../progress/store';
import { roleText, voicesText } from '../components/People';

const KEY = 'sh:inviteToken';

function rememberToken(fromUrl: string | undefined): string | null {
  try {
    if (fromUrl) sessionStorage.setItem(KEY, fromUrl);
    return fromUrl ?? sessionStorage.getItem(KEY);
  } catch {
    return fromUrl ?? null;
  }
}
function forgetToken() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function InviteScreen({ token: fromUrl }: { token?: string }) {
  const [profile] = useProfile();
  const [token] = useState(() => rememberToken(fromUrl));
  const [info, setInfo] = useState<{ code: string; choirName: string; invite: InviteInfo } | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [done, setDone] = useState<Session | null>(null);
  // Take the secret out of the address bar and the history (it stays in this tab until it's used).
  useEffect(() => {
    if (fromUrl) try { history.replaceState(history.state, '', '#/invite'); } catch { /* ignore */ }
  }, [fromUrl]);
  useEffect(() => {
    if (!token || !apiBase()) return;
    let alive = true;
    lookupInvite(token).then((i) => {
      if (!alive) return;
      setInfo(i);
      setName(i.invite.note || profile.name || '');
    }).catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const top = (
    <div className="topbar">
      <button className="icon-btn" aria-label="Back" onClick={() => go({ name: 'home' }, true)}><IconBack /></button>
      <h1>Invitation</h1>
    </div>
  );
  if (!apiBase()) return <main className="screen">{top}<div className="notice">Invitations need the online version of the app.</div></main>;
  if (!token) return <main className="screen">{top}<div className="notice">This invite link is incomplete. Open the whole link you were sent.</div></main>;
  if (done) {
    const admin = done.account.role === 'admin';
    return (
      <main className="screen">
        {top}
        <div className="card" data-testid="invite-done">
          <span className="eyebrow">{done.choirName}</span>
          <strong style={{ fontSize: '1.25rem' }}>Welcome, {done.account.name}</strong>
          <span>You're {admin ? 'an admin of' : `the section lead for the ${voicesText(done.account.voices)} in`} {done.choirName}, and logged in on this phone.</span>
          <span className="small muted">On another phone or computer, log in under Settings › Your choir with the choir code <strong className="mono">{done.code}</strong>, your name and your password.</span>
        </div>
        <button className="btn primary block" onClick={() => go({ name: admin ? 'choiradmin' : 'section' }, true)}>
          {admin ? 'Open choir admin' : 'See your section'}
        </button>
        <button className="btn ghost block" onClick={() => go({ name: 'home' }, true)}>Today</button>
      </main>
    );
  }
  if (err) {
    return (
      <main className="screen">
        {top}
        <div className="notice" role="alert" data-testid="invite-error">{err}</div>
        <button className="btn block" onClick={() => { forgetToken(); go({ name: 'choir' }, true); }}>Your choir</button>
      </main>
    );
  }
  if (!info) return <main className="screen">{top}<span className="muted">Opening the invitation…</span></main>;
  const inv = info.invite;
  const reset = !!inv.reset;
  const what = reset ? `Choose a new password for ${inv.accountName ?? 'your account'} in ${info.choirName}`
    : inv.role === 'admin' ? `You're invited to be an admin of ${info.choirName}`
    : `You're invited to be the section lead for the ${voicesText(inv.voices)} in ${info.choirName}`;
  const otherChoir = profile.choirCode && profile.choirCode !== info.code;
  return (
    <main className="screen">
      {top}
      <form className="card" data-testid="invite-form" onSubmit={async (e) => {
        e.preventDefault();
        // Already logged in on this phone (as someone else): ask before replacing that login.
        const cur = loadSession();
        const same = cur && reset && cur.code === info.code && cur.account.name === inv.accountName;
        if (cur && !same && !confirm(`You're logged in as ${cur.account.name} (${cur.choirName}). Continue as the new account? ${cur.account.name} is logged out on this phone.`)) return;
        setBusy(true);
        setPwError('');
        try {
          const s = await acceptInvite(token, name.trim(), pw);
          forgetToken();
          // Accepting also connects this phone to the choir (programme, scores, leaderboard).
          const current = loadProfile().choirCode;
          if (current !== s.code) {
            if (current) leaveChoir();
            await joinChoir(s.code).then(() => syncChoirNow()).catch(() => { /* joining can be retried in Settings */ });
          }
          setDone(s);
        } catch (e2) {
          if (e2 instanceof ChoirApiError && e2.status === 404) setErr(e2.message);
          else setPwError((e2 as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        <span className="eyebrow">{info.choirName}</span>
        <strong style={{ fontSize: '1.25rem' }} data-testid="invite-what">{what}</strong>
        {!reset && <span className="small muted">{roleText(inv.role, inv.voices)}{inv.role === 'admin' ? ': the programme, the scores, and who leads which section.' : ': you see which bars your section finds hard (from singers who share their progress).'}</span>}
        <span className="tiny muted">Invited by {inv.by || 'your choir'} · the link works until {new Date(inv.expiresAt).toLocaleDateString()}</span>
        {!reset && (
          <label className="field"><span>Your name (how you log in; others in the choir see it)</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="username" required data-testid="invite-name" />
          </label>
        )}
        <label className="field"><span>{reset ? 'New password' : 'Choose a password'} (at least 8 characters)</span>
          <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={8} required data-testid="invite-password" />
        </label>
        <label className="row small" style={{ gap: 8, minHeight: 44 }}>
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
        </label>
        {otherChoir && <span className="small">This phone is in another choir now; accepting switches it to {info.choirName}.</span>}
        <button className="btn primary block" disabled={busy || pw.length < 8 || (!reset && !name.trim())} data-testid="invite-accept">
          {busy ? '…' : reset ? 'Save the new password' : 'Create my account'}
        </button>
        {pwError && <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>{pwError}</span>}
      </form>
    </main>
  );
}
