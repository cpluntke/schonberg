import React, { useState } from 'react';
import { getLastRun, shareRun } from '../play/runExport';
import { startColdStart } from '../play/cold';
import { STAGE_NAMES, WORDS_PASS, type WordsStage } from '../../game/textrhythm';
import { toast } from '../hooks';
import { getLastResult, lastRunPiece } from '../play/lastResult';
import { getPiece, singableSections } from '../library';
import { go } from '../router';
import { LEVELS, OFF_BOOK_DAYS, effectiveTolerance, fixesBefore, nextStep, wrongNotes } from '../../progress/ladder';
import { getProgress, loadProfile, saveProfile } from '../../progress/store';
import { barRangeLabel } from '../../music/sections';
import { noteFault } from '../play/noteFault';
import { IconDown, IconUp, IconClock, IconLoop, IconStar, IconPlay, IconCube } from '../icons';
import type { Insight, NoteResult } from '../../game/types';
import type { PieceInfo } from '../library';
import { accountTipPending, dismissAccountTip } from '../../progress/sync';

/** Start a run from Results; replace the history entry so "back" from the run doesn't land on stale results. */
function goPlay(r: Parameters<typeof go>[0]) {
  try { sessionStorage.setItem('sh:fromResults', '1'); } catch { /* storage blocked */ }
  go(r, true);
}

/**
 * The letter from accuracy. At an every-note level (level 1) a run with a wrong note shows at most a
 * B, so it never reads as success next to "Not yet" (qa/realism/harness.ts mirrors this).
 */
function gradeLetter(acc: number, wrongAtEveryNote = false): string {
  const l = acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : acc >= 0.5 ? 'C' : 'D';
  return wrongAtEveryNote && (l === 'S' || l === 'A') ? 'B' : l;
}

function insightIcon(i: Insight) {
  switch (i.kind) {
    case 'flat-long-notes': case 'flat-overall': return <IconDown size={20} color="#FF7A45" />;
    case 'sharp-long-notes': case 'sharp-overall': return <IconUp size={20} color="#FF7A45" />;
    case 'late-entries': case 'early-entries': case 'behind-beat': return <IconClock size={20} color="#FF7A45" />;
    case 'great': return <IconStar size={20} color="#4CC9F0" />;
    default: return <IconLoop size={20} color="#FF7A45" />;
  }
}

