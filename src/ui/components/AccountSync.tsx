import React, { useEffect, useRef, useState } from 'react';
import { useProfile, useStoreVersion, toast } from '../hooks';
import {
  apiBase, cachedChoir, deleteMyAccount, dismissLogout, joinChoir, lastLogout, login, loggedOutNotice, logout, onSessionChange, sessionFor, signUp, loadSession,
} from '../../progress/choir';
import { loadProfile } from '../../progress/store';
import { answerStaffSync, confirmMerge, loadMeta, pendingQuestion, staffSyncQuestion, syncEnabled, uploadProgress } from '../../progress/sync';
import { syncChoirNow } from '../library';
import { shareMyProgress } from '../play/shareProgress';
import { go } from '../router';

/** What the account keeps, in one line (Settings and the one-time notice). */
export const KEPT = 'Your levels, best results and practice dates, a summary of each bar, your settings and programme. Never recordings or your practice log.';

function ago(t: number): string {
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function useSessionVersion(): void {
  const [, setV] = useState(0);
  useEffect(() => onSessionChange(() => setV((x) => x + 1)), []);
}

/** Logging in on a phone that already has progress under another name: merge only if the singer says so. */
export function MergeQuestionCard() {
  useStoreVersion();
  useSessionVersion();
  const [busy, setBusy] = useState(false);
  const q = pendingQuestion();
  if (!q) return null;
  return (
    <div className="notice col" role="alert" data-testid="merge-question" style={{ gap: 6 }}>
      <span className="small">
        <strong>This phone has progress under “{q.here}”.</strong> Merge it with the progress kept for {q.accountName} ({q.pieces} piece{q.pieces === 1 ? '' : 's'})?
        If they're not the same person, this mixes two singers' progress, and can't be undone.
      </span>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn small" disabled={busy} data-testid="merge-yes" onClick={async () => {
          setBusy(true);
          try { await confirmMerge(); toast('Merged: your progress is kept with your account'); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
        }}>Merge, it's all mine</button>
        <button className="btn small ghost" disabled={busy} data-testid="merge-no" onClick={() => void logout()}>Keep them apart (log out)</button>
      </div>
    </div>
  );
}

/** Home: why this phone's login ended, with a way back in (the reason survives a reload). */
export function LoggedOutCard() {
  useStoreVersion();
  useSessionVersion();
  const [profile] = useProfile();
  const out = lastLogout();
  if (!out || loadSession() || !apiBase()) return null;
  const removed = out.reason === 'removed';
  return (
    <div className="notice col" role="status" data-testid="logged-out-card" style={{ gap: 6 }}>
      <span className="small"><strong>{out.message}</strong> {removed
        ? 'Your progress stays on this phone.'
        : `Log in again to keep your progress in sync${profile.shareProgress ? ' and keep sharing it with your section lead' : ''}.`}</span>
      <div className="row" style={{ gap: 6 }}>
        {!removed && (
          <button className="btn small" data-testid="logged-out-login" onClick={() => {
            try { sessionStorage.setItem('sh:openAccount', 'login'); } catch { /* ignore */ }
            go({ name: 'settings' });
          }}>Log in again</button>
        )}
        <button className="btn small ghost" onClick={() => dismissLogout()}>{removed ? 'OK' : 'Not now'}</button>
      </div>
    </div>
  );
}

/** Home and Settings: the merge question, or (admins and section leads, once) whether to keep their progress with the account. */
export function SyncNotice() {
  useStoreVersion();
  useSessionVersion();
  if (pendingQuestion()) return <MergeQuestionCard />;
  if (!staffSyncQuestion()) return null;
  return (
    <div className="notice info col" role="status" data-testid="sync-question" style={{ gap: 6 }}>
      <span className="small"><strong>Keep your own progress with your choir account?</strong> Then you see and carry on with it on any phone where you log in. {KEPT}</span>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small" data-testid="sync-yes" onClick={() => answerStaffSync(true)}>Yes, keep it</button>
        <button className="btn small ghost" onClick={() => answerStaffSync(false)}>No</button>
      </div>
    </div>
  );
}

