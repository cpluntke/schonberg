import React, { useEffect, useMemo, useState } from 'react';
import { useProfile, useStoreVersion, toast } from '../hooks';
import { back, go } from '../router';
import { allPieces, getPiece, syncChoirNow, chosenPartId, singableSections } from '../library';
import { IconBack } from '../icons';
import { loadCycle } from '../../progress/store';
import { WEEKDAYS } from '../../progress/rehearsal';
import {
  apiBase, cachedChoir, checkAdmin, checkLead, choirPieceId, deleteChoirPiece, fetchChoir, fetchSection, joinChoir, leaveChoir, ChoirApiError,
  saveChoirCycle, sessionSecret, setSectionLead, superCreate, superDelete, superList, superUpdate, uploadChoirPiece,
  withdrawProgress, type ChoirInfo, type ChoirSummary, type SectionView,
} from '../../progress/choir';
import { PieceMap } from '../components/PieceMap';
import { importScoreFile } from '../../music/import';
import { mastery, type BarMap } from '../../progress/bars';
import { shareMyProgress, shareError } from '../play/shareProgress';

const VOICE_NAME: Record<string, string> = { S: 'Sopranos', A: 'Altos', T: 'Tenors', B: 'Basses' };
const inputStyle: React.CSSProperties = { minHeight: 44, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', padding: '0 12px' };

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
            <label className="toggle-row"><span>Share my progress with my section lead<span className="tiny muted" style={{ display: 'block' }}>Your name, your voice part and how each bar is going, so they know what to rehearse.</span></span>
              <input type="checkbox" checked={!!profile.shareProgress} onChange={async (e) => {
                const on = e.target.checked;
                update({ shareProgress: on });
                if (on) void shareMyProgress(true).then(() => update({}));
                else if (profile.name.trim()) withdrawProgress(profile.choirCode!, profile.name.trim()).catch(() => {});
              }} />
            </label>
            {!profile.name.trim() && profile.shareProgress && <span className="small" style={{ color: 'var(--accent-text)' }}>Add your name in Voice setup first.</span>}
            {profile.name.trim() && profile.shareProgress && shareError() && <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>Not shared yet: {shareError()}</span>}
          </div>
          <div className="card flat">
            <strong>Roles</strong>
            <div className="row wrap">
              <button className="btn small" onClick={() => go({ name: 'choiradmin' })}>Choir admin</button>
              <button className="btn small" onClick={() => go({ name: 'section' })}>Section lead</button>
            </div>
            <span className="tiny muted">Admins curate the programme and upload scores; section leads see where their section struggles. Both need a password from your choir.</span>
          </div>
        </>
      )}
      <button className="linklike tiny muted" style={{ alignSelf: 'center', marginTop: 'auto', minHeight: 44 }} onClick={() => go({ name: 'superadmin' })}>Setting up choirs? (super admin)</button>
    </main>
  );
}

/** Password gate shared by the admin, section-lead and super-admin screens. */
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
      {err && <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>{err}</span>}
    </form>
  );
}

// ------------------------------------------------------------------ choir admin

