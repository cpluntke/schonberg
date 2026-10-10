import React, { useState } from 'react';
import { useProfile } from '../hooks';
import { go, back, setDrillHome } from '../router';
import { registerVirtual } from '../library';
import { rowOfTheDay, rowForms } from '../../game/twelvetone';
import { rowPiece, leapPiece, cycleLeaps, singerRange, ROW_FORMS } from '../generated';
import { IconBack, IconPlay, IconCube } from '../icons';
import { letterName } from '../components/Tuner';

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const sym = (p: number) => (p === 10 ? 't' : p === 11 ? 'e' : String(p));

export function Expert() {
  useProfile();
  const row = rowOfTheDay(new Date());
  const allForms = rowForms(row);
  const forms: Record<string, number[]> = Object.fromEntries(ROW_FORMS.map((f) => [f, allForms[f]]));
  const [form, setForm] = useState<string>('P0');
  const [lo, hi] = singerRange();

  function playRow(level: number, mode: '2d' | '3d') {
    const p = rowPiece(new Date(), form);
    registerVirtual(p);
    setDrillHome('expert');
    go({ name: 'play', pieceId: p.id, partId: p.score.parts[0].id, sectionId: 'all', level, mode });
  }

  const drillPairs = cycleLeaps();

  function playLeaps(level: number, mode: '2d' | '3d') {
    const p = leapPiece();
    if (!p) return;
    registerVirtual(p);
    setDrillHome('expert');
    // (level 1 here is the slow step: "Slow, with guide")
    go({ name: 'play', pieceId: p.id, partId: 'drill', sectionId: 'all', level, mode, ...(level === 1 && mode === '2d' ? { step: 'slow' as const } : {}) });
  }

  return (
    <main className="screen wide expert-screen" style={{ background: 'var(--expert-ground)' }}>
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => back({ name: 'train' })}><IconBack /></button>
        <div className="grow col" style={{ gap: 0 }}>
          <h1 style={{ fontSize: '1.25rem' }}>Expert mode</h1>
          <span className="small" style={{ color: 'var(--expert-muted)' }}>Atonal training: no key, no tonic to lean on</span>
        </div>
        <span className="badge expert">×3</span>
      </div>

      {/* (wide screens: the row of the day and the leap drill side by side) */}
      <div className="lay expert-cols">
      <section className="card expert">
        <div className="row between">
          <strong>Zwölfton of the day</strong>
          <span className="tiny" style={{ color: 'var(--expert-muted)' }}>same row for the whole choir today</span>
        </div>
        <div className="seg" role="group" aria-label="Row form" style={{ background: 'var(--expert-surface)' }}>
          {Object.keys(forms).map((f) => (
            <button key={f} aria-pressed={form === f} onClick={() => setForm(f)} style={form === f ? { background: 'var(--expert)', borderColor: 'var(--expert)' } : undefined}>{f}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 3 }}>
          {(forms[form] ?? row).map((pc, i) => (
            <div key={i} style={{ height: 48, borderRadius: 8, background: 'var(--expert-surface)', color: 'var(--expert-text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: '0.875rem' }}>{sym(pc)}</span>
              <span style={{ fontSize: '0.875rem' }}>{NAMES[pc]}</span>
            </div>
          ))}
        </div>
        <span className="small" style={{ color: 'var(--expert-text)' }}>P = prime, R = retrograde, I = inversion, RI = retrograde inversion. Set to your range ({letterName(lo)}–{letterName(hi)}).</span>
        <div className="row wrap">
          <button className="btn small" onClick={() => playRow(2, '2d')}>With guide tone</button>
          <button className="btn small" onClick={() => playRow(4, '2d')}>No help</button>
          <button className="btn small" onClick={() => playRow(3, '3d')}><IconCube size={16} color="var(--expert)" /> Arcade</button>
        </div>
      </section>

      <section className="card expert">
        <strong>Leap drill from your repertoire</strong>
        {drillPairs.length ? (
          <>
            <span className="small" style={{ color: 'var(--expert-text)' }}>The {drillPairs.length} hardest intervals in your parts of the programme, one per bar.</span>
            <div className="col" style={{ gap: 4 }}>
              {drillPairs.slice(0, 6).map((l, i) => (
                <div key={i} className="row small"><span className="mono" style={{ width: 52, color: 'var(--expert)' }}>{l.label}</span><span className="muted ellipsis">{l.where}</span></div>
              ))}
              {drillPairs.length > 6 && <span className="tiny muted">+ {drillPairs.length - 6} more</span>}
            </div>
            <div className="row wrap">
              <button className="btn small" onClick={() => playLeaps(1, '2d')}><IconPlay size={16} /> Slow, with guide</button>
              <button className="btn small" onClick={() => playLeaps(3, '2d')}>Without guide</button>
              <button className="btn small" onClick={() => playLeaps(3, '3d')}><IconCube size={16} color="var(--expert)" /> Arcade</button>
            </div>
          </>
        ) : (
          <span className="small muted">Add pieces to your programme to get leap drills.</span>
        )}
      </section>
      </div>
    </main>
  );
}
