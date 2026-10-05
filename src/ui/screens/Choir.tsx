import React, { useEffect, useRef, useState } from 'react';
import { useProfile, useStoreVersion, toast } from '../hooks';
import { back, go } from '../router';
import { allPieces, syncChoirNow } from '../library';
import { IconBack } from '../icons';
import { WEEKDAYS } from '../../progress/rehearsal';
import {
  apiBase, cachedChoir, changePassword, choirPieceId, claimAccount, deleteChoirPiece, fetchChoir, joinChoir, leaveChoir, ChoirApiError,
  loadSession, loggedOutNotice, login, logout, onSessionChange, refreshSession, refreshSessionSoon, saveChoirCycle, sessionFor, sessionSecret, superCreate, superDelete,
  superList, superPurgeMembers, superRename, uploadChoirPiece, withdrawProgress, fetchChoirUsage, mb, type Auth, type ChoirInfo, type ChoirSummary, type ChoirUsage,
  type ServerUsage, type Session, localPieceId, type LibraryPiece,
} from '../../progress/choir';
import { LibraryPanel, type ProgrammeDraft } from '../components/ChoirLibrary';
import { SectionInsights } from '../components/SectionInsights';
import { fetchSectionInsights, type SectionInsightsView } from '../../progress/insights';
import { InviteLinkBox, PeoplePanel, roleText, VOICE_NAME, VOICES } from '../components/People';
import { importScoreFile } from '../../music/import';
import { shareMyProgress, shareError } from '../play/shareProgress';

