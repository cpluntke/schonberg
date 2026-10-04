import React, { useEffect, useState } from 'react';
import { getPiece, chosenPartId, singableSections, type PieceInfo } from '../library';
import { useProfile, useStoreVersion, toast, initials } from '../hooks';
import { loadCycle } from '../../progress/store';
import {
  computeMyEntry, rankEntries, getLeaderboardBackend, encodeShareCode, importShareCodes,
  type LeaderboardEntry, type RankBy,
} from '../../progress/leaderboard';
import { IconShare } from '../icons';

const TABS: { by: RankBy; label: string; sub: string }[] = [
  { by: 'readiness', label: 'Ready', sub: 'readiness' },
  { by: 'improved', label: 'Climbers', sub: '7-day gain' },
  { by: 'streak', label: 'Streaks', sub: 'days' },
  { by: 'weekly', label: 'Points', sub: 'this week' },
];

const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;

export function Ranks() {
  const [profile, update] = useProfile();
  const v = useStoreVersion();
  const cycle = loadCycle();
  const pieces = cycle.pieceIds.map((id) => getPiece(id)).filter(Boolean) as PieceInfo[];
  const [pieceId, setPieceId] = useState(pieces[0]?.id ?? '');
  const [by, setBy] = useState<RankBy>('readiness');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [codeDraft, setCodeDraft] = useState(profile.choirCode ?? '');
  const backend = getLeaderboardBackend();
  const choir = profile.choirCode || 'local';
  const piece = getPiece(pieceId);

  const me: LeaderboardEntry | null = piece
    ? computeMyEntry(piece.id, chosenPartId(piece, profile.voice), singableSections(piece, chosenPartId(piece, profile.voice)))
    : null;

  useEffect(() => {
    let alive = true;
    if (!pieceId) return;
    (async () => {
      try {
        if (me && profile.leaderboardOptIn) await backend.put(choir, me);
        const list = await backend.list(choir, pieceId);
        if (alive) { setEntries(list); setErr(null); }
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceId, choir, profile.leaderboardOptIn, v]);

  const others = entries.filter((e) => !(me && e.name === me.name && e.pieceId === me.pieceId));
  const all = me ? [...others, { ...me, name: me.name }] : others;
  const ranked = rankEntries(all, by);
  const sections = (['S', 'A', 'T', 'B'] as const).map((vt) => {
    const es = all.filter((e) => e.voice === vt);
    return { vt, n: es.length, avg: es.length ? es.reduce((a, e) => a + e.readiness, 0) / es.length : 0 };
  });
  const maxAvg = Math.max(0.01, ...sections.map((s) => s.avg));

  async function share() {
    if (!me) return;
    const code = encodeShareCode(me);
    const text = `My Schönberg Hero ranking for “${piece?.title}”: ${Math.round(me.readiness * 100)}% ready. ${code}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Copied: paste it into your choir chat'); }
    } catch { /* cancelled */ }
  }

  function addCodes() {
    const n = importShareCodes(choir, paste);
    toast(n ? `Added ${n} ranking${n > 1 ? 's' : ''}` : 'No ranking codes found in that text');
    if (n) setPaste('');
  }

  function metric(e: LeaderboardEntry): string {
    switch (by) {
      case 'readiness': return `${Math.round(e.readiness * 100)}%`;
      case 'improved': return `${e.improved >= 0 ? '+' : '−'}${Math.round(Math.abs(e.improved) * 100)}%`;
      case 'streak': return `${e.streak}d`;
      case 'weekly': return e.weeklyScore.toLocaleString('de-DE');
    }
  }

  return (
    <main className="screen">
      <div className="topbar">
        <h1>Ranks</h1>
        {pieces.length > 0 && (
          <select aria-label="Piece" value={pieceId} onChange={(e) => setPieceId(e.target.value)}
            style={{ maxWidth: 190, minHeight: 40, borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 10px', fontWeight: 600 }}>
            {pieces.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        )}
      </div>

      {!pieces.length && <div className="notice info">Add pieces to your cycle to see rankings.</div>}

      <div className="seg" role="group" aria-label="Rank by">
        {TABS.map((t) => (
          <button key={t.by} aria-pressed={by === t.by} onClick={() => setBy(t.by)}>{t.label}<span className="sub">{t.sub}</span></button>
        ))}
      </div>

      <div className="card">
        <div className="row between"><h2 style={{ fontSize: 15 }}>Section battle</h2><span className="tiny muted">avg. readiness</span></div>
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

      <div className="col" style={{ gap: 0 }}>
        {ranked.map((e, i) => {
          const isMe = me && e.name === me.name && e.updatedAt === me.updatedAt;
          return (
            <div key={`${e.name}-${i}`} className="row" style={{
              minHeight: 56, padding: '0 10px', borderRadius: 12,
              ...(isMe ? { background: 'var(--voice-bg)', border: '1px solid var(--voice)' } : { borderBottom: '1px solid var(--surface-2)' }),
            }}>
              <span className="mono muted" style={{ width: 22 }}>{i + 1}</span>
              <span style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>{initials(e.name)}</span>
              <div className="grow col" style={{ gap: 0 }}>
                <span style={{ fontWeight: 600 }}>{isMe ? `${e.name} (you)` : e.name}</span>
                <span className="tiny muted">{({ S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' } as Record<string, string>)[e.voice] ?? ''} · {e.streak}-day streak</span>
              </div>
              <span className="mono" style={{ fontWeight: 600 }}>{metric(e)}</span>
            </div>
          );
        })}
      </div>

      <div className="card">
        <strong>Compare with your choir</strong>
        {backend.kind === 'http' ? (
          <>
            <span className="small muted">Join your choir's board with the code your director shares. Only your name, voice and these numbers are sent.</span>
            <div className="row">
              <input type="text" aria-label="Choir code" value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} placeholder="choir code"
                style={{ flex: 1, minHeight: 44, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', padding: '0 12px' }} />
              <button className="btn small" disabled={!CODE_RE.test(codeDraft)} onClick={() => update({ choirCode: codeDraft.toLowerCase(), leaderboardOptIn: true })}>Join</button>
            </div>
            <label className="toggle-row"><span>Post my results</span>
              <input type="checkbox" checked={profile.leaderboardOptIn} onChange={(e) => update({ leaderboardOptIn: e.target.checked })} /></label>
          </>
        ) : (
          <span className="small muted">No leaderboard server is configured, so rankings travel as codes. Share yours in the choir chat and paste theirs below.</span>
        )}
        <button className="btn small" onClick={share} disabled={!me}><IconShare size={16} /> Share my ranking code</button>
        <label className="field">
          <span className="small">Paste codes from the chat</span>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…SH1.eyJu…" />
        </label>
        <button className="btn small" disabled={!paste.trim()} onClick={addCodes}>Add rankings</button>
        {err && <span className="small" style={{ color: 'var(--accent-text)' }}>{err}</span>}
      </div>
    </main>
  );
}
