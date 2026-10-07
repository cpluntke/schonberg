import React, { useState } from 'react';
import { getLastRun, shareRun } from '../play/runExport';
import { startColdStart } from '../play/cold';
import { STAGE_NAMES, WORDS_PASS, type WordsStage } from '../../game/textrhythm';
import { toast } from '../hooks';
import { getLastResult, lastRunPiece } from '../play/lastResult';
import { getPiece, singableSections } from '../library';
import { go, leaveTo, practiceParent, type Route } from '../router';
import { LEVELS, OFF_BOOK_DAYS, effectiveTolerance, fixesBefore, nextStep, noteVerdict, wrongNotes } from '../../progress/ladder';
import { inputAdvice, type InputAdvice } from '../../audio/inputQuality';
import { getProgress, loadProfile, saveProfile } from '../../progress/store';
import { barRangeLabel } from '../../music/sections';
import { MistakeScore } from '../components/MistakeScore';
import { IconDown, IconUp, IconClock, IconLoop, IconStar, IconPlay, IconCube, IconEar, IconFlame, IconRestart, IconList } from '../icons';
import { STUCK_AFTER, failsInARow, slowRate } from '../../progress/struggle';
import type { Insight } from '../../game/types';
import type { PieceInfo } from '../library';
import { accountTipPending, dismissAccountTip } from '../../progress/sync';
import { startPresence } from '../../progress/presence';
import { PracticeBar } from '../components/PracticeBar';

/** Start a run from Results: it takes Results' place in history (router: practice screens replace each other). */
function goPlay(r: Parameters<typeof go>[0]) {
  go(r, true);
}

/** The page below a result: the piece (expert mode for its drills). */
function upOf(pieceId: string): Route {
  return practiceParent({ name: 'lyrics', pieceId, partId: '' }) ?? { name: 'home' };
}

