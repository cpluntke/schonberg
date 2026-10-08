import React, { useState } from 'react';
import { getPiece, singableSections, chosenPartId, rememberPart, registerVirtual, renameImported } from '../library';
import { entryPiece } from '../generated';
import { entryNotes } from '../../game/drills';
import { useProfile, useStoreVersion } from '../hooks';
import { go, back } from '../router';
import { getProgress, dueForReview } from '../../progress/store';
import { LEVELS, OFF_BOOK_DAYS, pieceReadiness, nextStep, sectionStatus, levelSpec, passLabel } from '../../progress/ladder';
import { IconBack, IconDown, IconEar, IconCube, IconPlay } from '../icons';
import { voiceName } from './Home';
import { PieceMap } from '../components/PieceMap';
import { getBars } from '../../progress/bars';
import { startColdStart } from '../play/cold';
import { getWords } from '../../progress/words';
import { STAGE_NAMES } from '../../game/textrhythm';
import { NotFound } from '../components/NotFound';
import { KeyMarksCard } from '../components/KeyMarks';

/** First few words of the lyric in a section, to recognise the phrase. */
function snippet(part: { notes: { start: number; lyric?: string; syllabic?: string }[] }, from: number, to: number): string {
  let out = '';
  let open = false;
  for (const n of part.notes) {
    if (n.start < from - 1e-6 || n.start >= to - 1e-6 || !n.lyric) continue;
    const cont = open && (n.syllabic === 'middle' || n.syllabic === 'end');
    out += (cont || !out ? '' : ' ') + n.lyric;
    open = n.syllabic === 'begin' || n.syllabic === 'middle';
    if (out.length > 26 && !open) break;
  }
  return out.trim();
}

function entryCount(part: Parameters<typeof entryNotes>[0]): number {
  const idx = entryNotes(part, 0.6);
  return Math.min(10, idx.includes(0) || !part.notes.length ? idx.length : idx.length + 1);
}

const SHORT: Record<number, string> = { 1: 'Learn', 2: 'In time', 3: 'Alone', 4: 'Concert', 5: 'By heart' };

