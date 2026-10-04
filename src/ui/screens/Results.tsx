import React, { useState } from 'react';
import { getLastRun, shareRun } from '../play/runExport';
import { startColdStart } from '../play/cold';
import { STAGE_NAMES, WORDS_PASS, type WordsStage } from '../../game/textrhythm';
import { toast } from '../hooks';
import { getLastResult } from '../play/lastResult';
import { getPiece, singableSections } from '../library';
import { go } from '../router';
import { LEVELS, OFF_BOOK_DAYS, nextStep } from '../../progress/ladder';
import { getProgress } from '../../progress/store';
import { IconDown, IconUp, IconClock, IconLoop, IconStar, IconPlay, IconCube } from '../icons';
import type { Insight } from '../../game/types';

/** Start a run from Results; replace the history entry so "back" from the run doesn't land on stale results. */
function goPlay(r: Parameters<typeof go>[0]) {
  try { sessionStorage.setItem('sh:fromResults', '1'); } catch { /* storage blocked */ }
  go(r, true);
}

function gradeLetter(acc: number): string {
  if (acc >= 0.95) return 'S';
  if (acc >= 0.85) return 'A';
  if (acc >= 0.7) return 'B';
  if (acc >= 0.5) return 'C';
  return 'D';
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
    return (
      <main className="screen">
        <h1 className="hero">No results yet</h1>
        <button className="btn primary" onClick={() => go({ name: 'home' })}>Home</button>
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
  const isPB = lr.prevBest != null && r.score > lr.prevBest;
  const leveledUp = lr.ladder && lr.newLevel > lr.prevLevel;

  const sungCents = r.notes.map((n) => n.cents).filter((c): c is number => c != null && Math.abs(c) < 100).sort((a, b) => a - b);
  const avgCents = sungCents.length ? Math.round(sungCents[Math.floor(sungCents.length / 2)]) : null;
  const measureIdx = Object.keys(r.perMeasure).map(Number).sort((a, b) => a - b);
  const mnum = (i: number) => piece.score.measures[i]?.number ?? String(i + 1);

  const playLoop = (m0: number, m1: number, level = Math.max(1, Math.min(lr.level, 2))) => {
    const ms = piece.score.measures;
    const from = ms[Math.max(0, m0)]?.start ?? lr.from;
    const last = ms[Math.min(ms.length - 1, m1)];
    const to = last ? last.start + last.dur : lr.to;
    goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'drill', level, mode: '2d', from, to });
  };

  // A run that failed (or didn't count) on timing isn't an "excellent run".
  const insights = lr.timingFail != null || lr.timingUnsure != null ? r.insights.filter((i) => i.kind !== 'great') : r.insights;

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
      {lr.notCounted && (
        <div className="notice info" role="status" data-testid="pass-banner">
          <strong>Practice run:</strong> {lr.notCounted}{lr.timingUnsure != null ? '.'
            : lr.level === 5 && !/stopped early/.test(lr.notCounted) ? <>, so it doesn't count toward memorising the section yet. When the map shows it's ready, choose “Test: all hidden” and sing it without peeking.</>
              : <>, so it doesn't count toward the level. Sing the whole section at the level's tempo to level up.</>}
          {lr.timingUnsure != null && <> <button className="linklike" onClick={() => go({ name: 'setup' })}>Open Voice setup</button></>}
        </div>
      )}
      {lr.ladder && (
        <div className={lr.passed ? 'notice info' : 'notice'} role="status" data-testid="pass-banner">
          {lr.passed && lr.level === 5 && lr.newLevel < 5
            ? <><strong>Sung from memory!</strong> That's day {lr.offBookDays ?? 1} of {OFF_BOOK_DAYS}: do it again on another day and the section counts as memorised.{leveledUp ? ` (And it's concert-ready now.)` : ''}</>
            : leveledUp
            ? <><strong>Level {lr.newLevel} reached: {LEVELS[lr.newLevel - 1]?.name}!</strong> {lr.newLevel >= 5 ? 'This section is memorised.' : lr.newLevel >= 4 ? 'This section is concert-ready.' : lr.newLevel >= 3 ? 'This section is rehearsal-ready.' : ''}</>
            : lr.passed && lr.level === 5 && lr.newLevel < 5
              ? <><strong>Sung from memory!</strong> That's day {lr.offBookDays ?? 1} of {OFF_BOOK_DAYS}: do it again on another day and the section counts as memorised.</>
            : lr.passed
              ? <><strong>Passed.</strong> You keep level {lr.newLevel}.</>
              : lr.timingFail != null && r.accuracy >= (spec?.pass ?? 0.8)
                ? lr.suggestDelayCheck
                  ? <><strong>Not yet:</strong> the notes were right ({Math.round(r.accuracy * 100)}%), but your voice reached the app about {lr.timingFail} ms after the beat. Either your headphones changed since the delay check (redo it in Voice setup, it takes 10 seconds) or you're singing behind the music: breathe early and sing with it, not after it.</>
                  : <><strong>Not yet:</strong> the notes were right ({Math.round(r.accuracy * 100)}%), but you came in about {lr.timingFail} ms behind the beat. Breathe early and sing with the music, not after it.</>
                : <><strong>Not yet:</strong> {Math.round(r.accuracy * 100)}% of {Math.round((spec?.pass ?? 0.8) * 100)}% needed. Use the tips below and try again.</>}
        </div>
      )}

      <div className="row" style={{ gap: 20 }}>
        <div className="grade-tile" aria-label={`Grade ${gradeLetter(r.accuracy)}`}>{gradeLetter(r.accuracy)}</div>
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

      {measureIdx.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <div className="row between">
            <h2 style={{ fontSize: 16 }}>Bar by bar</h2>
            <span className="tiny muted">tap a bar to loop it</span>
          </div>
          <div className="heat">
            {measureIdx.map((m) => {
              const v = r.perMeasure[m];
              const bg = v >= 0.85 ? '#4CC9F0' : v >= 0.6 ? '#1D4F63' : '#FF7A45';
              return <button key={m} aria-label={`Bar ${mnum(m)}: ${Math.round(v * 100)}%`} title={`Bar ${mnum(m)} · ${Math.round(v * 100)}%`} style={{ background: bg, color: bg === '#1D4F63' ? '#EEF0FF' : '#0B0D1A', fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)' }} onClick={() => playLoop(m - 1, m + 1)}>{mnum(m)}</button>;
            })}
          </div>
          <div className="row tiny muted" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#4CC9F0' }} />solid</span>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#1D4F63' }} />ok</span>
            <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#FF7A45' }} />needs work</span>
            <span className="grow" style={{ textAlign: 'right' }}>bars {mnum(measureIdx[0])}–{mnum(measureIdx[measureIdx.length - 1])}</span>
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
                  <IconLoop size={16} /> Loop bars {mnum(i.measures[0])}–{mnum(i.measures[1])} slowly
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
        ) : !lr.passed && lr.ladder ? (
          <button className="btn primary block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level, mode: lr.mode })}>
            <IconPlay size={18} /> Try again
          </button>
        ) : next ? (
          <button className="btn primary block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: next.sectionId, level: next.level, mode: '2d' })}>
            <IconPlay size={18} /> Next: {sections.find((s) => s.id === next.sectionId)?.label}, level {next.level}
          </button>
        ) : (
          <button className="btn primary block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'all', level: 4, mode: '3d' })}>
            <IconCube size={18} color="#0B0D1A" /> Concert-ready! Arcade run of the whole piece
          </button>
        )}
        <div className="row">
          {!lr.passed && lr.ladder && lr.level > 1 ? (
            <button className="btn block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level - 1, mode: '2d' })}>
              Easier: level {lr.level - 1}
            </button>
          ) : !(!lr.passed && lr.ladder) ? (
            <button className="btn block" onClick={() => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: lr.level, mode: lr.mode, ...(lr.sectionId === 'drill' || lr.sectionId === 'cold' ? { from: lr.from, to: lr.to } : {}) })}>Again</button>
          ) : null}
          <button className="btn block" onClick={() => go({ name: 'piece', pieceId: piece.id })}>All sections</button>
        </div>
        <button className="btn ghost block" onClick={() => go({ name: 'ranks' })}>Leaderboard</button>
        <ShareRecording pieceId={lr.pieceId} partId={lr.partId} />
      </div>
    </main>
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
  const measureIdx = Object.keys(res.perMeasure).map(Number).sort((a, b) => a - b);
  const nextStage = words.stage < 2 && res.accuracy >= WORDS_PASS ? ((words.stage + 1) as WordsStage) : null;
  // The words screen opens at the next step that isn't passed yet.
  const again = () => goPlay({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: lr.sectionId, level: 0, mode: '2d', words: true });
  const color = { perfect: 'var(--voice)', good: 'var(--voice)', ok: '#7FB8CC', miss: '#FF7A45' } as const;
  return (
    <main className="screen">
      <div className="col" style={{ gap: 2, paddingTop: 8 }}>
        <span className="eyebrow">{section?.label ?? 'Whole piece'} · {part?.name} · Words: {STAGE_NAMES[words.stage]}</span>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>{piece.title}</h1>
      </div>
      <div className={res.accuracy >= WORDS_PASS ? 'notice info' : 'notice'} role="status" data-testid="words-banner">
        {!words.counted
          ? <><strong>Practice run</strong> (slower tempo or stopped early): sing it at 100% to move on.</>
          : words.newStage
            ? <><strong>{STAGE_NAMES[words.stage]}: done!</strong> {words.stage === 2 ? 'You know the words of this section by heart.' : `Next: ${STAGE_NAMES[words.stage + 1]}.`}</>
            : res.accuracy >= WORDS_PASS
              ? <><strong>Well done.</strong> {pct}% of the syllables in time.</>
              : <><strong>Not yet:</strong> {pct}% of {Math.round(WORDS_PASS * 100)}%. Say the words in rhythm, with crisp consonants.</>}
      </div>
      <div className="stats3">
        <div className="stat"><span className="k">In time</span><span className="v">{pct}%</span></div>
        <div className="stat"><span className="k">Syllables</span><span className="v">{inTime}/{res.syllables.length}</span></div>
        <div className="stat"><span className="k">Missed</span><span className="v">{res.missed}</span></div>
      </div>
      {words.calibrated && res.medianMs !== null && Math.abs(res.medianMs) > 120 && (
        <span className="small muted">On average you were about {Math.abs(res.medianMs)} ms {res.medianMs > 0 ? 'late' : 'early'}.</span>
      )}
      {part && (
        <div className="card" data-testid="words-text">
          <span className="tiny muted">Blue: in time · orange: missing or off the beat</span>
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
            return <span key={m} aria-label={`Bar ${mnum(m)}: ${Math.round(v * 100)}%`} style={{ background: bg, height: 30, borderRadius: 3, color: bg === '#1D4F63' ? '#EEF0FF' : '#0B0D1A', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)' }}>{mnum(m)}</span>;
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