const inputStyle: React.CSSProperties = { minHeight: 44, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', padding: '0 12px' };
const errStyle: React.CSSProperties = { color: 'var(--accent-text)' };

function Top({ title }: { title: string }) {
  return (
    <div className="topbar">
      <button className="icon-btn" aria-label="Back" onClick={() => back({ name: 'settings' })}><IconBack /></button>
      <h1>{title}</h1>
    </div>
  );
}

function Offline() {
  return <div className="notice">Choirs need the online version of the app (it talks to the choir server).</div>;
}

/** This phone's admin / section-lead login (re-renders when it changes). */
export function useSession(refresh = false): Session | null {
  const [, setV] = useState(0);
  useEffect(() => onSessionChange(() => setV((x) => x + 1)), []);
  // Screens that depend on the role pick up an admin's changes (role, voices, removal) on opening.
  useEffect(() => { if (refresh) refreshSessionSoon(); }, [refresh]);
  return loadSession();
}

/** A "Log out" link with a full-size tap target. */
function LogoutLink({ onClick = () => void logout() }: { onClick?: () => void }) {
  return <button className="linklike" style={{ minHeight: 44 }} data-testid="logout-link" onClick={onClick}>Log out</button>;
}

/** Shown when this phone's login ended elsewhere (password changed, account removed or reset). */
function LoggedOutNotice() {
  const n = loggedOutNotice();
  return n ? <div className="notice" role="alert" data-testid="logged-out-notice">{n}</div> : null;
}

/** Join form, also used in the first-run setup. */
export function JoinChoir({ onJoined, compact = false }: { onJoined?: (c: ChoirInfo) => void; compact?: boolean }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!apiBase()) return compact ? null : <Offline />;
  return (
    <form className="col" style={{ gap: 6 }} onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr('');
      try {
        const c = await joinChoir(code.trim());
        onJoined?.(c);
        void syncChoirNow().then((r) => { if (r.newPieces) toast(`${r.newPieces} score${r.newPieces > 1 ? 's' : ''} from ${c.name} added`); });
      } catch (e2) {
        setErr((e2 as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      <div className="row">
        <input type="text" aria-label="Choir code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="choir code" autoCapitalize="none" autoCorrect="off" style={{ ...inputStyle, flex: 1 }} />
        <button className="btn primary" disabled={busy || code.trim().length < 3} data-testid="join-choir">{busy ? '…' : 'Join'}</button>
      </div>
      {err && <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>{err}</span>}
    </form>
  );
}

// ------------------------------------------------------------------ member

export function ChoirScreen() {
  const [profile, update] = useProfile();
  useStoreVersion();
  const [syncMsg, setSyncMsg] = useState('');
  const choir = cachedChoir();
  const joined = !!profile.choirCode && choir?.code === profile.choirCode;
  if (!apiBase()) return <main className="screen"><Top title="Your choir" /><Offline /></main>;
  return (
    <main className="screen">
      <Top title="Your choir" />
      {!joined ? (
        <div className="card">
          <strong>Join your choir</strong>
          <span className="small muted">The code from your choir connects you to its programme, its scores and its leaderboard.</span>
          <JoinChoir onJoined={() => update({})} />
        </div>
      ) : (
        <>
          <div className="card" data-testid="choir-card">
            <span className="eyebrow">Choir</span>
            <strong style={{ fontSize: 20 }}>{choir!.name}</strong>
            <span className="small muted">
              {choir!.cycle ? `Programme: ${choir!.cycle.name} · ` : ''}{choir!.pieces.length} score{choir!.pieces.length === 1 ? '' : 's'} from the choir
            </span>
            <div className="row wrap">
              <button className="btn small" onClick={async () => {
                setSyncMsg('Syncing…');
                const r = await syncChoirNow();
                setSyncMsg(r.ok ? `Up to date${r.newPieces ? `: ${r.newPieces} new score${r.newPieces > 1 ? 's' : ''}` : ''}${r.programme ? ', programme updated' : ''}.` : r.error ?? 'Could not sync.');
              }}>Sync now</button>
              <button className="btn small ghost" onClick={() => { if (confirm('Leave this choir on this phone? Your own practice stays.')) { leaveChoir(); update({}); } }}>Leave</button>
            </div>
            {syncMsg && <span className="small muted" role="status">{syncMsg}</span>}
          </div>
          <div className="card">
            <label className="toggle-row"><span>Share my progress with my section lead<span className="tiny muted" style={{ display: 'block' }}>How each bar is going, so they know what to rehearse (they see the section as a whole, not you). Your name and voice range are visible to your section lead and the choir admins.</span></span>
              <input type="checkbox" checked={!!profile.shareProgress} onChange={async (e) => {
                const on = e.target.checked;
                update({ shareProgress: on });
                if (on) void shareMyProgress(true).then(() => update({}));
                else if (profile.name.trim()) withdrawProgress(profile.choirCode!, profile.name.trim()).catch(() => {});
              }} />
            </label>
            {!profile.name.trim() && !sessionFor(profile.choirCode) && profile.shareProgress && <span className="small" style={errStyle}>Add your name in Voice setup first.</span>}
            {profile.name.trim() && profile.shareProgress && shareError() && <span className="small" role="alert" style={errStyle}>Not shared yet: {shareError()}</span>}
          </div>
          <AccountCard choir={choir!} />
        </>
      )}
      <button className="linklike tiny muted" style={{ alignSelf: 'center', marginTop: 'auto', minHeight: 44 }} onClick={() => go({ name: 'superadmin' })}>Setting up choirs? (super admin)</button>
    </main>
  );
}

// ------------------------------------------------------------------ admins' and section leads' accounts

/** Logged in: who you are and where to go. Not logged in: the login form. */
function AccountCard({ choir }: { choir: ChoirInfo }) {
  const session = useSession();
  const s = session && session.code === choir.code ? session : null;
  const [changing, setChanging] = useState(false);
  // Pick up a role or voice change (or a removed account) since the last visit.
  useEffect(() => { if (s) void refreshSession(); }, [s?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) {
    return (
      <div className="card flat" data-testid="account-card">
        <strong>Your account</strong>
        <LoggedOutNotice />
        <span className="small muted">Log in with your own name and password. Singers can make an account in Settings (Keep my progress across phones); admins and section leads get an invite link from a choir admin.</span>
        <LoginForm code={choir.code} legacy={!!choir.legacyLogin} />
      </div>
    );
  }
  const admin = s.account.role === 'admin';
  return (
    <div className="card flat" data-testid="account-card">
      <span className="eyebrow">Logged in</span>
      <strong data-testid="account-name">{s.account.name}</strong>
      <span className="small muted" data-testid="account-role">{roleText(s.account.role, s.account.voices)}</span>
      <div className="row wrap">
        {admin && <button className="btn small primary" onClick={() => go({ name: 'choiradmin' })}>Choir admin</button>}
        {s.account.role !== 'member' && <button className="btn small" onClick={() => go({ name: admin ? 'choirinsights' : 'section' })}>{admin ? 'Sections' : 'Your section'}</button>}
        <button className="btn small ghost" onClick={() => setChanging(!changing)} aria-expanded={changing}>Change password</button>
        <button className="btn small ghost" data-testid="logout" onClick={() => void logout()}>Log out</button>
      </div>
      {changing && <ChangePassword onDone={() => setChanging(false)} />}
    </div>
  );
}

/** Choir code + name + password → logged in (a session token on this phone; the password isn't kept). */
export function LoginForm({ code, legacy = false }: { code: string; legacy?: boolean }) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState(false);
  if (claim) return <ClaimForm code={code} onCancel={() => setClaim(false)} />;
  return (
    <form className="col" style={{ gap: 8 }} data-testid="login-form" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr('');
      try { await login(code, name.trim(), pw); setPw(''); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
    }}>
      <label className="field"><span>Your name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoCapitalize="words" maxLength={40} data-testid="login-name" />
      </label>
      <label className="field"><span>Password</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" data-testid="login-password" />
      </label>
      <button className="btn primary block" disabled={busy || !name.trim() || !pw} data-testid="login">{busy ? '…' : 'Log in'}</button>
      {err && <span className="small" role="alert" style={errStyle}>{err}</span>}
      <span className="tiny muted">Forgot your password? Your choir admin can send you a new link.</span>
      {legacy && (
        <button type="button" className="linklike small" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={() => setClaim(true)} data-testid="claim-open">
          Have the old shared admin or section-lead password? Make it your own account
        </button>
      )}
    </form>
  );
}

/** The first version's shared passwords: each person turns theirs into a personal account once. */
function ClaimForm({ code, onCancel }: { code: string; onCancel: () => void }) {
  const [old, setOld] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="col" style={{ gap: 8 }} data-testid="claim-form" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr('');
      try { await claimAccount(code, old, name.trim(), pw); toast('Your account is ready: log in with your name from now on'); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
    }}>
      <span className="small muted">Admins and section leads now have their own accounts. Enter the shared password you used so far, then choose your name and a new password of your own. Each old password works once: whoever uses it first gets the account; everyone else needs an invite link from an admin.</span>
      <label className="field"><span>Old shared password</span>
        <input type="password" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="off" />
      </label>
      <label className="field"><span>Your name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" maxLength={40} />
      </label>
      <label className="field"><span>Your new password (at least 8 characters)</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </label>
      <button className="btn primary block" disabled={busy || !old || !name.trim() || pw.length < 8}>{busy ? '…' : 'Create my account'}</button>
      {err && <span className="small" role="alert" style={errStyle}>{err}</span>}
      <button type="button" className="btn small ghost" onClick={onCancel}>Back to log in</button>
    </form>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="col" style={{ gap: 8 }} onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr('');
      try { await changePassword(cur, next); toast('Password changed. Your other phones are logged out.'); onDone(); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
    }}>
      <label className="field"><span>Current password</span><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></label>
      <label className="field"><span>New password (at least 8 characters)</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
      <button className="btn block" disabled={busy || !cur || next.length < 8}>{busy ? '…' : 'Change password'}</button>
      {err && <span className="small" role="alert" style={errStyle}>{err}</span>}
    </form>
  );
}

