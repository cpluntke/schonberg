import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../router';
import { dropGuard, go, leaveTo, practiceParent, pushGuard, useBackGuard } from '../router';
import { getPiece, noteRangeFor, singableSections, needsPartChoice, partChoices, rememberPart } from '../library';
import { useMedia, useProfile, useWide } from '../hooks';
import {
  MAX_LEVEL, OFF_BOOK_DAYS, effectiveTolerance, entriesOnTime, fixesBefore, fullRunCounts, pieceReadiness, sectionRunCounts,
  speakerPractice, stepFor, stepLabel, stepSpec, type EntriesCheck, type Step,
} from '../../progress/ladder';
import { shareMyProgress } from '../play/shareProgress';
import { postBoardEntrySoon } from '../play/boardEntry';
import { syncProgressSoon, suggestAccount } from '../../progress/sync';
import { recordAttempt, recordFullRun, getProgress, snapshotReadiness, personalBest, practiceDisplay, loadProfile, streakDays } from '../../progress/store';
import { addCyclePoints, rightNotes } from '../../progress/points';
import { startPresence } from '../../progress/presence';
import { keyAtTimeIn } from '../../music/keymarks';
import { nameKeysOf } from '../../progress/keymarks';
import { PracticeSession, estimateLatencyMs } from '../play/session';
import { medianOnsetMs, scoreAligned } from '../../game/align';
import { soloTimingInsight } from '../../game/analysis';
import { exposedNotes } from '../../music/exposure';
import { leadInFrom } from '../../game/coldstart';
import { WordsPlay } from './WordsPlay';
import { beatGrid } from '../../audio/player';

/** Median entry this late (real ms) fails a level-2+ run even with the right notes (measured delay only). */
const LATE_FAIL_MS = 250;
/** Section ids that are not ladder sections (runs never change levels). */
const GENERATED_SECTIONS = new Set(['all', 'drill', 'entries', 'cold']);
/** Singing along with the guide, a run can only teach a delay this far above the device estimate. */
const GUIDE_LEARN_MAX_ABOVE = 150;
import { trackPlayRun } from '../usage';
import { track } from '../../progress/metrics';
import { setLastRun } from '../play/runExport';
import { getBars, knownByHeart, provenOffBook, recordBars } from '../../progress/bars';
import { drawHighway2D, pitchWindow, wordInitial, type DrawState } from '../play/highway2d';
import { drawScoreView } from '../play/fullscore2d';
import { defaultShow, hasOtherStaves, isFullScore } from '../play/fullscore';
import { drawArcade, lanesFor, newFx } from '../play/arcade3d';
import { setLastResult } from '../play/lastResult';
import { useResume } from '../play/useResume';
import { IconBack, IconChevronDown, IconEar, IconHome, IconPause, IconPlay, IconRestart, IconStop } from '../icons';
import { passRule, taskSentence } from '../play/prerun';
import { pitchReadout, toleranceWords } from '../../game/pitchwords';
import { barsDone, liveReading, runProgress } from '../play/readout';
import { noteLabel } from '../../game/notation';
import { lowerLabel, troubleNote } from '../path';
import { getNoteStats } from '../../progress/notestats';
import { barRangeLabel } from '../../music/sections';
import { STUCK_AFTER, failsInARow, firstTime, markSeen, slowRate } from '../../progress/struggle';
import type { AttemptResult } from '../../game/types';
import type { NotationMode } from '../../game/notation';
import { NotFound } from '../components/NotFound';
import { PracticeBar } from '../components/PracticeBar';
import { SessionStrip } from '../components/Today';
import { noteReached } from '../../progress/today';
import { skipTarget } from '../play/skip';
import { recordNotes } from '../../progress/notestats';

type PlayRoute = Extract<Route, { name: 'play' }>;

export function PlayScreen({ route }: { route: PlayRoute }) {
  return route.words ? <WordsPlay route={route} /> : <SingPlay route={route} />;
}

/** Why a Level 1 slow run without headphones didn't count (LastResult.notCounted; Results shows its own text). */
const SPEAKER_PRACTICE = 'Level 1 slow counts with headphones on';

