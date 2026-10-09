import React, { useEffect, useRef, useState } from 'react';
import { useProfile, useStoreVersion, toast } from '../hooks';
import { back, go } from '../router';
import { allPieces, syncChoirNow } from '../library';
import { IconBack } from '../icons';
import { WEEKDAYS } from '../../progress/rehearsal';
import {
  apiBase, cachedChoir, changePassword, choirPieceId, claimAccount, deleteChoirPiece, fetchChoir, joinChoir, leaveChoir, ChoirApiError,
  loadSession, loggedOutNotice, login, logout, onSessionChange, refreshSession, refreshSessionSoon, saveChoirCycle, sessionFor, superCreate, superDelete,
  superList, superPurgeMembers, superRename, uploadChoirPiece, withdrawProgress, fetchChoirUsage, mb, type Auth, type ChoirInfo, type ChoirSummary, type ChoirUsage,
  type ServerUsage, type Session, localPieceId, sharingEnded, sharingNeedsOk, startSharing, type LibraryPiece, addLibraryPiece, loadSuperSession, superLogin, superLogout, superLoggedOutNotice,
  fetchCycles, createCycle, updateCycle, deleteCycle, type ChoirCycle, type CyclesReply, choirCycleNow,
} from '../../progress/choir';
import { LibraryPanel, type ProgrammeDraft } from '../components/ChoirLibrary';
import { LAB_ID, LAB_TITLE, scoresOf } from '../../game/intonation';
import { ChoirLogoEditor } from '../components/ChoirLogo';
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
        void shareMyProgress(true); // part of being in the choir: the section lead sees this singer from now on
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
              {choirCycleNow(choir) ? `Programme: ${choirCycleNow(choir)!.name} · ` : ''}{choir!.pieces.length} score{choir!.pieces.length === 1 ? '' : 's'} from the choir
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
            <strong>{profile.shareProgress ? 'Shared with your section lead' : 'Not shared with your section lead'}</strong>
            {profile.shareOptOut && !profile.shareProgress && <span className="small muted" data-testid="share-optout">You switched this off (Settings → Privacy).</span>}
            {!profile.shareProgress && sharingEnded() && <span className="small" role="status" style={errStyle}>Your choir account was removed or deleted, so nothing is sent. Log in again (or leave and rejoin the choir) to share again.</span>}
            {sharingNeedsOk() && (
              <button className="btn primary small" style={{ alignSelf: 'flex-start' }} data-testid="start-sharing"
                onClick={() => { startSharing(); void shareMyProgress(true).then(() => update({})); update({}); }}>Start sharing</button>
            )}
            <span className="small muted" data-testid="share-note">How each bar is going and which notes keep going wrong, so they know what to rehearse. Your lead and the admins see these only as section totals (in a small section they may still tell which are yours), and your voice range by name. The leaderboard shows everyone in the choir your first name, voice and readiness. Both can be switched off in Settings → Privacy.</span>
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
      <span className="tiny muted">Forgot your password? A choir admin can make you a reset link (Admin → Choir → People → Reset password).</span>
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