export function ChoirAdmin() {
  const [profile] = useProfile();
  useStoreVersion();
  const code = profile.choirCode;
  const [admin, setAdmin] = useState<string | null>(() => sessionSecret('admin'));
  const [info, setInfo] = useState<ChoirInfo | null>(() => cachedChoir());
  // Start from the choir's current state, not from this phone's last sync (another admin may have changed it).
  useEffect(() => {
    if (!code || !apiBase()) return;
    let alive = true;
    fetchChoir(code).then((i) => { if (alive) setInfo(i); }).catch(() => { /* keep the cached copy */ });
    return () => { alive = false; };
  }, [code]);
  if (!apiBase()) return <main className="screen"><Top title="Choir admin" /><Offline /></main>;
  if (!code) return <main className="screen"><Top title="Choir admin" /><div className="notice">Join your choir first (Settings → Your choir).</div></main>;
  if (!admin) {
    return (
      <main className="screen">
        <Top title="Choir admin" />
        <Gate label="Admin password" onSubmit={async (pw) => { await checkAdmin(code, pw); sessionSecret('admin', pw); setAdmin(pw); }}>
          <span className="small muted">For whoever looks after the choir's programme and scores. The password comes from your choir (or the person who set up the choir).</span>
        </Gate>
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
      <span className="small muted">{info?.name ?? code} · <button className="linklike" onClick={() => { sessionSecret('admin', null); setAdmin(null); }}>Log out</button></span>
      <ProgrammeEditor key={`${info?.code}:${info?.cycleUpdatedAt ?? 0}`} code={code} admin={admin} info={info}
        onSaved={(i) => { setInfo(i); void refresh(); }} onConflict={(i) => setInfo(i)} />
      <ScoresEditor code={code} admin={admin} info={info} onChanged={refresh} />
      <LeadsEditor code={code} admin={admin} info={info} onChanged={refresh} />
    </main>
  );
}

function ProgrammeEditor({ code, admin, info, onSaved, onConflict }: { code: string; admin: string; info: ChoirInfo | null; onSaved: (i: ChoirInfo) => void; onConflict: (i: ChoirInfo) => void }) {
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
  // Choose from built-in pieces and the choir's own scores (scores on one phone only can't be shared).
  const choices = allPieces().filter((p) => p.builtin && !p.id.includes('~') || p.id.startsWith(`choir-${code}-`));
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
          const i = await saveChoirCycle(code, admin, {
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

function ScoresEditor({ code, admin, info, onChanged }: { code: string; admin: string; info: ChoirInfo | null; onChanged: () => Promise<unknown> }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  return (
    <div className="card" data-testid="scores-editor">
      <strong>Scores</strong>
      <span className="small muted">MusicXML (.musicxml, .xml, .mxl) or MIDI, up to 6 MB. Everyone with the choir code can download them, so only upload scores your choir may share.</span>
      {(info?.pieces ?? []).map((p) => (
        <div key={p.id} className="row" style={{ gap: 6 }}>
          <span className="grow small ellipsis">{p.title || p.filename}{p.composer && <span className="tiny muted"> · {p.composer}</span>}</span>
          <button className="btn small ghost" onClick={async () => {
            if (!confirm(`Remove “${p.title || p.filename}” from the choir?`)) return;
            try { await deleteChoirPiece(code, admin, p.id); await onChanged(); } catch (e) { toast((e as Error).message); }
          }}>Remove</button>
        </div>
      ))}
      <input key={fileKey} type="file" accept=".musicxml,.xml,.mxl,.mid,.midi" aria-label="Score file" style={{ minHeight: 44 }} onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        setFile(f);
        if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
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
            toast(`This file can't be read as a score: ${(e as Error).message}`);
            return;
          }
          await uploadChoirPiece(code, admin, file!, title.trim() || parsed.title, composer.trim() || parsed.composer || '');
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

function LeadsEditor({ code, admin, info, onChanged }: { code: string; admin: string; info: ChoirInfo | null; onChanged: () => Promise<unknown> }) {
  const [pw, setPw] = useState<Record<string, string>>({});
  return (
    <div className="card" data-testid="leads-editor">
      <strong>Section leads</strong>
      <span className="small muted">Give each section lead a password: they'll see which bars their section finds hard (from members who share their progress).</span>
      {['S', 'A', 'T', 'B'].map((v) => {
        const has = info?.leads?.includes(v);
        return (
          <div key={v} className="row" style={{ gap: 6 }}>
            <span style={{ width: 80 }} className="small">{VOICE_NAME[v]}{has ? ' ✓' : ''}</span>
            <input type="password" aria-label={`${VOICE_NAME[v]} lead password`} value={pw[v] ?? ''} onChange={(e) => setPw({ ...pw, [v]: e.target.value })}
              placeholder={has ? 'new password' : 'password'} autoComplete="new-password" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
            <button className="btn small" disabled={(pw[v] ?? '').length < 6} onClick={async () => {
              try { await setSectionLead(code, admin, v, pw[v]); setPw({ ...pw, [v]: '' }); await onChanged(); toast(`${VOICE_NAME[v]}: section lead set`); } catch (e) { toast((e as Error).message); }
            }}>Set</button>
            {has && <button className="btn small ghost" onClick={async () => {
              try { await setSectionLead(code, admin, v, null); await onChanged(); } catch (e) { toast((e as Error).message); }
            }}>Remove</button>}
          </div>
        );
      })}
      <button className="btn small ghost" onClick={() => go({ name: 'section' })}>See the sections</button>
    </div>
  );
}

// ------------------------------------------------------------------ section lead

export function SectionLead() {
  const [profile] = useProfile();
  const code = profile.choirCode;
  const [voice, setVoice] = useState<string>(['S', 'A', 'T', 'B'].includes(profile.voice) ? profile.voice : 'S');
  // A section lead's password opens their own voice part only; a choir admin sees every section.
  const [auth, setAuth] = useState<{ lead: string; voice: string } | { admin: string } | null>(() => {
    const lead = sessionSecret('lead');
    const leadVoice = sessionSecret('leadVoice');
    const admin = sessionSecret('admin');
    return lead && leadVoice ? { lead, voice: leadVoice } : admin ? { admin } : null;
  });
  const shown = auth && 'lead' in auth ? auth.voice : voice;
  const [view, setView] = useState<SectionView | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!auth || !code) return;
    let alive = true;
    setErr('');
    setView(null);
    fetchSection(code, shown, 'lead' in auth ? { lead: auth.lead } : { admin: auth.admin })
      .then((v) => { if (alive) setView(v); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [auth, code, shown]);
  if (!apiBase()) return <main className="screen"><Top title="Section lead" /><Offline /></main>;
  if (!code) return <main className="screen"><Top title="Section lead" /><div className="notice">Join your choir first (Settings → Your choir).</div></main>;
  const logout = () => { sessionSecret('lead', null); sessionSecret('leadVoice', null); if (auth && 'admin' in auth) sessionSecret('admin', null); setAuth(null); };
  return (
    <main className="screen">
      <Top title="Your section" />
      {auth && 'lead' in auth ? (
        <span className="small muted">{VOICE_NAME[auth.voice]} · <button className="linklike" onClick={logout}>Log out</button></span>
      ) : (
        <>
          {!auth && <span className="small">Which section do you lead?</span>}
          <div className="chips" role="group" aria-label="Section">
            {['S', 'A', 'T', 'B'].map((v) => <button key={v} className="chip" aria-pressed={voice === v} onClick={() => setVoice(v)}>{VOICE_NAME[v]}</button>)}
          </div>
          {auth && <span className="small muted">As choir admin you see every section · <button className="linklike" onClick={logout}>Log out</button></span>}
        </>
      )}
      {!auth ? (
        <Gate label="Section-lead password" onSubmit={async (pw) => {
          await checkLead(code, voice, pw);
          sessionSecret('lead', pw);
          sessionSecret('leadVoice', voice);
          setAuth({ lead: pw, voice });
        }}>
          <span className="small muted">Your choir admin gives each section lead a password.</span>
        </Gate>
      ) : err ? (
        <div className="notice" role="alert">{err} <button className="linklike" onClick={logout}>Log in again</button></div>
      ) : !view ? (
        <span className="muted">Loading…</span>
      ) : (
        <SectionReport view={view} />
      )}
    </main>
  );
}

function SectionReport({ view }: { view: SectionView }) {
  const cycleIds = loadCycle().pieceIds;
  const pieceIds = useMemo(() => [...new Set([...cycleIds.filter((id) => view.pieces[id]), ...Object.keys(view.pieces)])], [view, cycleIds]);
  if (!view.members.length) {
    return <div className="notice">Nobody in this section shares their progress yet. Members turn it on in Settings → Your choir.</div>;
  }
  return (
    <>
      <div className="card flat">
        <strong>{view.members.length} singer{view.members.length > 1 ? 's' : ''} sharing</strong>
        <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {view.members.map((m) => (
              <tr key={m.name}>
                <td style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{m.name}</td>
                <td className="muted tiny">{m.updatedAt ? new Date(m.updatedAt).toLocaleDateString() : ''}</td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {Object.values(m.pieces).length ? `${Math.round((Object.values(m.pieces).reduce((a, p) => a + p.readiness, 0) / Object.values(m.pieces).length) * 100)}%` : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pieceIds.map((id) => {
        const piece = getPiece(id);
        const agg = view.pieces[id];
        if (!piece) return null;
        const partId = chosenPartId(piece, view.voice);
        const part = piece.score.parts.find((p) => p.id === partId);
        if (!part) return null;
        const bars: BarMap = {};
        for (const [m, b] of Object.entries(agg.bars)) bars[Number(m)] = { ema: b.mean, n: b.n, at: 0 };
        // Same judgement as the map (the section's average), most struggling singers first.
        const hardest = Object.entries(agg.bars).filter(([m]) => mastery(bars[Number(m)]) === 'weak')
          .sort((a, b) => a[1].mean - b[1].mean || b[1].weak - a[1].weak).slice(0, 5);
        const label = (m: string) => piece.score.measures[Number(m)]?.number ?? m;
        return (
          <div key={id} className="card" data-testid="section-piece">
            <strong>{piece.title}</strong>
            <span className="small muted">{agg.singers} singer{agg.singers > 1 ? 's' : ''} · {part.name}</span>
            {hardest.length > 0 && (
              <span className="small">Hardest: {hardest.map(([m, b]) => `bar ${label(m)} (${b.weak} of ${b.n} struggling)`).join(', ')}</span>
            )}
            <PieceMap score={piece.score} part={part} sections={singableSections(piece, part.id)} bars={bars}
              onLoop={(m) => {
                const ms = piece.score.measures;
                const a = ms[Math.max(0, m - 1)];
                const b = ms[Math.min(ms.length - 1, m + 1)];
                go({ name: 'play', pieceId: piece.id, partId: part.id, sectionId: 'drill', level: 1, mode: '2d', from: a.start, to: b.start + b.dur });
              }} />
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ super admin

export function SuperAdmin() {
  const [pw, setPw] = useState<string | null>(() => sessionSecret('super'));
  const [list, setList] = useState<ChoirSummary[] | null>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ code: '', name: '', adminPassword: '' });
  const load = async (p: string) => {
    try { setList((await superList(p)).choirs); setErr(''); } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (pw) void load(pw); }, [pw]);
  if (!apiBase()) return <main className="screen"><Top title="Super admin" /><Offline /></main>;
  if (!pw) {
    return (
      <main className="screen">
        <Top title="Super admin" />
        <Gate label="Super-admin password" onSubmit={async (p) => { await superList(p); sessionSecret('super', p); setPw(p); }}>
          <span className="small muted">Creates choirs and their admin passwords. The password is set on the server.</span>
        </Gate>
      </main>
    );
  }
  return (
    <main className="screen">
      <Top title="Super admin" />
      <span className="small muted"><button className="linklike" onClick={() => { sessionSecret('super', null); setPw(null); }}>Log out</button></span>
      {err && <div className="notice" role="alert">{err}</div>}
      <form className="card" data-testid="create-choir" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await superCreate(pw, form.code.trim(), form.name.trim(), form.adminPassword);
          toast(`Choir created. Members join with “${form.code.trim().toLowerCase()}”.`);
          setForm({ code: '', name: '', adminPassword: '' });
          await load(pw);
        } catch (e2) { toast((e2 as Error).message); }
      }}>
        <strong>New choir</strong>
        <label className="field"><span>Name</span><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} /></label>
        <label className="field"><span>Choir code (what members type; letters, digits, - and _)</span><input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} autoCapitalize="none" maxLength={40} /></label>
        <label className="field"><span>Admin password (at least 6 characters)</span><input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} autoComplete="new-password" /></label>
        <button className="btn primary block" disabled={form.code.trim().length < 3 || form.adminPassword.length < 6}>Create</button>
      </form>
      {(list ?? []).map((c) => (
        <div key={c.code} className="card flat" data-testid="choir-row">
          <strong>{c.name}</strong>
          <span className="small muted">code {c.code} · {c.pieces} score{c.pieces === 1 ? '' : 's'} · {c.members} sharing · leads {c.leads.join(' ') || '–'}{c.programme ? ` · ${c.programme}` : ''}</span>
          <div className="row wrap">
            <button className="btn small" onClick={async () => {
              const name = prompt('New name', c.name);
              if (!name) return;
              try { await superUpdate(pw, c.code, { name }); await load(pw); } catch (e) { toast((e as Error).message); }
            }}>Rename</button>
            <button className="btn small" onClick={async () => {
              const p = prompt('New admin password (at least 6 characters)');
              if (!p) return;
              try { await superUpdate(pw, c.code, { adminPassword: p }); toast('Admin password changed'); } catch (e) { toast((e as Error).message); }
            }}>New admin password</button>
            <button className="btn small ghost" onClick={async () => {
              if (prompt(`Type the code “${c.code}” to delete this choir and its scores`) !== c.code) return;
              try { await superDelete(pw, c.code); await load(pw); } catch (e) { toast((e as Error).message); }
            }}>Delete</button>
          </div>
        </div>
      ))}
      {list && !list.length && <span className="muted">No choirs yet.</span>}
    </main>
  );
}

export { choirPieceId };
