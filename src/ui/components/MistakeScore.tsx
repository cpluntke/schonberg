// Results: "What to fix" as a few bars of your own staff with the wrong notes marked (see
// play/mistakeScore.ts), tap to zoom in, and a slow loop of those bars right there.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NoteResult } from '../../game/types';
import type { NotationMode } from '../../game/notation';
import type { Part } from '../../music/types';
import type { PieceInfo } from '../library';
import type { Route } from '../router';
import { stepSpec, type Step } from '../../progress/ladder';
import { toleranceWords } from '../../game/pitchwords';
import { keyAtTimeIn } from '../../music/keymarks';
import { nameKeysOf } from '../../progress/keymarks';
import { noteInWords } from '../play/noteName';
import { loadProfile } from '../../progress/store';
import { slowRate } from '../../progress/struggle';
import { barRangeLabel } from '../../music/sections';
import { measureSpan } from '../play/staff2d';
import { mistakeSpots, type Spot } from '../play/mistakeSpots';
import { drawMistakes, layoutMistakes, type MistakeMark, type MistakeOpts } from '../play/mistakeScore';
import { faultOf, noteFault, type FaultKind } from '../play/noteFault';
import { IconPlay } from '../icons';

const STAFF_BG = '#0F1226';
const CARD_PAD = 10;
/** Staff space of the snippets (px): as large as fits, never smaller (then they scroll sideways). */
const SP_MINI: [number, number] = [6.5, 8.5];
const SP_ZOOM = { min: 7, max: 26, start: 13 };

interface Props {
  piece: PieceInfo;
  part: Part;
  /** The notes that weren't right (ladder.wrongNotes). */
  notes: NoteResult[];
  /** Tolerance the run was scored with (cents). */
  tol: number;
  /** Level and step of the run: the practice runs are at it. */
  level: number;
  step?: Step;
  /** The run's span (score seconds): context bars stay inside it. */
  from: number;
  to: number;
  /** Start a run (Results' goPlay). */
  play: (r: Extract<Route, { name: 'play' }>) => void;
  /**
   * The worst spot first, as the verdict's mini score (the UX review's B5): its bar, the note in
   * words, the level's tolerance and a tip; the other spots follow as "Also to fix".
   */
  focus?: boolean;
  /** The bar (measure index) to focus on (Results loops it); default: the worst spot. */
  focusBar?: number;
  /** The passage step the run was (its loops lead back to it: Route.back). */
  back?: { sectionId: string; level: number; step: Step };
  /** Listen to bars m0..m1 (the focus card's "Hear it"). */
  hear?: (m0: number, m1: number) => void;
}

/** A short tip for the usual kind of fault. */
const TIPS: Record<FaultKind, string> = {
  flat: 'Aim it a little higher, as if you were already reaching for the next note.',
  sharp: 'Let it settle a little lower: relax rather than push it up.',
  missed: 'Breathe before it and come in with the beat.',
  octave: 'Sing it in the octave written: listen to the bar, then join in.',
  wrong: 'Listen to the bar, then sing it slowly: find the note from the one before it.',
  short: 'Hold it for its full length, right into the next note.',
  unsteady: 'Hold it steady: keep the breath flowing through the note.',
};

/** Bumped when web fonts finish loading (the lyrics' widths change: draw again). */
export function useFontsLoaded(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) return;
    let live = true;
    const bump = () => { if (live) setN((x) => x + 1); };
    fonts.ready?.then(bump, () => {});
    fonts.addEventListener?.('loadingdone', bump);
    return () => { live = false; fonts.removeEventListener?.('loadingdone', bump); };
  }, []);
  return n;
}

