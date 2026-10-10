// Small charts for the section, choir and usage insights: plain HTML/SVG, no chart library.
// Colours: piece levels are a magnitude (one hue, dim → bright on the dark surface); ranges use the
// voice colour (steady solid, reach lighter); text stays in the text colours.

import React from 'react';
import { noteName, rangeFlags, USUAL_RANGE, type SingerRange } from '../../progress/insights';

/** Level 0 (no piece level yet) … 5 (memorised): one hue, brighter = further. */
export const LEVEL_COLOR = ['#3a3f63', '#1d4f63', '#24718e', '#2f97bb', '#4cc9f0', '#b6ecff'];
export const LEVEL_NAME = ['not yet', 'Level 1 · Notes', 'Level 2 · Words', 'Level 3 · Alone (rehearsal-ready)', 'Level 4 · Concert (concert-ready)', 'Level 5 · By heart (memorised)'];

/** How many singers are at each piece level, as one stacked bar (with a legend unless `bare`). */
export function LevelBar({ levels, bare = false, height = 14 }: { levels: number[]; bare?: boolean; height?: number }) {
  const total = levels.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="col" style={{ gap: 6 }}>
      <div role="img" aria-label={`Piece levels: ${levels.map((n, i) => `${n} at ${LEVEL_NAME[i]}`).filter((_, i) => levels[i]).join(', ')}`}
        style={{ display: 'flex', gap: 2, height, width: '100%' }}>
        {levels.map((n, i) => n > 0 && (
          <span key={i} title={`${n} singer${n > 1 ? 's' : ''}: ${LEVEL_NAME[i]}`}
            style={{ flex: n / total, minWidth: 6, background: LEVEL_COLOR[i], borderRadius: 4 }} />
        ))}
      </div>
      {!bare && (
        <div className="row wrap tiny muted" style={{ gap: 10 }}>
          {levels.map((n, i) => n > 0 && (
            <span key={i} className="row" style={{ gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: LEVEL_COLOR[i] }} />
              {i === 0 ? 'not yet' : `L${i}`} <span className="mono" style={{ color: 'var(--text)' }}>{n}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const VOICE = '#4cc9f0';

/**
 * Each singer's range on one pitch axis: steady range solid, reach lighter. Behind them the voice
 * type's usual range (shaded) and the notes the section sings in the programme (outlined).
 */
export function RangeChart({ ranges, voice, part, label }: {
  ranges: SingerRange[];
  voice: string;
  /** Lowest and highest note this section sings in the programme's pieces. */
  part: [number, number] | null;
  label?: string;
}) {
  const usual = USUAL_RANGE[voice] ?? null;
  const measured = ranges.filter((r) => r.measured && r.lo != null && r.hi != null);
  const pts = [...measured.flatMap((r) => [r.reachLo ?? r.lo!, r.reachHi ?? r.hi!]), ...(usual ?? []), ...(part ?? [])];
  if (!pts.length) return null;
  const lo = Math.floor((Math.min(...pts) - 2) / 12) * 12; // from a C
  const hi = Math.max(lo + 12, Math.ceil((Math.max(...pts) + 2) / 12) * 12); // to a C
  const pct = (m: number) => `${((m - lo) / (hi - lo)) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / (hi - lo)) * 100}%`;
  const ticks: number[] = [];
  for (let m = lo; m <= hi; m += 12) ticks.push(m);
  const NAME_W = 'clamp(84px, 30%, 170px)';
  const band = (a: number, b: number, style: React.CSSProperties, title: string) => (
    <span title={title} style={{ position: 'absolute', top: 0, bottom: 0, left: pct(a), width: width(a, b), ...style }} />
  );
  return (
    <div className="col" style={{ gap: 6 }} data-testid={`range-chart-${voice}`} role="figure" aria-label={label ?? 'Voice ranges'}>
      {ranges.map((r) => {
        const flags = rangeFlags(r, part);
        return (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', minHeight: 30 }} data-testid="range-row">
            <div style={{ width: NAME_W, flex: 'none', paddingRight: 8, minWidth: 0 }}>
              <div className="small ellipsis" title={r.name}>{r.name}</div>
              {flags.length > 0 && <div className="tiny" style={{ color: 'var(--accent-text)', lineHeight: 1.2 }}>{flags.join(' · ')}</div>}
            </div>
            <div style={{ position: 'relative', flex: 1, minWidth: 0, alignSelf: 'stretch' }}>
              {usual && band(usual[0], usual[1], { background: 'rgba(168,176,214,0.10)' }, '')}
              {part && band(part[0], part[1], { borderLeft: '1px dashed rgba(255,176,143,0.7)', borderRight: '1px dashed rgba(255,176,143,0.7)', background: 'rgba(255,122,69,0.07)' }, '')}
              {ticks.map((t) => <span key={t} aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: pct(t), borderLeft: '1px solid var(--line)' }} />)}
              {r.measured && r.lo != null && r.hi != null ? (
                <>
                  {r.reachLo != null && r.reachHi != null && (
                    <span title={`${r.name}: reaches ${noteName(r.reachLo)}–${noteName(r.reachHi)} (less steady)`}
                      style={{ position: 'absolute', top: '50%', height: 10, marginTop: -5, left: pct(r.reachLo), width: width(r.reachLo, r.reachHi), background: VOICE + '55', borderRadius: 4 }} />
                  )}
                  <span title={`${r.name}: steady ${noteName(r.lo)}–${noteName(r.hi)}${r.at ? `, measured ${new Date(r.at).toLocaleDateString()}` : ''}`}
                    style={{ position: 'absolute', top: '50%', height: 10, marginTop: -5, left: pct(r.lo), width: width(r.lo, r.hi), background: VOICE, borderRadius: 4 }} />
                  <span className="tiny mono" style={{ position: 'absolute', top: '50%', marginTop: 6, left: pct(r.lo), whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 10 }}>
                    {noteName(r.lo)}–{noteName(r.hi)}
                  </span>
                </>
              ) : (
                <span className="tiny muted" style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: 6, background: 'var(--surface)', padding: '0 4px', borderRadius: 4, whiteSpace: 'nowrap' }}>not measured</span>
              )}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex' }}>
        <div style={{ width: NAME_W, flex: 'none' }} />
        <div style={{ position: 'relative', flex: 1, height: 14 }} aria-hidden="true">
          {ticks.map((t) => <span key={t} className="tiny mono muted" style={{ position: 'absolute', left: pct(t), transform: 'translateX(-50%)', fontSize: 10 }}>{noteName(t)}</span>)}
        </div>
      </div>
      <div className="row wrap tiny muted" style={{ gap: 10 }}>
        <span className="row" style={{ gap: 4 }}><span style={{ width: 14, height: 8, borderRadius: 3, background: VOICE }} />steady, in tune</span>
        <span className="row" style={{ gap: 4 }}><span style={{ width: 14, height: 8, borderRadius: 3, background: VOICE + '55' }} />reach (less steady)</span>
        {usual && <span className="row" style={{ gap: 4 }}><span style={{ width: 14, height: 8, background: 'rgba(168,176,214,0.25)' }} />usual {voice} range</span>}
        {part && <span className="row" style={{ gap: 4 }}><span style={{ width: 14, height: 8, border: '1px dashed rgba(255,176,143,0.9)' }} />notes in the programme ({noteName(part[0])}–{noteName(part[1])})</span>}
      </div>
    </div>
  );
}

/** A tiny line over days (one series; the title names it). */
export function Sparkline({ values, labels, height = 44, format = (v: number) => String(v) }: {
  values: number[]; labels: string[]; height?: number; format?: (v: number) => string;
}) {
  const W = 300;
  const max = Math.max(1, ...values);
  const x = (i: number) => (values.length <= 1 ? W / 2 : (i / (values.length - 1)) * (W - 8) + 4);
  const y = (v: number) => height - 4 - (v / max) * (height - 10);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img"
      aria-label={values.length ? `From ${format(values[0])} to ${format(values[values.length - 1])}` : 'No data'}>
      <line x1={0} x2={W} y1={height - 4} y2={height - 4} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={VOICE} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {values.map((v, i) => (
        <rect key={i} x={x(i) - W / values.length / 2} y={0} width={W / Math.max(1, values.length)} height={height} fill="transparent">
          <title>{`${labels[i]}: ${format(v)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** Horizontal bars with labels and values (magnitude, one hue). */
export function BarList({ rows, format = (v: number) => String(v), max }: {
  rows: { label: string; value: number; note?: string }[]; format?: (v: number) => string; max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="col" style={{ gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${format(r.value)}${r.note ? ` (${r.note})` : ''}`}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 46%) 1fr auto', alignItems: 'center', gap: 8 }}>
          <span className="small ellipsis">{r.label}</span>
          <span style={{ height: 10, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, (r.value / top) * 100)}%`, background: VOICE, borderRadius: 4 }} />
          </span>
          <span className="small mono" style={{ minWidth: 44, textAlign: 'right' }}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
