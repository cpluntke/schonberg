import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  _resetAllForTests, DEFAULT_PROFILE, getProgress, loadCycle, loadProfile, progressKey, readinessHistory, saveCycle, saveProfile,
  snapshotReadiness, writeJSON, type FullRunProgress, type PieceProgress, type SectionProgress,
} from './store';
import { barsKey, getBars, type BarMap } from './bars';
import { wordsKey } from './words';
import {
  applySnapshot, buildSnapshot, cleanProfile, confirmMerge, decodeBars, decodePiece, encodeBars, encodePiece, loadMeta, accountConfirmed,
  mergeBars, mergeFull, mergeProfile, mergeProgress, mergeSection, pendingQuestion, suggestAccount, accountTipPending, dismissAccountTip, flushProgress, syncEnabled,
  staffSyncQuestion, answerStaffSync, onAccountConfirmed, contentHash,
  throttle, TOTAL_BUDGET, uploadProgress, type ProgressSnapshot,
} from './sync';
import { saveSession, type Session } from './choir';

const DAY = 86_400_000;
const T = new Date(2026, 9, 1, 12).getTime();
const sec = (o: Partial<SectionProgress>): SectionProgress => ({ level: 0, best: {}, attempts: 0, ...o });
const piece = (o: Partial<PieceProgress> = {}): PieceProgress => ({ pieceId: 'p', partId: 'P1', sections: {}, totalAttempts: 0, bestScore: 0, ...o });

