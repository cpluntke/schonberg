import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../router';
import { go, leaveTo, practiceParent, pushGuard, useBackGuard } from '../router';
import { getPiece, noteRangeFor } from '../library';
import { useProfile } from '../hooks';
import { PracticeSession } from '../play/session';
import { track, trackRun } from '../../progress/metrics';
import { setLastResult } from '../play/lastResult';
import { useResume } from '../play/useResume';
import { lyricLine, simulateMode } from './Play';
import { wordInitial } from '../play/highway2d';
import { IconBack, IconHome, IconPause, IconPlay, IconRestart, IconStop } from '../icons';
import { STAGE_NAMES, scoreWords, syllableOnsets, syllableOnsetsWithLevels, syllablesOf, type Syllable, type WordsResult, type WordsStage } from '../../game/textrhythm';
import { getWords, recordWords } from '../../progress/words';
import type { AttemptResult } from '../../game/types';
import { NotFound } from '../components/NotFound';
import { PracticeBar } from '../components/PracticeBar';
import { SessionStrip } from '../components/Today';

type PlayRoute = Extract<Route, { name: 'play' }>;

const GRADE_COLOR = { perfect: '#4CC9F0', good: '#4CC9F0', ok: '#1D4F63', miss: '#FF5D73' } as const;

/** Syllable text as shown at a stage: full, the first letter of each word, or nothing. */
export function stageText(s: { text: string; wordStart: boolean }, stage: WordsStage): string {
  if (stage === 0) return s.text;
  if (stage === 1) return s.wordStart ? wordInitial({ lyric: s.text }) : '';
  return '';
}

/**
 * Words in rhythm: the music plays and you speak (or whisper, or sing) the text in time. Only
 * when each syllable starts is judged, from the loudness of your voice; pitch never matters.
 */
