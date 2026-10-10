import React, { useState } from 'react';
import { getLastRun, shareRun } from '../play/runExport';
import { startColdStart } from '../play/cold';
import { STAGE_NAMES, WORDS_PASS, type WordsStage } from '../../game/textrhythm';
import { toast } from '../hooks';
import { getLastResult, lastRunPiece } from '../play/lastResult';
import { getPiece, singableSections } from '../library';
import { go, leaveTo, practiceParent, type Route } from '../router';
import {
  OFF_BOOK_DAYS, currentStep, effectiveTolerance, fixesBefore, levelLabel, nextStep, noteVerdict, pieceReadiness, stepFor, stepLabel, stepSpec, stepWord,
  wrongNotes, type Step,
} from '../../progress/ladder';
import { wordsDoneFor } from '../../progress/words';
import { inputAdvice, type InputAdvice } from '../../audio/inputQuality';
import { attemptLog, getProgress, loadCycle, loadProfile, saveProfile, type PieceProgress, type SectionProgress } from '../../progress/store';
import { barRangeLabel } from '../../music/sections';
import { MistakeScore } from '../components/MistakeScore';
import { IconDown, IconUp, IconClock, IconLoop, IconStar, IconPlay, IconCube, IconEar, IconFlame, IconRestart, IconChevronDown } from '../icons';
import { STUCK_AFTER, failsInARow, slowRate } from '../../progress/struggle';
import type { Insight } from '../../game/types';
import type { PieceInfo } from '../library';
import { accountTipPending, dismissAccountTip } from '../../progress/sync';
import { startPresence } from '../../progress/presence';
import { PracticeBar } from '../components/PracticeBar';
import { openAccount } from '../components/AccountSync';
import { LevelMeter } from '../components/LevelMeter';
import { LEVEL_ASKS } from '../components/PassageSheet';
import { MILESTONES, joinLabels, lowerLabel, meterNodes, milestoneCrossed, nextLabel, nextReason, passageStatus, pathStatus, slowOf } from '../path';
import { lateEntries, notesShare, shareWords, type LateEntry } from '../play/prerun';
import { pitchWords } from '../../game/pitchwords';
import { nextRehearsal } from '../../progress/rehearsal';
import { daysUntil, useDay } from '../hooks';
import { SessionStrip, sessionFoot, useWeek, weekText } from '../components/Today';
import { finishToday } from '../today';
import type { Section } from '../../music/types';

/** Start a run from Results: it takes Results' place in history (router: practice screens replace each other). */
function goPlay(r: Parameters<typeof go>[0]) {
  go(r, true);
}

/** The page below a result: the piece (expert mode for its drills). */
function upOf(pieceId: string): Route {
  return practiceParent({ name: 'lyrics', pieceId, partId: '' }) ?? { name: 'home' };
}

/** One step in the sticky footer: the button and the line under it saying why. */
interface FootStep { label: React.ReactNode; why?: React.ReactNode; onClick: () => void; testid?: string }

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
    case 'late-entries': case 'early-entries': case 'behind-beat': case 'consonant-on-beat': return <IconClock size={20} color="#FF7A45" />;
    case 'great': return <IconStar size={20} color="#4CC9F0" />;
    default: return <IconLoop size={20} color="#FF7A45" />;
  }
}

