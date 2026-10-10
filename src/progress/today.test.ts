import { describe, it, expect, beforeEach } from 'vitest';
import type { Section } from '../music/types';
import type { AttemptLog, PieceProgress, SectionProgress } from './store';
import { _resetAllForTests } from './store';
import { nextStep, pieceReadiness } from './ladder';
import {
  addDays, bestWeek, buildPlan, countedDays, daysBetween, estimateMinutes, gettingBetter, mondayOf, movedOn, pace, planStatus,
  stepDone, stepsTo, weekDots, addDayNotes, notesBetween, noteReached, loadReached, saveRehearsal, confirmedRehearsals,
  stepsSungOn, loadRehearsals, loadToday,
  type PlanContext, type PlanPiece, type TodayStep,
} from './today';

const DAY = 86_400_000;
/** Saturday 10 Oct 2026, 9:38 (the mockups' day). */
const SAT = new Date(2026, 9, 10, 9, 38).getTime();
const TUE = new Date(2026, 9, 13, 17, 52).getTime();

function sections(n: number, sec = 12): Section[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, index: i, label: `Bars ${i * 8 + 1}–${i * 8 + 8}`, startMeasure: i * 8, endMeasure: i * 8 + 7, start: i * sec, end: (i + 1) * sec,
  }));
}

function piece(id: string, title: string, secs: Section[], levels: (Partial<SectionProgress> | number)[], o: { full?: PieceProgress['full']; focus?: boolean; last?: number; now?: number } = {}): PlanPiece {
  const now = o.now ?? SAT;
  const sp: Record<string, SectionProgress> = {};
  levels.forEach((l, i) => {
    const x = typeof l === 'number' ? { level: l } : l;
    sp[`s${i}`] = { level: 0, best: {}, attempts: 1, lastPracticed: now - DAY, ...(x.level ? { lastPassed: now - DAY } : {}), ...x };
  });
  const prog: PieceProgress = { pieceId: id, partId: 'A', sections: sp, totalAttempts: 1, bestScore: 0, ...(o.full ? { full: o.full } : {}) };
  return {
    pieceId: id, partId: 'A', title, short: title.split(' ')[0], sections: secs, prog,
    readiness: pieceReadiness(secs, prog), next: nextStep(secs, prog, now),
    focus: !!o.focus, lastPractised: o.last ?? now - DAY,
  };
}

const ctx = (o: Partial<PlanContext>): PlanContext => ({
  now: SAT, pieces: [], lab: null, rehearsal: { days: 3, weekday: 'Tuesday', time: '19:30' }, lastPracticeDay: '2026-10-08', shaky: [], ...o,
});

const entry = (o: Partial<AttemptLog>): AttemptLog => ({ at: SAT + 3600e3, pieceId: 'dieu', partId: 'A', sectionId: 's3', level: 1, step: 'slow', accuracy: 0.9, score: 900, passed: false, ...o });

// Clara's fortnight (FIXTURE.md): Abendlied rehearsal-ready; Dieu! 4 passages, 1–5 at Level 1, 6–13 and
// 14–21 Level 1 slow, 22–29 working on Level 1 slow; Schaffe in mir started.
const abendlied = () => piece('abend', 'Abendlied', sections(4), [3, 3, 3, 3], { full: { level: 3, best: {}, attempts: 3, lastPracticed: SAT - 2 * DAY, lastPassed: SAT - 2 * DAY }, focus: true, last: SAT - 2 * DAY });
const dieu = () => piece('dieu', "Dieu! qu'il la fait", sections(4, 14), [1, { level: 0, slow: 1 }, { level: 0, slow: 1 }, { level: 0, attempts: 3 }], { focus: true, last: SAT - DAY });
const schaffe = () => piece('schaffe', 'Schaffe in mir, Gott', sections(5), [{ level: 0, attempts: 1 }, { level: 0, attempts: 0, lastPracticed: undefined }], { last: SAT - 3 * DAY });

beforeEach(() => { localStorage.clear(); _resetAllForTests(); });

describe('dates', () => {
  it('days, Mondays, DST-safe day arithmetic', () => {
    expect(addDays('2026-10-10', 1)).toBe('2026-10-11');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26'); // (DST ends in Europe)
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-03', '2026-10-10')).toBe(7);
    expect(mondayOf('2026-10-10')).toBe('2026-10-05');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week before
  });
});

