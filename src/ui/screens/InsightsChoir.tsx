// Choir admin: every section side by side per piece (S | A | T | B), aggregated like the section lead's
// view (no names next to progress), plus each sharing singer's voice range by section.

import React, { useEffect, useMemo, useState } from 'react';
import { useProfile } from '../hooks';
import { go } from '../router';
import { getPiece } from '../library';
import { loadCycle } from '../../progress/store';
import { apiBase, sessionFor } from '../../progress/choir';
import { fetchChoirInsights, VOICE_ORDER, type ChoirInsightsView, type ChoirSinger, type PieceAgg } from '../../progress/insights';
import { useSession } from './Choir';
import { VOICE_NAME } from '../components/People';
import { LevelBar, RangeChart } from '../components/InsightCharts';
import { loopBars, loopGroups, orderedPieceIds, sectionPart, sectionPartRange } from '../components/SectionInsights';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const SHORT: Record<string, string> = { S: 'S', A: 'A', T: 'T', B: 'B' };
const COLUMN: Record<string, string> = { S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' };

/** The section of a piece that most needs rehearsal time (lowest readiness, among those big enough to show). */
export function neediest(cols: Record<string, PieceAgg | undefined>): string | null {
  let best: string | null = null;
  let score = Infinity;
  for (const v of VOICE_ORDER) {
    const p = cols[v];
    if (!p || p.hidden || p.readiness == null) continue;
    const s = p.readiness - (p.hardest?.length ?? 0) * 0.02;
    if (s < score) { score = s; best = v; }
  }
  return best != null && score < 0.75 ? best : null;
}

function Cell({ p, minGroup }: { p: PieceAgg | undefined; minGroup: number }) {
  if (!p) return <span className="tiny muted">nobody sharing</span>;
  return (
    <div className="col" style={{ gap: 4, minWidth: 0 }}>
      <span className="tiny"><span className="mono">{p.singers}</span> sharing · <span className="mono">{p.active}</span> active</span>
      {p.hidden ? (
        <span className="tiny muted">under {minGroup}: counts only</span>
      ) : (
        <>
          <span className="tiny"><span className="mono">{p.rehearsalReady}</span> rehearsal-, <span className="mono">{p.concertReady}</span> concert-ready</span>
          <LevelBar levels={p.levels ?? []} bare height={10} />
          <span className="tiny muted">avg {pct(p.readiness ?? 0)}{p.trend ? ` ${p.trend.state === 'improving' ? '▲' : p.trend.state === 'slipping' ? '▼' : '■'}` : ''}</span>
        </>
      )}
    </div>
  );
}

export function ChoirInsights() {
  const [profile] = useProfile();
  useSession(true);
  const code = profile.choirCode;
  const session = sessionFor(code);
  const token = session?.account.role === 'admin' ? session.token : null;
  const [view, setView] = useState<ChoirInsightsView | null>(null);
  const [err, setErr] = useState('');
  const [shown, setShown] = useState<string[]>([...VOICE_ORDER]);
  useEffect(() => {
    if (!token || !code) return;
    let alive = true;
    fetchChoirInsights(code, { bearer: token })
      .then((v) => { if (alive) setView(v); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [token, code]);
  const ids = useMemo(() => (view ? orderedPieceIds([...new Set(VOICE_ORDER.flatMap((v) => Object.keys(view.sections[v]?.pieces ?? {})))]) : []), [view]);
  const programme = loadCycle().pieceIds;
  if (!apiBase() || !code) return <><div className="notice">Join your choir first (Settings → Your choir).</div></>;
  if (!token) {
    return (
      <>
        <div className="notice">Only choir admins see every section. Log in as an admin under Settings → Your choir.</div>
      </>
    );
  }
  if (err) return <><div className="notice" role="alert">{err}</div></>;
  if (!view) return <><span className="muted">Loading…</span></>;
  const needs = ids.map((id) => {
    const v = neediest(Object.fromEntries(VOICE_ORDER.map((x) => [x, view.sections[x]?.pieces[id]])));
    return v ? { id, v, p: view.sections[v].pieces[id] } : null;
  }).filter((x): x is { id: string; v: string; p: PieceAgg } => !!x);
  const sharing = VOICE_ORDER.reduce((a, v) => a + (view.sections[v]?.sharing ?? 0), 0);
  return (
    <>
      <span className="small muted">{session?.account.name} · progress shown per section, never per singer · sections with fewer than {view.minGroup} singers sharing a piece show counts only</span>
      <div className="card flat" data-testid="choir-summary">
        <strong>{sharing} singer{sharing === 1 ? '' : 's'} sharing · {VOICE_ORDER.map((v) => `${SHORT[v]} ${view.sections[v]?.sharing ?? 0}`).join(' · ')}</strong>
        {needs.length ? (
          <div className="col" style={{ gap: 4 }} data-testid="needs-time">
            <span className="small">Needs rehearsal time:</span>
            {needs.slice(0, 5).map(({ id, v, p }) => {
              const piece = getPiece(id);
              const label = (m: number) => piece?.score.measures[m]?.number ?? String(m + 1);
              return (
                <span key={id} className="small" style={{ color: 'var(--accent-text)' }}>
                  {VOICE_NAME[v] ?? v} in {piece?.title ?? 'a piece'}: {pct(p.readiness ?? 0)} ready on average
                  {p.hardest?.length ? `, bars ${loopGroups(p.hardest.map((h) => h.bar)).map(([a, b]) => (a === b ? label(a) : `${label(a)}–${label(b)}`)).join(', ')}` : ''}
                </span>
              );
            })}
          </div>
        ) : <span className="small muted">No section stands out as needing extra rehearsal time.</span>}
      </div>
      {ids.map((id) => {
        const piece = getPiece(id);
        const cols = Object.fromEntries(VOICE_ORDER.map((v) => [v, view.sections[v]?.pieces[id]]));
        const need = neediest(cols);
        return (
          <div key={id} className="card" data-testid="choir-piece">
            <strong>{piece?.title ?? 'A piece not on this phone'}</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              {VOICE_ORDER.map((v) => (
                <div key={v} className="col" data-testid={`col-${v}`} style={{
                  gap: 6, padding: 6, borderRadius: 10, minWidth: 0,
                  border: `1px solid ${need === v ? 'var(--accent)' : 'var(--line)'}`, background: need === v ? 'var(--accent-soft)' : 'transparent',
                }}>
                  <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '0.04em', overflowWrap: 'break-word', color: need === v ? 'var(--accent-text)' : undefined }}>
                    {COLUMN[v] ?? v}{need === v && <span style={{ display: 'block' }}>needs time</span>}
                  </span>
                  <Cell p={cols[v]} minGroup={view.minGroup} />
                  {cols[v]?.hardest?.length && piece ? (() => {
                    const part = sectionPart(piece, v);
                    const label = (m: number) => piece.score.measures[m]?.number ?? String(m + 1);
                    return (
                      <div className="col" style={{ gap: 4 }}>
                        <span className="tiny">Hardest: {cols[v]!.hardest!.map((h) => label(h.bar)).join(', ')}</span>
                        {part && loopGroups(cols[v]!.hardest!.map((h) => h.bar)).slice(0, 2).map(([a, b]) => (
                          <button key={a} className="btn small ghost" style={{ minHeight: 36, padding: '0 6px', fontSize: 12 }} onClick={() => loopBars(piece, part.id, a, b)}>
                            Loop {a === b ? label(a) : `${label(a)}–${label(b)}`}
                          </button>
                        ))}
                      </div>
                    );
                  })() : null}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!ids.length && <div className="notice">{sharing
        ? 'No shared progress on the programme’s pieces yet: it appears once singers sing them.'
        : 'Nobody shares their progress yet. Singers share it once they have joined with the choir code, set a first name and sung a programme piece.'}</div>}
      <div className="card" data-testid="choir-ranges">
        <strong>Voices by section</strong>
        <span className="small muted">Each sharing singer's range from their range check, by name, for divisi decisions.</span>
        <div className="chips" role="group" aria-label="Sections to show">
          {VOICE_ORDER.map((v) => (
            <button key={v} className="chip" aria-pressed={shown.includes(v)} data-testid={`ranges-toggle-${v}`}
              onClick={() => setShown(shown.includes(v) ? shown.filter((x) => x !== v) : VOICE_ORDER.filter((x) => x === v || shown.includes(x)))}>
              {VOICE_NAME[v] ?? v} ({view.sections[v]?.ranges.length ?? 0})
            </button>
          ))}
        </div>
        {VOICE_ORDER.filter((v) => shown.includes(v)).map((v) => (
          <div key={v} className="col" style={{ gap: 6 }}>
            <span className="eyebrow">{VOICE_NAME[v] ?? v}</span>
            {view.sections[v]?.ranges.length
              ? <RangeChart ranges={view.sections[v].ranges} voice={v} part={sectionPartRange(v, programme)} label={`${VOICE_NAME[v] ?? v}: voice ranges`} />
              : <span className="small muted">Nobody in this section shares yet.</span>}
          </div>
        ))}
      </div>
      {view.singers && <SingersCard singers={view.singers} />}
      <button className="btn small ghost" onClick={() => go({ name: 'section' })}>One section in detail (bar map)</button>
    </>
  );
}

/** "Last active": today, yesterday, N days ago, or the date (with the year once it's another year). */
function lastActive(ms: number): string {
  if (!ms) return '';
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const n = Math.round((day(Date.now()) - day(ms)) / 86_400_000);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 14 ? `${n} days ago` : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

/** Admins: the singers who use the app, by voice part, with when their leaderboard entry last changed. */
function SingersCard({ singers }: { singers: ChoirSinger[] }) {
  const groups = [...VOICE_ORDER, 'other'].map((v) => ({ v, list: singers.filter((s) => ((VOICE_ORDER as readonly string[]).includes(s.voice) ? s.voice : 'other') === v) }))
    .filter((g) => g.list.length);
  return (
    <details className="card" data-testid="choir-singers">
      <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><strong className="grow">Singers using the app ({singers.length})</strong><span className="small muted">Show ▾</span></summary>
      <span className="small muted">
        Singers who joined with your choir code and a first name and share with the section leads or are on the leaderboard.
        "Last active" is from the leaderboard (what every member sees there). Singers who switched both off in Settings → Privacy don't appear.
      </span>
      {!singers.length && <span className="small">Nobody yet.</span>}
      {groups.map(({ v, list }) => (
        <div key={v} className="col" style={{ gap: 2 }}>
          <span className="eyebrow">{VOICE_NAME[v] ?? 'Other'} ({list.length})</span>
          {list.map((s) => (
            <div key={`${s.name}|${s.voice}`} className="row between small" style={{ padding: '4px 0', borderBottom: '1px solid var(--surface-2)' }} data-testid="choir-singer">
              <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{s.name}</span>
              {s.lastAt > 0 && <span className="muted tiny" style={{ textAlign: 'right' }}>last active {lastActive(s.lastAt)}</span>}
            </div>
          ))}
        </div>
      ))}
    </details>
  );
}