function SingPlay({ route }: { route: PlayRoute }) {
  const [profile, updateProfile] = useProfile();
  const piece = getPiece(route.pieceId);
  const part = piece?.score.parts.find((p) => p.id === route.partId);
  // A drill made for the day (the tricky leaps, the twelve-tone row): no piece levels, no passages.
  const drill = !!piece && /^(row|leaps)-/.test(piece.id);
  const drillWhat = piece && /^leaps-/.test(piece.id) ? 'your tricky leaps' : 'the twelve-tone row';
  const level = Math.max(0, Math.min(MAX_LEVEL, route.level | 0));
  const listenOnly = level === 0;
  // The step (docs/LEVELS.md): from the route, else the passage's current step for this level. Full
  // runs count only in tempo; drills keep what the level used to sing at (Level 1: slow); the
  // arcade is always in tempo. Listening: the step to sing after it.
  const [step] = useState<Step>(() => {
    if (route.mode === '3d') return 'tempo';
    if (route.step) return route.step;
    const lv = listenOnly ? route.after ?? 1 : level;
    if (route.sectionId === 'all') return 'tempo';
    if (GENERATED_SECTIONS.has(route.sectionId)) return lv === 1 ? 'slow' : 'tempo';
    return piece && part ? stepFor(getProgress(piece.id, part.id)?.sections[route.sectionId], lv) : 'slow';
  });
  const spec = level === 0 ? null : stepSpec(level, step);

  const section = useMemo(() => {
    if (!piece) return null;
    if (GENERATED_SECTIONS.has(route.sectionId)) {
      const from = route.from ?? 0;
      const to = route.to ?? piece.score.duration;
      const bar = piece.score.measures.find((m) => Math.abs(m.start - from) < 1e-3);
      const label = route.sectionId === 'all' ? (drill ? (/^leaps-/.test(piece.id) ? 'Your tricky leaps' : 'The row') : 'Whole piece') : route.sectionId === 'entries' ? 'Entry drill'
        : route.sectionId === 'cold' ? `Cold start: bar ${bar?.number ?? ''}` : 'Drill';
      return { id: route.sectionId, label, start: from, end: to };
    }
    const s = piece.sections.find((x) => x.id === route.sectionId);
    // Ladder sections always run whole (bar-range loops use the 'drill' section).
    return s ? { id: s.id, label: s.label, start: s.start, end: s.end } : null;
  }, [piece, route]);

  // "Practise slowly" (from the results screen): start at that tempo; it's practice, not a counted run.
  const [rateOverride, setRateOverride] = useState<number | null>(() => (route.rate != null && route.rate < (spec?.rate ?? 1) - 1e-6 ? route.rate : null));
  const [slowShown, setSlowShown] = useState(() => route.rate != null);
  // "change" on the pre-run card's headphones line: show the Yes / No question again.
  const [hpEdit, setHpEdit] = useState(false);
  // First-run "how to read the screen", once per display (the highway's flag predates the score view).
  const [howtoSeen, setHowtoSeen] = useState<{ score: boolean; highway: boolean } | null>(() => {
    try {
      if (route.mode !== '2d' || route.level === 0) return null;
      if (typeof matchMedia === 'function' && matchMedia('(max-height: 520px)').matches) return null; // hidden in landscape
      return {
        score: localStorage.getItem('sh:seenHowto:score') === '1',
        highway: localStorage.getItem('sh:seenHowto') === '1' || localStorage.getItem('sh:seenHowto:highway') === '1',
      };
    } catch { return null; }
  });
  const rate = rateOverride ?? spec?.rate ?? 1;
  const [phase, setPhase] = useState<'ready' | 'running' | 'paused' | 'micError'>('ready');
  // A piece where the singer's part isn't obvious (a split section, unreadable names): ask once.
  const [askPart, setAskPart] = useState(() => !!piece && route.mode === '2d' && !/~|^(row|leaps)-/.test(piece.id) && needsPartChoice(piece, profile.voice));
  const [micMsg, setMicMsg] = useState('');
  const [listened, setListened] = useState(false);
  const [hud, setHud] = useState<Hud>({ score: 0, combo: 0, count: 0, lyricIdx: -1, skip: null, done: 0, rd: null });
  const [gains, setGains] = useState<Record<string, number>>(() => {
    const g: Record<string, number> = {};
    for (const p of piece?.score.parts ?? []) {
      if (p.id === route.partId) g[p.id] = level === 0 || (level <= 2) ? 0.9 : 0;
      else g[p.id] = p.voiceType === 'other' ? 0.55 : 0.7;
    }
    return g;
  });
  const sessionRef = useRef<PracticeSession | null>(null);
  const headphonesRef = useRef<boolean | undefined>(undefined);
  const { resume, resuming, resumeMsg } = useResume(sessionRef, setPhase, setMicMsg);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef(newFx());

  const range = piece && part && section ? noteRangeFor(piece, part.id, section.start, section.end) : null;

  // Off book (level 5): your notes and words fade out bar by bar as you know them by heart
  // ("practise"), or are all hidden ("test", the run that counts). Hold Peek to see the next bars.
  const offBook = level === 5;
  const sectionMeasures = useMemo(() => {
    if (!piece || !section) return [] as number[];
    const withNotes = new Set(part?.notes.map((n) => n.measure) ?? []);
    return piece.score.measures.filter((m) => m.start >= section.start - 1e-6 && m.start < section.end - 1e-6 && withNotes.has(m.index)).map((m) => m.index);
  }, [piece, section, part]);
  const known = useMemo(() => {
    if (!offBook || !piece || !part || /~|^(row|leaps)-/.test(piece.id)) return new Set<number>();
    const bars = getBars(piece.id, part.id);
    return new Set(sectionMeasures.filter((m) => knownByHeart(bars[m])));
  }, [offBook, piece, part, sectionMeasures]);
  // Straight to the test only when every bar has been sung well while hidden.
  const allKnown = useMemo(() => {
    if (!offBook || !piece || !part || !sectionMeasures.length || /~|^(row|leaps)-/.test(piece.id)) return false;
    const bars = getBars(piece.id, part.id);
    return sectionMeasures.every((m) => provenOffBook(bars[m]));
  }, [offBook, piece, part, sectionMeasures]);
  const [obMode, setObMode] = useState<'fade' | 'test'>(() => 'fade');
  const cold = route.sectionId === 'cold';
  const effMode: 'fade' | 'test' = allKnown || cold ? 'test' : obMode;
  const hiddenRef = useRef<Set<number>>(new Set());
  hiddenRef.current = !offBook ? new Set() : effMode === 'test' ? new Set(sectionMeasures) : known;
  const modeRef = useRef(effMode);
  modeRef.current = effMode;
  const peekRef = useRef<{ until: number; measures: Set<number> }>({ until: 0, measures: new Set() });
  const [peeks, setPeeks] = useState(0);
  function peekStart() {
    const s = sessionRef.current;
    if (!s || !piece) return;
    const pos = s.position;
    const ms = piece.score.measures;
    const cur = ms.findIndex((m) => pos >= m.start - 1e-6 && pos < m.start + m.dur - 1e-6);
    const at = cur >= 0 ? cur : ms.findIndex((m) => m.start >= pos);
    const show = new Set([at, at + 1].filter((m) => m >= 0 && hiddenRef.current.has(m)));
    if (!show.size) return;
    for (const m of show) s.peeked.add(m);
    peekRef.current = { until: performance.now() + 2000, measures: show };
    setPeeks((n) => n + 1);
  }
  function peekEnd() {
    peekRef.current = { until: 0, measures: new Set() };
  }
  const tolerance = spec ? effectiveTolerance(level, step, profile.strictness) : 50;
  const showNames = spec ? spec.showNames : true;
  // Level 1 is sung on "doo": the words stay on screen, dimmed, for orientation.
  const doo = !!spec?.doo;
  const notation = profile.notation as NotationMode;
  // 2D practice: sheet music or the note highway (the arcade is always 3D).
  const display = route.mode === '3d' ? 'highway' : practiceDisplay(profile, level);
  const showHowto = !!howtoSeen && !howtoSeen[display];
  // Wide screens (laptop, tablet in landscape) show the full score: all voices, plus the
  // accompaniment when it stays readable.
  const wide = useWide();
  const autoStaves = useMemo(() => (piece && part ? defaultShow(piece.score, part.id) : 'voices'), [piece, part]);
  const staves = profile.scoreStaves ?? autoStaves;
  // Sheet music scrolls smoothly past the playhead (one long line) unless the singer prefers pages.
  const scorePages = !!profile.scorePages;
  const others = useMemo(() => (piece && part ? hasOtherStaves(piece.score, part.id) : { voices: false, accompaniment: false }), [piece, part]);
  const fullScore = useMemo(() => wide && display === 'score' && !!piece && !!part && isFullScore(piece.score, part.id, staves),
    [wide, display, piece, part, staves]);
  // The score view on a phone: the live reading in big words above the music (not in landscape,
  // where the height is the music's); the canvas then draws only the voice dot, not its bubble.
  const short = useMedia('(max-height: 520px)');
  // (not off book: the hidden notes have no reading to show, it would say "Listening…" all run)
  const readoutOn = route.mode === '2d' && display === 'score' && !fullScore && !listenOnly && !short && !offBook;
  // A run over more than one passage (the whole piece, a long stretch): a strip of its bars.
  const progress = useMemo(() => (piece && section && route.mode === '2d' ? runProgress(piece.score, piece.sections, section.start, section.end) : null),
    [piece, section, route.mode]);
  /** Tapping what Automatic would show keeps Automatic (nothing is pinned). */
  const pickStaves = (v: 'mine' | 'voices' | 'all') => updateProfile({ scoreStaves: v === autoStaves ? undefined : v });
  const singerIsHigh = profile.voice === 'S' || profile.voice === 'A';
  const partIsHigh = part ? part.voiceType === 'S' || part.voiceType === 'A' : singerIsHigh;
  // Singing a part written for the other voice range (e.g. a tenor practising the soprano line)
  // is scored in the singer's own octave.
  const octaveTolerant = singerIsHigh !== partIsHigh;

  function makeSession(): PracticeSession | null {
    if (!piece || !part || !section) return null;
    const s = new PracticeSession(
      {
        score: piece.score,
        part,
        from: section.start,
        to: section.end,
        rate,
        guide: listenOnly || !!spec?.guide,
        listenOnly,
        cue: route.sectionId === 'entries' || route.sectionId === 'cold' ? 'none' : spec?.cue ?? 'note',
        leadFrom: route.sectionId === 'cold' ? coldLeadFrom(piece.score, section.start) : undefined,
        // Consonants are excused only when the mic hears the voice alone (scoring.ts CONSONANT_FLOOR).
        scoring: { toleranceCents: tolerance, tuning: profile.tuning, octaveTolerant, rate, consonants: headphonesRef.current === true },
        latencyMs: profile.latencyMs || 0,
        range,
        // Tenors and basses (or anyone whose range reaches low) keep the long analysis window.
        // (The short window needs a known range: someone singing the part an octave down mustn't get it.)
        lowestMidi: profile.voice === 'T' || profile.voice === 'B' || profile.rangeLow == null ? null : Math.min(part.low, profile.rangeLow),
        record: profile.keepRecording !== false && !listenOnly,
        beat: profile.beat ?? 'alone',
        simulate: simulateMode(),
      },
      (r) => onDone(r),
    );
    // Keep the singer's mixer choices across restarts.
    for (const [id, g] of Object.entries(gains)) s.partGains[id] = g;
    return s;
  }

  function onDone(result: AttemptResult | null) {
    let r = result;
    setPhase('ready');
    if (!piece || !part || !section) return;
    if (!GENERATED_SECTIONS.has(section.id) && (r || listenOnly)) markSeen(piece.id, part.id, section.id);
    if (!r || listenOnly) {
      dropGuard(); // (the run ended here, without leaving the screen)
      if (listenOnly) {
        recordAttempt(piece.id, part.id, section.id, 0, emptyResult(), section.end - section.start);
        trackPlayRun({ pieceId: piece.id, part, sectionId: section.id, level: 0, mode: route.mode, listenOnly: true, realSection: false, ladder: false,
          passed: false, rate, durationSec: (section.end - section.start) / rate, display, fullScore });
        setListened(true);
      }
      return;
    }
    // Line the voice up with the music before judging intonation: the device delay is rarely
    // known exactly, and when it's off the previous note leaks into the next and reads as bad
    // intonation. Timing stays on the delay we apply, so late singing still shows as late.
    let latencyAdjusted: number | undefined;
    let alignedMs: number | undefined;
    let suggestDelayCheck = false;
    let timingFail: number | undefined;
    let timingUnsure: number | undefined;
    let entries: EntriesCheck | undefined;
    let entriesOffsetMs = 0;
    let alignLag = 0;
    const sess = sessionRef.current;
    const calibrated = profile.latencySource === 'measured' && profile.latencyMs > 0;
    if (sess) {
      const idx = r.notes.map((n) => n.index);
      const al = scoreAligned(
        { score: piece.score, part, range: [Math.min(...idx), Math.max(...idx)], end: sess.cfg.to },
        sess.samples, sess.cfg.scoring,
        {
          rate: sess.cfg.rate, latencyMs: sess.latencyMs, calibrated, liftSubharmonics: !sess.cfg.scoring.octaveTolerant, everyNote: !!spec?.everyNote,
          voiceOnly: headphonesRef.current === true,
          maxTotalMs: sess.cfg.guide ? Math.max(estimateLatencyMs() + GUIDE_LEARN_MAX_ABOVE, sess.latencyMs + 80) : 450,
        },
      );
      r = al.result;
      if (al.shiftMs !== 0) alignedMs = al.shiftMs;
      alignLag = al.shiftMs !== 0 ? al.estimate.lag : 0;
      // Learn the delay on uncalibrated phones, but only from complete, clearly matching runs, and
      // only once two runs agree (one run sung behind the guide, or a headset switch, must not
      // teach a wrong delay). While the guide plays the singer's own part they may be following it
      // by ear, so those runs can't teach a delay much above what the device itself suggests.
      if (!calibrated && !simulateMode() && !sess.partial && al.estimate.match >= 0.6) {
        const suggested = sess.latencyMs + al.shiftMs;
        const hint = profile.latencyHint;
        if (hint != null && Math.abs(suggested - hint) <= 60) {
          const cap = sess.cfg.guide ? estimateLatencyMs() + GUIDE_LEARN_MAX_ABOVE : 450;
          const target = (suggested + hint) / 2;
          // The guide-level cap only limits increases; it never pulls a delay learned elsewhere down.
          const learned = Math.round(Math.max(20, Math.min(450, target > sess.latencyMs ? Math.min(Math.max(cap, sess.latencyMs), target) : target)));
          if (Math.abs(learned - (profile.latencyMs || sess.latencyMs)) >= 25) latencyAdjusted = learned;
          updateProfile({ latencyMs: learned, latencySource: 'learned', latencyHint: undefined });
        } else {
          updateProfile({ latencyHint: suggested });
        }
      }
      if (calibrated && Math.abs(al.shiftMs || al.rejectedShiftMs || 0) >= 60) suggestDelayCheck = true;
      // From Level 2 on (both steps), coming in clearly late fails the run. Only with a measured
      // delay: without it, device delay and late singing can't be told apart.
      const med = medianOnsetMs(r, sess.cfg.rate, part);
      if (calibrated && level >= 2 && med !== null && med > LATE_FAIL_MS) timingFail = Math.round(med);
      // Without a measured delay, clearly late entries (or a delay beyond anything we'd assume)
      // could be the singer or the device: don't count the run for the level, ask for the check.
      // (Entries are judged against the lined-up delay: the part the line-up corrected is device delay.)
      const medLinedUp = med !== null ? med - Math.max(0, al.shiftMs) : null;
      if (!calibrated && ((level >= 2 && medLinedUp !== null && medLinedUp > LATE_FAIL_MS) || al.beyondCapMs != null)) {
        timingUnsure = Math.round(al.beyondCapMs ?? med!);
      }
      // Level 1 in tempo: every entry sung, on time on average (without a measured delay, judged on
      // the lined-up voice: the part the line-up corrected is device delay).
      entriesOffsetMs = calibrated ? 0 : Math.max(0, al.shiftMs);
      if (spec?.entries) entries = entriesOnTime(part.notes, r.notes, entriesOffsetMs);
    }
    // Tempo where you sing alone: rushing or dragging with nobody else playing.
    if (sess && sess.exposed.size) {
      const idx = new Set(r.notes.map((n) => n.index));
      const ex = exposedNotes(piece.score, part.id, sess.exposed, beatGrid(piece.score, sess.cfg.from, sess.cfg.to)).filter((i) => idx.has(i));
      // Judge solo tempo on the lined-up voice: a slow phone isn't dragging.
      const ins = soloTimingInsight({ score: piece.score, part, range: [Math.min(...idx), Math.max(...idx)] }, ex,
        alignLag ? sess.samples.map((x) => ({ ...x, time: x.time - alignLag })) : sess.samples);
      if (ins) r = { ...r, insights: [ins, ...r.insights.filter((i) => i.kind !== 'great')] };
    }
    // Per-bar history for the piece map and off-book fading (real pieces only, not generated drills).
    if (!/~|^(row|leaps)-/.test(piece.id)) {
      recordBars(piece.id, part.id, r, level, { peeked: sess?.peeked, hidden: hiddenRef.current });
      recordNotes(piece.id, part.id, r, tolerance);
    }
    setLastRun(sess?.recording ? {
      recording: sess.recording,
      at: Date.now(),
      meta: {
        pieceId: piece.id, pieceTitle: piece.title, partId: part.id, partName: part.name,
        from: sess.cfg.from, to: sess.cfg.to, rate: sess.cfg.rate, level, scoring: sess.cfg.scoring,
        latencyMs: sess.latencyMs, calibrated,
        alignedMs: alignedMs ?? 0, samples: sess.samples, result: r, inputQuality: sess.inputQuality,
      },
    } : null);
    const realSection = !GENERATED_SECTIONS.has(section.id);
    const partial = !!sessionRef.current?.partial;
    // Off book only counts when everything was hidden and nothing was peeked at.
    const peekedN = sess?.peeked.size ?? 0;
    const offBookPractice = offBook && (peekedN > 0 || hiddenRef.current.size < sectionMeasures.length);
    const fullTempo = rateOverride == null || rateOverride >= (spec?.rate ?? 1) - 1e-6;
    // A run-through of the whole piece earns the piece level (docs/LEVELS.md), but only in one go:
    // not stopped early, not paused and resumed, at the level's tempo.
    const isFull = section.id === 'all' && !drill;
    const resumed = !!sess?.resumed;
    const arcade = route.mode === '3d';
    // Level 1 counts only with headphones on (the answer on the pre-run card); without, it's practice.
    const headphones = headphonesRef.current;
    const speaker = speakerPractice(level, step, headphones);
    const fullCounted = isFull && fullRunCounts({ level, step, rate, partial, resumed, timingUnsure: timingUnsure != null, offBookPractice, arcade, headphones }).counted;
    const sectionLadder = realSection && fullTempo
      && sectionRunCounts({ level, step, rate, partial, timingUnsure: timingUnsure != null, offBookPractice, headphones }).counted;
    const entriesLate = !!entries && !entries.ok;
    // Practice runs (slower tempo, stopped early) are logged but never change section levels.
    const recId = sectionLadder || !realSection ? section.id : 'practice';
    const durationSec = Math.max(0, section.end - section.start - (sess?.skippedSec ?? 0)) / rate;
    const prevBest = personalBest(piece.id, part.id, recId, level, step)?.score ?? null;
    const streakBefore = streakDays();
    const secs = singableSections(piece, part.id);
    const pieceBefore = pieceReadiness(secs, getProgress(piece.id, part.id)).pieceLevel;
    const full = isFull
      ? recordFullRun(piece.id, part.id, level, r, secs, (i) => part.notes[i]?.start,
        { counted: fullCounted, step, timingFail: timingFail != null, entriesLate, durationSec })
      : undefined;
    const rec = full ?? recordAttempt(piece.id, part.id, recId, level, r, durationSec, Date.now(), { step, timingFail: timingFail != null, entriesLate, practice: !sectionLadder });
    const sectionRec = full ? undefined : (rec as ReturnType<typeof recordAttempt>);
    const fixed = full ? undefined : (rec as ReturnType<typeof recordAttempt>).fixed;
    const reached = full ? full.reached : (rec as ReturnType<typeof recordAttempt>).reached;
    const ladder = full ? full.counted : sectionLadder;
    const pieceAfter = pieceReadiness(secs, getProgress(piece.id, part.id)).pieceLevel;
    noteReached(piece.id, part.id, pieceBefore, pieceAfter);
    if (ladder) {
      snapshotReadiness(piece.id, part.id, pieceReadiness(secs, getProgress(piece.id, part.id)).pct);
    }
    void shareMyProgress();
    postBoardEntrySoon(piece.id);
    syncProgressSoon();
    suggestAccount(rec.passed);
    const notCounted = (realSection || isFull) && !ladder
      ? (partial ? 'stopped early'
        : isFull && arcade ? 'arcade runs of the whole piece are just for fun'
        : isFull && step === 'slow' ? 'it was slow (only a run in tempo counts for the piece)'
        : isFull && resumed ? 'you paused and carried on (a run of the whole piece counts only in one go)'
        : offBookPractice ? (peekedN > 0 ? `you peeked at ${peekedN} bar${peekedN > 1 ? 's' : ''}` : 'some bars were still showing (practice mode)')
        : timingUnsure != null ? `your voice reached the app about ${timingUnsure} ms after the beat, and without the delay check the app can't tell whether that's your timing or your phone and headphones. Do the 10-second delay check in Voice setup`
        : !fullTempo ? 'slower than the step’s tempo'
          : speaker ? SPEAKER_PRACTICE
            : 'slower than the step’s tempo')
      : undefined;
    setLastResult({
      pieceId: piece.id, partId: part.id, sectionId: section.id, level, step, mode: route.mode,
      from: section.start, to: section.end, result: r, ladder, prevBest, tolerance, everyNote: !!spec?.everyNote,
      ...(entries ? { entries, entriesOffsetMs } : {}),
      ...(realSection || isFull ? { pieceBefore, pieceAfter } : {}),
      ...(route.back ? { back: route.back } : {}),
      ...(sectionRec ? { prevSlow: sectionRec.prevSlow, newSlow: sectionRec.newSlow, ...(sectionRec.stepUp ? { stepUp: true } : {}) } : {}),
      latencyAdjusted,
      alignedMs,
      suggestDelayCheck,
      timingFail,
      latencyUsedMs: sess ? Math.round(sess.latencyMs) : undefined,
      timingUnsure,
      offBookDays: rec.offBookDays,
      full,
      fixed,
      ...(sess?.inputQuality ? { inputQuality: sess.inputQuality } : {}),
      reached,
      ...(notCounted === SPEAKER_PRACTICE ? { speaker: true } : {}),
      ...(!fullTempo ? { slow: rate } : {}),
      points: { gained: rightNotes(r), total: addCyclePoints(rightNotes(r)) },
      streak: { days: streakDays(), extended: streakDays() > streakBefore },
      notCounted,
      passed: rec.passed, prevLevel: rec.prevLevel, newLevel: rec.newLevel,
    });
    trackPlayRun({
      pieceId: piece.id, part, sectionId: section.id, level, step, mode: route.mode, listenOnly: false, realSection, ladder, passed: rec.passed,
      rate, durationSec, display, fullScore, result: r, full, suggestDelayCheck, timingUnsure, timingFail, alignedMs,
      latencyUsedMs: sess ? Math.round(sess.latencyMs) : undefined, latencySource: profile.latencySource,
    });
    // After the first real practice run, ask the browser to keep our data (Safari may otherwise
    // evict site storage after weeks of non-use).
    try {
      if (!localStorage.getItem('sh:persistAsked')) {
        localStorage.setItem('sh:persistAsked', '1');
        navigator.storage?.persist?.().catch(() => {});
      }
    } catch { /* ignore */ }
    go({ name: 'results' }, true);
  }

  const startingRef = useRef(false);
  async function start() {
    if (startingRef.current) return; // double tap
    startingRef.current = true;
    // While singing, the back button pauses instead of leaving (in the tap, before anything awaits).
    pushGuard();
    setLastRun(null); // free the previous run's recording
    try {
      await startInner();
    } finally {
      startingRef.current = false;
    }
  }

  async function startInner() {
    // The "Headphones on?" answer as the run starts (level 1 counts only with headphones).
    headphonesRef.current = loadProfile().headphones;
    disposeSession(sessionRef.current);
    fxRef.current = newFx();
    const s = makeSession();
    if (!s) return;
    sessionRef.current = s;
    s.onInterrupted = () => setPhase('paused');
    try {
      await s.start();
      setPhase('running');
    } catch (e) {
      console.error(e);
      setMicMsg(s.micError ?? 'Could not start audio.');
      track('err.mic');
      setPhase('micError');
      dropGuard();
    }
  }

  function listenInstead() {
    go({ ...route, level: 0 }, true);
  }

  // The choir sees this phone among those practising (a count per voice part) while this screen is open.
  useEffect(() => startPresence(profile.voice), [profile.voice]);

  // ←, ⌂ or the back button while singing: pause and ask (leaving would silently discard the run).
  // On the ready screen or already paused, ← simply goes back to the piece.
  const up = practiceParent(route) ?? { name: 'home' as const };
  const isRunning = () => { const ph = sessionRef.current?.phase; return ph === 'playing' || ph === 'countin'; };
  function leaveFor(target: Parameters<typeof leaveTo>[0]) {
    if (isRunning()) {
      sessionRef.current?.pause();
      setPhase('paused');
      return;
    }
    disposeSession(sessionRef.current);
    leaveTo(target);
  }
  useBackGuard(() => leaveFor(up));

  // Render loop.
  useEffect(() => {
    let raf = 0;
    let lastHud = 0;
    const ghostParts = piece && part ? piece.score.parts.filter((p) => p.id !== part.id && p.voiceType !== 'other' && p.notes.length) : [];
    const win = part ? pitchWindow(part, range) : ([55, 72] as [number, number]);
    let lanes: number[] | null = null;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap || !piece || !part || !section) return;
      const dpr = Math.min(route.mode === '3d' ? 1.5 : 2, window.devicePixelRatio || 1);
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      const c = canvas.getContext('2d');
      if (!c) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = sessionRef.current;
      const pos = s ? s.position : section.start;
      const [lo, hi] = win;
      const st: DrawState = {
        score: piece.score, part, range, pos, rate,
        samples: s?.samples ?? [], live: s?.live ?? null,
        notation, showNames, key: keyAtTimeIn(nameKeysOf(piece.score), Math.max(0, pos)), tolerance,
        ghostParts,
        lo, hi, from: section.start, to: section.end,
        beatSec: s ? s.beatSec(Math.max(0, pos)) : 60 / tempoAt(piece.score.tempos, Math.max(0, pos)),
        staves,
        scroll: !scorePages,
        dimLyrics: doo,
        readout: readoutOn,
        hide: offBook ? (i: number) => {
          // Cold start: nothing of your part before the entry either (it would give the pitch away).
          if (cold && range && i < range[0]) return 'none';
          const m = part.notes[i]?.measure ?? -1;
          if (!hiddenRef.current.has(m)) return 'show';
          const pk = peekRef.current;
          if (pk.until > performance.now() && pk.measures.has(m)) return 'show';
          return modeRef.current === 'test' ? 'none' : 'letters';
        } : undefined,
      };
      if (route.mode === '3d') drawArcade(c, W, H, st, fxRef.current, (lanes ??= lanesFor(st)), ts / 1000);
      else if (display === 'score') {
        const info = drawScoreView(c, W, H, st);
        const n = String(info.staves);
        if (canvas.dataset.staves !== n) canvas.dataset.staves = n;
        if (canvas.getAttribute('aria-label') !== info.label) canvas.setAttribute('aria-label', info.label);
      }
      else drawHighway2D(c, W, H, st);

      if (ts - lastHud > 90) {
        lastHud = ts;
        if (s && s.micLost && (s.phase === 'playing' || s.phase === 'countin')) {
          s.pause();
          setMicMsg('The microphone disconnected (headset unplugged or another app took it). Plug it back in and try again.');
          setPhase('micError');
      dropGuard();
        }
        let count = 0;
        if (s && s.phase === 'countin' && s.countingIn) {
          const target = sessionStartTarget(s, section.start);
          if (pos < target) count = Math.ceil((target - pos) / s.beatSec(target) - 1e-6);
          if (count > 4) count = 0; // a cold start's lead-in bars: only count the last beats
        }
        let lyricIdx = -1;
        for (let i = 0; i < part.notes.length; i++) {
          if (part.notes[i].start <= pos + 0.05) lyricIdx = i;
          else break;
        }
        // A long rest ahead: offer to skip to a bar or so before the next entry (not in a cold start's lead-in).
        let skip: { target: number; entry: number; bar: string } | null = null;
        if (s && !listenOnly && !cold && (s.phase === 'playing' || (s.phase === 'countin' && pos >= s.resumePoint))) {
          // (once the last note's tail has reached us: one mic round-trip after it ends)
          const k = skipTarget(piece.score.measures, part, pos, section.end, (s.latencyMs / 1000 + 0.15) * rate);
          if (k) skip = { ...k, bar: piece.score.measures.find((m) => k.entry >= m.start - 1e-6 && k.entry < m.start + m.dur - 1e-6)?.number ?? '' };
        }
        const done = progress ? barsDone(piece.score, section.start, section.end, pos) : 0;
        // The live readout: the note being sung (its name where the level shows names) and how close.
        let rd: Hud['rd'] = null;
        if (readoutOn && s && s.phase === 'playing') {
          const r = liveReading({ samples: s.samples, pos, part, range, hide: st.hide });
          if (r) {
            const n = part.notes[r.index];
            const w = pitchReadout(r.cents);
            const name = showNames ? noteLabel(n.midi, notation, keyAtTimeIn(nameKeysOf(piece.score), n.start), n.spelling).text : '';
            rd = { name, words: w.words, arrow: w.arrow, say: w.say, ok: Math.abs(r.cents) <= tolerance };
          }
        }
        const next: Hud = { score: s?.live?.score ?? 0, combo: s?.live?.combo ?? 0, count, lyricIdx, skip, done, rd };
        setHud((h) => (h.score === next.score && h.combo === next.combo && h.count === next.count && h.lyricIdx === next.lyricIdx
          && h.skip?.target === next.skip?.target && h.skip?.entry === next.skip?.entry && h.done === next.done
          && h.rd?.name === next.rd?.name && h.rd?.words === next.rd?.words && h.rd?.ok === next.rd?.ok ? h : next));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece, part, section, route.mode, notation, showNames, rate, tolerance, offBook, cold, display, staves, doo, scorePages, listenOnly, readoutOn, progress]);

  // Seen once a run starts with it on screen (switching display before Start shows the other one's).
  useEffect(() => {
    if (phase !== 'running' || !showHowto) return;
    try { localStorage.setItem(`sh:seenHowto:${display}`, '1'); } catch { /* ignore */ }
    setHowtoSeen((h) => (h ? { ...h, [display]: true } : h));
  }, [phase, showHowto, display]);

  // Cleanup on unmount / pause when hidden.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && sessionRef.current && (sessionRef.current.phase === 'playing' || sessionRef.current.phase === 'countin')) {
        sessionRef.current.pause();
        setPhase('paused');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      disposeSession(sessionRef.current);
    };
  }, []);

  if (!piece || !part || !section) return <NotFound pieceId={route.pieceId} />;

  const lyricNotes = offBook && hiddenRef.current.size
    ? part.notes.map((n, i) => (i <= hud.lyricIdx || !hiddenRef.current.has(n.measure) ? n
      : { ...n, lyric: effMode === 'fade' ? wordInitial(n) || undefined : undefined, syllabic: 'single' as const }))
    : part.notes;
  const lyric = lyricLine(lyricNotes, hud.lyricIdx, range);
  const vocal = piece.score.parts.filter((p) => p.notes.length > 0 || p.voiceType === 'other');
  const levelInfo = spec ?? null;
  const running = phase === 'running';
  // A run of the whole piece: the sections still to fix at this level (it can't count until they're done).
  const isFullRun = section.id === 'all' && !listenOnly && !drill;
  // Level 1 counts only with headphones on: ask before a run that could count (a section or the
  // whole piece; drills and cold starts never count). Remembered on this phone.
  const askHeadphones = !listenOnly && !!spec?.headphones && (isFullRun || !GENERATED_SECTIONS.has(section.id));
  // A passage of the ladder (not the whole piece, a drill…): its step can be switched before Start.
  const ladderSec = !listenOnly && route.mode === '2d' && !GENERATED_SECTIONS.has(section.id);
  const afterLevel = route.after ?? 1;
  const headphonesUnanswered = askHeadphones && profile.headphones == null;
  // Help on every sung level: listen to the section first, or sing it slowly. A section met for the
  // first time at level 1 offers to listen first (not required); after misses in a row, both are suggested.
  const helpable = !listenOnly && route.mode === '2d' && !cold && section.id !== 'entries';
  const realSec = !GENERATED_SECTIONS.has(section.id);
  const firstListen = helpable && level === 1 && realSec
    && firstTime(getProgress(piece.id, part.id)?.sections[section.id], { pieceId: piece.id, partId: part.id, sectionId: section.id });
  const fails = helpable && realSec ? failsInARow(piece.id, part.id, section.id, level, step) : 0;
  const stuck = fails >= STUCK_AFTER ? fails : 0;
  // (a slow practice keeps its tempo: listening slowly, then singing slowly)
  const listenFirst = () => go({ ...route, level: 0, after: level, step, ...(rateOverride != null && rateOverride < (spec?.rate ?? 1) ? { rate: rateOverride } : {}) }, true);
  const toStep = (st: Step) => go({ ...route, step: st, rate: undefined }, true);
  const fullSecs = isFullRun ? singableSections(piece, part.id) : [];
  const fullFixes = isFullRun ? fixesBefore(fullSecs, getProgress(piece.id, part.id), level) : [];

  // What the run covers, inside a sentence: "bars 22–29", "the whole piece".
  const what = drill ? drillWhat : section.id === 'all' ? 'the whole piece'
    : realSec ? lowerLabel(section.label)
      : (() => { const [a, b] = sectionBars(piece.score, section.start, section.end); return barRangeLabel(piece.score, a, b, true); })();
  // A passage's note gone wrong most lately: "Watch bar 25."
  const watch = realSec && !listenOnly && phase === 'ready' ? troubleNote(part, section.start, section.end, getNoteStats(piece.id, part.id)) : null;
  const watchBar = watch ? piece.score.measures[watch.measure]?.number ?? null : null;

  function togglePart(id: string) {
    const s = sessionRef.current;
    const cur = (s?.partGains ?? gains)[id] ?? 0;
    const next = cur > 0 ? 0 : id === part!.id ? 0.9 : 0.7;
    if (s) s.setGain(id, next);
    setGains((g) => ({ ...g, [id]: next }));
  }
  const canToggleOwn = listenOnly || level <= 2;

  return (
    <main className={display === 'score' && route.mode === '2d' ? 'play play-score' : 'play'}>
      <h1 className="sr-only">{piece.title}: {part.name}, {section.label}</h1>
      <PracticeBar className="play-hud" up={up} title={piece.title}
        sub={<>{part.name} · {section.label} · {listenOnly ? 'Listen' : stepLabel(level, step)}{route.mode === '3d' ? ' · Arcade' : ''}</>}
        onBack={() => leaveFor(up)} onHome={() => leaveFor({ name: 'home' })}
        extra={!listenOnly && (
          <div className="col" style={{ alignItems: 'flex-end', gap: 0, paddingRight: 2 }}>
            <span className="mono" style={{ fontWeight: 600, fontSize: route.mode === '3d' ? '1.375rem' : '1.0625rem' }} data-testid="score">{hud.score.toLocaleString()}</span>
            <span className="mono tiny" style={{ color: 'var(--accent)', whiteSpace: 'nowrap' }}>{hud.combo > 1 ? `combo ${hud.combo}` : ' '}</span>
          </div>
        )} />

      {progress && <RunStrip progress={progress} done={hud.done} />}
      {readoutOn && (
        <div className="readout-band" data-testid="readout-band">
          {running && hud.rd ? (
            <div className={hud.rd.ok ? 'readout' : 'readout off'} data-testid="readout" title={hud.rd.say}>
              {hud.rd.name && <><span className="n">{hud.rd.name}</span><span className="sep" aria-hidden="true">·</span></>}
              <span className="w">{hud.rd.words}{hud.rd.arrow && <span className="arr" aria-hidden="true"> {hud.rd.arrow}</span>}</span>
            </div>
          ) : (
            <span className="readout-idle" data-testid="readout-idle">{running ? 'Listening…' : 'How close you are shows here as you sing.'}</span>
          )}
        </div>
      )}
      <div className="play-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} aria-label={display === 'score' ? undefined : route.mode === '3d' ? 'Arcade' : 'Note highway'} role="img" data-display={display} />
        <div className="sr-only" aria-live="polite" data-testid="countin-live">{hud.count > 0 && running ? String(hud.count) : ''}</div>
        {hud.count > 0 && running && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: '6rem', fontWeight: 800, color: 'var(--accent)', textShadow: '0 0 24px var(--accent)' }}>{hud.count}</span>
            {sessionRef.current?.resumed && (
              <span className="small" data-testid="resume-hint" style={{ background: 'var(--scrim)', borderRadius: 8, padding: '4px 10px' }}>Carry on singing from the line</span>
            )}
          </div>
        )}
        {running && hud.skip && hud.count === 0 && (
          <div className="skip-rest">
            <button className="btn small voice" data-testid="skip-rest"
              onClick={() => { const k = hud.skip; if (k && sessionRef.current?.skipTo(k.target, k.entry)) setHud((h) => ({ ...h, skip: null })); }}>
              ⏩ Skip the rest{hud.skip.bar ? ` · in at bar ${hud.skip.bar}` : ''}
            </button>
          </div>
        )}
        {phase === 'ready' && (
          // The pre-run card, low on the screen so the first bars stay in view above it (scrolls on short phones).
          <div className="overlay prerun">
            <div className="card precard" data-testid="prerun">
              <SessionStrip pieceId={piece.id} compact />
              {askPart && (
                <div className="col" data-testid="prerun-part-ask" style={{ gap: 6 }}>
                  <strong className="t16">Which part do you sing in this piece?</strong>
                  <div className="chips" role="group" aria-label="Your part in this piece">
                    {partChoices(piece, profile.voice, { low: profile.rangeLow, high: profile.rangeHigh }).map(({ part: p }) => (
                      <button key={p.id} className="chip" aria-pressed={p.id === part.id}
                        onClick={() => { rememberPart(piece.id, p.id); setAskPart(false); if (p.id !== part.id) go({ ...route, partId: p.id }, true); }}>{p.name}</button>
                    ))}
                  </div>
                </div>
              )}
              <span className="eb now" data-testid="step-label">{listenOnly ? 'Listen' : levelInfo?.label}</span>
              {cold ? (
                <p className="task">
                  {coldLeadFrom(piece.score, section.start) != null ? "You'll hear two bars of the other voices, then come in" : 'After a count-in, come in'}{' '}
                  at bar {piece.score.measures.find((m) => section.start >= m.start - 1e-3 && section.start < m.start + m.dur - 1e-3)?.number} from memory: no starting note, nothing of your part shown.
                </p>
              ) : section.id === 'entries' ? (
                <p className="task">Come in on your own at each entry: two beats of the other voices, then you, with no starting note.</p>
              ) : listenOnly ? (
                <p className="task">Listen to {what} once, every voice playing. Not scored.</p>
              ) : levelInfo && (
                <p className="task" data-testid={doo ? 'doo-note' : 'task'}>{taskSentence(levelInfo, what, rate)}</p>
              )}
              {!listenOnly && levelInfo && !cold && (
                <p className="t14 muted" data-testid="pass-rule" style={{ margin: 0 }}>
                  {rate < (spec?.rate ?? 1) - 1e-6
                    ? 'Slower than the step: practice only, it doesn’t pass.'
                    : passRule(levelInfo, { full: isFullRun })}
                  {watchBar ? ` Watch bar ${watchBar}.` : ''}
                </p>
              )}
              {isFullRun && (
                <span className="t14 muted" data-testid="full-info">
                  {step === 'slow' ? <><strong>Slow runs of the whole piece are practice:</strong> only a run in tempo counts for the piece. </> : null}
                  In one go: stopping or pausing makes it practice. All passages right: {level === 5 ? `that's a day from memory (by heart = ${OFF_BOOK_DAYS} different days)` : `Level ${level} is yours at once`}, with a clean-run ★.
                  More than half slipped, or the run under {Math.round((levelInfo?.pass ?? 0.8) * 100) - 10}% overall: it’s practice.
                </span>
              )}
              {isFullRun && fullFixes.length > 0 && (
                <span className="t14 muted" data-testid="full-open-fixes">
                  Still to fix at Level {level} from your last full run: {fullFixes.map((id) => fullSecs.find((x) => x.id === id)?.label ?? id).join(', ')}.
                  This run counts too: what slips now becomes the list to fix.
                </span>
              )}
              {offBook && !cold && (
                <div className="col" style={{ gap: 6 }} data-testid="offbook-mode">
                  {allKnown ? (
                    <span className="t14">You know every bar of this {isFullRun ? 'piece' : 'passage'} by heart: this is the real test. Everything is hidden.</span>
                  ) : (
                    <>
                      <div className="chips" role="group" aria-label="By heart: practise or test">
                        <button className="chip" aria-pressed={obMode === 'fade'} onClick={() => setObMode('fade')}>Practise: fade out</button>
                        <button className="chip" aria-pressed={obMode === 'test'} onClick={() => setObMode('test')}>Test: all hidden</button>
                      </div>
                      <span className="t14 muted">
                        {obMode === 'fade'
                          ? known.size === 0
                            ? 'All bars still show. Bars you sing well from memory disappear, leaving the first letter of each word.'
                            : `${known.size} of ${sectionMeasures.length} bars are hidden (you know them). Hidden bars show only the first letter of each word.`
                          : 'Nothing of your part is shown. Only a run with no peeking counts.'}
                      </span>
                    </>
                  )}
                  <span className="t14 muted">Hold “Peek” to see the next bars for two seconds. Pass in tempo by heart on {OFF_BOOK_DAYS} different days and the {isFullRun ? 'piece' : 'passage'} is memorised.</span>
                </div>
              )}
              {askHeadphones && (
                <div className="col" style={{ gap: 2 }} data-testid="headphones-q">
                  {profile.headphones == null || hpEdit ? (
                    <>
                      <span className="t16" id="hp-label"><strong>Headphones on?</strong> <span className="t14 muted">(remembered on this phone)</span></span>
                      <div className="seg" role="group" aria-labelledby="hp-label">
                        <button aria-pressed={profile.headphones === true} onClick={() => { updateProfile({ headphones: true }); setHpEdit(false); }} data-testid="hp-yes">Yes</button>
                        <button aria-pressed={profile.headphones === false} onClick={() => { updateProfile({ headphones: false }); setHpEdit(false); }} data-testid="hp-no">No, speaker</button>
                      </div>
                    </>
                  ) : (
                    <div className="hp">
                      <span className="grow t16" data-testid="hp-state">{profile.headphones ? '🎧 Headphones on' : '🔈 Phone speaker: practice only'}</span>
                      <button className="link inline" style={{ margin: 0 }} data-testid="hp-change" aria-label="Change: headphones or speaker" onClick={() => setHpEdit(true)}>change</button>
                    </div>
                  )}
                  <span className="t14" style={{ color: profile.headphones === false ? 'var(--accent-text)' : 'var(--muted)' }} data-testid="hp-note">
                    With the phone speaker the app can’t hear every note, so runs only count with headphones.
                  </span>
                </div>
              )}
              {helpable && (
                <div className="col" style={{ gap: 6 }} data-testid={firstListen ? 'first-listen' : 'help-row'}>
                  {firstListen && <span className="t14 muted">New to this passage? Listen to it once. Know it already? Sing it straight away.</span>}
                  {stuck > 0 && (
                    <span className="t14" data-testid="stuck-hint">
                      <strong>This one has been tricky</strong> ({stuck} misses in a row). Listen to it again, or sing it slower first: then try it again.
                    </span>
                  )}
                  <div className="row help" style={{ gap: 8, alignItems: 'stretch' }}>
                    <button className={`btn two${stuck > 0 ? ' voice' : ''}`} onClick={listenFirst} data-testid={firstListen ? 'listen-first' : 'listen-btn'}>
                      <span><IconEar size={16} /> Listen first</span>
                    </button>
                    {/* In tempo on a passage: its slow step (it counts). Elsewhere: slower practice. */}
                    {step === 'tempo' && ladderSec && (
                      <button className={`btn two${stuck > 0 ? ' voice' : ''}`} style={{ flexGrow: 1.6 }} data-testid="slow-btn" onClick={() => toStep('slow')}>
                        <span>Sing it slow ({Math.round(stepSpec(level, 'slow').rate * 100)}%)</span><span className="sub">the slow step: it counts</span>
                      </button>
                    )}
                    {step === 'tempo' && !ladderSec && !slowShown && (
                      <button className={`btn two${stuck > 0 ? ' voice' : ''}`} style={{ flexGrow: 1.6 }} data-testid="slow-btn"
                        onClick={() => { setSlowShown(true); setRateOverride(slowRate(step)); }}>
                        <span>Practise slowly ({Math.round(slowRate(step) * 100)}%)</span><span className="sub">practice only, doesn’t pass</span>
                      </button>
                    )}
                    {step === 'slow' && rate >= (spec?.rate ?? 1) - 1e-6 && (
                      <button className={`btn two${stuck > 0 ? ' voice' : ''}`} style={{ flexGrow: 1.6 }} data-testid="slow-btn"
                        onClick={() => setRateOverride(slowRate(step))}>
                        <span>Slower ({Math.round(slowRate(step) * 100)}%)</span><span className="sub">practice only, doesn’t pass</span>
                      </button>
                    )}
                    {rate < (spec?.rate ?? 1) - 1e-6 && (
                      <button className="btn two" style={{ flexGrow: 1.6 }} data-testid="step-rate-btn" onClick={() => setRateOverride(null)}>
                        <span>Back to {Math.round((spec?.rate ?? 1) * 100)}%</span><span className="sub">the step’s tempo: it counts</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
              {route.mode === '2d' && !listenOnly && profile.scoreDefaultNote && display === 'score' && (
                <div className="col t14" style={{ gap: 6, background: 'var(--bg-2)', borderRadius: 10, padding: '10px 12px' }} data-testid="score-default-note">
                  <strong>Sheet music is now the default</strong>
                  <span className="muted">Your voice is drawn on the staff: just under a note means flat, just over means sharp. Prefer the moving bars? Switch to Highway any time, under Display &amp; tempo or in Settings.</span>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn voice" onClick={() => updateProfile({ scoreDefaultNote: false })} data-testid="score-default-ok">Got it</button>
                    <button className="btn" onClick={() => updateProfile({ display: 'highway', displayChosen: true, scoreDefaultNote: false })} data-testid="score-default-highway">Back to Highway</button>
                  </div>
                </div>
              )}
              {!listenOnly && showHowto && (
                <details className="col t14 howto" style={{ gap: 4, background: 'var(--bg-2)', borderRadius: 10, padding: '0 12px' }} data-testid="howto">
                  <summary className="link start" style={{ fontSize: '0.9375rem' }}>First time? How to read the screen</summary>
                  <div className="col" style={{ gap: 4, paddingBottom: 10 }}>
                  {display === 'score' ? (
                    <>
                      {fullScore
                        ? <span>The full score: your part is the staff with the <span style={{ color: 'var(--voice)' }}>blue</span> band, the other voices are drawn plainly. The white line moves through the bars: sing the note it's on in your staff (it glows <span style={{ color: 'var(--accent)' }}>orange</span>).</span>
                        : <span>Your part as sheet music. The white line moves through the bar: sing the note it's on (it glows <span style={{ color: 'var(--accent)' }}>orange</span>).</span>}
                      <span><span style={{ color: 'var(--voice)' }}>━</span> Your voice draws a blue line at its exact height on the staff: just under the note means flat, just over means sharp (light orange when out of tune).</span>
                      <span>Notes turn <span style={{ color: 'var(--voice)' }}>blue</span> when sung well, <span style={{ color: 'var(--warn)' }}>yellow</span> when close, <span style={{ color: 'var(--bad)' }}>red</span> when missed. {readoutOn ? 'The box above the music says' : 'The bubble says'} how close you are: spot on, a touch, a little or clearly flat or sharp. Prefer moving bars? Choose Highway under Display &amp; tempo.</span>
                    </>
                  ) : (
                    <>
                      <span><span style={{ color: 'var(--accent)' }}>■</span> Orange bars are your notes. They move left to the white line: sing when they reach it.</span>
                      <span><span style={{ color: 'var(--voice)' }}>━</span> The blue line is your voice. Keep it on the bar: the bar fills with blue when you're on the note.</span>
                      <span>Dashed outlines are the other voices. The bubble says how close you are: spot on, a touch, a little or clearly flat or sharp.</span>
                    </>
                  )}
                  </div>
                </details>
              )}
              {listenOnly && listened && (route.after != null || !GENERATED_SECTIONS.has(section.id)) ? (
                <>
                  <button className="btn primary block start-btn" onClick={() => go({ ...route, level: afterLevel, after: undefined, step }, true)} data-testid="learn-next">
                    <IconPlay size={18} /> Now sing it: {stepLabel(afterLevel, step)}
                  </button>
                  <button className="btn block" onClick={start}>Listen again</button>
                </>
              ) : (
                // Waiting for "Headphones on?": not sticky, so it doesn't cover the question on a small phone.
                <button className={`btn primary block start-btn${headphonesUnanswered ? '' : ' start-sticky'}`} onClick={start} disabled={headphonesUnanswered} data-testid="start"
                  style={headphonesUnanswered ? { opacity: 1, background: 'var(--surface-2)', color: 'var(--muted)' } : undefined}>
                  {headphonesUnanswered ? 'Answer above to start' : <><IconPlay size={18} /> {listenOnly ? 'Listen' : firstListen ? 'Sing it now' : 'Start'}</>}
                </button>
              )}
              {route.mode === '2d' && (
                <details className="disclose" data-testid="display-tempo">
                  <summary>
                    <span className="grow"><strong className="t16">Display &amp; tempo</strong> <span className="t14 muted">· {display === 'score' ? 'score' : 'highway'}, {Math.round(rate * 100)}%</span></span>
                    <span className="chev"><IconChevronDown size={20} /></span>
                  </summary>
                  <div className="col">
                    {ladderSec && (
                      <div className="col" style={{ gap: 4 }}>
                        <span className="t14 muted" id="step-label-seg">Step</span>
                        <div className="seg" role="group" aria-labelledby="step-label-seg" data-testid="step-toggle">
                          <button aria-pressed={step === 'slow'} onClick={() => step !== 'slow' && toStep('slow')} data-testid="step-slow">Slow ({Math.round(stepSpec(level, 'slow').rate * 100)}%)</button>
                          <button aria-pressed={step === 'tempo'} onClick={() => step !== 'tempo' && toStep('tempo')} data-testid="step-tempo">In tempo</button>
                        </div>
                        <span className="t14 muted">Slow first, then in tempo: passing in tempo completes the level. Know it already? Go straight to in tempo.</span>
                      </div>
                    )}
                    <div className="col" style={{ gap: 4 }}>
                      <span className="t14 muted" id="display-label">Score / Highway <span style={{ opacity: 0.8 }}>(remembered)</span></span>
                      <div className="seg" role="group" aria-labelledby="display-label" data-testid="display-toggle">
                        <button aria-pressed={display === 'score'} onClick={() => updateProfile({ display: 'score', displayChosen: true, scoreDefaultNote: false })} data-testid="display-score">Score</button>
                        <button aria-pressed={display === 'highway'} onClick={() => updateProfile({ display: 'highway', displayChosen: true, scoreDefaultNote: false })} data-testid="display-highway">Highway</button>
                      </div>
                    </div>
                    {wide && display === 'score' && (others.voices || others.accompaniment) && (
                      <div className="col" style={{ gap: 4 }}>
                        <span className="t14 muted" id="staves-label">Show <span style={{ opacity: 0.8 }}>{profile.scoreStaves ? '(remembered)' : '(automatic)'}</span></span>
                        <div className="seg" role="group" aria-labelledby="staves-label" data-testid="staves-toggle">
                          <button aria-pressed={staves === 'mine' || (staves === 'voices' && !others.voices)} onClick={() => pickStaves('mine')}>My part</button>
                          {others.voices && <button aria-pressed={staves === 'voices' || (staves === 'all' && !others.accompaniment)} onClick={() => pickStaves('voices')}>All voices</button>}
                          {others.accompaniment && <button aria-pressed={staves === 'all'} onClick={() => pickStaves('all')} data-testid="staves-all">{others.voices ? '+ Accomp.' : 'With accomp.'}</button>}
                        </div>
                        {offBook && staves !== 'mine' && <span className="t14 muted">By heart, the full score shows the other voices without their words or the accompaniment, so nothing gives your part away.</span>}
                      </div>
                    )}
                    {helpable && (
                      <label className="field" data-testid="tempo">
                        <span className="t14">Tempo {Math.round(rate * 100)}%{rate < (spec?.rate ?? 1) - 1e-6 ? ' (slower than the step: practice only, won’t count)' : ''}</span>
                        <input type="range" min={40} max={step === 'slow' ? Math.round((spec?.rate ?? 1) * 100) : 100} step={5} value={Math.round(rate * 100)} onChange={(e) => setRateOverride(Number(e.target.value) / 100 >= (spec?.rate ?? 1) - 1e-6 ? null : Number(e.target.value) / 100)} />
                      </label>
                    )}
                    {!listenOnly && levelInfo && !cold && (
                      <span className="t14 muted">
                        A note may be up to {toleranceWords(tolerance)} off. Start: {levelInfo.cue === 'chord' ? 'the starting chord only' : 'your note'}.
                      </span>
                    )}
                    {!listenOnly && !askHeadphones && <span className="t14 muted">Wear headphones so the mic only hears you.</span>}
                    {!listenOnly && !profile.latencyMs && <span className="t14 muted">Tip: run voice setup once to measure your headphone delay.</span>}
                  </div>
                </details>
              )}
            </div>
          </div>
        )}
        {phase === 'micError' && (
          <div className="overlay">
            <div className="card" role="alert">
              <strong style={{ fontSize: '1.125rem' }}>No microphone</strong>
              <span className="small muted">{micMsg}</span>
              <button className="btn primary block" onClick={listenInstead}>Listen to this passage instead</button>
              <button className="btn block" onClick={() => setPhase('ready')}>Try again</button>
            </div>
          </div>
        )}
      </div>

      <div className={doo ? 'lyrics doo' : 'lyrics'} aria-live="off">
        {doo && <span className="doo-tag" data-testid="doo-label">on “doo”</span>}
        <span className="done">{lyric.done}</span><span className="now">{lyric.now}</span><span className="next">{lyric.next}</span>
      </div>

      <div className="play-controls">
        <div className="mixer" role="group" aria-label="Voices you hear">
          {vocal.map((p) => {
            const on = (gains[p.id] ?? 0) > 0;
            const me = p.id === part.id;
            return (
              <button key={p.id} className={me ? 'me' : undefined} aria-pressed={on}
                aria-label={`Hear ${p.name}${me ? ' (your part)' : ''}`}
                disabled={me && !canToggleOwn}
                title={me && !canToggleOwn ? 'At this level you sing without your part' : undefined}
                onClick={() => togglePart(p.id)}>
                {shortName(p.name)}{me ? <span className="you"> · you</span> : ''}{on ? '' : ' (off)'}
              </button>
            );
          })}
        </div>
        {/* With Peek too, Restart and Stop show only their icons on a phone (Pause always fits). */}
        {/* While singing: Restart (an icon on a phone), then Stop and Pause, equal and plain (no
            orange while you sing). Otherwise the round ▶ to carry on. */}
        <div className={`row play-actions${offBook && running && hiddenRef.current.size > 0 ? ' compact' : ''}`}>
          <button className="btn small restart" aria-label="Restart" disabled={!running} onClick={() => { disposeSession(sessionRef.current); sessionRef.current = null; start(); }}>
            <IconRestart size={18} /> <span className="lbl">Restart</span>
          </button>
          {!running && <div className="grow" />}
          {offBook && running && hiddenRef.current.size > 0 && (
            <button className="btn small" data-testid="peek"
              onPointerDown={(e) => { e.preventDefault(); peekStart(); }} onPointerUp={peekEnd} onPointerLeave={peekEnd} onPointerCancel={peekEnd}
              onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); peekStart(); } }} onKeyUp={peekEnd}
              onContextMenu={(e) => e.preventDefault()} style={{ touchAction: 'none', userSelect: 'none' }}>
              Peek{peeks ? ` (${peeks})` : ''}
            </button>
          )}
          {running ? (
            <>
              {!listenOnly && <button className="btn run-btn" aria-label="Stop" data-testid="stop" onClick={() => sessionRef.current?.finish()}><IconStop size={16} /> <span className="lbl">Stop</span></button>}
              <button className="btn run-btn" aria-label="Pause" data-testid="pause" onClick={() => { sessionRef.current?.pause(); setPhase('paused'); }}><IconPause size={18} /> <span className="lbl">Pause</span></button>
            </>
          ) : (
            // (Ready: the card's Start button is the one to tap.)
            phase !== 'ready' && <button className="big-play" aria-label="Start" onClick={() => (phase === 'paused' ? (pushGuard(), void resume()) : start())}><IconPlay /></button>
          )}
        </div>
      </div>
      {phase === 'paused' && (
        <div className="overlay sheet" data-testid="pause-sheet">
          <div className="card" role="dialog" aria-label="Paused">
            <strong style={{ fontSize: '1.125rem' }}>Paused</strong>
            {isFullRun && <span className="small muted">A run of the whole piece counts only in one go: carry on to practise, or restart to sing it through for the level.</span>}
            {resumeMsg && <span className="small" role="status">{resumeMsg}</span>}
            <button className="btn primary block" autoFocus disabled={resuming} onClick={() => { pushGuard(); void resume(); }}><IconPlay size={18} /> {resuming ? 'Resuming…' : 'Resume'}</button>
            <button className="btn block" onClick={() => { disposeSession(sessionRef.current); sessionRef.current = null; start(); }}><IconRestart size={18} /> {isFullRun ? 'Restart' : 'Restart passage'}</button>
            {!listenOnly && <button className="btn block" onClick={() => sessionRef.current?.finish()}>Finish &amp; see results</button>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn block" data-testid="pause-back" onClick={() => leaveFor(up)}><IconBack size={18} /> {up.name === 'expert' ? 'Expert mode' : up.name === 'train' ? 'Train' : 'Back to the piece'}</button>
              <button className="btn block" data-testid="pause-home" onClick={() => leaveFor({ name: 'home' })}><IconHome size={18} /> Today</button>
            </div>
            {!listenOnly && <span className="tiny muted" style={{ textAlign: 'center' }}>Leaving discards this run (it doesn’t count).</span>}
          </div>
        </div>
      )}
    </main>
  );
}

