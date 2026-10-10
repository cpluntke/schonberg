// The daily loop (docs/TODAY.md): today's plan, ticking its steps off, the week goal, rehearsal days
// and what moved. Planning and ticking are pure functions of their inputs (tested in today.test.ts);
// the small stored state (today's frozen plan, rehearsal answers, notes per day) is at the end.
//
// A plan has 3–4 steps of about 10–15 minutes in all: a warm-up first (the intonation lab, only when
// it's on for this singer), then what matters most (passages a singer said felt shaky after rehearsal,
// rehearsal pieces not yet rehearsal-ready, passages to fix, reviews), then progress on the other
// pieces. Never two steps on the same passage. On a rehearsal day the plan is a 5-minute warm-up for
// tonight; after a break of a week or more, a 5-minute restart.

import type { Section } from '../music/types';
import { MAX_LEVEL, currentStep, fullRunDue, isDue, levelLabel, pendingFixes, stepFor, stepSpec, stepWord, type NextStep, type Readiness, type Step, type WordsDone } from './ladder';
import { logStep, readJSON, writeJSON, type AttemptLog, type PieceProgress } from './store';

// ---------------------------------------------------------------- dates

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
/** Local day key 'YYYY-MM-DD'. */
export const dayOf = (t: number | Date): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** Local midnight of a day key (or a time). */
export const startOfDay = (t: number | Date | string): number => {
  if (typeof t === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  }
  const d = new Date(t as number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
/** The day key `n` days after `day` (local; DST-safe). */
export const addDays = (day: string, n: number): string => {
  const t = startOfDay(day);
  const d = new Date(t);
  return dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12));
};
/** Whole days from `a` to `b` (day keys). */
export const daysBetween = (a: string, b: string): number => Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
/** Monday of the week `day` is in. */
export const mondayOf = (day: string): string => {
  const dow = new Date(startOfDay(day)).getDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
};

// ---------------------------------------------------------------- the plan

export type StepKind = 'passage' | 'sing-it-all' | 'fix' | 'review' | 'lab' | 'words';
export type LabInterval = 'fifth' | 'third';

/** Where a step starts (structurally a ui/router Route). */
export type PlanRoute =
  | { name: 'play'; pieceId: string; partId: string; sectionId: string; level: number; step?: Step; mode: '2d'; words?: boolean }
  | { name: 'intonation'; interval: LabInterval; rung: number };

export interface TodayStep {
  /** Stable key: the same work gives the same id (kind, piece, part, passage, level, step). */
  id: string;
  kind: StepKind;
  pieceId?: string;
  partId?: string;
  /** A passage id, or 'all' (the whole piece). */
  sectionId?: string;
  /** For a lab step: the rung (1–5). */
  level: number;
  step: Step;
  /** A lab step; `tuneUp`: a short go at a rung already passed (it ticks only on rounds sung today). */
  lab?: { interval: LabInterval; rung: number; tuneUp?: boolean };
  minutes: number;
  /** "Dieu! qu'il la fait · bars 22–29". */
  title: string;
  /** "Level 1 · Notes · slow · bar 25 has been flat lately". */
  reason: string;
  route: PlanRoute;
  /** Why it is in the plan (for ordering and the "You said it felt shaky" mark). */
  why: 'warm-up' | 'shaky' | 'focus' | 'fix' | 'review' | 'fresh' | 'progress' | 'known' | 'new';
}

export type PlanMode = 'normal' | 'rehearsal' | 'welcome';

export interface TodayPlan {
  day: string;
  mode: PlanMode;
  steps: TodayStep[];
  /** The exact sum of the steps' minutes. */
  minutes: number;
  /** Steps a rehearsal answer pushed out ("Moved to tomorrow: …"). */
  moved?: string[];
}

/** A programme piece as the planner sees it (built by ui/today.ts from the library and the store). */
export interface PlanPiece {
  pieceId: string;
  partId: string;
  title: string;
  /** "Dieu!", "Abendlied": for chips and short lines. */
  short: string;
  /** Singable passages, score order (Section.start/end are seconds at tempo 1). */
  sections: Section[];
  prog: PieceProgress | undefined;
  readiness: Readiness;
  /** ladder.nextStep at the plan's time. */
  next: NextStep | null;
  /** In the next rehearsal's focus. */
  focus: boolean;
  words?: WordsDone;
  /** "bar 25 has been flat lately" (path.troubleNote), or null. */
  trouble?: (sectionId: string) => string | null;
  /** Last attempt (ms), 0 = never. */
  lastPractised: number;
  /** The last run of the whole piece that counted (opened its level or not), ms; 0 = none known. */
  lastFullRun?: number;
}

export interface PlanContext {
  now: number;
  pieces: PlanPiece[];
  /** The intonation lab's next rung, or null when the lab isn't on for this singer. */
  lab: { interval: LabInterval; rung: number; done: boolean } | null;
  /** The next rehearsal (days from the plan's day: 0 = today), with its weekday name ("Tuesday"). */
  rehearsal: { days: number; weekday: string; time?: string } | null;
  /** The last day practised before the plan's day ('YYYY-MM-DD'), null = never. */
  lastPracticeDay: string | null;
  /** Passages the singer said felt shaky at the last rehearsal. */
  shaky: { pieceId: string; sectionId: string }[];
}

