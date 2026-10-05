import React from 'react';
import { allPieces, getPiece, type PieceInfo } from '../library';
import { useProfile, useStoreVersion, formatDate, daysUntil, initials } from '../hooks';
import { go } from '../router';
import { loadCycle, streakDays, sameWork } from '../../progress/store';
import { levelSpec } from '../../progress/ladder';
import { nextRehearsal } from '../../progress/rehearsal';
import { rowOfTheDay } from '../../game/twelvetone';
import { IconFlame, IconPlay, IconMic } from '../icons';
import { IntroVideoButton } from '../components/IntroVideo';
import { pieceStatus, todaysPlan, type PieceStatus } from '../plan';

export { pieceStatus, type PieceStatus };

function pcSym(p: number) { return p === 10 ? 't' : p === 11 ? 'e' : String(p); }

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export function Home() {
  const [profile] = useProfile();
  useStoreVersion();
  const cycle = loadCycle();
  const cyclePieces = cycle.pieceIds.map((id) => getPiece(id)).filter(Boolean) as PieceInfo[];
  const statuses = cyclePieces.map((p) => pieceStatus(p, profile.voice));
  const streak = streakDays();
  const focusIds = new Set(cycle.focusPieceIds ?? []);
  const plan = todaysPlan(statuses, cycle);
  const focus = plan[0] ?? null;
  const row = rowOfTheDay(new Date());
  const nr = nextRehearsal(cycle);
  const toRehearsal = nr ? nr.days : null;
  const toConcert = daysUntil(cycle.concertDate);
  const focusStatuses = statuses.filter((s) => focusIds.has(s.piece.id));
  const focusMissing = (cycle.wanted ?? []).filter((w) => w.focus && !statuses.some((s) => sameWork(s.piece.title, w.title)));
  const target = cycleTarget(statuses, toRehearsal, toConcert, focusStatuses.length ? focusStatuses : null);
  const avg = statuses.length ? statuses.reduce((a, s) => a + s.pct, 0) / statuses.length : 0;

  return (
    <main className="screen">
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>Schönberg</span>
          <span className="badge">Hero</span>
        </div>
        <button className="icon-btn filled" aria-label="Voice setup" onClick={() => go({ name: 'setup' })}
          style={{ border: '2px solid var(--voice)', fontWeight: 700, fontSize: 14 }}>
          {profile.name ? initials(profile.name) : profile.voice}
        </button>
      </div>

      <div className="col" style={{ gap: 4 }}>
        <h1 className="hero">{greeting()}{profile.name ? `, ${profile.name.split(' ')[0]}` : ''}</h1>
        <div className="row small muted" style={{ gap: 8 }}>
          <IconFlame size={16} color="#FF7A45" />
          <span>{streak > 0 ? `${streak}-day practice streak` : 'Start a streak today'} · {voiceName(profile.voice)}</span>
        </div>
      </div>

      <Notice />

      {!profile.onboarded && (
        <div className="card" style={{ borderColor: 'var(--voice-deep)' }}>
          <div className="row">
            <IconMic color="#4CC9F0" />
            <div className="grow col" style={{ gap: 2 }}>
              <strong>Set up your voice (2 min)</strong>
              <span className="small muted">Mic check, your range, headphone delay and your preferred note names.</span>
            </div>
          </div>
          <IntroVideoButton className="btn block" />
          <button className="btn voice block" onClick={() => go({ name: 'setup' })}>Start setup</button>
        </div>
      )}

      <section className="card">
        <div className="row between">
          <div className="eyebrow">{cycle.name || 'This cycle'}</div>
          <button className="btn ghost small" onClick={() => go({ name: 'settings' })}>Edit dates</button>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <Countdown label="Rehearsal" days={toRehearsal} date={nr?.label} raw />
          <Countdown label="Concert" days={toConcert} date={cycle.concertDate} />
          <div className="col" style={{ gap: 2, marginLeft: 'auto', alignItems: 'flex-end' }}>
            <span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{Math.round(avg * 100)}%</span>
            <span className="tiny muted">cycle readiness</span>
          </div>
        </div>
        {focusStatuses.length + focusMissing.length > 0 && nr && nr.days >= 0 && (
          <div className="small" data-testid="rehearsal-focus">
            <span className="muted">{nr.days === 0 ? 'Tonight' : `Next rehearsal (${nr.label})`}:</span>{' '}
            {focusStatuses.map((s, i) => (
              <span key={s.piece.id}>{i ? ', ' : ''}<button className="linklike" onClick={() => go({ name: 'piece', pieceId: s.piece.id })}>{s.piece.title}</button>
                <span className="muted"> {Math.round(s.pct * 100)}%</span></span>
            ))}
            {focusMissing.map((w, i) => (
              <span key={w.title}>{i || focusStatuses.length ? ', ' : ''}<button className="linklike" onClick={() => go({ name: 'library' })}>{w.title}</button>
                <span className="muted"> (import first)</span></span>
            ))}
          </div>
        )}
        {target && <div className="small" style={{ color: 'var(--accent-text)' }}>{target}</div>}
        {focus && focus.next ? (
          <>
            <NextUp status={focus} />
            {plan.length > 1 && (
              <div className="col" style={{ gap: 0 }}>
                <span className="tiny muted">Also today</span>
                {plan.slice(1).map((st) => (
                  <button key={st.piece.id} className="list-row" style={{ padding: '8px 0' }}
                    onClick={() => go({ name: 'play', pieceId: st.piece.id, partId: st.partId, sectionId: st.next!.sectionId, level: st.next!.level, mode: '2d' })}>
                    <IconPlay size={14} color="#FF7A45" />
                    <span className="grow small ellipsis"><strong>{st.piece.title}</strong> · {st.next!.reason}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : statuses.length ? (
          <div className="notice info">Everything in this cycle is concert-ready. Try the arcade mode or today's Zwölfton row.</div>
        ) : (
          <div className="notice info">No pieces in this cycle yet. Add some from the Library or import your choir's MusicXML.</div>
        )}
      </section>

      <section className="col" style={{ gap: 2 }}>
        <div className="row between">
          <h2>Repertoire</h2>
          <button className="btn ghost small" onClick={() => go({ name: 'library' })}>Library</button>
        </div>
        {statuses.map((s) => (
          <button key={s.piece.id} className="list-row" data-testid="piece-row" onClick={() => go({ name: 'piece', pieceId: s.piece.id })}>
            <div className="mono-tile">{initials(s.piece.composer || s.piece.title)}</div>
            <div className="grow col" style={{ gap: 2 }}>
              <span className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{s.piece.title}</span>
              <span className="small muted ellipsis">
                {s.piece.composer}{s.partName ? ` · ${s.partName}` : ''}
                {s.next?.kind === 'fix' ? ` · ${s.toFix.reduce((n, f) => n + f.sectionIds.length, 0)} to fix` : s.fullDue ? ' · full run due for review' : s.due.length ? ` · ${s.due.length} due for review` : ''}
              </span>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
              <span className="mono small">{Math.round(s.pct * 100)}%</span>
              <span className="tiny muted" data-testid="piece-row-level">{pieceLabel(s)}</span>
            </div>
          </button>
        ))}
        {(cycle.wanted ?? []).filter((w) => !statuses.some((s) => sameWork(s.piece.title, w.title))).map((w) => (
          <button key={w.title} className="list-row" onClick={() => go({ name: 'library' })} data-testid="wanted-row">
            <div className="mono-tile" style={{ color: 'var(--muted)', border: '1px dashed var(--line)', background: 'transparent' }}>+</div>
            <div className="grow col" style={{ gap: 2 }}>
              <span className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{w.title}</span>
              <span className="small muted ellipsis">{w.composer} · {w.note ?? 'import your choir’s score'}</span>
            </div>
            <span className="badge muted">Import</span>
          </button>
        ))}
      </section>

      <button className="card expert" style={{ textAlign: 'left', color: 'inherit' }} onClick={() => go({ name: 'expert' })}>
        <div className="row between">
          <strong>Zwölfton of the day</strong>
          <span className="badge expert">Expert</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 3 }}>
          {row.map((pc, i) => (
            <span key={i} className="mono" style={{ height: 26, borderRadius: 6, background: '#262257', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#D4CCFF' }}>{pcSym(pc)}</span>
          ))}
        </div>
        <span className="small" style={{ color: '#D4CCFF' }}>Plus leap drills built from the hardest intervals in your parts.</span>
      </button>
    </main>
  );
}

function Notice() {
  const [msg, setMsg] = React.useState(() => { try { return localStorage.getItem('sh:notice'); } catch { return null; } });
  if (!msg) return null;
  return (
    <div className="notice info row" role="status">
      <span className="grow small">{msg}</span>
      <button className="btn ghost small" onClick={() => { try { localStorage.removeItem('sh:notice'); } catch { /* blocked */ } setMsg(null); }}>OK</button>
    </div>
  );
}

/** Short status for a piece row: its piece level, or what's in progress. */
export function pieceLabel(s: PieceStatus): string {
  if (s.memorised) return 'memorised';
  if (s.concertReady) return 'concert-ready';
  if (s.rehearsalReady) return 'rehearsal-ready';
  if (s.pieceLevel > 0) return `level ${s.pieceLevel} · ${levelName(s.pieceLevel)}`;
  if (s.multi && s.unconfirmed > 0) return `confirm level ${s.unconfirmed}`;
  return s.pct > 0 ? 'in progress' : 'not started';
}

function NextUp({ status }: { status: PieceStatus }) {
  const n = status.next!;
  const spec = levelSpec(n.level);
  // An experienced singer can skip the sections: offer the full run at the next piece level.
  const skip = status.multi && n.kind === 'section' && status.pieceLevel < 5 ? status.pieceLevel + 1 : 0;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="col" style={{ gap: 2 }}>
        <span className="small muted">Next up</span>
        <span style={{ fontSize: 20, fontWeight: 800 }}>{status.piece.title}</span>
        <span className="small muted">{n.reason}{spec && !n.reason.includes(spec.name) ? ` (level ${n.level}, ${spec.name})` : ''}</span>
      </div>
      <button className="btn primary block" onClick={() => go({ name: 'play', pieceId: status.piece.id, partId: status.partId, sectionId: n.sectionId, level: n.level, mode: '2d' })}>
        <IconPlay size={18} /> {n.sectionId === 'all' ? 'Sing it all now' : n.kind === 'fix' ? 'Fix it now' : 'Practise now'}
      </button>
      {skip > 0 && (
        <button className="btn ghost small" data-testid="skip-to-full" onClick={() => go({ name: 'play', pieceId: status.piece.id, partId: status.partId, sectionId: 'all', level: skip, mode: '2d' })}>
          Know it already? Sing the whole piece at level {skip}
        </button>
      )}
    </div>
  );
}

export { sameWork };

function Countdown({ label, days, date, raw }: { label: string; days: number | null; date?: string; raw?: boolean }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
        {days == null ? '–' : days < 0 ? 'past' : days === 0 ? 'today' : `${days}d`}
      </span>
      <span className="tiny muted">{label}{date ? ` · ${raw ? date : formatDate(date)}` : ' · not set'}</span>
    </div>
  );
}

function cycleTarget(statuses: PieceStatus[], toRehearsal: number | null, toConcert: number | null, focus: PieceStatus[] | null): string | null {
  const goals = [
    { label: 'Rehearsal', level: 3, days: toRehearsal, name: 'level 3 (Independent)', set: focus ?? statuses },
    { label: 'Concert', level: 4, days: toConcert, name: 'level 4 (Concert-ready)', set: statuses },
  ];
  for (const g of goals) {
    if (g.days == null || g.days < 0) continue;
    // The piece level counts: a piece is ready once it has been sung through at the level.
    const missing = g.set.filter((st) => st.pieceLevel < g.level).length;
    if (!missing) continue;
    const when = g.days === 0 ? 'today' : g.days === 1 ? 'tomorrow' : `in ${g.days} days`;
    const what = g.label === 'Rehearsal' && focus ? ` of the rehearsal pieces` : '';
    const perDay = g.days > 1 && missing > 1 ? Math.ceil(missing / g.days) : 0;
    return `${g.label} ${when}: ${missing} piece${missing > 1 ? 's' : ''}${what} not yet sung through at ${g.name}${perDay && perDay < missing ? `, about ${perDay} a day` : ''}.`;
  }
  return null;
}

export function voiceName(v: string): string {
  return ({ S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' } as Record<string, string>)[v] ?? 'Singer';
}

export function levelName(l: number): string {
  if (l <= 0) return 'not started';
  return levelSpec(l)?.name ?? `Level ${l}`;
}

export { allPieces };