/** Inner width of an element (CSS px), kept up to date. */
export function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.floor(el.clientWidth));
    set();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', set);
      return () => window.removeEventListener('resize', set);
    }
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function SnippetCanvas({ piece, part, spot, marks, opts, fonts, label }: {
  piece: PieceInfo; part: Part; spot: Spot; marks: MistakeMark[]; opts: MistakeOpts; fonts: number; label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  /** Width last drawn (to keep the scroll position when the size changes). */
  const lastW = useRef(0);
  const spKey = Array.isArray(opts.sp) ? opts.sp.join('-') : String(opts.sp);
  useLayoutEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext('2d');
    if (!cv || !c || opts.fitWidth <= 0) return;
    const V = layoutMistakes(c, piece.score, part, spot.m0, spot.m1, marks, opts);
    // (a big zoomed canvas stays under ~16 M pixels: phones refuse larger ones)
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1, Math.sqrt(16e6 / Math.max(1, V.W * V.H))));
    cv.width = Math.round(V.W * dpr);
    cv.height = Math.round(V.H * dpr);
    cv.style.width = `${V.W}px`;
    cv.style.height = `${V.H}px`;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMistakes(c, V);
    // Wider than its box (it scrolls sideways): first show the marked notes; zoomed, keep the middle in view.
    const box = cv.parentElement;
    if (box && V.W > box.clientWidth + 1 && V.marks.length) {
      const cw = box.clientWidth;
      if (!lastW.current) {
        // As little as needed to bring every mark and its tag in (the first one wins when they don't fit).
        const left = Math.min(...V.marks.map((p) => Math.min(p.x - 2.5 * V.sp, p.tagX))) - 6;
        const right = Math.max(...V.marks.map((p) => Math.max(p.x1 + V.sp, p.tagX + p.tagW))) + 6;
        box.scrollLeft = Math.max(0, Math.min(right - cw, left));
      } else box.scrollLeft = Math.max(0, (box.scrollLeft + cw / 2) * (V.W / lastW.current) - cw / 2);
    }
    lastW.current = V.W;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece, part, spot, marks, spKey, opts.fitWidth, opts.notation, opts.names, fonts]);
  return <canvas ref={ref} role="img" aria-label={label} style={{ display: 'block' }} />;
}

/** 1-based position of note `i` within its bar. */
export function nth(part: Part, i: number): number {
  const m = part.notes[i].measure;
  let k = 1;
  for (let j = i - 1; j >= 0 && part.notes[j].measure === m; j--) k++;
  return k;
}

/** The wrong notes of a snippet in words, bar by bar ("Bar 4: note 2 (“la”) was clearly flat (62 cents)"). */
function Captions({ piece, part, spot, byIndex, tol }: { piece: PieceInfo; part: Part; spot: Spot; byIndex: Map<number, NoteResult>; tol: number }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      {spot.bars.map((m) => (
        <span key={m} className="small" data-testid="wrong-bar">
          <strong>{barRangeLabel(piece.score, m, m)}:</strong>{' '}
          {spot.notes.filter((i) => part.notes[i]?.measure === m).map((i, k) => {
            const ly = part.notes[i]?.lyric;
            return <span key={i}>{k ? '; ' : ''}note {nth(part, i)}{ly ? ` (“${ly}”)` : ''} was {noteFault(byIndex.get(i)!, tol)}</span>;
          })}
        </span>
      ))}
    </div>
  );
}

const IconZoom = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6" />
  </svg>
);

function Legend() {
  return (
    <div className="row wrap tiny muted" style={{ gap: '4px 12px' }} data-testid="mistake-legend">
      <span className="row" style={{ gap: 5 }}>
        <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
          <ellipse cx="9" cy="7" rx="7.5" ry="5.8" fill="none" stroke="#FF5D73" strokeWidth="1.5" />
          <ellipse cx="9" cy="7" rx="3.6" ry="2.6" fill="#FF5D73" transform="rotate(-20 9 7)" />
        </svg>
        the note to fix
      </span>
      <span className="row" style={{ gap: 5 }}>
        <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M2 7h14" stroke="#FFB08F" strokeWidth="3" strokeLinecap="round" /></svg>
        where you sang it
      </span>
      <span>↓ flat · ↑ sharp (100 cents = a semitone)</span>
    </div>
  );
}

