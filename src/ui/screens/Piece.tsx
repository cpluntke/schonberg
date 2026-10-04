import React, { useState } from 'react';
import { getPiece, singableSections, chosenPartId, rememberPart } from '../library';
import { useProfile, useStoreVersion } from '../hooks';
import { go, back } from '../router';
import { getProgress, dueForReview } from '../../progress/store';
import { LEVELS, pieceReadiness, nextStep, sectionStatus } from '../../progress/ladder';
import { IconBack, IconEar, IconCube, IconPlay } from '../icons';
import { voiceName } from './Home';

export function PieceScreen({ pieceId }: { pieceId: string }) {
  const [profile] = useProfile();
  useStoreVersion();
  const piece = getPiece(pieceId);
  const [partId, setPartId] = useState(() => (piece ? chosenPartId(piece, profile.voice) : ''));
  const [showHelp, setShowHelp] = useState(false);

  if (!piece) {
    return (
      <main className="screen">
        <div className="topbar"><button className="icon-btn" aria-label="Back" onClick={() => back()}><IconBack /></button><h1>Not found</h1></div>
        <p className="muted">This piece isn't on this device any more.</p>
      </main>
    );
  }
  const vocalParts = piece.score.parts.filter((p) => p.notes.length > 0);
  const part = piece.score.parts.find((p) => p.id === partId) ?? vocalParts[0];
  const sections = part ? singableSections(piece, part.id) : [];
  const prog = part ? getProgress(piece.id, part.id) : undefined;
  const r = pieceReadiness(sections, prog);
  const next = nextStep(sections, prog);
  const due = part ? dueForReview(piece.id, part.id, sections) : [];

  const pick = (id: string) => { setPartId(id); rememberPart(piece.id, id); };
  const play = (sectionId: string, level: number, mode: '2d' | '3d' = '2d') =>
    go({ name: 'play', pieceId: piece.id, partId: part!.id, sectionId, level, mode });

  return (
    <main className="screen">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => back()}><IconBack /></button>
        <div className="grow col" style={{ gap: 0 }}>
          <h1 className="ellipsis" style={{ margin: 0, fontSize: 22 }}>{piece.title}</h1>
          <span className="small muted ellipsis">{piece.composer}</span>
        </div>
      </div>

      <div className="col" style={{ gap: 8 }}>
        <span className="eyebrow">Your part</span>
        <div className="chips" role="group" aria-label="Part">
          {vocalParts.map((p) => (
            <button key={p.id} className="chip" aria-pressed={p.id === part?.id} onClick={() => pick(p.id)}>{p.name}</button>
          ))}
        </div>
        {part && part.voiceType !== profile.voice && part.voiceType !== 'other' && (
          <span className="tiny muted">You're set up as {voiceName(profile.voice)}; this is the {part.name} part.</span>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <div className="col" style={{ gap: 2 }}>
            <span className="eyebrow">Readiness</span>
            <span style={{ fontWeight: 800, fontSize: 18 }}>
              {r.concertReady ? 'Concert-ready' : r.rehearsalReady ? 'Rehearsal-ready' : `${sections.length} sections to learn`}
            </span>
          </div>
          <span className="mono" style={{ fontSize: 28, fontWeight: 600 }}>{Math.round(r.pct * 100)}%</span>
        </div>
        <div className="bar"><span style={{ width: `${r.pct * 100}%` }} /></div>
        <span className="small muted">Rehearsal-ready = every section at level 3 (Independent). Concert-ready = level 4.</span>
        {next && (
          <button className="btn primary block" onClick={() => play(next.sectionId, next.level)}>
            <IconPlay size={18} /> {sections.find((s) => s.id === next.sectionId)?.label}: level {next.level}
          </button>
        )}
        <button className="btn ghost small" onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp}>
          {showHelp ? 'Hide' : 'How'} the levels work
        </button>
        {showHelp && (
          <div className="col" style={{ gap: 8 }}>
            {LEVELS.map((l) => (
              <div key={l.level} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="lvl-btn" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{l.level}</span>
                <div className="col" style={{ gap: 2 }}>
                  <strong>{l.name}</strong>
                  <span className="small muted">{l.description}</span>
                  <span className="tiny muted mono">
                    {Math.round(l.rate * 100)}% tempo · {l.guide ? 'your part plays' : 'others only'} · {l.showNames ? 'note names' : 'lyrics only'} · ±{l.tolerance}¢ · pass {Math.round(l.pass * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <section className="ladder" aria-label="Sections">
        <h2 style={{ marginBottom: 4 }}>Sections</h2>
        {sections.map((s) => {
          const sp = prog?.sections[s.id];
          const lvl = sp?.level ?? 0;
          const status = sectionStatus(sp);
          const isDue = due.includes(s.id);
          return (
            <div key={s.id} className="ladder-row">
              <div className="col grow" style={{ gap: 4 }}>
                <span style={{ fontWeight: 600 }}>{s.label}</span>
                <span className="tiny muted">
                  {isDue ? 'Due for review' : status === 'new' ? 'Not started' : `Level ${lvl}${sp?.best?.[lvl] != null ? ` · best ${Math.round(sp.best[lvl] * 100)}%` : ''}`}
                </span>
              </div>
              <button className="icon-btn" aria-label={`Listen to ${s.label}`} onClick={() => play(s.id, 0)}><IconEar size={20} /></button>
              {[1, 2, 3, 4].map((l) => {
                const cls = l <= lvl ? 'lvl-btn done' : l === lvl + 1 ? 'lvl-btn next' : 'lvl-btn';
                return (
                  <button key={l} className={cls} aria-label={`${s.label}, level ${l}${l <= lvl ? ' (passed)' : ''}`} onClick={() => play(s.id, l)}>{l}</button>
                );
              })}
              <button className="icon-btn" aria-label={`Arcade mode for ${s.label}${lvl < 2 ? ' (unlocks at level 2)' : ''}`}
                disabled={lvl < 2} onClick={() => play(s.id, Math.max(2, Math.min(4, lvl)), '3d')}
                title={lvl < 2 ? 'Arcade unlocks at level 2' : 'Arcade mode'}>
                <IconCube size={20} color={lvl >= 2 ? '#B3A6FF' : undefined} />
              </button>
            </div>
          );
        })}
        {!sections.length && <span className="muted">This part has no notes.</span>}
      </section>

      {sections.length > 1 && (
        <div className="card flat">
          <strong>Run the whole piece</strong>
          <span className="small muted">A full run-through doesn't change section levels, but counts for your streak and the leaderboard.</span>
          <div className="row wrap">
            <button className="btn small" onClick={() => play('all', 2)}>With your part</button>
            <button className="btn small" onClick={() => play('all', 3)}>Others only</button>
            <button className="btn small" onClick={() => play('all', 4)}>Concert mode</button>
            <button className="btn small" onClick={() => play('all', 3, '3d')}><IconCube size={16} color="#B3A6FF" /> Arcade</button>
          </div>
        </div>
      )}
    </main>
  );
}
