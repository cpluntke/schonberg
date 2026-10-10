// The leap drill's results (the UX review's C5): how many leaps landed against last time in one line,
// leap by leap, the hardest one, and a primary that acts on that diagnosis ("Practise bar 12 slowly").
import React, { useEffect } from 'react';
import type { LastResult } from '../play/lastResult';
import type { PieceInfo } from '../library';
import { getPiece } from '../library';
import { cycleLeaps, leapPiece, type Leap } from '../generated';
import { go, leaveTo, setDrillHome, practiceParent } from '../router';
import { registerVirtual } from '../library';
import { PracticeBar } from '../components/PracticeBar';
import { IconPlay, IconRestart } from '../icons';
import { intervalLongName } from '../../game/notation';
import { pitchPhrase } from '../../game/pitchwords';
import { addLeapRun, hardestLeap, lastLeapRun, leapOutcomes, loadLeapRuns, whenWord } from '../../progress/leaps';
import { dayOf, loadToday } from '../../progress/today';
import { finishToday, shortTitle } from '../today';

/** Each result is logged once (Results can be drawn again for the same run). */
const logged = new WeakSet<LastResult>();
/** When each result was logged (to find the run before it). */
const loggedAt = new WeakMap<LastResult, number>();

const leapWords = (semis: number) => `${semis > 0 ? 'up' : 'down'} a ${intervalLongName(semis).replace(/^perfect /, '')}`;

export function LeapResults({ lr, piece }: { lr: LastResult; piece: PieceInfo }) {
  const part = piece.score.parts[0];
  const total = Math.floor((part?.notes.length ?? 0) / 2);
  const out = leapOutcomes(lr.result.notes, total);
  const landed = out.filter((o) => o.landed).length;
  // (a run stopped early isn't kept; the drill is always "practice" for the levels, that's fine here)
  const counts = !/^stopped/.test(lr.notCounted ?? '');
  useEffect(() => {
    if (!counts || logged.has(lr)) return;
    logged.add(lr);
    const at = Date.now();
    loggedAt.set(lr, at);
    addLeapRun({ at, landed, total });
  }, [lr]); // eslint-disable-line react-hooks/exhaustive-deps
  // Last time: the run before this one (before it's logged: the latest).
  const mine = loggedAt.get(lr);
  const before = lastLeapRun(loadLeapRuns().filter((r) => r.at !== mine), mine);
  const leaps: Leap[] = cycleLeaps();
  const where = leaps.length === total ? leaps : null;
  const hard = hardestLeap(out);
  const hardLeap = hard && where ? where[hard.i] : null;
  const hardPiece = hardLeap ? getPiece(hardLeap.pieceId) : undefined;
  const bar = hardLeap && hardPiece ? hardPiece.score.measures[hardLeap.measure] : undefined;
  const semis = (i: number) => (part ? part.notes[2 * i + 1].midi - part.notes[2 * i].midi : 0);
  const up = practiceParent({ name: 'play', pieceId: piece.id, partId: lr.partId, sectionId: 'all', level: 1, mode: '2d' }) ?? { name: 'train' };
  const day = dayOf(new Date());
  const today = loadToday(day);
  const dayOpen = !!today && today.started && !today.finished;
  const better = before ? landed - before.landed : 0;

  const practiseBar = () => {
    if (!hardLeap || !bar) return;
    go({ name: 'play', pieceId: hardLeap.pieceId, partId: hardLeap.partId, sectionId: 'drill', level: 1, step: 'slow', mode: '2d', from: bar.start, to: bar.start + bar.dur }, true);
  };
  const again = () => {
    const p = leapPiece();
    if (!p) return;
    registerVirtual(p);
    setDrillHome('train');
    go({ name: 'play', pieceId: p.id, partId: 'drill', sectionId: 'all', level: lr.level || 1, mode: '2d', step: 'slow' }, true);
  };

  return (
    <main className="screen practice has-foot results" data-testid="leap-results">
      <PracticeBar up={up} heading title="Your tricky leaps" sub={`${total} leaps from your pieces`} />
      <section className={`card crs-leaps${landed === total || better > 0 ? ' good' : ''}`} role="status" data-testid="drill-verdict">
        <h2 className="crs-leaps-h">{landed} of {total} leaps landed{better > 0 ? '\u00a0↑' : ''}</h2>
        <span className="t16 muted" data-testid="leaps-last">
          {before ? `Last time (${whenWord(before.at)}) ${before.landed} of ${before.total}` : 'Your first go: next time you’ll see how it compares.'}
        </span>
        {!counts && <span className="t14 muted">This run was stopped early: it isn’t kept for next time.</span>}
      </section>
      <section className="col" style={{ gap: 8 }} aria-labelledby="leap-by-leap">
        <h2 id="leap-by-leap" className="h3">Leap by leap</h2>
        <ul className="crs-leapchips">
          {out.map((o) => (
            <li key={o.i} className={o.landed ? '' : 'miss'}>
              <strong className="t14">{leapWords(semis(o.i))}</strong>
              <span className={o.landed ? 'good-text' : 'crs-bad'}>{o.landed ? '✓' : '✗'}<span className="sr-only">{o.landed ? ' landed' : ' missed'}</span></span>
            </li>
          ))}
        </ul>
      </section>
      {hard && (
        <section className="card crs-hard" data-testid="leap-hardest">
          <span className="eb">Hardest today</span>
          <strong className="h3">{leapWords(semis(hard.i))}{hardLeap ? ` · ${shortTitle(getPiece(hardLeap.pieceId)?.title ?? '')} bar ${bar?.number ?? hardLeap.measure + 1}` : ''}</strong>
          <span className="t16">
            {hard.note === 'start'
              ? (hard.cents == null ? 'The note it leaps from wasn’t heard clearly.' : `The note it leaps from was ${pitchPhrase(hard.cents)}.`)
              : hard.cents == null ? 'The note it lands on wasn’t heard clearly.' : `The note it lands on was ${pitchPhrase(hard.cents)}.`} Hear it first, then sing it slowly with your part playing.
          </span>
        </section>
      )}
      <div className="results-foot" data-testid="results-foot">
        {hardLeap && bar ? (
          <button className="btn primary block" data-testid="leap-practise-bar" onClick={practiseBar}><IconPlay size={18} /> Practise bar {bar.number} slowly</button>
        ) : (
          <button className="btn primary block" data-testid={dayOpen ? 'finish-today' : 'leap-back'}
            onClick={() => { if (dayOpen) { finishToday(); leaveTo({ name: 'home' }); } else leaveTo(up); }}>{dayOpen ? 'Finish for today' : 'Back to Train'}</button>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn small" data-testid="again" onClick={again}><IconRestart size={16} /> Again</button>
          {(hardLeap && bar || dayOpen) && <button className="btn small" data-testid="to-piece" onClick={() => leaveTo(up)}>Back to Train</button>}
        </div>
        {dayOpen && hardLeap && bar && (
          <div className="foot-links"><button className="link" data-testid="finish-today" onClick={() => { finishToday(); leaveTo({ name: 'home' }); }}>Finish for today</button></div>
        )}
      </div>
    </main>
  );
}
