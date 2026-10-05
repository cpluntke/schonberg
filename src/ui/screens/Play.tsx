import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../router';
import { go, back } from '../router';
import { getPiece, noteRangeFor, singableSections } from '../library';
import { useProfile, useWide } from '../hooks';
import { LEVELS, LISTEN, MAX_LEVEL, OFF_BOOK_DAYS, effectiveTolerance, fixesBefore, fullRunCounts, passLabel, pieceReadiness } from '../../progress/ladder';
import { shareMyProgress } from '../play/shareProgress';
import { postBoardEntrySoon } from '../play/boardEntry';
import { syncProgressSoon, suggestAccount } from '../../progress/sync';
import { recordAttempt, recordFullRun, getProgress, snapshotReadiness, personalBest, practiceDisplay } from '../../progress/store';
import { keyAtTime } from '../../music/time';
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
import { IconBack, IconPause, IconPlay, IconRestart, IconStop } from '../icons';
import type { AttemptResult } from '../../game/types';
import type { NotationMode } from '../../game/notation';
import { NotFound } from '../components/NotFound';

type PlayRoute = Extract<Route, { name: 'play' }>;

export function PlayScreen({ route }: { route: PlayRoute }) {
  return route.words ? <WordsPlay route={route} /> : <SingPlay route={route} />;
}