beforeEach(() => {
  localStorage.clear();
  _resetAllForTests();
  vi.stubEnv('VITE_CHOIR_URL', '/schonberg/api');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('merging never downgrades', () => {
  it('a section: higher level and best results win, newer dates win, off-book days add up', () => {
    const local = sec({ level: 3, best: { 1: 0.9, 2: 0.8, 3: 0.75 }, bestScore: { 3: 900 }, attempts: 12, lastPassed: T, lastPracticed: T + DAY, offBookDays: ['2026-09-01'] });
    const remote = sec({ level: 1, best: { 1: 0.95 }, attempts: 3, lastPassed: T + 2 * DAY, lastPracticed: T - DAY, offBookDays: ['2026-09-03'] });
    const m = mergeSection(local, remote)!;
    expect(m.level).toBe(3);
    expect(m.best).toEqual({ 1: 0.95, 2: 0.8, 3: 0.75 });
    expect(m.bestScore).toEqual({ 3: 900 });
    expect(m.attempts).toBe(12);
    expect(m.lastPassed).toBe(T + 2 * DAY);
    expect(m.lastPracticed).toBe(T + DAY);
    expect(m.offBookDays).toEqual(['2026-09-01', '2026-09-03']);
    // Either way round, the same result.
    expect(mergeSection(remote, local)).toEqual({ ...m });
    expect(mergeSection(undefined, remote)).toBe(remote);
  });

  it('a piece: sections from both phones, the piece level and attempts never go down', () => {
    const l = piece({ sections: { a: sec({ level: 2 }) }, totalAttempts: 20, bestScore: 500, full: { level: 2, best: { 2: 0.8 }, attempts: 3, lastPracticed: T } });
    const r = piece({ sections: { a: sec({ level: 4 }), b: sec({ level: 1 }) }, totalAttempts: 5, bestScore: 900, full: { level: 1, best: { 1: 0.9 }, attempts: 1, lastPracticed: T - DAY } });
    const m = mergeProgress(l, r);
    expect(m.sections.a.level).toBe(4);
    expect(m.sections.b.level).toBe(1);
    expect(m.totalAttempts).toBe(20);
    expect(m.bestScore).toBe(900);
    expect(m.full!.level).toBe(2);
    expect(m.full!.best).toEqual({ 1: 0.9, 2: 0.8 });
    expect(mergeProgress(undefined, r)).toBe(r);
  });

  it('to-fix lists come from the latest full run, minus sections that passed on their own after it', () => {
    const older: FullRunProgress = { level: 1, best: {}, attempts: 2, lastPracticed: T, toFix: { 2: ['x'] }, toFixLocks: { 2: true } };
    const newer: FullRunProgress = { level: 1, best: {}, attempts: 3, lastPracticed: T + DAY, toFix: { 2: ['a', 'b'], 3: ['c'] }, toFixLocks: { 2: true } };
    const sections = {
      a: sec({ level: 2, lastPassed: T + 2 * DAY }), // fixed after the run: off the list
      b: sec({ level: 2, lastPassed: T }), // passed before the run: still to fix
      c: sec({ level: 2, lastPassed: T + 2 * DAY }), // passed after, but below level 3: still to fix
    };
    const m = mergeFull(older, newer, sections)!;
    expect(m.toFix).toEqual({ 2: ['b'], 3: ['c'] });
    expect(m.toFixLocks).toEqual({ 2: true });
    expect(mergeFull(newer, older, sections)!.toFix).toEqual({ 2: ['b'], 3: ['c'] });
  });

  it('a fix list finished on the other phone reaches its level; clean-run stars are united', () => {
    const run: FullRunProgress = { level: 1, best: {}, attempts: 2, lastPracticed: T + DAY, toFix: { 2: ['a'] }, toFixLocks: { 2: true }, clean: [1] };
    const other: FullRunProgress = { level: 1, best: {}, attempts: 2, lastPracticed: T, clean: [3] };
    const sections = { a: sec({ level: 2, lastPassed: T + 2 * DAY }) };
    const m = mergeFull(other, run, sections)!;
    expect(m.toFix).toBeUndefined();
    expect(m.level).toBe(2);
    expect(m.lastPassed).toBe(T + 2 * DAY);
    expect(m.clean).toEqual([1, 3]);
    // Absent on both (earlier versions): stays absent, for the upgrade to work out.
    expect(mergeFull({ level: 1, best: {}, attempts: 1 }, { level: 1, best: {}, attempts: 1 }, {})!.clean).toBeUndefined();
  });

  it('bars: the more recently sung copy wins, bars only one phone has are kept', () => {
    const l: BarMap = { 1: { ema: 0.9, n: 5, at: T }, 2: { ema: 0.4, n: 2, at: T + DAY } };
    const r: BarMap = { 1: { ema: 0.5, n: 1, at: T - DAY }, 2: { ema: 0.8, n: 1, at: T + 2 * DAY }, 3: { ema: 0.7, n: 1, at: T } };
    const m = mergeBars(l, r);
    expect(m[1].ema).toBe(0.9);
    expect(m[2]).toMatchObject({ ema: 0.8, n: 2 });
    expect(m[3].ema).toBe(0.7);
  });

  it('settings: a new phone takes the backup, a set-up phone keeps its own and fills gaps', () => {
    const remote = { ...DEFAULT_PROFILE, name: 'Anna', voice: 'A' as const, notation: 'fixed' as const, latencyMs: 120, latencySource: 'measured' as const, onboarded: true, choirCode: 'kammerchor', shareProgress: true };
    const fresh = mergeProfile({ ...DEFAULT_PROFILE }, remote, false);
    expect(fresh).toMatchObject({ name: 'Anna', voice: 'A', notation: 'fixed', onboarded: true, choirCode: 'kammerchor', latencyMs: 120, latencySource: 'learned' });
    const mine = { ...DEFAULT_PROFILE, name: '', voice: 'T' as const, onboarded: true, latencyMs: 80, latencySource: 'measured' as const };
    const kept = mergeProfile(mine, remote, true);
    expect(kept).toMatchObject({ name: 'Anna', voice: 'T', notation: 'letter', latencyMs: 80, latencySource: 'measured', choirCode: 'kammerchor', shareProgress: true });
  });

  it('privacy choices follow the account; the stricter one wins on a set-up phone', () => {
    const remote = { ...DEFAULT_PROFILE, onboarded: true, choirCode: 'kammerchor', shareProgress: false, shareOptOut: true, boardHidden: true, presenceHidden: true };
    expect(mergeProfile({ ...DEFAULT_PROFILE }, remote, false)).toMatchObject({ shareOptOut: true, boardHidden: true, presenceHidden: true, shareProgress: false });
    const mine = { ...DEFAULT_PROFILE, onboarded: true, choirCode: 'kammerchor', shareProgress: true };
    expect(mergeProfile(mine, remote, true)).toMatchObject({ shareOptOut: true, boardHidden: true, presenceHidden: true, shareProgress: false });
    expect(mergeProfile({ ...mine, boardHidden: true }, { ...remote, boardHidden: false }, true).boardHidden).toBe(true);
  });

  it('the "Headphones on?" answer stays on its phone, like the delay', () => {
    saveProfile({ ...DEFAULT_PROFILE, name: 'Anna', onboarded: true, headphones: false });
    expect(buildSnapshot().data.profile).not.toHaveProperty('headphones');
    expect(cleanProfile({ ...DEFAULT_PROFILE, headphones: true })).not.toHaveProperty('headphones');
    // A copy from another phone (where the answer was yes) doesn't change this phone's answer.
    expect(mergeProfile({ ...DEFAULT_PROFILE, onboarded: true, headphones: false }, { ...DEFAULT_PROFILE, headphones: true }, true).headphones).toBe(false);
    expect(mergeProfile({ ...DEFAULT_PROFILE }, { ...DEFAULT_PROFILE, onboarded: true, headphones: true }, false).headphones).toBeUndefined();
  });
});

describe('compact format', () => {
  it('round-trips sections, full runs, words and readiness (dates to the minute, results to the percent)', () => {
    const prog = piece({
      sections: { 's0-m1-8': sec({ level: 5, best: { 1: 0.913, 3: 0.8, 5: 0.86 }, attempts: 9, lastPassed: T + 59_999, lastPracticed: T - 5 * DAY, offBookDays: ['2026-09-01', '2026-09-02'] }) },
      totalAttempts: 30, bestScore: 1234.4,
      full: { level: 2, best: { 1: 0.9, 2: 0.85 }, attempts: 4, lastPracticed: T, lastPassed: T, toFix: { 3: ['s0-m1-8'] }, toFixLocks: { 3: true }, clean: [1] },
    });
    const pc = encodePiece(prog, {}, { 's0-m1-8': { passed: 1, best: { 1: 0.9 }, at: T } }, ['2026-10-01', 0.4567]);
    const d = decodePiece('p', 'P1', JSON.parse(JSON.stringify(pc)))!;
    const s = d.progress.sections['s0-m1-8'];
    expect(s).toMatchObject({ level: 5, attempts: 9, lastPassed: T, lastPracticed: T - 5 * DAY, offBookDays: ['2026-09-01', '2026-09-02'] });
    expect(s.best).toEqual({ 1: 0.91, 3: 0.8, 5: 0.86 });
    expect(d.progress.full).toMatchObject({ level: 2, attempts: 4, toFix: { 3: ['s0-m1-8'] }, toFixLocks: { 3: true }, clean: [1] });
    expect(d.progress).toMatchObject({ totalAttempts: 30, bestScore: 1234 });
    expect(d.words).toEqual({ 's0-m1-8': 1 });
    expect(d.readiness).toEqual(['2026-10-01', 0.457]);
    // Restoring the backup onto the phone it came from changes nothing (times rounded down, never later).
    expect(mergeProgress(prog, d.progress).sections['s0-m1-8'].lastPassed).toBe(T + 59_999);
  });

  it('bars: one character per bar and measure, gaps kept, capped', () => {
    const bars: BarMap = { 3: { ema: 0.92, n: 4, at: T }, 5: { ema: 0.31, mem: 0.5, n: 1, at: T + 1000 }, 6: { ema: 1, off: 0.9, n: 2, at: T } };
    const h = Math.floor((T + 1000) / 60_000);
    const c = encodeBars(bars, h)!;
    expect(c.m).toBe(3);
    expect(c.e).toHaveLength(4);
    expect(c.e[1]).toBe('.');
    const back = decodeBars(c, h);
    expect(Object.keys(back).map(Number)).toEqual([3, 5, 6]);
    expect(back[3].ema).toBeCloseTo(0.92, 1);
    expect(back[5].mem).toBeCloseTo(0.5, 1);
    expect(back[6].off).toBeCloseTo(0.9, 1);
    expect(back[6].mem).toBeUndefined();
    const many: BarMap = {};
    for (let m = 0; m < 1000; m++) many[m] = { ema: 0.5, n: 1, at: T };
    expect(encodeBars(many, h)!.e).toHaveLength(400);
    // Long gaps are squeezed: bars 1 and 100 only.
    const gap = encodeBars({ 1: { ema: 1, n: 1, at: T }, 100: { ema: 1, n: 1, at: T } }, h)!;
    expect(gap.e).toBe('_!98!_');
    expect(Object.keys(decodeBars(gap, h)).map(Number)).toEqual([1, 100]);
  });

  it('a busy singer (8 pieces, 10 sections and 80 bars each, most of it from memory) stays under 8 KB', () => {
    seedSinger(8);
    const { bytes } = buildSnapshot();
    console.info(`[sync size] 8 pieces × 10 sections × 80 bars: ${bytes} bytes`);
    expect(bytes).toBeLessThan(8 * 1024);
  });

  it('a typical singer (8 pieces, 6 sections and 60 bars each) needs under 6 KB', () => {
    seedSinger(8, 6, 60);
    const { bytes } = buildSnapshot();
    console.info(`[sync size] 8 pieces × 6 sections × 60 bars: ${bytes} bytes`);
    expect(bytes).toBeLessThan(6 * 1024);
  });

  it('a very busy singer is capped well under the server limit', () => {
    seedSinger(70, 30, 300);
    const { data, bytes } = buildSnapshot();
    console.info(`[sync size] 70 pieces × 30 sections × 300 bars, capped: ${Object.keys(data.p).length} pieces, ${bytes} bytes`);
    expect(Object.keys(data.p).length).toBeGreaterThanOrEqual(15);
    expect(bytes).toBeLessThanOrEqual(TOTAL_BUDGET); // the server takes 32 KB
    // Levels before bars: past the budget the pieces go without their bar summary.
    expect(Object.values(data.p).filter((pc) => !pc.b).length).toBeGreaterThan(0);
    expect(data.p['piece0|P2']).toBeTruthy();
  });

  it('never includes the attempt log, recordings or the readiness history', () => {
    seedSinger(1);
    writeJSON('sh:log', [{ at: T, pieceId: 'piece0', partId: 'P2', sectionId: 'x', level: 1, accuracy: 1, score: 1, passed: true }]);
    snapshotReadiness('piece0', 'P2', 0.2, T - DAY);
    snapshotReadiness('piece0', 'P2', 0.3, T);
    const json = JSON.stringify(buildSnapshot().data);
    expect(json).not.toContain('"sh:log"');
    expect(json).not.toContain('accuracy');
    expect(buildSnapshot().data.p['piece0|P2'].r).toEqual([expect.any(String), 0.3]);
  });
});

function seedSinger(pieces: number, sections = 10, bars = 80) {
  saveProfile({ ...DEFAULT_PROFILE, name: 'Anna Example', voice: 'A', onboarded: true, latencyMs: 140, latencySource: 'measured', choirCode: 'kammerchor', shareProgress: true });
  saveCycle({ name: 'Spring concert', pieceIds: Array.from({ length: Math.min(pieces, 8) }, (_, i) => `piece${i}`), rehearsalWeekday: 2, rehearsalTime: '19:30', concertDate: '2027-03-20' });
  for (let i = 0; i < pieces; i++) {
    const secs: Record<string, SectionProgress> = {};
    for (let j = 0; j < sections; j++) {
      const lvl = (i + j) % 6;
      const best: Record<number, number> = {};
      for (let l = 1; l <= Math.min(5, lvl + 1); l++) best[l] = 0.7 + ((i * 7 + j * 3 + l) % 30) / 100;
      secs[`s${j}-m${j * 8 + 1}-${j * 8 + 8}`] = sec({ level: lvl, best, bestScore: { 1: 900 }, attempts: 3 + j, lastPracticed: T - j * DAY, lastPassed: lvl ? T - j * DAY - 3600_000 : undefined, offBookDays: lvl === 5 ? ['2026-09-20', '2026-09-22'] : undefined });
    }
    writeJSON(progressKey(`piece${i}`, 'P2'), piece({
      pieceId: `piece${i}`, partId: 'P2', sections: secs, totalAttempts: 60, bestScore: 4321,
      full: { level: 2, best: { 1: 0.9, 2: 0.84, 3: 0.71 }, attempts: 5, lastPracticed: T, lastPassed: T - DAY, toFix: { 3: ['s2-m17-24', 's5-m41-48'] }, toFixLocks: { 3: true } },
    }), false);
    const bm: BarMap = {};
    for (let m = 1; m <= bars; m++) bm[m] = { ema: ((m * 37 + i) % 100) / 100, n: 4, at: T, ...(m % 3 ? { mem: 0.8 } : {}), ...(m % 5 === 0 ? { off: 0.9 } : {}), ...(m % 11 === 0 ? { issues: ['flat' as never] } : {}) };
    writeJSON(barsKey(`piece${i}`, 'P2'), bm, false);
    writeJSON(wordsKey(`piece${i}`, 'P2'), { 's0-m1-8': { passed: 1, best: { 0: 1, 1: 0.9 }, at: T } }, false);
    snapshotReadiness(`piece${i}`, 'P2', 0.42, T);
    localStorage.setItem(`sh:part:piece${i}`, 'P2');
  }
  localStorage.setItem('sh:memberToken', 'a'.repeat(32));
}

describe('restoring on a new phone', () => {
  it('a copy saved on phone A restores everything essential on an empty phone B', () => {
    seedSinger(3);
    const { data } = buildSnapshot();
    const snapshotA = { prog: getProgress('piece1', 'P2')!, bars: getBars('piece1', 'P2') };
    // Phone B: empty.
    localStorage.clear();
    _resetAllForTests();
    const r = applySnapshot(JSON.parse(JSON.stringify(data)));
    expect(r).toEqual({ pieces: 3, profile: true, cycle: true });
    const p = getProgress('piece1', 'P2')!;
    for (const [id, s] of Object.entries(snapshotA.prog.sections)) {
      expect(p.sections[id].level).toBe(s.level);
      expect(p.sections[id].lastPassed ?? 0).toBeGreaterThan((s.lastPassed ?? 0) - 60_000);
    }
    expect(p.full).toMatchObject({ level: 2, toFix: { 3: ['s2-m17-24', 's5-m41-48'] } });
    expect(Object.keys(getBars('piece1', 'P2'))).toHaveLength(Object.keys(snapshotA.bars).length);
    expect(loadProfile()).toMatchObject({ name: 'Anna Example', voice: 'A', choirCode: 'kammerchor', latencySource: 'learned' });
    expect(loadCycle()).toMatchObject({ name: 'Spring concert', concertDate: '2027-03-20' });
    expect(readinessHistory('piece1', 'P2')).toHaveLength(1);
    expect(localStorage.getItem('sh:part:piece2')).toBe('P2');
    // The member token never leaves the phone: shared progress follows the account instead.
    expect(JSON.stringify(data)).not.toContain('a'.repeat(32));
  });

  it('does not lower the progress already on the phone, nor replace its programme', () => {
    seedSinger(1);
    const { data } = buildSnapshot();
    const id = 's0-m1-8';
    const p = getProgress('piece0', 'P2')!;
    // Since the backup this phone got further.
    p.sections[id] = { ...p.sections[id], level: 5, offBookDays: ['2026-09-20', '2026-09-22'] };
    writeJSON(progressKey('piece0', 'P2'), p);
    saveCycle({ name: 'Mine', pieceIds: ['x'] });
    // The backup knows less about this section.
    data.p['piece0|P2'].s[id] = [1, 0, 0, 1, [50]];
    applySnapshot(data);
    expect(getProgress('piece0', 'P2')!.sections[id].level).toBe(5);
    expect(loadCycle().name).toBe('Mine');
  });

  it('progress on a piece this phone no longer has (a former built-in piece) survives saving and merging', () => {
    // No score for 'debussy-dieu' on either phone: sync never looks at the library.
    const mine = piece({ pieceId: 'debussy-dieu', partId: 'P2', totalAttempts: 4, sections: { s0: sec({ level: 2, attempts: 4, lastPracticed: T, lastPassed: T }) } });
    writeJSON(progressKey('debussy-dieu', 'P2'), mine);
    const { data } = buildSnapshot(T + DAY);
    expect(Object.keys(data.p)).toContain('debussy-dieu|P2');
    // The account's copy from another phone knows a further section; this phone's copy merges with it.
    const other = JSON.parse(JSON.stringify(data)) as ProgressSnapshot;
    localStorage.clear();
    _resetAllForTests();
    writeJSON(progressKey('debussy-dieu', 'P2'), piece({ pieceId: 'debussy-dieu', partId: 'P2', totalAttempts: 1, sections: { s1: sec({ level: 1, attempts: 1, lastPracticed: T }) } }));
    applySnapshot(other);
    const merged = getProgress('debussy-dieu', 'P2')!;
    expect(merged.sections.s0.level).toBe(2);
    expect(merged.sections.s1.level).toBe(1);
    expect(Object.keys(buildSnapshot(T + 2 * DAY).data.p)).toContain('debussy-dieu|P2');
  });

  it('rejects damaged copies', () => {
    expect(() => applySnapshot(null)).toThrow(/damaged/);
    expect(() => applySnapshot({ v: 1 })).toThrow(/damaged/);
    expect(applySnapshot({ v: 1, p: { nopipe: { s: {} }, 'a|b': 'junk' } } as unknown as ProgressSnapshot).pieces).toBe(0);
  });

  it('a new phone that was never set up does not undo the setup of a set-up phone (and vice versa it adopts it)', () => {
    // Phone 1: set up (voice, range, name). Phone 2 logged in fresh and saved its defaults.
    const setUp = { ...DEFAULT_PROFILE, name: 'Clara', voice: 'A' as const, rangeLow: 53, rangeHigh: 74, onboarded: true, latencyMs: 120, notation: 'movable' as const };
    saveProfile(setUp);
    const fresh = { ...DEFAULT_PROFILE, name: '', onboarded: false, choirCode: 'kammerchor', leaderboardOptIn: true };
    applySnapshot({ v: 1, p: {}, profile: fresh } as unknown as ProgressSnapshot, { adoptSettings: true });
    const p1 = loadProfile();
    expect(p1).toMatchObject({ name: 'Clara', voice: 'A', rangeLow: 53, rangeHigh: 74, onboarded: true, latencyMs: 120, notation: 'movable' });
    expect(p1.choirCode).toBe('kammerchor'); // what it lacked is filled in
    // The other way round: the fresh phone takes the set-up phone's settings (not its delay).
    localStorage.clear();
    _resetAllForTests();
    saveProfile({ ...DEFAULT_PROFILE, latencyMs: 80 });
    applySnapshot({ v: 1, p: {}, profile: setUp } as unknown as ProgressSnapshot, { adoptSettings: true });
    expect(loadProfile()).toMatchObject({ name: 'Clara', voice: 'A', rangeLow: 53, rangeHigh: 74, onboarded: true, latencyMs: 80, notation: 'movable' });
    // Two set-up phones: the newer copy's settings win, but onboarded and the name are never lost.
    applySnapshot({ v: 1, p: {}, profile: { ...setUp, voice: 'T', rangeLow: 48, name: '' } } as unknown as ProgressSnapshot, { adoptSettings: true });
    expect(loadProfile()).toMatchObject({ name: 'Clara', voice: 'T', rangeLow: 48, rangeHigh: 74, onboarded: true });
  });

  it("a newer copy that only says 'sharing' doesn't switch a singer's opt-out back on (two set-up phones)", () => {
    const base = { ...DEFAULT_PROFILE, name: 'Clara', onboarded: true, choirCode: 'kammerchor' };
    saveProfile({ ...base, shareProgress: false, shareOptOut: true });
    applySnapshot({ v: 1, p: {}, profile: { ...base, shareProgress: true } } as unknown as ProgressSnapshot, { adoptSettings: true });
    expect(loadProfile()).toMatchObject({ shareOptOut: true, shareProgress: false });
    // switched back on, on the other phone: that choice is adopted
    applySnapshot({ v: 1, p: {}, profile: { ...base, shareProgress: true, shareOptOut: false } } as unknown as ProgressSnapshot, { adoptSettings: true });
    expect(loadProfile()).toMatchObject({ shareOptOut: false, shareProgress: true });
  });

  it('ignores a programme of the wrong shape, so the next upload can still be built', () => {
    saveCycle({ name: 'Mine', pieceIds: ['x'] });
    const bad: unknown[] = [
      { name: 7, pieceIds: ['a'] },
      { name: 'Spring', pieceIds: ['a', 3] },
      { name: 'Spring', pieceIds: ['a'], focusPieceIds: 'a' },
      { name: 'Spring', pieceIds: ['a'], wanted: [{ title: 5 }] },
      { name: 'Spring', pieceIds: ['a'], wanted: [{ title: 'Ave', composer: {} }] },
      { name: 'Spring', pieceIds: ['a'], preset: ['x'] },
      { name: 'Spring', pieceIds: ['a'], concertDate: 20270320 },
    ];
    for (const cycle of bad) {
      const r = applySnapshot({ v: 1, p: {}, cycle } as unknown as ProgressSnapshot, { adoptSettings: true });
      expect(r.cycle).toBe(false);
      expect(loadCycle()).toEqual({ name: 'Mine', pieceIds: ['x'] });
      expect(() => buildSnapshot()).not.toThrow();
    }
    const good = { name: 'Spring', pieceIds: ['a'], wanted: [{ title: 'Ave', composer: 'Byrd' }], rehearsalWeekday: 2 };
    expect(applySnapshot({ v: 1, p: {}, cycle: good } as unknown as ProgressSnapshot, { adoptSettings: true }).cycle).toBe(true);
    expect(loadCycle()).toMatchObject(good);
    expect(() => buildSnapshot()).not.toThrow();
  });
});

describe('review fixes', () => {
  it('fits the whole upload (programme, settings, long ids, non-Latin titles) into the budget, in UTF-8 bytes', () => {
    seedSinger(70, 30, 300);
    // A full programme: 100 long choir piece ids, 30 wanted titles in Greek / Japanese.
    saveCycle({
      name: 'Χειμερινή συναυλία — 冬のコンサート', pieceIds: Array.from({ length: 100 }, (_, i) => `choir-kammerchor-${i.toString(16).padStart(12, 'a')}`),
      focusPieceIds: Array.from({ length: 60 }, (_, i) => `choir-kammerchor-${i.toString(16).padStart(12, 'a')}`),
      wanted: Array.from({ length: 30 }, (_, i) => ({ title: `Ἀγνὴ παρθένε ${i} — 春の小川 `.repeat(6), composer: 'Νικόλαος Μαντζαρος 作曲'.repeat(4), note: 'import your choir’s score' })),
    });
    for (let i = 0; i < 100; i++) localStorage.setItem(`sh:part:choir-kammerchor-${i.toString(16).padStart(12, 'a')}`, 'P2');
    const { data, bytes } = buildSnapshot();
    const body = new TextEncoder().encode(JSON.stringify({ baseRev: 123456, data })).length;
    console.info(`[sync size] full programme + 70 busy pieces: ${Object.keys(data.p).length} pieces, body ${body} bytes`);
    expect(body).toBeLessThanOrEqual(TOTAL_BUDGET);
    expect(bytes).toBeLessThanOrEqual(body);
    expect(Object.keys(data.p).length).toBeGreaterThanOrEqual(3);
  });

  it('settings from the server are type-checked', () => {
    const bad = { name: 42, voice: 'X', notation: 'letter', latencyMs: 1e9, onboarded: 'yes', choirCode: '../x', beat: 'always', display: { a: 1 }, extra: 1 };
    expect(cleanProfile(bad)).toEqual({ notation: 'letter', beat: 'always' });
    expect(cleanProfile(null)).toEqual({});
    const out = mergeProfile({ ...DEFAULT_PROFILE }, bad, false);
    expect(out.name).toBe('');
    expect(out.voice).toBe('S');
    expect(out.latencyMs).toBe(0);
  });

  it('the full-run record keeps its exact time, so the latest run decides the to-fix lists even within one hour', () => {
    const h = Math.floor(T / 3_600_000);
    const a: FullRunProgress = { level: 1, best: {}, attempts: 2, lastPracticed: h * 3_600_000 + 60_000, toFix: { 2: ['x'] } };
    const b: FullRunProgress = { level: 1, best: {}, attempts: 3, lastPracticed: h * 3_600_000 + 120_000, toFix: { 2: ['y'] } };
    const back = decodePiece('p', 'P1', JSON.parse(JSON.stringify(encodePiece(piece({ full: b }), {}, {}))))!.progress.full!;
    expect(back.lastPracticed).toBe(b.lastPracticed);
    expect(mergeFull(a, back, {})!.toFix).toEqual({ 2: ['y'] });
    expect(mergeFull(back, a, {})!.toFix).toEqual({ 2: ['y'] });
  });

  it('a section cleared from the to-fix list on one phone stays cleared after merging (same run, same minute)', () => {
    const run = T + 10_000;
    // Both phones know the same counted run; phone B then passed s2 on its own a few seconds later.
    const a: FullRunProgress = { level: 1, best: {}, attempts: 3, lastPracticed: run, toFix: { 2: ['s2', 's5'] }, toFixLocks: { 2: true } };
    const b: FullRunProgress = { level: 1, best: {}, attempts: 3, lastPracticed: run, toFix: { 2: ['s5'] }, toFixLocks: { 2: true } };
    const secsA = { s2: sec({ level: 1, lastPassed: run - DAY }), s5: sec({ level: 1 }) };
    const secsB = { s2: sec({ level: 2, lastPassed: run + 5_000 }), s5: sec({ level: 1 }) };
    // B's copy travels through the compact format (minutes) and is merged on A, and the other way round.
    const viaServer = (p: PieceProgress) => decodePiece('p', 'P1', JSON.parse(JSON.stringify(encodePiece(p, {}, {}))))!.progress;
    const onA = mergeProgress(piece({ sections: secsA, full: a }), viaServer(piece({ sections: secsB, full: b })));
    const onB = mergeProgress(piece({ sections: secsB, full: b }), viaServer(piece({ sections: secsA, full: a })));
    expect(onA.full!.toFix).toEqual({ 2: ['s5'] });
    expect(onB.full!.toFix).toEqual({ 2: ['s5'] });
    expect(onA.sections.s2.level).toBe(2);
  });

  it('times from the future are clamped to at most a day ahead', () => {
    const future = Date.now() + 400 * DAY;
    const pc = encodePiece(piece({ sections: { a: sec({ level: 2, lastPassed: future, lastPracticed: future }) }, full: { level: 1, best: {}, attempts: 1, lastPracticed: future } }), { 1: { ema: 1, n: 1, at: future } }, {});
    const d = decodePiece('p', 'P1', JSON.parse(JSON.stringify(pc)))!;
    const limit = Date.now() + DAY + 1000;
    expect(d.progress.sections.a.lastPassed!).toBeLessThanOrEqual(limit);
    expect(d.progress.full!.lastPracticed!).toBeLessThanOrEqual(limit);
    expect(d.bars[1].at).toBeLessThanOrEqual(limit);
  });
});

describe('sync with the choir account', () => {
  type Call = { method: string; url: string; auth: string; body: Record<string, unknown> | null };
  let calls: Call[];
  let server: { rev: number; data: unknown } | null;
  function fakeServer(over?: (c: Call) => { status: number; body: unknown } | null) {
    calls = [];
    server = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const c: Call = { method: init.method ?? 'GET', url, auth: (init.headers as Record<string, string>).Authorization, body: init.body ? JSON.parse(init.body as string) : null };
      calls.push(c);
      const o = over?.(c);
      const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (o) return reply(o.status, o.body);
      if (c.method === 'GET') {
        const v = server ? { rev: server.rev, updatedAt: T, data: server.data } : { rev: 0, updatedAt: 0, data: null };
        return reply(200, c.url.endsWith('?meta=1') ? { rev: v.rev, updatedAt: v.updatedAt } : v);
      }
      const base = c.body!.baseRev;
      if (server && base !== server.rev) return reply(409, { error: 'changed', progress: { rev: server.rev, data: server.data } });
      server = { rev: (server?.rev ?? (base as number | undefined) ?? 0) + 1, data: c.body!.data };
      return reply(200, { ok: true, rev: server.rev, updatedAt: T });
    }));
  }
  const session = (over: Partial<Session['account']> = {}, token = 't'.repeat(43)): Session => ({
    token, code: 'kammerchor', choirName: 'Kammerchor', expiresAt: Date.now() + 30 * DAY,
    account: { id: 'acc000000001', name: 'Anna Example', role: 'member', voices: [], createdAt: 1, ...over },
  });

  it('members: on while logged in unless turned off; admins and leads: asked first, nothing saved before', async () => {
    fakeServer();
    seedSinger(1);
    expect(syncEnabled()).toBe(false);
    saveSession(session());
    expect(syncEnabled()).toBe(true);
    expect(staffSyncQuestion()).toBe(false);
    saveSession(session({ role: 'admin' }));
    expect(syncEnabled()).toBe(false);
    expect(staffSyncQuestion()).toBe(true);
    expect((await uploadProgress(true)).ok).toBe(false);
    expect(calls).toHaveLength(0);
    answerStaffSync(true);
    expect(syncEnabled()).toBe(true);
    expect(staffSyncQuestion()).toBe(false);
    saveProfile({ ...loadProfile(), sync: false });
    expect(syncEnabled()).toBe(false);
    saveProfile({ ...loadProfile(), sync: undefined, choirCode: 'other' });
    expect(syncEnabled()).toBe(false); // the login belongs to another choir
  });

  it('first time on a phone: pulls (nothing yet), then saves with the session; skips when nothing changed', async () => {
    fakeServer();
    seedSinger(2);
    let confirmations = 0;
    const off = onAccountConfirmed(() => { confirmations++; });
    saveSession(session());
    expect((await uploadProgress(false, true)).ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /schonberg/api/session/progress', 'GET /schonberg/api/session/progress?meta=1', 'PUT /schonberg/api/session/progress']);
    expect(calls[2].auth).toBe(`Bearer ${'t'.repeat(43)}`);
    expect(calls[2].body!.baseRev).toBe(0);
    expect(loadMeta()).toMatchObject({ account: 'acc000000001', rev: 1, error: null });
    expect(confirmations).toBeGreaterThanOrEqual(1);
    expect(accountConfirmed()).toBe(true);
    off();
    expect(await uploadProgress()).toEqual({ ok: true, skipped: true });
    expect(calls.at(-1)!.url).toMatch(/meta=1$/); // only the cheap check
    const p = getProgress('piece0', 'P2')!;
    p.sections['s0-m1-8'].level = 4;
    writeJSON(progressKey('piece0', 'P2'), p);
    await uploadProgress();
    expect(calls.at(-1)!.method).toBe('PUT');
    expect(calls.at(-1)!.body!.baseRev).toBe(1);
  });

  it('logging in on an empty phone pulls the account\'s progress', async () => {
    fakeServer();
    seedSinger(2);
    const { data } = buildSnapshot();
    server = { rev: 5, data: JSON.parse(JSON.stringify(data)) };
    localStorage.clear();
    _resetAllForTests();
    saveProfile({ ...DEFAULT_PROFILE, choirCode: 'kammerchor' });
    saveSession(session());
    expect((await uploadProgress()).ok).toBe(true);
    expect(getProgress('piece1', 'P2')!.full!.level).toBe(2);
    expect(loadProfile()).toMatchObject({ name: 'Anna Example', voice: 'A' });
    // Nothing new on this phone: nothing is saved back.
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(loadMeta().rev).toBe(5);
  });

  it('a phone with progress under another name asks before merging; yes merges, nothing uploads before', async () => {
    fakeServer();
    seedSinger(1);
    const { data } = buildSnapshot();
    server = { rev: 2, data: JSON.parse(JSON.stringify(data)) };
    // This phone: Ben's progress.
    localStorage.clear();
    _resetAllForTests();
    saveProfile({ ...DEFAULT_PROFILE, name: 'Ben', onboarded: true, choirCode: 'kammerchor' });
    writeJSON(progressKey('other', 'P1'), piece({ pieceId: 'other', partId: 'P1', sections: { a: sec({ level: 3 }) } }));
    saveSession(session());
    let confirmations = 0;
    const off = onAccountConfirmed(() => { confirmations++; });
    expect(await uploadProgress()).toEqual({ ok: false, ask: true });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    // Not the account's yet: shared progress must not move to it.
    expect(accountConfirmed()).toBe(false);
    expect(confirmations).toBe(0);
    expect(pendingQuestion()).toMatchObject({ accountName: 'Anna Example', here: 'Ben', pieces: 1 });
    expect(getProgress('piece0', 'P2')).toBeUndefined();
    // Asked again later: still nothing uploads.
    expect((await uploadProgress()).ask).toBe(true);
    await confirmMerge();
    expect(pendingQuestion()).toBeNull();
    expect(confirmations).toBe(1);
    expect(accountConfirmed()).toBe(true);
    off();
    expect(getProgress('piece0', 'P2')!.sections['s0-m1-8']).toBeTruthy();
    expect(getProgress('other', 'P1')!.sections.a.level).toBe(3);
    // Logging out clears the question.
    saveSession(session({ id: 'acc000000002', name: 'Ben' }));
    expect(pendingQuestion()).toBeNull();
  });

  it('another phone\'s newer save is picked up on start / focus, without singing first', async () => {
    fakeServer();
    seedSinger(1);
    saveSession(session());
    await uploadProgress();
    // Phone B saved a level-4 section (rev 2).
    const other = JSON.parse(JSON.stringify(server!.data)) as ProgressSnapshot;
    other.p['piece0|P2'].s['s0-m1-8'][0] = 4;
    server = { rev: 2, data: other };
    const n = calls.length;
    expect((await uploadProgress()).ok).toBe(true);
    expect(getProgress('piece0', 'P2')!.sections['s0-m1-8'].level).toBe(4);
    expect(loadMeta().rev).toBeGreaterThanOrEqual(2);
    expect(calls.slice(n).every((c) => c.method === 'GET' || c.body!.baseRev === 2)).toBe(true);
    expect(calls.slice(n).some((c) => c.method === 'PUT' && c.body!.baseRev !== 2)).toBe(false);
  });

  it('nothing is saved for a member who has not passed anything yet', async () => {
    fakeServer();
    saveProfile({ ...DEFAULT_PROFILE, name: 'Anna Example', onboarded: true, choirCode: 'kammerchor' });
    writeJSON(progressKey('p', 'P1'), piece({ sections: { a: sec({ level: 0, attempts: 2, lastPracticed: T }) } }));
    saveSession(session());
    expect(await uploadProgress()).toEqual({ ok: true, skipped: true });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    writeJSON(progressKey('p', 'P1'), piece({ sections: { a: sec({ level: 1, attempts: 3, lastPracticed: T, lastPassed: T }) } }));
    expect((await uploadProgress()).ok).toBe(true);
    expect(calls.at(-1)!.method).toBe('PUT');
  });

  it('closing the app sends unsaved progress right away (keepalive)', async () => {
    fakeServer();
    seedSinger(1);
    saveSession(session());
    await uploadProgress();
    await new Promise((r) => setTimeout(r, 20)); // (the login's own background sync)
    const puts = () => calls.filter((c) => c.method === 'PUT').length;
    const n = puts();
    flushProgress(); // nothing new: nothing sent
    await new Promise((r) => setTimeout(r, 0));
    expect(puts()).toBe(n);
    const p = getProgress('piece0', 'P2')!;
    p.sections['s0-m1-8'].level = 5;
    writeJSON(progressKey('piece0', 'P2'), p);
    const spy = vi.mocked(fetch);
    flushProgress();
    await new Promise((r) => setTimeout(r, 0));
    const last = spy.mock.calls.at(-1)!;
    expect((last[1] as RequestInit).keepalive).toBe(true);
    expect(calls.at(-1)!.method).toBe('PUT');
  });

  it('asks too when the phone\'s progress has no name, or the account has nothing saved yet', async () => {
    fakeServer();
    saveProfile({ ...DEFAULT_PROFILE, onboarded: true, choirCode: 'kammerchor' });
    writeJSON(progressKey('other', 'P1'), piece({ pieceId: 'other', partId: 'P1', sections: { a: sec({ level: 3 }) } }));
    saveSession(session({ role: 'lead', voices: ['A'] }));
    answerStaffSync(true);
    expect(await uploadProgress()).toEqual({ ok: false, ask: true });
    expect(pendingQuestion()).toMatchObject({ here: 'no name', pieces: 0 });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('two phones of one account settle: refocusing without singing neither pulls nor saves again', async () => {
    fakeServer();
    const phone = (): Record<string, string> => ({ ...localStorage });
    const use = (st: Record<string, string>) => { localStorage.clear(); _resetAllForTests(); for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); };
    // Phone A: Anna's progress, delay 140 ms, letters.
    seedSinger(2);
    saveSession(session());
    await uploadProgress();
    const A = phone();
    // Phone B: the same singer on a new phone (delay 60 ms measured there).
    localStorage.clear();
    _resetAllForTests();
    saveProfile({ ...DEFAULT_PROFILE, choirCode: 'kammerchor', latencyMs: 60, latencySource: 'measured' });
    saveSession(session({}, 'b'.repeat(43)));
    await uploadProgress();
    let B = phone();
    // B changes a setting and sings more; A picks both up, keeping its own delay.
    saveProfile({ ...loadProfile(), notation: 'fixed' });
    const p = getProgress('piece0', 'P2')!;
    p.sections['s0-m1-8'].level = 5;
    writeJSON(progressKey('piece0', 'P2'), p);
    await uploadProgress();
    B = phone();
    use(A);
    await uploadProgress();
    expect(loadProfile()).toMatchObject({ notation: 'fixed', latencyMs: 140 });
    expect(getProgress('piece0', 'P2')!.sections['s0-m1-8'].level).toBe(5);
    const settled = server!.rev;
    let A2 = phone();
    // Four focus cycles on each phone, no singing: no more saves.
    for (let i = 0; i < 4; i++) {
      use(B); await uploadProgress(); B = phone();
      use(A2); await uploadProgress(); A2 = phone();
    }
    expect(server!.rev).toBe(settled);
    expect(calls.filter((c) => c.method === 'PUT').length).toBeLessThanOrEqual(4);
  });

  it('the content fingerprint ignores key order, the time it was made and this phone\'s own delay', () => {
    seedSinger(1);
    const { data, hash } = buildSnapshot();
    const shuffled = JSON.parse(JSON.stringify({ p: data.p, cycle: data.cycle, v: data.v, profile: { ...data.profile, latencyMs: 5 }, at: 1 }));
    expect(contentHash(shuffled)).toBe(hash);
    expect(contentHash({ ...data, profile: { ...data.profile, notation: 'fixed' } })).not.toBe(hash);
  });

  it('after merging into an account the phone takes the account\'s name', async () => {
    fakeServer();
    seedSinger(1);
    server = { rev: 1, data: JSON.parse(JSON.stringify(buildSnapshot().data)) };
    saveProfile({ ...loadProfile(), name: 'Anni' });
    saveSession(session());
    expect((await uploadProgress()).ask).toBe(true);
    await confirmMerge();
    expect(loadProfile().name).toBe('Anna Example');
  });

  it('the same singer on a phone with progress merges without asking', async () => {
    fakeServer();
    seedSinger(1);
    server = { rev: 1, data: JSON.parse(JSON.stringify(buildSnapshot().data)) };
    saveSession(session());
    expect((await uploadProgress()).ok).toBe(true);
    expect(pendingQuestion()).toBeNull();
  });

  it('when another phone saved in between, merges its copy first, then saves', async () => {
    fakeServer();
    seedSinger(1);
    saveSession(session());
    await uploadProgress();
    const other = JSON.parse(JSON.stringify(server!.data)) as ProgressSnapshot;
    other.p['piece0|P2'].s['s0-m1-8'][0] = 4;
    server = { rev: 2, data: other };
    const p = getProgress('piece0', 'P2')!;
    p.sections['s1-m9-16'].level = 5;
    writeJSON(progressKey('piece0', 'P2'), p);
    expect((await uploadProgress()).ok).toBe(true);
    expect(getProgress('piece0', 'P2')!.sections['s0-m1-8'].level).toBe(4);
    expect(server!.rev).toBe(3);
    const up = server!.data as ProgressSnapshot;
    expect(up.p['piece0|P2'].s['s0-m1-8'][0]).toBe(4);
    expect(up.p['piece0|P2'].s['s1-m9-16'][0]).toBe(5);
  });

  it('an answer that arrives after logging in to another account is dropped', async () => {
    seedSinger(1);
    saveSession(session());
    const waiting: (() => void)[] = [];
    const release = () => waiting.splice(0).forEach((r) => r());
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      if ((init.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ error: 'none' }), { status: 404 });
      await new Promise<void>((r) => { waiting.push(r); });
      return new Response(JSON.stringify({ ok: true, rev: 9, updatedAt: T }), { status: 200 });
    }));
    const pending = uploadProgress(true);
    await new Promise((r) => setTimeout(r, 10));
    saveSession(session({ id: 'acc000000002', name: 'Ben' }, 'u'.repeat(43)));
    release();
    expect((await pending).ok).toBe(false);
    expect(loadMeta().rev ?? 0).not.toBe(9);
    release();
  });

  it('a session the server ended is forgotten (sharing stops only when the account was removed); errors are kept and retried', async () => {
    seedSinger(1);
    saveSession(session());
    fakeServer((c) => (c.method === 'PUT' ? { status: 507, body: { error: 'The server\'s storage is full.' } } : null));
    expect(await uploadProgress()).toEqual({ ok: false, error: 'The server\'s storage is full.' });
    expect(loadMeta().error).toMatch(/full/);
    fakeServer(() => ({ status: 401, body: { error: 'Your login has expired.', loggedOut: true, reason: 'expired' } }));
    await uploadProgress();
    expect(syncEnabled()).toBe(false);
    expect(loadProfile().shareProgress).toBe(true);
    expect(loadMeta().account).toBe('acc000000001'); // logging in again resumes
    saveSession(session());
    fakeServer(() => ({ status: 401, body: { error: 'Your account was removed.', loggedOut: true, reason: 'removed' } }));
    await uploadProgress();
    expect(loadProfile().shareProgress).toBe(false);
    expect(loadMeta().account).toBeUndefined();
  });

  it('suggests an account once (on Results), after a pass, to choir singers without one', () => {
    saveProfile({ ...DEFAULT_PROFILE, onboarded: true });
    expect(suggestAccount(true)).toBe(false); // no choir
    saveProfile({ ...DEFAULT_PROFILE, onboarded: true, choirCode: 'kammerchor' });
    expect(suggestAccount(false)).toBe(false);
    expect(suggestAccount(true)).toBe(true);
    expect(accountTipPending()).toBe(true);
    dismissAccountTip();
    expect(accountTipPending()).toBe(false);
    expect(suggestAccount(true)).toBe(false);
  });
});

describe('throttle (at most once a minute)', () => {
  it('runs soon, collapses bursts, and waits out the gap', () => {
    vi.useFakeTimers();
    let now = 0;
    const fn = vi.fn();
    const t = throttle(fn, 60_000, () => now);
    t(); t(); t();
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);
    now = 10_000;
    t(); t();
    vi.advanceTimersByTime(49_999);
    expect(fn).toHaveBeenCalledTimes(1);
    now = 60_000;
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    now = 200_000;
    t();
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