/** One step in the sticky footer: the button and the line under it saying why. */
interface Step { label: React.ReactNode; why?: React.ReactNode; onClick: () => void; testid?: string }

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
  // Results are part of practising: Again, Next… (so a singer doesn't flicker out of the choir's count)
  React.useEffect(() => startPresence(loadProfile().voice), []);
  const lr = getLastResult();
  const piece = lr ? getPiece(lr.pieceId) : undefined;
  if (!lr || !piece) {
    // The details live only while the app is open; the progress itself was saved.
    const lastId = lr?.pieceId ?? lastRunPiece();
    const lastPiece = lastId ? getPiece(lastId) : undefined;
    return (
      <main className="screen practice" data-testid="no-results">
        <PracticeBar up={lastPiece ? upOf(lastPiece.id) : { name: 'home' }} heading title="No results to show" sub={lastPiece?.title} />
        <span className="small muted">
          {lastPiece ? 'The details of your last run are gone (the app was closed or reloaded), but your progress from it was saved.'
            : 'Sing a section and your results appear here.'}
        </span>
        {lastPiece && (
          <button className="btn primary block" onClick={() => leaveTo(upOf(lastPiece.id))}>
            Open {lastPiece.title}
          </button>
        )}
        <button className={`btn block${lastPiece ? '' : ' primary'}`} onClick={() => leaveTo({ name: 'home' })}>Home</button>
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
  // The run opened its level with sections to fix: fixing them is the next step (no second run).
  const nextFix = lr.full?.opened && !lr.full.passed ? fixesBefore(sections, prog, lr.level)[0] : undefined;
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
  const insights = (lr.timingFail != null || lr.timingUnsure != null || wrong.length > 0 || speakerRun ? r.insights.filter((i) => i.kind !== 'great') : r.insights)
    .map((i) => (i.kind === 'great' ? { ...i, detail: onwardText(i.detail, lr.sectionId) } : i));
  // Microphone trouble: advice for what the input monitor found (through the speaker, the backing in
  // the mic explains the "distortion"), and at level 1 the notes let off because of it.
  const advice = inputAdvice(lr.inputQuality).filter((a) => !(lr.speaker && a.kind === 'distortion'));
  const micNotes = everyNote ? r.notes.filter((n) => n.unsure === 'mic' && noteVerdict(n) === 'forgiven') : [];
  const micBars = [...new Set(micNotes.map((n) => part?.notes[n.index]?.measure).filter((m): m is number => m != null))].sort((a, b) => a - b);

  // Missed it: listening to the section again, or singing it slowly first, usually helps. After
  // misses in a row that's what comes first; the full-tempo try stays one tap away. (Not for a run
  // whose notes were right but late, or one through the phone's speaker: neither helps there.)
  const same = { name: 'play' as const, pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, mode: '2d' as const,
    ...(lr.sectionId === 'drill' ? { from: lr.from, to: lr.to } : {}) };
  const listenAgain = () => goPlay({ ...same, level: 0, after: lr.level });
  const singSlowly = () => goPlay({ ...same, level: lr.level, rate: slowRate(lr.level) });
  const timingOnly = lr.timingFail != null && r.accuracy >= (spec?.pass ?? 0.8);
  // (nor when the microphone was the trouble: its advice comes first)
  const offerHelp = lr.ladder && !lr.passed && !lr.full && !speakerRun && !timingOnly && lr.mode === '2d' && advice.length === 0 && micNotes.length === 0;
  const stuck = offerHelp && failsInARow(piece.id, lr.partId, lr.sectionId, lr.level) >= STUCK_AFTER;
  const slowLabel = `${lr.level === 1 ? 'Sing it slower' : 'Practise slowly'} (${Math.round(slowRate(lr.level) * 100)}%)`;

  // The sticky footer: one next step (with why), then "Again" (or an easier level) and the piece.
  const up = upOf(piece.id);
  const toPiece = () => leaveTo(up);
  const expertDrill = up.name === 'expert';
  const nextLabel = (n: NonNullable<typeof next>) => `Next: ${n.sectionId === 'all' ? 'the whole piece' : n.kind === 'fix' ? `fix ${label(n.sectionId)}` : label(n.sectionId)}, level ${n.level}`;
  const fixesLeft = nextFix ? fixesBefore(sections, prog, lr.level).length : 0;
  const play = (sectionId: string, level: number, mode: '2d' | '3d' = '2d') => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId, level, mode });
  let primary: Step & { repeats?: boolean };
  if (lr.slow != null && lr.sectionId !== 'cold') {
    primary = { label: <><IconPlay size={18} /> Now at full tempo</>, why: 'That was slow practice: now sing it at the level’s tempo.', testid: 'full-tempo', onClick: () => goPlay({ ...same, level: lr.level, mode: lr.mode }) };
  } else if (lr.sectionId === 'cold') {
    primary = { label: <><IconPlay size={18} /> Another cold start</>, why: 'A new bar at random: find your way in from memory.', testid: 'cold-again', onClick: () => { startColdStart(piece, lr.partId, lr.from, true); } };
  } else if (!lr.ladder && !lr.notCounted) {
    primary = expertDrill
      ? { label: 'Back to expert mode', onClick: toPiece }
      : { label: 'Back to the piece', why: 'Drills are practice: they don’t change your levels.', testid: 'back-to-piece', onClick: toPiece };
  } else if (speakerRun) {
    primary = {
      label: <><IconPlay size={18} /> Sing it again with headphones on</>, why: 'Level 1 counts with headphones on.', testid: 'again-headphones', repeats: true,
      onClick: () => {
        saveProfile({ ...loadProfile(), headphones: true }); // what the button says
        play(lr.sectionId, lr.level, lr.mode);
      },
    };
  } else if (stuck) {
    primary = lr.level === 1
      ? { label: <><IconEar size={18} color="#0B0D1A" /> Listen again, then sing it</>, why: 'A few misses in a row: hear how it goes first.', testid: 'stuck-listen', onClick: listenAgain }
      : { label: <><IconPlay size={18} /> {slowLabel}</>, why: 'Slow runs don’t count, but they make the full-tempo run easier.', testid: 'stuck-slow', onClick: singSlowly };
  } else if (nextFix) {
    primary = {
      label: <><IconPlay size={18} /> Fix {label(nextFix)} at level {lr.level}</>, testid: 'fix-first', onClick: () => play(nextFix, lr.level),
      why: `${fixesLeft > 1 ? `${fixesLeft} sections to fix` : 'One section to fix'} on ${fixesLeft > 1 ? 'their' : 'its'} own: no need to sing it all again.`,
    };
  } else if (lr.full?.tooMuch && next) {
    // Too much slipped for the run to count: the sections first.
    primary = { label: <><IconPlay size={18} /> {nextLabel(next)}</>, why: 'Too much slipped for the run to count: the sections first.', testid: 'practise-sections', onClick: () => play(next.sectionId, next.level) };
  } else if (!lr.passed && lr.ladder) {
    primary = {
      label: <><IconPlay size={18} /> Try again</>, testid: 'try-again', repeats: true, onClick: () => play(lr.sectionId, lr.level, lr.mode),
      why: timingOnly ? 'The notes were right: now come in with the beat.'
        : everyNote ? 'At level 1 every note must be right.'
          : `Level ${lr.level} needs ${Math.round((spec?.pass ?? 0.8) * 100)}%.`,
    };
  } else if (next) {
    primary = { label: <><IconPlay size={18} /> {nextLabel(next)}</>, why: next.reason, testid: 'next-step', onClick: () => play(next.sectionId, next.level) };
  } else {
    primary = {
      label: <><IconCube size={18} color="#0B0D1A" /> {lr.full?.passed && lr.full.newLevel >= 5 ? 'Memorised!' : 'All done for today!'} Arcade run of the whole piece</>,
      why: 'Just for fun: arcade runs don’t count for a level.', testid: 'arcade-run', onClick: () => play('all', 4, '3d'),
    };
  }
  // Second row: an easier level after a miss (as before), else the same run again.
  const again: Step | null = !lr.passed && lr.ladder && lr.level > 1 && !nextFix
    ? { label: `Easier: level ${lr.level - 1}`, testid: 'easier', onClick: () => play(lr.sectionId, lr.level - 1) }
    : primary.repeats ? null
      : {
        label: <><IconRestart size={16} /> {lr.slow != null ? 'Again, slowly' : 'Again'}</>,
        // (after a full run that opened its level: allowed any time, a new run replaces the fix list)
        testid: lr.sectionId === 'all' && nextFix ? 'sing-all-again' : 'again',
        onClick: () => goPlay({ ...same, level: lr.level, mode: lr.mode, ...(lr.sectionId === 'cold' ? { from: lr.from, to: lr.to } : {}), ...(lr.slow != null ? { rate: lr.slow } : {}) }),
      };

  return (
    <main className="screen practice has-foot">
      <PracticeBar up={up} heading title={piece.title}
        sub={[part?.name, section?.label ?? (lr.sectionId === 'all' ? 'Whole piece' : lr.sectionId === 'cold' ? 'Cold start' : lr.sectionId === 'entries' ? 'Entry drill' : 'Drill'), spec ? `L${lr.level} ${spec.name}` : ''].filter(Boolean).join(' · ')} />

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
            : lr.full ? <>, so it doesn't count toward the piece's level.{lr.level === 5 && /peeked|showing/.test(lr.notCounted) ? ' When you feel ready, choose “Test: all hidden” and sing it without peeking.' : ' Sing it all in one go at the level’s tempo for it to count.'}</>
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
                  : everyNote && micNotes.length
                    ? <><strong>Not yet:</strong> {Math.round(r.accuracy * 100)}%: microphone trouble kept the app from hearing {micNotes.length === 1 ? 'one note' : `${micNotes.length} notes`} clearly, so the run can’t count. Fix the microphone (below) and try again.</>
                    : everyNote
                    ? <><strong>Not yet:</strong> {Math.round(r.accuracy * 100)}%: too many notes were too unclear to judge. Sing every note on “doo”, clearly and steadily, and try again.</>
                    : <><strong>Not yet:</strong> {Math.round(r.accuracy * 100)}% of {Math.round((spec?.pass ?? 0.8) * 100)}% needed. Use the tips below and try again.</>}
        </div>
      )}

      {(advice.length > 0 || micBars.length > 0) && (
        <MicAdvice advice={advice} micBars={micBars.map((m) => barRangeLabel(piece.score, m, m, true))} />
      )}

      {fixedNote && (
        <div className="notice info" role="status" data-testid="fixed-banner">
          {fixedNote.remaining === 0
            ? <ReachedNote reach={lr.reached} level={fixedNote.level} />
            : <><strong>Fixed</strong> for level {fixedNote.level}. {fixedNote.remaining} more section{fixedNote.remaining > 1 ? 's' : ''} to fix and the piece reaches level {fixedNote.level}.</>}
        </div>
      )}
      {lr.full && lr.reached && (
        <div className="notice info" role="status" data-testid="fixed-banner">
          <ReachedNote reach={lr.reached} level={lr.reached.level} inRun />
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
                  <span className="tiny" style={{ minWidth: 112, textAlign: 'right', color: x.passed ? 'var(--voice)' : 'var(--muted)' }}>{x.passed ? (lr.full!.opened ? '✓ passed' : '✓ would pass') : 'below the mark'}</span>
                )}
              </div>
            );
          })}
          <span className="tiny muted">
            {everyNote
              ? 'At level 1 every note of every section must be right. Very short notes the app can’t judge reliably are let off unless clearly wrong.'
              : `Each section needs ${Math.round((spec?.pass ?? 0.8) * 100)}% within the run, like the run as a whole (short sections get one weak note of slack).`}
            {' '}A run opens the level when at most half of the sections slip and it reaches {Math.round((spec?.pass ?? 0.8) * 100) - 10}% overall; then the ones that slipped are yours to fix on their own.
          </span>
        </div>
      )}

      {wrong.length > 0 && part && <MistakeScore piece={piece} part={part} notes={wrong} tol={tol} level={lr.level} from={lr.from} to={lr.to} play={goPlay} />}

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

      {(lr.points || lr.streak) && (
        <div className="row wrap" style={{ gap: 8 }} data-testid="run-stats">
          {lr.streak && lr.streak.days > 0 && (
            <span className="pill" data-testid="run-streak">
              <IconFlame size={16} color="#FF7A45" /> {lr.streak.days}-day streak{lr.streak.extended ? (lr.streak.days > 1 ? ' · today counts!' : ' · started today!') : ''}
            </span>
          )}
          {lr.points && (
            <span className="pill" data-testid="run-points">
              <IconStar size={16} color="#4CC9F0" /> {lr.points.gained > 0 ? `+${lr.points.gained.toLocaleString()} notes right · ` : ''}{lr.points.total.toLocaleString()} {lr.points.gained > 0 ? 'this cycle' : 'notes right this cycle'}
            </span>
          )}
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

      {offerHelp && (
        <div className="card flat" data-testid="help-card" style={{ gap: 8 }}>
          <strong style={{ fontSize: 15 }}>{stuck ? 'Tricky one: take it in smaller steps' : lr.level === 1 ? 'Not there yet? Listen to it again' : 'Need a hand with it?'}</strong>
          <span className="small muted">
            {lr.level === 1
              ? 'Hear how it goes once more, then sing it. Or sing it slower: it won’t count, but the notes settle.'
              : 'Listen to the section, or sing it slowly first: slow runs don’t count, but they make the full-tempo run easier.'}
          </span>
          <div className="row wrap" style={{ gap: 6 }}>
            {!(stuck && lr.level === 1) && <button className="btn small" data-testid="help-listen" onClick={listenAgain}><IconEar size={16} /> {lr.level === 1 ? 'Listen again' : 'Listen'}</button>}
            {!(stuck && lr.level > 1) && <button className="btn small" data-testid="help-slow" onClick={singSlowly}>{slowLabel}</button>}
            {stuck && <button className="btn small" data-testid="help-again" onClick={() => goPlay({ ...same, level: lr.level, mode: lr.mode })}><IconPlay size={16} color="currentColor" /> Try again at full tempo</button>}
          </div>
        </div>
      )}

      <div className="col" style={{ gap: 8 }}>
        <button className="btn ghost block" onClick={() => go({ name: 'ranks' })}>Leaderboard</button>
        <AccountTip />
        <ShareRecording pieceId={lr.pieceId} partId={lr.partId} />
      </div>

      <ResultsFoot primary={primary} again={again} toPiece={primary.onClick === toPiece ? null : toPiece} />
    </main>
  );
}

