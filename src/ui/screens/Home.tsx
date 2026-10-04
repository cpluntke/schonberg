import React from 'react';
import { allPieces, getPiece, chosenPartId, singableSections, type PieceInfo } from '../library';
import { useProfile, useStoreVersion, formatDate, daysUntil, initials } from '../hooks';
import { go } from '../router';
import { loadCycle, getProgress, streakDays, dueForReview } from '../../progress/store';
import { pieceReadiness, nextStep, levelSpec } from '../../progress/ladder';
import { rowOfTheDay } from '../../game/twelvetone';
import { IconFlame, IconPlay, IconMic } from '../icons';

function pcSym(p: number) { return p === 10 ? 't' : p === 11 ? 'e' : String(p); }

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export interface PieceStatus {
  piece: PieceInfo;
  partId: string;
  partName: string;
  pct: number;
  minLevel: number;
  rehearsalReady: boolean;
  concertReady: boolean;
  due: string[];
  next: ReturnType<typeof nextStep>;
}

export function pieceStatus(piece: PieceInfo, voice: string): PieceStatus {
  const partId = chosenPartId(piece, voice);
  const part = piece.score.parts.find((x) => x.id === partId);
  const sections = singableSections(piece, partId);
  const prog = getProgress(piece.id, partId);
  const r = pieceReadiness(sections, prog);
  return {
    piece, partId, partName: part?.name ?? '', ...r,
    due: dueForReview(piece.id, partId, sections),
    next: nextStep(sections, prog),
  };
}

export function Home() {
  const [profile] = useProfile();
  useStoreVersion();
  const cycle = loadCycle();
  const cyclePieces = cycle.pieceIds.map((id) => getPiece(id)).filter(Boolean) as PieceInfo[];
  const statuses = cyclePieces.map((p) => pieceStatus(p, profile.voice));
  const streak = streakDays();
  const focus = statuses.find((s) => s.due.length) ?? statuses.find((s) => s.next && !s.concertReady) ?? null;
  const row = rowOfTheDay(new Date());
  const toRehearsal = daysUntil(cycle.rehearsalDate);
  const toConcert = daysUntil(cycle.concertDate);
  const target = cycleTarget(statuses, toRehearsal, toConcert);
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

      {!profile.onboarded && (
        <div className="card" style={{ borderColor: 'var(--voice-deep)' }}>
          <div className="row">
            <IconMic color="#4CC9F0" />
            <div className="grow col" style={{ gap: 2 }}>
              <strong>Set up your voice (2 min)</strong>
              <span className="small muted">Mic check, your range, headphone delay and your preferred note names.</span>
            </div>
          </div>
          <button className="btn voice block" onClick={() => go({ name: 'setup' })}>Start setup</button>
        </div>
      )}

      <section className="card">
        <div className="row between">
          <div className="eyebrow">{cycle.name || 'This cycle'}</div>
          <button className="btn ghost small" onClick={() => go({ name: 'settings' })} style={{ height: 32 }}>Edit dates</button>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <Countdown label="Rehearsal" days={toRehearsal} date={cycle.rehearsalDate} />
          <Countdown label="Concert" days={toConcert} date={cycle.concertDate} />
          <div className="col" style={{ gap: 2, marginLeft: 'auto', alignItems: 'flex-end' }}>
            <span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{Math.round(avg * 100)}%</span>
            <span className="tiny muted">cycle readiness</span>
          </div>
        </div>
        {target && <div className="small" style={{ color: 'var(--accent-text)' }}>{target}</div>}
        {focus && focus.next ? (
          <NextUp status={focus} />
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
          <button key={s.piece.id} className="list-row" onClick={() => go({ name: 'piece', pieceId: s.piece.id })}>
            <div className="mono-tile">{initials(s.piece.composer || s.piece.title)}</div>
            <div className="grow col" style={{ gap: 2 }}>
              <span className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{s.piece.title}</span>
              <span className="small muted ellipsis">
                {s.piece.composer}{s.partName ? ` · ${s.partName}` : ''}
                {s.due.length ? ` · ${s.due.length} due for review` : ''}
              </span>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
              <span className="mono small">{Math.round(s.pct * 100)}%</span>
              <span className="tiny muted">{s.concertReady ? 'concert-ready' : s.rehearsalReady ? 'rehearsal-ready' : levelName(s.minLevel)}</span>
            </div>
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

function NextUp({ status }: { status: PieceStatus }) {
  const n = status.next!;
  const spec = levelSpec(n.level);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="col" style={{ gap: 2 }}>
        <span className="small muted">Next up</span>
        <span style={{ fontSize: 20, fontWeight: 800 }}>{status.piece.title}</span>
        <span className="small muted">{n.reason}{spec && !n.reason.includes(spec.name) ? ` (level ${n.level}, ${spec.name})` : ''}</span>
      </div>
      <button className="btn primary block" onClick={() => go({ name: 'play', pieceId: status.piece.id, partId: status.partId, sectionId: n.sectionId, level: n.level, mode: '2d' })}>
        <IconPlay size={18} /> Practise now
      </button>
    </div>
  );
}

function Countdown({ label, days, date }: { label: string; days: number | null; date?: string }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
        {days == null ? '–' : days < 0 ? 'done' : days === 0 ? 'today' : `${days}d`}
      </span>
      <span className="tiny muted">{label}{date ? ` · ${formatDate(date)}` : ''}</span>
    </div>
  );
}

function cycleTarget(statuses: PieceStatus[], toRehearsal: number | null, toConcert: number | null): string | null {
  const goals = [
    { label: 'Rehearsal', level: 3, days: toRehearsal, name: 'level 3 (Independent)' },
    { label: 'Concert', level: 4, days: toConcert, name: 'level 4 (Concert-ready)' },
  ];
  for (const g of goals) {
    if (g.days == null || g.days < 0) continue;
    let missing = 0;
    for (const st of statuses) {
      const prog = getProgress(st.piece.id, st.partId);
      for (const sec of singableSections(st.piece, st.partId)) if ((prog?.sections[sec.id]?.level ?? 0) < g.level) missing++;
    }
    if (!missing) continue;
    const when = g.days === 0 ? 'today' : g.days === 1 ? 'tomorrow' : `in ${g.days} days`;
    const perDay = g.days > 1 ? Math.ceil(missing / g.days) : missing;
    return `${g.label} ${when}: ${missing} section${missing > 1 ? 's' : ''} still below ${g.name}${g.days > 1 ? `, about ${perDay} a day` : ''}.`;
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
