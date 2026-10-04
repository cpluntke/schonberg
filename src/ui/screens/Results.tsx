import React from 'react';
import { getLastResult } from '../play/lastResult';
import { getPiece, singableSections } from '../library';
import { go } from '../router';
import { LEVELS, nextStep } from '../../progress/ladder';
import { getProgress } from '../../progress/store';
import { IconDown, IconUp, IconClock, IconLoop, IconStar, IconPlay, IconCube } from '../icons';
import type { Insight } from '../../game/types';

function gradeLetter(acc: number): string {
  if (acc >= 0.95) return 'S';
  if (acc >= 0.85) return 'A';
  if (acc >= 0.7) return 'B';
  if (acc >= 0.5) return 'C';
  return 'D';
}

function insightIcon(i: Insight) {
  switch (i.kind) {
    case 'flat-long-notes': case 'flat-overall': return <IconDown size={20} color="#FF7A45" />;
    case 'sharp-long-notes': case 'sharp-overall': return <IconUp size={20} color="#FF7A45" />;
    case 'late-entries': case 'early-entries': return <IconClock size={20} color="#FF7A45" />;
    case 'great': return <IconStar size={20} color="#4CC9F0" />;
    default: return <IconLoop size={20} color="#FF7A45" />;
  }
}

export function Results() {
  const lr = getLastResult();
  const piece = lr ? getPiece(lr.pieceId) : undefined;
  if (!lr || !piece) {
    return (
      <main className="screen">
        <h1 className="hero">No results yet</h1>
        <button className="btn primary" onClick={() => go({ name: 'home' })}>Home</button>
      </main>
    );
  }
  const r = lr.result;
  const part = piece.score.parts.find((p) => p.id === lr.partId);
  const section = piece.sections.find((s) => s.id === lr.sectionId);
  const spec = LEVELS[lr.level - 1];
  const sections = singableSections(piece, lr.partId);
  const prog = getProgress(piece.id, lr.partId);
  const next = nextStep(sections, prog);
  const isPB = lr.prevBest != null && r.score > lr.prevBest;
  const leveledUp = lr.ladder && lr.newLevel > lr.prevLevel;

  const measureIdx = Object.keys(r.perMeasure).map(Number).sort((a, b) => a - b);
  const mnum = (i: number) => piece.score.measures[i]?.number ?? String(i + 1);

  const playLoop = (m0: number, m1: number, level = Math.max(1, Math.min(lr.level, 2))) => {
    const ms = piece.score.measures;
    const from = ms[Math.max(0, m0)]?.start ?? lr.from;
    const last = ms[Math.min(ms.length - 1, m1)];
    const to = last ? last.start + last.dur : lr.to;
    go({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'drill', level, mode: '2d', from, to });
  };

  return (
    <main className="screen">
      <div className="col" style={{ gap: 2, paddingTop: 8 }}>
        <span className="eyebrow">
          {section?.label ?? (lr.sectionId === 'all' ? 'Whole piece' : 'Drill')} · {part?.name} · {spec ? `L${lr.level} ${spec.name}` : ''}
        </span>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>{piece.title}</h1>
      </div>

      {lr.ladder && (
        <div className={lr.passed ? 'notice info' : 'notice'} role="status" data-testid="pass-banner">
          {leveledUp
            ? <><strong>Level {lr.newLevel} reached: {LEVELS[lr.newLevel - 1]?.name}!</strong> {lr.newLevel >= 4 ? 'This section is concert-ready.' : lr.newLevel >= 3 ? 'This section is rehearsal-ready.' : ''}</>
            : lr.passed
              ? <><strong>Passed.</strong> You keep level {lr.newLevel}.</>
              : <><strong>Not yet:</strong> {Math.round(r.accuracy * 100)}% of {Math.round((spec?.pass ?? 0.8) * 100)}% needed. Use the tips below and try again.</>}
        </div>
      )}

      <div className="row" style={{ gap: 20 }}>
        <div className="grade-tile" aria-label={`Grade ${gradeLetter(r.accuracy)}`}>{gradeLetter(r.accuracy)}</div>
        <div className="col" style={{ gap: 4 }}>
          <span className="mono" style={{ fontSize: 30, fontWeight: 600 }} data-testid="result-score">{r.score.toLocaleString('de-DE')}</span>
          <span className="small" style={{ color: 'var(--voice)' }}>
            {Math.round(r.accuracy * 100)}% accuracy{isPB ? ' · new personal best!' : ''}
          </span>
        </div>
      </div>

      <div className="stats3">
        <div className="stat"><span className="k">Pitch</span><span className="v">{Math.round(r.pitch * 100)}%</span></div>
        <div className="stat"><span className="k">Rhythm</span><span className="v">{Math.round(r.rhythm * 100)}%</span></div>
        <div className="stat"><span className="k">Best combo</span><span className="v">{r.maxCombo}</span></div>
      </div>
      <div className="tiny muted mono">perfect {r.counts.perfect} · good {r.counts.good} · ok {r.counts.ok} · miss {r.counts.miss}</div>

      {measureIdx.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <div className="row between">
            <h2 style={{ fontSize: 16 }}>Bar by bar</h2>
            <span className="tiny muted">tap a bar to loop it</span>
          </div>
          <div className="heat">
            {measureIdx.map((m) => {
              const v = r.perMeasure[m];
              const bg = v >= 0.85 ? '#4CC9F0' : v >= 0.6 ? '#1D4F63' : '#FF7A45';
              return <button key={m} aria-label={`Bar ${mnum(m)}: ${Math.round(v * 100)}%`} title={`Bar ${mnum(m)} · ${Math.round(v * 100)}%`} style={{ background: bg }} onClick={() => playLoop(m - 1, m + 1)} />;
            })}
          </div>
          <div className="row tiny muted" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#4CC9F0' }} />solid</span>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#1D4F63' }} />ok</span>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#FF7A45' }} />needs work</span>
            <span className="grow" style={{ textAlign: 'right' }}>bars {mnum(measureIdx[0])}–{mnum(measureIdx[measureIdx.length - 1])}</span>
          </div>
        </div>
      )}

      {r.insights.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <h2 style={{ fontSize: 16 }}>Coach notes</h2>
          {r.insights.map((i, k) => (
            <div key={k} className="card" style={{ padding: '12px 14px', gap: 8 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <span style={{ flex: 'none', marginTop: 2 }}>{insightIcon(i)}</span>
                <div className="col" style={{ gap: 2 }}>
                  <strong style={{ fontSize: 14 }}>{i.title}</strong>
                  <span className="small muted">{i.detail}</span>
                </div>
              </div>
              {i.measures && i.kind !== 'great' && (
                <button className="btn small" onClick={() => playLoop(i.measures![0], i.measures![1], 1)}>
                  <IconLoop size={16} /> Loop bars {mnum(i.measures[0])}–{mnum(i.measures[1])} slowly
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="col" style={{ gap: 8, marginTop: 'auto' }}>
        {!lr.passed && lr.ladder ? (
          <button className="btn primary block" onClick={() => go({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level, mode: lr.mode })}>
            <IconPlay size={18} /> Try again
          </button>
        ) : next ? (
          <button className="btn primary block" onClick={() => go({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: next.sectionId, level: next.level, mode: '2d' })}>
            <IconPlay size={18} /> Next: {sections.find((s) => s.id === next.sectionId)?.label}, level {next.level}
          </button>
        ) : (
          <button className="btn primary block" onClick={() => go({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'all', level: 4, mode: '3d' })}>
            <IconCube size={18} color="#0B0D1A" /> Concert-ready! Arcade run of the whole piece
          </button>
        )}
        <div className="row">
          {!lr.passed && lr.ladder && lr.level > 1 ? (
            <button className="btn block" onClick={() => go({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level - 1, mode: '2d' })}>
              Easier: level {lr.level - 1}
            </button>
          ) : !(!lr.passed && lr.ladder) ? (
            <button className="btn block" onClick={() => go({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level, mode: lr.mode, ...(lr.sectionId === 'drill' ? { from: lr.from, to: lr.to } : {}) })}>Again</button>
          ) : null}
          <button className="btn block" onClick={() => go({ name: 'piece', pieceId: piece.id })}>All sections</button>
        </div>
        <button className="btn ghost block" onClick={() => go({ name: 'ranks' })}>Leaderboard</button>
      </div>
    </main>
  );
}
