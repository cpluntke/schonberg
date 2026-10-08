import React, { useEffect, useState } from 'react';
import { getPiece, useLibrary, type PieceInfo } from '../library';
import { useProfile, useStoreVersion, toast, initials } from '../hooks';
import { attemptLog, loadCycle } from '../../progress/store';
import {
  rankEntries, READINESS_VERSION, getLeaderboardBackend, encodeShareCode, importShareCodes, removeLocalEntry, decodeShareCode,
  combineEntries, ALL_PIECES,
  type LeaderboardEntry, type RankBy,
} from '../../progress/leaderboard';
import { IconShare } from '../icons';
import { myBoardEntry, postBoardEntry } from '../play/boardEntry';

const TABS: { by: RankBy; label: string; sub: string }[] = [
  { by: 'readiness', label: 'Ready', sub: 'readiness' },
  { by: 'improved', label: 'Climbers', sub: '7-day gain' },
  { by: 'streak', label: 'Streaks', sub: 'days' },
  { by: 'weekly', label: 'Points', sub: 'this week' },
];

const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;

export function Ranks() {
  const [profile, update] = useProfile();
  useStoreVersion();
  const cycle = loadCycle();
  const pieces = cycle.pieceIds.map((id) => getPiece(id)).filter(Boolean) as PieceInfo[];
  useLibrary(); // redraw when the choir's scores arrive
  // "All pieces" first (the default): each singer over the whole programme; or one piece.
  const [chosen, setPieceId] = useState(ALL_PIECES);
  // The programme's scores may arrive after this screen opened (a new phone, or #/ranks opened first):
  // until a piece is chosen that is there, show all of them.
  const overAll = chosen === ALL_PIECES || !pieces.some((p) => p.id === chosen);
  const pieceId = !pieces.length ? '' : overAll ? ALL_PIECES : chosen;
  const programme = pieces.map((p) => p.id);
  const [by, setBy] = useState<RankBy>('readiness');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [allEntries, setAllEntries] = useState<LeaderboardEntry[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [codeDraft, setCodeDraft] = useState(profile.choirCode ?? '');
  const backend = getLeaderboardBackend();
  const choir = profile.choirCode || 'local';
  const piece = overAll ? undefined : getPiece(pieceId);

  const computeMyEntryCached = (pc: PieceInfo) => myBoardEntry(pc, profile.voice);
  const myEntries = overAll ? pieces.map((pc) => computeMyEntryCached(pc)) : [];
  const me: LeaderboardEntry | null = piece ? myBoardEntry(piece, profile.voice)
    : overAll && myEntries.length ? combineEntries(myEntries, programme)[0] ?? null : null;

  useEffect(() => {
    let alive = true;
    if (!pieceId) return;
    (async () => {
      try {
        // Named entries on a real (server) board only (see postBoardEntry). All pieces: each piece I
        // practised. A post that fails (rate limit, full board) doesn't keep the board from showing.
        const posts = overAll ? myEntries.filter((e) => e.readiness > 0 || e.weeklyScore > 0) : me ? [me] : [];
        const failed = (await Promise.allSettled(posts.map((e) => postBoardEntry(e)))).find((r) => r.status === 'rejected');
        const everything = await backend.list(choir);
        const list = overAll ? combineEntries(everything, programme) : await backend.list(choir, pieceId);
        if (alive) { setEntries(list); setAllEntries(everything); setErr(failed ? String((failed as PromiseRejectedResult).reason?.message ?? failed.reason) : null); }
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceId, choir, profile.choirCode, profile.name, refresh, programme.join(',')]);

  // (only rows of the view shown: while switching, the last view's rows are still there)
  const sameName = (a: string, b: string) => (overAll ? a.trim().toLowerCase() === b.trim().toLowerCase() : a === b);
  const others = entries.filter((e) => e.pieceId === pieceId && !(me && sameName(e.name, me.name)));
  const all = me ? [...others, { ...me, name: me.name }] : others;
  const ranked = rankEntries(all, by);
  // Averages only use entries with the current readiness formula (older app versions report
  // section-based readiness, which isn't comparable); they're still listed, greyed.
  const current = (e: LeaderboardEntry) => e.v === READINESS_VERSION || (me != null && e.name === me.name && e.pieceId === me.pieceId);
  const sections = (['S', 'A', 'T', 'B'] as const).map((vt) => {
    const es = all.filter((e) => e.voice === vt && current(e));
    return { vt, n: es.length, avg: es.length ? es.reduce((a, e) => a + e.readiness, 0) / es.length : 0 };
  });
  const maxAvg = Math.max(0.01, ...sections.map((s) => s.avg));

  const [nameDraft, setNameDraft] = useState('');
  async function share() {
    if (!me) return;
    if (!profile.name) {
      toast('Add your name first, so the choir knows who it is.');
      return;
    }
    // One code per piece in the cycle, so friends see all of your progress at once.
    const mine = pieces.map((pc) => computeMyEntryCached(pc));
    const summary = mine.map((e, i) => `${pieces[i].title} ${Math.round(e.readiness * 100)}%`).join(', ');
    const text = `My Schönberg Hero progress: ${summary}. Paste into Ranks: ${mine.map(encodeShareCode).join(' ')}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Copied: paste it into your choir chat'); }
    } catch { /* cancelled */ }
  }

  function addCodes() {
    const codes = (paste.match(/SH1\.[A-Za-z0-9_-]+/g) ?? []).map(decodeShareCode).filter(Boolean);
    if (codes.length && me && codes.every((c) => c!.name === me.name)) {
      toast('That’s your own ranking code. Paste codes from other singers.');
      return;
    }
    const n = importShareCodes(choir, paste);
    toast(n ? `Added ${n} ranking${n > 1 ? 's' : ''}` : 'No ranking codes found in that text');
    if (n) { setPaste(''); setRefresh((x) => x + 1); }
  }

  function metric(e: LeaderboardEntry): string {
    switch (by) {
      case 'readiness': return `${Math.round(e.readiness * 100)}%`;
      case 'improved': return `${e.improved >= 0 ? '+' : '−'}${Math.round(Math.abs(e.improved) * 100)}%`;
      case 'streak': return `${e.streak}d`;
      case 'weekly': return e.weeklyScore.toLocaleString();
    }
  }

  return (
    <main className="screen wide ranks">
      <div className="topbar">
        <h1>Ranks</h1>
        {pieces.length > 0 && (
          <select aria-label="Piece" value={pieceId} onChange={(e) => setPieceId(e.target.value)}
            style={{ maxWidth: 190, minHeight: 40, borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 10px', fontWeight: 600 }}>
            <option value={ALL_PIECES}>All pieces</option>
            {pieces.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        )}
      </div>

      {!pieces.length && <div className="notice info">Add pieces to your cycle to see rankings.</div>}
      <LevelsNote />

      {/* Wide screens: the board on the left; the section battle, the choir overview and comparing on the right. */}
      <div className="lay ranks-grid">
      <div className="seg ranks-by" role="group" aria-label="Rank by">
        {TABS.map((t) => (
          <button key={t.by} aria-pressed={by === t.by} onClick={() => setBy(t.by)}>{t.label}<span className="sub">{t.sub}</span></button>
        ))}
      </div>

      <div className="card ranks-battle">
        <div className="row between"><h2 style={{ fontSize: 15 }}>Section battle</h2><span className="tiny muted">avg. readiness (current app)</span></div>
        {sections.map((s) => (
          <div key={s.vt} className="row">
            <span style={{ width: 22, fontWeight: 800 }}>{s.vt}</span>
            <div className="bar grow" style={{ height: 14, borderRadius: 7 }}>
              <span style={{ width: `${(s.avg / maxAvg) * 100}%`, background: s.vt === profile.voice ? 'var(--accent)' : '#4A5288', borderRadius: 7 }} />
            </div>
            <span className="mono small" style={{ width: 70, textAlign: 'right' }}>{s.n ? `${Math.round(s.avg * 100)}% · ${s.n}` : '–'}</span>
          </div>
        ))}
      </div>

      <div className="lay ranks-board">
      {overAll && pieces.length > 1 && (
        <span className="tiny muted" data-testid="ranks-all-note">
          All {pieces.length} pieces of the programme: readiness and the 7-day gain are averaged (a piece not started counts 0), this week's points added up.
        </span>
      )}
      {profile.boardHidden && profile.choirCode && (
        <span className="small muted" data-testid="board-hidden">You're off the choir's leaderboard: only you see your own row here (Settings → Privacy).</span>
      )}
      <div className="col" style={{ gap: 0 }}>
        {ranked.map((e, i) => {
          const isMe = me && e.name === me.name && e.updatedAt === me.updatedAt;
          // Sent by an older app version: readiness from section levels alone, not comparable.
          const old = !isMe && e.v !== READINESS_VERSION;
          return (
            <div key={`${e.name}-${i}`} className="row" data-testid={old ? 'rank-old' : undefined} style={{
              ...(old ? { opacity: 0.55 } : {}),
              minHeight: 56, padding: '0 10px', borderRadius: 12,
              ...(isMe ? { background: 'var(--voice-bg)', border: '1px solid var(--voice)' } : { borderBottom: '1px solid var(--surface-2)' }),
            }}>
              <span className="mono muted" style={{ width: 22 }}>{i + 1}</span>
              <span style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>{initials(e.name)}</span>
              <div className="grow col" style={{ gap: 0 }}>
                <span style={{ fontWeight: 600 }}>{isMe ? (profile.name ? `${e.name} (you)` : 'You') : e.name}</span>
                <span className="tiny muted">{[({ S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' } as Record<string, string>)[e.voice], e.streak > 0 ? `${e.streak}-day streak` : '', e.clean ? `★ clean run at level ${e.clean}` : '', old ? 'older app: readiness not comparable' : ''].filter(Boolean).join(' · ')}</span>
              </div>
              <span className="mono" style={{ fontWeight: 600 }}>{metric(e)}</span>
              {!isMe && backend.kind === 'local' && (
                <button className="icon-btn" aria-label={`Remove ${e.name}`} title="Remove" onClick={() => {
                  // (every spelling of the name, over all pieces)
                  const names = e.pieceId === ALL_PIECES ? [...new Set(allEntries.filter((x) => x.name.trim().toLowerCase() === e.name.trim().toLowerCase()).map((x) => x.name))] : [e.name];
                  for (const id of e.pieceId === ALL_PIECES ? programme : [e.pieceId]) for (const n of names) removeLocalEntry(choir, n, id);
                  setRefresh((x) => x + 1);
                }}>
                  <span aria-hidden="true" style={{ fontSize: 18, color: 'var(--muted)' }}>×</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      </div>

      {pieces.length > 0 && (
        <div className="card ranks-overview">
          <div className="row between"><h2 style={{ fontSize: 15 }}>Choir overview</h2><span className="tiny muted">avg. readiness per section of the choir</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: 'left', padding: '4px 6px' }}>Piece</th>
                  {(['S', 'A', 'T', 'B'] as const).map((vt) => <th key={vt} scope="col" style={{ padding: '4px 6px' }}>{vt}</th>)}
                </tr>
              </thead>
              <tbody>
                {pieces.map((pc) => {
                  const mine = getPiece(pc.id) ? computeMyEntryCached(pc) : null;
                  const es = [...allEntries.filter((e) => e.pieceId === pc.id && !(mine && e.name === mine.name)), ...(mine ? [mine] : [])];
                  return (
                    <tr key={pc.id} style={{ borderTop: '1px solid var(--surface-2)' }}>
                      <th scope="row" style={{ textAlign: 'left', padding: '6px', fontWeight: 600, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pc.title}</th>
                      {(['S', 'A', 'T', 'B'] as const).map((vt) => {
                        const v = es.filter((e) => e.voice === vt && (e === mine || e.v === READINESS_VERSION));
                        const avg = v.length ? v.reduce((a, e) => a + e.readiness, 0) / v.length : null;
                        const bg = avg == null ? 'transparent' : avg >= 0.75 ? '#1D4F63' : avg >= 0.4 ? '#2A2F55' : '#4A2418';
                        return <td key={vt} className="mono" style={{ textAlign: 'center', padding: '6px', background: bg }}>{avg == null ? '–' : `${Math.round(avg * 100)}%`}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <span className="tiny muted">Built from your own progress plus the rankings you've collected. Readiness is the way to concert-ready (100% = the whole piece sung through at level 4); rehearsal-ready means sung through at level 3.</span>
        </div>
      )}

      <div className="card ranks-compare">
        <strong>Compare with your choir</strong>
        {backend.kind === 'http' && profile.choirCode ? (
          <span className="small muted" data-testid="on-board">You're on your choir's board: everyone in the choir sees your first name, voice and these numbers.</span>
        ) : backend.kind === 'http' ? (
          <>
            <span className="small muted">Join your choir's board with the code your director shares. Everyone in the choir is on it: your name, voice and these numbers are shown to the choir (nothing else is sent).</span>
            <div className="row">
              <input type="text" aria-label="Choir code" value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} placeholder="choir code"
                style={{ flex: 1, minHeight: 44, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', padding: '0 12px' }} />
              <button className="btn small" disabled={!CODE_RE.test(codeDraft)} onClick={() => update({ choirCode: codeDraft.toLowerCase(), leaderboardOptIn: true })}>Join</button>
            </div>
          </>
        ) : (
          <span className="small muted">No leaderboard server is configured, so rankings travel as codes. Share yours in the choir chat and paste theirs below.</span>
        )}
        {!profile.name && (
          <div className="row">
            <input type="text" aria-label="Your name" placeholder="Your name for the board" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={40}
              style={{ flex: 1, minWidth: 0, minHeight: 44, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', padding: '0 12px' }} />
            <button className="btn small" disabled={!nameDraft.trim()} onClick={() => update({ name: nameDraft.trim() })}>Save</button>
          </div>
        )}
        <button className="btn small" onClick={share} disabled={!me || !profile.name}><IconShare size={16} /> Share my progress (all pieces)</button>
        <label className="field">
          <span className="small">Paste codes from the chat</span>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…SH1.eyJu…" />
        </label>
        <button className="btn small" disabled={!paste.trim()} onClick={addCodes}>Add rankings</button>
        {err && <span className="small" style={{ color: 'var(--accent-text)' }}>{err}</span>}
      </div>
      </div>
    </main>
  );
}

/** When piece levels started to need a full run-through (the release that recalculated readiness). */
const LEVELS_CHANGED_AT = Date.UTC(2026, 9, 5, 3);

/** Once, and only for singers who practised before readiness was recalculated (not on new installs). */
function LevelsNote() {
  const KEY = 'sh:seenLevelsNote';
  const [show, setShow] = useState(() => {
    try { return localStorage.getItem(KEY) !== '1' && attemptLog().some((e) => e.at < LEVELS_CHANGED_AT); } catch { return false; }
  });
  if (!show) return null;
  return (
    <div className="notice info row" role="status" data-testid="levels-note">
      <span className="grow small">
        <strong>Readiness was recalculated.</strong> A piece now reaches a level only when you sing it all through at that level in one go,
        so section levels alone count half. Singers on an older app version are shown greyed until they update.
      </span>
      <button className="btn ghost small" onClick={() => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setShow(false); }}>OK</button>
    </div>
  );
}