/** Not logged in on a screen that needs it. */
function NeedLogin({ code, what }: { code: string; what: string }) {
  const choir = cachedChoir();
  return (
    <div className="card">
      <LoggedOutNotice />
      <span className="small muted">{what}</span>
      <LoginForm code={code} legacy={!!choir?.legacyLogin} />
    </div>
  );
}

/** Password gate of the super-admin screen. */
function Gate({ label, onSubmit, children }: { label: string; onSubmit: (pw: string) => Promise<void>; children?: React.ReactNode }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr('');
      try { await onSubmit(pw); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
    }}>
      {children}
      <label className="field"><span>{label}</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
      </label>
      <button className="btn primary block" disabled={busy || !pw}>{busy ? '…' : 'Continue'}</button>
      {err && <span className="small" role="alert" style={errStyle}>{err}</span>}
    </form>
  );
}

// ------------------------------------------------------------------ choir admin

export function ChoirAdmin() {
  const [profile] = useProfile();
  useStoreVersion();
  useSession(true);
  const code = profile.choirCode;
  const session = sessionFor(code);
  const isAdmin = session?.account.role === 'admin';
  // The last admin login on this screen: if it ends elsewhere, the editors stay (with their unsaved
  // changes) until the person logs in again and publishes.
  const [lastAuth, setLastAuth] = useState<Auth | null>(null);
  const token = isAdmin ? session!.token : null;
  useEffect(() => { if (token) setLastAuth({ bearer: token }); }, [token]);
  const [info, setInfo] = useState<ChoirInfo | null>(() => cachedChoir());
  const [library, setLibrary] = useState<LibraryPiece[] | null>(null);
  // The programme editor's unpublished changes (null: none), and how to add a piece to them.
  const draft = useRef<ProgrammeDraft>({ ids: null, add: null });
  const [, setDraftV] = useState(0);
  // Start from the choir's current state, not from this phone's last sync (another admin may have changed it).
  useEffect(() => {
    if (!code || !apiBase()) return;
    let alive = true;
    fetchChoir(code).then((i) => { if (alive) setInfo(i); }).catch(() => { /* keep the cached copy */ });
    return () => { alive = false; };
  }, [code]);
  if (!apiBase()) return <main className="screen"><Top title="Choir admin" /><Offline /></main>;
  if (!code) return <main className="screen"><Top title="Choir admin" /><div className="notice">Join your choir first (Settings → Your choir).</div></main>;
  const auth: Auth | null = token ? { bearer: token } : !session ? lastAuth : null;
  if (!auth) {
    return (
      <main className="screen">
        <Top title="Choir admin" />
        {session
          ? <div className="notice">You're logged in as {session.account.name}, a section lead. Only choir admins can change the programme, the scores and the people. <LogoutLink /></div>
          : <NeedLogin code={code} what="For whoever looks after the choir's programme, scores and section leads. Log in with your own account." />}
      </main>
    );
  }
  const refresh = async () => {
    const r = await syncChoirNow();
    setInfo(cachedChoir());
    return r;
  };
  return (
    <main className="screen">
      <Top title="Choir admin" />
      {session ? (
        <span className="small muted">{info?.name ?? code} · {session.account.name} · <LogoutLink /></span>
      ) : (
        <NeedLogin code={code} what="Your changes below are kept: log in again, then publish them." />
      )}
      <ProgrammeEditor key={`${info?.code}:${info?.cycleUpdatedAt ?? 0}`} code={code} auth={auth} info={info} library={library}
        draft={draft.current} onDraft={() => setDraftV((v) => v + 1)}
        onSaved={(i) => { setInfo(i); void refresh(); }} onConflict={(i) => setInfo(i)} />
      <ScoresEditor code={code} auth={auth} info={info} onChanged={refresh} />
      {session && (
        <LibraryPanel code={code} auth={auth} info={info} draft={draft.current} onList={setLibrary}
          onAdded={(i) => { if (i) setInfo(i); void refresh(); }} />
      )}
      {session && (
        <div className="card" data-testid="people-editor">
          <strong>People</strong>
          <PeoplePanel code={code} auth={auth} />
          <button className="btn small ghost" onClick={() => go({ name: 'choirinsights' })}>See the sections</button>
        </div>
      )}
    </main>
  );
}

