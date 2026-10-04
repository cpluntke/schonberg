import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../router';
import { go, back } from '../router';
import { getPiece, noteRangeFor, singableSections } from '../library';
import { useProfile } from '../hooks';
import { LEVELS, LISTEN, effectiveTolerance, pieceReadiness } from '../../progress/ladder';
import { recordAttempt, getProgress, snapshotReadiness, personalBest } from '../../progress/store';
import { keyAtTime } from '../../music/time';
import { PracticeSession } from '../play/session';
import { scoreAttempt } from '../../game/scoring';
import { drawHighway2D, pitchWindow, type DrawState } from '../play/highway2d';
import { drawArcade, lanesFor, newFx } from '../play/arcade3d';
import { setLastResult } from '../play/lastResult';
import { IconBack, IconPause, IconPlay, IconRestart, IconStop } from '../icons';
import type { AttemptResult } from '../../game/types';
import type { NotationMode } from '../../game/notation';

type PlayRoute = Extract<Route, { name: 'play' }>;

export function PlayScreen({ route }: { route: PlayRoute }) {
  const [profile, updateProfile] = useProfile();
  const piece = getPiece(route.pieceId);
  const part = piece?.score.parts.find((p) => p.id === route.partId);
  const level = Math.max(0, Math.min(4, route.level | 0));
  const spec = level === 0 ? null : LEVELS[level - 1];
  const listenOnly = level === 0;

  const section = useMemo(() => {
    if (!piece) return null;
    if (route.sectionId === 'all' || route.sectionId === 'drill' || route.sectionId === 'entries') {
      const from = route.from ?? 0;
      const to = route.to ?? piece.score.duration;
      const label = route.sectionId === 'all' ? 'Whole piece' : route.sectionId === 'entries' ? 'Entry drill' : 'Drill';
      return { id: route.sectionId, label, start: from, end: to };
    }
    const s = piece.sections.find((x) => x.id === route.sectionId);
    // Ladder sections always run whole (bar-range loops use the 'drill' section).
    return s ? { id: s.id, label: s.label, start: s.start, end: s.end } : null;
  }, [piece, route]);

  const [rateOverride, setRateOverride] = useState<number | null>(null);
  const [firstTime] = useState(() => {
    try {
      if (route.mode !== '2d' || route.level === 0) return false;
      if (typeof matchMedia === 'function' && matchMedia('(max-height: 520px)').matches) return false; // hidden in landscape
      return localStorage.getItem('sh:seenHowto') !== '1';
    } catch { return false; }
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
  const tolerance = spec ? effectiveTolerance(level, profile.strictness) : 50;
  const showNames = spec ? spec.showNames : true;
  const notation = profile.notation as NotationMode;
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
        cue: route.sectionId === 'entries' ? 'none' : spec?.cue ?? 'note',
        scoring: { toleranceCents: tolerance, tuning: profile.tuning, octaveTolerant },
        latencyMs: profile.latencyMs || 0,
        range,
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
        setListened(true);
      }
      return;
    }
    // Uncalibrated singers who are consistently late on entries after rests: that's almost always
    // headphone/output delay, not the singer. Learn it once so the next run is scored fairly.
    let latencyAdjusted: number | undefined;
    const sess = sessionRef.current;
    if (sess && !profile.latencyMs && !simulateMode()) {
      const entryOnsets = r.notes
        .filter((n) => {
          const i = n.index;
          const prev = i > 0 ? part.notes[i - 1] : null;
          return n.onsetMs != null && (!prev || part.notes[i].start - (prev.start + prev.dur) >= 0.4);
        })
        .map((n) => n.onsetMs!)
        .sort((a, b) => a - b) as number[];
      // Few entries in this section? Every onset shifts with the delay, so use all of them.
      // (Skip repeated pitches sung legato: their "onset" is just the held voice, at ~0 ms.)
      const allOnsets = r.notes
        .filter((n) => {
          if (n.onsetMs == null) return false;
          const prev = n.index > 0 ? part.notes[n.index - 1] : null;
          const cur = part.notes[n.index];
          return !(prev && prev.midi === cur.midi && cur.start - (prev.start + prev.dur) < 0.25);
        })
        .map((n) => n.onsetMs!)
        .sort((a, b) => a - b);
      const useAll = entryOnsets.length < 2 && allOnsets.length >= 6;
      if (useAll) entryOnsets.splice(0, entryOnsets.length, ...allOnsets);
      if (entryOnsets.length >= 2) {
        const med = entryOnsets[Math.floor(entryOnsets.length / 2)];
        const iqr = entryOnsets[Math.floor(entryOnsets.length * 0.75)] - entryOnsets[Math.floor(entryOnsets.length * 0.25)];
        // Conservative: only clearly late and consistent (a singer who is genuinely late varies more).
        if (med / rate > 110 && iqr / rate < 120) {
          // Onsets are in score time; at reduced tempo one score-ms lasts 1/rate real ms.
          // ~50 ms of each onset is detection lag (attack + analysis window), not delay.
          latencyAdjusted = Math.round(Math.min(400, sess.latencyMs + (med / rate - 50)));
          updateProfile({ latencyMs: latencyAdjusted });
          // Re-score this run with the learned delay (converted back to score seconds).
          const shift = ((latencyAdjusted - sess.latencyMs) / 1000) * rate;
          const idx = r.notes.map((n) => n.index);
          r = scoreAttempt(
            { score: piece.score, part, range: [Math.min(...idx), Math.max(...idx)] },
            sess.samples.map((x) => ({ ...x, time: x.time - shift })),
            sess.cfg.scoring,
          );
        }
      }
    }
    const realSection = section.id !== 'all' && section.id !== 'drill' && section.id !== 'entries';
    const partial = !!sessionRef.current?.partial;
    const ladder = realSection && !partial && (rateOverride == null || rateOverride >= (spec?.rate ?? 1) - 1e-6);
    // Practice runs (slower tempo, stopped early) are logged but never change section levels.
    const recId = ladder || !realSection ? section.id : 'practice';
    const durationSec = (section.end - section.start) / rate;
    const prevBest = personalBest(piece.id, part.id, recId, level)?.score ?? null;
    const rec = recordAttempt(piece.id, part.id, recId, level, r, durationSec);
    if (ladder) {
      const secs = singableSections(piece, part.id);
      snapshotReadiness(piece.id, part.id, pieceReadiness(secs, getProgress(piece.id, part.id)).pct);
    }
    setLastResult({
      pieceId: piece.id, partId: part.id, sectionId: section.id, level, mode: route.mode,
      from: section.start, to: section.end, result: r, ladder, prevBest,
      latencyAdjusted,
      notCounted: realSection && !ladder ? (partial ? 'stopped early' : 'slower than the level’s tempo') : undefined,
      passed: rec.passed, prevLevel: rec.prevLevel, newLevel: rec.newLevel,
    });
    go({ name: 'results' }, true);
  }

  const startingRef = useRef(false);
  async function start() {
    if (startingRef.current) return; // double tap
    startingRef.current = true;
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
      };
      if (route.mode === '3d') drawArcade(c, W, H, st, fxRef.current, (lanes ??= lanesFor(st)), ts / 1000);
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
  }, [piece, part, section, route.mode, notation, showNames, rate, tolerance]);

  useEffect(() => {
    if (firstTime) try { localStorage.setItem('sh:seenHowto', '1'); } catch { /* ignore */ }
  }, [firstTime]);

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

  if (!piece || !part || !section) {
    return (
      <main className="screen">
        <div className="topbar"><button className="icon-btn" aria-label="Back" onClick={() => back()}><IconBack /></button><h1>Not found</h1></div>
        <p className="muted">This section couldn't be found. It may have been deleted.</p>
      </main>
    );
  }

  const lyric = lyricLine(part.notes, hud.lyricIdx, range);
  const vocal = piece.score.parts.filter((p) => p.notes.length > 0 || p.voiceType === 'other');
  const levelInfo = spec ?? null;
  const running = phase === 'running';

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
    <main className="play">
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
        <canvas ref={canvasRef} aria-label="Note highway" role="img" />
        {hud.count > 0 && running && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 96, fontWeight: 800, color: 'var(--accent)', textShadow: '0 0 24px #FF7A45' }}>{hud.count}</span>
          </div>
        )}
        {phase === 'ready' && (
          <div className="overlay">
            <div className="card">
              <span className="eyebrow">{listenOnly ? 'Level 0 · Listen' : `Level ${level} · ${levelInfo?.name}`}</span>
              <strong style={{ fontSize: 18 }}>{section.label}</strong>
              <span className="small muted">{listenOnly ? LISTEN.description : levelInfo?.description}</span>
              {!listenOnly && levelInfo && (
                <span className="tiny mono muted">
                  {Math.round(rate * 100)}% tempo · ±{tolerance}¢ · pass at {Math.round(levelInfo.pass * 100)}% · start: {levelInfo.cue === 'chord' ? 'chord only' : 'your note'}
                </span>
              )}
              {level === 1 && (
                <label className="field">
                  <span className="small">Tempo {Math.round(rate * 100)}%{rate < (spec?.rate ?? 1) - 1e-6 ? ' (slower than the level: practice only, won’t count)' : ''}</span>
                  <input type="range" min={40} max={100} step={5} value={Math.round(rate * 100)} onChange={(e) => setRateOverride(Number(e.target.value) / 100)} />
                </label>
              )}
              {!listenOnly && firstTime && (
                <div className="col small howto" style={{ gap: 4, background: 'var(--bg-2)', borderRadius: 10, padding: '10px 12px' }} data-testid="howto">
                  <strong>How to read the screen</strong>
                  <span><span style={{ color: 'var(--accent)' }}>■</span> Orange bars are your notes. They move left to the white line: sing when they reach it.</span>
                  <span><span style={{ color: 'var(--voice)' }}>━</span> The blue line is your voice. Keep it on the bar: the bar fills with blue when you're on the note.</span>
                  <span>Dashed outlines are the other voices. The bubble shows how many cents sharp (+) or flat (−) you are.</span>
                </div>
              )}
              {!listenOnly && <span className="tiny muted">Wear headphones so the mic only hears you.{!profile.latencyMs ? ' Tip: run voice setup once to measure your headphone delay.' : ''}</span>}
              {listenOnly && listened && section.id !== 'all' && section.id !== 'drill' && section.id !== 'entries' ? (
                <>
                  <button className="btn primary block" onClick={() => go({ ...route, level: 1 }, true)} data-testid="learn-next">
                    <IconPlay size={18} /> Now learn it: level 1
                  </button>
                  <button className="btn block" onClick={start}>Listen again</button>
                </>
              ) : (
                <button className="btn primary block" onClick={start} data-testid="start">
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
              <button className="btn primary block" onClick={() => { sessionRef.current?.resume(); setPhase('running'); }}><IconPlay size={18} /> Resume</button>
              <button className="btn block" onClick={() => { sessionRef.current?.dispose(); sessionRef.current = null; start(); }}><IconRestart size={18} /> Restart section</button>
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

      <div className="lyrics" aria-live="off">
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
                {shortName(p.name)}{me ? ' · you' : ''}{on ? '' : ' (off)'}
              </button>
            );
          })}
        </div>
        <div className="row">
          <button className="btn small" disabled={!running} onClick={() => { sessionRef.current?.dispose(); sessionRef.current = null; start(); }}>
            <IconRestart size={16} /> Restart
          </button>
          <div className="grow" />
          {running ? (
            <>
              {!listenOnly && <button className="btn small" onClick={() => sessionRef.current?.finish()}><IconStop size={14} color="#EEF0FF" /> Finish</button>}
              <button className="big-play" aria-label="Pause" onClick={() => { sessionRef.current?.pause(); setPhase('paused'); }}><IconPause /></button>
            </>
          ) : (
            <button className="big-play" aria-label="Start" onClick={() => (phase === 'paused' ? (sessionRef.current?.resume(), setPhase('running')) : start())}><IconPlay /></button>
          )}
        </div>
      </div>
    </main>
  );
}

/** `?simulate=perfect|flat|sloppy` (or localStorage sh:simulate) replaces the mic with a synthetic singer. */
export function simulateMode(): 'perfect' | 'flat' | 'sloppy' | null {
  let v: string | null = null;
  try {
    v = new URLSearchParams(location.search).get('simulate') ?? localStorage.getItem('sh:simulate');
  } catch { /* ignore */ }
  return v === 'perfect' || v === 'flat' || v === 'sloppy' ? v : null;
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
  return { done: done.slice(-28), now, next };
}

function emptyResult(): AttemptResult {
  return { accuracy: 0, pitch: 0, rhythm: 0, score: 0, maxCombo: 0, counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, notes: [], perMeasure: {}, insights: [] };
}