function SingPlay({ route }: { route: PlayRoute }) {
  const [profile, updateProfile] = useProfile();
  const piece = getPiece(route.pieceId);
  const part = piece?.score.parts.find((p) => p.id === route.partId);
  const level = Math.max(0, Math.min(MAX_LEVEL, route.level | 0));
  const spec = level === 0 ? null : LEVELS[level - 1];
  const listenOnly = level === 0;

  const section = useMemo(() => {
    if (!piece) return null;
    if (GENERATED_SECTIONS.has(route.sectionId)) {
      const from = route.from ?? 0;
      const to = route.to ?? piece.score.duration;
      const bar = piece.score.measures.find((m) => Math.abs(m.start - from) < 1e-3);
      const label = route.sectionId === 'all' ? 'Whole piece' : route.sectionId === 'entries' ? 'Entry drill'
        : route.sectionId === 'cold' ? `Cold start: bar ${bar?.number ?? ''}` : 'Drill';
      return { id: route.sectionId, label, start: from, end: to };
    }
    const s = piece.sections.find((x) => x.id === route.sectionId);
    // Ladder sections always run whole (bar-range loops use the 'drill' section).
    return s ? { id: s.id, label: s.label, start: s.start, end: s.end } : null;
  }, [piece, route]);

  const [rateOverride, setRateOverride] = useState<number | null>(null);
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
  const [micMsg, setMicMsg] = useState('');
  const [listened, setListened] = useState(false);
  const [hud, setHud] = useState({ score: 0, combo: 0, count: 0, lyricIdx: -1 });
  const [gains, setGains] = useState<Record<string, number>>(() => {
    const g: Record<string, number> = {};
    for (const p of piece?.score.parts ?? []) {
      if (p.id === route.partId) g[p.id] = level === 0 || (level <= 2) ? 0.9 : 0;
      else g[p.id] = p.voiceType === 'other' ? 0.55 : 0.7;
    }
    return g;
  });
  const sessionRef = useRef<PracticeSession | null>(null);
  const { resume, resuming, resumeMsg } = useResume(sessionRef, setPhase, setMicMsg);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef(newFx());
  const fromResultsRef = useRef<boolean | null>(null);
  if (fromResultsRef.current === null) {
    try {
      fromResultsRef.current = sessionStorage.getItem('sh:fromResults') === '1';
      sessionStorage.removeItem('sh:fromResults');
    } catch {
      fromResultsRef.current = false;
    }
  }

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
  const tolerance = spec ? effectiveTolerance(level, profile.strictness) : 50;
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
  const others = useMemo(() => (piece && part ? hasOtherStaves(piece.score, part.id) : { voices: false, accompaniment: false }), [piece, part]);
  const fullScore = useMemo(() => wide && display === 'score' && !!piece && !!part && isFullScore(piece.score, part.id, staves),
    [wide, display, piece, part, staves]);
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
        scoring: { toleranceCents: tolerance, tuning: profile.tuning, octaveTolerant, rate },
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
    if (!r || listenOnly) {
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
    let alignLag = 0;
    const sess = sessionRef.current;
    const calibrated = profile.latencySource === 'measured' && profile.latencyMs > 0;
    if (sess) {
      const idx = r.notes.map((n) => n.index);
      const al = scoreAligned(
        { score: piece.score, part, range: [Math.min(...idx), Math.max(...idx)], end: sess.cfg.to },
        sess.samples, sess.cfg.scoring,
        {
          rate: sess.cfg.rate, latencyMs: sess.latencyMs, calibrated, liftSubharmonics: !sess.cfg.scoring.octaveTolerant,
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
      if (calibrated && Math.abs(al.shiftMs) >= 60) suggestDelayCheck = true;
      // From level 2 ("In time") on, coming in clearly late fails the run. Only with a measured
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
    if (!/~|^(row|leaps)-/.test(piece.id)) recordBars(piece.id, part.id, r, level, { peeked: sess?.peeked, hidden: hiddenRef.current });
    setLastRun(sess?.recording ? {
      recording: sess.recording,
      at: Date.now(),
      meta: {
        pieceId: piece.id, pieceTitle: piece.title, partId: part.id, partName: part.name,
        from: sess.cfg.from, to: sess.cfg.to, rate: sess.cfg.rate, level, scoring: sess.cfg.scoring,
        latencyMs: sess.latencyMs, calibrated,
        alignedMs: alignedMs ?? 0, samples: sess.samples, result: r,
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
    const isFull = section.id === 'all';
    const resumed = !!sess?.resumed;
    const arcade = route.mode === '3d';
    const fullCounted = isFull && fullRunCounts({ level, rate, partial, resumed, timingUnsure: timingUnsure != null, offBookPractice, arcade }).counted;
    const sectionLadder = realSection && !partial && timingUnsure == null && !offBookPractice && fullTempo;
    // Practice runs (slower tempo, stopped early) are logged but never change section levels.
    const recId = sectionLadder || !realSection ? section.id : 'practice';
    const durationSec = (section.end - section.start) / rate;
    const prevBest = personalBest(piece.id, part.id, recId, level)?.score ?? null;
    const secs = singableSections(piece, part.id);
    const full = isFull
      ? recordFullRun(piece.id, part.id, level, r, secs, (i) => part.notes[i]?.start,
        { counted: fullCounted, timingFail: timingFail != null, durationSec })
      : undefined;
    const rec = full ?? recordAttempt(piece.id, part.id, recId, level, r, durationSec, Date.now(), { timingFail: timingFail != null });
    const fixed = full ? undefined : (rec as ReturnType<typeof recordAttempt>).fixed;
    const ladder = full ? full.counted : sectionLadder;
    if (ladder) {
      snapshotReadiness(piece.id, part.id, pieceReadiness(secs, getProgress(piece.id, part.id)).pct);
    }
    void shareMyProgress();
    postBoardEntrySoon(piece.id);
    syncProgressSoon();
    suggestAccount(rec.passed);
    setLastResult({
      pieceId: piece.id, partId: part.id, sectionId: section.id, level, mode: route.mode,
      from: section.start, to: section.end, result: r, ladder, prevBest, tolerance, everyNote: !!spec?.everyNote,
      latencyAdjusted,
      alignedMs,
      suggestDelayCheck,
      timingFail,
      latencyUsedMs: sess ? Math.round(sess.latencyMs) : undefined,
      timingUnsure,
      offBookDays: rec.offBookDays,
      full,
      fixed,
      notCounted: (realSection || isFull) && !ladder
        ? (partial ? 'stopped early'
          : isFull && arcade ? 'arcade runs of the whole piece are just for fun'
          : isFull && resumed ? 'you paused and carried on (a run of the whole piece counts only in one go)'
          : full?.blocked ? `first fix ${full.blocked.map((id) => secs.find((s) => s.id === id)?.label ?? id).join(', ')} on ${full.blocked.length > 1 ? 'their' : 'its'} own at level ${level}`
          : offBookPractice ? (peekedN > 0 ? `you peeked at ${peekedN} bar${peekedN > 1 ? 's' : ''}` : 'some bars were still showing (practice mode)')
          : timingUnsure != null ? `your voice reached the app about ${timingUnsure} ms after the beat, and without the delay check the app can't tell whether that's your timing or your phone and headphones. Do the 10-second delay check in Voice setup`
            : 'slower than the level’s tempo')
        : undefined,
      passed: rec.passed, prevLevel: rec.prevLevel, newLevel: rec.newLevel,
    });
    trackPlayRun({
      pieceId: piece.id, part, sectionId: section.id, level, mode: route.mode, listenOnly: false, realSection, ladder, passed: rec.passed,
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
    setLastRun(null); // free the previous run's recording
    try {
      await startInner();
    } finally {
      startingRef.current = false;
    }
  }

  async function startInner() {
    sessionRef.current?.dispose();
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
    }
  }

  function listenInstead() {
    go({ ...route, level: 0 }, true);
  }

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
        notation, showNames, key: keyAtTime(piece.score, Math.max(0, pos)), tolerance,
        ghostParts,
        lo, hi, from: section.start, to: section.end,
        beatSec: s ? s.beatSec(Math.max(0, pos)) : 60 / tempoAt(piece.score.tempos, Math.max(0, pos)),
        staves,
        dimLyrics: doo,
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
        }
        let count = 0;
        if (s && s.phase === 'countin') {
          const target = sessionStartTarget(s, section.start);
          if (pos < target) count = Math.ceil((target - pos) / s.beatSec(target) - 1e-6);
          if (count > 4) count = 0; // a cold start's lead-in bars: only count the last beats
        }
        let lyricIdx = -1;
        for (let i = 0; i < part.notes.length; i++) {
          if (part.notes[i].start <= pos + 0.05) lyricIdx = i;
          else break;
        }
        const next = { score: s?.live?.score ?? 0, combo: s?.live?.combo ?? 0, count, lyricIdx };
        setHud((h) => (h.score === next.score && h.combo === next.combo && h.count === next.count && h.lyricIdx === next.lyricIdx ? h : next));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece, part, section, route.mode, notation, showNames, rate, tolerance, offBook, cold, display, staves, doo]);

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
      sessionRef.current?.dispose();
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
  const isFullRun = section.id === 'all' && !listenOnly;
  const fullSecs = isFullRun ? singableSections(piece, part.id) : [];
  const fullFixes = isFullRun ? fixesBefore(fullSecs, getProgress(piece.id, part.id), level) : [];

  /** Leave to the piece (or the screen that launched a generated drill), never to a stale Results. */
  function leave() {
    if (fromResultsRef.current || piece!.builtin && /~entries~|^row-|^leaps-/.test(piece!.id)) {
      go(/^row-|^leaps-/.test(piece!.id) ? { name: 'expert' } : { name: 'piece', pieceId: piece!.id.split('~')[0] }, true);
    } else back({ name: 'piece', pieceId: piece!.id });
  }

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
      <div className="play-hud">
        <button className="icon-btn" aria-label="Back" onClick={() => { sessionRef.current?.dispose(); leave(); }}><IconBack /></button>
        <div className="grow col" style={{ gap: 0 }}>
          <span className="ellipsis" style={{ fontWeight: 800, fontSize: 16 }}>{piece.title}</span>
          <span className="tiny muted ellipsis">
            {part.name} · {section.label} · {listenOnly ? 'Listen' : `L${level} ${levelInfo?.name}`}{route.mode === '3d' ? ' · Arcade' : ''}
          </span>
        </div>
        {!listenOnly && (
          <div className="col" style={{ alignItems: 'flex-end', gap: 0, paddingRight: 6 }}>
            <span className="mono" style={{ fontWeight: 600, fontSize: route.mode === '3d' ? 22 : 17 }} data-testid="score">{hud.score.toLocaleString()}</span>
            <span className="mono tiny" style={{ color: 'var(--accent)', whiteSpace: 'nowrap' }}>{hud.combo > 1 ? `combo ${hud.combo}` : ' '}</span>
          </div>
        )}
      </div>

      <div className="play-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} aria-label={display === 'score' ? undefined : route.mode === '3d' ? 'Arcade' : 'Note highway'} role="img" data-display={display} />
        <div className="sr-only" aria-live="polite" data-testid="countin-live">{hud.count > 0 && running ? String(hud.count) : ''}</div>
        {hud.count > 0 && running && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 96, fontWeight: 800, color: 'var(--accent)', textShadow: '0 0 24px #FF7A45' }}>{hud.count}</span>
            {sessionRef.current?.resumed && (
              <span className="small" data-testid="resume-hint" style={{ background: 'rgba(11,13,26,0.85)', borderRadius: 8, padding: '4px 10px' }}>Carry on singing from the line</span>
            )}
          </div>
        )}
        {phase === 'ready' && (
          // Scrolls on short phones; the card stays centred when it fits.
          <div className="overlay" style={{ overflowY: 'auto', alignItems: 'flex-start' }}>
            <div className="card" style={{ margin: 'auto 0', flex: 'none' }}>
              <span className="eyebrow">{listenOnly ? 'Level 0 · Listen' : `Level ${level} · ${levelInfo?.name}`}</span>
              <strong style={{ fontSize: 18 }}>{section.label}</strong>
              {!cold && <span className="small muted">{listenOnly ? LISTEN.description : levelInfo?.description}</span>}
              {/* What the level asks, near the top: on a small phone the sticky Start button covers the card's lower part. */}
              {!listenOnly && levelInfo && !cold && (
                <span className="tiny mono muted">
                  {Math.round(rate * 100)}% tempo · ±{tolerance}¢ · pass: {passLabel(levelInfo)} · start: {levelInfo.cue === 'chord' ? 'chord only' : 'your note'}
                </span>
              )}
              {doo && !listenOnly && (
                <div className="notice info small" data-testid="doo-note">
                  <strong>Sing every note on “doo”.</strong> The words are shown faintly; you sing them from level 2.
                </div>
              )}
              {isFullRun && (fullFixes.length ? (
                <div className="notice" data-testid="full-locked">
                  <strong>Fix {fullFixes.length === 1 ? 'this section' : 'these sections'} first:</strong>{' '}
                  {fullFixes.map((id) => fullSecs.find((x) => x.id === id)?.label ?? id).join(', ')} slipped in your last full run at level {level}.
                  Pass {fullFixes.length === 1 ? 'it' : 'each'} on {fullFixes.length === 1 ? 'its' : 'their'} own at level {level}; until then this run is practice and won't count.
                </div>
              ) : (
                <span className="small" data-testid="full-info">
                  Sing the whole piece in one go: pass it and the piece reaches level {level}. Every section is scored too,{' '}
                  {levelInfo?.everyNote ? 'and every note in it must be right.' : `and each must reach ${Math.round((levelInfo?.pass ?? 0.8) * 100)}%.`}
                  Stopping or pausing makes it a practice run.
                </span>
              ))}
              {cold && (
                <span className="small">
                  {coldLeadFrom(piece.score, section.start) != null ? "You'll hear two bars of the other voices, then come in" : 'After a count-in, come in'}{' '}
                  at bar {piece.score.measures.find((m) => section.start >= m.start - 1e-3 && section.start < m.start + m.dur - 1e-3)?.number} from memory: no starting note, nothing of your part shown.
                </span>
              )}
              {offBook && !cold && (
                <div className="col" style={{ gap: 6 }} data-testid="offbook-mode">
                  {allKnown ? (
                    <span className="small">You know every bar of this {isFullRun ? 'piece' : 'section'} by heart: this is the real test. Everything is hidden.</span>
                  ) : (
                    <>
                      <div className="chips" role="group" aria-label="Off-book mode">
                        <button className="chip" aria-pressed={obMode === 'fade'} onClick={() => setObMode('fade')}>Practise: fade out</button>
                        <button className="chip" aria-pressed={obMode === 'test'} onClick={() => setObMode('test')}>Test: all hidden</button>
                      </div>
                      <span className="small muted">
                        {obMode === 'fade'
                          ? known.size === 0
                            ? 'All bars still show. Bars you sing well from memory disappear, leaving the first letter of each word.'
                            : `${known.size} of ${sectionMeasures.length} bars are hidden (you know them). Hidden bars show only the first letter of each word.`
                          : 'Nothing of your part is shown. Only a run with no peeking counts.'}
                      </span>
                    </>
                  )}
                  <span className="tiny muted">Hold “Peek” to see the next bars for two seconds. Pass off book on {OFF_BOOK_DAYS} different days and the {isFullRun ? 'piece' : 'section'} is memorised.</span>
                </div>
              )}
              {route.mode === '2d' && !listenOnly && profile.scoreDefaultNote && display === 'score' && (
                <div className="col small" style={{ gap: 6, background: 'var(--bg-2)', borderRadius: 10, padding: '10px 12px' }} data-testid="score-default-note">
                  <strong>Sheet music is now the default</strong>
                  <span className="muted">Your voice is drawn on the staff: just under a note means flat, just over means sharp. Prefer the moving bars? Switch to Highway any time, here or in Settings.</span>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn voice" onClick={() => updateProfile({ scoreDefaultNote: false })} data-testid="score-default-ok">Got it</button>
                    <button className="btn" onClick={() => updateProfile({ display: 'highway', displayChosen: true, scoreDefaultNote: false })} data-testid="score-default-highway">Back to Highway</button>
                  </div>
                </div>
              )}
              {route.mode === '2d' && (
                <div className="col" style={{ gap: 4 }}>
                  <span className="tiny muted" id="display-label">Score / Highway <span style={{ opacity: 0.8 }}>(remembered)</span></span>
                  <div className="seg" role="group" aria-labelledby="display-label" data-testid="display-toggle">
                    <button aria-pressed={display === 'score'} onClick={() => updateProfile({ display: 'score', displayChosen: true, scoreDefaultNote: false })} data-testid="display-score">Score</button>
                    <button aria-pressed={display === 'highway'} onClick={() => updateProfile({ display: 'highway', displayChosen: true, scoreDefaultNote: false })} data-testid="display-highway">Highway</button>
                  </div>
                </div>
              )}
              {route.mode === '2d' && wide && display === 'score' && (others.voices || others.accompaniment) && (
                <div className="col" style={{ gap: 4 }}>
                  <span className="tiny muted" id="staves-label">Show <span style={{ opacity: 0.8 }}>{profile.scoreStaves ? '(remembered)' : '(automatic)'}</span></span>
                  <div className="seg" role="group" aria-labelledby="staves-label" data-testid="staves-toggle">
                    <button aria-pressed={staves === 'mine' || (staves === 'voices' && !others.voices)} onClick={() => pickStaves('mine')}>My part</button>
                    {others.voices && <button aria-pressed={staves === 'voices' || (staves === 'all' && !others.accompaniment)} onClick={() => pickStaves('voices')}>All voices</button>}
                    {others.accompaniment && <button aria-pressed={staves === 'all'} onClick={() => pickStaves('all')} data-testid="staves-all">{others.voices ? '+ Accomp.' : 'With accomp.'}</button>}
                  </div>
                  {offBook && staves !== 'mine' && <span className="tiny muted">Off book the full score shows the other voices without their words or the accompaniment, so nothing gives your part away.</span>}
                </div>
              )}
              {level === 1 && (
                <label className="field">
                  <span className="small">Tempo {Math.round(rate * 100)}%{rate < (spec?.rate ?? 1) - 1e-6 ? ' (slower than the level: practice only, won’t count)' : ''}</span>
                  <input type="range" min={40} max={100} step={5} value={Math.round(rate * 100)} onChange={(e) => setRateOverride(Number(e.target.value) / 100)} />
                </label>
              )}
              {!listenOnly && showHowto && (
                <div className="col small howto" style={{ gap: 4, background: 'var(--bg-2)', borderRadius: 10, padding: '10px 12px' }} data-testid="howto">
                  <strong>How to read the screen</strong>
                  {display === 'score' ? (
                    <>
                      {fullScore
                        ? <span>The full score: your part is the staff with the <span style={{ color: 'var(--voice)' }}>blue</span> band, the other voices are drawn plainly. The white line moves through the bars: sing the note it's on in your staff (it glows <span style={{ color: 'var(--accent)' }}>orange</span>).</span>
                        : <span>Your part as sheet music. The white line moves through the bar: sing the note it's on (it glows <span style={{ color: 'var(--accent)' }}>orange</span>).</span>}
                      <span><span style={{ color: 'var(--voice)' }}>━</span> Your voice draws a blue line at its exact height on the staff: just under the note means flat, just over means sharp (light orange when out of tune).</span>
                      <span>Notes turn <span style={{ color: 'var(--voice)' }}>blue</span> when sung well, <span style={{ color: '#F2D15C' }}>yellow</span> when close, <span style={{ color: '#FF5D73' }}>red</span> when missed. The bubble shows how many cents sharp (+) or flat (−) you are. Prefer moving bars? Choose Highway above.</span>
                    </>
                  ) : (
                    <>
                      <span><span style={{ color: 'var(--accent)' }}>■</span> Orange bars are your notes. They move left to the white line: sing when they reach it.</span>
                      <span><span style={{ color: 'var(--voice)' }}>━</span> The blue line is your voice. Keep it on the bar: the bar fills with blue when you're on the note.</span>
                      <span>Dashed outlines are the other voices. The bubble shows how many cents sharp (+) or flat (−) you are.</span>
                    </>
                  )}
                </div>
              )}
              {!listenOnly && <span className="tiny muted">Wear headphones so the mic only hears you.{!profile.latencyMs ? ' Tip: run voice setup once to measure your headphone delay.' : ''}</span>}
              {listenOnly && listened && !GENERATED_SECTIONS.has(section.id) ? (
                <>
                  <button className="btn primary block" onClick={() => go({ ...route, level: 1 }, true)} data-testid="learn-next">
                    <IconPlay size={18} /> Now learn it: level 1
                  </button>
                  <button className="btn block" onClick={start}>Listen again</button>
                </>
              ) : (
                <button className="btn primary block start-sticky" onClick={start} data-testid="start">
                  <IconPlay size={18} /> {listenOnly ? 'Listen' : 'Start singing'}
                </button>
              )}
            </div>
          </div>
        )}
        {phase === 'paused' && (
          <div className="overlay">
            <div className="card">
              <strong style={{ fontSize: 18 }}>Paused</strong>
              {isFullRun && <span className="small muted">A run of the whole piece counts only in one go: carry on to practise, or restart to sing it through for the level.</span>}
              {resumeMsg && <span className="small" role="status">{resumeMsg}</span>}
              <button className="btn primary block" autoFocus disabled={resuming} onClick={() => { void resume(); }}><IconPlay size={18} /> {resuming ? 'Resuming…' : 'Resume'}</button>
              <button className="btn block" onClick={() => { sessionRef.current?.dispose(); sessionRef.current = null; start(); }}><IconRestart size={18} /> {isFullRun ? 'Restart' : 'Restart section'}</button>
              {!listenOnly && <button className="btn block" onClick={() => sessionRef.current?.finish()}>Finish &amp; see results</button>}
              <button className="btn ghost block" onClick={() => { sessionRef.current?.dispose(); leave(); }}>Quit</button>
            </div>
          </div>
        )}
        {phase === 'micError' && (
          <div className="overlay">
            <div className="card" role="alert">
              <strong style={{ fontSize: 18 }}>No microphone</strong>
              <span className="small muted">{micMsg}</span>
              <button className="btn primary block" onClick={listenInstead}>Listen to this section instead</button>
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
        {/* With Peek too, Restart and Finish show only their icons on a phone (Pause always fits). */}
        <div className={`row play-actions${offBook && running && hiddenRef.current.size > 0 ? ' compact' : ''}`}>
          <button className="btn small" aria-label="Restart" disabled={!running} onClick={() => { sessionRef.current?.dispose(); sessionRef.current = null; start(); }}>
            <IconRestart size={16} /> <span className="lbl">Restart</span>
          </button>
          <div className="grow" />
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
              {!listenOnly && <button className="btn small" aria-label="Finish" onClick={() => sessionRef.current?.finish()}><IconStop size={14} color="#EEF0FF" /> <span className="lbl">Finish</span></button>}
              <button className="big-play" aria-label="Pause" onClick={() => { sessionRef.current?.pause(); setPhase('paused'); }}><IconPause /></button>
            </>
          ) : (
            <button className="big-play" aria-label="Start" onClick={() => (phase === 'paused' ? void resume() : start())}><IconPlay /></button>
          )}
        </div>
      </div>
    </main>
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

