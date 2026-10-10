import React, { useEffect, useRef, useState } from 'react';
import { getPiece, singableSections, chosenPartId, rememberPart, registerVirtual, renameImported } from '../library';
import { entryPiece } from '../generated';
import { entryNotes } from '../../game/drills';
import { useProfile, useStoreVersion } from '../hooks';
import { go, back, type Route } from '../router';
import { backTab } from '../nav';
import { getProgress, dueForReview, loadCycle } from '../../progress/store';
import {
  LEVELS, OFF_BOOK_DAYS, pieceReadiness, nextStep, levelLabel, stepFor, stepLabel, stepSpec, stepWord, type Step, type NextStep,
} from '../../progress/ladder';
import { IconBack, IconChevron, IconChevronDown, IconCube, IconPlay } from '../icons';
import { voiceName } from './Home';
import { PieceMap } from '../components/PieceMap';
import { getBars, troubleSpots } from '../../progress/bars';
import { getNoteStats } from '../../progress/notestats';
import { startColdStart } from '../play/cold';
import { getWords, wordsDoneFor } from '../../progress/words';
import { STAGE_NAMES } from '../../game/textrhythm';
import { NotFound } from '../components/NotFound';
import { KeyMarksCard } from '../components/KeyMarks';
import { LevelMeter } from '../components/LevelMeter';
import { PassageSheet, bestAtStep, type SheetActions } from '../components/PassageSheet';
import { joinLabels, meterNodes, nextLabel, nextReason, passageStatus, pathStatus, troubleNote, troubleWords } from '../path';
import { nextRehearsal } from '../../progress/rehearsal';
import { formatDate } from '../hooks';
import { slowRate } from '../../progress/struggle';
import { toleranceWords } from '../../game/pitchwords';
import { passRule } from '../play/prerun';
import type { Part, Section } from '../../music/types';
import type { PieceInfo } from '../library';

/** First few words of the lyric in a section, to recognise the phrase. */
function snippet(part: { notes: { start: number; lyric?: string; syllabic?: string }[] }, from: number, to: number, max = 26): string {
  let out = '';
  let open = false;
  for (const n of part.notes) {
    if (n.start < from - 1e-6 || n.start >= to - 1e-6 || !n.lyric) continue;
    const cont = open && (n.syllabic === 'middle' || n.syllabic === 'end');
    out += (cont || !out ? '' : ' ') + n.lyric;
    open = n.syllabic === 'begin' || n.syllabic === 'middle';
    if (out.length > max && !open) break;
  }
  return out.trim();
}

function entryCount(part: Parameters<typeof entryNotes>[0]): number {
  const idx = entryNotes(part, 0.6);
  return Math.min(10, idx.includes(0) || !part.notes.length ? idx.length : idx.length + 1);
}

const SHORT: Record<number, string> = { 1: 'Notes', 2: 'Words', 3: 'Alone', 4: 'Concert', 5: 'By heart' };

/** "slow 70% · in tempo: 80%, entries on time" style line for the levels help. */
function stepsLine(level: number): string {
  const sl = stepSpec(level, 'slow');
  const tp = stepSpec(level, 'tempo');
  const one = (x: typeof sl) => `${Math.round(x.rate * 100)}%, a note may be ${toleranceWords(x.tolerance)} off, ${passRule(x).replace(/\.$/, '').toLowerCase()}${x.headphones ? ', headphones on' : ''}`;
  return `slow ${one(sl)} · in tempo ${one(tp)}`;
}

/** The trouble bar of a stretch: the note gone wrong most lately (note history), else the weakest bar. */
function troubleBar(piece: PieceInfo, part: Part, from: number, to: number): { measure: number; why: string | null } | null {
  const t = troubleNote(part, from, to, getNoteStats(piece.id, part.id));
  const num = (m: number) => piece.score.measures[m]?.number ?? String(m + 1);
  if (t) return { measure: t.measure, why: troubleWords(t.kind, num(t.measure)) };
  const ms = piece.score.measures.filter((m) => m.start >= from - 1e-6 && m.start < to - 1e-6).map((m) => m.index);
  const spots = troubleSpots(getBars(piece.id, part.id), ms, 1);
  return spots.length ? { measure: spots[0][0], why: null } : null;
}