/** Days without practice after which Today becomes a short restart (no guilt, no streak lost). */
export const WELCOME_BACK_DAYS = 7;
/** A plan: at most this many steps, about this many minutes. */
export const MAX_STEPS = 4;
export const PLAN_MIN = 10;
export const PLAN_MAX = 15;
/** Minutes of each lab rung (Listen, Tune it by hand, Sing it with the wobble, Sing it blind, In the chord). */
export const LAB_MINUTES = [5, 5, 4, 5, 6];
const LAB_NAME: Record<LabInterval, string> = { fifth: 'the pure fifth', third: 'the pure third' };
const LAB_RUNG_NAMES = ['Listen', 'Tune it by hand', 'Sing it, with the wobble', 'Sing it blind', 'In the chord'];
const COUNT_IN_SEC = 8;
const RESULTS_SEC = 20;

/**
 * Minutes for a step: `tries` runs of `sec` seconds at `rate` (each with a count-in and a look at
 * Results), plus one listen when the passage is new; whole minutes, 1–6.
 */
export function estimateMinutes(sec: number, rate: number, tries: number, listen = false): number {
  const per = sec / Math.max(0.4, rate) + COUNT_IN_SEC + RESULTS_SEC;
  const total = tries * per + (listen ? sec + COUNT_IN_SEC : 0);
  return Math.max(1, Math.min(6, Math.round(total / 60)));
}

/** "bars 22–29" inside a title. */
const lower = (label: string): string => label.replace(/^(Bars?|Upbeat)\b/, (w) => w.toLowerCase());
const secOf = (p: PlanPiece, id: string): number => {
  if (id === 'all') return p.sections.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
  const s = p.sections.find((x) => x.id === id);
  return s ? Math.max(0, s.end - s.start) : 30;
};
const labelOf = (p: PlanPiece, id: string): string => p.sections.find((s) => s.id === id)?.label ?? id;
const levelOfSec = (p: PlanPiece, id: string): number => p.prog?.sections[id]?.level ?? 0;
const neverSung = (p: PlanPiece, id: string): boolean => {
  const sp = p.prog?.sections[id];
  return !sp || (!sp.attempts && sp.lastPracticed == null && (sp.level ?? 0) === 0);
};

interface Cand extends TodayStep { tier: number; rank: number; order: number }

function playStep(p: PlanPiece, o: {
  kind: StepKind; sectionId: string; level: number; step: Step; why: TodayStep['why']; reason: string; tries: number; title?: string; words?: boolean;
}): TodayStep {
  const level = Math.max(1, Math.min(MAX_LEVEL, o.level));
  const rate = stepSpec(level, o.step).rate;
  const listen = o.kind === 'passage' && level === 1 && o.step === 'slow' && neverSung(p, o.sectionId);
  const sec = secOf(p, o.sectionId);
  const minutes = o.words ? estimateMinutes(sec, 0.8, 2) : estimateMinutes(sec, rate, o.tries, listen);
  const name = p.title.length > 24 ? p.short : p.title;
  const title = o.title ?? (o.sectionId === 'all' ? `${name} · sing it all once` : `${name} · ${lower(labelOf(p, o.sectionId))}`);
  return {
    id: `${o.kind}:${p.pieceId}:${p.partId}:${o.sectionId}:${level}:${o.step}`,
    kind: o.kind, pieceId: p.pieceId, partId: p.partId, sectionId: o.sectionId, level, step: o.step, minutes, title, reason: o.reason, why: o.why,
    route: o.words
      ? { name: 'play', pieceId: p.pieceId, partId: p.partId, sectionId: o.sectionId, level: 0, mode: '2d', words: true }
      : { name: 'play', pieceId: p.pieceId, partId: p.partId, sectionId: o.sectionId, level, step: o.step, mode: '2d' },
  };
}

/** "Level 1 · Notes · slow". */
const stepText = (level: number, step: Step) => `${levelLabel(level)} · ${stepWord(step)}`;

/**
 * The work a piece offers, most useful first (the same order as ladder.nextStep): fixes after a full
 * run, the full run's weekly review, passage reviews, a full run to confirm a level, then each passage
 * at its current step (the lowest first, slow before in tempo).
 */