function ProgrammeEditor({ code, auth, info, library, draft, onDraft, onSaved, onConflict }: {
  code: string; auth: Auth; info: ChoirInfo | null; library: LibraryPiece[] | null; draft: ProgrammeDraft; onDraft: () => void;
  onSaved: (i: ChoirInfo) => void; onConflict: (i: ChoirInfo) => void;
}) {
  // A new programme starts empty (not from this admin's own phone, which may hold private scores).
  const start: Partial<NonNullable<ChoirInfo['cycle']>> = info?.cycle ?? { name: 'This cycle', pieceIds: [] };
  const [name, setName] = useState(start.name ?? 'This cycle');
  const [ids, setIds] = useState<string[]>(start.pieceIds ?? []);
  const [focus, setFocus] = useState<string[]>(start.focusPieceIds ?? []);
  const [weekday, setWeekday] = useState<number>(start.rehearsalWeekday ?? -1);
  const [time, setTime] = useState(start.rehearsalTime ?? '19:30');
  const [rehearsalDate, setRehearsalDate] = useState(start.rehearsalDate ?? '');
  const [concert, setConcert] = useState(start.concertDate ?? '');
  const [wanted, setWanted] = useState<{ title: string; composer: string; note?: string }[]>((start.wanted ?? []).map((w) => ({ ...w, composer: w.composer ?? '' })));
  const [busy, setBusy] = useState(false);
  // Unpublished changes (the Library adds to them instead of publishing over them).
  const published = start.pieceIds ?? [];
  const dirty = JSON.stringify([name, ids, focus, weekday, time, rehearsalDate, concert, wanted])
    !== JSON.stringify([start.name ?? 'This cycle', published, start.focusPieceIds ?? [], start.rehearsalWeekday ?? -1, start.rehearsalTime ?? '19:30',
      start.rehearsalDate ?? '', start.concertDate ?? '', (start.wanted ?? []).map((w) => ({ ...w, composer: w.composer ?? '' }))]);
  useEffect(() => {
    draft.ids = dirty ? ids : null;
    draft.add = (id) => setIds((xs) => (xs.includes(id) ? xs : [...xs, id]));
    onDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, ids]);
  useEffect(() => () => { draft.ids = null; draft.add = null; }, [draft]);
  // Choose from built-in pieces and the choir's own scores (scores on one phone only can't be shared).
  const choirIds = new Set((info?.pieces ?? []).map((p) => localPieceId(code, p)));
  const choices = allPieces().filter((p) => p.builtin && !p.id.includes('~') || p.id.startsWith(`choir-${code}-`) || choirIds.has(p.id));
  // In the programme but not on this phone: a library piece the choir hasn't added (e.g. a former
  // built-in piece), or a choir score this phone hasn't downloaded yet.
  const missing = ids.filter((id) => !choices.some((p) => p.id === id));
  const missingLabel = (id: string) => {
    const lib = library?.find((p) => p.id === id);
    const score = (info?.pieces ?? []).find((p) => localPieceId(code, p) === id);
    if (score) return { title: score.title || score.filename, note: 'not on this phone yet' };
    if (lib) return { title: lib.title, note: 'no score yet: add it from the Library below' };
    return { title: id, note: 'members don’t have this score' };
  };
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  return (
    <div className="card" data-testid="programme-editor">
      <strong>Programme</strong>
      <label className="field"><span>Name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <span className="small">Pieces (tap to include; ★ = the next rehearsal works on it)</span>
      <div className="col" style={{ gap: 4 }}>
        {choices.map((p) => {
          const on = ids.includes(p.id);
          return (
            <div key={p.id} className="row" style={{ gap: 6 }}>
              <button className="chip grow" style={{ textAlign: 'left' }} aria-pressed={on} onClick={() => { setIds(toggle(ids, p.id)); if (on) setFocus(focus.filter((x) => x !== p.id)); }}>
                {p.title}<span className="tiny muted"> · {p.composer}</span>
              </button>
              <button className="chip" aria-pressed={focus.includes(p.id)} disabled={!on} aria-label={`Next rehearsal: ${p.title}`} onClick={() => setFocus(toggle(focus, p.id))}>★</button>
            </div>
          );
        })}
        {missing.map((id) => {
          const m = missingLabel(id);
          return (
            <div key={id} className="row" style={{ gap: 6 }} data-testid="programme-missing">
              <button className="chip grow" style={{ textAlign: 'left' }} aria-pressed aria-label={`Remove ${m.title} from the programme`}
                onClick={() => { setIds(ids.filter((x) => x !== id)); setFocus(focus.filter((x) => x !== id)); }}>
                {m.title}<span className="tiny muted"> · {m.note}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="row wrap">
        <label className="field grow"><span>Rehearsals</span>
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={inputStyle}>
            <option value={-1}>One-off date</option>
            {WEEKDAYS.map((d, k) => <option key={d} value={k}>Every {d}</option>)}
          </select>
        </label>
        {weekday >= 0
          ? <label className="field"><span>Time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          : <label className="field"><span>Date</span><input type="date" value={rehearsalDate} onChange={(e) => setRehearsalDate(e.target.value)} /></label>}
        <label className="field"><span>Concert</span><input type="date" value={concert} onChange={(e) => setConcert(e.target.value)} /></label>
      </div>
      <span className="small">Still to come (shown as “import your score” until a score is uploaded)</span>
      {wanted.map((w, k) => (
        <div key={k} className="row" style={{ gap: 6 }}>
          <input type="text" aria-label="Title" value={w.title} onChange={(e) => setWanted(wanted.map((x, j) => (j === k ? { ...x, title: e.target.value } : x)))} placeholder="Title" style={{ ...inputStyle, flex: 2, minWidth: 0 }} />
          <input type="text" aria-label="Composer" value={w.composer} onChange={(e) => setWanted(wanted.map((x, j) => (j === k ? { ...x, composer: e.target.value } : x)))} placeholder="Composer" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
          <button className="btn small ghost" aria-label="Remove" onClick={() => setWanted(wanted.filter((_, j) => j !== k))}>✕</button>
        </div>
      ))}
      <button className="btn small ghost" onClick={() => setWanted([...wanted, { title: '', composer: '' }])}>+ Add a piece to come</button>
      <button className="btn primary block" disabled={busy} data-testid="publish-programme" onClick={async () => {
        setBusy(true);
        try {
          const i = await saveChoirCycle(code, auth, {
            name, pieceIds: ids, focusPieceIds: focus.filter((x) => ids.includes(x)),
            ...(weekday >= 0 ? { rehearsalWeekday: weekday, rehearsalTime: time } : rehearsalDate ? { rehearsalDate } : {}),
            ...(concert ? { concertDate: concert } : {}),
            wanted: wanted.filter((w) => w.title.trim()),
            base: info?.cycleUpdatedAt ?? 0,
          });
          toast('Programme published: members get it the next time they open the app');
          onSaved(i);
        } catch (e) {
          toast((e as Error).message);
          if (e instanceof ChoirApiError && e.status === 409) fetchChoir(code).then(onConflict).catch(() => {});
        } finally {
          setBusy(false);
        }
      }}>Publish to the choir</button>
    </div>
  );
}

function ScoresEditor({ code, auth, info, onChanged }: { code: string; auth: Auth; info: ChoirInfo | null; onChanged: () => Promise<unknown> }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  // The title filled in from the file name (replaced when another file is chosen).
  const [autoTitle, setAutoTitle] = useState('');
  const [usage, setUsage] = useState<ChoirUsage | null>(null);
  const pieceStamp = (info?.pieces ?? []).map((p) => p.id).join(',');
  useEffect(() => {
    let alive = true;
    fetchChoirUsage(code, auth).then((u) => { if (alive) setUsage(u); }).catch(() => { /* shown when the server answers */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, pieceStamp]);
  const full = usage ? usage.scoresBytes >= usage.capBytes * 0.9 || (usage.server ? usage.server.totalBytes >= usage.server.capBytes * 0.9 : false) : false;
  return (
    <div className="card" data-testid="scores-editor">
      <strong>Scores</strong>
      <span className="small muted">MusicXML (.musicxml, .xml, .mxl) or MIDI, up to 6 MB. Everyone with the choir code can download them, so only upload scores your choir may share.</span>
      {usage && (
        <span className="small" data-testid="choir-usage" style={full ? errStyle : undefined}>
          {mb(usage.scoresBytes)} of {mb(usage.capBytes)} used · {usage.pieces} score{usage.pieces === 1 ? '' : 's'} · {usage.members} singer{usage.members === 1 ? '' : 's'} sharing progress
          {usage.server && usage.server.totalBytes >= usage.server.capBytes * 0.9 ? ' · the server is nearly full' : ''}
        </span>
      )}
      {(info?.pieces ?? []).map((p) => (
        <div key={p.id} className="row" style={{ gap: 6 }}>
          <span className="grow small ellipsis">{p.title || p.filename}{p.composer && <span className="tiny muted"> · {p.composer}</span>}</span>
          <button className="btn small ghost" onClick={async () => {
            if (!confirm(`Remove “${p.title || p.filename}” from the choir?`)) return;
            try { await deleteChoirPiece(code, auth, p.id); await onChanged(); } catch (e) { toast((e as Error).message); }
          }}>Remove</button>
        </div>
      ))}
      <input key={fileKey} type="file" accept=".musicxml,.xml,.mxl,.mid,.midi" aria-label="Score file" style={{ minHeight: 44 }} onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        setFile(f);
        if (f && (!title || title === autoTitle)) {
          const t = f.name.replace(/\.[^.]+$/, '');
          setTitle(t);
          setAutoTitle(t);
        }
      }} />
      <div className="row" style={{ gap: 6 }}>
        <input type="text" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ ...inputStyle, flex: 2, minWidth: 0 }} />
        <input type="text" aria-label="Composer" value={composer} onChange={(e) => setComposer(e.target.value)} placeholder="Composer" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
      </div>
      <button className="btn block" disabled={!file || busy} onClick={async () => {
        setBusy(true);
        try {
          // Check it opens here first: a broken file would otherwise reach every member's phone.
          let parsed: Awaited<ReturnType<typeof importScoreFile>>;
          try {
            parsed = await importScoreFile(file!.name, await file!.arrayBuffer());
          } catch (e) {
            const why = ((e as Error).message || '').split(/[.\n]/)[0].slice(0, 100);
            toast(`This file can't be read as a score${why ? ` (${why})` : ''}. Export it again as MusicXML or MIDI.`);
            if (title === autoTitle) { setTitle(''); setAutoTitle(''); }
            setFile(null);
            setFileKey((k) => k + 1);
            return;
          }
          await uploadChoirPiece(code, auth, file!, title.trim() || parsed.title, composer.trim() || parsed.composer || '');
          setFile(null);
          setFileKey((k) => k + 1);
          setTitle('');
          setComposer('');
          await onChanged();
          toast('Uploaded: add it to the programme above and publish');
        } catch (e) {
          toast((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}>Upload</button>
    </div>
  );
}

// ------------------------------------------------------------------ section lead

export function SectionLead() {
  const [profile] = useProfile();
  useSession(true);
  const code = profile.choirCode;
  const session = sessionFor(code);
  const admin = session?.account.role === 'admin';
  // A section lead sees the voice parts they lead; a choir admin sees every section.
  const mine = admin ? [...VOICES] as string[] : session?.account.voices ?? [];
  const [picked, setPicked] = useState<string>(['S', 'A', 'T', 'B'].includes(profile.voice) ? profile.voice : 'S');
  const shown = mine.includes(picked) ? picked : mine[0];
  const [view, setView] = useState<SectionInsightsView | null>(null);
  const [err, setErr] = useState('');
  const token = session?.token;
  useEffect(() => {
    if (!token || !code || !shown) return;
    let alive = true;
    setErr('');
    setView(null);
    fetchSectionInsights(code, shown, { bearer: token } as Auth)
      .then((v) => { if (alive) setView(v); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [token, code, shown]);
  if (!apiBase()) return <main className="screen"><Top title="Section lead" /><Offline /></main>;
  if (!code) return <main className="screen"><Top title="Section lead" /><div className="notice">Join your choir first (Settings → Your choir).</div></main>;
  if (!session) {
    return (
      <main className="screen">
        <Top title="Your section" />
        <NeedLogin code={code} what="Section leads see which bars their section finds hard. Log in with the account you made from your invite link." />
      </main>
    );
  }
  return (
    <main className="screen">
      <Top title="Your section" />
      <span className="small muted">{session.account.name} · {admin ? 'as choir admin you see every section' : roleText('lead', session.account.voices)} · <LogoutLink /></span>
      {mine.length > 1 && (
        <div className="chips" role="group" aria-label="Section">
          {mine.map((v) => <button key={v} className="chip" aria-pressed={shown === v} onClick={() => setPicked(v)}>{VOICE_NAME[v]}</button>)}
        </div>
      )}
      {!shown ? (
        <div className="notice">You don't lead a section yet. Your choir admin assigns your voice part.</div>
      ) : err ? (
        <div className="notice" role="alert">{err}</div>
      ) : !view ? (
        <span className="muted">Loading…</span>
      ) : (
        <SectionInsights view={view} />
      )}
    </main>
  );
}

// ------------------------------------------------------------------ super admin

export function SuperAdmin() {
  const [pw, setPw] = useState<string | null>(() => sessionSecret('super'));
  const [list, setList] = useState<ChoirSummary[] | null>(null);
  const [usage, setUsage] = useState<ServerUsage | null>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ code: '', name: '', adminNote: '' });
  const [created, setCreated] = useState<{ name: string; code: string; token: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openLib, setOpenLib] = useState<string | null>(null);
  const load = async (p: string) => {
    try {
      const r = await superList(p);
      setList(r.choirs);
      setUsage(r.usage ?? null);
      setErr('');
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (pw) void load(pw); }, [pw]);
  if (!apiBase()) return <main className="screen"><Top title="Super admin" /><Offline /></main>;
  if (!pw) {
    return (
      <main className="screen">
        <Top title="Super admin" />
        <Gate label="Super-admin password" onSubmit={async (p) => { await superList(p); sessionSecret('super', p); setPw(p); }}>
          <span className="small muted">Creates choirs and invites their admins. The password is set on the server.</span>
        </Gate>
      </main>
    );
  }
  const auth: Auth = { superAdmin: pw };
  return (
    <main className="screen">
      <Top title="Super admin" />
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn small" data-testid="open-usage" onClick={() => go({ name: 'usage' })}>Usage insights</button>
        <LogoutLink onClick={() => { sessionSecret('super', null); setPw(null); }} />
      </div>
      {err && <div className="notice" role="alert">{err}</div>}
      {created ? (
        <div className="card" data-testid="choir-created">
          <span className="eyebrow">Choir created</span>
          <strong style={{ fontSize: 20 }}>{created.name}</strong>
          <span className="small">Members join with the code <strong className="mono">{created.code}</strong>.</span>
          <InviteLinkBox token={created.token} title="Now send this link to the choir's admin"
            hint="With it they choose their name and password, then invite the section leads. It works once, for 7 days." />
          <button className="btn block" onClick={() => setCreated(null)}>Create another choir</button>
        </div>
      ) : (
        <form className="card" data-testid="create-choir" onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await superCreate(pw, form.code.trim(), form.name.trim(), form.adminNote.trim());
            setCreated({ name: r.name, code: r.code, token: r.token });
            setForm({ code: '', name: '', adminNote: '' });
            await load(pw);
          } catch (e2) { toast((e2 as Error).message); }
        }}>
          <strong>New choir</strong>
          <label className="field"><span>Name</span><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} data-testid="new-choir-name" /></label>
          <label className="field"><span>Choir code (what members type; letters, digits, - and _)</span><input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} autoCapitalize="none" maxLength={40} data-testid="new-choir-code" /></label>
          <label className="field"><span>Who will be its admin? (optional, to recognise the invite)</span><input type="text" value={form.adminNote} onChange={(e) => setForm({ ...form, adminNote: e.target.value })} maxLength={60} placeholder="e.g. Clara" /></label>
          <button className="btn primary block" disabled={form.code.trim().length < 3} data-testid="create-choir-btn">Create and get the admin's invite link</button>
        </form>
      )}
      {usage && (
        <div className="card flat" data-testid="server-usage">
          <strong>Storage</strong>
          <span className="small">{mb(usage.totalBytes)} of {mb(usage.capBytes)} used by all choirs</span>
          <span className="small muted">Progress kept with accounts: {usage.accountProgress.count} account{usage.accountProgress.count === 1 ? '' : 's'} · {mb(usage.accountProgress.bytes)} of {mb(usage.accountProgress.capBytes)}</span>
        </div>
      )}
      {(list ?? []).map((c) => (
        <div key={c.code} className="card flat" data-testid="choir-row">
          <strong>{c.name}</strong>
          <span className="small muted">
            code {c.code} · {c.pieces} score{c.pieces === 1 ? '' : 's'}{c.usage ? ` (${mb(c.usage.scoresBytes)} of ${mb(c.usage.capBytes)})` : ''} · {c.members} sharing
            {c.usage?.memberAccounts ? ` · ${c.usage.memberAccounts} member account${c.usage.memberAccounts === 1 ? '' : 's'} (${mb(c.usage.accountProgressBytes ?? 0)} of progress)` : ''}{c.programme ? ` · ${c.programme}` : ''}
          </span>
          <span className="small">
            {c.admins.length ? `Admin${c.admins.length > 1 ? 's' : ''}: ${c.admins.join(', ')}` : 'No admin account yet'}
            {c.leads.length ? ` · section leads for ${c.leads.map((v) => VOICE_NAME[v] ?? v).join(', ')}` : ''}{c.invites ? ` · ${c.invites} open invite${c.invites > 1 ? 's' : ''}` : ''}{c.legacy ? ' · old shared passwords still on' : ''}
          </span>
          <div className="row wrap">
            <button className="btn small" aria-expanded={open === c.code} onClick={() => setOpen(open === c.code ? null : c.code)}>People</button>
            <button className="btn small" aria-expanded={openLib === c.code} data-testid="super-library" onClick={() => setOpenLib(openLib === c.code ? null : c.code)}>Library</button>
            <button className="btn small" onClick={async () => {
              const name = prompt('New name', c.name);
              if (!name) return;
              try { await superRename(pw, c.code, name); await load(pw); } catch (e) { toast((e as Error).message); }
            }}>Rename</button>
            <button className="btn small ghost" onClick={async () => {
              if (prompt(`Type the code “${c.code}” to delete this choir and its scores`) !== c.code) return;
              try { await superDelete(pw, c.code); await load(pw); } catch (e) { toast((e as Error).message); }
            }}>Delete</button>
            {!!c.usage?.memberAccounts && (
              <button className="btn small ghost" onClick={async () => {
                const d = Number(prompt('Remove the member accounts (and their kept progress) nobody used for how many days?', '365'));
                if (!d) return;
                try {
                  // A preview first: who would go.
                  const p = await superPurgeMembers(pw, c.code, d, true);
                  if (!p.names.length) { toast(`Every member used their account in the last ${d} days`); return; }
                  const list = p.names.slice(0, 20).join(', ') + (p.names.length > 20 ? `, and ${p.names.length - 20} more` : '');
                  if (!confirm(`Remove ${p.names.length} member account${p.names.length === 1 ? '' : 's'} not used for ${d} days, with their progress?\n\n${list}`)) return;
                  const r = await superPurgeMembers(pw, c.code, d);
                  toast(`${r.removed} member account${r.removed === 1 ? '' : 's'} removed`);
                  await load(pw);
                } catch (e) { toast((e as Error).message); }
              }}>Remove inactive members</button>
            )}
          </div>
          {open === c.code && <PeoplePanel code={c.code} auth={auth} superAdmin onChanged={() => void load(pw)} />}
          {openLib === c.code && <LibraryPanel code={c.code} auth={auth} embedded onAdded={() => void load(pw)} />}
        </div>
      ))}
      {list && !list.length && <span className="muted">No choirs yet.</span>}
    </main>
  );
}

export { choirPieceId };
