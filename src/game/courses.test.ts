import { describe, it, expect, beforeEach } from 'vitest';
import {
  COURSES, COURSE_MINUTES, activeCourse, courseInToday, courseStatus, courseWarmUp, feelAdvice, feelWords, moreToPass, passRule, reviewState,
  stepStates, suggestedCourse,
} from './courses';
import { REVIEW_DAYS, logCheck, logRound, loadLab, roundsToPass, type LabProgress, type LabTrack } from './intonation';
import { _resetAllForTests } from '../progress/store';
import { labStep, stepDone } from '../progress/today';

const fresh = (): LabProgress => ({ fifth: { rung: 1, logs: {} }, third: { rung: 1, logs: {} } });
const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();
const SAT = '2026-10-10';

beforeEach(() => { localStorage.clear(); _resetAllForTests(); });

/** Pass rungs 1…n of an interval on the given days. */
function climb(p: LabProgress, iv: 'fifth' | 'third', days: string[]): LabProgress {
  days.forEach((d, i) => {
    const rung = i + 1;
    const n = rung === 1 ? 6 : 3;
    for (let k = 0; k < n; k++) p = logRound(p, iv, rung, 0, at(d)).p;
  });
  return p;
}

describe('courses: content', () => {
  it('two courses, 5 steps, about 25 minutes, the pass rule in words', () => {
    expect(COURSE_MINUTES).toBe(25);
    expect(COURSES.third.steps.map((s) => s.name)).toEqual(['Listen', 'Tune it by hand', 'Sing it, with the wobble', 'Sing it by ear', 'In the chord']);
    expect(COURSES.third.steps.map((s) => s.minutes)).toEqual([5, 5, 4, 5, 6]);
    expect(passRule(1)).toBe('To pass: 5 of your last 6 answers right');
    expect(passRule(3)).toBe('To pass: 3 of your last 4 holds close to the just pitch');
    expect(passRule(5)).toBe('To pass: 3 of your last 4 holds close to the just pitch, picture off');
    expect(COURSES.third.outcome).toBe('Make the chord ring.');
  });
});

describe('course state', () => {
  it('new, active once a round is sung, done after the last step', () => {
    let p = fresh();
    expect(courseStatus(p.third)).toBe('new');
    expect(activeCourse(p)).toBeNull();
    expect(suggestedCourse(p)).toBe('fifth');
    p = logRound(p, 'third', 1, 1, at('2026-10-07')).p;
    expect(courseStatus(p.third)).toBe('active');
    expect(activeCourse(p)).toBe('third');
    expect(suggestedCourse(p)).toBe('fifth');
    p = climb(p, 'fifth', ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(courseStatus(p.fifth)).toBe('done');
    expect(activeCourse(p)).toBe('third');
    expect(suggestedCourse(p)).toBeNull();
  });

  it('both started: the one practised last is active', () => {
    let p = fresh();
    p = logRound(p, 'fifth', 1, 0, at('2026-10-08')).p;
    p = logRound(p, 'third', 1, 0, at('2026-10-09')).p;
    expect(activeCourse(p)).toBe('third');
    p = logRound(p, 'fifth', 1, 0, at('2026-10-10')).p;
    expect(activeCourse(p)).toBe('fifth');
  });

  it('a passed rung stamps its day; one step a day: later steps on the following days', () => {
    let p = climb(fresh(), 'third', ['2026-10-07', '2026-10-08']);
    expect(p.third.passed).toEqual({ 1: '2026-10-07', 2: '2026-10-08' });
    const s = stepStates(p.third, SAT);
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'now', 'later', 'later']);
    expect(s.map((x) => x.day)).toEqual(['2026-10-07', '2026-10-08', SAT, '2026-10-11', '2026-10-12']);
    // A step passed today: the next one is for tomorrow (a suggestion, nothing is locked).
    p = climb(fresh(), 'third', ['2026-10-08', SAT]);
    expect(stepStates(p.third, SAT)[2]).toEqual({ rung: 3, state: 'now', day: '2026-10-11' });
  });

  it('labelled progress: how many more pure tries would pass', () => {
    expect(moreToPass(3, [3, 5, 15])).toBe('1 more to pass');
    expect(moreToPass(3, [])).toBe('3 more to pass');
    expect(moreToPass(3, [1, 2, 3])).toBe('Passed');
    expect(roundsToPass(3, [20, 20, 20, 20])).toBe(3);
    expect(roundsToPass(1, [0, 1, 0])).toBe(3);
  });
});