export function pieceCandidates(p: PlanPiece, now: number, rehearsalDays: number | null): TodayStep[] {
  const out: TodayStep[] = [];
  const { sections, prog } = p;
  if (!sections.length) return out;
  const multi = sections.length > 1;
  const P = p.readiness.pieceLevel;
  const trouble = (id: string) => p.trouble?.(id) ?? null;
  for (const f of pendingFixes(sections, prog)) {
    for (const id of f.sectionIds) {
      out.push(playStep(p, {
        kind: 'fix', sectionId: id, level: f.level, step: 'tempo', why: 'fix', tries: 2,
        reason: `Slipped in your full run · Level ${f.level} in tempo${f.level > P ? ` gets the piece to Level ${f.level}` : ''}`,
      }));
    }
  }
  if (multi && fullRunDue(sections, prog, now)) {
    const l = Math.max(1, Math.min(MAX_LEVEL, P));
    const last = prog?.full?.lastPassed ?? prog?.full?.lastPracticed ?? now;
    out.push(playStep(p, { kind: 'review', sectionId: 'all', level: l, step: 'tempo', why: 'review', tries: 1,
      reason: `Not sung through for ${Math.floor((now - last) / DAY_MS)} days · keep it at Level ${l}` }));
  }
  for (const s of sections) {
    const sp = prog?.sections[s.id];
    if (sp && isDue(sp, now)) {
      const l = Math.min(MAX_LEVEL, sp.level);
      const last = sp.lastPassed ?? sp.lastPracticed ?? now;
      out.push(playStep(p, { kind: 'review', sectionId: s.id, level: l, step: 'tempo', why: 'review', tries: 2,
        reason: `Not sung for ${Math.floor((now - last) / DAY_MS)} days · keep it at Level ${l}` }));
    }
  }
  if (p.next?.kind === 'full') {
    const n = p.next;
    out.push(playStep(p, { kind: 'sing-it-all', sectionId: 'all', level: n.level, step: 'tempo', why: 'progress', tries: 1,
      reason: n.level === 5 ? 'From memory, the whole piece' : `Level ${n.level} in every passage: make it the piece's level` }));
  }
  // Passages at their current step, the lowest first (and of those, slow before in tempo).
  const ranked = [...sections].sort((a, b) => a.index - b.index).map((s) => {
    const sp = prog?.sections[s.id];
    const l = sp?.level ?? 0;
    return { s, l, rank: 2 * l + (stepFor(sp, Math.min(MAX_LEVEL, l + 1)) === 'tempo' ? 1 : 0) };
  }).filter((x) => x.l < MAX_LEVEL).sort((a, b) => a.rank - b.rank || a.s.index - b.s.index);
  const lowest = ranked[0]?.rank;
  const atLowest = ranked.filter((x) => x.rank === lowest).length;
  for (const { s } of ranked) {
    const sp = prog?.sections[s.id];
    const { level, step } = currentStep(sp);
    const t = trouble(s.id);
    const last = multi && atLowest === 1 && ranked.length > 1 && ranked[0].s.id === s.id
      ? (step === 'slow' ? 'last passage to sing slow' : 'last passage at this step') : null;
    const fresh = neverSung(p, s.id) && level === 1 ? 'new: listen once, then sing on “doo”' : null;
    // (one thing worth knowing, not a list)
    const extra = t ?? last ?? fresh ?? '';
    if (level === 2 && step === 'slow' && p.words?.(s.id) === false) {
      out.push(playStep(p, { kind: 'words', sectionId: s.id, level, step, why: 'progress', tries: 2, words: true,
        title: `${p.title.length > 24 ? p.short : p.title} · ${lower(s.label)} · the words`, reason: 'Say the words in rhythm, before you sing them' }));
      continue;
    }
    out.push(playStep(p, { kind: 'passage', sectionId: s.id, level, step, why: 'progress', tries: 3,
      reason: `${stepText(level, step)}${extra ? ` · ${extra}` : ''}` }));
  }
  // What ladder.nextStep says comes first stays first.
  const n = p.next;
  if (n) {
    const i = out.findIndex((c) => c.sectionId === n.sectionId && c.level === n.level && (c.step === n.step || c.kind === 'words'));
    if (i > 0) out.unshift(...out.splice(i, 1));
  }
  void rehearsalDays;
  return out;
}

/** The lab's warm-up step (its next rung; once both ladders are done, a short tune-up in the chord). */
export function labStep(lab: NonNullable<PlanContext['lab']>, short = false): TodayStep {
  const rung = Math.max(1, Math.min(5, lab.rung));
  const minutes = short ? 1 : lab.done ? 2 : LAB_MINUTES[rung - 1];
  // (a rung already passed, or a short tune-up: it ticks on rounds sung today, never by itself)
  const tuneUp = short || lab.done || lab.rung > 5;
  return {
    id: `lab:${lab.interval}:${rung}${tuneUp ? ':tune' : ''}`, kind: 'lab', level: rung, step: 'tempo', minutes, why: 'warm-up',
    lab: { interval: lab.interval, rung, ...(tuneUp ? { tuneUp: true } : {}) },
    title: short ? (lab.interval === 'third' ? 'Pure-third tune-up' : 'Pure-fifth tune-up') : `Warm-up · ${LAB_NAME[lab.interval]}`,
    reason: short ? (lab.interval === 'third' ? 'So your third rings in the chord' : 'So your fifth rings in the chord')
      : lab.done ? `${LAB_RUNG_NAMES[rung - 1]} · keeps your ear ready` : `Step ${rung} of 5 · ${LAB_RUNG_NAMES[rung - 1]}`,
    route: { name: 'intonation', interval: lab.interval, rung },
  };
}

const passageKey = (s: TodayStep) => (s.kind === 'lab' ? s.id : `${s.pieceId}|${s.partId}|${s.sectionId}`);
const sum = (steps: TodayStep[]) => steps.reduce((a, s) => a + s.minutes, 0);

/** Pick steps in order: at most MAX_STEPS, about PLAN_MIN–PLAN_MAX minutes, one per passage. */
function pick(first: TodayStep[], cands: TodayStep[], max = MAX_STEPS, lo = PLAN_MIN, hi = PLAN_MAX): TodayStep[] {
  const steps = [...first];
  const used = new Set(steps.map(passageKey));
  for (const c of cands) {
    if (steps.length >= max) break;
    const total = sum(steps);
    if (steps.length >= 3 && total >= lo) break;
    if (used.has(passageKey(c))) continue;
    if (total + c.minutes > hi + 1 && steps.length >= 2) continue;
    steps.push(c);
    used.add(passageKey(c));
  }
  return steps;
}

/** Practised the piece recently (ms) — newest first gives continuity. */
const byRecent = (a: PlanPiece, b: PlanPiece) => b.lastPractised - a.lastPractised;

/**
 * Today's plan (or any day's: run it with tomorrow's `now` for the preview). Pure: everything it
 * needs is in `ctx`.
 */
export function buildPlan(ctx: PlanContext): TodayPlan {
  const day = dayOf(ctx.now);
  const gap = ctx.lastPracticeDay ? daysBetween(ctx.lastPracticeDay, day) : 0;
  if (ctx.rehearsal && ctx.rehearsal.days === 0) return rehearsalPlan(ctx, day);
  if (ctx.lastPracticeDay && gap >= WELCOME_BACK_DAYS) {
    const w = welcomePlan(ctx, day);
    if (w.steps.length) return w;
  }
  const steps = normalSteps(ctx);
  return { day, mode: 'normal', steps, minutes: sum(steps) };
}