export function PieceScreen({ pieceId }: { pieceId: string }) {
  const [profile] = useProfile();
  useStoreVersion();
  const piece = getPiece(pieceId);
  const [partId, setPartId] = useState(() => (piece ? chosenPartId(piece, profile.voice) : ''));
  const [showHelp, setShowHelp] = useState(false);
  const [editing, setEditing] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const [draft, setDraft] = useState({ title: piece?.title ?? '', composer: piece?.composer ?? '' });
  const [sheetId, setSheetId] = useState<string | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);

  // A sheet's history entry left over from before a reload (the sheet is closed now): step down onto
  // the piece's own entry, so back doesn't land on the same page again.
  useEffect(() => {
    try {
      const st = history.state as { pieceSheet?: boolean } | null;
      if (st?.pieceSheet) {
        history.replaceState({ ...st, pieceSheet: undefined }, '', location.href);
        if (history.length > 1) history.back();
      }
    } catch { /* ignore */ }
  }, []);
  // The passage sheet is a history entry: back closes it (and a run started from it leaves it first,
  // so back from the run lands on the piece, not on a closed sheet).
  useEffect(() => {
    if (sheetId == null) return;
    const onPop = () => {
      setSheetId(null);
      const then = pendingRef.current;
      pendingRef.current = null;
      then?.();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [sheetId]);
  const openSheet = (id: string) => {
    try { history.pushState({ ...((history.state as object | null) ?? {}), pieceSheet: true }, ''); } catch { /* ignore */ }
    setSheetId(id);
  };
  const closeSheet = (then?: () => void) => {
    let viaHistory = false;
    try { viaHistory = !!(history.state as { pieceSheet?: boolean } | null)?.pieceSheet; } catch { /* ignore */ }
    if (viaHistory) {
      pendingRef.current = then ?? null;
      history.back();
    } else {
      setSheetId(null);
      then?.();
    }
  };

  if (!piece) return <NotFound pieceId={pieceId} what="piece" />;
  const vocalParts = piece.score.parts.filter((p) => p.notes.length > 0);
  const part = piece.score.parts.find((p) => p.id === partId) ?? vocalParts[0];
  const sections = part ? singableSections(piece, part.id) : [];
  const prog = part ? getProgress(piece.id, part.id) : undefined;
  const r = pieceReadiness(sections, prog);
  const next = nextStep(sections, prog, Date.now(), part ? wordsDoneFor(piece.id, part.id, part, sections) : undefined);
  const due = part ? dueForReview(piece.id, part.id, sections) : [];
  const path = pathStatus(sections, prog);
  const multi = sections.length > 1;
  const P = r.pieceLevel;

  const pick = (id: string) => { setPartId(id); rememberPart(piece.id, id); setPartsOpen(false); };
  // (no step: the passage's current step for that level, see Play)
  const playRoute = (sectionId: string, level: number, mode: '2d' | '3d' = '2d', step?: Step): Route =>
    ({ name: 'play', pieceId: piece.id, partId: part!.id, sectionId, level, mode, ...(step && mode === '2d' ? { step } : {}) });
  const play = (sectionId: string, level: number, mode: '2d' | '3d' = '2d', step?: Step) => go(playRoute(sectionId, level, mode, step));
  const label = (id: string) => sections.find((s) => s.id === id)?.label ?? id;
  // Sections that slipped in a full run, by section: the lowest level they must pass at.
  const fixAt = new Map<string, number>();
  for (const f of [...r.toFix].reverse()) for (const id of f.sectionIds) fixAt.set(id, f.level);

  // The piece's meter: its level in tempo, a half node once every passage has passed the working
  // level's slow step, the ring on the level being worked on.
  const pieceNodes = meterNodes({ level: path.filled, slow: path.half && path.working ? path.working.level : 0, now: path.working });

  // The goal line: what rehearsal- / concert-ready means, and the next rehearsal's focus.
  const cycle = loadCycle();
  const inCycle = cycle.pieceIds.includes(piece.id);
  const nr = inCycle ? nextRehearsal(cycle) : null;
  const goalBits: string[] = [];
  if (inCycle && nr && nr.days >= 0 && P < 3) goalBits.push('Rehearsal-ready = Level 3 in tempo.');
  else if (inCycle && cycle.concertDate && P < 4) goalBits.push(`Concert-ready = Level 4 in tempo, by ${formatDate(cycle.concertDate)}.`);
  if (nr && nr.days >= 0 && (cycle.focusPieceIds ?? []).includes(piece.id)) {
    goalBits.push(`${nr.days === 0 ? 'Tonight' : nr.days === 1 ? 'Tomorrow' : `On ${nr.at.toLocaleDateString(undefined, { weekday: 'long' })}`} the choir works on this piece.`);
  }

  // The primary button: what nextStep says, with its reason (and a passage's trouble bar).
  const nextSec = next && next.sectionId !== 'all' ? sections.find((s) => s.id === next.sectionId) : undefined;
  const nextTrouble = nextSec && part ? troubleBar(piece, part, nextSec.start, nextSec.end) : null;
  const reason = next ? [nextReason(next, label).replace(/\.$/, ''), nextTrouble?.why].filter(Boolean).join(' · ') : '';
  const lyricOf = (s: Section, max?: number) => (part ? snippet(part, s.start, s.end, max) : '');

  const sheetSec = sheetId ? sections.find((s) => s.id === sheetId) : undefined;
  const sheetActions = (s: Section): SheetActions => {
    const sp = prog?.sections[s.id];
    const cur = sp && sp.level >= 5 ? { level: 5, step: 'tempo' as Step } : { level: Math.min(5, (sp?.level ?? 0) + 1), step: stepFor(sp, Math.min(5, (sp?.level ?? 0) + 1)) };
    const t = part ? troubleBar(piece, part, s.start, s.end) : null;
    const hasWords = !!part?.notes.some((n) => n.lyric && n.start >= s.start - 1e-6 && n.start < s.end - 1e-6);
    const ms = piece.score.measures;
    return {
      sing: (level, step, mode = '2d') => closeSheet(() => play(s.id, level, mode, step)),
      listen: () => closeSheet(() => go({ ...playRoute(s.id, 0), after: cur.level, step: cur.step } as Route)),
      ...(hasWords ? { words: () => closeSheet(() => go({ name: 'play', pieceId: piece.id, partId: part!.id, sectionId: s.id, level: 0, mode: '2d', words: true })) } : {}),
      ...(t && ms[t.measure] ? {
        loop: {
          label: `Loop bar ${ms[t.measure].number} at ${Math.round(slowRate('slow') * 100)}%`,
          go: () => closeSheet(() => go({
            name: 'play', pieceId: piece.id, partId: part!.id, sectionId: 'drill', level: cur.level, step: cur.step, mode: '2d',
            from: ms[t.measure].start, to: ms[t.measure].start + ms[t.measure].dur, rate: slowRate('slow'), back: { sectionId: s.id, level: cur.level, step: cur.step },
          })),
        },
      } : {}),
    };
  };

  return (
    <main className="screen wide piece-screen">
      <div className="piece-head">
        <button className="icon-btn filled" aria-label="Back" onClick={() => back(backTab('piece'))}><IconBack /></button>
        <div className="grow col" style={{ gap: 2 }}>
          <h1>{piece.title}</h1>
          <span className="t14 muted">
            {[piece.composer, part?.name].filter(Boolean).join(' · ')}
            {vocalParts.length > 1 && <> · <button className="link inline" aria-expanded={partsOpen} data-testid="part-change"
              aria-label={`Change part (now ${part?.name ?? ''})`} onClick={() => setPartsOpen(!partsOpen)}>change</button></>}
          </span>
        </div>
      </div>

      {partsOpen && (
        <div className="card part-pick" data-testid="part-picker">
          <strong className="t16">Your part</strong>
          <div className="chips" role="group" aria-label="Part">
            {vocalParts.map((p) => (
              <button key={p.id} className="chip" aria-pressed={p.id === part?.id} onClick={() => pick(p.id)}>{p.name}</button>
            ))}
          </div>
        </div>
      )}
      {part && part.voiceType !== profile.voice && part.voiceType !== 'other' && (
        <span className="t14 muted">You're set up as {voiceName(profile.voice)}; this is the {part.name} part.</span>
      )}

      {/* Wide screens: your path and the next step on one side, the passages and more on the other. */}
      <div className="lay piece-cols">
      <div className="lay piece-side">
      <section className="card path-card" data-testid="path-card" aria-label="Your path">
        <h2 className="h3">Your path</h2>
        <LevelMeter size="lg" nodes={pieceNodes} label="Your path" />
        <p className="here" data-testid="piece-level">
          {!path.working ? <>Memorised ✓ · {path.here}</> : path.here.startsWith('From memory') ? path.here : <>You're here: {path.here}</>}
        </p>
        {goalBits.length > 0 && <p className="t14 muted" data-testid="goal-line">{goalBits.join(' ')}</p>}
        {multi && r.clean.length > 0 && (
          <span className="t14" data-testid="clean-stars" style={{ color: 'var(--voice)' }}>
            <span aria-hidden="true">★ </span>Clean run{r.clean.length > 1 ? 's' : ''} at Level {r.clean.join(', ')}: every passage right in one go
          </span>
        )}
        {multi && P === 4 && r.offBookDays > 0 && !r.toFix.length && !path.here.startsWith('From memory') && (
          <span className="t14 muted">Whole piece from memory: day {r.offBookDays} of {OFF_BOOK_DAYS}. Sing it all at Level 5 again on another day.</span>
        )}
        {next && part && (
          <>
            <div className="divider" />
            <NowBlock next={next} sections={sections} path={path} label={label} reason={reason} pieceLevel={P}
              best={(id, l, st) => bestAtStep(piece.id, part.id, id, prog?.sections[id], l, st)}
              onPlay={() => play(next.sectionId, next.level, '2d', next.step)}
              onTempo={() => play(next.sectionId, next.level, '2d', 'tempo')}
              onWords={() => go({ name: 'play', pieceId: piece.id, partId: part.id, sectionId: next.sectionId, level: 0, mode: '2d', words: true })} />
          </>
        )}
        {!next && sections.length > 0 && (path.waitDay
          ? <span className="t14 muted" data-testid="come-back">Come back tomorrow for day 2: sing it {multi ? 'all ' : ''}from memory once more and it is memorised.</span>
          : <span className="t14 muted">Every level done. Sing it all through once a week to keep it fresh.</span>)}
      </section>
      </div>

      <div className="lay piece-main">
      <section className="passages col" aria-label="Passages" id="piece-sections" style={{ gap: 4, scrollMarginTop: 12 }}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>Passages</h2>
          {sections.length > 0 && <span className="t14 muted">Tap one for its levels</span>}
        </div>
        <div className="plist">
          {sections.map((s) => {
            const sp = prog?.sections[s.id];
            const st = passageStatus(sp);
            const fix = fixAt.get(s.id);
            const isDue = due.includes(s.id);
            const ly = lyricOf(s);
            const memDay = (sp?.level ?? 0) === 4 ? sp?.offBookDays?.length ?? 0 : 0;
            const status = fix ? `To fix · Level ${fix} in tempo` : isDue ? `Review due · ${st.text}` : memDay ? `From memory: day ${memDay} of ${OFF_BOOK_DAYS}` : st.text;
            const nodes = meterNodes({ level: sp?.level ?? 0, slow: sp?.slow, now: next && next.sectionId === s.id ? { level: next.level } : null });
            return (
              <button key={s.id} className="prow" data-testid="passage-row" onClick={() => openSheet(s.id)}
                aria-label={`${s.label}: ${status}. Open its levels`}>
                <div className="grow col" style={{ gap: 3, minWidth: 0 }}>
                  <strong className="t16">{s.label}</strong>
                  {ly && <span className="lyr">“{ly}…”</span>}
                </div>
                <div className="pstat">
                  <LevelMeter nodes={nodes} label={s.label} />
                  <span className="t14" data-testid={fix ? 'section-to-fix' : 'passage-status'}
                    style={{ color: st.done && !fix && !isDue ? 'var(--good)' : 'var(--muted)' }}>
                    {status}
                  </span>
                </div>
                <span className="chev"><IconChevron size={18} /></span>
              </button>
            );
          })}
          {!sections.length && <span className="muted">This part has no notes.</span>}
        </div>
      </section>

      {part && (
        <MoreWays piece={piece} part={part} sections={sections} prog={prog} r={r} P={P} label={label} play={play}
          showHelp={showHelp} setShowHelp={setShowHelp}
          rename={!piece.builtin && !piece.id.includes('~') ? () => { setDraft({ title: piece.title, composer: piece.composer }); setEditing(!editing); } : undefined}
          editing={editing} />
      )}
      {editing && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); await renameImported(piece.id, draft.title, draft.composer); setEditing(false); }}>
          <label className="field"><span>Title</span>
            <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} />
          </label>
          <label className="field"><span>Composer</span>
            <input type="text" value={draft.composer} onChange={(e) => setDraft({ ...draft, composer: e.target.value })} maxLength={80} />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn voice grow" type="submit">Save</button>
            <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}

      {piece.credit && <span className="tiny muted">{piece.credit}</span>}
      </div>
      </div>

      {sheetSec && part && (
        <PassageSheet pieceId={piece.id} partId={part.id} part={part} section={sheetSec} lyric={lyricOf(sheetSec, 60)}
          sp={prog?.sections[sheetSec.id]} onClose={() => closeSheet()} actions={sheetActions(sheetSec)} />
      )}
    </main>
  );
}