interface Hud {
  score: number;
  combo: number;
  count: number;
  lyricIdx: number;
  skip: { target: number; entry: number; bar: string } | null;
  /** Bars of the run sung so far (the progress strip). */
  done: number;
  /** The live readout: the note's name ('' where names are hidden), the words, the way to go, in tolerance. */
  rd: { name: string; words: string; arrow: string; say: string; ok: boolean } | null;
}

/** The progress of a run over several passages: a segment per passage, filled bar by bar, and "12/64 bars". */
function RunStrip({ progress, done }: { progress: { total: number; parts: number[] }; done: number }) {
  let at = 0;
  return (
    <div className="run-strip" role="progressbar" aria-label="Bars sung" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={done}
      aria-valuetext={`${done} of ${progress.total} bars`} data-testid="run-strip">
      <span className="segs" aria-hidden="true">
        {progress.parts.map((n, i) => {
          const f = Math.max(0, Math.min(1, (done - at) / n));
          at += n;
          return <i key={i} style={{ flexGrow: n }}><b style={{ width: `${f * 100}%` }} /></i>;
        })}
      </span>
      <span className="n">{done}/{progress.total} bars</span>
    </div>
  );
}

/**
 * `?simulate=perfect|flat|sloppy|oneflat` (or localStorage sh:simulate) replaces the mic with a
 * synthetic singer ('oneflat': perfect except one note 70¢ flat).
 */