export function PieceScreen({ pieceId }: { pieceId: string }) {
  const [profile] = useProfile();
  useStoreVersion();
  const piece = getPiece(pieceId);
  const [partId, setPartId] = useState(() => (piece ? chosenPartId(piece, profile.voice) : ''));
  const [showHelp, setShowHelp] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: piece?.title ?? '', composer: piece?.composer ?? '' });

  if (!piece) return <NotFound pieceId={pieceId} what="piece" />;
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
  const label = (id: string) => sections.find((s) => s.id === id)?.label ?? id;
  // Sections that slipped in a full run, by section: the lowest level they must pass at.
  const fixAt = new Map<string, number>();
  for (const f of [...r.toFix].reverse()) for (const id of f.sectionIds) fixAt.set(id, f.level);
  const multi = sections.length > 1;
  const P = r.pieceLevel;
  // A full run opened a level above the piece's: the piece was sung through, the fixes are what's left.
  const open = multi ? r.toFix.find((f) => f.level > P) : undefined;
  const openText = open
    ? `Level ${open.level} open: fix ${open.sectionIds.length} section${open.sectionIds.length > 1 ? 's' : ''} to ${open.level === 5 ? 'finish it from memory' : 'reach it'}`
    : '';

  return (
    <main className="screen wide piece-screen">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => back()}><IconBack /></button>
        <div className="grow col" style={{ gap: 0 }}>
          <h1 className="ellipsis" style={{ margin: 0, fontSize: 22 }}>{piece.title}</h1>
          <span className="small muted ellipsis">{piece.composer}</span>
        </div>
        {!piece.builtin && !piece.id.includes('~') && (
          <button className="btn ghost small" onClick={() => { setDraft({ title: piece.title, composer: piece.composer }); setEditing(!editing); }} aria-expanded={editing}>
            {editing ? 'Close' : 'Rename'}
          </button>
        )}
      </div>

      {editing && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); await renameImported(piece.id, draft.title, draft.composer); setEditing(false); }}>
          <label className="field"><span>Title</span>
            <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} />
          </label>
          <label className="field"><span>Composer</span>
            <input type="text" value={draft.composer} onChange={(e) => setDraft({ ...draft, composer: e.target.value })} maxLength={80} />
          </label>
          <button className="btn primary block" type="submit">Save</button>
        </form>
      )}

      {/* Wide screens: your part, its readiness, the next step and the map on one side, the sections and the drills on the other. */}
      <div className="lay piece-cols">
      <div className="lay piece-side">
      <div className="col" style={{ gap: 8 }}>
        <div className="row between">
          <span className="eyebrow">Your part</span>
          {/* The section list is far down (after the readiness, the full run and the map). */}
          {sections.length > 0 && (
            <button className="linklike jump-link" data-testid="jump-sections"
              onClick={() => document.getElementById('piece-sections')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              Jump to sections <IconDown size={16} />
            </button>
          )}
        </div>
        <div className="chips" role="group" aria-label="Part">
          {vocalParts.map((p) => (
            <button key={p.id} className="chip" aria-pressed={p.id === part?.id} onClick={() => pick(p.id)}>{p.name}</button>
          ))}
        </div>
        {part && part.voiceType !== profile.voice && part.voiceType !== 'other' && (
          <span className="tiny muted">You're set up as {voiceName(profile.voice)}; this is the {part.name} part.</span>
        )}
      </div>

      <div className="card" data-testid="readiness-card">
        <div className="row between">
          <div className="col" style={{ gap: 2 }}>
            <span className="eyebrow">Readiness</span>
            <span style={{ fontWeight: 800, fontSize: 18 }} data-testid="piece-level">
              {r.memorised ? 'Memorised' : r.concertReady ? 'Concert-ready' : r.rehearsalReady ? 'Rehearsal-ready'
                : P > 0 ? `Piece level ${P}: ${levelSpec(P).name}` : open ? openText : multi ? 'Not sung through yet' : `${sections.length} section to learn`}
            </span>
          </div>
          <span className="mono" style={{ fontSize: 28, fontWeight: 600 }}>{Math.round(r.pct * 100)}%</span>
        </div>
        <div className="bar"><span style={{ width: `${r.pct * 100}%` }} /></div>
        {multi && r.clean.length > 0 && (
          <span className="small" data-testid="clean-stars" style={{ color: 'var(--voice)' }}>
            <span aria-hidden="true">★ </span>Clean run{r.clean.length > 1 ? 's' : ''} at level {r.clean.join(', ')}: every section right in one go
          </span>
        )}
        {multi && r.unconfirmed > 0 && !r.toFix.length && (
          <div className="notice info small" data-testid="confirm-note">
            <strong>Level {r.unconfirmed} in every section.</strong> Confirm it with a full run-through: the piece's level comes from singing it all through.
          </div>
        )}
        {open && P > 0 && (
          <span className="small" data-testid="level-open" style={{ color: 'var(--accent-text)' }}>{openText}</span>
        )}
        {multi && r.toward && !r.unconfirmed && !open && (
          <div className="col" style={{ gap: 4 }} data-testid="toward-next">
            <span className="small muted">
              Toward piece level {r.toward.level}: {r.toward.done} of {r.toward.total} sections at level {r.toward.level}
              {r.offBookDays > 0 ? ` · whole piece from memory: day ${r.offBookDays} of ${OFF_BOOK_DAYS}` : ''}
            </span>
            <div className="bar" style={{ height: 5 }}><span style={{ width: `${(r.toward.done / r.toward.total) * 100}%`, background: 'var(--voice-deep)' }} /></div>
          </div>
        )}
        <span className="small muted">
          {multi
            ? <>The piece's level: sing the whole piece through at a level, then fix any section that slipped on its own. Rehearsal-ready = 3, concert-ready = 4, memorised = 5 (off book) on two different days.</>
            : <>Rehearsal-ready = level 3 (Independent). Concert-ready = level 4. Memorised = level 5 (off book) on two different days.</>}
        </span>
        {next && (
          <button className="btn primary block" data-testid="piece-next" onClick={() => play(next.sectionId, next.level)}>
            <IconPlay size={18} /> {next.sectionId === 'all' ? 'Sing it all' : next.kind === 'fix' ? `Fix ${label(next.sectionId)}` : label(next.sectionId)}: level {next.level}
          </button>
        )}
        {next && !(next.kind === 'full' && r.unconfirmed > 0) && <span className="tiny muted" style={{ marginTop: -6 }}>{next.reason}</span>}
        <button className="btn ghost small" onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp}>
          {showHelp ? 'Hide how the levels work' : 'How the levels work'}
        </button>
        {showHelp && (
          <div className="col" style={{ gap: 8 }}>
            {multi && (
              <span className="small muted" data-testid="levels-help-piece">
                <strong>The whole piece:</strong> sing it all through at a level, in one go. Sections that slip are to fix on
                their own: once each passes, the piece reaches the level, with no need to sing it all again. More than half
                slipped, or the run more than 10 points under the level's mark: that run is practice. Every section right first time: a clean-run ★.
              </span>
            )}
            {LEVELS.map((l) => (
              <div key={l.level} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="lvl-btn" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{l.level}</span>
                <div className="col" style={{ gap: 2 }}>
                  <strong>{l.name}</strong>
                  <span className="small muted">{l.description}</span>
                  <span className="tiny muted mono">
                    {Math.round(l.rate * 100)}% tempo · {l.guide ? 'your part plays' : 'others only'} · {l.showNames ? 'note names' : 'lyrics only'}{l.doo ? ' · on “doo”' : ''} · ±{l.tolerance}¢ · pass: {passLabel(l)}{l.headphones ? ', headphones on' : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {part && multi && (
        <div className="card" data-testid="full-run-card" style={{ borderColor: 'var(--accent-soft)' }}>
          <div className="col" style={{ gap: 2 }}>
            <strong>Sing it all</strong>
            <span className="small muted">
              The whole piece in one go, every section scored. Sections that slip are to fix on their own: once
              they pass, the piece reaches the level. Every section right first time earns a clean-run ★.
              Know it already? Go straight to any level: you don't have to do the sections first.
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 5 }}>
            {LEVELS.map((L) => {
              const l = L.level;
              const fixes = r.toFix.find((f) => f.level === l)?.sectionIds ?? [];
              const star = r.clean.includes(l);
              // The suggested run: the level every section has reached, else the next piece level.
              const cls = l <= P ? 'lvl-btn done' : l === (r.unconfirmed || P + 1) && !fixes.length ? 'lvl-btn next' : 'lvl-btn';
              return (
                <button key={l} className={cls} data-testid={`full-${l}`} style={{ position: 'relative' }}
                  aria-label={`Sing it all at level ${l} ${L.name}${l <= P ? ' (passed)' : ''}${star ? ' (clean run)' : ''}${fixes.length ? ` (${fixes.length} section${fixes.length > 1 ? 's' : ''} to fix)` : ''}`}
                  onClick={() => play('all', l)}>
                  {l} <span style={{ fontWeight: 600, fontSize: 11 }}>{SHORT[l]}</span>
                  {star && <span aria-hidden="true" data-testid={`star-${l}`} style={{ position: 'absolute', top: 1, right: 4, fontSize: 12, color: '#FFD166' }}>★</span>}
                </button>
              );
            })}
          </div>
          {r.toFix.map((f) => (
            <div key={f.level} className="col" style={{ gap: 6 }} data-testid="to-fix">
              <span className="small" style={{ color: 'var(--accent-text)' }}>
                <strong>To fix at level {f.level}</strong> ({levelSpec(f.level).everyNote ? 'not every note was right in your full run' : `${f.sectionIds.length > 1 ? 'they' : 'it'} slipped in your full run`}).{' '}
                {f.level > P
                  ? <>Pass {f.sectionIds.length > 1 ? 'each' : 'it'} on its own and {f.level === 5 ? 'the whole piece counts as sung from memory today (memorised = on two different days)' : `the piece reaches level ${f.level}`}. No need to sing it all again:</>
                  : <>Practise {f.sectionIds.length > 1 ? 'each' : 'it'} at level {f.level} on its own:</>}
              </span>
              <div className="row wrap" style={{ gap: 6 }}>
                {f.sectionIds.map((id) => (
                  <button key={id} className="btn small" onClick={() => play(id, f.level)}><IconPlay size={14} color="currentColor" /> {label(id)}</button>
                ))}
              </div>
            </div>
          ))}
          {P === 4 && r.offBookDays > 0 && !r.toFix.length && (
            <span className="tiny muted">Whole piece from memory: day {r.offBookDays} of {OFF_BOOK_DAYS}. Sing it all at level 5 again on another day.</span>
          )}
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn small ghost" onClick={() => play('all', Math.max(2, Math.min(4, P || 3)), '3d')}><IconCube size={16} color="#B3A6FF" /> Arcade run</button>
            <span className="tiny muted" style={{ alignSelf: 'center' }}>just for fun: doesn't count for a level</span>
          </div>
        </div>
      )}

      {part && sections.length > 0 && (
        <details className="card" open>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Your map of the piece</summary>
          <PieceMap score={piece.score} part={part} sections={sections} bars={getBars(piece.id, part.id)}
            onLoop={(m) => {
              const ms = piece.score.measures;
              const sec = sections.find((s) => m >= s.startMeasure && m <= s.endMeasure);
              const lvl = Math.max(1, Math.min(2, sec ? prog?.sections[sec.id]?.level ?? 1 : 1));
              const a = ms[Math.max(sec?.startMeasure ?? 0, m - 1)];
              const b = ms[Math.min(sec?.endMeasure ?? ms.length - 1, m + 1)];
              go({ name: 'play', pieceId: piece.id, partId: part.id, sectionId: 'drill', level: lvl, mode: '2d', from: a.start, to: b.start + b.dur });
            }} />
        </details>
      )}

      </div>

      <div className="lay piece-main">
      <section className="ladder" aria-label="Sections" id="piece-sections" style={{ scrollMarginTop: 12 }}>
        <h2 style={{ marginBottom: 0 }}>Sections</h2>
        {multi && <span className="tiny muted" style={{ marginBottom: 4 }}>Practice steps: take the piece apart, then put it together in a full run.</span>}
        {sections.map((s) => {
          const sp = prog?.sections[s.id];
          const lvl = sp?.level ?? 0;
          const status = sectionStatus(sp);
          const isDue = due.includes(s.id);
          return (
            <div key={s.id} className="ladder-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="row">
                <div className="col grow" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 700 }}>{s.label}</span>
                  {snippet(part!, s.start, s.end) && <span className="small ellipsis" style={{ color: 'var(--accent-text)', fontStyle: 'italic' }}>“{snippet(part!, s.start, s.end)}…”</span>}
                  <span className="tiny muted">
                    {fixAt.has(s.id) ? <strong style={{ color: 'var(--accent-text)' }} data-testid="section-to-fix">To fix at level {fixAt.get(s.id)} · </strong> : null}
                    {isDue ? 'Due for review' : status === 'new' ? (fixAt.has(s.id) ? 'not passed on its own yet' : 'Not started') : `Level ${lvl}${sp?.best?.[lvl] != null ? ` · best ${Math.round(sp.best[lvl] * 100)}%` : ''}`}
                    {lvl === 4 && sp?.offBookDays?.length ? ` · from memory: day ${sp.offBookDays.length} of ${OFF_BOOK_DAYS}` : ''}
                  </span>
                </div>
                <button className="icon-btn" aria-label={`Listen to ${s.label}`} title="Listen" onClick={() => play(s.id, 0)}><IconEar size={20} /></button>
                <button className="icon-btn" aria-label={`Arcade mode for ${s.label}${lvl < 2 ? ' (unlocks at level 2)' : ''}`}
                  disabled={lvl < 2} onClick={() => play(s.id, Math.max(2, Math.min(4, lvl)), '3d')}
                  title={lvl < 2 ? 'Arcade unlocks at level 2' : 'Arcade mode'}>
                  <IconCube size={20} color={lvl >= 2 ? '#B3A6FF' : undefined} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 5 }}>
                {LEVELS.map((L) => {
                  const l = L.level;
                  const cls = l <= lvl ? 'lvl-btn done' : l === lvl + 1 ? 'lvl-btn next' : 'lvl-btn';
                  return (
                    <button key={l} className={cls} aria-label={`${s.label}, level ${l} ${L.name}${l <= lvl ? ' (passed)' : ''}`} onClick={() => play(s.id, l)}>
                      {l} <span style={{ fontWeight: 600, fontSize: 11 }}>{SHORT[l]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!sections.length && <span className="muted">This part has no notes.</span>}
      </section>

      {part && part.notes.length > 0 && (
        <div className="card flat">
          <strong>Entry drill</strong>
          <span className="small muted">
            Hear two beats of the other voices, then come in on your own, with no starting note.
            {` ${entryCount(part)} ${entryCount(part) === 1 ? 'entry' : 'entries'} from this piece.`}
          </span>
          <div className="row wrap">
            <button className="btn small" onClick={() => {
              const ep = entryPiece(piece, part.id);
              if (!ep) return;
              registerVirtual(ep);
              go({ name: 'play', pieceId: ep.id, partId: part.id, sectionId: 'entries', level: 3, mode: '2d' });
            }}>Practise entries</button>
          </div>
        </div>
      )}

      {part && sections.some((s) => part.notes.some((n) => n.lyric && n.start >= s.start - 1e-6 && n.start < s.end - 1e-6)) && (() => {
        const wp = getWords(piece.id, part.id);
        return (
          <div className="card flat" data-testid="words-card">
            <strong>The words</strong>
            <span className="small muted">
              Learn the text on its own: speak it in rhythm with the music (pitch doesn't matter), first reading along, then from first letters, then from memory.
              Or take the quiz, no singing needed.
            </span>
            <div className="col" style={{ gap: 6 }}>
              {sections.filter((s) => part.notes.some((n) => n.lyric && n.start >= s.start - 1e-6 && n.start < s.end - 1e-6)).map((s) => {
                const passed = wp[s.id]?.passed ?? -1;
                return (
                  <div key={s.id} className="row" style={{ gap: 8 }}>
                    <span className="grow small ellipsis">{s.label}</span>
                    <span className="tiny muted" title={passed >= 0 ? `${STAGE_NAMES[passed]} done` : 'not started'}>
                      {[0, 1, 2].map((k) => (k <= passed ? '●' : '○')).join(' ')}
                    </span>
                    <button className="btn small" onClick={() => go({ name: 'play', pieceId: piece.id, partId: part.id, sectionId: s.id, level: 0, mode: '2d', words: true })}>
                      {passed >= 2 ? 'Again' : STAGE_NAMES[Math.min(2, passed + 1)]}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="row wrap">
              <button className="btn small" onClick={() => go({ name: 'lyrics', pieceId: piece.id, partId: part.id })}>Lyrics quiz</button>
            </div>
          </div>
        );
      })()}

      {part && part.notes.length > 0 && (
        <div className="card flat">
          <strong>Learning it by heart</strong>
          <span className="small muted">
            Cold start: you're dropped into a random bar (bars you don't know yet come up more often), hear two bars of the
            other voices, and carry on from memory. The best practice for finding your place again after a slip.
            The memory map is a one-page outline of your entries, cues and solos to read (or print) before sleeping.
          </span>
          <div className="row wrap">
            <button className="btn small" data-testid="cold-start" onClick={() => startColdStart(piece, part.id)}>Cold start</button>
            <button className="btn small" onClick={() => go({ name: 'memorymap', pieceId: piece.id, partId: part.id })}>Memory map</button>
          </div>
        </div>
      )}

      {vocalParts.length > 0 && <KeyMarksCard piece={piece} />}

      {piece.credit && <span className="tiny muted">{piece.credit}</span>}
      </div>
      </div>
    </main>
  );
}