export function Results() {
  // Results are part of practising: Again, Next… (so a singer doesn't flicker out of the choir's count)
  React.useEffect(() => startPresence(loadProfile().voice), []);
  const [moreOpen, setMoreOpen] = useState(false);
  useDay(); // (a session left open over midnight: the footer stops offering yesterday's next step)
  const lr = getLastResult();
  const piece = lr ? getPiece(lr.pieceId) : undefined;
  if (!lr || !piece) {
    // The details live only while the app is open; the progress itself was saved.
    const lastId = lr?.pieceId ?? lastRunPiece();
    const lastPiece = lastId ? getPiece(lastId) : undefined;
    return (
      <main className="screen practice" data-testid="no-results">
        <PracticeBar up={lastPiece ? upOf(lastPiece.id) : { name: 'home' }} heading title="No results to show" sub={lastPiece?.title} />
        <span className="t14 muted">
          {lastPiece ? 'The details of your last run are gone (the app was closed or reloaded), but your progress from it was saved.'
            : 'Sing a passage and your results appear here.'}
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
  // (results saved before the steps: Level 1 was slow, the rest in tempo)
  const step: Step = lr.step ?? (lr.level === 1 ? 'slow' : 'tempo');
  const spec = lr.level >= 1 ? stepSpec(lr.level, step) : undefined;
  const sections = singableSections(piece, lr.partId);
  const prog = getProgress(piece.id, lr.partId);
  const next = nextStep(sections, prog, Date.now(), wordsDoneFor(piece.id, lr.partId, part, sections));
  // Practice runs (stopped, slower, paused…) don't set personal bests.
  const isPB = !lr.notCounted && lr.prevBest != null && r.score > lr.prevBest;
  const label = (id: string) => sections.find((s) => s.id === id)?.label ?? id;
  const fixedNote = lr.fixed?.[lr.fixed.length - 1];
  // The run opened its level with passages to fix: fixing them is the next step (no second run).
  const nextFix = lr.full?.opened && !lr.full.passed ? fixesBefore(sections, prog, lr.level)[0] : undefined;
  const leveledUp = lr.ladder && lr.newLevel > lr.prevLevel;
  const stepUp = lr.ladder && !!lr.stepUp && !leveledUp;
  const passName = section?.label ?? 'This passage';
  const entriesLate = !!lr.entries && !lr.entries.ok;

  const sungCents = r.notes.map((n) => n.cents).filter((c): c is number => c != null && Math.abs(c) < 100).sort((a, b) => a - b);
  const avgCents = sungCents.length ? Math.round(sungCents[Math.floor(sungCents.length / 2)]) : null;
  const measureIdx = Object.keys(r.perMeasure).map(Number).sort((a, b) => a - b);
  const ms = piece.score.measures;
  const mnum = (i: number) => ms[i]?.number ?? String(i + 1);
  // A pickup bar numbered 0 is "Upbeat" (as in passage and wrong-note labels): "Up" in the strip.
  const cellText = (i: number) => (i === 0 && mnum(i) === '0' ? 'Up' : mnum(i));
  const cellName = (i: number) => (i === 0 && mnum(i) === '0' ? 'Upbeat' : `Bar ${mnum(i)}`);

  // A loop started from here remembers the passage step it came from (Route.back): its Results lead
  // back to singing that passage whole, at that level and step.
  const loopBack = section && lr.level >= 1 ? { sectionId: section.id, level: lr.level, step: lr.step ?? (lr.level === 1 ? 'slow' as const : 'tempo' as const) }
    : lr.back;
  const playLoop = (m0: number, m1: number, level = Math.max(1, Math.min(lr.level, 2))) => {
    const from = ms[Math.max(0, m0)]?.start ?? lr.from;
    const last = ms[Math.min(ms.length - 1, m1)];
    const to = last ? last.start + last.dur : lr.to;
    goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'drill', level, mode: '2d', from, to, ...(loopBack ? { back: loopBack } : {}) });
  };

  // Level 1 slow: every note must be right. The notes that weren't, by bar, with a loop to drill them.
  // Judged note by note. A result saved by an older version has no verdicts (it passed or failed on
  // the 75% mark): show it as it was judged then.
  const everyNote = !!spec?.everyNote && !!lr.everyNote;
  const wrong = everyNote ? wrongNotes(r) : [];
  const wrongBars = new Set(wrong.map((n) => part?.notes[n.index]?.measure));
  const tol = lr.tolerance ?? effectiveTolerance(lr.level, step, loadProfile().strictness);
  const letter = gradeLetter(r.accuracy, wrong.length > 0);

  // A run that failed (or didn't count) on timing isn't an "excellent run".
  // Nor is a level-1 run with a wrong note.
  // Nor a level-1 run through the speaker (practice: "move on to the next level" would be wrong).
  const speakerRun = !!lr.speaker && !!lr.notCounted;
  const insights = (lr.timingFail != null || lr.timingUnsure != null || wrong.length > 0 || speakerRun ? r.insights.filter((i) => i.kind !== 'great') : r.insights)
    .map((i) => (i.kind === 'great' ? { ...i, detail: onwardText(i.detail, lr.sectionId, lr.ladder && lr.passed && step === 'slow' && lr.level > lr.newLevel) } : i));
  // Microphone trouble: advice for what the input monitor found (through the speaker, the backing in
  // the mic explains the "distortion"), and at level 1 the notes let off because of it.
  const advice = inputAdvice(lr.inputQuality).filter((a) => !(lr.speaker && a.kind === 'distortion'));
  const micNotes = everyNote ? r.notes.filter((n) => n.unsure === 'mic' && noteVerdict(n) === 'forgiven') : [];
  const micBars = [...new Set(micNotes.map((n) => part?.notes[n.index]?.measure).filter((m): m is number => m != null))].sort((a, b) => a - b);

  // Missed it: listening to the passage again, or singing it slower first, usually helps. After
  // misses in a row that's what comes first; the try at the step's tempo stays one tap away. (Not for
  // a run whose notes were right but late, or one through the phone's speaker: neither helps there.)
  const same = { name: 'play' as const, pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, mode: '2d' as const,
    ...(lr.sectionId === 'drill' ? { from: lr.from, to: lr.to, ...(lr.back ? { back: lr.back } : {}) } : {}) };
  const ladderSec = !!section;
  const listenAgain = () => goPlay({ ...same, level: 0, after: lr.level, step });
  // In tempo on a passage: its slow step (which counts). At slow (or elsewhere): slower practice.
  const toSlowStep = step === 'tempo' && ladderSec;
  const singSlowly = () => goPlay(toSlowStep ? { ...same, level: lr.level, step: 'slow' } : { ...same, level: lr.level, step, rate: slowRate(step) });
  const timingOnly = (lr.timingFail != null || entriesLate) && r.accuracy >= (spec?.pass ?? 0.8);
  // (nor when the microphone was the trouble: its advice comes first)
  const offerHelp = lr.ladder && !lr.passed && !lr.full && !speakerRun && !timingOnly && lr.mode === '2d' && advice.length === 0 && micNotes.length === 0;
  const stuck = offerHelp && failsInARow(piece.id, lr.partId, lr.sectionId, lr.level, step) >= STUCK_AFTER;
  const slowLabel = toSlowStep ? `Sing it slow (${Math.round(stepSpec(lr.level, 'slow').rate * 100)}%)`
    : `${step === 'slow' ? 'Sing it slower' : 'Practise slowly'} (${Math.round(slowRate(step) * 100)}%)`;
  /** Listening first is the help on Level 1 slow (the notes are new); elsewhere, singing slower. */
  const listenHelp = step === 'slow' && lr.level === 1;

  // What was sung, inside a sentence: "bars 22–29", "the whole piece".
  const whatSung = section ? lowerLabel(section.label) : lr.sectionId === 'all' ? 'the whole piece'
    : (() => {
      const a = ms.findIndex((m) => lr.from >= m.start - 1e-3 && lr.from < m.start + m.dur - 1e-3);
      let b = Math.max(0, a);
      for (let i = Math.max(0, a); i < ms.length && ms[i].start < lr.to - 1e-3; i++) b = i;
      return barRangeLabel(piece.score, Math.max(0, a), b, true);
    })();
  // The notes to fix: at an every-note step the wrong ones; at the other steps, after a miss of a
  // passage (not on timing alone), the notes below "good" that weren't let off.
  const fixNotes = wrong.length ? wrong
    : lr.ladder && !lr.passed && !lr.full && !timingOnly && lr.mode === '2d' && micNotes.length === 0 ? wrongNotes(r) : [];
  // The worst bar: the most notes to fix, then the biggest miss. The primary button loops it.
  const worstBar = (() => {
    const by = new Map<number, { n: number; c: number }>();
    for (const n of fixNotes) {
      const m = part?.notes[n.index]?.measure;
      if (m == null) continue;
      const e = by.get(m) ?? { n: 0, c: 0 };
      by.set(m, { n: e.n + 1, c: Math.max(e.c, Math.min(999, Math.abs(n.cents ?? 999))) });
    }
    let best: number | null = null;
    for (const [m, e] of by) {
      const b = best == null ? null : by.get(best)!;
      if (!b || e.n > b.n || (e.n === b.n && e.c > b.c)) best = m;
    }
    return best;
  })();
  const loopRate = slowRate(step);
  const loopWorst = worstBar == null || !ms[worstBar] ? null : () => goPlay({
    name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'drill', level: Math.max(1, lr.level), step, mode: '2d',
    from: ms[worstBar].start, to: ms[worstBar].start + ms[worstBar].dur,
    ...(loopRate < (spec?.rate ?? 1) - 1e-6 ? { rate: loopRate } : {}),
    ...(loopBack ? { back: loopBack } : {}),
  });
  // Level 1 in tempo: the entries that came in late (or weren't sung).
  const late = entriesLate && part ? lateEntries(part.notes, r.notes, lr.entriesOffsetMs ?? 0) : [];
  const lateBar = late.length ? late[0].measure : null;
  const loopEntry = lateBar == null || !ms[lateBar] ? null : () => goPlay({
    name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'drill', level: Math.max(1, lr.level), step: 'tempo', mode: '2d',
    from: ms[lateBar].start, to: ms[lateBar].start + ms[lateBar].dur,
    ...(loopBack ? { back: loopBack } : {}),
  });
  // A loop of a few bars: the passage step it came from (Route.back), else the passage the bars
  // belong to at its own current step.
  const loopHome = (() => {
    if (lr.sectionId !== 'drill' || lr.level < 1) return undefined;
    const fromBack = lr.back ? sections.find((s) => s.id === lr.back!.sectionId) : undefined;
    if (fromBack) return { sec: fromBack, level: lr.back!.level, step: lr.back!.step };
    const sec = sections.find((s) => lr.from >= s.start - 1e-3 && lr.from < s.end - 1e-3);
    if (!sec) return undefined;
    const sp = prog?.sections[sec.id];
    const cur = (sp?.level ?? 0) >= 5 ? { level: 5, step: 'tempo' as Step } : currentStep(sp);
    return { sec, level: cur.level, step: cur.step };
  })();
  // The next passage in score order (after a miss: move on, or come back later).
  const secIdx = section ? sections.findIndex((s) => s.id === section.id) : -1;
  const nextSec = secIdx >= 0 ? sections[secIdx + 1] : undefined;

  // The piece crossed a milestone in this run (rehearsal-ready, concert-ready, memorised).
  const before = lr.pieceBefore ?? lr.reached?.prevLevel ?? lr.full?.prevLevel;
  const after = lr.pieceAfter ?? lr.reached?.newLevel ?? lr.full?.newLevel;
  const crossed = lr.ladder && before != null && after != null && !/^(row|leaps)-/.test(piece.id) ? milestoneCrossed(before, after) : null;
  // The band takes the run's place only when the run itself was at that level (a clean run of the
  // whole piece, the last fix, a single passage); otherwise (e.g. a Level 4 run that also finished
  // the Level 3 fix list, or by heart on day 1) the run's own verdict stays, with a small note.
  const milestone = crossed && lr.level === crossed ? crossed : null;
  const milestoneNote = crossed && !milestone ? crossed : null;
  const notesRight = r.notes.filter((n) => noteVerdict(n) !== 'wrong').length;
  const allInTime = lr.timingFail == null && lr.timingUnsure == null && !entriesLate && r.rhythm >= 0.9;
  const notesLine = r.notes.length ? `${notesRight} of ${r.notes.length} notes right${allInTime ? ' · all in time' : ''}` : '';

  // The sticky footer: one next step (with why), then a second choice and the piece.
  const up = upOf(piece.id);
  const toPiece = () => leaveTo(up);
  const expertDrill = up.name === 'expert';
  const nextText = (n: NonNullable<typeof next>) => `Next: ${nextLabel(n, label)}`;
  const fixesLeft = nextFix ? fixesBefore(sections, prog, lr.level).length : 0;
  const play = (sectionId: string, level: number, mode: '2d' | '3d' = '2d', st?: Step) =>
    goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId, level, mode, ...(st && mode === '2d' ? { step: st } : {}) });
  const failed = lr.ladder && !lr.passed;
  const worstSlipped = lr.full ? [...lr.full.sections].filter((x) => !x.passed).sort((a, b) => a.accuracy - b.accuracy)[0] : undefined;
  let primary: FootStep & { repeats?: boolean };
  if (loopHome) {
    primary = {
      label: <><IconPlay size={18} /> Now sing {lowerLabel(loopHome.sec.label)} again</>, testid: 'passage-again',
      why: `${stepLabel(loopHome.level, loopHome.step)}: the whole passage, now the loop is in your ears.`,
      onClick: () => play(loopHome.sec.id, loopHome.level, '2d', loopHome.step),
    };
  } else if (lr.slow != null && lr.sectionId !== 'cold') {
    primary = { label: <><IconPlay size={18} /> Now at {Math.round((spec?.rate ?? 1) * 100)}%</>, why: `That was slower practice: now sing it at ${step === 'slow' ? 'the slow step’s tempo' : 'full tempo'}.`, testid: 'full-tempo', onClick: () => goPlay({ ...same, level: lr.level, step, mode: lr.mode }) };
  } else if (lr.full && step === 'slow' && lr.mode === '2d') {
    primary = { label: <><IconPlay size={18} /> Now in tempo</>, why: 'Only a run of the whole piece in tempo counts for the piece.', testid: 'now-in-tempo', onClick: () => play('all', lr.level, '2d', 'tempo') };
  } else if (lr.sectionId === 'cold') {
    primary = { label: <><IconPlay size={18} /> Another cold start</>, why: 'A new bar at random: find your way in from memory.', testid: 'cold-again', onClick: () => { startColdStart(piece, lr.partId, lr.from, true); } };
  } else if (!lr.ladder && !lr.notCounted) {
    primary = expertDrill
      ? { label: 'Back to expert mode', onClick: toPiece }
      : { label: 'Back to the piece', why: 'Drills are practice: they don’t change your levels.', testid: 'back-to-piece', onClick: toPiece };
  } else if (speakerRun) {
    primary = {
      label: <><IconPlay size={18} /> Sing it again with headphones on</>, why: 'Level 1 slow counts with headphones on.', testid: 'again-headphones', repeats: true,
      onClick: () => {
        saveProfile({ ...loadProfile(), headphones: true }); // what the button says
        play(lr.sectionId, lr.level, lr.mode, step);
      },
    };
  } else if (failed && !lr.full && loopWorst && worstBar != null) {
    // The diagnosis is the next step: loop the worst bar slowly.
    primary = {
      label: <><IconPlay size={18} /> Loop {cellName(worstBar).toLowerCase() === 'upbeat' ? 'the upbeat' : `bar ${mnum(worstBar)}`} slowly ({Math.round(loopRate * 100)}%)</>,
      why: 'then sing the passage again', testid: 'loop-bar', onClick: loopWorst,
    };
  } else if (failed && !lr.full && entriesLate && timingOnly && loopEntry && lateBar != null) {
    primary = {
      label: <><IconPlay size={18} /> Loop bar {mnum(lateBar)} in tempo</>,
      why: 'Breathe in the rest and come in with the beat, then sing the passage again', testid: 'loop-entry', onClick: loopEntry,
    };
  } else if (stuck) {
    primary = listenHelp
      ? { label: <><IconEar size={18} color="#0B0D1A" /> Listen again, then sing it</>, why: 'A few misses in a row: hear how it goes first.', testid: 'stuck-listen', onClick: listenAgain }
      : { label: <><IconPlay size={18} /> {slowLabel}</>, why: toSlowStep ? 'A few misses in a row: the slow step first (it counts), then in tempo.' : 'Slower runs don’t count, but they make the next try easier.', testid: 'stuck-slow', onClick: singSlowly };
  } else if (nextFix) {
    primary = {
      label: <><IconPlay size={18} /> Fix {lowerLabel(label(nextFix))} · Level {lr.level}</>, testid: 'fix-first', onClick: () => play(nextFix, lr.level, '2d', 'tempo'),
      why: `${fixesLeft > 1 ? `${fixesLeft} passages to fix` : 'One passage to fix'} on ${fixesLeft > 1 ? 'their' : 'its'} own, in tempo: no need to sing it all again.`,
    };
  } else if (lr.full?.tooMuch && worstSlipped) {
    // Too much slipped for the run to count: the passages first, the one that slipped most at the run's level.
    primary = {
      label: <><IconPlay size={18} /> {label(worstSlipped.id)} · {stepLabel(lr.level, step)}</>, testid: 'practise-sections',
      why: 'Too much slipped for the run to count: the passages first, starting with the one that slipped most.',
      onClick: () => play(worstSlipped.id, lr.level, '2d', step),
    };
  } else if (failed) {
    primary = {
      label: <><IconPlay size={18} /> Try again</>, testid: 'try-again', repeats: true, onClick: () => play(lr.sectionId, lr.level, lr.mode, step),
      why: entriesLate && timingOnly ? 'The notes were right: now come in on time at every entry.'
        : timingOnly ? 'The notes were right: now come in with the beat.'
          : everyNote ? 'At Level 1 slow every note must be right.'
            : `${spec?.label ?? `Level ${lr.level}`} needs ${notesShare(spec?.pass ?? 0.8)} right.`,
    };
  } else if (next) {
    primary = { label: <><IconPlay size={18} /> {nextText(next)}</>, why: nextReason(next, label), testid: 'next-step', onClick: () => play(next.sectionId, next.level, '2d', next.step) };
  } else if (pieceReadiness(sections, prog).pieceLevel < 5 && sections.length > 0) {
    // Nothing more today (by heart: day 2 waits for another day).
    primary = {
      label: <>Finish for today</>, testid: 'finish-primary', onClick: () => leaveTo({ name: 'home' }),
      why: pieceReadiness(sections, prog).pieceLevel === 4 && lr.level === 5 ? 'Day 2 from memory: come back tomorrow and sing it once more.' : 'Nothing more to do on this piece today.',
    };
  } else {
    primary = {
      label: <><IconCube size={18} color="#0B0D1A" /> {lr.full?.passed && lr.full.newLevel >= 5 ? 'Memorised!' : 'All done for today!'} Arcade run of the whole piece</>,
      why: 'Just for fun: arcade runs don’t count for a level.', testid: 'arcade-run', onClick: () => play('all', 4, '3d'),
    };
  }
  // An easier step after a miss (in tempo: the same level slow; slow, or the whole piece: the level
  // below in tempo).
  const easier: { level: number; step: Step } | null = failed && !nextFix
    ? (step === 'tempo' && !lr.full ? { level: lr.level, step: 'slow' } : lr.level > 1 ? { level: lr.level - 1, step: 'tempo' } : null)
    : null;
  const easierStep: FootStep | null = easier
    ? { label: `Easier: ${easier.level === lr.level ? stepWord(easier.step) : `${lr.sectionId === 'all' ? 'the whole piece at ' : ''}Level ${easier.level} in tempo`}`, testid: 'easier', onClick: () => play(lr.sectionId, easier.level, '2d', easier.step) }
    : null;
  const againStep: FootStep = {
    label: <><IconRestart size={16} /> {lr.slow != null ? 'Again, slowly' : 'Again'}</>,
    // (after a full run that opened its level: allowed any time, a new run replaces the fix list)
    testid: lr.sectionId === 'all' && nextFix ? 'sing-all-again' : 'again',
    onClick: () => goPlay({ ...same, level: lr.level, mode: lr.mode, ...(lr.mode === '2d' ? { step } : {}), ...(lr.sectionId === 'cold' ? { from: lr.from, to: lr.to } : {}), ...(lr.slow != null ? { rate: lr.slow } : {}) }),
  };
  // Second choice: after a miss of a passage the next passage (or the same one again); after a slow
  // pass the same bars in tempo; else the same run again (or an easier step).
  const diagnosed = primary.testid === 'loop-bar' || primary.testid === 'loop-entry';
  // (after a miss with the help card, "Try it again" is there; without it, it's this button)
  const tryAgain: FootStep = { ...againStep, label: <><IconRestart size={16} /> Try again</> };
  // (the primary already is this passage in tempo: no second button for it)
  const nextIsTempo = !!next && next.sectionId === lr.sectionId && next.level === lr.level && next.step === 'tempo' && primary.testid === 'next-step';
  let again: FootStep | null = diagnosed
    ? (nextSec && next && offerHelp ? { label: 'Next passage', testid: 'next-passage', onClick: () => play(nextSec.id, Math.min(5, (prog?.sections[nextSec.id]?.level ?? 0) + 1), '2d', stepFor(prog?.sections[nextSec.id], Math.min(5, (prog?.sections[nextSec.id]?.level ?? 0) + 1))) } : tryAgain)
    : stepUp && !nextIsTempo ? { label: 'Now in tempo', testid: 'now-in-tempo', onClick: () => play(lr.sectionId, lr.level, '2d', 'tempo') }
      : easierStep ?? (primary.repeats ? null : againStep);
  const passed = lr.ladder && lr.passed;

  // Today's session (started from Home's plan): once this step is done the footer moves on to the
  // next step of today; after a miss "Skip to next step" joins the help. Outside a session nothing changes.
  const foot = sessionFoot(piece.id, primary, again, passed && !lr.notCounted && primary.testid !== 'finish-primary',
    primary.testid === 'next-step' && next ? { sectionId: next.sectionId, level: next.level, step: next.step } : undefined);

  // ---- The main block: what happened, in one place (a milestone, a pass, or what to fix).
  const sp = section ? prog?.sections[section.id] : undefined;
  const main: React.ReactNode = milestone
    ? <MilestoneBand piece={piece} m={milestone} sections={sections} prog={prog} lr={lr} notesRight={notesRight} passName={passName} />
    : lr.ladder && lr.full ? <FullRunBanner lr={lr} full={lr.full} label={label} />
      : lr.notCounted || speakerRun ? <PracticeNotice lr={lr} speakerRun={speakerRun} wrongCount={wrong.length} />
        : lr.ladder && lr.passed ? (
          <PassCard lr={lr} step={step} passName={passName} sp={sp} leveledUp={leveledUp} stepUp={stepUp} everyNote={everyNote} />
        ) : lr.ladder ? (
          <div className="col verdict" style={{ gap: 4 }} role="status" data-testid="pass-banner">
            {fixNotes.length > 0 ? (
              <>
                <h2>Not yet: {fixNotes.length === 1 ? 'one note' : `${fixNotes.length} notes`} to fix.</h2>
                <p className="t16 muted" style={{ margin: 0 }}>{fixNotes.length === 1 ? 'Everything else' : 'The rest'} in {whatSung} was right.</p>
              </>
            ) : entriesLate && r.accuracy >= (spec?.pass ?? 0.8) ? (
              <>
                <h2>Not yet: come in on time.</h2>
                <p className="t16 muted" style={{ margin: 0 }}>
                  The notes were right ({Math.round(r.accuracy * 100)}%), but {lateText(late, mnum, lr.entries!)}. In tempo every entry counts:
                  breathe in tempo during the rest and come in with the beat.
                </p>
              </>
            ) : lr.timingFail != null && r.accuracy >= (spec?.pass ?? 0.8) ? (
              <>
                <h2>Not yet: come in with the beat.</h2>
                <p className="t16 muted" style={{ margin: 0 }}>
                  {lr.suggestDelayCheck
                    ? <>The notes were right ({Math.round(r.accuracy * 100)}%), but your voice reached the app about {lr.timingFail} ms after the beat. Either your headphones changed since the delay check (redo it in Voice setup, it takes 10 seconds) or you're singing behind the music: breathe early and sing with it, not after it.</>
                    : <>The notes were right ({Math.round(r.accuracy * 100)}%), but you came in about {lr.timingFail} ms behind the beat. Breathe early and sing with the music, not after it.</>}
                </p>
              </>
            ) : everyNote && micNotes.length ? (
              <>
                <h2>Not yet: the microphone got in the way.</h2>
                <p className="t16 muted" style={{ margin: 0 }}>{Math.round(r.accuracy * 100)}%: microphone trouble kept the app from hearing {micNotes.length === 1 ? 'one note' : `${micNotes.length} notes`} clearly, so the run can’t count. Fix the microphone (below) and try again.</p>
              </>
            ) : everyNote ? (
              <>
                <h2>Not yet: some notes were too unclear.</h2>
                <p className="t16 muted" style={{ margin: 0 }}>{Math.round(r.accuracy * 100)}%: too many notes were too unclear to judge. Sing every note on “doo”, clearly and steadily, and try again.</p>
              </>
            ) : (
              <>
                <h2>Not yet: {notesShare(spec?.pass ?? 0.8)} needed.</h2>
                <p className="t16 muted" style={{ margin: 0 }}>{Math.round(r.accuracy * 100)}% this time. Use the tips below and try again.</p>
              </>
            )}
          </div>
        ) : (
          <div className="col verdict" style={{ gap: 4 }} role="status" data-testid="drill-verdict">
            <h2>{notesRight} of {r.notes.length} notes right.</h2>
            <p className="t16 muted" style={{ margin: 0 }}>
              {lr.sectionId === 'cold' ? 'A cold start is practice: it doesn’t change your levels.' : 'Loops and drills are practice: they don’t change your levels.'}
            </p>
          </div>
        );

  return (
    <main className="screen practice has-foot results">
      <SessionStrip pieceId={piece.id} />
      <PracticeBar up={up} heading title={piece.title}
        sub={[part?.name, section ? lowerLabel(section.label) : (lr.sectionId === 'all' ? 'sing it all' : lr.sectionId === 'cold' ? 'cold start' : lr.sectionId === 'entries' ? 'entry drill' : whatSung), spec ? stepLabel(lr.level, step) : ''].filter(Boolean).join(' · ')} />

      {/* Wide screens: what happened (the verdict, the path) beside what to fix (the notes, bar by bar); the rest under it. */}
      <div className="lay res-cols">
      <div className="lay res-a">
      {main}

      {milestoneNote && (
        <div className="notice info" role="status" data-testid="milestone-note">
          <strong>{MILESTONES[milestoneNote]} ✓</strong> The whole piece is at {levelLabel(milestoneNote)} now.
        </div>
      )}
      {fixedNote && !milestone && (
        <div className="notice info" role="status" data-testid="fixed-banner">
          {fixedNote.remaining === 0
            ? <ReachedNote reach={lr.reached} level={fixedNote.level} />
            : <><strong>Fixed</strong> for Level {fixedNote.level}. {fixedNote.remaining} more passage{fixedNote.remaining > 1 ? 's' : ''} to fix and the piece reaches Level {fixedNote.level}.</>}
        </div>
      )}
      {lr.full && lr.reached && !milestone && (
        <div className="notice info" role="status" data-testid="fixed-banner">
          <ReachedNote reach={lr.reached} level={lr.reached.level} inRun />
        </div>
      )}

      {notesLine && !milestone && !fixNotes.length && <p className="t14 muted" style={{ textAlign: 'center', margin: 0 }} data-testid="notes-line">{notesLine}</p>}

      {passed && !lr.full && section && sections.length > 1 && !milestone && (
        <PathProgress sections={sections} prog={prog} label={label} />
      )}
      </div>

      <div className="lay res-b">
      {fixNotes.length > 0 && part && (
        <MistakeScore piece={piece} part={part} notes={fixNotes} tol={tol} level={lr.level} step={step} from={lr.from} to={lr.to} play={goPlay}
          focus focusBar={worstBar ?? undefined} back={loopBack}
          hear={(m0, m1) => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'drill', level: 0, mode: '2d', after: Math.max(1, lr.level), step,
            from: ms[m0].start, to: ms[m1].start + ms[m1].dur })} />
      )}
      {notesLine && fixNotes.length > 0 && <p className="t14 muted" style={{ textAlign: 'center', margin: 0 }} data-testid="notes-line">{notesLine}</p>}
      </div>

      <div className="lay res-c">
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
      {(advice.length > 0 || micBars.length > 0) && (
        <MicAdvice advice={advice} micBars={micBars.map((m) => barRangeLabel(piece.score, m, m, true))} />
      )}

      {offerHelp && (
        <div className="card flat" data-testid="help-card" style={{ gap: 8 }}>
          <strong className="t16">{stuck ? 'Tricky one: take it in smaller steps' : listenHelp ? 'Not there yet? Listen to it again' : 'Need a hand with it?'}</strong>
          <span className="t14 muted">
            {listenHelp
              ? 'Hear how it goes once more, then sing it. Or sing it slower: it won’t count, but the notes settle.'
              : toSlowStep
                ? 'Listen to the passage, or sing it slow first: the slow step counts too, and it makes the run in tempo easier.'
                : 'Listen to the passage, or sing it slower first: slower runs don’t count, but they make the next try easier.'}
          </span>
          <div className="row wrap" style={{ gap: 6 }}>
            {!(primary.testid === 'stuck-listen') && <button className="btn small" data-testid="help-listen" onClick={listenAgain}><IconEar size={16} /> {listenHelp ? 'Listen again' : 'Listen'}</button>}
            {!(primary.testid === 'stuck-slow') && <button className="btn small" data-testid="help-slow" onClick={singSlowly}>{slowLabel}</button>}
            {easierStep && again !== easierStep && <button className="btn small" data-testid="easier" onClick={easierStep.onClick}>{easierStep.label}</button>}
            {(stuck || diagnosed) && <button className="btn small" data-testid="help-again" onClick={() => goPlay({ ...same, level: lr.level, step, mode: lr.mode })}><IconPlay size={16} color="currentColor" /> Try it again{step === 'tempo' ? ' in tempo' : ''}</button>}
          </div>
        </div>
      )}

      {lr.full && lr.full.sections.length > 0 && (
        <div className="col" style={{ gap: 6 }} data-testid="full-sections">
          <h2 style={{ fontSize: 16 }}>Passage by passage</h2>
          {lr.full.sections.map((x) => {
            const fix = lr.full!.counted && lr.full!.toFix.includes(x.id);
            return (
              <div key={x.id} className="row" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--surface-2)' }} data-testid={fix ? 'full-section-fix' : 'full-section'}>
                <span className="grow t14 ellipsis" style={{ fontWeight: 600 }}>{label(x.id)}</span>
                <span className="mono t14" style={{ color: x.passed ? 'var(--voice)' : 'var(--accent-text)' }}>
                  {Math.round(x.accuracy * 100)}%{everyNote && x.wrong?.length ? ` · ${x.wrong.length} note${x.wrong.length > 1 ? 's' : ''}` : ''}
                </span>
                {fix ? (
                  <button className="btn small" style={{ minWidth: 112 }} onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: x.id, level: lr.level, mode: '2d' })}>
                    <IconPlay size={14} color="currentColor" /> Fix · Level {lr.level}
                  </button>
                ) : (
                  <span className="t14" style={{ minWidth: 112, textAlign: 'right', color: x.passed ? 'var(--voice)' : 'var(--muted)' }}>{x.passed ? (lr.full!.opened ? '✓ passed' : '✓ would pass') : 'below the mark'}</span>
                )}
              </div>
            );
          })}
          <span className="t14 muted">
            {everyNote
              ? 'Every note of every passage must be right. Very short notes the app can’t judge reliably are let off unless clearly wrong.'
              : `Each passage needs ${notesShare(spec?.pass ?? 0.8)} right within the run, like the run as a whole (short passages get one weak note of slack).`}
            {' '}A run opens the level when at most half of the passages slip and it reaches {Math.round((spec?.pass ?? 0.8) * 100) - 10}% overall; then the ones that slipped are yours to fix on their own, in tempo.
          </span>
        </div>
      )}

      <details className="card res-details" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)} data-testid="run-details">
        <summary className="row" style={{ cursor: 'pointer', minHeight: 44, listStyle: 'none' }}>
          {/* A practice run (it didn't count) shows its grade muted: not a pass. */}
          <div className="grade-tile small-tile" aria-label={`Grade ${letter}${lr.notCounted ? ' (practice)' : ''}`} data-testid="grade"
            style={lr.notCounted ? { background: 'var(--surface-2)', color: 'var(--muted)' } : undefined}>{letter}</div>
          <div className="col grow" style={{ gap: 2 }}>
            <span className="mono" style={{ fontSize: 22, fontWeight: 600 }} data-testid="result-score">{r.score.toLocaleString()}</span>
            <span className="t14" style={{ color: 'var(--voice)' }}>{Math.round(r.accuracy * 100)}% accuracy{isPB ? ' · new personal best!' : ''}</span>
          </div>
          <span className="t14 muted">Details</span>
          <span className="chev"><IconChevronDown size={18} /></span>
        </summary>
        <div className="col" style={{ gap: 12, paddingTop: 8 }}>
          <div className="stats3">
            <div className="stat"><span className="k">In tune</span><span className="v">{Math.round(r.pitch * 100)}%</span>{avgCents != null && <span className="k">on average {pitchWords(avgCents)}</span>}</div>
            <div className="stat"><span className="k">Rhythm</span><span className="v">{Math.round(r.rhythm * 100)}%</span></div>
            <div className="stat"><span className="k">Best combo</span><span className="v">{r.maxCombo}</span></div>
          </div>
          <div className="t14 muted mono">perfect {r.counts.perfect} · good {r.counts.good} · ok {r.counts.ok} · miss {r.counts.miss}</div>
        </div>
      </details>

      {measureIdx.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <div className="row between">
            <h2 style={{ fontSize: 16 }}>Bar by bar</h2>
            <span className="t14 muted">tap a bar to loop it</span>
          </div>
          <div className="heat">
            {measureIdx.map((m) => {
              const v = r.perMeasure[m];
              // Level 1: a bar with a wrong note needs work, whatever its average.
              const bg = wrongBars.has(m) ? '#FF7A45' : v >= 0.85 ? '#4CC9F0' : v >= 0.6 ? '#1D4F63' : '#FF7A45';
              return <button key={m} aria-label={`${cellName(m)}: ${Math.round(v * 100)}%`} title={`${cellName(m)} · ${Math.round(v * 100)}%`} style={{ background: bg, color: bg === '#1D4F63' ? '#EEF0FF' : '#0B0D1A', fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)' }} onClick={() => playLoop(m - 1, m + 1)}>{cellText(m)}</button>;
            })}
          </div>
          <div className="row t14 muted" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#4CC9F0' }} />solid</span>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#1D4F63' }} />ok</span>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#FF7A45' }} />needs work</span>
            <span className="grow" style={{ textAlign: 'right' }}>{barRangeLabel(piece.score, measureIdx[0], measureIdx[measureIdx.length - 1], true)}</span>
          </div>
        </div>
      )}

      {(lr.points || lr.streak) && (
        <div className="row wrap" style={{ gap: 8 }} data-testid="run-stats">
          <WeekPill />
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
                  <strong style={{ fontSize: 15 }}>{i.title}</strong>
                  <span className="t14 muted">{i.detail}</span>
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

      <div className="col" style={{ gap: 8 }}>
        <button className="btn ghost block" onClick={() => go({ name: 'ranks' })}>Leaderboard</button>
        <AccountTip />
        <ShareRecording pieceId={lr.pieceId} partId={lr.partId} />
      </div>
      </div>
      </div>

      <ResultsFoot primary={foot.primary} again={foot.again} toPiece={foot.primary.onClick === toPiece ? null : toPiece} finish={foot.finish} session={foot.session} skip={foot.skip} />
    </main>
  );
}