export function MistakeScore({ piece, part, notes, tol, level, step: runStep, from, to, play, focus, focusBar, hear, back }: Props) {
  const score = piece.score;
  const fonts = useFontsLoaded();
  const lvl = Math.max(1, level);
  const step: Step = runStep ?? (lvl === 1 ? 'slow' : 'tempo');
  const spec = stepSpec(lvl, step);
  const notation = loadProfile().notation as NotationMode;
  // Note names as the run showed them (levels 1–3).
  const names = !!spec?.showNames;
  const { spots, hiddenBars, byIndex, marks } = useMemo(() => {
    const [lo, hi] = measureSpan(score, from, to);
    const wrong = notes.filter((n) => part.notes[n.index] != null).map((n) => ({ index: n.index, measure: part.notes[n.index].measure }));
    const r = mistakeSpots(wrong, { lo, hi });
    const byIndex = new Map(notes.map((n) => [n.index, n]));
    const marks = r.spots.map((s) => s.notes.map((i): MistakeMark => ({ index: i, fault: faultOf(byIndex.get(i)!, tol), targetOffset: byIndex.get(i)!.targetOffset ?? 0 })));
    return { ...r, byIndex, marks };
  }, [score, part, notes, tol, from, to]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef);
  const [centHelp, setCentHelp] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const pending = useRef<Extract<Route, { name: 'play' }> | null>(null);

  // Practice: the snippet's bars as a drill at the run's level, slowly by default.
  const levelRate = spec.rate;
  const slow = Math.min(slowRate(step), levelRate);
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const route = (s: Spot, rate: number): Extract<Route, { name: 'play' }> => {
    const ms = score.measures;
    const a = ms[s.m0];
    const b = ms[s.m1];
    return {
      name: 'play', pieceId: piece.id, partId: part.id, sectionId: 'drill', level: lvl, step, mode: '2d',
      from: a?.start ?? from, to: b ? b.start + b.dur : to,
      ...(rate < levelRate - 1e-6 ? { rate } : {}),
      ...(back ? { back } : {}),
    };
  };

  const closing = useRef(false);
  // The zoomed view is a history entry: "back" closes it.
  const zoomed = zoom != null ? spots[zoom] : undefined;
  const open = (k: number) => {
    closing.current = false;
    // (keeps the entry's own marks, e.g. what lies below Results, so a stray Forward stays harmless)
    try { history.pushState({ ...((history.state as object | null) ?? {}), mistakeZoom: true }, ''); } catch { /* ignore */ }
    setZoom(k);
  };
  const close = (then?: Extract<Route, { name: 'play' }>) => {
    // (once: a double tap or a held Escape must not step back past Results)
    if (closing.current) return;
    closing.current = true;
    let viaHistory = false;
    try { viaHistory = !!(history.state as { mistakeZoom?: boolean } | null)?.mistakeZoom; } catch { /* ignore */ }
    if (viaHistory) {
      pending.current = then ?? null;
      history.back();
    } else {
      setZoom(null);
      if (then) play(then);
    }
  };
  useEffect(() => {
    if (zoom == null) return;
    const onPop = () => {
      setZoom(null);
      const r = pending.current;
      pending.current = null;
      if (r) play(r);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [zoom, play]);

  if (!spots.length) return null;
  // (inside the card's padding and border)
  const miniOpts: MistakeOpts = { sp: SP_MINI, fitWidth: Math.max(0, width - 2 * CARD_PAD - 2), notation, names };
  const barsText = (s: Spot) => barRangeLabel(score, s.m0, s.m1, true);
  const practise = (s: Spot, where: 'card' | 'zoom') => (
    <div className="row wrap" style={{ gap: 6 }}>
      <button className="btn small voice grow" data-testid={`practise-slow${where === 'zoom' ? '-zoom' : ''}`}
        aria-label={`Practise ${barsText(s)} slowly, at ${pct(slow)} tempo`}
        onClick={() => (where === 'zoom' ? close(route(s, slow)) : play(route(s, slow)))}>
        <IconPlay size={14} color="currentColor" /> Practise slowly ({pct(slow)})
      </button>
      {slow < levelRate - 1e-6 && (
        <button className="btn small" style={{ flex: '1 1 auto' }} data-testid={`practise-full${where === 'zoom' ? '-zoom' : ''}`}
          aria-label={`Practise ${barsText(s)} at ${levelRate < 1 ? `the step's tempo (${pct(levelRate)})` : 'full tempo'}`}
          onClick={() => (where === 'zoom' ? close(route(s, levelRate)) : play(route(s, levelRate)))}>
          {levelRate < 1 ? `${pct(levelRate)} tempo` : 'Full tempo'}
        </button>
      )}
    </div>
  );

  // The worst spot (most wrong notes, then the biggest miss) first when focusing; the rest in score order.
  const worst = (k: number) => spots[k].notes.length * 1000 + Math.max(...spots[k].notes.map((i) => Math.min(999, Math.abs(byIndex.get(i)?.cents ?? 999))));
  const withBar = focusBar != null ? spots.findIndex((s) => s.bars.includes(focusBar)) : -1;
  const fk = !focus ? -1 : withBar >= 0 ? withBar : spots.map((_, k) => k).sort((a, b) => worst(b) - worst(a) || a - b)[0];
  const rest = spots.map((_, k) => k).filter((k) => k !== fk);
  const num = (m: number) => score.measures[m]?.number ?? String(m + 1);
  const sentence = (s: Spot) => {
    const shown = s.notes.slice(0, 2).map((i) => {
      const n = part.notes[i];
      const key = keyAtTimeIn(nameKeysOf(score), n.start);
      const name = noteInWords(n.midi, key, notation, n.spelling);
      const where = n.measure === 0 && num(0) === '0' ? 'the upbeat' : `bar ${num(n.measure)}`;
      return `${name.charAt(0).toUpperCase()}${name.slice(1)} in ${where} was ${noteFault(byIndex.get(i)!, tol)}.`;
    });
    const more = s.notes.length - shown.length;
    return `${shown.join(' ')}${more > 0 ? ` And ${more} more note${more > 1 ? 's' : ''} here.` : ''}`;
  };
  const spotCard = (k: number) => {
    const s = spots[k];
    const label = `${barRangeLabel(score, s.m0, s.m1)} of your part, ${s.notes.length === 1 ? 'the wrong note' : `${s.notes.length} wrong notes`} marked`;
    return (
      <div key={`${s.m0}-${s.m1}`} className="card" style={{ padding: CARD_PAD, gap: 8, minWidth: 0 }} data-testid="mistake-spot">
        <div className="row between" style={{ gap: 8 }}>
          <strong className="t14">{barRangeLabel(score, s.m0, s.m1)}</strong>
          <button className="btn ghost small" style={{ padding: '0 10px', gap: 6 }} onClick={() => open(k)}
            aria-label={`Zoom in on ${barsText(s)}`} data-testid="mistake-zoom-btn">
            <IconZoom /> Zoom
          </button>
        </div>
        <div style={{ overflowX: 'auto', overflowY: 'hidden', borderRadius: 10, background: STAFF_BG, cursor: 'zoom-in', maxWidth: '100%' }}
          onClick={() => open(k)} data-testid="mistake-snippet">
          <SnippetCanvas piece={piece} part={part} spot={s} marks={marks[k]} opts={miniOpts} fonts={fonts} label={label} />
        </div>
        <Captions piece={piece} part={part} spot={s} byIndex={byIndex} tol={tol} />
        {practise(s, 'card')}
      </div>
    );
  };
  const focusCard = (k: number) => {
    const s = spots[k];
    const first = byIndex.get(s.notes[0]);
    const kind = first ? faultOf(first, tol).kind : null;
    const title = barRangeLabel(score, s.bars[0], s.bars[s.bars.length - 1]);
    return (
      <div className="focus-bar" data-testid="mistake-spot">
        <div className="row between" style={{ padding: '2px 4px 0 6px', gap: 6 }}>
          <strong className="t16">{title}</strong>
          <div className="row" style={{ gap: 4 }}>
            {hear && <button className="btn ghost small" data-testid="hear-it" onClick={() => hear(s.bars[0], s.bars[s.bars.length - 1])}>♪ Hear it</button>}
            <button className="icon-btn" onClick={() => open(k)} aria-label={`Zoom in on ${barsText(s)}`} data-testid="mistake-zoom-btn"><IconZoom /></button>
          </div>
        </div>
        <div style={{ overflowX: 'auto', overflowY: 'hidden', borderRadius: 10, background: STAFF_BG, cursor: 'zoom-in', maxWidth: '100%' }}
          onClick={() => open(k)} data-testid="mistake-snippet">
          <SnippetCanvas piece={piece} part={part} spot={s} marks={marks[k]} opts={miniOpts} fonts={fonts}
            label={`${title} of your part, ${s.notes.length === 1 ? 'the note to fix' : `${s.notes.length} notes to fix`} marked`} />
        </div>
        <div className="fixline" data-testid="wrong-bar">
          <strong>{sentence(s)}</strong>
          <span className="t14 muted">
            At Level {lvl} a note may be up to {toleranceWords(tol)} off.{' '}
            <button className="link inline" aria-expanded={centHelp} data-testid="cent-help-btn" onClick={() => setCentHelp(!centHelp)}>What’s a cent?</button>
          </span>
        </div>
        {centHelp && (
          <p className="t14 cent-help" data-testid="cent-help">
            A cent is a hundredth of a semitone: 100 cents take you from C to C♯. Within about 10 cents a note sounds spot on;
            over 50 cents it is clearly flat or sharp, nearer the next note than its own.
          </p>
        )}
        {kind && <p className="t14 tip">{TIPS[kind]}</p>}
      </div>
    );
  };

  return (
    <div className="col" style={{ gap: 8 }} data-testid="wrong-notes">
      <div ref={wrapRef} className="col" style={{ gap: 10, width: '100%', minWidth: 0 }}>
        {fk >= 0 && focusCard(fk)}
        {rest.length > 0 && (
          <>
            <h2 style={{ fontSize: 16, marginTop: fk >= 0 ? 6 : 0 }}>{fk >= 0 ? 'Also to fix' : 'What to fix'}</h2>
            <Legend />
            {rest.map(spotCard)}
          </>
        )}
      </div>
      {hiddenBars.length > 0 && (
        <span className="tiny muted" data-testid="mistake-more">
          …and {hiddenBars.length} more bar{hiddenBars.length > 1 ? 's' : ''} with a wrong note: see “Bar by bar” below.
        </span>
      )}
      {zoomed && zoom != null && createPortal(
        <ZoomView title={barRangeLabel(score, zoomed.m0, zoomed.m1)} onClose={() => close()}
          canvas={(fitWidth, sp) => (
            <SnippetCanvas piece={piece} part={part} spot={zoomed} marks={marks[zoom]} fonts={fonts}
              opts={{ sp, fitWidth, notation, names }}
              label={`${barRangeLabel(score, zoomed.m0, zoomed.m1)} of your part, zoomed in, wrong notes marked`} />
          )}>
          <Legend />
          <Captions piece={piece} part={part} spot={zoomed} byIndex={byIndex} tol={tol} />
          {practise(zoomed, 'zoom')}
        </ZoomView>,
        document.body,
      )}
    </div>
  );
}

/** Full-screen view of one snippet, bigger: pinch, ctrl+wheel or −/+ to zoom; ✕, Escape or back closes it. */
function ZoomView({ title, onClose, canvas, children }: {
  title: string; onClose: () => void; canvas: (fitWidth: number, sp: number) => React.ReactNode; children: React.ReactNode;
}) {
  const [sp, setSp] = useState(() => (typeof window !== 'undefined' && window.innerWidth >= 700 ? 15 : SP_ZOOM.start));
  const spRef = useRef(sp);
  spRef.current = sp;
  const scrollRef = useRef<HTMLDivElement>(null);
  const width = useWidth(scrollRef);
  const closeRef = useRef<HTMLButtonElement>(null);
  const clamp = (v: number) => Math.max(SP_ZOOM.min, Math.min(SP_ZOOM.max, v));

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pinch (two pointers) and ctrl+wheel (a laptop's trackpad pinch) change the staff size.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d0: number; sp0: number } | null = null;
    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) pinch = { d0: Math.max(10, dist()), sp0: spRef.current };
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) {
        spRef.current = clamp(pinch.sp0 * (dist() / pinch.d0));
        setSp(spRef.current);
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      spRef.current = clamp(spRef.current * Math.exp(-e.deltaY / 200));
      setSp(spRef.current);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = (f: number) => setSp((v) => clamp(Math.round(v * f * 10) / 10));
  return (
    <div role="dialog" aria-modal="true" aria-label={`${title}, zoomed in`} data-testid="mistake-zoom"
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 12,
        padding: 'calc(10px + var(--safe-top)) 16px calc(16px + var(--safe-bottom))', overflowY: 'auto', overflowX: 'hidden',
      }}>
      <div className="row between" style={{ gap: 8 }}>
        <strong style={{ fontSize: 17 }}>{title}</strong>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn filled" aria-label="Smaller" onClick={() => step(1 / 1.25)} disabled={sp <= SP_ZOOM.min} style={{ fontSize: 22 }}>−</button>
          <button className="icon-btn filled" aria-label="Bigger" onClick={() => step(1.25)} disabled={sp >= SP_ZOOM.max} style={{ fontSize: 22 }}>+</button>
          <button ref={closeRef} className="icon-btn" aria-label="Close" onClick={onClose} data-testid="mistake-zoom-close" style={{ fontSize: 22 }}>✕</button>
        </div>
      </div>
      <div ref={scrollRef} style={{ overflow: 'auto', touchAction: 'pan-x pan-y', borderRadius: 12, background: STAFF_BG, flex: 'none', maxHeight: '62vh', width: '100%' }}>
        {width > 0 && canvas(width, sp)}
      </div>
      <span className="tiny muted">Pinch or use − / + to zoom; scroll sideways for the rest.</span>
      {children}
    </div>
  );
}