/** Which tab to open: what the singer came for, else "Log in" after a logout or on a phone that synced before. */
function initialMode(asked: string | null, choirCode: string | undefined): 'create' | 'login' {
  if (asked === 'create' && choirCode && cachedChoir()?.signupsOpen !== false) return 'create';
  if (asked === 'login') return 'login';
  const out = lastLogout();
  if (out && out.reason !== 'removed') return 'login';
  if (loadMeta().account && !out) return 'login';
  return choirCode && cachedChoir()?.signupsOpen !== false ? 'create' : 'login';
}

const inputProps = { autoCapitalize: 'none', spellCheck: false } as const;

/** Settings → "Keep my progress across phones": make an account or log in; then the status and switch. */
export function AccountSync() {
  const [profile, update] = useProfile();
  useStoreVersion();
  useSessionVersion();
  // Where we came from: Results' "Make an account" ('create'), Home's "Log in again" ('login').
  const [asked] = useState(() => {
    try {
      const v = sessionStorage.getItem('sh:openAccount');
      sessionStorage.removeItem('sh:openAccount');
      return v;
    } catch { return null; }
  });
  const [mode, setMode] = useState<'create' | 'login'>(() => initialMode(asked, profile.choirCode));
  const [code, setCode] = useState(profile.choirCode ?? lastLogout()?.code ?? '');
  const [name, setName] = useState(lastLogout()?.name ?? profile.name);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delPw, setDelPw] = useState('');
  const focus = !!asked;
  const [soloOpen, setSoloOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: 'start' }); }, [focus]);
  if (!apiBase()) return null;
  const session = sessionFor(profile.choirCode);
  const anySession = loadSession();
  const choir = cachedChoir();
  const meta = loadMeta();

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      let c = profile.choirCode;
      if (!c || c !== code.trim().toLowerCase()) c = (await joinChoir(code.trim())).code;
      const s = mode === 'create' ? await signUp(c, name.trim(), pw) : await login(c, name.trim(), pw);
      if (!loadProfile().name.trim()) update({ name: s.account.name });
      setPw('');
      void syncChoirNow();
      toast(mode === 'create' ? 'Account made: your progress is kept with it' : 'Logged in: getting your progress…');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="col" style={{ gap: 8 }} data-testid="account-sync" ref={ref}>
      <h2 className="eyebrow">Keep my progress across phones</h2>
      {!session && !profile.choirCode && !lastLogout() && !meta.account && !asked && !soloOpen ? (
        // A singer without a choir: the backup file is their way; the login is for choir members.
        <>
          <span className="small muted" data-testid="account-solo">
            Your progress lives on this phone. To move it to another phone, save a backup file (below). Singing in a choir that uses
            Schönberg Hero? With an account in your choir, your progress follows you to any phone.
          </span>
          <button className="btn small" onClick={() => setSoloOpen(true)} data-testid="account-solo-open">I have a choir account: log in</button>
        </>
      ) : !session ? (
        <>
          <span className="small muted">
            With an account in your choir, your progress is kept on the choir server: you see it and carry on on any phone where you log in. {KEPT}
            {!profile.choirCode && ' Join your choir first (Your choir above) to make one; without a choir, use a backup file (below).'}
          </span>
          {anySession && <span className="small muted">You're logged in to another choir ({anySession.code}).</span>}
          {loggedOutNotice() && <span className="small" role="status" style={{ color: 'var(--accent-text)' }} data-testid="logged-out-why">{loggedOutNotice()}{lastLogout()?.reason !== 'removed' ? ' Your progress and sharing carry on once you log in again.' : ''}</span>}
          {choir?.signupsOpen === false && profile.choirCode && <span className="small muted">Your choir isn't taking new member accounts at the moment: log in if you have one.</span>}
          {(profile.choirCode || mode === 'login') && (
            <div className="seg" role="group" aria-label="Account">
              <button aria-pressed={mode === 'create'} disabled={!profile.choirCode || choir?.signupsOpen === false} onClick={() => setMode('create')} data-testid="account-mode-create">Make an account</button>
              <button aria-pressed={mode === 'login'} onClick={() => setMode('login')} data-testid="account-mode-login">Log in</button>
            </div>
          )}
          <form className="col" style={{ gap: 8 }} data-testid="account-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            {(!profile.choirCode || mode === 'login') && (
              <label className="field"><span>Choir code</span>
                <input type="text" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} {...inputProps} data-testid="account-code" />
              </label>
            )}
            <label className="field"><span>Your name{mode === 'create' ? ' (as your section lead knows you)' : ''}</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="username" autoCapitalize="words" data-testid="account-name-input" />
            </label>
            <label className="field"><span>{mode === 'create' ? 'Choose a password (8 characters or more)' : 'Password'}</span>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} data-testid="account-password" />
            </label>
            <button className="btn primary block" data-testid="account-submit"
              disabled={busy || !name.trim() || !pw || (mode === 'create' && pw.length < 8) || !code.trim()}>
              {busy ? '…' : mode === 'create' ? `Make my account${choir?.name ? ` in ${choir.name}` : ''}` : 'Log in'}
            </button>
            {err && <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>{err}</span>}
            {mode === 'login' && <span className="tiny muted">Forgot your password? A choir admin can make you a reset link (Admin → Choir → People → Reset password).</span>}
          </form>
        </>
      ) : (
        <>
          <SyncNotice />
          <div className="toggle-row">
            <span>Logged in as <strong data-testid="account-who">{session.account.name}</strong>
              <span className="tiny muted" style={{ display: 'block' }}>{choir?.name ?? session.choirName} · {session.account.role === 'member' ? 'member' : session.account.role === 'admin' ? 'choir admin' : 'section lead'}</span>
            </span>
            <button className="btn small ghost" data-testid="account-logout" onClick={() => void logout()}>Log out</button>
          </div>
          <label className="toggle-row">
            <span>Keep my progress with my account
              <span className="tiny muted" style={{ display: 'block' }}>{KEPT}</span>
            </span>
            <input type="checkbox" checked={syncEnabled(profile)} data-testid="sync-switch" onChange={(e) => update({ sync: e.target.checked })} />
          </label>
          {syncEnabled(profile) && !pendingQuestion() && (
            <span className="small muted" role="status" data-testid="sync-status">
              {busy ? 'Saving…'
                : meta.error ? <span style={{ color: 'var(--accent-text)' }}>Not saved yet: {meta.error}</span>
                  : meta.savedAt && meta.account === session.account.id ? `Saved ${ago(meta.savedAt)}${meta.bytes ? ` · ${(meta.bytes / 1024).toFixed(1)} KB` : ''}. It updates after you practise.`
                    : 'Saves after your next run.'}
            </span>
          )}
          {syncEnabled(profile) && !pendingQuestion() && (
            <button className="btn small" disabled={busy} data-testid="sync-now" onClick={async () => {
              setBusy(true);
              const r = await uploadProgress(true);
              setBusy(false);
              if (!r.ask) toast(r.ok ? 'Progress saved' : `Not saved: ${r.error}`);
              if (r.ok) void shareMyProgress(); // and what the section lead sees (if shared; at most once a minute)
            }}>Save now</button>
          )}
          {session.account.role === 'member' && (
            <details open={deleting} onToggle={(e) => setDeleting((e.target as HTMLDetailsElement).open)}>
              <summary className="small muted" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>Delete my account</summary>
              <div className="col" style={{ gap: 6, marginTop: 6 }}>
                <span className="small muted">Deletes your account, the progress kept with it and the progress you share with your section lead. The progress on this phone stays.</span>
                <label className="field"><span>Your password</span>
                  <input type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} autoComplete="current-password" />
                </label>
                <button className="btn small ghost danger" disabled={!delPw} data-testid="account-delete" onClick={async () => {
                  try { await deleteMyAccount(delPw); setDelPw(''); toast('Account deleted'); } catch (e) { toast((e as Error).message); }
                }}>Delete my account</button>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
