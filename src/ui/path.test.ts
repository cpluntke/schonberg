import { describe, expect, it } from 'vitest';
import type { Section } from '../music/types';
import type { PieceProgress, SectionProgress } from '../progress/store';
import { nextStep } from '../progress/ladder';
import {
  joinLabels, lowerLabel, meterNodes, milestoneCrossed, nextLabel, nextReason, nodeLabel, passageStatus, pathStatus, troubleNote, troubleWords,
} from './path';

const secs: Section[] = [[1, 5], [6, 13], [14, 21], [22, 29]].map(([a, b], i) => ({
  id: `s${i}`, index: i, label: `Bars ${a}–${b}`, startMeasure: a - 1, endMeasure: b - 1, start: i * 8, end: i * 8 + 8,
}));
const sp = (o: Partial<SectionProgress>): SectionProgress => ({ level: 0, best: {}, attempts: 1, lastPracticed: 1, ...o });
const prog = (s: Record<string, Partial<SectionProgress>>, full?: PieceProgress['full']): PieceProgress => ({
  pieceId: 'p', partId: 'A', totalAttempts: 1, bestScore: 0,
  sections: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, sp(v)])), ...(full ? { full } : {}),
});
const label = (id: string) => secs.find((s) => s.id === id)!.label;

describe('LevelMeter nodes', () => {
  it('full = in tempo, half = slow, the ring on the step you are on', () => {
    const n = meterNodes({ level: 1, slow: 2, now: { level: 2 } });
    expect(n.map((x) => x.fill)).toEqual(['full', 'half', 'empty', 'empty', 'empty']);
    expect(n.map((x) => x.now)).toEqual([false, true, false, false, false]);
    expect(n.map((x) => x.name)).toEqual(['Notes', 'Words', 'Alone', 'Concert', 'By heart']);
    expect(nodeLabel(meterNodes({ level: 0, slow: 1, now: { level: 1 } })[0])).toBe('Level 1 Notes: slow passed; you are here');
    expect(nodeLabel(n[0])).toBe('Level 1 Notes: reached');
    expect(nodeLabel(meterNodes({ level: 3, goals: { 4: '12 Dec' } })[3])).toBe('Level 4 Concert: not yet; goal 12 Dec');
  });
});

describe('passage status in the fixture wording', () => {
  it('reached, slow ✓, working on, never Level 0', () => {
    expect(passageStatus(sp({ level: 1 }))).toEqual({ text: 'Level 1 reached ✓', done: true });
    expect(passageStatus(sp({ level: 0, slow: 1 }))).toEqual({ text: 'Level 1 · slow ✓', done: true });
    expect(passageStatus(sp({ level: 1, slow: 2 }))).toEqual({ text: 'Level 2 · slow ✓', done: true });
    expect(passageStatus(sp({ level: 0 }))).toEqual({ text: 'Working on Level 1 · slow', done: false });
    expect(passageStatus(undefined)).toEqual({ text: 'Not started', done: false });
    expect(passageStatus(sp({ level: 2, slow: 2 })).text).toBe('Level 2 reached ✓');
  });
});