export function WordsPlay({ route }: { route: PlayRoute }) {
  const [profile] = useProfile();
  const piece = getPiece(route.pieceId);
  const part = piece?.score.parts.find((p) => p.id === route.partId);
  const section = useMemo(() => {
    if (!piece) return null;
    if (route.sectionId === 'all') return { id: 'all', label: 'Whole piece', start: 0, end: piece.score.duration };
    const s = piece.sections.find((x) => x.id === route.sectionId);
    return s ? { id: s.id, label: s.label, start: s.start, end: s.end } : null;
  }, [piece, route.sectionId]);
  const range = piece && part && section ? noteRangeFor(piece, part.id, section.start, section.end) : null;
  const syl: Syllable[] = useMemo(() => (part && range ? syllablesOf(part, range) : []), [part, range?.[0], range?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const progress = piece && part && section ? getWords(piece.id, part.id)[section.id] : undefined;
  const unlocked = Math.min(2, (progress?.passed ?? -1) + 1) as WordsStage;
  const [stage, setStage] = useState<WordsStage>(unlocked);
  const [rate, setRate] = useState(1);
  const [phase, setPhase] = useState<'ready' | 'running' | 'paused' | 'micError'>('ready');
  const [micMsg, setMicMsg] = useState('');
  const [lyricIdx, setLyricIdx] = useState(-1);
  const sessionRef = useRef<PracticeSession | null>(null);
  const { resume, resuming, resumeMsg } = useResume(sessionRef, setPhase, setMicMsg);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  function makeSession(): PracticeSession | null {
    if (!piece || !part || !section) return null;
    const s = new PracticeSession({
      score: piece.score, part, from: section.start, to: section.end, rate,
      guide: true, listenOnly: false, cue: 'note',
      scoring: { toleranceCents: 50, tuning: 'equal', octaveTolerant: true },
      latencyMs: profile.latencyMs || 0,
      range: null, // no pitch scoring
      beat: 'off',
      simulate: simulateMode(),
    }, () => onDone());
    // Everyone plays, your part too: the tune carries the rhythm of the words.
    for (const p of piece.score.parts) s.partGains[p.id] = p.id === part.id ? 0.6 : p.voiceType === 'other' ? 0.45 : 0.5;
    return s;
  }

  function onDone() {
    const sess = sessionRef.current;
    setPhase('ready');
    if (!sess || !piece || !part || !section || !range) return;
    const samples = sess.samples.filter((x) => x.time >= section.start - 0.3 && x.time <= section.end + 0.3);
    // Simulated speaker for tests/demos: a syllable burst on every written start.
    const sim = simulateMode();
    const heard = syllableOnsetsWithLevels(samples);
    const onsets = sim ? syl.map((x) => x.start + (sim === 'perfect' ? 0.01 : sim === 'flat' ? 0.03 : (x.index % 3 === 0 ? 0.4 : 0.02))) : heard.times;
    const calibrated = profile.latencySource === 'measured' && profile.latencyMs > 0;
    const res = scoreWords(syl, onsets, { rate: sess.cfg.rate, relative: !calibrated, levels: sim ? undefined : heard.levels });
    const counted = !sess.partial && section.id !== 'all' && rate >= 1 - 1e-6;
    const rec = counted ? recordWords(piece.id, part.id, section.id, stageRef.current, res.accuracy) : { passed: res.accuracy >= 0.8, newStage: false };
    const counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
    for (const x of res.syllables) counts[x.grade]++;
    const result: AttemptResult = {
      accuracy: res.accuracy, pitch: 0, rhythm: res.accuracy, score: 0, maxCombo: 0, counts, notes: [],
      perMeasure: res.perMeasure, insights: [],
    };
    setLastResult({
      pieceId: piece.id, partId: part.id, sectionId: section.id, level: 0, mode: '2d',
      from: section.start, to: section.end, result, passed: rec.passed, prevLevel: 0, newLevel: 0, ladder: false,
      words: { stage: stageRef.current, result: res, counted, newStage: rec.newStage, calibrated },
    });
    trackRun({ kind: 'words', level: 0, passed: rec.passed, counted, seconds: (section.end - section.start) / rate });
    go({ name: 'results' }, true);
  }

  const startingRef = useRef(false);
  async function start() {
    if (startingRef.current) return;
    startingRef.current = true;
    pushGuard(); // while speaking, the back button pauses (see Play)
    try {
      sessionRef.current?.dispose();
      const s = makeSession();
      if (!s) return;
      sessionRef.current = s;
      s.onInterrupted = () => setPhase('paused');
      await s.start();
      setPhase('running');
    } catch (e) {
      console.error(e);
      setMicMsg(sessionRef.current?.micError ?? 'Could not start audio.');
      track('err.mic');
      setPhase('micError');
    } finally {
      startingRef.current = false;
    }
  }

  // Render loop: a single lane of syllables (no pitch), plus your loudness and the syllables heard.
  useEffect(() => {
    let raf = 0;
    let lastOn = 0;
    let onsets: number[] = [];
    let graded: WordsResult | null = null;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap || !section) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
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
      const r = s?.cfg.rate ?? rate;
      if (s && ts - lastOn > 200) {
        lastOn = ts;
        // Live feedback on the last ~8 s only (the full judgement happens at the end).
        const recent = s.samples.filter((x) => x.time > pos - 9);
        onsets = syllableOnsets(recent);
        graded = scoreWords(syl.filter((x) => x.start < pos - 0.3 && x.start > pos - 8), onsets, { rate: r, relative: !(profile.latencySource === 'measured' && profile.latencyMs > 0) });
        let li = -1;
        if (part) for (let i = 0; i < part.notes.length; i++) { if (part.notes[i].start <= pos + 0.05) li = i; else break; }
        setLyricIdx(li);
      }
      drawWordsLane(c, W, H, { syl, pos, rate: r, stage: stageRef.current, onsets, graded, samples: s?.samples ?? [], measures: piece?.score.measures ?? [] });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [section, syl, rate, piece, part, profile.latencyMs, profile.latencySource]);

  useEffect(() => () => sessionRef.current?.dispose(), []);

  // ←, ⌂ or the back button mid-run pause and ask; otherwise ← goes back to the piece.
  const up = practiceParent(route) ?? { name: 'home' as const };
  function leaveFor(target: Parameters<typeof leaveTo>[0]) {
    const ph = sessionRef.current?.phase;
    if (ph === 'playing' || ph === 'countin') {
      sessionRef.current?.pause();
      setPhase('paused');
      return;
    }
    sessionRef.current?.dispose();
    leaveTo(target);
  }
  useBackGuard(() => leaveFor(up));
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && sessionRef.current && (sessionRef.current.phase === 'playing' || sessionRef.current.phase === 'countin')) {
        sessionRef.current.pause();
        setPhase('paused');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (!piece || !part || !section) return <NotFound pieceId={route.pieceId} />;
  const shown = part.notes.map((n, i) => (i <= lyricIdx || stage === 0 ? n
    : { ...n, lyric: stage === 1 ? wordInitial(n) || undefined : undefined, syllabic: 'single' as const }));
  const lyric = lyricLine(shown, lyricIdx, range);
  const running = phase === 'running';

  return (
    <main className="play">
      <h1 className="sr-only">{piece.title}: words of {section.label}</h1>
      <PracticeBar className="play-hud" up={up} title={piece.title} sub={`${part.name} · ${section.label} · Words: ${STAGE_NAMES[stage]}`}
        onBack={() => leaveFor(up)} onHome={() => leaveFor({ name: 'home' })} />
      <div className="play-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} aria-label="Words lane" role="img" />
        {phase === 'ready' && (
          <div className="overlay">
            <div className="card words-card">
              <SessionStrip pieceId={piece.id} compact />
              <span className="eyebrow">Words in rhythm</span>
              <strong style={{ fontSize: 18 }}>{section.label}</strong>
              {syl.length === 0 ? (
                <span className="small muted">Your part has no words here.</span>
              ) : (
                <>
                  <span className="small muted">
                    Speak or whisper the words in time with the music (speak, don't sing: pitch doesn't matter here). Crisp consonants help the app hear each syllable.
                    Wear headphones: through the speaker the music drowns your voice.
                  </span>
                  <div className="chips" role="group" aria-label="How much text to show">
                    {STAGE_NAMES.map((n, k) => (
                      <button key={n} className="chip" aria-pressed={stage === k} disabled={k > unlocked}
                        title={k > unlocked ? 'Get 80% at the previous step first' : undefined}
                        onClick={() => setStage(k as WordsStage)}>{k > unlocked ? '🔒 ' : ''}{n}{(progress?.passed ?? -1) >= k ? ' ✓' : ''}</button>
                    ))}
                  </div>
                  <label className="field">
                    <span className="small">Tempo {Math.round(rate * 100)}%{rate < 1 ? ' (practice: counts from 100%)' : ''}</span>
                    <input type="range" min={60} max={100} step={5} value={Math.round(rate * 100)} onChange={(e) => setRate(Number(e.target.value) / 100)} />
                  </label>
                  <button className="btn primary block" onClick={start} data-testid="start"><IconPlay size={18} /> Start</button>
                </>
              )}
            </div>
          </div>
        )}
        {phase === 'micError' && (
          <div className="overlay">
            <div className="card" role="alert">
              <strong style={{ fontSize: 18 }}>No microphone</strong>
              <span className="small muted">{micMsg}</span>
              <button className="btn block" onClick={() => setPhase('ready')}>Try again</button>
            </div>
          </div>
        )}
      </div>
      <div className="lyrics" aria-live="off">
        <span className="done">{lyric.done}</span><span className="now">{lyric.now}</span><span className="next">{lyric.next}</span>
      </div>
      <div className="play-controls">
        <div className="row play-actions">
          <button className="btn small" disabled={!running} onClick={() => { sessionRef.current?.dispose(); start(); }}><IconRestart size={16} /> Restart</button>
          <div className="grow" />
          {running ? (
            <>
              <button className="btn small" onClick={() => sessionRef.current?.finish()}><IconStop size={14} color="#EEF0FF" /> Finish</button>
              <button className="big-play" aria-label="Pause" onClick={() => { sessionRef.current?.pause(); setPhase('paused'); }}><IconPause /></button>
            </>
          ) : (
            // (Ready: the card's Start button is the one to tap.)
            phase !== 'ready' && <button className="big-play" aria-label="Start" disabled={!syl.length} onClick={() => (phase === 'paused' ? (pushGuard(), void resume()) : start())}><IconPlay /></button>
          )}
        </div>
      </div>
      {phase === 'paused' && (
        <div className="overlay sheet" data-testid="pause-sheet">
          <div className="card" role="dialog" aria-label="Paused">
            <strong style={{ fontSize: 18 }}>Paused</strong>
            {resumeMsg && <span className="small" role="status">{resumeMsg}</span>}
            <button className="btn primary block" autoFocus disabled={resuming} onClick={() => { pushGuard(); void resume(); }}><IconPlay size={18} /> {resuming ? 'Resuming…' : 'Resume'}</button>
            <button className="btn block" onClick={() => { sessionRef.current?.dispose(); sessionRef.current = null; start(); }}><IconRestart size={18} /> Restart passage</button>
            <button className="btn block" onClick={() => sessionRef.current?.finish()}>Finish &amp; see results</button>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn block" data-testid="pause-back" onClick={() => leaveFor(up)}><IconBack size={18} /> Back to the piece</button>
              <button className="btn block" data-testid="pause-home" onClick={() => leaveFor({ name: 'home' })}><IconHome size={18} /> Home</button>
            </div>
            <span className="tiny muted" style={{ textAlign: 'center' }}>Leaving discards this run (it doesn’t count).</span>
          </div>
        </div>
      )}
    </main>
  );
}

function drawWordsLane(c: CanvasRenderingContext2D, W: number, H: number, s: {
  syl: Syllable[]; pos: number; rate: number; stage: WordsStage; onsets: number[]; graded: WordsResult | null;
  samples: { time: number; rms: number }[]; measures: { start: number; number: string }[];
}) {
  const nowX = W * 0.28;
  const pps = 170 / Math.max(0.3, s.rate);
  const x = (t: number) => nowX + (t - s.pos) * pps;
  const tMin = s.pos - nowX / pps;
  const tMax = s.pos + (W - nowX) / pps;
  c.fillStyle = '#0F1226';
  c.fillRect(0, 0, W, H);
  // Bar lines.
  c.font = '600 10px "JetBrains Mono", monospace';
  c.textBaseline = 'top';
  for (const m of s.measures) {
    if (m.start < tMin || m.start > tMax) continue;
    c.fillStyle = '#262B4D';
    c.fillRect(Math.round(x(m.start)), 14, 1, H - 14);
    c.fillStyle = '#A8B0D6';
    c.fillText(m.number, x(m.start) + 3, 2);
  }
  // Syllables.
  const laneY = H * 0.38;
  const gradeOf = new Map((s.graded?.syllables ?? []).map((g) => [g.index, g.grade]));
  for (let k = 0; k < s.syl.length; k++) {
    const sy = s.syl[k];
    const end = k + 1 < s.syl.length ? Math.min(s.syl[k + 1].start, sy.start + 1.2) : sy.start + 0.6;
    if (end < tMin || sy.start > tMax) continue;
    const past = sy.start < s.pos - 0.3;
    const g = past ? gradeOf.get(sy.index) : undefined;
    const bx = x(sy.start);
    const bw = Math.max(18, (end - sy.start) * pps - 4);
    c.fillStyle = g ? GRADE_COLOR[g] : sy.start <= s.pos && s.pos < end ? '#FF7A45' : '#2A1A16';
    c.globalAlpha = g === 'miss' ? 0.6 : 1;
    c.beginPath();
    c.roundRect?.(bx, laneY - 22, bw, 44, 10);
    if (!c.roundRect) c.rect(bx, laneY - 22, bw, 44);
    c.fill();
    c.globalAlpha = 1;
    if (!g && !(sy.start <= s.pos && s.pos < end)) {
      c.strokeStyle = '#FF7A45';
      c.lineWidth = 2;
      c.stroke();
    }
    // Past syllables always show their text (feedback); upcoming ones as the stage allows.
    const txt = past ? sy.text : stageText(sy, s.stage);
    if (txt) {
      c.font = `800 ${txt.length > 6 ? 13 : 16}px "Bricolage Grotesque", sans-serif`;
      c.textBaseline = 'middle';
      c.fillStyle = g || sy.start <= s.pos ? '#0B0D1A' : '#FFB08F';
      c.fillText(txt, bx + 6, laneY + 1, bw - 8);
    }
  }
  // Your loudness and the syllables the app heard.
  const baseY = H - 18;
  c.strokeStyle = '#4CC9F0';
  c.lineWidth = 2;
  c.beginPath();
  let started = false;
  for (const p of s.samples) {
    if (p.time < tMin || p.time > s.pos + 0.05) continue;
    const dbv = Math.max(-60, 20 * Math.log10(Math.max(p.rms, 1e-5)));
    const yy = baseY - ((dbv + 60) / 60) * (H * 0.3);
    if (!started) { c.moveTo(x(p.time), yy); started = true; } else c.lineTo(x(p.time), yy);
  }
  c.stroke();
  c.fillStyle = '#EEF0FF';
  for (const t of s.onsets) {
    if (t < tMin || t > s.pos) continue;
    c.fillRect(Math.round(x(t)) - 1, baseY - H * 0.32, 2, 8);
  }
  c.fillStyle = 'rgba(238,240,255,0.85)';
  c.fillRect(Math.round(nowX) - 1, 14, 2, H - 14);
}