/** The sticky footer of Results: one primary step and why, then up to two secondary buttons. */
function ResultsFoot({ primary, again, toPiece }: { primary: Step; again: Step | null; toPiece: (() => void) | null }) {
  return (
    <div className="results-foot" data-testid="results-foot">
      <button className="btn primary block" data-testid={primary.testid} onClick={primary.onClick}>{primary.label}</button>
      {primary.why && <span className="tiny muted why" data-testid="results-why">{primary.why}</span>}
      {(again || toPiece) && (
        <div className="row" style={{ gap: 8 }}>
          {again && <button className="btn small" data-testid={again.testid} onClick={again.onClick}>{again.label}</button>}
          {toPiece && <button className="btn small" data-testid="to-piece" aria-label="Back to the piece" onClick={toPiece}><IconList size={16} /> Piece</button>}
        </div>
      )}
    </div>
  );
}

/** The "excellent run" note says what's next; after a drill or a cold start that isn't a new level. */
function onwardText(detail: string, sectionId: string): string {
  const onward = sectionId === 'cold' ? 'Try another cold start, or go back to the piece.'
    : sectionId === 'drill' ? 'Now sing the whole section.'
      : sectionId === 'entries' ? 'Come back to the entries now and then to keep them sure.'
        : null;
  return onward ? detail.replace(/Move on to the next level or the next section\.?$/, onward) : detail;
}

