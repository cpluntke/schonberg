import React from 'react';
import type { Part, Score, Section } from '../../music/types';
import type { InsightKind } from '../../game/types';
import { mastery, troubleSpots, type BarMap, type Mastery } from '../../progress/bars';
import { mix } from '../theme';

export const MASTERY_COLOR: Record<Mastery, string> = {
  solid: 'var(--voice)',
  ok: 'var(--voice-deep)',
  weak: 'var(--accent)',
  none: 'var(--line)',
};
const LABEL: Record<Mastery, string> = { solid: 'solid', ok: 'ok', weak: 'needs work', none: 'not sung yet' };

/** One glyph per problem kind (the coach notes on Results explain them in words). */
const GLYPH: Partial<Record<InsightKind, [string, string]>> = {
  'flat-overall': ['♭', 'flat'],
  'flat-long-notes': ['♭', 'sagging long notes'],
  'sharp-overall': ['♯', 'sharp'],
  'sharp-long-notes': ['♯', 'creeping sharp'],
  'late-entries': ['⏱', 'late entry'],
  'behind-beat': ['⏱', 'behind the beat'],
  'early-entries': ['⏱', 'early entry'],
  scooping: ['↗', 'scooping'],
  leaps: ['↕', 'leaps'],
  'wrong-notes': ['✕', 'wrong notes'],
  'missed-notes': ['✕', 'missed notes'],
  octave: ['8', 'wrong octave'],
  'tempo-drift': ['⏱', 'tempo drift'],
};

function barNotes(part: Part, score: Score, m: number) {
  const ms = score.measures[m];
  if (!ms) return [];
  return part.notes.filter((n) => n.start < ms.start + ms.dur - 1e-6 && n.start + n.dur > ms.start + 1e-6);
}

/** Tiny melodic contour of one bar: what the bar "looks like", to recognise it. */
function Contour({ part, score, m, color }: { part: Part; score: Score; m: number; color: string }) {
  const ms = score.measures[m];
  const notes = barNotes(part, score, m);
  const lo = part.low - 1;
  const span = Math.max(4, part.high + 1 - lo);
  const W = 40;
  const H = 22;
  const x = (t: number) => ((Math.min(ms.start + ms.dur, Math.max(ms.start, t)) - ms.start) / ms.dur) * W;
  const y = (midi: number) => H - 2 - ((midi - lo) / span) * (H - 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true" preserveAspectRatio="none">
      {notes.map((n, i) => (
        <line key={i} x1={x(n.start) + 0.8} x2={Math.max(x(n.start) + 1.6, x(n.start + n.dur) - 0.8)} y1={y(n.midi)} y2={y(n.midi)}
          stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      ))}
    </svg>
  );
}

/**
 * The whole part at a glance: every bar as a small contour, coloured by how well it has gone
 * recently, with a mark for the kind of trouble. Tap a bar to loop it.
 */
export function PieceMap({ score, part, sections, bars, onLoop }: {
  score: Score;
  part: Part;
  sections: Section[];
  bars: BarMap;
  onLoop: (measure: number) => void;
}) {
  const label = (m: number) => score.measures[m]?.number ?? String(m + 1);
  const all = sections.flatMap((s) => Array.from({ length: s.endMeasure - s.startMeasure + 1 }, (_, i) => s.startMeasure + i));
  const sung = all.filter((m) => bars[m]).length;
  const spots = troubleSpots(bars, all);
  return (
    <div className="col" style={{ gap: 10 }} data-testid="piece-map">
      <span className="small muted">
        {sung === 0
          ? 'Sing a passage and every bar fills in here with how it went.'
          : spots.length
            ? <>Trouble spots: {spots.map(([a, b]) => (a === b ? `bar ${label(a)}` : `bars ${label(a)}–${label(b)}`)).join(', ')}. Tap a bar to loop it.</>
            : <>No weak bars right now{sung < all.length ? ` (${all.length - sung} bars not sung yet)` : ''}. Tap a bar to loop it.</>}
      </span>
      {sections.map((s) => (
        <div key={s.id} className="col" style={{ gap: 4 }}>
          <span className="tiny muted">{s.label}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 4 }}>
            {Array.from({ length: s.endMeasure - s.startMeasure + 1 }, (_, i) => s.startMeasure + i).map((m) => {
              const st = bars[m];
              const k = mastery(st);
              const g = (st?.issues ?? []).map((x) => GLYPH[x]).filter(Boolean) as [string, string][];
              const empty = barNotes(part, score, m).length === 0;
              return (
                <button key={m} onClick={() => onLoop(m)} data-mastery={k}
                  aria-label={`Bar ${label(m)}: ${empty ? 'rest' : LABEL[k]}${g.length ? ` (${[...new Set(g.map((x) => x[1]))].join(', ')})` : ''}. Loop this bar`}
                  style={{
                    position: 'relative', minHeight: 44, padding: '3px 2px 2px', border: 'none', borderRadius: 6,
                    background: empty ? 'transparent' : k === 'none' ? MASTERY_COLOR[k] : mix(MASTERY_COLOR[k], 20),
                    outline: empty ? '1px dashed var(--line)' : `1px solid ${MASTERY_COLOR[k]}`, outlineOffset: -1,
                    display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1,
                  }}>
                  <span className="mono" style={{ fontSize: '0.8125rem', color: 'var(--muted)', textAlign: 'left', lineHeight: 1 }}>{label(m)}</span>
                  <Contour part={part} score={score} m={m} color={k === 'none' ? 'var(--muted)' : k === 'ok' ? 'var(--voice)' : MASTERY_COLOR[k]} />
                  {g.length > 0 && (
                    <span style={{ position: 'absolute', top: 1, right: 3, fontSize: '0.8125rem', fontWeight: 800, color: 'var(--accent-text)' }}>{[...new Set(g.map((x) => x[0]))].slice(0, 2).join('')}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="row tiny muted wrap" style={{ gap: 12 }}>
        {(['solid', 'ok', 'weak', 'none'] as Mastery[]).map((k) => (
          <span key={k} className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: MASTERY_COLOR[k] }} />{LABEL[k]}</span>
        ))}
        <span>♭♯ intonation · ⏱ timing · ↗ scooping · ↕ leaps · ✕ wrong notes · 8 octave</span>
      </div>
    </div>
  );
}