/** "your entries came in about 240 ms late on average", "the entries in bars 3 and 7 came in late; the one in bar 12 wasn't sung". */
function lateText(late: LateEntry[], num: (m: number) => string, e: { missed: number; entries: number; meanMs: number | null }): string {
  const bars = (xs: LateEntry[]) => listText([...new Set(xs.map((x) => num(x.measure)))]);
  const lateOnes = late.filter((x) => x.ms != null);
  const missed = late.filter((x) => x.ms == null);
  const parts: string[] = [];
  if (lateOnes.length) {
    const ms = Math.round(lateOnes.reduce((a, x) => a + x.ms!, 0) / lateOnes.length);
    parts.push(`${lateOnes.length === 1 ? 'the entry' : 'the entries'} in bar${new Set(lateOnes.map((x) => x.measure)).size > 1 ? 's' : ''} ${bars(lateOnes)} came in late (about ${ms} ms)`);
  }
  if (missed.length) parts.push(`${missed.length === 1 ? 'the one' : 'the ones'} in bar${new Set(missed.map((x) => x.measure)).size > 1 ? 's' : ''} ${bars(missed)} ${missed.length === 1 ? 'wasn’t' : 'weren’t'} sung`);
  if (parts.length) return parts.join('; ');
  return e.missed
    ? `${e.missed === 1 ? 'one entry wasn’t' : `${e.missed} of ${e.entries} entries weren’t`} sung`
    : `your entries came in about ${e.meanMs} ms late on average`;
}

