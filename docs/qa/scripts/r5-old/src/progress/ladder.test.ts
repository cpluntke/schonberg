import { describe, it, expect } from 'vitest';
import type { Section } from '../music/types';
import {
  LEVELS, LISTEN, levelSpec, strictnessFactor, effectiveTolerance, pieceReadiness, nextStep,
  sectionStatus, targetForDate,
} from './ladder';
import type { PieceProgress, SectionProgress } from './store';

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 4, 12).getTime();
const secs: Section[] = [0, 1, 2, 3].map((i) => ({
  id: `s${i}`, index: i, label: `Bars ${i * 4 + 1}–${i * 4 + 4}`, startMeasure: i * 4, endMeasure: i * 4 + 3, start: i * 8, end: i * 8 + 8,
}));
function prog(levels: number[], extra: Record<string, Partial<SectionProgress>> = {}): PieceProgress {
  const sections: Record<string, SectionProgress> = {};
  levels.forEach((l, i) => {
    sections[`s${i}`] = { level: l, best: {}, attempts: l ? 1 : 0, lastPracticed: NOW - DAY, lastPassed: l ? NOW - DAY : undefined, ...extra[`s${i}`] };
  });
  return { pieceId: 'p', partId: 'S', sections, totalAttempts: 0, bestScore: 0 };
}

describe('ladder', () => {
  it('matches the progression table', () => {
    expect(LEVELS.map((l) => [l.level, l.name, l.rate, l.guide, l.showNames, l.cue, l.tolerance, l.pass])).toEqual([
      [1, 'Note-learning', 0.7, true, true, 'note', 50, 0.75],
      [2, 'In time', 1.0, true, true, 'note', 35, 0.8],
      [3, 'Independent', 1.0, false, true, 'note', 30, 0.8],
      [4, 'Concert-ready', 1.0, false, false, 'chord', 25, 0.85],
    ]);
    expect(LISTEN.level).toBe(0);
    expect(levelSpec(3).name).toBe('Independent');
    expect(levelSpec(9).level).toBe(4);
  });
  it('strictness scales tolerance', () => {
    expect(strictnessFactor('forgiving')).toBe(1.3);
    expect(effectiveTolerance(1, 'forgiving')).toBe(65);
    expect(effectiveTolerance(2, 'standard')).toBe(35);
    expect(effectiveTolerance(4, 'strict')).toBe(20);
  });
  it('readiness', () => {
    expect(pieceReadiness(secs, undefined)).toEqual({ pct: 0, minLevel: 0, rehearsalReady: false, concertReady: false });
    const r = pieceReadiness(secs, prog([4, 3, 3, 2]));
    expect(r.pct).toBeCloseTo(12 / 16);
    expect(r.minLevel).toBe(2);
    expect(r.rehearsalReady).toBe(false);
    expect(pieceReadiness(secs, prog([3, 3, 4, 3])).rehearsalReady).toBe(true);
    expect(pieceReadiness(secs, prog([4, 4, 4, 4])).concertReady).toBe(true);
    expect(pieceReadiness([], undefined).pct).toBe(0);
  });
  it('nextStep: earliest lowest section, attempt current+1', () => {
    expect(nextStep(secs, undefined, NOW)).toMatchObject({ sectionId: 's0', level: 1 });
    expect(nextStep(secs, prog([2, 1, 3, 1]), NOW)).toMatchObject({ sectionId: 's1', level: 2 });
    expect(nextStep(secs, prog([4, 4, 4, 3]), NOW)).toMatchObject({ sectionId: 's3', level: 4 });
    expect(nextStep(secs, prog([4, 4, 4, 4]), NOW)).toBeNull();
  });
  it('nextStep: due review first, most overdue, at current level', () => {
    const p = prog([4, 1, 3, 4], {
      s0: { lastPassed: NOW - 9 * DAY }, s2: { lastPassed: NOW - 12 * DAY }, s3: { lastPassed: NOW - 2 * DAY },
    });
    const n = nextStep(secs, p, NOW)!;
    expect(n.sectionId).toBe('s2');
    expect(n.level).toBe(3);
    expect(n.reason).toMatch(/Review/);
    const done = prog([4, 4, 4, 4], { s1: { lastPassed: NOW - 8 * DAY } });
    expect(nextStep(secs, done, NOW)).toMatchObject({ sectionId: 's1', level: 4 });
  });
  it('sectionStatus', () => {
    expect(sectionStatus(undefined, NOW)).toBe('new');
    expect(sectionStatus({ level: 0, best: {}, attempts: 0 }, NOW)).toBe('new');
    expect(sectionStatus({ level: 0, best: {}, attempts: 2, lastPracticed: NOW }, NOW)).toBe('learning');
    expect(sectionStatus({ level: 2, best: {}, attempts: 2, lastPassed: NOW - 20 * DAY }, NOW)).toBe('learning');
    expect(sectionStatus({ level: 3, best: {}, attempts: 2, lastPassed: NOW - DAY }, NOW)).toBe('passed');
    expect(sectionStatus({ level: 3, best: {}, attempts: 2, lastPassed: NOW - 8 * DAY }, NOW)).toBe('due');
  });
  it('targetForDate', () => {
    const p = prog([3, 1, 2, 0]);
    expect(targetForDate(secs, p, { rehearsalDate: '2026-10-07' }, NOW)).toBe(
      'Rehearsal in 3 days: get 3 more sections to Independent (about 1 a day)');
    expect(targetForDate(secs, prog([3, 3, 3, 3]), { rehearsalDate: '2026-10-07', concertDate: '2026-10-05' }, NOW)).toBe(
      'Concert tomorrow: get 4 more sections to Concert-ready');
    expect(targetForDate(secs, p, { rehearsalDate: '2026-10-01' }, NOW)).toBeNull();
    expect(targetForDate(secs, p, {}, NOW)).toBeNull();
  });
});