/** "Now · Level 1 · Notes · slow": the step being worked on, its passages, and the one next step. */
function NowBlock({ next, sections, path, label, reason, pieceLevel, best, onPlay, onTempo, onWords }: {
  next: NextStep; sections: Section[]; path: ReturnType<typeof pathStatus>; label: (id: string) => string; reason: string; pieceLevel: number;
  best: (id: string, level: number, step: Step) => number | null;
  onPlay: () => void; onTempo: () => void; onWords: () => void;
}) {
  const full = next.sectionId === 'all';
  const eyebrow = full ? `Now · ${next.kind === 'review' ? 'Review' : 'Sing it all'} · ${levelLabel(next.level)}`
    : next.kind === 'fix' ? `Now · Fix · ${levelLabel(next.level)} · in tempo`
      : next.kind === 'review' ? `Now · Review · ${levelLabel(next.level)}`
        : `Now · ${stepLabel(next.level, next.step)}`;
  const intro = full
    ? 'The whole piece in one go, in tempo. Passages that slip are yours to fix on their own; then the level is the piece’s.'
    : next.kind === 'fix' ? (next.level > pieceLevel
      ? `It slipped in your run-through. Pass it in tempo on its own and the piece gets closer to ${levelLabel(next.level)}.`
      : `It slipped in your run-through. Pass it in tempo on its own: the piece keeps ${levelLabel(pieceLevel)} either way.`)
      : next.kind === 'review' ? 'Keep it fresh: sing it once more at the level it has.'
        : 'One new thing at a time: first slow, then in tempo. Passing in tempo also ticks slow.';
  // The checklist: the passages at the step being worked on (the next one highlighted).
  const w = path.working;
  const onStep = !full && w && next.level === w.level && (next.kind === 'fix' || (next.kind === 'section' && next.step === w.step));
  const done = onStep && next.kind !== 'fix' ? path.done : [];
  const todo = onStep ? (next.kind === 'fix' ? path.fixes : path.todo) : [];
  const others = todo.filter((id) => id !== next.sectionId);
  const shownOthers = others.slice(0, 3);
  const nextSec = sections.find((s) => s.id === next.sectionId);
  const b = nextSec ? best(nextSec.id, next.level, next.step) : null;
  return (
    <div className="col" style={{ gap: 10 }} data-testid="now-card">
      <span className="eb now" data-testid="now-eyebrow">{eyebrow}</span>
      <p className="t14 muted">{intro}</p>
      {onStep && sections.length > 1 && (
        <div className="checklist" data-testid="now-checklist">
          {done.length > 0 && (
            <div className="li">
              <span className="check done" aria-hidden="true">✓</span>
              <span className="grow t16">{joinLabels(done.map(label))}</span>
              <span className="t14 good-text">{stepWord(w!.step)} ✓</span>
            </div>
          )}
          {nextSec && todo.includes(nextSec.id) && (
            <div className="li now-row">
              <span className="check now" aria-hidden="true">{nextSec.index + 1}</span>
              <strong className="grow t16">{nextSec.label}</strong>
              {b != null && <span className="t14 muted">best {Math.round(b * 100)}%</span>}
            </div>
          )}
          {shownOthers.map((id) => {
            const s = sections.find((x) => x.id === id)!;
            return (
              <div key={id} className="li">
                <span className="check" aria-hidden="true">{s.index + 1}</span>
                <span className="grow t16">{s.label}</span>
              </div>
            );
          })}
          {others.length > shownOthers.length && <span className="t14 muted" style={{ paddingTop: 4 }}>and {others.length - shownOthers.length} more</span>}
        </div>
      )}
      <button className="btn primary block two" data-testid="piece-next" onClick={onPlay}>
        <span><IconPlay size={16} /> {nextLabel(next, label)}</span>
        {reason && <span className="sub" data-testid="piece-next-why">{reason}</span>}
      </button>
      {next.wordsFirst && <button className="link" data-testid="words-first" onClick={onWords}>Say it in rhythm first</button>}
      {!full && next.kind === 'section' && next.step === 'slow' && (
        <button className="link" data-testid="try-tempo" onClick={onTempo}>Know it already? Try it in tempo ›</button>
      )}
    </div>
  );
}