export function Results() {
  const lr = getLastResult();
  const piece = lr ? getPiece(lr.pieceId) : undefined;
  if (!lr || !piece) {
    // The details live only while the app is open; the progress itself was saved.
    const lastId = lr?.pieceId ?? lastRunPiece();
    const lastPiece = lastId ? getPiece(lastId) : undefined;
    return (
      <main className="screen" data-testid="no-results">
        <h1 className="hero">No results to show</h1>
        <span className="small muted">
          {lastPiece ? 'The details of your last run are gone (the app was closed or reloaded), but your progress from it was saved.'
            : 'Sing a section and your results appear here.'}
        </span>
        {lastPiece && (
          <button className="btn primary block" onClick={() => go({ name: 'piece', pieceId: lastPiece.id }, true)}>
            Open {lastPiece.title}
          </button>
        )}
        <button className={`btn block${lastPiece ? '' : ' primary'}`} onClick={() => go({ name: 'home' }, true)}>Home</button>
      </main>
    );
  }
  if (lr.words) return <WordsResults lr={lr} words={lr.words} />;
  const r = lr.result;
  const part = piece.score.parts.find((p) => p.id === lr.partId);
  const section = piece.sections.find((s) => s.id === lr.sectionId);
  const spec = LEVELS[lr.level - 1];
  const sections = singableSections(piece, lr.partId);
  const prog = getProgress(piece.id, lr.partId);
  const next = nextStep(sections, prog);
  // Practice runs (stopped, slower, paused…) don't set personal bests.
  const isPB = !lr.notCounted && lr.prevBest != null && r.score > lr.prevBest;
  const label = (id: string) => sections.find((s) => s.id === id)?.label ?? id;
  const fixedNote = lr.fixed?.[lr.fixed.length - 1];
  // Fix first only when this run's level is the one being worked toward (a slip in a run further
  // ahead is shown, but the next step stays the usual one).
  const nextFix = lr.full?.counted && !lr.full.passed ? fixesBefore(sections, prog, lr.level)[0] : undefined;
  const leveledUp = lr.ladder && lr.newLevel > lr.prevLevel;

  const sungCents = r.notes.map((n) => n.cents).filter((c): c is number => c != null && Math.abs(c) < 100).sort((a, b) => a - b);
  const avgCents = sungCents.length ? Math.round(sungCents[Math.floor(sungCents.length / 2)]) : null;
  const measureIdx = Object.keys(r.perMeasure).map(Number).sort((a, b) => a - b);
  const mnum = (i: number) => piece.score.measures[i]?.number ?? String(i + 1);
  // A pickup bar numbered 0 is "Upbeat" (as in section and wrong-note labels): "Up" in the strip.
  const cellText = (i: number) => (i === 0 && mnum(i) === '0' ? 'Up' : mnum(i));
  const cellName = (i: number) => (i === 0 && mnum(i) === '0' ? 'Upbeat' : `Bar ${mnum(i)}`);

  const playLoop = (m0: number, m1: number, level = Math.max(1, Math.min(lr.level, 2))) => {
    const ms = piece.score.measures;
    const from = ms[Math.max(0, m0)]?.start ?? lr.from;
    const last = ms[Math.min(ms.length - 1, m1)];
    const to = last ? last.start + last.dur : lr.to;
    goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'drill', level, mode: '2d', from, to });
  };

  // Level 1: every note must be right. The notes that weren't, by bar, with a loop to drill them.
  // Judged note by note (level 1). A result saved by an older version has no verdicts (it passed or
  // failed on the 75% mark): show it as it was judged then.
  const everyNote = !!spec?.everyNote && !!lr.everyNote;
  const wrong = everyNote ? wrongNotes(r) : [];
  const wrongBars = new Set(wrong.map((n) => part?.notes[n.index]?.measure));
  const tol = lr.tolerance ?? effectiveTolerance(lr.level, loadProfile().strictness);
  const letter = gradeLetter(r.accuracy, wrong.length > 0);

  // A run that failed (or didn't count) on timing isn't an "excellent run".
  // Nor is a level-1 run with a wrong note.
  // Nor a level-1 run through the speaker (practice: "move on to the next level" would be wrong).
  const speakerRun = !!lr.speaker && !!lr.notCounted;
  const insights = lr.timingFail != null || lr.timingUnsure != null || wrong.length > 0 || speakerRun ? r.insights.filter((i) => i.kind !== 'great') : r.insights;

  return (
    <main className="screen">
      <div className="col" style={{ gap: 2, paddingTop: 8 }}>
        <span className="eyebrow">
          {section?.label ?? (lr.sectionId === 'all' ? 'Whole piece' : lr.sectionId === 'cold' ? 'Cold start' : 'Drill')} · {part?.name} · {spec ? `L${lr.level} ${spec.name}` : ''}
        </span>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>{piece.title}</h1>
      </div>

      {lr.alignedMs != null && Math.abs(lr.alignedMs) >= 25 && lr.timingFail == null && lr.timingUnsure == null && (
        <div className="notice info" role="status" data-testid="aligned-note">
          {lr.latencyUsedMs != null
            ? <>Your phone and headphones seem to delay sound by about {lr.latencyUsedMs + lr.alignedMs} ms (we allowed {lr.latencyUsedMs} ms), so we lined your voice up with the music before judging intonation.</>
            : <>We lined your voice up with the music (sound delay of your phone and headphones) before judging intonation.</>}
          {lr.latencyAdjusted != null ? ` From now on we'll allow ${lr.latencyAdjusted} ms.`
            : lr.suggestDelayCheck ? ' Your measured delay may be out of date (new headphones?): redo the delay check in Voice setup.'
              : ' If the next run shows the same, we’ll adjust. The 10-second delay check in Voice setup is quicker and more exact, and lets the app judge your timing.'}
        </div>
      )}
      {speakerRun && (
        <div className="notice info" role="status" data-testid="pass-banner">
          <strong>Practice:</strong> level 1 counts with headphones on, because through the speaker the app can’t hear every note reliably.
          {wrong.length > 0 ? ` ${wrong.length === 1 ? 'One note wasn’t' : `${wrong.length} notes weren’t`} right: see below.` : ''}
        </div>
      )}
      {lr.notCounted && !speakerRun && (
        <div className="notice info" role="status" data-testid="pass-banner">
          <strong>Practice run:</strong> {lr.notCounted}{lr.timingUnsure != null ? '.'
            : lr.full ? <>, so it doesn't count toward the piece's level.{lr.full.blocked ? '' : lr.level === 5 && /peeked|showing/.test(lr.notCounted) ? ' When you feel ready, choose “Test: all hidden” and sing it without peeking.' : ' Sing it all in one go at the level’s tempo to earn the level.'}</>
            : lr.level === 5 && !/stopped early/.test(lr.notCounted) ? <>, so it doesn't count toward memorising the section yet. When you feel ready, choose “Test: all hidden” and sing it without peeking.</>
              : <>, so it doesn't count toward the level. Sing the whole section at the level's tempo to level up.</>}
          {lr.timingUnsure != null && <> <button className="linklike" onClick={() => go({ name: 'setup' })}>Open Voice setup</button></>}
        </div>
      )}
      {lr.ladder && lr.full && <FullRunBanner lr={lr} full={lr.full} label={label} />}
      {lr.ladder && !lr.full && (
        <div className={lr.passed ? 'notice info' : 'notice'} role="status" data-testid="pass-banner">
          {lr.passed && lr.level === 5 && lr.newLevel < 5
            ? <><strong>Sung from memory!</strong> That's day {lr.offBookDays ?? 1} of {OFF_BOOK_DAYS}: do it again on another day and the section counts as memorised.{leveledUp ? ` (And it's concert-ready now.)` : ''}</>
            : leveledUp
            ? <><strong>{section?.label ?? 'Section'}: level {lr.newLevel} reached ({LEVELS[lr.newLevel - 1]?.name})!</strong> {lr.newLevel >= 5 ? 'This section is memorised.' : lr.newLevel >= 4 ? 'This section is concert-ready.' : lr.newLevel >= 3 ? 'This section is rehearsal-ready.' : ''}</>
            : lr.passed
              ? <><strong>Passed.</strong> You keep level {lr.newLevel}.</>
              : lr.timingFail != null && r.accuracy >= (spec?.pass ?? 0.8)
                ? lr.suggestDelayCheck
                  ? <><strong>Not yet:</strong> the notes were right ({Math.round(r.accuracy * 100)}%), but your voice reached the app about {lr.timingFail} ms after the beat. Either your headphones changed since the delay check (redo it in Voice setup, it takes 10 seconds) or you're singing behind the music: breathe early and sing with it, not after it.</>
                  : <><strong>Not yet:</strong> the notes were right ({Math.round(r.accuracy * 100)}%), but you came in about {lr.timingFail} ms behind the beat. Breathe early and sing with the music, not after it.</>
                : everyNote && wrong.length
                  ? <><strong>Not yet: {wrong.length === 1 ? 'one note wasn’t' : `${wrong.length} notes weren’t`} right.</strong> At level 1 every note counts. Loop {wrong.length === 1 ? 'its bar' : 'those bars'} slowly (below), then try again.</>
                  : everyNote
                    ? <><strong>Not yet:</strong> {Math.round(r.accuracy * 100)}%: too many notes were too unclear to judge. Sing every note on “doo”, clearly and steadily, and try again.</>
                    : <><strong>Not yet:</strong> {Math.round(r.accuracy * 100)}% of {Math.round((spec?.pass ?? 0.8) * 100)}% needed. Use the tips below and try again.</>}
        </div>
      )}

      {fixedNote && (
        <div className="notice info" role="status" data-testid="fixed-banner">
          {fixedNote.remaining === 0
            ? <><strong>Fixed!</strong> Nothing left to fix at level {fixedNote.level}: sing the whole piece at level {fixedNote.level} again.</>
            : <><strong>Fixed</strong> for level {fixedNote.level}. {fixedNote.remaining} more section{fixedNote.remaining > 1 ? 's' : ''} to fix before the full run at level {fixedNote.level}.</>}
        </div>
      )}

      <div className="row" style={{ gap: 20 }}>
        {/* A practice run (it didn't count) shows its grade muted: not a pass. */}
        <div className="grade-tile" aria-label={`Grade ${letter}${lr.notCounted ? ' (practice)' : ''}`} data-testid="grade"
          style={lr.notCounted ? { background: 'var(--surface-2)', color: 'var(--muted)' } : undefined}>{letter}</div>
        <div className="col" style={{ gap: 4 }}>
          <span className="mono" style={{ fontSize: 30, fontWeight: 600 }} data-testid="result-score">{r.score.toLocaleString()}</span>
          <span className="small" style={{ color: 'var(--voice)' }}>
            {Math.round(r.accuracy * 100)}% accuracy{isPB ? ' · new personal best!' : ''}
          </span>
        </div>
      </div>

      <div className="stats3">
        <div className="stat"><span className="k">In tune</span><span className="v">{Math.round(r.pitch * 100)}%</span>{avgCents != null && <span className="k mono">avg {avgCents > 0 ? '+' : avgCents < 0 ? '−' : '±'}{Math.abs(avgCents)}¢</span>}</div>
        <div className="stat"><span className="k">Rhythm</span><span className="v">{Math.round(r.rhythm * 100)}%</span></div>
        <div className="stat"><span className="k">Best combo</span><span className="v">{r.maxCombo}</span></div>
      </div>
      <div className="tiny muted mono">perfect {r.counts.perfect} · good {r.counts.good} · ok {r.counts.ok} · miss {r.counts.miss}</div>

      {lr.full && lr.full.sections.length > 0 && (
        <div className="col" style={{ gap: 6 }} data-testid="full-sections">
          <h2 style={{ fontSize: 16 }}>Section by section</h2>
          {lr.full.sections.map((x) => {
            const fix = lr.full!.counted && lr.full!.toFix.includes(x.id);
            return (
              <div key={x.id} className="row" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--surface-2)' }} data-testid={fix ? 'full-section-fix' : 'full-section'}>
                <span className="grow small ellipsis" style={{ fontWeight: 600 }}>{label(x.id)}</span>
                <span className="mono small" style={{ color: x.passed ? 'var(--voice)' : 'var(--accent-text)' }}>
                  {Math.round(x.accuracy * 100)}%{everyNote && x.wrong?.length ? ` · ${x.wrong.length} note${x.wrong.length > 1 ? 's' : ''}` : ''}
                </span>
                {fix ? (
                  <button className="btn small" style={{ minWidth: 112 }} onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: x.id, level: lr.level, mode: '2d' })}>
                    <IconPlay size={14} color="currentColor" /> Fix at L{lr.level}
                  </button>
                ) : (
                  <span className="tiny" style={{ minWidth: 112, textAlign: 'right', color: x.passed ? 'var(--voice)' : 'var(--muted)' }}>{x.passed ? (lr.full!.counted ? '✓ passed' : '✓ would pass') : 'below the mark'}</span>
                )}
              </div>
            );
          })}
          <span className="tiny muted">
            {everyNote
              ? 'At level 1 every note of every section must be right. Very short notes the app can’t judge reliably are let off unless clearly wrong.'
              : `Each section needs ${Math.round((spec?.pass ?? 0.8) * 100)}% within the run, like the run as a whole (short sections get one weak note of slack).`}
          </span>
        </div>
      )}

      {wrong.length > 0 && part && <WrongNotes piece={piece} notes={wrong} part={part} tol={tol} loop={(m) => playLoop(m, m, 1)} />}

      {measureIdx.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <div className="row between">
            <h2 style={{ fontSize: 16 }}>Bar by bar</h2>
            <span className="tiny muted">tap a bar to loop it</span>
          </div>
          <div className="heat">
            {measureIdx.map((m) => {
              const v = r.perMeasure[m];
              // Level 1: a bar with a wrong note needs work, whatever its average.
              const bg = wrongBars.has(m) ? '#FF7A45' : v >= 0.85 ? '#4CC9F0' : v >= 0.6 ? '#1D4F63' : '#FF7A45';
              return <button key={m} aria-label={`${cellName(m)}: ${Math.round(v * 100)}%`} title={`${cellName(m)} · ${Math.round(v * 100)}%`} style={{ background: bg, color: bg === '#1D4F63' ? '#EEF0FF' : '#0B0D1A', fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)' }} onClick={() => playLoop(m - 1, m + 1)}>{cellText(m)}</button>;
            })}
          </div>
          <div className="row tiny muted" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#4CC9F0' }} />solid</span>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#1D4F63' }} />ok</span>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#FF7A45' }} />needs work</span>
            <span className="grow" style={{ textAlign: 'right' }}>{barRangeLabel(piece.score, measureIdx[0], measureIdx[measureIdx.length - 1], true)}</span>
          </div>
        </div>
      )}

      {insights.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <h2 style={{ fontSize: 16 }}>Coach notes</h2>
          {insights.map((i, k) => (
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
                  <IconLoop size={16} /> Loop {barRangeLabel(piece.score, i.measures[0], i.measures[1], true)} slowly
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="col" style={{ gap: 8, marginTop: 'auto' }}>
        {lr.sectionId === 'cold' ? (
          <button className="btn primary block" data-testid="cold-again" onClick={() => {
            try { sessionStorage.setItem('sh:fromResults', '1'); } catch { /* ignore */ }
            startColdStart(piece, lr.partId, lr.from, true);
          }}>
            <IconPlay size={18} /> Another cold start
          </button>
        ) : !lr.ladder && !lr.notCounted ? (
          /^row-|^leaps-/.test(piece.id) ? (
            <button className="btn primary block" onClick={() => go({ name: 'expert' })}>Back to expert mode</button>
          ) : (
            <button className="btn primary block" onClick={() => go({ name: 'piece', pieceId: piece.id.split('~')[0] })}>
              Back to {getPiece(piece.id.split('~')[0])?.title ?? 'the piece'}
            </button>
          )
        ) : speakerRun ? (
          <button className="btn primary block" data-testid="again-headphones" onClick={() => {
            saveProfile({ ...loadProfile(), headphones: true }); // what the button says
            goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level, mode: lr.mode });
          }}>
            <IconPlay size={18} /> Sing it again with headphones on
          </button>
        ) : nextFix ? (
          <button className="btn primary block" data-testid="fix-first" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: nextFix, level: lr.level, mode: '2d' })}>
            <IconPlay size={18} /> Fix {label(nextFix)} at level {lr.level}
          </button>
        ) : lr.full?.blocked ? (
          <button className="btn primary block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.full!.blocked![0], level: lr.level, mode: '2d' })}>
            <IconPlay size={18} /> Fix {label(lr.full.blocked[0])} at level {lr.level}
          </button>
        ) : fixedNote && fixedNote.remaining === 0 ? (
          <button className="btn primary block" data-testid="full-again" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'all', level: fixedNote.level, mode: '2d' })}>
            <IconPlay size={18} /> Sing it all at level {fixedNote.level}
          </button>
        ) : !lr.passed && lr.ladder ? (
          <button className="btn primary block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level, mode: lr.mode })}>
            <IconPlay size={18} /> Try again
          </button>
        ) : next ? (
          <button className="btn primary block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: next.sectionId, level: next.level, mode: '2d' })}>
            <IconPlay size={18} /> Next: {next.sectionId === 'all' ? 'the whole piece' : next.kind === 'fix' ? `fix ${label(next.sectionId)}` : label(next.sectionId)}, level {next.level}
          </button>
        ) : (
          <button className="btn primary block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'all', level: 4, mode: '3d' })}>
            <IconCube size={18} color="#0B0D1A" /> {lr.full?.passed && lr.full.newLevel >= 5 ? 'Memorised!' : 'All done for today!'} Arcade run of the whole piece
          </button>
        )}
        <div className="row">
          {!lr.passed && lr.ladder && lr.level > 1 && !nextFix ? (
            <button className="btn block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level - 1, mode: '2d' })}>
              Easier: level {lr.level - 1}
            </button>
          ) : !(!lr.passed && lr.ladder) && !lr.full?.blocked ? (
            <button className="btn block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level, mode: lr.mode, ...(lr.sectionId === 'drill' || lr.sectionId === 'cold' ? { from: lr.from, to: lr.to } : {}) })}>Again</button>
          ) : lr.sectionId === 'all' && (nextFix || lr.full?.blocked) ? (
            // Until the slipped sections pass on their own, another full run at this level is practice.
            <button className="btn block" data-testid="sing-all-again" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'all', level: lr.level, mode: '2d' })}>
              Sing it all again <span className="tiny muted">(practice)</span>
            </button>
          ) : null}
          <button className="btn block" onClick={() => go({ name: 'piece', pieceId: piece.id })}>All sections</button>
        </div>
        <button className="btn ghost block" onClick={() => go({ name: 'ranks' })}>Leaderboard</button>
        <AccountTip />
        <ShareRecording pieceId={lr.pieceId} partId={lr.partId} />
      </div>
    </main>
  );
}

const READY: Record<number, string> = { 3: 'The piece is rehearsal-ready.', 4: 'The piece is concert-ready.', 5: 'The piece is memorised.' };

type LR = NonNullable<ReturnType<typeof getLastResult>>;

/** The verdict on a counted run of the whole piece: the piece level, or what to fix first. */
function FullRunBanner({ lr, full, label }: { lr: LR; full: NonNullable<LR['full']>; label: (id: string) => string }) {
  const spec = LEVELS[lr.level - 1];
  const everyNote = !!spec?.everyNote && !!lr.everyNote;
  const need = Math.round((spec?.pass ?? 0.8) * 100);
  const acc = Math.round(lr.result.accuracy * 100);
  const up = full.newLevel > full.prevLevel;
  const fixes = full.toFix.map(label);
  const list = fixes.length <= 3 ? fixes.join(', ') : `${fixes.slice(0, 3).join(', ')} and ${fixes.length - 3} more`;
  return (
    <div className={full.passed ? 'notice info' : 'notice'} role="status" data-testid="pass-banner">
      {full.passed && lr.level === 5 && full.newLevel < 5
        ? <><strong>The whole piece from memory!</strong> That's day {full.offBookDays ?? 1} of {OFF_BOOK_DAYS}: do it again on another day and the piece counts as memorised.{up ? ' (And it’s concert-ready now.)' : ''}</>
        : full.passed && up
          ? <><strong>Piece level {full.newLevel} reached: {LEVELS[full.newLevel - 1]?.name}!</strong> You sang it all in one go. {READY[full.newLevel] ?? ''}</>
          : full.passed
            ? <><strong>Passed.</strong> The piece keeps level {full.newLevel}.</>
            : fixes.length && everyNote
              ? <><strong>Not every note was right</strong> in {list}. At level 1 every note counts: fix {fixes.length > 1 ? 'each one' : 'it'} at level 1 on its own (marked below), then sing it all again.</>
            : fixes.length && full.overallPassed
              ? <><strong>{acc}% overall, but not every section held.</strong> {list} {fixes.length > 1 ? 'were' : 'was'} below {need}% in the run. Fix {fixes.length > 1 ? 'each one' : 'it'} at level {lr.level} on its own, then sing it all again.</>
              : fixes.length
                ? <><strong>Not yet:</strong> {acc}% of {need}% needed. Practise {list} at level {lr.level} (marked below), then sing it all again.</>
                : lr.timingFail != null
                  ? <><strong>Not yet:</strong> the notes were right ({acc}%), but you came in about {lr.timingFail} ms behind the beat. Breathe early and sing with the music, not after it.</>
                  : everyNote
                    ? <><strong>Not yet:</strong> {acc}%: too many notes were too unclear to judge. Sing every note on “doo”, clearly and steadily.</>
                    : <><strong>Not yet:</strong> {acc}% of {need}% needed.</>}
    </div>
  );
}


/** Level 1: the notes that weren't right, grouped by bar, each bar with a slow loop to drill it. */
function WrongNotes({ piece, part, notes, tol, loop }: {
  piece: PieceInfo; part: { notes: { measure: number; lyric?: string }[] }; notes: NoteResult[]; tol: number; loop: (measure: number) => void;
}) {
  const MAX_BARS = 5;
  const bars = new Map<number, NoteResult[]>();
  for (const n of notes) {
    const m = part.notes[n.index]?.measure;
    if (m == null) continue;
    bars.set(m, [...(bars.get(m) ?? []), n]);
  }
  const list = [...bars.entries()].sort((a, b) => a[0] - b[0]);
  /** 1-based position of the note within its bar. */
  const nth = (i: number) => {
    const m = part.notes[i].measure;
    let k = 1;
    for (let j = i - 1; j >= 0 && part.notes[j].measure === m; j--) k++;
    return k;
  };
  return (
    <div className="col" style={{ gap: 8 }} data-testid="wrong-notes">
      <h2 style={{ fontSize: 16 }}>Notes to fix</h2>
      {list.slice(0, MAX_BARS).map(([m, ns]) => (
        <div key={m} className="card" style={{ padding: '10px 14px', gap: 8 }} data-testid="wrong-bar">
          <span className="small">
            <strong>{barRangeLabel(piece.score, m, m)}:</strong>{' '}
            {ns.map((n, k) => {
              const ly = part.notes[n.index]?.lyric;
              return <span key={n.index}>{k ? '; ' : ''}note {nth(n.index)}{ly ? ` (“${ly}”)` : ''} was {noteFault(n, tol)}</span>;
            })}
          </span>
          <button className="btn small" onClick={() => loop(m)}>
            <IconLoop size={16} /> Loop {barRangeLabel(piece.score, m, m, true)} slowly
          </button>
        </div>
      ))}
      {list.length > MAX_BARS && <span className="tiny muted">…and {list.length - MAX_BARS} more bar{list.length - MAX_BARS > 1 ? 's' : ''}: see “Bar by bar” below.</span>}
    </div>
  );
}

/** Share the run's recording (with the data to re-score it) to help tune the scoring. */
function ShareRecording({ pieceId, partId }: { pieceId: string; partId: string }) {
  const run = getLastRun();
  const [busy, setBusy] = useState(false);
  if (!run || run.meta.pieceId !== pieceId || run.meta.partId !== partId) return null;
  const secs = Math.round(run.recording.pcm.length / run.recording.sampleRate);
  return (
    <div className="col" style={{ gap: 4, marginTop: 6 }}>
      <button className="btn ghost block small" disabled={busy} data-testid="share-recording"
        onClick={async () => {
          setBusy(true);
          try {
            const how = await shareRun(run);
            if (how === 'downloaded') toast('Recording saved to your downloads');
          } catch (e) {
            console.error(e);
            toast('The recording could not be shared');
          } finally {
            setBusy(false);
          }
        }}>
        Share this run’s recording ({secs} s)
      </button>
      <span className="tiny muted" style={{ textAlign: 'center' }}>
        Scored oddly? Send the recording to whoever looks after the app: it contains your voice and the app’s readings, so the scoring can be checked and tuned.
        It stays on this phone unless you share it.
      </span>
    </div>
  );
}

/** Results of a words-in-rhythm run: which syllables came in time, shown on the text itself. */
function WordsResults({ lr, words }: { lr: NonNullable<ReturnType<typeof getLastResult>>; words: NonNullable<NonNullable<ReturnType<typeof getLastResult>>['words']> }) {
  const piece = getPiece(lr.pieceId)!;
  const part = piece.score.parts.find((p) => p.id === lr.partId);
  const section = piece.sections.find((s) => s.id === lr.sectionId);
  const res = words.result;
  const pct = Math.round(res.accuracy * 100);
  const inTime = res.syllables.filter((x) => x.grade === 'perfect' || x.grade === 'good').length;
  const mnum = (i: number) => piece.score.measures[i]?.number ?? String(i + 1);
  // A pickup bar numbered 0 is "Upbeat" (as in section and wrong-note labels): "Up" in the strip.
  const cellText = (i: number) => (i === 0 && mnum(i) === '0' ? 'Up' : mnum(i));
  const cellName = (i: number) => (i === 0 && mnum(i) === '0' ? 'Upbeat' : `Bar ${mnum(i)}`);
  const measureIdx = Object.keys(res.perMeasure).map(Number).sort((a, b) => a - b);
  const nextStage = words.counted && words.stage < 2 && res.accuracy >= WORDS_PASS ? ((words.stage + 1) as WordsStage) : null;
  // The words screen opens at the next step that isn't passed yet.
  const again = () => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: 0, mode: '2d', words: true });
  const color = { perfect: 'var(--voice)', good: 'var(--voice)', ok: '#E8B86A', miss: '#FF7A45' } as const;
  return (
    <main className="screen">
      <div className="col" style={{ gap: 2, paddingTop: 8 }}>
        <span className="eyebrow">{section?.label ?? 'Whole piece'} · {part?.name} · Words: {STAGE_NAMES[words.stage]}</span>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>{piece.title}</h1>
      </div>
      <div className={res.accuracy >= WORDS_PASS ? 'notice info' : 'notice'} role="status" data-testid="words-banner">
        {!words.counted
          ? <><strong>Practice run</strong> (slower tempo or stopped early): do it at 100% tempo to move on.</>
          : words.newStage
            ? <><strong>{STAGE_NAMES[words.stage]}: done!</strong> {words.stage === 2 ? 'You know the words of this section by heart.' : `Next: ${STAGE_NAMES[words.stage + 1]}.`}</>
            : res.accuracy >= WORDS_PASS
              ? <><strong>Well done.</strong> {pct}% of the syllables in time.</>
              : (res.extra ?? 0) > 2
                ? <><strong>Not yet:</strong> {pct}% of {Math.round(WORDS_PASS * 100)}%. The app heard {res.extra} more syllables than the text has: say just the words, in their rhythm.</>
                : <><strong>Not yet:</strong> {pct}% of {Math.round(WORDS_PASS * 100)}%. Say the words in rhythm, with crisp consonants.</>}
      </div>
      <div className="stats3">
        <div className="stat"><span className="k">In time</span><span className="v">{pct}%</span></div>
        <div className="stat"><span className="k">Syllables</span><span className="v">{inTime}/{res.syllables.length}</span></div>
        <div className="stat"><span className="k">Missed · extra</span><span className="v">{res.missed} · {res.extra ?? 0}</span></div>
      </div>
      {words.calibrated && res.medianMs !== null && Math.abs(res.medianMs) > 120 && (
        <span className="small muted">On average you were about {Math.abs(res.medianMs)} ms {res.medianMs > 0 ? 'late' : 'early'}.</span>
      )}
      {part && (
        <div className="card" data-testid="words-text">
          <span className="tiny muted">Blue: in time · amber: a little off · orange: missing or off the beat</span>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5 }}>
            {res.syllables.map((x, k) => {
              const n = part.notes[x.index];
              const sep = k > 0 && n.syllabic !== 'middle' && n.syllabic !== 'end' ? ' ' : '';
              return <React.Fragment key={k}>{sep}<span style={{ color: color[x.grade], textDecoration: x.grade === 'miss' ? 'underline wavy' : undefined }}>{n.lyric}</span></React.Fragment>;
            })}
          </p>
        </div>
      )}
      {measureIdx.length > 1 && (
        <div className="heat">
          {measureIdx.map((m) => {
            const v = res.perMeasure[m];
            const bg = v >= 0.85 ? '#4CC9F0' : v >= 0.6 ? '#1D4F63' : '#FF7A45';
            return <span key={m} aria-label={`${cellName(m)}: ${Math.round(v * 100)}%`} style={{ background: bg, height: 30, borderRadius: 3, color: bg === '#1D4F63' ? '#EEF0FF' : '#0B0D1A', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)' }}>{cellText(m)}</span>;
          })}
        </div>
      )}
      <span className="tiny muted">The app hears when each syllable starts, not which word it is: use the lyrics quiz to check the words themselves.</span>
      <div className="col" style={{ gap: 8, marginTop: 'auto' }}>
        <button className="btn primary block" onClick={again}><IconPlay size={18} /> {nextStage != null ? `Next: ${STAGE_NAMES[nextStage]}` : 'Again'}</button>
        <div className="row">
          <button className="btn block" onClick={() => go({ name: 'lyrics', pieceId: piece.id, partId: lr.partId })}>Lyrics quiz</button>
          <button className="btn block" onClick={() => go({ name: 'piece', pieceId: piece.id })}>Back to the piece</button>
        </div>
      </div>
    </main>
  );
}

/** Once, after a choir singer's first pass without an account: make one to keep progress on every phone. */
function AccountTip() {
  const [show, setShow] = useState(accountTipPending);
  if (!show) return null;
  return (
    <div className="notice info col" style={{ gap: 6 }} data-testid="account-tip">
      <span className="small">Keep your progress on every phone: make an account in your choir (name and password).</span>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small" onClick={() => {
          dismissAccountTip();
          try { sessionStorage.setItem('sh:openAccount', 'create'); } catch { /* ignore */ }
          go({ name: 'settings' });
        }}>Make an account</button>
        <button className="btn small ghost" onClick={() => { dismissAccountTip(); setShow(false); }}>Not now</button>
      </div>
    </div>
  );
}
