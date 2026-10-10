// The Train tab, for now: what the app already has for the ear and the voice besides the pieces,
// in one place. Today's warm-up (the intonation lab, when it's on for this singer), checking a note
// (the tuner), the leap drill from your music and the Zwölfton row of the day (Expert mode). The
// courses of the UX review's C1 come later and replace this.
import React from 'react';
import { go, setDrillHome } from '../router';
import { useProfile, useStoreVersion } from '../hooks';
import { registerVirtual, useLibrary } from '../library';
import { cycleLeaps, leapPiece } from '../generated';
import { rowOfTheDay } from '../../game/twelvetone';
import { labInProgramme, loadLab, RUNGS } from '../../game/intonation';
import { IconChevron, IconEar, IconGauge, IconPlay } from '../icons';
import { YouButton } from '../components/YouSheet';
import { shortTitle } from '../today';
import { useStaff } from './Admin';
import { labEnabled } from './IntonationLab';

const sym = (p: number) => (p === 10 ? 't' : p === 11 ? 'e' : String(p));
/** "Dieu! qu'il la fait bon regarder, bar 12" → "Dieu!, bar 12": the bar number stays in view at 390 px. */
export function shortWhere(where: string): string {
  const m = /^(.*), (bar .+)$/.exec(where);
  return m ? `${shortTitle(m[1])}, ${m[2]}` : where;
}

export function Train() {
  useProfile();
  useStoreVersion();
  useLibrary();
  const staff = useStaff();
  const labOn = labEnabled(staff);
  const lab = loadLab();
  const step = (k: 'fifth' | 'third') => (lab[k].rung > RUNGS ? 'done ✓' : `step ${lab[k].rung} of ${RUNGS}`);
  const leaps = cycleLeaps();
  const row = rowOfTheDay(new Date());

  function playLeaps() {
    const p = leapPiece();
    if (!p) return;
    registerVirtual(p);
    setDrillHome('train'); // (leaving the drill comes back here)
    // (level 1 is the slow step: "Slow, with guide", as in Expert mode)
    go({ name: 'play', pieceId: p.id, partId: 'drill', sectionId: 'all', level: 1, mode: '2d', step: 'slow' });
  }

  return (
    <main className="screen wide train">
      <div className="row between tab-head">
        <h1 className="hero">Train</h1>
        <YouButton />
      </div>
      <span className="t16 muted" style={{ marginTop: -8 }}>Your ear and your voice, beside the pieces: a few minutes at a time.</span>

      <div className="lay train-cols">
        {labOn && (
          <section className="card" style={{ borderColor: 'var(--voice-deep)' }} data-testid="train-lab" aria-labelledby="train-lab-h">
            <div className="row between">
              <span className="eb">Today's warm-up</span>
              <span className="badge muted">{labInProgramme() ? 'In this cycle' : 'Preview · admins'}</span>
            </div>
            <h2 id="train-lab-h" className="h3">Intonation lab: the pure fifth and the pure third</h2>
            <span className="t14 muted">Listen, tune by hand, then sing it. One step a day is plenty.</span>
            <span className="t14 mono" style={{ color: 'var(--voice)' }}>Fifth: {step('fifth')} · Third: {step('third')}</span>
            <button className="btn primary block" data-testid="train-lab-go" onClick={() => go({ name: 'intonation' })}>
              <IconPlay size={18} /> Warm up
            </button>
          </section>
        )}

        <button className="card train-row" data-testid="train-tuner" onClick={() => go({ name: 'tuner' })}>
          <span className="you-ic" aria-hidden="true"><IconGauge /></span>
          <span className="grow col" style={{ gap: 2 }}>
            <strong className="t16">Check a note</strong>
            <span className="t14 muted">Sing or play a note: see which it is, and how far off.</span>
          </span>
          <IconChevron size={20} color="var(--muted)" />
        </button>

        <section className="card" data-testid="train-leaps" aria-labelledby="train-leaps-h">
          <span className="eb">Drill from your music</span>
          <h2 id="train-leaps-h" className="h3">Leaps</h2>
          {leaps.length ? (
            <>
              <span className="t14 muted">The {leaps.length} hardest intervals in your parts of this programme, one per bar.</span>
              <div className="col" style={{ gap: 2 }}>
                {leaps.slice(0, 3).map((l, i) => (
                  <span key={i} className="row t14" style={{ gap: 8 }}><span className="mono" style={{ width: 56, color: 'var(--voice)', flex: 'none' }}>{l.label}</span><span className="muted ellipsis">{shortWhere(l.where)}</span></span>
                ))}
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <button className={labOn ? 'btn small' : 'btn small primary'} data-testid="train-leaps-go" onClick={playLeaps}><IconPlay size={16} color="currentColor" /> Slow, with guide</button>
                <button className="btn small ghost" onClick={() => go({ name: 'expert' })}>More ways ›</button>
              </div>
            </>
          ) : (
            <span className="t14 muted">Put pieces into your programme (Pieces) to get a drill of their hardest leaps.</span>
          )}
        </section>

        <button className="card expert train-row" style={{ textAlign: 'left', color: 'inherit' }} data-testid="train-row" onClick={() => go({ name: 'expert' })}>
          <span className="grow col" style={{ gap: 8 }}>
            <span className="row between">
              <strong className="t16">Zwölfton of the day</strong>
              <span className="badge expert">Expert</span>
            </span>
            <span style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 3 }} aria-hidden="true">
              {row.map((pc, i) => (
                <span key={i} className="mono" style={{ height: 26, borderRadius: 6, background: '#262257', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#D4CCFF' }}>{sym(pc)}</span>
              ))}
            </span>
            <span className="t14" style={{ color: '#D4CCFF' }}>Atonal training: the same twelve-tone row for the whole choir today, with no key to lean on.</span>
          </span>
        </button>

        {!labOn && (
          <span className="t14 muted row" style={{ gap: 8 }}><IconEar size={18} /> The intonation lab (pure fifths and thirds) comes with your choir's programme.</span>
        )}
      </div>
    </main>
  );
}