export function simulateMode(): 'perfect' | 'flat' | 'sloppy' | 'oneflat' | null {
  let v: string | null = null;
  try {
    v = new URLSearchParams(location.search).get('simulate') ?? localStorage.getItem('sh:simulate');
  } catch { /* ignore */ }
  return v === 'perfect' || v === 'flat' || v === 'sloppy' || v === 'oneflat' ? v : null;
}

/** Cold start lead-in: two bars of the others before the bar containing `from` (none at the very start). */
function coldLeadFrom(score: { measures: { start: number; dur: number }[] }, from: number): number | undefined {
  const bar = score.measures.findIndex((m) => from >= m.start - 1e-3 && from < m.start + m.dur - 1e-3);
  const lead = leadInFrom(score as never, Math.max(0, bar));
  // Less than a bar of lead-in (the start of the piece, or just a pickup): use a normal count-in.
  return bar > 0 && from - lead >= score.measures[bar].dur * 0.99 ? lead : undefined;
}

const credited = new WeakSet<PracticeSession>();
/**
 * End a session. A run left before its end (restart, leaving the screen) still counts the notes
 * sung right so far for "notes right this cycle" (a finished run counts them on Results).
 */
function disposeSession(s: PracticeSession | null): void {
  if (!s) return;
  if (s.phase !== 'done' && !s.cfg.listenOnly && s.live && !credited.has(s)) {
    credited.add(s);
    const n = s.live.rightSoFar();
    if (n > 0) addCyclePoints(n);
  }
  s.dispose();
}