const READY: Record<number, string> = { 3: 'The piece is rehearsal-ready.', 4: 'The piece is concert-ready.', 5: 'The piece is memorised.' };

type LR = NonNullable<ReturnType<typeof getLastResult>>;

/** The whole piece reached a level: by the last fix of the run that opened it (or, `inRun`, by sections that held in this run). */
function ReachedNote({ reach, level, inRun }: { reach?: LR['reached']; level: number; inRun?: boolean }) {
  const how = inRun ? `The sections left to fix at level ${level} held in this run` : 'Nothing left to fix';
  if (!reach) return <><strong>Fixed!</strong> Nothing left to fix at level {level}.</>;
  if (reach.level === 5 && reach.newLevel < 5) {
    return <><strong>Fixed!</strong> {how}: the whole piece is sung from memory, day {reach.offBookDays ?? 1} of {OFF_BOOK_DAYS}. Sing it all off book again on another day and it counts as memorised.</>;
  }
  return reach.newLevel > reach.prevLevel
    ? <><strong>Fixed! Piece level {reach.newLevel} reached: {LEVELS[reach.newLevel - 1]?.name}.</strong> {how}, so the level is yours: no need to sing it all again. {READY[reach.newLevel] ?? ''}</>
    : <><strong>Fixed!</strong> {how} at level {level}. The piece keeps level {reach.newLevel}.</>;
}