/** Everything else the piece offers, folded into one row. */
function MoreWays({ piece, part, sections, prog, r, P, label, play, showHelp, setShowHelp, rename, editing }: {
  piece: PieceInfo; part: Part; sections: Section[]; prog: ReturnType<typeof getProgress>; r: ReturnType<typeof pieceReadiness>; P: number;
  label: (id: string) => string; play: (sectionId: string, level: number, mode?: '2d' | '3d', step?: Step) => void;
  showHelp: boolean; setShowHelp: (v: boolean) => void; rename?: () => void; editing: boolean;
}) {
  const multi = sections.length > 1;
  const hasNotes = part.notes.length > 0;
  const lyricSecs = sections.filter((s) => part.notes.some((n) => n.lyric && n.start >= s.start - 1e-6 && n.start < s.end - 1e-6));
  const items: string[] = ['Listen to all parts'];
  if (multi) items.push('sing it all');
  if (hasNotes) items.push('entries');
  if (lyricSecs.length) items.push('say it in rhythm', 'lyrics quiz');
  if (hasNotes) items.push('cold start', 'memory map');
  if (sections.length) items.push('piece map');
  items.push('key marks', 'how the levels work');
  const wp = lyricSecs.length ? getWords(piece.id, part.id) : {};
  return (
    <details className="card more" data-testid="more-ways">
      <summary>
        <span className="grow col" style={{ gap: 2 }}>
          <strong className="t16">More ways to practise ({items.length})</strong>
          <span className="t14 muted">{items.join(' · ')}</span>
        </span>
        <span className="chev"><IconChevronDown size={20} /></span>
      </summary>
      <div className="more-body">
        <div className="more-item">
          <strong>Listen to all parts</strong>
          <span className="t14 muted">The whole piece once, every voice playing. Not scored.</span>
          <div className="row wrap"><button className="btn small" data-testid="listen-all" onClick={() => play('all', 0)}>Listen to the whole piece</button></div>
        </div>

        {multi && (
          <div className="more-item" data-testid="full-run-card">
            <strong>Sing it all</strong>
            <span className="t14 muted">
              The whole piece in one go, in tempo, every passage scored. Passages that slip are yours to fix on their own: once
              they pass, the piece reaches the level. Every passage right first time earns a clean-run ★.
              Know it already? Go straight to any level: you don't have to do the passages first.
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 5 }}>
              {LEVELS.map((L) => {
                const l = L.level;
                const fixes = r.toFix.find((f) => f.level === l)?.sectionIds ?? [];
                const star = r.clean.includes(l);
                const cls = l <= P ? 'lvl-btn done' : 'lvl-btn';
                return (
                  <button key={l} className={cls} data-testid={`full-${l}`} style={{ position: 'relative' }}
                    aria-label={`Sing it all at ${stepLabel(l, 'tempo')}${l <= P ? ' (passed)' : ''}${star ? ' (clean run)' : ''}${fixes.length ? ` (${fixes.length} passage${fixes.length > 1 ? 's' : ''} to fix)` : ''}`}
                    onClick={() => play('all', l, '2d', 'tempo')}>
                    {l} <span style={{ fontWeight: 600, fontSize: 11 }}>{SHORT[l]}</span>
                    {star && <span aria-hidden="true" data-testid={`star-${l}`} style={{ position: 'absolute', top: 1, right: 4, fontSize: 12, color: '#FFD166' }}>★</span>}
                  </button>
                );
              })}
            </div>
            {r.toFix.map((f) => (
              <div key={f.level} className="col" style={{ gap: 6 }} data-testid="to-fix">
                <span className="t14">
                  <strong>To fix at Level {f.level}</strong> ({f.sectionIds.length > 1 ? 'they' : 'it'} slipped in your full run).{' '}
                  {f.level > P
                    ? <>Pass {f.sectionIds.length > 1 ? 'each' : 'it'} in tempo on its own and {f.level === 5 ? 'the whole piece counts as sung from memory today (memorised = on two different days)' : `the piece reaches Level ${f.level}`}. No need to sing it all again:</>
                    : <>Practise {f.sectionIds.length > 1 ? 'each' : 'it'} at Level {f.level} in tempo on its own:</>}
                </span>
                <div className="row wrap" style={{ gap: 6 }}>
                  {f.sectionIds.map((id) => (
                    <button key={id} className="btn small" onClick={() => play(id, f.level, '2d', 'tempo')}><IconPlay size={14} color="currentColor" /> {label(id)}</button>
                  ))}
                </div>
              </div>
            ))}
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn small ghost" onClick={() => play('all', Math.max(2, Math.min(4, P || 3)), '3d')}><IconCube size={16} color="#B3A6FF" /> Arcade run</button>
              <span className="t14 muted" style={{ alignSelf: 'center' }}>just for fun: doesn't count for a level</span>
            </div>
          </div>
        )}

        {hasNotes && (
          <div className="more-item">
            <strong>Entries</strong>
            <span className="t14 muted">
              Hear two beats of the other voices, then come in on your own, with no starting note.
              {` ${entryCount(part)} ${entryCount(part) === 1 ? 'entry' : 'entries'} from this piece.`}
            </span>
            <div className="row wrap">
              <button className="btn small" data-testid="entries" onClick={() => {
                const ep = entryPiece(piece, part.id);
                if (!ep) return;
                registerVirtual(ep);
                go({ name: 'play', pieceId: ep.id, partId: part.id, sectionId: 'entries', level: 3, mode: '2d' });
              }}>Practise entries</button>
            </div>
          </div>
        )}

        {lyricSecs.length > 0 && (
          <div className="more-item" data-testid="words-card">
            <strong>The words</strong>
            <span className="t14 muted">
              Say it in rhythm: speak the text with the music (pitch doesn't matter), first reading along, then from first letters, then from memory.
              Or take the lyrics quiz, no singing needed.
            </span>
            <div className="col" style={{ gap: 6 }}>
              {lyricSecs.map((s) => {
                const passed = wp[s.id]?.passed ?? -1;
                return (
                  <div key={s.id} className="row" style={{ gap: 8 }}>
                    <span className="grow t14 ellipsis">{s.label}</span>
                    <span className="t14 muted" title={passed >= 0 ? `${STAGE_NAMES[passed]} done` : 'not started'} aria-label={passed >= 0 ? `${STAGE_NAMES[passed]} done` : 'not started'}>
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
        )}

        {hasNotes && (
          <div className="more-item">
            <strong>Learning it by heart</strong>
            <span className="t14 muted">
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

        {sections.length > 0 && (
          <div className="more-item">
            <strong>Your map of the piece</strong>
            <PieceMap score={piece.score} part={part} sections={sections} bars={getBars(piece.id, part.id)}
              onLoop={(m) => {
                const ms = piece.score.measures;
                const sec = sections.find((s) => m >= s.startMeasure && m <= s.endMeasure);
                const lvl = Math.max(1, Math.min(2, sec ? prog?.sections[sec.id]?.level ?? 1 : 1));
                const a = ms[Math.max(sec?.startMeasure ?? 0, m - 1)];
                const b = ms[Math.min(sec?.endMeasure ?? ms.length - 1, m + 1)];
                go({ name: 'play', pieceId: piece.id, partId: part.id, sectionId: 'drill', level: lvl, mode: '2d', from: a.start, to: b.start + b.dur });
              }} />
          </div>
        )}

        <div className="more-item"><KeyMarksCard piece={piece} /></div>

        <div className="more-item">
          <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp}>
            {showHelp ? 'Hide how the levels work' : 'How the levels work'}
          </button>
          {showHelp && (
            <div className="col" style={{ gap: 8 }}>
              {multi && (
                <span className="t14 muted" data-testid="levels-help-piece">
                  <strong>The whole piece:</strong> sing it all through at a level, in tempo, in one go. Passages that slip are to fix on
                  their own: once each passes, the piece reaches the level, with no need to sing it all again. More than half
                  slipped, or the run more than 10 points under the level's mark: that run is practice. Every passage right first time: a clean-run ★.
                  Rehearsal-ready = Level 3, concert-ready = Level 4, memorised = Level 5 (by heart) on two different days.
                </span>
              )}
              {LEVELS.map((l) => (
                <div key={l.level} className="row" style={{ alignItems: 'flex-start' }}>
                  <span className="check" aria-hidden="true">{l.level}</span>
                  <div className="col" style={{ gap: 2 }}>
                    <strong>{levelLabel(l.level)}</strong>
                    <span className="t14 muted">{l.description}</span>
                    <span className="t14 muted">
                      {l.guide ? 'your part plays' : 'others only'} · {l.showNames ? 'note names' : 'lyrics only'}{l.doo ? ' · on “doo”' : ''} · {stepsLine(l.level)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {rename && (
          <div className="more-item">
            <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={rename} aria-expanded={editing}>
              {editing ? 'Close renaming' : 'Rename this score'}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