function normalSteps(ctx: PlanContext): TodayStep[] {
  const pieces = [...ctx.pieces].sort(byRecent);
  const order = new Map(pieces.map((p, i) => [p.pieceId, i]));
  const soon = ctx.rehearsal != null && ctx.rehearsal.days >= 0 && ctx.rehearsal.days <= 3;
  const cands: Cand[] = [];
  // 1. What the singer said felt shaky at rehearsal.
  for (const sh of ctx.shaky) {
    const p = ctx.pieces.find((x) => x.pieceId === sh.pieceId);
    if (!p || !p.sections.some((s) => s.id === sh.sectionId)) continue;
    const sp = p.prog?.sections[sh.sectionId];
    const cur = (sp?.level ?? 0) >= MAX_LEVEL ? { level: MAX_LEVEL, step: 'tempo' as Step } : currentStep(sp);
    // (a passage sung at rehearsal: in tempo at the level it has, once the notes are known)
    const lv = (sp?.level ?? 0) >= 1 ? Math.min(MAX_LEVEL, sp!.level) : cur.level;
    const st: Step = (sp?.level ?? 0) >= 1 ? 'tempo' : cur.step;
    cands.push({ ...playStep(p, { kind: 'passage', sectionId: sh.sectionId, level: lv, step: st, why: 'shaky', tries: 3, reason: 'You said it felt shaky' }), tier: 1, rank: 0, order: order.get(p.pieceId) ?? 0 });
  }
  for (const p of pieces) {
    const list = pieceCandidates(p, ctx.now, ctx.rehearsal?.days ?? null);
    const focusOpen = p.focus && !p.readiness.rehearsalReady;
    const settled = p.readiness.concertReady;
    list.forEach((c, rank) => {
      const urgent = c.kind === 'fix' || c.kind === 'review';
      // (a rehearsal piece's first step leads; its other passages come after a ready one is sung through)
      const tier = urgent ? 2 : focusOpen ? (rank === 0 ? 2 : 3) : settled ? 5 : 4;
      const why = focusOpen && !urgent ? 'focus' : c.why;
      const reason = focusOpen && !urgent && ctx.rehearsal && ctx.rehearsal.days > 0 && rank === 0 && c.reason.split(' · ').length <= 3
        ? `${c.reason} · for ${ctx.rehearsal.days === 1 ? 'tomorrow' : ctx.rehearsal.weekday}` : c.reason;
      cands.push({ ...c, why, reason, tier, rank, order: order.get(p.pieceId) ?? 0 });
    });
    // A rehearsal piece that is ready: sing it all once before the rehearsal (unless sung through lately).
    if (p.focus && p.readiness.rehearsalReady && soon && p.sections.length > 1) {
      const lastFull = p.lastFullRun ?? 0;
      if (ctx.now - lastFull >= 2 * DAY_MS) {
        const l = Math.min(MAX_LEVEL, Math.max(3, p.readiness.pieceLevel));
        cands.push({
          ...playStep(p, { kind: 'sing-it-all', sectionId: 'all', level: l, step: 'tempo', why: 'fresh', tries: 1,
            reason: `Keeps it fresh for ${ctx.rehearsal!.days === 1 ? 'tomorrow' : ctx.rehearsal!.weekday}` }),
          tier: 3, rank: 0, order: order.get(p.pieceId) ?? 0,
        });
      }
    }
  }
  cands.sort((a, b) => a.tier - b.tier || a.rank - b.rank || a.order - b.order);
  const first = ctx.lab ? [labStep(ctx.lab)] : [];
  const steps = pick(first, cands.map(({ tier: _t, rank: _r, order: _o, ...c }) => c));
  // (no second step of the same piece's progress before every piece had one: the sort does that)
  return steps;
}

/** Rehearsal day: a 5-minute warm-up for tonight (the focus, once, in tempo). */
function rehearsalPlan(ctx: PlanContext, day: string): TodayPlan {
  const focus = ctx.pieces.filter((p) => p.focus);
  const pool = (focus.length ? focus : [...ctx.pieces].sort(byRecent)).slice(0, 3);
  const steps: TodayStep[] = [];
  for (const p of pool) {
    if (steps.length >= 3) break;
    if (p.readiness.rehearsalReady && p.sections.length > 1) {
      const l = Math.min(MAX_LEVEL, p.readiness.pieceLevel);
      const s = playStep(p, { kind: 'sing-it-all', sectionId: 'all', level: l, step: 'tempo', why: 'fresh', tries: 1, reason: 'Keeps it fresh for tonight' });
      steps.push({ ...s, minutes: Math.min(3, s.minutes) });
      continue;
    }
    // The passages being worked on (the lowest first): once each, in tempo when the notes are known;
    // a second one while the warm-up is still short.
    const seen = new Set<string>();
    const cands = pieceCandidates(p, ctx.now, 0).filter((x) => {
      if (!(x.kind === 'passage' || x.kind === 'fix' || x.kind === 'review') || x.sectionId === 'all' || seen.has(x.sectionId!)) return false;
      seen.add(x.sectionId!);
      return true;
    });
    let taken = 0;
    for (const c of cands) {
      if (taken >= 2 || steps.length >= 3 || (taken > 0 && sum(steps) >= 4)) break;
      const sp = p.prog?.sections[c.sectionId!];
      const fixing = c.kind === 'fix' || c.kind === 'review';
      const known = fixing || (sp?.level ?? 0) >= 1 || (sp?.slow ?? 0) >= 1;
      const lv = fixing ? c.level : (sp?.level ?? 0) >= 1 ? Math.min(MAX_LEVEL, sp!.level) : 1;
      taken++;
      steps.push(playStep(p, { kind: 'passage', sectionId: c.sectionId!, level: lv, step: known ? 'tempo' : 'slow', why: 'focus', tries: 1,
        title: `${p.short} · ${lower(labelOf(p, c.sectionId!))} once${known ? ', in tempo' : ''}`,
        reason: p.focus ? 'Tonight’s focus' : 'Keeps it in your ear for tonight' }));
    }
  }
  if (ctx.lab) steps.push(labStep(ctx.lab, true));
  // (about five minutes: trim the longest first)
  while (sum(steps) > 6 && steps.some((s) => s.minutes > 1)) {
    const big = steps.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    big.minutes -= 1;
  }
  return { day, mode: 'rehearsal', steps, minutes: sum(steps) };
}