/** A member's own account opened a staff page (e.g. by its address): say who it is for, nothing more. */
function StaffOnly({ name }: { name: string }) {
  return (
    <div className="notice" data-testid="staff-only">
      This page is for section leads and choir admins: they log in with the account from their invite link.
      You're logged in as {name}, a choir member.
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
  // The choir's cycles (all of them: admins see past ones too) and the one being edited.
  const [cycles, setCycles] = useState<CyclesReply | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  // Edit (or Editing) brings the programme editor into view: it sits below the cycles, often off screen.
  const [jump, setJump] = useState(0);
  useEffect(() => {
    if (!jump) return;
    const el = document.querySelector('[data-testid="programme-editor"]');
    // (already in the upper part of the screen, as on a laptop: leave the page where it is)
    const top = el?.getBoundingClientRect().top ?? 0;
    if (el && (top < 0 || top > innerHeight * 0.6)) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // …and it lights up briefly either way, so the click always shows where the editing happens.
    (el as HTMLElement | null)?.animate?.([{ boxShadow: '0 0 0 3px var(--voice)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1400, easing: 'ease-out' });
  }, [jump]);
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
  const sel = cycles?.cycles.find((c) => c.id === selId) ?? null;
  // The version of the selected cycle the editor started from: it starts again from the server's copy
  // when that cycle changed (a save, another admin's edit, a piece from the library), but asks first
  // when that would drop unsaved changes. Changes to other cycles leave the editor alone.
  const [edVer, setEdVer] = useState<number | undefined>(undefined);
  const edFor = useRef<string | null>(null);
  const justSaved = useRef(false);
  useEffect(() => {
    if (!sel || (edFor.current === sel.id && edVer === sel.updatedAt)) return;
    if (edFor.current === sel.id && !justSaved.current && draft.current.ids
      && !confirm(`“${sel.name}” was changed meanwhile (by another admin?). Load the new version? Your unsaved changes would be lost.`)) return;
    justSaved.current = false;
    edFor.current = sel.id;
    setEdVer(sel.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, sel?.updatedAt]);
  if (!apiBase()) return <><Offline /></>;
  if (!code) return <><div className="notice">Join your choir first (Settings → Your choir).</div></>;
  const auth: Auth | null = token ? { bearer: token } : !session ? lastAuth : null;
  if (!auth) {
    return (
      <>
        {session?.account.role === 'member'
          ? <StaffOnly name={session.account.name} />
          : session
          ? <div className="notice">You're logged in as {session.account.name}, a section lead. Only choir admins can change the programme, the scores and the people. <LogoutLink /></div>
          : <NeedLogin code={code} what="For whoever looks after the choir's programme, scores and section leads. Log in with your own account." />}
      </>
    );
  }
  const refresh = async () => {
    const r = await syncChoirNow();
    setInfo(cachedChoir());
    return r;
  };
  const unsaved = (what: string) => !!draft.current.ids && !confirm(`Your changes to “${sel?.name ?? 'the programme'}” aren't saved. ${what}? They would be lost.`);
  const gotCycles = (r: CyclesReply, select?: string) => {
    setCycles(r);
    setInfo(r.choir);
    const pick = select && select !== selId && !unsaved('Open the new cycle anyway') ? select : null;
    setSelId((cur) => pick ?? (cur && r.cycles.some((c) => c.id === cur) ? cur : cycleNow(r.cycles)?.id ?? r.cycles[r.cycles.length - 1]?.id ?? null));
  };
  const reloadCycles = () => { void fetchCycles(code, auth).then((r) => gotCycles(r)).catch(() => {}); };
  return (
    <>
      {session ? (
        <span className="small muted">{info?.name ?? code} · {session.account.name} · <LogoutLink /></span>
      ) : (
        <NeedLogin code={code} what="Your changes below are kept: log in again, then publish them." />
      )}
      {/* Wide screens: the logo, cycles, programme and scores on the left; the library and the people on the right. */}
      <div className="lay admin-cols">
      <div className="lay admin-col">
      <ChoirLogoEditor code={code} auth={auth} info={info} onChanged={(i) => setInfo((cur) => (cur ? { ...cur, logo: i.logo } : i))} />
      <CyclesPanel code={code} auth={auth} cycles={cycles} selId={selId}
        onSelect={(id) => { if (id !== selId && unsaved(`Edit another cycle anyway`)) return; setSelId(id); setJump((n) => n + 1); }}
        onLoaded={gotCycles} onChanged={(r, select) => { gotCycles(r, select); void refresh(); }} />
      {sel && (
        <ProgrammeEditor key={`${info?.code}:${sel.id}:${edVer ?? 0}`} code={code} auth={auth} info={info} cycle={sel} all={cycles?.cycles ?? []}
          base={cycles?.cycleUpdatedAt ?? 0} library={library}
          draft={draft.current} onDraft={() => setDraftV((v) => v + 1)}
          onLibraryAdded={(i) => { if (i) setInfo(i); void refresh(); reloadCycles(); }}
          onSaved={(r) => { justSaved.current = true; gotCycles(r); void refresh(); }} onConflict={reloadCycles} />
      )}
      <ScoresEditor code={code} auth={auth} info={info} onChanged={refresh} />
      </div>
      <div className="lay admin-col">
      {session && (
        <LibraryPanel code={code} auth={auth} info={info} draft={draft.current} cycle={sel} onList={setLibrary}
          onAdded={(i) => { if (i) setInfo(i); void refresh(); reloadCycles(); }} />
      )}
      {session && (
        <div className="card" data-testid="people-editor">
          <strong>People</strong>
          <PeoplePanel code={code} auth={auth} />
          <button className="btn small ghost" onClick={() => go({ name: 'choirinsights' })}>See the sections</button>
        </div>
      )}
      </div>
      </div>
    </>
  );
}

function ProgrammeEditor({ code, auth, info, cycle, all, base, library, draft, onDraft, onSaved, onConflict, onLibraryAdded }: {
  code: string; auth: Auth; info: ChoirInfo | null; cycle: ChoirCycle; all: ChoirCycle[]; base: number; library: LibraryPiece[] | null; draft: ProgrammeDraft; onDraft: () => void;
  onSaved: (r: CyclesReply) => void; onConflict: () => void; onLibraryAdded: (i: ChoirInfo | null) => void;
}) {
  const start = cycle;
  const [name, setName] = useState(start.name ?? 'This cycle');
  const [from, setFrom] = useState(cycle.start);
  const [until, setUntil] = useState(cycle.end ?? '');
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
  const dirty = JSON.stringify([name, from, until, ids, focus, weekday, time, rehearsalDate, concert, wanted])
    !== JSON.stringify([start.name ?? 'This cycle', cycle.start, cycle.end ?? '', published, start.focusPieceIds ?? [], start.rehearsalWeekday ?? -1, start.rehearsalTime ?? '19:30',
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
  // In the programme but not on this phone: a choir score this phone hasn't downloaded yet, or a
  // library piece without a score in the choir. The server copies a library piece's score in by
  // itself when it serves the choir (a former built-in piece), so that one is missing only when the
  // choir's storage is full.
  const missing = ids.filter((id) => id !== LAB_ID && !choices.some((p) => p.id === id));
  // Library pieces the programme can take straight away: tapping one copies its score into the choir
  // (on the server) and includes it here; publishing sends it to the members.
  const fromLibrary = (library ?? []).filter((l) => !choices.some((p) => p.id === l.id) && !ids.includes(l.id));
  const [adding, setAdding] = useState<string | null>(null);
  const includeFromLibrary = async (l: LibraryPiece) => {
    setAdding(l.id);
    try {
      if (!l.scoreId) onLibraryAdded((await addLibraryPiece(code, auth, l.id, false)).choir ?? null);
      setIds((xs) => (xs.includes(l.id) ? xs : [...xs, l.id]));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setAdding(null);
    }
  };
  const missingLabel = (id: string) => {
    const lib = library?.find((p) => p.id === id);
    const score = (info?.pieces ?? []).find((p) => localPieceId(code, p) === id);
    if (score) return { title: score.title || score.filename, note: score.libraryId ? 'from the library: on its way to this phone' : 'not on this phone yet' };
    if (lib) return { title: lib.title, note: 'members don’t have this score yet: is the choir’s storage full?' };
    return { title: id, note: 'members don’t have this score' };
  };
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  // (with the dates as edited here: running, to come or over)
  const state = cycleState(cycle.id, all.map((c) => (c.id === cycle.id ? { ...c, start: from, end: until || undefined } : c)));
  return (
    <div className="card" data-testid="programme-editor" style={{ scrollMarginTop: 12 }}>
      <strong>Editing: {cycle.name}</strong>
      <label className="field"><span>Name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="programme-name" /></label>
      <div className="row wrap">
        <label className="field"><span>Starts</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="cycle-start" /></label>
        <label className="field"><span>Ends (optional)</span><input type="date" value={until} min={from} onChange={(e) => setUntil(e.target.value)} data-testid="cycle-end" /></label>
      </div>
      <span className="small">Pieces (tap to include; ★ = the next rehearsal works on it)</span>
      <div className="col" style={{ gap: 4 }}>
        {choices.map((p) => {
          const on = ids.includes(p.id);
          return (
            <div key={p.id} className="row" style={{ gap: 6 }}>
              <button className="chip grow" style={{ textAlign: 'left' }} aria-pressed={on} onClick={() => { setIds(toggle(ids, p.id)); if (on) setFocus(focus.filter((x) => x !== p.id)); }}>
                {p.title}{p.composer && <span className="tiny muted"> · {p.composer}</span>}
              </button>
              <button className="chip" aria-pressed={focus.includes(p.id)} disabled={!on} aria-label={`Next rehearsal: ${p.title}`} onClick={() => setFocus(toggle(focus, p.id))}>★</button>
            </div>
          );
        })}
        {/* (an exercise, not a score: no rehearsal star) */}
        <div className="row" style={{ gap: 6 }}>
          <button className="chip grow" style={{ textAlign: 'left' }} aria-pressed={ids.includes(LAB_ID)} data-testid="programme-lab"
            onClick={() => setIds(toggle(ids, LAB_ID))}>
            {LAB_TITLE}<span className="tiny muted"> · exercise: pure fifths and thirds by ear</span>
          </button>
        </div>
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
        {fromLibrary.length > 0 && <span className="tiny muted" style={{ marginTop: 6 }}>From the library (tap to add to the choir and include)</span>}
        {fromLibrary.map((l) => (
          <div key={l.id} className="row" style={{ gap: 6 }} data-testid="programme-library">
            <button className="chip grow" style={{ textAlign: 'left' }} aria-pressed={false} disabled={adding !== null}
              onClick={() => void includeFromLibrary(l)}>
              {adding === l.id ? 'Adding… ' : ''}{l.title}{l.composer && <span className="tiny muted"> · {l.composer}</span>}
            </button>
          </div>
        ))}
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
          // The whole programme (with pieceIds the server clears what isn't sent: no concert, no
          // weekly rehearsal any more).
          const r = await updateCycle(code, auth, cycle.id, {
            name, start: from, end: until || null, pieceIds: ids, focusPieceIds: focus.filter((x) => ids.includes(x)),
            ...(weekday >= 0 ? { rehearsalWeekday: weekday, rehearsalTime: time } : rehearsalDate ? { rehearsalDate } : {}),
            ...(concert ? { concertDate: concert } : {}),
            wanted: wanted.filter((w) => w.title.trim()),
            base,
          });
          const now = cycleState(cycle.id, r.cycles);
          toast(now === 'running' ? 'Programme published: members get it the next time they open the app'
            : now === 'future' ? `Saved: members get this programme when the cycle starts (${fmtDay(from)})`
            : 'Saved. This cycle is over, so members don’t get it.');
          onSaved(r);
        } catch (e) {
          toast((e as Error).message);
          // (another admin changed or deleted it: load the cycles again)
          if (e instanceof ChoirApiError && (e.status === 409 || e.status === 404)) onConflict();
        } finally {
          setBusy(false);
        }
      }}>{state === 'running' ? 'Publish to the choir' : state === 'future' ? 'Save this cycle' : 'Save'}</button>
    </div>
  );
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** The cycle running by this phone's date (the rule members' phones use). */
const cycleNow = (all: ChoirCycle[]) => choirCycleNow({ cycle: null, cycles: all }, todayKey()) as ChoirCycle | null;
/** A cycle by this phone's date: running now, still to come, or over. */
function cycleState(id: string, all: ChoirCycle[]): 'running' | 'future' | 'over' {
  const c = all.find((x) => x.id === id);
  return cycleNow(all)?.id === id ? 'running' : c && c.start > todayKey() ? 'future' : 'over';
}

/**
 * The choir's cycles: each a programme from a start date to an end date (or until the next one
 * starts). Members only ever get the one running and those to come; admins see them all here, start
 * a new one, edit any of them and delete them.
 */
function CyclesPanel({ code, auth, cycles, selId, onSelect, onLoaded, onChanged }: {
  code: string; auth: Auth; cycles: CyclesReply | null; selId: string | null; onSelect: (id: string) => void;
  onLoaded: (r: CyclesReply) => void; onChanged: (r: CyclesReply, select?: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', start: todayKey(), end: '', keep: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchCycles(code, auth).then((r) => { if (alive) onLoaded(r); }).catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  const today = todayKey();
  const list = [...(cycles?.cycles ?? [])].reverse(); // newest first
  // (all by this phone's date, as members' phones decide)
  const running = cycleNow(cycles?.cycles ?? []);
  const status = (c: ChoirCycle) => (c.id === running?.id ? 'Running now' : c.start > today ? `Starts ${fmtDay(c.start)}` : 'Over');
  // Another admin changed the cycles (or deleted this one): load them again, so the next try works.
  const failed = (e: unknown) => {
    toast((e as Error).message);
    if (e instanceof ChoirApiError && (e.status === 409 || e.status === 404)) fetchCycles(code, auth).then(onLoaded).catch(() => {});
  };
  const create = async () => {
    if (!form.name.trim()) { toast('Give the cycle a name'); return; }
    setBusy(true);
    try {
      const keep = form.keep && running ? {
        pieceIds: running.pieceIds, focusPieceIds: running.focusPieceIds ?? [], wanted: running.wanted ?? [],
        ...(running.rehearsalWeekday != null ? { rehearsalWeekday: running.rehearsalWeekday, rehearsalTime: running.rehearsalTime } : {}),
      } : { pieceIds: [] };
      const r = await createCycle(code, auth, { name: form.name.trim(), start: form.start, ...(form.end ? { end: form.end } : {}), ...keep, base: cycles?.cycleUpdatedAt });
      const made = r.cycles.filter((c) => c.name === form.name.trim() && c.start === form.start).pop(); // (the last made)
      const st = made ? cycleState(made.id, r.cycles) : 'over';
      toast(st === 'future' ? `${form.name.trim()} starts on ${fmtDay(form.start)}`
        : st === 'running' ? `${form.name.trim()} has started: everyone's “notes right this cycle” begin at 0`
        : `${form.name.trim()} is saved. It is over, so members don’t get it.`);
      setAdding(false);
      setForm({ name: '', start: todayKey(), end: '', keep: true });
      onChanged(r, made?.id);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" data-testid="cycles-panel">
      <div className="row between">
        <strong>Cycles</strong>
        {!adding && <button className="btn small primary" onClick={() => setAdding(true)} data-testid="new-cycle">Start a new cycle</button>}
      </div>
      <span className="small muted">
        A cycle is the programme from its start date to its end (or until the next cycle starts). Singers see only the one running;
        when the next starts, it replaces it and everyone's “notes right this cycle” begin again at 0.
      </span>
      {err && <span className="small" role="alert" style={errStyle}>{err}</span>}
      {adding && (
        <div className="col" style={{ gap: 8, background: 'var(--bg-2)', borderRadius: 10, padding: 12 }} data-testid="new-cycle-form">
          <label className="field"><span>Name</span><input type="text" value={form.name} maxLength={80} placeholder="e.g. Spring 2027" autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="new-cycle-name" /></label>
          <div className="row wrap">
            <label className="field"><span>Starts</span><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} data-testid="new-cycle-start" /></label>
            <label className="field"><span>Ends (optional)</span><input type="date" value={form.end} min={form.start} onChange={(e) => setForm({ ...form, end: e.target.value })} data-testid="new-cycle-end" /></label>
          </div>
          {running && (
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={form.keep} onChange={(e) => setForm({ ...form, keep: e.target.checked })} />
              Start with the pieces of {running.name}
            </label>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary small" disabled={busy} onClick={create} data-testid="new-cycle-create">{busy ? '…' : 'Create'}</button>
            <button className="btn ghost small" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {cycles && !cycles.cycles.length && !adding && <span className="small">No cycle yet: start the first one.</span>}
      <div className="col" style={{ gap: 6 }}>
        {list.map((c) => {
          const st = status(c);
          return (
            <div key={c.id} className="row" style={{ gap: 8, padding: '6px 0', borderTop: '1px solid var(--line)' }} data-testid="cycle-row">
              <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
                <span className="small ellipsis" style={{ fontWeight: 700 }}>{c.name}</span>
                <span className="tiny muted">{fmtDay(c.start)}{c.end ? ` – ${fmtDay(c.end)}` : ' onwards'} · {scoresOf(c.pieceIds).length} piece{scoresOf(c.pieceIds).length === 1 ? '' : 's'}{c.pieceIds.includes(LAB_ID) ? ` + ${LAB_TITLE.toLowerCase()}` : ''}</span>
                <span className="tiny" style={{ color: st === 'Running now' ? 'var(--voice)' : 'var(--muted)', fontWeight: 600 }}>{st}</span>
              </div>
              <button className="btn small" aria-pressed={c.id === selId} onClick={() => onSelect(c.id)} data-testid="cycle-edit">{c.id === selId ? 'Editing ↓' : 'Edit'}</button>
              <button className="btn small ghost" aria-label={`Delete ${c.name}`} data-testid="cycle-delete" onClick={async () => {
                if (!confirm(`Delete the cycle “${c.name}”?${c.id === running?.id ? ' It is running now: singers lose its programme.' : ''}`)) return;
                try { onChanged(await deleteCycle(code, auth, c.id, cycles?.cycleUpdatedAt)); } catch (e) { failed(e); }
              }}>Delete</button>
            </div>
          );
        })}
      </div>
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
  if (!apiBase()) return <><Offline /></>;
  if (!code) return <><div className="notice">Join your choir first (Settings → Your choir).</div></>;
  if (!session || session.account.role === 'member') {
    return (
      <>
        {session
          ? <StaffOnly name={session.account.name} />
          : <NeedLogin code={code} what="Section leads see which bars their section finds hard. Log in with the account you made from your invite link." />}
      </>
    );
  }
  return (
    <>
      <span className="small muted">{session.account.name} · {admin ? 'as choir admin you see every section' : roleText('lead', session.account.voices)} · <LogoutLink /></span>
      {admin && <button className="btn small ghost" style={{ alignSelf: 'flex-start' }} data-testid="all-sections" onClick={() => go({ name: 'choirinsights' })}>← All sections side by side</button>}
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
    </>
  );
}

// ------------------------------------------------------------------ super admin

export function SuperAdmin() {
  useSession(); // re-renders when the super-admin login starts or ends
  const sup = loadSuperSession();
  const token = sup?.token ?? null;
  const [list, setList] = useState<ChoirSummary[] | null>(null);
  const [usage, setUsage] = useState<ServerUsage | null>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ code: '', name: '', adminNote: '' });
  const [created, setCreated] = useState<{ name: string; code: string; token: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openLib, setOpenLib] = useState<string | null>(null);
  const load = async (a: Auth) => {
    try {
      const r = await superList(a);
      setList(r.choirs);
      setUsage(r.usage ?? null);
      setErr('');
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (token) void load({ bearer: token }); else { setList(null); setUsage(null); setErr(''); } }, [token]);
  if (!apiBase()) return <><Offline /></>;
  if (!token) {
    const ended = superLoggedOutNotice();
    return (
      <>
        {ended && <div className="notice" role="alert" data-testid="super-logged-out">{ended}</div>}
        <Gate label="Super-admin password" onSubmit={async (p) => { await superLogin(p); }}>
          <span className="small muted">Creates choirs and invites their admins. The password is set on the server; this phone stays logged in for 30 days (or until you log out).</span>
        </Gate>
      </>
    );
  }
  const auth: Auth = { bearer: token };
  const reload = () => load(auth);
  return (
    <>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <button className="btn small" data-testid="open-usage" onClick={() => go({ name: 'usage' })}>Usage insights</button>
        <button className="linklike" style={{ minHeight: 44 }} data-testid="super-logout" onClick={() => void superLogout()}>Log out of super admin</button>
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
            const r = await superCreate(auth, form.code.trim(), form.name.trim(), form.adminNote.trim());
            setCreated({ name: r.name, code: r.code, token: r.token });
            setForm({ code: '', name: '', adminNote: '' });
            await reload();
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
              try { await superRename(auth, c.code, name); await reload(); } catch (e) { toast((e as Error).message); }
            }}>Rename</button>
            <button className="btn small ghost" onClick={async () => {
              if (prompt(`Type the code “${c.code}” to delete this choir and its scores`) !== c.code) return;
              try { await superDelete(auth, c.code); await reload(); } catch (e) { toast((e as Error).message); }
            }}>Delete</button>
            {!!c.usage?.memberAccounts && (
              <button className="btn small ghost" onClick={async () => {
                const d = Number(prompt('Remove the member accounts (and their kept progress) nobody used for how many days?', '365'));
                if (!d) return;
                try {
                  // A preview first: who would go.
                  const p = await superPurgeMembers(auth, c.code, d, true);
                  if (!p.names.length) { toast(`Every member used their account in the last ${d} days`); return; }
                  const list = p.names.slice(0, 20).join(', ') + (p.names.length > 20 ? `, and ${p.names.length - 20} more` : '');
                  if (!confirm(`Remove ${p.names.length} member account${p.names.length === 1 ? '' : 's'} not used for ${d} days, with their progress?\n\n${list}`)) return;
                  const r = await superPurgeMembers(auth, c.code, d);
                  toast(`${r.removed} member account${r.removed === 1 ? '' : 's'} removed`);
                  await reload();
                } catch (e) { toast((e as Error).message); }
              }}>Remove inactive members</button>
            )}
          </div>
          {open === c.code && <PeoplePanel code={c.code} auth={auth} superAdmin onChanged={() => void reload()} />}
          {openLib === c.code && <LibraryPanel code={c.code} auth={auth} embedded onAdded={() => void reload()} />}
        </div>
      ))}
      {list && !list.length && <span className="muted">No choirs yet.</span>}
    </>
  );
}

export { choirPieceId };
