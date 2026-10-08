// The section lead's picture of their section: aggregated progress (no names, distributions from
// three singers on) and, by name, each sharing singer's voice range.

import React, { useMemo, useState } from 'react';
import { getPiece, defaultPartId, singableSections, type PieceInfo } from '../library';
import { go } from '../router';
import { loadCycle } from '../../progress/store';
import type { BarMap } from '../../progress/bars';
import type { NoteAgg, PieceAgg, SectionInsightsView } from '../../progress/insights';
import type { Part } from '../../music/types';
import { PieceMap } from './PieceMap';
import { CheatSheet } from './CheatSheet';
import { LevelBar, RangeChart } from './InsightCharts';
import { VOICE_NAME } from './People';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The part this section sings in a piece (by voice type, never the viewer's own choice). */
export function sectionPart(piece: PieceInfo, voice: string) {
  const id = defaultPartId(piece, voice);
  return piece.score.parts.find((p) => p.id === id) ?? null;
}

/** Lowest and highest note this section sings in the given pieces (all its divisi parts), or null. */
export function sectionPartRange(voice: string, pieceIds: string[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of pieceIds) {
    const piece = getPiece(id);
    if (!piece) continue;
    const own = piece.score.parts.filter((p) => p.voiceType === voice && p.notes.length);
    const parts = own.length ? own : [sectionPart(piece, voice)].filter((p): p is NonNullable<typeof p> => !!p && p.notes.length > 0);
    for (const p of parts) { lo = Math.min(lo, p.low); hi = Math.max(hi, p.high); }
  }
  return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi ? [lo, hi] : null;
}

/** Programme pieces first, then any other piece the section shares progress on. */
export function orderedPieceIds(pieceIds: string[]): string[] {
  const cycle = loadCycle().pieceIds;
  return [...new Set([...cycle.filter((id) => pieceIds.includes(id)), ...pieceIds])];
}

export function trendText(p: PieceAgg): { text: string; color: string } | null {
  const t = p.trend;
  if (!t) return null;
  const since = new Date(t.since + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const what = `${pct(t.readiness[0])} → ${pct(t.readiness[1])}${t.ready[0] !== t.ready[1] ? `, rehearsal-ready ${t.ready[0]} → ${t.ready[1]}` : ''}`;
  if (t.state === 'improving') return { text: `▲ Improving since ${since} (${what})`, color: 'var(--good)' };
  if (t.state === 'slipping') return { text: `▼ Slipping since ${since} (${what})`, color: 'var(--accent-text)' };
  return { text: `■ Stalling since ${since} (${what})`, color: 'var(--muted)' };
}

/** Hardest bars, adjacent ones merged into one loop (measure indexes, inclusive). */
export function loopGroups(bars: number[]): [number, number][] {
  const sorted = [...new Set(bars)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m - last[1] <= 2) last[1] = m;
    else out.push([m, m]);
  }
  return out;
}

export function loopBars(piece: PieceInfo, partId: string, a: number, b: number) {
  const ms = piece.score.measures;
  const from = ms[Math.max(0, a - 1)];
  const to = ms[Math.min(ms.length - 1, b + 1)];
  if (!from || !to) return;
  go({ name: 'play', pieceId: piece.id, partId, sectionId: 'drill', level: 1, mode: '2d', from: from.start, to: to.start + to.dur });
}

/** The rehearsal cheat sheet of a piece: one per part the section sings it in (divisi apart). */
function CheatSheets({ piece, part, agg }: { piece: PieceInfo; part: Part; agg: PieceAgg }) {
  const [open, setOpen] = useState(false);
  // (a part this phone's copy of the score doesn't have is left out: its note numbers mean nothing here)
  const parts = Object.entries(agg.noteParts ?? {})
    .map(([id, g]) => ({ p: piece.score.parts.find((x) => x.id === id), singers: g.singers, notes: g.notes }))
    .filter((x): x is { p: Part; singers: number; notes: NoteAgg[] } => !!x.p && x.notes.length > 0);
  const total = parts.reduce((a, x) => a + x.notes.length, 0);
  return (
    <details className="cheat" data-testid="cheat-details" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>
        Rehearsal cheat sheet{total ? ` · ${total} note${total === 1 ? '' : 's'}` : ''}
      </summary>
      {/* (drawn only while open) */}
      {open && (
        <div className="col" style={{ marginTop: 8, gap: 14 }}>
          {parts.length ? parts.map(({ p, singers, notes }) => (
            <div key={p.id} className="col" style={{ gap: 6 }}>
              {parts.length > 1 && <strong className="small">{p.name}</strong>}
              <CheatSheet piece={piece} part={p} notes={notes} singers={singers} />
            </div>
          )) : <CheatSheet piece={piece} part={part} notes={[]} singers={agg.singers} />}
        </div>
      )}
    </details>
  );
}

function PieceCard({ id, agg, voice, minGroup }: { id: string; agg: PieceAgg; voice: string; minGroup: number }) {
  const piece = getPiece(id);
  const part = piece ? sectionPart(piece, voice) : null;
  const label = (m: number) => piece?.score.measures[m]?.number ?? String(m + 1);
  const trend = trendText(agg);
  return (
    <div className="card" data-testid="section-piece">
      <strong>{piece?.title ?? 'A piece not on this phone'}</strong>
      <span className="small muted">
        {agg.singers} singer{agg.singers === 1 ? '' : 's'} sharing · {agg.active} active this week{part ? ` · ${part.name}` : ''}
      </span>
      {agg.hidden ? (
        <span className="small muted" data-testid="small-group">
          Levels and hard bars appear once {minGroup} or more singers share this piece, so nobody's own progress can be picked out.
        </span>
      ) : (
        <>
          <div className="row wrap small" style={{ gap: 14 }}>
            <span><span className="mono">{agg.rehearsalReady}</span> of {agg.singers} rehearsal-ready</span>
            <span><span className="mono">{agg.concertReady}</span> concert-ready</span>
            <span className="muted">average readiness <span className="mono">{pct(agg.readiness ?? 0)}</span></span>
          </div>
          <LevelBar levels={agg.levels ?? []} />
          {trend
            ? <span className="small" style={{ color: trend.color }} data-testid="trend">{trend.text}</span>
            : <span className="tiny muted">The trend shows from next week on (it compares with a week ago).</span>}
          {agg.hardest && agg.hardest.length > 0 && piece && part ? (
            <div className="col" style={{ gap: 6 }}>
              <span className="small">Hardest for the section: {agg.hardest.map((h) => `bar ${label(h.bar)} (${h.weak} of ${h.n} struggling)`).join(', ')}</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {loopGroups(agg.hardest.map((h) => h.bar)).map(([a, b]) => (
                  <button key={a} className="btn small" data-testid="loop-hardest" onClick={() => loopBars(piece, part.id, a, b)}>
                    Loop {a === b ? `bar ${label(a)}` : `bars ${label(a)}–${label(b)}`}
                  </button>
                ))}
              </div>
            </div>
          ) : <span className="small muted">No bar where most of the section struggles.</span>}
          {piece && part && <CheatSheets piece={piece} part={part} agg={agg} />}
          {piece && part && agg.bars && (
            <PieceMap score={piece.score} part={part} sections={singableSections(piece, part.id)}
              bars={Object.fromEntries(Object.entries(agg.bars).map(([m, b]) => [Number(m), { ema: b.mean, n: b.n, at: 0 }])) as BarMap}
              onLoop={(m) => loopBars(piece, part.id, m, m)} />
          )}
        </>
      )}
    </div>
  );
}

export function SectionInsights({ view }: { view: SectionInsightsView }) {
  const ids = useMemo(() => orderedPieceIds(Object.keys(view.pieces)), [view]);
  const partRange = useMemo(() => sectionPartRange(view.voice, loadCycle().pieceIds), [view.voice]);
  if (!view.sharing) {
    return <div className="notice">Nobody in this section shares their progress yet. Singers turn it on in Settings → Your choir.</div>;
  }
  const small = Object.values(view.pieces).some((p) => p.hidden);
  return (
    <>
      <div className="card flat" data-testid="section-summary">
        <strong>{view.sharing} singer{view.sharing === 1 ? '' : 's'} sharing · {view.activeWeek} active this week</strong>
        <span className="small muted">This view shows the section as a whole, never per singer.{small ? ` Pieces with fewer than ${view.minGroup} singers sharing show counts only.` : ''}</span>
      </div>
      <div className="card" data-testid="section-ranges">
        <strong>Voices in your section</strong>
        <span className="small muted">Each singer's range from their range check, highest first, for divisi decisions. Sharing it is part of being in the choir; singers are told when they join.</span>
        <RangeChart ranges={view.ranges} voice={view.voice} part={partRange} label={`${VOICE_NAME[view.voice] ?? view.voice}: voice ranges`} />
      </div>
      {ids.map((id) => <PieceCard key={id} id={id} agg={view.pieces[id]} voice={view.voice} minGroup={view.minGroup} />)}
    </>
  );
}