/** A run that didn't count (stopped, slower, paused, through the speaker…): why, as the main message. */
function PracticeNotice({ lr, speakerRun, wrongCount }: { lr: LR; speakerRun: boolean; wrongCount: number }) {
  return (
    <div className="col verdict" style={{ gap: 6 }} role="status" data-testid="pass-banner">
      <h2>{speakerRun ? 'Practice: it didn’t count' : 'Practice run'}</h2>
      <p className="t16 muted" style={{ margin: 0 }}>
        {speakerRun
          ? <>Practice: Level 1 slow counts with headphones on, because through the speaker the app can’t hear every note reliably.{wrongCount > 0 ? ` ${wrongCount === 1 ? 'One note wasn’t' : `${wrongCount} notes weren’t`} right: see below.` : ''}</>
          : <>This run doesn’t count: {lr.notCounted}{lr.timingUnsure != null ? '.'
            : lr.full ? <>, so it doesn't count toward the piece's level.{lr.level === 5 && /peeked|showing/.test(lr.notCounted ?? '') ? ' When you feel ready, choose “Test: all hidden” and sing it without peeking.' : ' Sing it all in one go, in tempo, for it to count.'}</>
              : lr.level === 5 && !/stopped early/.test(lr.notCounted ?? '') ? <>, so it doesn't count toward memorising the passage yet. When you feel ready, choose “Test: all hidden” and sing it without peeking.</>
                : <>. Sing the whole passage at the step's tempo for it to count.</>}
          {lr.timingUnsure != null && <> <button className="linklike" onClick={() => go({ name: 'setup' })}>Open Voice setup</button></>}
          </>}
      </p>
    </div>
  );
}

/** What a passage asks next, in words: "in tempo, still on “doo”", "Level 2 · Words · slow: with the words". */
function nextForBars(level: number, slow: number): string {
  if (level >= 5) return 'by heart: sing it now and then to keep it';
  const cur = currentStep({ level, slow });
  const passedLevel = slow >= cur.level ? cur.level : level;
  if (cur.step === 'tempo' && passedLevel === cur.level) return `in tempo${stepSpec(cur.level, 'tempo').doo ? ', still on “doo”' : ''}`;
  return `${stepLabel(cur.level, cur.step)}: ${LEVEL_ASKS[cur.level].charAt(0).toLowerCase()}${LEVEL_ASKS[cur.level].slice(1)}`;
}

/** A passage passed: a quiet card (a slow step, or a level), with its meter and what's next for these bars. */
function PassCard({ lr, step, passName, sp, leveledUp, stepUp, everyNote }: {
  lr: LR; step: Step; passName: string; sp: SectionProgress | undefined; leveledUp: boolean; stepUp: boolean; everyNote: boolean;
}) {
  const level = lr.newLevel;
  const slow = lr.newSlow ?? (sp ? slowOf(sp) : 0);
  const fromMemory = lr.level === 5 && step === 'tempo' && lr.newLevel < 5;
  const right = lr.result.notes.filter((n) => noteVerdict(n) !== 'wrong').length;
  const title = fromMemory ? 'Sung from memory ✓'
    : leveledUp ? `${levelLabel(lr.newLevel)} ✓`
      : stepUp ? `Level ${lr.level} · slow ✓`
        : `${stepLabel(lr.level, step)} ✓`;
  const line = fromMemory ? `Day ${lr.offBookDays ?? 1} of ${OFF_BOOK_DAYS}: sing it by heart again on another day and the passage is memorised.`
    : `${everyNote ? 'Every note right.' : `${right} of ${lr.result.notes.length} notes right.`}${leveledUp && lr.newLevel >= 5 ? ' This passage is memorised.' : leveledUp && lr.newLevel === 4 ? ' This passage is concert-ready.' : leveledUp && lr.newLevel === 3 ? ' This passage is rehearsal-ready.' : !leveledUp && !stepUp && lr.newLevel > 0 ? ` It keeps Level ${lr.newLevel}.` : ''}`;
  const now = level < 5 ? currentStep({ level, slow }) : null;
  return (
    <div className="step-up" role="status" data-testid="pass-banner">
      <span className="eb">{passName}</span>
      <h2>{title}</h2>
      <p className="t16">{line}</p>
      <div className="row" style={{ gap: 10 }}>
        <LevelMeter nodes={meterNodes({ level, slow, now })} label={passName} />
        <span className="t14 muted">Next for these bars: {nextForBars(level, slow)}</span>
      </div>
    </div>
  );
}

/** Where the piece stands after a passage pass: how many passages are through the step (B6). */
function PathProgress({ sections, prog, label }: { sections: Section[]; prog: PieceProgress | undefined; label: (id: string) => string }) {
  const ps = pathStatus(sections, prog);
  const n = sections.length;
  const W = ps.working;
  const headline = !W ? 'Every passage by heart ✓'
    : ps.fixes.length ? ps.here
      : ps.allInTempo ? `All ${n} passages at Level ${W.level} ✓`
        : W.step === 'tempo' ? `All ${n} passages at Level ${W.level} · slow ✓`
          : `${ps.done.length} of ${n} passages at Level ${W.level} · slow`;
  const nextLine = !W ? 'Sing it through once a week to keep it.'
    : ps.allInTempo ? 'Next: sing it all through, in tempo.'
      : W.step === 'tempo' ? 'Next: in tempo.'
        : `Next: slow, ${ps.todo.length === 1 ? 'one more passage' : `${ps.todo.length} more passages`}.`;
  // Passages grouped by where they stand (in score order of the group's first passage).
  const groups: { key: string; ids: string[]; sp: SectionProgress | undefined }[] = [];
  for (const s of [...sections].sort((a, b) => a.index - b.index)) {
    const sp = prog?.sections[s.id];
    const key = `${sp?.level ?? 0}|${slowOf(sp)}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.ids.push(s.id); else groups.push({ key, ids: [s.id], sp });
  }
  return (
    <div className="card" data-testid="path-progress" style={{ gap: 8 }}>
      <span className="eb">Your path{W ? ` · ${levelLabel(W.level)}` : ''}</span>
      <h2 style={{ fontSize: 20 }}>{headline}</h2>
      <div className="checklist">
        {groups.map((g) => {
          const st = passageStatus(g.sp);
          // (the headline names the level: "slow ✓" says the rest)
          const short = W && st.text.startsWith(`Level ${W.level} · `) ? st.text.slice(`Level ${W.level} · `.length)
            : W && st.text.startsWith(`Working on Level ${W.level} · `) ? 'still to do' : st.text;
          return (
            <div key={g.key} className="li" style={{ minHeight: 44 }}>
              <LevelMeter nodes={meterNodes({ level: g.sp?.level ?? 0, slow: g.sp?.slow })} label={joinLabels(g.ids.map(label))} />
              <span className="grow t16">{joinLabels(g.ids.map(label))}</span>
              <span className="t14" style={{ color: st.done ? 'var(--good)' : 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{short}</span>
            </div>
          );
        })}
      </div>
      <p className="t14 muted" style={{ margin: 0 }}>{nextLine}</p>
    </div>
  );
}

const MILESTONE_LINES: Record<number, string> = {
  3: 'Every passage at Level 3 in tempo: you can hold your part without the piano.',
  4: 'Every passage at Level 4 in tempo: no note names, just the starting chord.',
  5: 'From memory, in tempo, on two different days.',
};

/** The whole piece reached Level 3, 4 or 5 in this run: the calm, full-width milestone (B7). */
function MilestoneBand({ piece, m, sections, prog, lr, notesRight, passName }: {
  piece: PieceInfo; m: 3 | 4 | 5; sections: Section[]; prog: PieceProgress | undefined; lr: LR; notesRight: number; passName: string;
}) {
  const cycle = loadCycle();
  const inCycle = cycle.pieceIds.includes(piece.id);
  const nr = inCycle ? nextRehearsal(cycle) : null;
  const toConcert = inCycle ? daysUntil(cycle.concertDate) : null;
  const when = m === 3 && nr && nr.days > 1 ? `, ${nr.days} days before ${nr.at.toLocaleDateString(undefined, { weekday: 'long' })}`
    : m === 3 && nr && nr.days === 1 ? ', the day before rehearsal'
      : m === 4 && toConcert != null && toConcert > 1 ? `, ${toConcert} days before the concert` : '';
  const P = pieceReadiness(sections, prog).pieceLevel;
  const concertShort = cycle.concertDate ? new Date(`${cycle.concertDate}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  const goals: Record<number, string> = inCycle && concertShort && P < 4 && toConcert != null && toConcert >= 0 ? { 4: concertShort } : {};
  const spec = stepSpec(lr.level, 'tempo');
  const total = lr.result.notes.length;
  // What actually happened: a run of the whole piece (a clean one earns a ★), or the last passage to fix.
  const notes = total ? `${notesRight} of ${total} notes right` : '';
  const passLine = lr.full
    ? `${notes ? `${notes}: a pass (${shareWords(spec.pass)} needed).` : ''}${lr.full.clean ? ' Every passage right in one go: a clean run ★.' : ''}`
    : lr.reached && sections.length > 1
      ? `${passName} was the last passage to fix${notes ? ` (${notes})` : ''}.`
      : notes ? `${notes}: a pass (${shareWords(spec.pass)} needed).` : '';
  const took = startedDays(piece.id, lr.partId);
  const nextGoal = m === 3
    ? { h: `Concert-ready${goals[4] ? ` by ${goals[4]}` : ''}`, p: `Level 4 in tempo: no note names, just the starting chord. Until then ${piece.title} comes back once a week for a run-through, so it stays ready.` }
    : m === 4 ? { h: 'By heart', p: 'Level 5: from memory, in tempo, on two different days. Until then it comes back once a week for a run-through.' }
      : { h: 'Keep it fresh', p: `Sing ${piece.title} through once a week, so it stays by heart.` };
  return (
    <>
      <section className="band" role="status" data-testid="milestone">
        <h2>{MILESTONES[m]} ✓</h2>
        <p className="t16"><strong>{piece.title}{when}.</strong> {MILESTONE_LINES[m]}</p>
        <LevelMeter size="lg" nodes={meterNodes({ level: P, goals })} label={piece.title} />
        <span className="t14 muted">
          {passLine}
          {took != null && took >= 1 && <><br />From your first run to Level {m} in {took} day{took === 1 ? '' : 's'}.</>}
        </span>
      </section>
      <div className="card" data-testid="next-goal">
        <h2 style={{ fontSize: 20 }}><span className="muted" style={{ fontWeight: 700 }}>Next goal:</span> {nextGoal.h}</h2>
        <p className="t14 muted" style={{ margin: 0 }}>{nextGoal.p}</p>
      </div>
    </>
  );
}

/** Whole days since the first sung run of this piece and part on this phone (the attempt log), or null. */
function startedDays(pieceId: string, partId: string): number | null {
  let first: number | null = null;
  for (const e of attemptLog()) if (e.pieceId === pieceId && e.partId === partId && e.level >= 1 && (first == null || e.at < first)) first = e.at;
  if (first == null) return null;
  const a = new Date(first);
  const b = new Date();
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86_400_000);
}

/** The sticky footer of Results: one primary step (and why, under it), a second choice and the piece, and on a pass "Finish for today". */
function ResultsFoot({ primary, again, toPiece, finish, session, skip }: { primary: FootStep; again: FootStep | null; toPiece: (() => void) | null; finish?: boolean; session?: boolean; skip?: FootStep | null }) {
  return (
    <div className="results-foot" data-testid="results-foot">
      <button className="btn primary block two" data-testid={primary.testid} onClick={primary.onClick}>
        <span>{primary.label}</span>
        {primary.why && <span className="sub why" data-testid="results-why">{primary.why}</span>}
      </button>
      {(again || toPiece) && (
        <div className="row" style={{ gap: 8 }}>
          {again && <button className="btn small" data-testid={again.testid} onClick={again.onClick}>{again.label}</button>}
          {toPiece && <button className="btn small" data-testid="to-piece" onClick={toPiece}>Back to the piece</button>}
        </div>
      )}
      {(finish || skip) && (
        <div className="foot-links">
          {skip && <button className="link" data-testid={skip.testid} onClick={skip.onClick}>{skip.label}</button>}
          {finish && <button className="link" data-testid="finish-today" onClick={() => { if (session) finishToday(); leaveTo({ name: 'home' }); }}>Finish for today</button>}
        </div>
      )}
    </div>
  );
}

/** The "excellent run" note says what's next; after a drill or a cold start that isn't a new level. */
function onwardText(detail: string, sectionId: string, slowPass = false): string {
  const onward = slowPass ? 'Now sing it in tempo: that completes the level.'
    : sectionId === 'cold' ? 'Try another cold start, or go back to the piece.'
    : sectionId === 'drill' ? 'Now sing the whole passage.'
      : sectionId === 'entries' ? 'Come back to the entries now and then to keep them sure.'
        : null;
  return onward ? detail.replace(/Move on to the next level or the next passage\.?$/, onward) : detail;
}

const READY: Record<number, string> = { 3: 'The piece is rehearsal-ready.', 4: 'The piece is concert-ready.', 5: 'The piece is memorised.' };

type LR = NonNullable<ReturnType<typeof getLastResult>>;

/** The whole piece reached a level: by the last fix of the run that opened it (or, `inRun`, by sections that held in this run). */
function ReachedNote({ reach, level, inRun }: { reach?: LR['reached']; level: number; inRun?: boolean }) {
  const how = inRun ? `The passages left to fix at Level ${level} held in this run` : 'Nothing left to fix';
  if (!reach) return <><strong>Fixed!</strong> Nothing left to fix at Level {level}.</>;
  if (reach.level === 5 && reach.newLevel < 5) {
    return <><strong>Fixed!</strong> {how}: the whole piece is sung from memory, day {reach.offBookDays ?? 1} of {OFF_BOOK_DAYS}. Sing it all off book again on another day and it counts as memorised.</>;
  }
  return reach.newLevel > reach.prevLevel
    ? <><strong>Fixed! The whole piece reached {levelLabel(reach.newLevel)}.</strong> {how}, so the level is yours: no need to sing it all again. {READY[reach.newLevel] ?? ''}</>
    : <><strong>Fixed!</strong> {how} at Level {level}. The piece keeps Level {reach.newLevel}.</>;
}

/** The verdict on a counted run of the whole piece: the piece level, what to fix, or too much slipped. */
function FullRunBanner({ lr, full, label }: { lr: LR; full: NonNullable<LR['full']>; label: (id: string) => string }) {
  // (only runs in tempo count for the piece)
  const spec = stepSpec(lr.level, 'tempo');
  const everyNote = !!spec.everyNote && !!lr.everyNote;
  const need = Math.round(spec.pass * 100);
  const entriesLate = !!lr.entries && !lr.entries.ok;
  const acc = Math.round(lr.result.accuracy * 100);
  const up = full.newLevel > full.prevLevel;
  const fixes = full.toFix.map(label);
  const list = fixes.length <= 3 ? fixes.join(', ') : `${fixes.slice(0, 3).join(', ')} and ${fixes.length - 3} more`;
  const slipped = full.sections.filter((x) => !x.passed).length;
  const star = full.clean ? <> <strong data-testid="clean-run">Clean run! Every passage right in one go{'\u00a0'}<span aria-hidden="true">★</span></strong></> : null;
  // Opened above the piece level: fixing the slips reaches it. At or below it: the piece keeps its level.
  const reaches = lr.level > full.prevLevel;
  return (
    <div className={full.passed ? 'notice info' : 'notice'} role="status" data-testid="pass-banner">
      {full.passed && lr.level === 5 && full.newLevel < 5
        ? <><strong>The whole piece from memory!</strong> That's day {full.offBookDays ?? 1} of {OFF_BOOK_DAYS}: do it again on another day and the piece counts as memorised.{up ? ' (And it’s concert-ready now.)' : ''}{star}</>
        : full.passed && up
          ? <><strong>The whole piece reached {levelLabel(full.newLevel)}!</strong>{star} {READY[full.newLevel] ?? ''}</>
          : full.passed
            ? <><strong>Passed.</strong> The piece keeps Level {full.newLevel}.{star}</>
            : full.tooMuch
              ? <><strong>Too much slipped for this run to count</strong> ({slipped} of {full.sections.length} passages{everyNote ? ' had a note that wasn’t right' : ` were below ${need}%`}, {acc}% overall). A run opens the level when at most half of the passages slip and it reaches {need - 10}% overall. Practise the passages, then sing it all again.</>
              : fixes.length && !reaches
                ? <><strong>The piece keeps Level {full.prevLevel}.</strong> {list} slipped in this run: practise {fixes.length > 1 ? 'each one' : 'it'} at Level {lr.level} in tempo on its own (marked below).</>
                : fixes.length
                  ? <><strong>Level {lr.level} is open{full.overallPassed ? `: ${acc}% overall` : ''}.</strong> {list} {fixes.length > 1 ? 'were' : 'was'} below {need}% in the run. Fix {fixes.length > 1 ? 'each one' : 'it'} at Level {lr.level} in tempo on its own (marked below) and {lr.level === 5 ? 'the whole piece counts as sung from memory' : `the piece reaches Level ${lr.level}`}. No need to sing it all again.</>
                  : entriesLate && lr.result.accuracy >= spec.pass
                    ? <><strong>Not yet: come in on time.</strong> The notes were right ({acc}%), but {lr.entries!.missed
                      ? `${lr.entries!.missed === 1 ? 'one entry wasn’t' : `${lr.entries!.missed} of ${lr.entries!.entries} entries weren’t`} sung`
                      : `your entries came in about ${lr.entries!.meanMs} ms late on average`}. Breathe in tempo during the rests and come in with the beat.</>
                    : lr.timingFail != null
                      ? <><strong>Not yet:</strong> the notes were right ({acc}%), but you came in about {lr.timingFail} ms behind the beat. Breathe early and sing with the music, not after it.</>
                      : everyNote
                        ? <><strong>Not yet:</strong> {acc}%: too many notes were too unclear to judge. Sing every note on “doo”, clearly and steadily.</>
                        : <><strong>Not yet:</strong> {acc}% this time; {notesShare(spec.pass)} right needed.</>}
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
  const foot = sessionFoot(piece.id, {
    label: <><IconPlay size={18} /> {nextStage != null ? `Next: ${STAGE_NAMES[nextStage]}` : 'Again'}</>, onClick: again, testid: 'words-again',
    why: nextStage != null ? (nextStage === 1 ? 'Now with only the first letter of each word.' : 'Now from memory, with nothing shown.')
      : res.accuracy >= WORDS_PASS ? undefined : `${Math.round(WORDS_PASS * 100)}% of the syllables in time to move on.`,
  }, { label: 'Lyrics quiz', onClick: () => go({ name: 'lyrics', pieceId: piece.id, partId: lr.partId }), testid: 'lyrics-quiz' }, false);
  return (
    <main className="screen practice has-foot">
      <SessionStrip pieceId={piece.id} />
      <PracticeBar up={up} heading title={piece.title} sub={`${part?.name ?? ''} · ${section?.label ?? 'Whole piece'} · Words: ${STAGE_NAMES[words.stage]}`} />
      <div className={res.accuracy >= WORDS_PASS ? 'notice info' : 'notice'} role="status" data-testid="words-banner">
        {!words.counted
          ? <><strong>Practice run</strong> (slower tempo or stopped early): do it at 100% tempo to move on.</>
          : words.newStage
            ? <><strong>{STAGE_NAMES[words.stage]}: done!</strong> {words.stage === 2 ? 'You know the words of this passage by heart.' : `Next: ${STAGE_NAMES[words.stage + 1]}.`}</>
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
      <ResultsFoot primary={foot.primary} again={foot.again} toPiece={() => leaveTo(up)} finish={foot.finish} session={foot.session} skip={foot.skip} />
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
          openAccount('create');
        }}>Make an account</button>
        <button className="btn small ghost" onClick={() => { dismissAccountTip(); setShow(false); }}>Not now</button>
      </div>
    </div>
  );
}

/** The week, not a streak to lose: "3 days · goal 4 this week". */
function WeekPill() {
  const w = useWeek();
  return <span className="pill" data-testid="run-week">{weekText(w.count, w.goal)} this week</span>;
}