/** After a break: one thing they know well, then one small next step (about 5 minutes). */
function welcomePlan(ctx: PlanContext, day: string): TodayPlan {
  const pieces = [...ctx.pieces].sort((a, b) => b.readiness.pieceLevel - a.readiness.pieceLevel || byRecent(a, b));
  const steps: TodayStep[] = [];
  const known = pieces.find((p) => p.readiness.pieceLevel >= 1 && p.sections.length > 1 && secOf(p, 'all') <= 150);
  if (known) {
    steps.push(playStep(known, { kind: 'sing-it-all', sectionId: 'all', level: Math.min(MAX_LEVEL, known.readiness.pieceLevel), step: 'tempo', why: 'known', tries: 1, reason: 'A piece you know, to warm up' }));
  } else {
    // The passage they know best, once, in tempo at its level.
    let best: { p: PlanPiece; id: string; l: number } | null = null;
    for (const p of pieces) for (const s of p.sections) {
      const l = levelOfSec(p, s.id);
      if (l >= 1 && (!best || l > best.l)) best = { p, id: s.id, l };
    }
    if (best) {
      steps.push(playStep(best.p, { kind: 'passage', sectionId: best.id, level: Math.min(MAX_LEVEL, best.l), step: 'tempo', why: 'known', tries: 1, reason: 'One you know, to warm up' }));
    }
  }
  const used = new Set(steps.map(passageKey));
  const pool = [...ctx.pieces].sort(byRecent).flatMap((p) => pieceCandidates(p, ctx.now, ctx.rehearsal?.days ?? null).slice(0, 2));
  const next = pool.find((c) => !used.has(passageKey(c)) && !(steps[0]?.pieceId === c.pieceId && steps[0]?.sectionId === 'all' && c.sectionId === 'all'));
  if (next) steps.push({ ...next, why: 'new', reason: 'One small new step' });
  return { day, mode: 'welcome', steps, minutes: sum(steps) };
}

// ---------------------------------------------------------------- ticking steps off

/**
 * Lab activity on a day (the lab keeps no dates; the session strip counts rounds while the lab is
 * open from today's plan): rounds per `${interval}:${rung}`.
 */
export interface LabDay { day: string; rounds: Record<string, number> }

export interface TickContext {
  log: AttemptLog[];
  /** The day ('YYYY-MM-DD'). */
  day: string;
  /** The lab's current rung per interval (a rung below it is passed). */
  labRung?: Partial<Record<LabInterval, number>>;
  lab?: LabDay | null;
  /** When the words of a passage were last practised (ms), 0 = never. */
  wordsAt?: (pieceId: string, partId: string, sectionId: string) => number;
}

/** Rounds of one lab rung that make a go at it (as many as the rung needs to pass). */
export const labRoundsFor = (rung: number) => (rung === 1 ? 6 : 4);
/** Runs of a step that tick it off without a pass (so a struggling singer can finish the day). */
export const TRIES_TO_TICK = 2;

/**
 * Is a step done on `day`? A counted pass of the step today (a pass in tempo at that level or above
 * also ticks a slow step), or TRIES_TO_TICK counted runs of exactly that step even without a pass.
 * The whole piece: one run in tempo at the level or above. Words: practised today. The lab: the rung
 * passed (the lab's rung moved past it), or a full go at it today (labRoundsFor rounds).
 * Listening, practice runs (slower, stopped: logged as 'practice') and loops don't count.
 */
export function stepDone(s: TodayStep, t: TickContext): boolean {
  if (s.kind === 'lab' && s.lab) {
    if (!s.lab.tuneUp && (t.labRung?.[s.lab.interval] ?? 0) > s.lab.rung) return true;
    const n = t.lab && t.lab.day === t.day ? t.lab.rounds[`${s.lab.interval}:${s.lab.rung}`] ?? 0 : 0;
    return n >= labRoundsFor(s.lab.rung);
  }
  if (!s.pieceId || !s.partId || !s.sectionId) return false;
  if (s.kind === 'words') {
    const at = t.wordsAt?.(s.pieceId, s.partId, s.sectionId) ?? 0;
    return at > 0 && dayOf(at) === t.day;
  }
  const from = startOfDay(t.day);
  const to = startOfDay(addDays(t.day, 1));
  const today = t.log.filter((e) => e.at >= from && e.at < to && e.pieceId === s.pieceId && e.partId === s.partId && e.level > 0);
  if (s.sectionId === 'all') {
    // A run that opened its level ('all'), or two real goes at the level (counted runs where too much
    // slipped or that came in late are logged as practice, marked fullRun).
    const full = today.filter((e) => logStep(e) === 'tempo' && (e.sectionId === 'all' || (e.sectionId === 'practice' && e.fullRun)));
    if (full.some((e) => e.sectionId === 'all' && e.level >= s.level)) return true;
    return full.filter((e) => e.level === s.level).length >= TRIES_TO_TICK;
  }
  const runs = today.filter((e) => e.sectionId === s.sectionId);
  const passed = runs.some((e) => e.passed && e.level >= s.level && (logStep(e) === 'tempo' || (s.step === 'slow' && logStep(e) === 'slow')));
  if (passed) return true;
  return runs.filter((e) => e.level === s.level && logStep(e) === s.step).length >= TRIES_TO_TICK;
}