describe('minutes', () => {
  it('estimates from the passage at the step’s tempo × tries, whole minutes 1–6', () => {
    expect(estimateMinutes(12, 0.7, 3)).toBe(2); // 3 × (17 + 28) s
    expect(estimateMinutes(12, 0.7, 3, true)).toBe(3);
    expect(estimateMinutes(5, 1, 1)).toBe(1);
    expect(estimateMinutes(300, 1, 3)).toBe(6);
  });
});

describe('today’s plan: a normal Saturday', () => {
  it('3–4 steps, about 10–15 minutes, the warm-up first, rehearsal pieces next, never two steps on one passage', () => {
    const plan = buildPlan(ctx({ pieces: [abendlied(), dieu(), schaffe()], lab: { interval: 'third', rung: 3, done: false } }));
    expect(plan.mode).toBe('normal');
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    expect(plan.steps.length).toBeLessThanOrEqual(4);
    expect(plan.minutes).toBe(plan.steps.reduce((a, s) => a + s.minutes, 0));
    expect(plan.steps[0]).toMatchObject({ kind: 'lab', title: 'Warm-up · the pure third', minutes: 4, route: { name: 'intonation', interval: 'third', rung: 3 } });
    // Dieu! (rehearsal focus, not rehearsal-ready) before Schaffe (not in the focus)
    const firstPiece = plan.steps.find((s) => s.kind !== 'lab')!;
    expect(firstPiece.pieceId).toBe('dieu');
    expect(firstPiece.sectionId).toBe('s3'); // the last passage still on Level 1 slow (nextStep)
    expect(firstPiece.step).toBe('slow');
    expect(firstPiece.reason).toMatch(/^Level 1 · Notes · slow/);
    // Abendlied is rehearsal-ready and the rehearsal is in 3 days: sing it all once
    expect(plan.steps.some((s) => s.pieceId === 'abend' && s.kind === 'sing-it-all' && /Keeps it fresh for Tuesday/.test(s.reason))).toBe(true);
    const keys = plan.steps.map((s) => `${s.pieceId}|${s.sectionId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(plan.minutes).toBeGreaterThanOrEqual(6);
    expect(plan.minutes).toBeLessThanOrEqual(16);
  });

  it('without the lab there is no warm-up step; with no pieces the plan is empty', () => {
    const plan = buildPlan(ctx({ pieces: [dieu(), schaffe()] }));
    expect(plan.steps.some((s) => s.kind === 'lab')).toBe(false);
    expect(buildPlan(ctx({ pieces: [] })).steps).toEqual([]);
  });

  it('fixes after a full run and reviews come before progress on other pieces', () => {
    const fixPiece = piece('fixme', 'Fix me', sections(4), [2, 2, 1, 2], { full: { level: 1, best: {}, attempts: 1, toFix: { 2: ['s2'] }, toFixLocks: { 2: true } }, last: SAT - 5 * DAY });
    const plan = buildPlan(ctx({ pieces: [schaffe(), fixPiece], rehearsal: null }));
    expect(plan.steps[0]).toMatchObject({ kind: 'fix', pieceId: 'fixme', sectionId: 's2', level: 2, step: 'tempo' });
  });

  it('a stale passage at Level 3 is reviewed', () => {
    const old = piece('old', 'Old one', sections(2), [{ level: 3, lastPassed: SAT - 9 * DAY, lastPracticed: SAT - 9 * DAY }, { level: 3 }], { full: { level: 3, best: {}, attempts: 1, lastPassed: SAT - DAY, lastPracticed: SAT - DAY } });
    const plan = buildPlan(ctx({ pieces: [schaffe(), old], rehearsal: null }));
    expect(plan.steps[0]).toMatchObject({ kind: 'review', pieceId: 'old', sectionId: 's0', level: 3 });
    expect(plan.steps[0].reason).toMatch(/Not sung for 9 days/);
  });

  it('words first: Level 2 slow with the words in rhythm not passed is a words step', () => {
    const p = piece('w', 'Words', sections(1), [1]);
    p.words = () => false;
    p.next = nextStep(p.sections, p.prog, SAT, p.words);
    const plan = buildPlan(ctx({ pieces: [p], rehearsal: null }));
    expect(plan.steps[0]).toMatchObject({ kind: 'words', route: { name: 'play', words: true, level: 0 } });
  });
});

describe('rehearsal day and the day after', () => {
  it('rehearsal day: a 5-minute warm-up aimed at tonight’s focus', () => {
    const plan = buildPlan(ctx({ now: TUE, pieces: [abendlied(), dieu(), schaffe()], rehearsal: { days: 0, weekday: 'Tuesday', time: '19:30' }, lab: { interval: 'third', rung: 4, done: false } }));
    expect(plan.mode).toBe('rehearsal');
    expect(plan.minutes).toBeLessThanOrEqual(6);
    expect(plan.steps.map((s) => s.pieceId ?? 'lab')).toEqual(['abend', 'dieu', 'dieu', 'lab']);
    expect(plan.steps[0]).toMatchObject({ kind: 'sing-it-all', reason: 'Keeps it fresh for tonight' });
    expect(plan.steps[1].reason).toBe('Tonight’s focus');
    // a passage whose notes are known slowly: once, in tempo
    expect(plan.steps[2]).toMatchObject({ step: 'tempo', level: 1 });
    expect(plan.steps[2].title).toMatch(/once, in tempo$/);
    expect(plan.steps[3]).toMatchObject({ kind: 'lab', minutes: 1 });
  });

  it('the day after: what felt shaky comes first ("You said it felt shaky")', () => {
    const plan = buildPlan(ctx({ now: SAT, pieces: [abendlied(), dieu(), schaffe()], shaky: [{ pieceId: 'dieu', sectionId: 's2' }] }));
    expect(plan.steps[0]).toMatchObject({ pieceId: 'dieu', sectionId: 's2', why: 'shaky', reason: 'You said it felt shaky', step: 'tempo', level: 1 });
    expect(plan.steps.filter((s) => s.sectionId === 's2' && s.pieceId === 'dieu')).toHaveLength(1);
  });

  it('a shaky passage that has a level is sung in tempo at it', () => {
    const plan = buildPlan(ctx({ pieces: [abendlied()], shaky: [{ pieceId: 'abend', sectionId: 's1' }] }));
    expect(plan.steps[0]).toMatchObject({ pieceId: 'abend', sectionId: 's1', level: 3, step: 'tempo' });
  });
});

describe('welcome back', () => {
  it('after a week or more: about 5 minutes, one thing they know, one small next step', () => {
    const plan = buildPlan(ctx({ now: SAT + 12 * DAY, pieces: [abendlied(), dieu()], lastPracticeDay: '2026-10-10', rehearsal: { days: 5, weekday: 'Tuesday' } }));
    expect(plan.mode).toBe('welcome');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({ pieceId: 'abend', kind: 'sing-it-all', reason: 'A piece you know, to warm up' });
    expect(plan.steps[1]).toMatchObject({ pieceId: 'dieu', reason: 'One small new step' });
    expect(plan.minutes).toBeLessThanOrEqual(6);
  });
  it('six days is a normal day; never practised is not a welcome back', () => {
    expect(buildPlan(ctx({ now: SAT + 6 * DAY, pieces: [abendlied(), dieu()], lastPracticeDay: '2026-10-10' })).mode).toBe('normal');
    expect(buildPlan(ctx({ pieces: [dieu()], lastPracticeDay: null })).mode).toBe('normal');
  });
});

describe('ticking steps off', () => {
  const step = (o: Partial<TodayStep>): TodayStep => ({
    id: 'x', kind: 'passage', pieceId: 'dieu', partId: 'A', sectionId: 's3', level: 1, step: 'slow', minutes: 3, title: '', reason: '', why: 'progress',
    route: { name: 'play', pieceId: 'dieu', partId: 'A', sectionId: 's3', level: 1, step: 'slow', mode: '2d' }, ...o,
  });
  const t = (log: AttemptLog[]) => ({ log, day: '2026-10-10' });

  it('a counted pass today ticks the step; one in tempo ticks a slow step too', () => {
    expect(stepDone(step({}), t([]))).toBe(false);
    expect(stepDone(step({}), t([entry({ passed: true })]))).toBe(true);
    expect(stepDone(step({}), t([entry({ passed: true, step: 'tempo' })]))).toBe(true);
    // a slow pass does not tick an in-tempo step
    expect(stepDone(step({ step: 'tempo' }), t([entry({ passed: true, step: 'slow' })]))).toBe(false);
  });
  it('two runs of the step without a pass tick it (a struggling singer can finish the day)', () => {
    expect(stepDone(step({}), t([entry({})]))).toBe(false);
    expect(stepDone(step({}), t([entry({}), entry({ at: SAT + 4000e3 })]))).toBe(true);
    // listening, practice runs and other days don't count
    expect(stepDone(step({}), t([entry({ level: 0 }), entry({ sectionId: 'practice' }), entry({ at: SAT - DAY, passed: true })]))).toBe(false);
  });
  it('the whole piece: one run in tempo at the level or above', () => {
    const s = step({ kind: 'sing-it-all', sectionId: 'all', level: 3, step: 'tempo' });
    expect(stepDone(s, t([entry({ sectionId: 'all', level: 3, step: 'tempo' })]))).toBe(true);
    expect(stepDone(s, t([entry({ sectionId: 'all', level: 3, step: 'slow' })]))).toBe(false);
  });
  it('the lab: the rung passed, or a full go at it today', () => {
    const s = step({ kind: 'lab', lab: { interval: 'third', rung: 3 }, pieceId: undefined, sectionId: undefined });
    expect(stepDone(s, { log: [], day: '2026-10-10', labRung: { third: 3 } })).toBe(false);
    expect(stepDone(s, { log: [], day: '2026-10-10', labRung: { third: 4 } })).toBe(true);
    expect(stepDone(s, { log: [], day: '2026-10-10', labRung: { third: 3 }, lab: { day: '2026-10-10', rounds: { 'third:3': 4 } } })).toBe(true);
    expect(stepDone(s, { log: [], day: '2026-10-10', labRung: { third: 3 }, lab: { day: '2026-10-09', rounds: { 'third:3': 9 } } })).toBe(false);
  });
  it('words: practised today', () => {
    const s = step({ kind: 'words' });
    expect(stepDone(s, { log: [], day: '2026-10-10', wordsAt: () => SAT })).toBe(true);
    expect(stepDone(s, { log: [], day: '2026-10-10', wordsAt: () => SAT - DAY })).toBe(false);
  });
  it('planStatus: what is done, the next step, minutes left', () => {
    const plan = buildPlan(ctx({ pieces: [dieu(), schaffe()], rehearsal: null }));
    const first = plan.steps[0];
    const st = planStatus(plan, t([entry({ pieceId: first.pieceId!, sectionId: first.sectionId!, level: first.level, step: first.step, passed: true })]));
    expect(st.done[0]).toBe(true);
    expect(st.next).toBe(1);
    expect(st.minutesLeft).toBe(plan.minutes - first.minutes);
    expect(st.complete).toBe(false);
  });
});

describe('the frozen plan and tomorrow', () => {
  it('the same input plans the same day; progress made today changes tomorrow’s plan, not a stored one', () => {
    const c = ctx({ pieces: [dieu(), schaffe()], rehearsal: null });
    expect(buildPlan(c)).toEqual(buildPlan(c));
    // tomorrow, on today's progress: bars 22–29 passed slow today → in tempo next
    const after = piece('dieu', "Dieu! qu'il la fait", sections(4, 14), [1, { level: 0, slow: 1 }, { level: 0, slow: 1 }, { level: 0, slow: 1 }], { focus: true, now: SAT + DAY });
    const tomorrow = buildPlan(ctx({ now: SAT + DAY, pieces: [after, schaffe()], lastPracticeDay: '2026-10-10', rehearsal: { days: 2, weekday: 'Tuesday' } }));
    expect(tomorrow.day).toBe('2026-10-11');
    const d = tomorrow.steps.filter((s) => s.pieceId === 'dieu');
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]).toMatchObject({ level: 1, step: 'tempo' });
    expect(d.every((s) => s.sectionId !== 's0' || s.level === 2)).toBe(true);
  });
});

describe('the week', () => {
  it('days practised Mon–Sun plus confirmed rehearsals; ♪ on rehearsal days', () => {
    const practised = new Set(['2026-10-07', '2026-10-08', '2026-10-03']);
    const confirmed = new Set(['2026-10-06']);
    const w = weekDots('2026-10-10', practised, confirmed, (d) => new Date(`${d}T12:00`).getDay() === 2);
    expect(w.count).toBe(3);
    expect(w.dots.map((d) => d.name)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(w.dots[1]).toMatchObject({ rehearsal: 'confirmed', practised: false });
    expect(w.dots[5]).toMatchObject({ today: true, future: false });
    expect(w.dots[6].future).toBe(true);
    // rehearsal day itself: tonight
    const tue = weekDots('2026-10-13', practised, new Set(), (d) => new Date(`${d}T12:00`).getDay() === 2);
    expect(tue.dots[1].rehearsal).toBe('tonight');
    expect(tue.count).toBe(0);
  });
  it('a Saturday-to-Tuesday break loses nothing: the week counts days, not a streak', () => {
    const days = countedDays(['2026-10-03', '2026-10-06'], []);
    expect(weekDots('2026-10-06', days, new Set(), () => false).count).toBe(1);
  });
  it('the best week', () => {
    expect(bestWeek(new Set())).toBeNull();
    expect(bestWeek(new Set(['2026-09-21', '2026-09-22', '2026-09-23', '2026-10-06']))).toEqual({ days: 3, monday: '2026-09-21' });
  });
});

describe('pace', () => {
  it('on track, tight or behind from the steps left and the practice days left', () => {
    expect(pace(0, 3, 4)).toEqual({ kind: 'on-track' });
    expect(pace(6, 14, 4).kind).toBe('on-track'); // 8 days × 3
    expect(pace(30, 14, 4)).toMatchObject({ kind: 'tight', perDay: 4 }); // 30 / 24
    expect(pace(60, 14, 4)).toMatchObject({ kind: 'behind', perDay: 8 });
  });
  it('steps to a level: slow and in tempo per passage and level, plus a full run per level', () => {
    const s = sections(2);
    const prog = { pieceId: 'p', partId: 'A', sections: { s0: { level: 1, best: {}, attempts: 1 }, s1: { level: 0, slow: 1, best: {}, attempts: 1 } }, totalAttempts: 1, bestScore: 0 } as PieceProgress;
    // s0: L2 (2) + L3 (2); s1: L1 tempo (1) + L2 (2) + L3 (2); full runs 3
    expect(stepsTo(s, prog, 0, 3)).toBe(4 + 5 + 3);
    expect(stepsTo(s, prog, 3, 3)).toBe(0);
  });
});

describe('what moved, getting better', () => {
  it('steps passed for the first time today, per piece', () => {
    const log = [
      entry({ at: SAT - DAY, sectionId: 's1', passed: true }),
      entry({ sectionId: 's1', passed: true }), // passed before: not new
      entry({ sectionId: 's3', passed: true }),
      entry({ sectionId: 's2', level: 1, step: 'tempo', passed: true }),
      entry({ sectionId: 'drill', passed: true }),
    ];
    const m = movedOn(log, '2026-10-10');
    expect(m).toHaveLength(1);
    expect(m[0].steps).toEqual([{ level: 1, step: 'slow', sectionIds: ['s3'] }, { level: 1, step: 'tempo', sectionIds: ['s2'] }]);
  });
  it('first slow runs of new passages, earlier vs the last two weeks, only with enough data and a real gain', () => {
    const first = (i: number, at: number, accuracy: number, cents?: number) => entry({ sectionId: `s${i}`, pieceId: `p${i}`, at, accuracy, ...(cents != null ? { cents } : {}) });
    const early = [0, 1, 2, 3, 4].map((i) => first(i, SAT - 30 * DAY, 0.6, 26));
    const late = [5, 6, 7, 8, 9].map((i) => first(i, SAT - 2 * DAY, 0.8, 11));
    expect(gettingBetter([...early, ...late], SAT)).toMatchObject({ metric: 'cents', earlier: 26, now: 11 });
    expect(gettingBetter([...early.map((e) => ({ ...e, cents: undefined })), ...late], SAT)).toMatchObject({ metric: 'accuracy' });
    // at least 5 a side
    expect(gettingBetter([...early.slice(1), ...late], SAT)).toBeNull();
    expect(gettingBetter(late, SAT)).toBeNull();
    expect(gettingBetter([...late.map((e) => ({ ...e, at: SAT - 30 * DAY })), ...early.map((e) => ({ ...e, at: SAT - DAY }))], SAT)).toBeNull();
    // a gap of 8 cents or more (26 → 20 is noise)
    expect(gettingBetter([...early, ...late.map((e) => ({ ...e, cents: 20, accuracy: 0.62 }))], SAT)).toBeNull();
    // a passage whose earlier attempts fell out of the kept log doesn't count as new
    expect(gettingBetter([...early, ...late], SAT, (pieceId) => (pieceId === 'p5' ? 9 : 1))).toBeNull();
    expect(gettingBetter([...early, ...late], SAT, () => 1)).toMatchObject({ metric: 'cents' });
  });
});

describe('stored state', () => {
  it('notes per day, level reached dates, rehearsal confirmations', () => {
    addDayNotes(40, SAT);
    addDayNotes(10, SAT + 60e3);
    addDayNotes(5, SAT - DAY);
    expect(notesBetween('2026-10-10', '2026-10-11')).toBe(50);
    expect(notesBetween('2026-10-05', '2026-10-12')).toBe(55);
    noteReached('abend', 'A', 1, 3, SAT);
    noteReached('abend', 'A', 2, 3, SAT + DAY); // (already stamped: kept)
    expect(loadReached()['abend|A']).toEqual({ 2: SAT, 3: SAT });
    saveRehearsal('2026-10-06', { attended: true, answered: true });
    saveRehearsal('2026-09-29', { attended: false, answered: true });
    expect([...confirmedRehearsals()]).toEqual(['2026-10-06']);
  });
});

describe('fix round', () => {
  it('rehearsal day: a passage to fix appears once, at its fix level', () => {
    const p = piece('fx', 'Fix piece', sections(4), [2, 1, 2, 2], { full: { level: 1, best: {}, attempts: 1, toFix: { 2: ['s1'] }, toFixLocks: { 2: true } }, focus: true });
    const plan = buildPlan(ctx({ now: TUE, pieces: [p], rehearsal: { days: 0, weekday: 'Tuesday' } }));
    const ids = plan.steps.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = plan.steps.map((x) => x.sectionId);
    expect(new Set(keys).size).toBe(keys.length);
    expect(plan.steps.find((x) => x.sectionId === 's1')).toMatchObject({ level: 2, step: 'tempo' });
  });

  it('a lab tune-up (both ladders done, or rehearsal day) ticks only on rounds sung today', () => {
    const plan = buildPlan(ctx({ pieces: [dieu()], rehearsal: null, lab: { interval: 'third', rung: 5, done: true } }));
    const lab = plan.steps[0];
    expect(lab.lab).toMatchObject({ interval: 'third', rung: 5, tuneUp: true });
    expect(stepDone(lab, { log: [], day: '2026-10-10', labRung: { third: 6, fifth: 6 } })).toBe(false);
    expect(stepDone(lab, { log: [], day: '2026-10-10', labRung: { third: 6 }, lab: { day: '2026-10-10', rounds: { 'third:5': 4 } } })).toBe(true);
  });

  it('sing it all: two real goes where too much slipped tick it; stopped or slower runs don’t', () => {
    const s: TodayStep = {
      id: 'x', kind: 'sing-it-all', pieceId: 'dieu', partId: 'A', sectionId: 'all', level: 1, step: 'tempo', minutes: 3, title: '', reason: '', why: 'progress',
      route: { name: 'play', pieceId: 'dieu', partId: 'A', sectionId: 'all', level: 1, step: 'tempo', mode: '2d' },
    };
    const t = (log: AttemptLog[]) => ({ log, day: '2026-10-10' });
    const slipped = (at: number) => entry({ at, sectionId: 'practice', step: 'tempo', fullRun: true });
    expect(stepDone(s, t([slipped(SAT + 1e3)]))).toBe(false);
    expect(stepDone(s, t([slipped(SAT + 1e3), slipped(SAT + 2e3)]))).toBe(true);
    expect(stepDone(s, t([entry({ sectionId: 'practice', step: 'tempo' }), entry({ sectionId: 'practice', step: 'tempo', at: SAT + 5e3 })]))).toBe(false);
  });

  it('“sung through lately” uses the last counted full run', () => {
    const a = abendlied();
    a.lastFullRun = SAT - 3 * DAY;
    const plan = buildPlan(ctx({ pieces: [a, dieu()] }));
    expect(plan.steps.some((x) => x.pieceId === 'abend' && x.kind === 'sing-it-all')).toBe(true);
    a.lastFullRun = SAT - DAY;
    expect(buildPlan(ctx({ pieces: [a, dieu()] })).steps.some((x) => x.pieceId === 'abend' && x.kind === 'sing-it-all')).toBe(false);
  });

  it('what was sung before the day’s plan: one ticked step per passage', () => {
    const d = dieu();
    const log = [entry({ sectionId: 's3', passed: true, at: SAT - 3600e3 }), entry({ sectionId: 's1', step: 'tempo', at: SAT - 3000e3 }), entry({ sectionId: 'drill', passed: true })];
    const steps = stepsSungOn(log, '2026-10-10', [d]);
    expect(steps.map((x) => x.sectionId)).toEqual(['s3']); // (one try of s1 isn't done yet)
    expect(steps[0]).toMatchObject({ level: 1, step: 'slow' });
    expect(steps[0].reason).toMatch(/sung earlier today/);
  });

  it('welcome back uses the usual estimates', () => {
    const plan = buildPlan(ctx({ now: SAT + 12 * DAY, pieces: [abendlied(), dieu()], lastPracticeDay: '2026-10-10' }));
    const normal = buildPlan(ctx({ now: SAT + 12 * DAY, pieces: [abendlied(), dieu()], lastPracticeDay: '2026-10-21' }));
    const same = normal.steps.find((x) => x.id === plan.steps[1].id);
    if (same) expect(plan.steps[1].minutes).toBe(same.minutes);
    expect(plan.minutes).toBe(plan.steps.reduce((a, x) => a + x.minutes, 0));
  });

  it('stored rehearsal answers with a bad shaky list are cleaned', () => {
    localStorage.setItem('sh:rehearsals', JSON.stringify({ '2026-10-06': { attended: true, shaky: 'oops' }, '2026-10-13': { shaky: [{ pieceId: 'a', sectionId: 'b', label: 'A b' }, 5] } }));
    const all = loadRehearsals();
    expect(all['2026-10-06'].shaky).toEqual([]);
    expect(all['2026-10-13'].shaky).toEqual([{ pieceId: 'a', sectionId: 'b', label: 'A b' }]);
  });

  it('a stored plan with malformed steps is dropped', () => {
    localStorage.setItem('sh:today', JSON.stringify({ day: '2026-10-10', plan: { day: '2026-10-10', mode: 'normal', minutes: 3, steps: [{ id: 1 }] } }));
    expect(loadToday('2026-10-10')).toBeNull();
  });
});

describe('the course quick check and a redo in the plan', () => {
  it('the quick check: 1 minute, ticks once taken today', () => {
    const plan = buildPlan(ctx({ pieces: [dieu()], rehearsal: null, lab: { interval: 'fifth', rung: 4, done: true, check: true } }));
    const s = plan.steps[0];
    expect(s).toMatchObject({ kind: 'lab', minutes: 1, title: 'Quick check · the pure fifth', route: { name: 'intonation', interval: 'fifth', rung: 4, check: true } });
    expect(stepDone(s, { log: [], day: '2026-10-10', labRung: { fifth: 6 } })).toBe(false);
    expect(stepDone(s, { log: [], day: '2026-10-10', labRung: { fifth: 6 }, labChecked: { fifth: '2026-10-09' } })).toBe(false);
    expect(stepDone(s, { log: [], day: '2026-10-10', labRung: { fifth: 6 }, labChecked: { fifth: '2026-10-10' } })).toBe(true);
  });

  it('a redo of "Sing it by ear" after a slip: the step\'s minutes, ticks on rounds sung today', () => {
    const plan = buildPlan(ctx({ pieces: [dieu()], rehearsal: null, lab: { interval: 'fifth', rung: 4, done: true, redo: true } }));
    const s = plan.steps[0];
    expect(s).toMatchObject({ minutes: 5, reason: 'Sing it by ear, once more · it slipped a little', lab: { rung: 4, tuneUp: true } });
    expect(stepDone(s, { log: [], day: '2026-10-10', labRung: { fifth: 6 }, lab: { day: '2026-10-10', rounds: { 'fifth:4': 4 } } })).toBe(true);
  });
});