describe('the piece path', () => {
  it('mid Level 1: slow, 3 of 4 passages', () => {
    const p = prog({ s0: { level: 1 }, s1: { slow: 1 }, s2: { slow: 1 }, s3: {} });
    const st = pathStatus(secs, p);
    expect(st.working).toEqual({ level: 1, step: 'slow' });
    expect(st.here).toBe('Level 1 · slow, 3 of 4 passages');
    expect(st.done).toEqual(['s0', 's1', 's2']);
    expect(st.todo).toEqual(['s3']);
    expect(st.half).toBe(false);
  });
  it('every passage slow: the node is half, the step in tempo', () => {
    const st = pathStatus(secs, prog({ s0: { level: 1 }, s1: { slow: 1 }, s2: { slow: 1 }, s3: { slow: 1 } }));
    expect(st.half).toBe(true);
    expect(st.working).toEqual({ level: 1, step: 'tempo' });
    expect(st.here).toBe('Level 1 · in tempo, 1 of 4 passages');
  });
  it('a fresh piece, every passage in tempo, a fix list, memorised', () => {
    expect(pathStatus(secs, undefined).here).toBe('Level 1 · slow, no passages yet');
    expect(pathStatus(secs, prog({ s0: { level: 1 }, s1: { level: 1 }, s2: { level: 2 }, s3: { level: 1 } })).here)
      .toBe('Level 1 in every passage · confirm it with a run of the whole piece');
    // Every passage above the piece level: that level is the one to confirm (as nextStep says).
    const above = pathStatus(secs, prog({ s0: { level: 3 }, s1: { level: 3 }, s2: { level: 4 }, s3: { level: 3 } }));
    expect(above.working).toEqual({ level: 3, step: 'tempo' });
    expect(above.here).toBe('Level 3 in every passage · confirm it with a run of the whole piece');
    expect(above.filled).toBe(2);
    const fix = pathStatus(secs, prog({ s0: { level: 1 } }, { level: 1, best: {}, attempts: 1, toFix: { 2: ['s2'] }, toFixLocks: { 2: true } }));
    expect(fix.working).toEqual({ level: 2, step: 'tempo' });
    expect(fix.here).toBe('Level 2 · in tempo, one passage to fix');
    expect(fix.fixes).toEqual(['s2']);
    expect(fix.filled).toBe(1);
    // By heart, day 1 of 2: only the day-2 message.
    const NOW = new Date(2026, 9, 10, 12).getTime();
    const day1 = pathStatus(secs, prog({ s0: { level: 4, slow: 5 } }, { level: 4, best: {}, attempts: 2, offBookDays: ['2026-10-10'] }), NOW);
    expect(day1.here).toBe('From memory: day 1 of 2 · sing it all from memory again on another day');
    expect(day1.waitDay).toBe(true);
    expect(pathStatus(secs, prog({}, { level: 4, best: {}, attempts: 2, offBookDays: ['2026-10-08'] }), NOW).here)
      .toBe('From memory: day 1 of 2 · sing it all from memory again today');
    const mem = pathStatus(secs, prog({}, { level: 5, best: {}, attempts: 2 }));
    expect(mem.working).toBeNull();
    expect(mem.here).toBe('Level 5 · By heart reached ✓');
  });
});

describe('labels and reasons', () => {
  it('joins bar labels and lowers them in a sentence', () => {
    expect(joinLabels(['Bars 1–5', 'Bars 6–13', 'Bars 14–21'])).toBe('Bars 1–5 · 6–13 · 14–21');
    expect(joinLabels(['Upbeat–bar 4', 'Bars 5–8'])).toBe('Upbeat–bar 4 · Bars 5–8');
    expect(lowerLabel('Bars 9–12')).toBe('bars 9–12');
  });
  it('the primary button from nextStep, its reason without repeating it', () => {
    const p = prog({ s0: { level: 1 }, s1: { slow: 1 }, s2: { slow: 1 }, s3: {} });
    const n = nextStep(secs, p)!;
    expect(nextLabel(n, label)).toBe('Bars 22–29 · Level 1 · Notes · slow');
    expect(nextReason(n, label)).toBe('Last passage to sing slow.');
    expect(nextLabel({ sectionId: 'all', level: 2, step: 'tempo', kind: 'full', reason: '' }, label)).toBe('Sing it all · Level 2 · Words');
    expect(nextLabel({ sectionId: 's2', level: 2, step: 'tempo', kind: 'fix', reason: '' }, label)).toBe('Fix bars 14–21');
    expect(nextLabel({ sectionId: 's1', level: 3, step: 'tempo', kind: 'review', reason: '' }, label)).toBe('Review bars 6–13');
  });
});

describe('trouble notes and milestones', () => {
  it('the note gone wrong most lately in the passage', () => {
    const part = { notes: [0, 1, 2, 3].map((i) => ({ midi: 60, start: i * 2, dur: 1, startBeat: i, durBeats: 1, measure: i })) };
    const t = troubleNote(part, 2, 8, { 0: { n: 3, w: 0.9, at: 1, k: { flat: 2 } }, 2: { n: 2, w: 0.4, at: 1, k: { flat: 1, sharp: 0.3 } }, 3: { n: 2, w: 0.2, at: 1 } });
    expect(t).toEqual({ index: 2, measure: 2, kind: 'flat' });
    expect(troubleNote(part, 6, 8, { 3: { n: 2, w: 0.2, at: 1 } })).toBeNull();
    expect(troubleWords('flat', '25')).toBe('bar 25 has been flat lately');
  });
  it('the highest milestone crossed', () => {
    expect(milestoneCrossed(2, 3)).toBe(3);
    expect(milestoneCrossed(2, 4)).toBe(4);
    expect(milestoneCrossed(3, 3)).toBeNull();
    expect(milestoneCrossed(4, 5)).toBe(5);
    expect(milestoneCrossed(0, 2)).toBeNull();
  });
});