/**
 * What was sung on `day` before its plan was made (the singer practised before opening Today): one
 * step per passage (or the whole piece), at the latest level and step sung, kept only when it counts
 * as done (stepDone). Shown ticked at the top of the day's plan, so the earlier work isn't lost.
 */
export function stepsSungOn(log: AttemptLog[], day: string, pieces: PlanPiece[]): TodayStep[] {
  const from = startOfDay(day), to = startOfDay(addDays(day, 1));
  const latest = new Map<string, AttemptLog>();
  for (const e of log) {
    if (e.at < from || e.at >= to || e.level < 1) continue;
    const sid = e.sectionId === 'practice' && e.fullRun ? 'all' : e.sectionId;
    if (sid !== 'all' && !REAL(sid)) continue;
    const k = `${e.pieceId}|${e.partId}|${sid}`;
    const cur = latest.get(k);
    if (!cur || e.at > cur.at) latest.set(k, { ...e, sectionId: sid });
  }
  const out: TodayStep[] = [];
  for (const e of [...latest.values()].sort((a, b) => a.at - b.at)) {
    const p = pieces.find((x) => x.pieceId === e.pieceId && x.partId === e.partId);
    if (!p || (e.sectionId !== 'all' && !p.sections.some((x) => x.id === e.sectionId))) continue;
    const st = playStep(p, {
      kind: e.sectionId === 'all' ? 'sing-it-all' : 'passage', sectionId: e.sectionId, level: e.level, step: logStep(e), why: 'progress', tries: e.sectionId === 'all' ? 1 : 3,
      reason: e.sectionId === 'all' ? 'Sung earlier today' : `${stepText(e.level, logStep(e))} · sung earlier today`,
    });
    if (stepDone(st, { log, day })) out.push(st);
  }
  return out.slice(0, MAX_STEPS);
}

export interface PlanStatus {
  done: boolean[];
  /** All steps done. */
  complete: boolean;
  /** Index of the first step not done (-1 when complete). */
  next: number;
  /** Minutes of the steps not done. */
  minutesLeft: number;
}

export function planStatus(plan: TodayPlan, t: TickContext): PlanStatus {
  const done = plan.steps.map((s) => stepDone(s, t));
  const next = done.indexOf(false);
  return {
    done, complete: plan.steps.length > 0 && next < 0, next,
    minutesLeft: plan.steps.reduce((a, s, i) => a + (done[i] ? 0 : s.minutes), 0),
  };
}

// ---------------------------------------------------------------- the week

export interface WeekDot {
  day: string;
  /** "Mon" … "Sun". */
  name: string;
  practised: boolean;
  /**
   * A rehearsal that day: 'confirmed' (the singer said they were there: it counts), 'tonight' (today),
   * 'planned' (later this week), 'unconfirmed' (past, not confirmed). Absent: no rehearsal.
   */
  rehearsal?: 'confirmed' | 'tonight' | 'planned' | 'unconfirmed';
  today: boolean;
  future: boolean;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A day counts for the week: practised, or a rehearsal the singer confirmed. */
export function countedDays(practised: Iterable<string>, confirmed: Iterable<string>): Set<string> {
  return new Set([...practised, ...confirmed]);
}

/**
 * The week (Mon–Sun) around `today`: its dots and how many days count. `rehearsalOn(day)` says whether
 * the programme has a rehearsal that day.
 */
export function weekDots(today: string, practised: Set<string>, confirmed: Set<string>, rehearsalOn: (day: string) => boolean, monday = mondayOf(today)): { dots: WeekDot[]; count: number } {
  const dots: WeekDot[] = [];
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const isToday = d === today;
    const future = d > today;
    const p = practised.has(d);
    const c = confirmed.has(d);
    const r = c ? 'confirmed' as const : rehearsalOn(d) ? (isToday ? 'tonight' as const : future ? 'planned' as const : 'unconfirmed' as const) : undefined;
    if (p || c) count++;
    dots.push({ day: d, name: DOW[i], practised: p, ...(r ? { rehearsal: r } : {}), today: isToday, future });
  }
  return { dots, count };
}

/** The best week so far (days counted, Mon–Sun) and its Monday; null when nothing counted yet. */
export function bestWeek(days: Set<string>): { days: number; monday: string } | null {
  const per = new Map<string, number>();
  for (const d of days) {
    const m = mondayOf(d);
    per.set(m, (per.get(m) ?? 0) + 1);
  }
  let best: { days: number; monday: string } | null = null;
  for (const [monday, n] of per) if (!best || n > best.days || (n === best.days && monday > best.monday)) best = { days: n, monday };
  return best;
}

/** Minutes practised between two days (from the attempt log; inclusive start, exclusive end). */
export function minutesBetween(log: AttemptLog[], fromDay: string, toDay: string): number {
  const a = startOfDay(fromDay), b = startOfDay(toDay);
  let sec = 0;
  for (const e of log) if (e.at >= a && e.at < b) sec += e.durationSec ?? 45;
  return Math.round(sec / 60);
}

// ---------------------------------------------------------------- pace

/** Steps (slow and in tempo, per passage and level) still to go before the piece reaches `target`, plus a full run per level. */
export function stepsTo(sections: Section[], prog: PieceProgress | undefined, pieceLevel: number, target: number): number {
  if (pieceLevel >= target || !sections.length) return 0;
  let n = 0;
  for (const s of sections) {
    const sp = prog?.sections[s.id];
    for (let l = (sp?.level ?? 0) + 1; l <= target; l++) n += (sp?.slow ?? 0) >= l ? 1 : 2;
  }
  return n + (sections.length > 1 ? target - pieceLevel : 0);
}