/** First and last bar (measure indices) of a stretch of score time. */
function sectionBars(score: { measures: { start: number; dur: number }[] }, from: number, to: number): [number, number] {
  const ms = score.measures;
  let a = ms.findIndex((m) => from >= m.start - 1e-3 && from < m.start + m.dur - 1e-3);
  if (a < 0) a = 0;
  let b = a;
  for (let i = a; i < ms.length && ms[i].start < to - 1e-3; i++) b = i;
  return [a, b];
}

function sessionStartTarget(s: PracticeSession, sectionStart: number): number {
  return Math.max(sectionStart, s.resumePoint);
}

function tempoAt(tempos: { time: number; bpm: number }[], t: number): number {
  let bpm = tempos[0]?.bpm ?? 90;
  for (const e of tempos) if (e.time <= t + 1e-6) bpm = e.bpm;
  return bpm;
}

function shortName(n: string): string {
  return n.length > 9 ? n.replace(/(Soprano|Sopran)/i, 'S').replace(/(Alto|Alt)/i, 'A').replace(/Tenor/i, 'T').replace(/(Bass|Basso)/i, 'B').replace(/Piano|Pianoforte|Klavier/i, 'Pno') : n;
}

function joinSyl(notes: { lyric?: string; syllabic?: string }[]): string {
  let out = '';
  let open = false; // previous syllable was begin/middle → this one continues the word
  for (const n of notes) {
    if (!n.lyric) continue;
    const cont = open && (n.syllabic === 'middle' || n.syllabic === 'end');
    out += (cont || !out ? '' : ' ') + n.lyric;
    open = n.syllabic === 'begin' || n.syllabic === 'middle';
  }
  return out;
}