/** The verdict on a counted run of the whole piece: the piece level, what to fix, or too much slipped. */
function FullRunBanner({ lr, full, label }: { lr: LR; full: NonNullable<LR['full']>; label: (id: string) => string }) {
  const spec = LEVELS[lr.level - 1];
  const everyNote = !!spec?.everyNote && !!lr.everyNote;
  const need = Math.round((spec?.pass ?? 0.8) * 100);
  const acc = Math.round(lr.result.accuracy * 100);
  const up = full.newLevel > full.prevLevel;
  const fixes = full.toFix.map(label);
  const list = fixes.length <= 3 ? fixes.join(', ') : `${fixes.slice(0, 3).join(', ')} and ${fixes.length - 3} more`;
  const slipped = full.sections.filter((x) => !x.passed).length;
  const star = full.clean ? <> <strong data-testid="clean-run">Clean run! Every section right in one go{'\u00a0'}<span aria-hidden="true">★</span></strong></> : null;
  // Opened above the piece level: fixing the slips reaches it. At or below it: the piece keeps its level.
  const reaches = lr.level > full.prevLevel;
  return (
    <div className={full.passed ? 'notice info' : 'notice'} role="status" data-testid="pass-banner">
      {full.passed && lr.level === 5 && full.newLevel < 5
        ? <><strong>The whole piece from memory!</strong> That's day {full.offBookDays ?? 1} of {OFF_BOOK_DAYS}: do it again on another day and the piece counts as memorised.{up ? ' (And it’s concert-ready now.)' : ''}{star}</>
        : full.passed && up
          ? <><strong>Piece level {full.newLevel} reached: {LEVELS[full.newLevel - 1]?.name}!</strong>{star} {READY[full.newLevel] ?? ''}</>
          : full.passed
            ? <><strong>Passed.</strong> The piece keeps level {full.newLevel}.{star}</>
            : full.tooMuch
              ? <><strong>Too much slipped for this run to count</strong> ({slipped} of {full.sections.length} sections{everyNote ? ' had a note that wasn’t right' : ` were below ${need}%`}, {acc}% overall). A run opens the level when at most half of the sections slip and it reaches {need - 10}% overall. Practise the sections, then sing it all again.</>
              : fixes.length && !reaches
                ? <><strong>The piece keeps level {full.prevLevel}.</strong> {list} slipped in this run: practise {fixes.length > 1 ? 'each one' : 'it'} at level {lr.level} on its own (marked below).</>
                : fixes.length && everyNote
                  ? <><strong>Level 1 is open: not every note was right in {list}.</strong> Fix {fixes.length > 1 ? 'each one' : 'it'} at level 1 on its own (marked below) and the piece reaches level 1. No need to sing it all again.</>
                  : fixes.length
                    ? <><strong>Level {lr.level} is open{full.overallPassed ? `: ${acc}% overall` : ''}.</strong> {list} {fixes.length > 1 ? 'were' : 'was'} below {need}% in the run. Fix {fixes.length > 1 ? 'each one' : 'it'} at level {lr.level} on its own (marked below) and {lr.level === 5 ? 'the whole piece counts as sung from memory' : `the piece reaches level ${lr.level}`}. No need to sing it all again.</>
                    : lr.timingFail != null
                      ? <><strong>Not yet:</strong> the notes were right ({acc}%), but you came in about {lr.timingFail} ms behind the beat. Breathe early and sing with the music, not after it.</>
                      : everyNote
                        ? <><strong>Not yet:</strong> {acc}%: too many notes were too unclear to judge. Sing every note on “doo”, clearly and steadily.</>
                        : <><strong>Not yet:</strong> {acc}% of {need}% needed.</>}
    </div>
  );
}


