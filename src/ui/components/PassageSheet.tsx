// A passage's levels (the UX review's B2): a bottom sheet over the piece, with the five levels, what
// each adds, where the passage stands in each level's two steps (slow, in tempo) and a start for
// each step; Listen; a slow loop of its trouble bar; and its current step as the one primary action.
import React, { useEffect, useMemo, useRef } from 'react';
import type { Part, Section } from '../../music/types';
import type { SectionProgress } from '../../progress/store';
import { attemptLog, logStep } from '../../progress/store';
import { LEVELS, OFF_BOOK_DAYS, currentStep, stepLabel, stepWord, type Step } from '../../progress/ladder';
import { meterNodes, passedStep } from '../path';
import { IconClose, IconCube, IconEar, IconPlay } from '../icons';

/** What each level adds (one new thing), in the sheet's words. */
export const LEVEL_ASKS: Record<number, string> = {
  1: 'On “doo”, your part playing, note names',
  2: 'With the words, your part still playing',
  3: 'Your part muted, the other voices play',
  4: 'No note names, starting chord only',
  5: 'From memory, on two different days',
};

/** Best accuracy of counted runs of a passage at one step (in tempo: stored; slow: from the log). */
export function bestAtStep(pieceId: string, partId: string, sectionId: string, sp: SectionProgress | undefined, level: number, step: Step): number | null {
  if (step === 'tempo') return sp?.best?.[level] ?? null;
  let best: number | null = null;
  for (const e of attemptLog()) {
    if (e.pieceId !== pieceId || e.partId !== partId || e.sectionId !== sectionId || e.level !== level || logStep(e) !== 'slow') continue;
    if (Number.isFinite(e.accuracy)) best = Math.max(best ?? 0, e.accuracy);
  }
  return best;
}

export interface SheetActions {
  /** Start a level's step of this passage (`mode` 3d: the arcade). */
  sing: (level: number, step: Step, mode?: '2d' | '3d') => void;
  /** Listen to the passage, then sing its current step. */
  listen: () => void;
  /** Say the words in rhythm (Level 2's optional first step). */
  words?: () => void;
  /** Loop the trouble bar slowly (50%), when there is one. */
  loop?: { label: string; go: () => void };
}

export function PassageSheet({ pieceId, partId, section, lyric, sp, onClose, actions }: {
  pieceId: string; partId: string; part: Part; section: Section; lyric: string; sp: SectionProgress | undefined;
  onClose: () => void; actions: SheetActions;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const raf = requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      // Keep keyboard focus inside the sheet.
      if (e.key === 'Tab' && sheetRef.current) {
        const f = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href]')];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lvl = sp?.level ?? 0;
  const cur = currentStep(sp);
  const done = lvl >= 5;
  const primary = done ? { level: 5, step: 'tempo' as Step } : cur;
  const pct = (x: number | null) => (x == null ? '' : `best ${Math.round(x * 100)}%`);
  // The best of the step you're on only (sung at that step: slow bests come from the log), once per sheet.
  const curBest = useMemo(() => (done ? null : bestAtStep(pieceId, partId, section.id, sp, cur.level, cur.step)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pieceId, partId, section.id, cur.level, cur.step, done]);

  return (
    <div className="psheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="passage-sheet-scrim">
      <div ref={sheetRef} className="psheet" role="dialog" aria-modal="true" aria-label={`${section.label}: levels`} data-testid="passage-sheet">
        <span className="grab" aria-hidden="true" />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow col" style={{ gap: 2 }}>
            <h2 style={{ fontSize: 20 }}>{section.label}</h2>
            {lyric && <span className="lyr">“{lyric}…”</span>}
          </div>
          <button ref={closeRef} className="icon-btn filled" aria-label="Close" onClick={onClose} data-testid="sheet-close"><IconClose /></button>
        </div>
        <span className="t14 muted">One new thing at a time: first slow, then in tempo. Passing in tempo also ticks slow.</span>
        <div className="col" style={{ gap: 0 }} role="list" aria-label="Levels">
          {LEVELS.map((L) => {
            const l = L.level;
            const isNow = !done && cur.level === l;
            const node = meterNodes({ level: lvl, slow: sp?.slow, now: isNow ? { level: l } : null })[l - 1];
            const stepBtn = (st: Step) => {
              const passed = passedStep(sp, l, st);
              const here = isNow && cur.step === st;
              const best = here ? curBest : null;
              const text = `${stepWord(st)}${passed ? ' ✓' : here ? ' · now' : ''}${here && best != null ? `, ${pct(best)}` : ''}`;
              return (
                <button key={st} className={`stepbtn${passed ? ' done' : here ? ' cur' : ''}`} data-testid={`sheet-${l}-${st}`}
                  aria-label={`${section.label}, ${stepLabel(l, st)}${passed ? ' (passed)' : here ? ' (you are here)' : ''}`}
                  onClick={() => actions.sing(l, st)}>
                  <IconPlay size={12} color="currentColor" /> {text}
                </button>
              );
            };
            return (
              <div key={l} className={`lv${isNow ? ' now' : ''}`} role="listitem">
                <span className="lvl" aria-hidden="true"><i className={['n', node.fill === 'empty' ? '' : node.fill, node.now ? 'now' : ''].filter(Boolean).join(' ')} /></span>
                <div className="grow col" style={{ gap: 2 }}>
                  <strong className="t16">Level {l} · {L.name}</strong>
                  <span className="t14 muted">{LEVEL_ASKS[l]}{l === 2 && lvl < 2 ? ' · the arcade (just for fun) opens here' : ''}</span>
                  {l === 5 && lvl === 4 && (sp?.offBookDays?.length ?? 0) > 0 && (
                    <span className="t14 muted">From memory: day {sp!.offBookDays!.length} of {OFF_BOOK_DAYS}</span>
                  )}
                  <div className="steps-row">{stepBtn('slow')}{stepBtn('tempo')}</div>
                  {l === 2 && (actions.words || lvl >= 2) && (
                    <div className="row wrap" style={{ gap: '0 16px' }}>
                      {actions.words && <button className="link start" data-testid="sheet-words" onClick={actions.words}>Optional first: say it in rhythm</button>}
                      {lvl >= 2 && (
                        <button className="link start" data-testid="sheet-arcade" aria-label={`Arcade mode for ${section.label}`}
                          onClick={() => actions.sing(Math.max(2, Math.min(4, lvl)), 'tempo', '3d')}><IconCube size={16} color="#B3A6FF" /> Arcade (just for fun)</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="sheet-foot">
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={actions.listen} data-testid="sheet-listen" aria-label={`Listen to ${section.label}`}><IconEar size={18} /> Listen</button>
          {actions.loop && <button className="btn" style={{ flex: '1.6 1 0' }} onClick={actions.loop.go} data-testid="sheet-loop">{actions.loop.label}</button>}
        </div>
        <button className="btn primary block" data-testid="sheet-primary" onClick={() => actions.sing(primary.level, primary.step)}>
          <IconPlay size={18} /> {done ? `Sing it again · ${stepLabel(5, 'tempo')}` : `Sing ${stepLabel(primary.level, primary.step)}`}
        </button>
        </div>
      </div>
    </div>
  );
}