/** Steps a plan holds on a normal day (pieces only). */
export const STEPS_PER_DAY = 3;

export type Pace = { kind: 'on-track' } | { kind: 'tight' | 'behind'; perDay: number; need: number };

/**
 * On track for a date? `need` steps over the practice days left (the days until the date × the week
 * goal / 7), at STEPS_PER_DAY a day: on track up to that, tight up to 1.5×, behind beyond.
 */
export function pace(need: number, daysLeft: number, weekGoal: number): Pace {
  if (need <= 0) return { kind: 'on-track' };
  const days = Math.max(1, Math.floor((Math.max(0, daysLeft) * Math.max(1, Math.min(7, weekGoal))) / 7));
  const perDay = Math.ceil(need / days);
  const ratio = need / (days * STEPS_PER_DAY);
  if (ratio <= 1) return { kind: 'on-track' };
  return { kind: ratio <= 1.5 ? 'tight' : 'behind', perDay, need };
}

// ---------------------------------------------------------------- what moved, getting better

export interface Moved {
  pieceId: string;
  partId: string;
  /** Passages passed today at a step not passed before: level/step → passage ids. */
  steps: { level: number; step: Step; sectionIds: string[] }[];
  /** The whole piece reached a level today. */
  reached?: number;
}

const REAL = (id: string) => !['all', 'drill', 'entries', 'cold', 'practice'].includes(id);

/** Steps passed for the first time on `day` (from the attempt log), per piece. */
export function movedOn(log: AttemptLog[], day: string): Moved[] {
  const from = startOfDay(day), to = startOfDay(addDays(day, 1));
  const before = new Set<string>();
  const out = new Map<string, Moved>();
  for (const e of [...log].sort((a, b) => a.at - b.at)) {
    if (!e.passed || e.level < 1 || !REAL(e.sectionId)) continue;
    const st = logStep(e);
    const k = `${e.pieceId}|${e.partId}|${e.sectionId}`;
    const key = `${k}|${e.level}|${st}`;
    if (e.at < from) {
      before.add(key);
      if (st === 'tempo') for (let l = 1; l <= e.level; l++) { before.add(`${k}|${l}|tempo`); before.add(`${k}|${l}|slow`); }
      continue;
    }
    if (e.at >= to || before.has(key)) continue;
    before.add(key);
    const m = out.get(`${e.pieceId}|${e.partId}`) ?? { pieceId: e.pieceId, partId: e.partId, steps: [] };
    let g = m.steps.find((x) => x.level === e.level && x.step === st);
    if (!g) { g = { level: e.level, step: st, sectionIds: [] }; m.steps.push(g); }
    if (!g.sectionIds.includes(e.sectionId)) g.sectionIds.push(e.sectionId);
    out.set(`${e.pieceId}|${e.partId}`, m);
  }
  return [...out.values()];
}

/** Getting better needs this many new passages on each side, and a gap of this much. */
export const BETTER_MIN = 5;
export const BETTER_CENTS = 8;
export const BETTER_SHARE = 0.08;

export interface Better { metric: 'cents' | 'accuracy'; earlier: number; now: number; n: [number, number] }

/**
 * Getting better at learning new notes: the first slow run (Level 1 slow) of each new passage, in the
 * last 14 days vs before. Shown only with at least BETTER_MIN passages in each and a real gain (8 cents
 * closer, or 8 points more notes right): cents off (lower is better) when both have them, else the
 * share of notes right. With `attemptsOf` (the passage's counted attempts), a passage whose earlier
 * attempts fell out of the kept log is left out (its first run there isn't its first).
 */
export function gettingBetter(log: AttemptLog[], now: number, attemptsOf?: (pieceId: string, partId: string, sectionId: string) => number): Better | null {
  const first = new Map<string, AttemptLog>();
  for (const e of [...log].sort((a, b) => a.at - b.at)) {
    if (e.level !== 1 || logStep(e) !== 'slow' || !REAL(e.sectionId)) continue;
    const k = `${e.pieceId}|${e.partId}|${e.sectionId}`;
    if (!first.has(k)) first.set(k, e);
  }
  // (only passages whose first run is in the kept log: all their counted attempts are in it)
  if (attemptsOf) {
    const inLog = new Map<string, number>();
    for (const e of log) if (e.level > 0 && REAL(e.sectionId)) { const k = `${e.pieceId}|${e.partId}|${e.sectionId}`; inLog.set(k, (inLog.get(k) ?? 0) + 1); }
    for (const [k, e] of [...first]) if (attemptsOf(e.pieceId, e.partId, e.sectionId) > (inLog.get(k) ?? 0)) first.delete(k);
  }
  const cut = now - 14 * DAY_MS;
  const all = [...first.values()];
  const early = all.filter((e) => e.at < cut);
  const late = all.filter((e) => e.at >= cut);
  if (early.length < BETTER_MIN || late.length < BETTER_MIN) return null;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ec = early.filter((e) => typeof e.cents === 'number').map((e) => e.cents!);
  const lc = late.filter((e) => typeof e.cents === 'number').map((e) => e.cents!);
  if (ec.length >= BETTER_MIN && lc.length >= BETTER_MIN) {
    const a = avg(ec), b = avg(lc);
    return a - b >= BETTER_CENTS ? { metric: 'cents', earlier: Math.round(a), now: Math.round(b), n: [ec.length, lc.length] } : null;
  }
  const a = avg(early.map((e) => e.accuracy)), b = avg(late.map((e) => e.accuracy));
  return b - a >= BETTER_SHARE ? { metric: 'accuracy', earlier: a, now: b, n: [early.length, late.length] } : null;
}