/** "a", "a and b", "a, b and c", "a, b, c and 3 more". */
function listText(xs: string[]): string {
  if (xs.length > 4) return `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more`;
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** What the input monitor found wrong with the microphone, in a few concrete steps. */
function MicAdvice({ advice, micBars }: { advice: InputAdvice[]; micBars: string[] }) {
  return (
    <div className="notice" role="status" data-testid="mic-advice">
      <div className="col" style={{ gap: 8 }}>
        <strong>Your microphone</strong>
        {advice.map((a) => (
          <span key={a.kind} className="small" data-testid={`mic-advice-${a.kind}`}><strong>{a.title}:</strong> {a.text}</span>
        ))}
        {micBars.length > 0 && (
          <span className="small" data-testid="mic-trouble-notes">
            {advice.length ? 'Because of it, the app' : 'The app'} couldn’t hear {micBars.length === 1 ? 'a note' : 'some notes'} clearly ({listText(micBars)}): {micBars.length === 1 ? 'it isn’t' : 'they aren’t'} counted as wrong.
            {advice.length ? '' : ' If it keeps happening, unplug the laptop charger or try another mic.'}
          </span>
        )}
      </div>
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
  const up = upOf(piece.id);
  return (
    <main className="screen practice has-foot">
      <PracticeBar up={up} heading title={piece.title} sub={`${part?.name ?? ''} · ${section?.label ?? 'Whole piece'} · Words: ${STAGE_NAMES[words.stage]}`} />
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
      <ResultsFoot
        primary={{
          label: <><IconPlay size={18} /> {nextStage != null ? `Next: ${STAGE_NAMES[nextStage]}` : 'Again'}</>, onClick: again, testid: 'words-again',
          why: nextStage != null ? (nextStage === 1 ? 'Now with only the first letter of each word.' : 'Now from memory, with nothing shown.')
            : res.accuracy >= WORDS_PASS ? undefined : `${Math.round(WORDS_PASS * 100)}% of the syllables in time to move on.`,
        }}
        again={{ label: 'Lyrics quiz', onClick: () => go({ name: 'lyrics', pieceId: piece.id, partId: lr.partId }), testid: 'lyrics-quiz' }}
        toPiece={() => leaveTo(up)} />
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