export function lyricLine(notes: { lyric?: string; syllabic?: string }[], idx: number, range: [number, number] | null) {
  const a = range ? range[0] : 0;
  const b = range ? range[1] : notes.length - 1;
  const cur = Math.max(a - 1, Math.min(b, idx));
  const doneNotes = notes.slice(Math.max(a, cur - 6), Math.max(a, cur));
  const nowNote = cur >= a ? notes[cur] : undefined;
  const nextNotes = notes.slice(Math.max(a, cur + 1), Math.min(b + 1, cur + 12));
  const done = joinSyl(doneNotes);
  let now = nowNote?.lyric ?? '';
  if (now && done && !(nowNote?.syllabic === 'middle' || nowNote?.syllabic === 'end')) now = ' ' + now;
  let next = joinSyl(nextNotes);
  if (next && nextNotes.find((n) => n.lyric) && !['middle', 'end'].includes(nextNotes.find((n) => n.lyric)!.syllabic ?? '')) next = ' ' + next;
  return { done: tailWords(done, 28), now, next };
}

/** The end of `text`, at most about `max` characters, starting at a word (never "ald steht"). */
function tailWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.length - max;
  const sp = text.indexOf(' ', cut - 1);
  return sp < 0 ? text.slice(cut) : text.slice(sp + 1);
}

function emptyResult(): AttemptResult {
  return { accuracy: 0, pitch: 0, rhythm: 0, score: 0, maxCombo: 0, counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, notes: [], perMeasure: {}, insights: [] };
}