describe('the quick check a week later', () => {
  it('is booked when the course is done, due on its day, kept or slipped', () => {
    const p = climb(fresh(), 'fifth', ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(p.fifth.review).toEqual({ due: '2026-10-11' });
    expect(REVIEW_DAYS).toBe(7);
    expect(reviewState(p.fifth, SAT)).toBe('booked');
    expect(reviewState(p.fifth, '2026-10-11')).toBe('due');
    expect(reviewState(p.fifth, '2026-10-20')).toBe('due');
    const kept = logCheck(p, 'fifth', [3, 12, -4], at('2026-10-11'));
    expect(kept.kept).toBe(true);
    expect(reviewState(kept.p.fifth, '2026-10-12')).toBe('kept');
    expect(kept.p.fifth.redo).toBeUndefined();
  });

  it('a slip asks for "Sing it by ear" once more; passing it books a new check', () => {
    let p = climb(fresh(), 'fifth', ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    const r = logCheck(p, 'fifth', [3, 14, -20], at('2026-10-11'));
    expect(r.kept).toBe(false);
    p = r.p;
    expect(p.fifth.redo).toBe(4);
    expect(p.fifth.logs[4]).toEqual([]);
    expect(reviewState(p.fifth, '2026-10-12')).toBe('slipped');
    expect(p.fifth.rung).toBe(6);
    for (let k = 0; k < 3; k++) p = logRound(p, 'fifth', 4, 1, at('2026-10-12')).p;
    expect(p.fifth.redo).toBeUndefined();
    expect(p.fifth.review).toEqual({ due: '2026-10-19' });
    expect(p.fifth.rung).toBe(6);
  });
});

describe("Today's warm-up from the courses", () => {
  it("only when the choir recommends them or the singer started one (Today doesn't grow by itself)", () => {
    const p = fresh();
    expect(courseInToday(p, false)).toBe(false);
    expect(courseWarmUp(p, false, SAT)).toBeNull();
    expect(courseWarmUp(p, true, SAT)).toEqual({ interval: 'fifth', rung: 1, done: false });
    const started = logRound(p, 'third', 1, 0, at('2026-10-09')).p;
    expect(courseWarmUp(started, false, SAT)).toEqual({ interval: 'third', rung: 1, done: false });
    // One step a day: passed a step today, the next is tomorrow's.
    const passed = climb(fresh(), 'third', [SAT]);
    expect(courseWarmUp(passed, false, SAT)).toBeNull();
    expect(courseWarmUp(passed, false, '2026-10-11')).toEqual({ interval: 'third', rung: 2, done: false });
  });

  it('a due check first, then a redo, then the active course; a course finished on its own adds nothing', () => {
    let p = climb(fresh(), 'fifth', ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(courseWarmUp(p, false, SAT)).toBeNull();
    expect(courseWarmUp(p, true, SAT)).toEqual({ interval: 'third', rung: 1, done: false });
    expect(courseWarmUp(p, false, '2026-10-11')).toEqual({ interval: 'fifth', rung: 4, done: true, check: true });
    p = logRound(p, 'third', 1, 0, at('2026-10-09')).p;
    expect(courseWarmUp(p, false, '2026-10-11')).toMatchObject({ check: true });
    expect(courseWarmUp(p, false, SAT)).toEqual({ interval: 'third', rung: 1, done: false });
    p = logCheck(p, 'fifth', [20, 30, 1], at('2026-10-11')).p;
    expect(courseWarmUp(p, false, '2026-10-12')).toEqual({ interval: 'fifth', rung: 4, done: true, redo: true });
  });

  it('both done with the choir recommending: a short tune-up', () => {
    let p = climb(fresh(), 'fifth', ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
    p = climb(p, 'third', ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29']);
    p = logCheck(p, 'fifth', [0, 0, 0], at('2026-10-01')).p;
    p = logCheck(p, 'third', [0, 0, 0], at('2026-10-06')).p;
    expect(courseWarmUp(p, true, SAT)).toEqual({ interval: 'third', rung: 5, done: true });
    expect(courseWarmUp(p, false, SAT)).toBeNull();
  });
});

describe('feedback in words', () => {
  it('the pulse word first, then the direction on the pitch scale, cents in brackets', () => {
    expect(feelWords(6)).toBe('Almost still · a touch high (6 cents)');
    expect(feelWords(-30)).toBe('Fast buzz · a little low (30 cents)');
    expect(feelWords(14)).toBe('Pulsing · a touch high (14 cents)');
    expect(feelWords(1)).toBe('Still · on the just pitch');
    expect(feelAdvice(4)).toBeNull();
    expect(feelAdvice(12)).toBe('Slide a little lower and hold where it settles.');
    expect(feelAdvice(-40)).toBe('Start again a little higher, then slide slowly until it goes still.');
  });
});

describe('stored progress', () => {
  it('keeps pass days, the check and a redo through a reload; drops what is malformed', () => {
    const t: LabTrack = { rung: 6, logs: { 4: [] }, passed: { 5: '2026-10-04', 9: '2026-10-05' } as Record<number, string>, at: 5, review: { due: '2026-10-11', checked: '2026-10-11', kept: false }, redo: 4 };
    localStorage.setItem('sh:intonation', JSON.stringify({ fifth: t, third: { rung: 2, logs: {}, passed: { 1: 'yesterday' }, review: { due: 7 }, redo: 4 } }));
    const p = loadLab();
    expect(p.fifth).toEqual({ rung: 6, logs: { 4: [] }, passed: { 5: '2026-10-04' }, at: 5, review: { due: '2026-10-11', checked: '2026-10-11', kept: false }, redo: 4 });
    expect(p.third).toEqual({ rung: 2, logs: {} });
  });
});

describe('fix round: the check, the redo and Today', () => {
  it('a slipped check and a redo the same day: the check stays ticked, the redo ticks, neither is offered again', () => {
    let p = climb(fresh(), 'fifth', ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    const day = '2026-10-11';
    const checkStep = labStep(courseWarmUp(p, false, day)!);
    p = logCheck(p, 'fifth', [20, 30, 1], at(day, 9)).p;
    expect(p.fifth.lastCheck).toEqual({ day, kept: false });
    const redoStep = labStep(courseWarmUp(p, false, day)!);
    expect(redoStep.lab).toMatchObject({ rung: 4, redo: true });
    for (let k = 0; k < 3; k++) p = logRound(p, 'fifth', 4, 1, at(day, 10)).p;
    expect(p.fifth.redo).toBeUndefined();
    expect(p.fifth.review).toEqual({ due: '2026-10-18' });
    expect(p.fifth.redoneOn).toBe(day);
    const tick = { log: [], day, labRung: { fifth: 6 }, labChecked: { fifth: p.fifth.lastCheck?.day }, labRedone: { fifth: p.fifth.redoneOn } };
    expect(stepDone(checkStep, tick)).toBe(true);
    expect(stepDone(redoStep, tick)).toBe(true);
    expect(reviewState(p.fifth, day)).toBe('booked');
    expect(courseWarmUp(p, false, day)).toBeNull();
  });

  it('a course finished before the quick check existed gets one, a week from the first look; days must be real', () => {
    localStorage.setItem('sh:intonation', JSON.stringify({ fifth: { rung: 6, logs: {}, passed: { 2: '2026-99-99', 3: '2026-02-30', 4: '2026-10-03' } }, third: { rung: 1, logs: {} } }));
    const p = loadLab(at(SAT));
    expect(p.fifth.review).toEqual({ due: '2026-10-17' });
    expect(p.fifth.passed).toEqual({ 4: '2026-10-03' });
    expect(JSON.parse(localStorage.getItem('sh:intonation')!).fifth.review).toEqual({ due: '2026-10-17' });
    expect(loadLab(at('2026-10-12')).fifth.review).toEqual({ due: '2026-10-17' });
  });
});