// ---------------------------------------------------------------- stored state (this phone)

const TODAY = 'sh:today';
const REHEARSALS = 'sh:rehearsals';
const DAY_NOTES = 'sh:dayNotes';
const LAB_DAY = 'sh:labDay';
const REACHED = 'sh:reached';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface StoredToday {
  day: string;
  plan: TodayPlan;
  /** The singer started today's practice (or sang today): the plan stays as it is for the day. */
  started?: boolean;
  /** "Finish for today". */
  finished?: boolean;
  /** Today's session: on while the singer works through the plan from Home (the session strip). */
  session?: { current: string } | null;
}

const validStep = (x: unknown) => isObj(x) && typeof x.id === 'string' && typeof x.kind === 'string' && typeof x.title === 'string'
  && typeof x.reason === 'string' && typeof x.minutes === 'number' && Number.isFinite(x.minutes) && isObj(x.route) && typeof (x.route as { name?: unknown }).name === 'string';
const validToday = (v: unknown) => isObj(v) && typeof v.day === 'string' && isObj(v.plan) && Array.isArray((v.plan as { steps?: unknown }).steps)
  && ((v.plan as { steps: unknown[] }).steps).every(validStep) && typeof (v.plan as { mode?: unknown }).mode === 'string';
export function loadToday(day: string): StoredToday | null {
  const s = readJSON<StoredToday | null>(TODAY, null, validToday);
  return s && s.day === day ? s : null;
}
export function saveToday(s: StoredToday, notify = true): void { writeJSON(TODAY, s, notify); }
/** The stored plan whatever its day (a session left open from yesterday). */
export function loadAnyToday(): StoredToday | null {
  return readJSON<StoredToday | null>(TODAY, null, validToday);
}

/** Rehearsal answers, by the rehearsal's date. */
export interface RehearsalAnswer {
  /** "I was at rehearsal": the day counts for the week. */
  attended?: boolean;
  /** "What felt shaky?" */
  shaky?: { pieceId: string; sectionId: string; label: string }[];
  /** "All fine". */
  fine?: boolean;
  /** The singer answered (the card folds to one line). */
  answered?: boolean;
  /** The day of the answer: the shaky passages go into that day's plan. */
  on?: string;
}
export function loadRehearsals(): Record<string, RehearsalAnswer> {
  const all = readJSON<Record<string, RehearsalAnswer>>(REHEARSALS, {}, isObj);
  const out: Record<string, RehearsalAnswer> = {};
  for (const [k, v] of Object.entries(all)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !isObj(v)) continue;
    const a: RehearsalAnswer = { ...v };
    // (a bad list from an old version or a hand edit: dropped, the rest kept)
    if (a.shaky !== undefined) {
      a.shaky = Array.isArray(a.shaky) ? a.shaky.filter((x) => isObj(x) && typeof x.pieceId === 'string' && typeof x.sectionId === 'string' && typeof x.label === 'string') : [];
    }
    out[k] = a;
  }
  return out;
}
export function saveRehearsal(date: string, a: RehearsalAnswer): void {
  const all = loadRehearsals();
  all[date] = a;
  const keys = Object.keys(all).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete all[k];
  writeJSON(REHEARSALS, all);
}
/** Days of rehearsals the singer confirmed. */
export function confirmedRehearsals(): Set<string> {
  return new Set(Object.entries(loadRehearsals()).filter(([, a]) => a.attended).map(([d]) => d));
}

/** Notes sung right per day (points.addCyclePoints adds to it). */
export function loadDayNotes(): Record<string, number> {
  return readJSON<Record<string, number>>(DAY_NOTES, {}, isObj);
}
export function addDayNotes(n: number, now = Date.now()): void {
  if (!(n > 0)) return;
  const all = loadDayNotes();
  const d = dayOf(now);
  all[d] = (Number(all[d]) || 0) + Math.round(n);
  const keys = Object.keys(all).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete all[k];
  writeJSON(DAY_NOTES, all, false);
}
export function notesBetween(fromDay: string, toDay: string): number {
  let n = 0;
  for (const [d, v] of Object.entries(loadDayNotes())) if (d >= fromDay && d < toDay) n += Number(v) || 0;
  return n;
}

export function loadLabDay(): LabDay | null {
  return readJSON<LabDay | null>(LAB_DAY, null, (v) => isObj(v) && typeof v.day === 'string' && isObj(v.rounds));
}
export function addLabRounds(interval: LabInterval, rung: number, n: number, now = Date.now()): void {
  if (!(n > 0)) return;
  const d = dayOf(now);
  const cur = loadLabDay();
  const rounds = cur && cur.day === d ? { ...cur.rounds } : {};
  const k = `${interval}:${rung}`;
  rounds[k] = (rounds[k] ?? 0) + n;
  writeJSON(LAB_DAY, { day: d, rounds });
}

/** When each piece reached each level (ms), stamped when a run reaches it (Play). */
export function loadReached(): Record<string, Record<number, number>> {
  return readJSON<Record<string, Record<number, number>>>(REACHED, {}, isObj);
}
export function noteReached(pieceId: string, partId: string, before: number, after: number, now = Date.now()): void {
  if (!(after > before)) return;
  const all = loadReached();
  const k = `${pieceId}|${partId}`;
  const r = { ...(isObj(all[k]) ? all[k] : {}) };
  for (let l = Math.max(1, before + 1); l <= after; l++) if (r[l] == null) r[l] = now;
  all[k] = r;
  writeJSON(REACHED, all, false);
}
