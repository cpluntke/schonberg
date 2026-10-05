import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  _resetAllForTests, DEFAULT_PROFILE, getProgress, loadCycle, loadProfile, progressKey, readinessHistory, saveCycle, saveProfile,
  snapshotReadiness, writeJSON, type FullRunProgress, type PieceProgress, type SectionProgress,
} from './store';
import { barsKey, getBars, type BarMap } from './bars';
import { wordsKey } from './words';
import {
  applyBackup, backupEnabled, backupKey, buildBackup, decodeBars, decodePiece, deleteBackup, encodeBars, encodePiece, loadMeta,
  mergeBars, mergeFull, mergeProfile, mergeProgress, mergeSection, restoreFromCode, shouldSuggestBackup, throttle, uploadBackup,
  type BackupData,
} from './backup';
import { encodeRestoreCode } from './backupCode';

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
});

describe('compact format', () => {
  it('round-trips sections, full runs, words and readiness (dates to the hour, results to the percent)', () => {
    const prog = piece({
      sections: { 's0-m1-8': sec({ level: 5, best: { 1: 0.913, 3: 0.8, 5: 0.86 }, attempts: 9, lastPassed: T + 3_599_999, lastPracticed: T - 5 * DAY, offBookDays: ['2026-09-01', '2026-09-02'] }) },
      totalAttempts: 30, bestScore: 1234.4,
      full: { level: 2, best: { 1: 0.9, 2: 0.85 }, attempts: 4, lastPracticed: T, lastPassed: T, toFix: { 3: ['s0-m1-8'] }, toFixLocks: { 3: true } },
    });
    const pc = encodePiece(prog, {}, { 's0-m1-8': { passed: 1, best: { 1: 0.9 }, at: T } }, ['2026-10-01', 0.4567]);
    const d = decodePiece('p', 'P1', JSON.parse(JSON.stringify(pc)))!;
    const s = d.progress.sections['s0-m1-8'];
    expect(s).toMatchObject({ level: 5, attempts: 9, lastPassed: T, lastPracticed: T - 5 * DAY, offBookDays: ['2026-09-01', '2026-09-02'] });
    expect(s.best).toEqual({ 1: 0.91, 3: 0.8, 5: 0.86 });
    expect(d.progress.full).toMatchObject({ level: 2, attempts: 4, toFix: { 3: ['s0-m1-8'] }, toFixLocks: { 3: true } });
    expect(d.progress).toMatchObject({ totalAttempts: 30, bestScore: 1234 });
    expect(d.words).toEqual({ 's0-m1-8': 1 });
    expect(d.readiness).toEqual(['2026-10-01', 0.457]);
    // Restoring the backup onto the phone it came from changes nothing (times rounded down, never later).
    expect(mergeProgress(prog, d.progress).sections['s0-m1-8'].lastPassed).toBe(T + 3_599_999);
  });

  it('bars: one character per bar and measure, gaps kept, capped', () => {
    const bars: BarMap = { 3: { ema: 0.92, n: 4, at: T }, 5: { ema: 0.31, mem: 0.5, n: 1, at: T + 1000 }, 6: { ema: 1, off: 0.9, n: 2, at: T } };
    const h = Math.floor((T + 1000) / 3_600_000);
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
    const { bytes } = buildBackup();
    console.info(`[backup size] 8 pieces × 10 sections × 80 bars: ${bytes} bytes`);
    expect(bytes).toBeLessThan(8 * 1024);
  });

  it('a typical singer (8 pieces, 6 sections and 60 bars each) needs under 6 KB', () => {
    seedSinger(8, 6, 60);
    const { bytes } = buildBackup();
    console.info(`[backup size] 8 pieces × 6 sections × 60 bars: ${bytes} bytes`);
    expect(bytes).toBeLessThan(6 * 1024);
  });

  it('a very busy singer is capped well under the server limit', () => {
    seedSinger(70, 30, 300);
    const { data, bytes } = buildBackup();
    console.info(`[backup size] 70 pieces × 30 sections × 300 bars, capped: ${Object.keys(data.p).length} pieces, ${bytes} bytes`);
    expect(Object.keys(data.p).length).toBeGreaterThanOrEqual(15);
    expect(bytes).toBeLessThan(28 * 1024); // the server takes 32 KB
    // Levels before bars: past the budget the pieces go without their bar summary.
    expect(Object.values(data.p).filter((pc) => !pc.b).length).toBeGreaterThan(0);
    expect(data.p['piece0|P2']).toBeTruthy();
  });

  it('never includes the attempt log, recordings or the readiness history', () => {
    seedSinger(1);
    writeJSON('sh:log', [{ at: T, pieceId: 'piece0', partId: 'P2', sectionId: 'x', level: 1, accuracy: 1, score: 1, passed: true }]);
    snapshotReadiness('piece0', 'P2', 0.2, T - DAY);
    snapshotReadiness('piece0', 'P2', 0.3, T);
    const json = JSON.stringify(buildBackup().data);
    expect(json).not.toContain('"sh:log"');
    expect(json).not.toContain('accuracy');
    expect(buildBackup().data.p['piece0|P2'].r).toEqual([expect.any(String), 0.3]);
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
  it('a backup made on phone A restores everything essential on an empty phone B', () => {
    seedSinger(3);
    const { data } = buildBackup();
    const snapshotA = { prog: getProgress('piece1', 'P2')!, bars: getBars('piece1', 'P2') };
    // Phone B: empty.
    localStorage.clear();
    _resetAllForTests();
    const r = applyBackup(JSON.parse(JSON.stringify(data)));
    expect(r).toEqual({ pieces: 3, profile: true, cycle: true });
    const p = getProgress('piece1', 'P2')!;
    for (const [id, s] of Object.entries(snapshotA.prog.sections)) {
      expect(p.sections[id].level).toBe(s.level);
      expect(p.sections[id].lastPassed ?? 0).toBeGreaterThan((s.lastPassed ?? 0) - 3_600_000);
    }
    expect(p.full).toMatchObject({ level: 2, toFix: { 3: ['s2-m17-24', 's5-m41-48'] } });
    expect(Object.keys(getBars('piece1', 'P2'))).toHaveLength(Object.keys(snapshotA.bars).length);
    expect(loadProfile()).toMatchObject({ name: 'Anna Example', voice: 'A', choirCode: 'kammerchor', latencySource: 'learned' });
    expect(loadCycle()).toMatchObject({ name: 'Spring concert', concertDate: '2027-03-20' });
    expect(readinessHistory('piece1', 'P2')).toHaveLength(1);
    expect(localStorage.getItem('sh:part:piece2')).toBe('P2');
    expect(localStorage.getItem('sh:memberToken')).toBe('a'.repeat(32));
  });

  it('does not lower the progress already on the phone, nor replace its programme', () => {
    seedSinger(1);
    const { data } = buildBackup();
    const id = 's0-m1-8';
    const p = getProgress('piece0', 'P2')!;
    // Since the backup this phone got further.
    p.sections[id] = { ...p.sections[id], level: 5, offBookDays: ['2026-09-20', '2026-09-22'] };
    writeJSON(progressKey('piece0', 'P2'), p);
    saveCycle({ name: 'Mine', pieceIds: ['x'] });
    // The backup knows less about this section.
    data.p['piece0|P2'].s[id] = [1, 0, 0, 1, [50]];
    applyBackup(data);
    expect(getProgress('piece0', 'P2')!.sections[id].level).toBe(5);
    expect(loadCycle().name).toBe('Mine');
  });

  it('rejects damaged backups', () => {
    expect(() => applyBackup(null)).toThrow(/damaged/);
    expect(() => applyBackup({ v: 1 })).toThrow(/damaged/);
    expect(applyBackup({ v: 1, p: { nopipe: { s: {} }, 'a|b': 'junk' } } as unknown as BackupData).pieces).toBe(0);
  });
});

describe('sync with the server', () => {
  type Call = { method: string; auth: string; body: Record<string, unknown> | null };
  let calls: Call[];
  let server: { rev: number; data: unknown } | null;
  function fakeServer(over?: (c: Call) => { status: number; body: unknown } | null) {
    calls = [];
    server = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const c: Call = { method: init.method ?? 'GET', auth: (init.headers as Record<string, string>).Authorization, body: init.body ? JSON.parse(init.body as string) : null };
      calls.push(c);
      const o = over?.(c);
      const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (o) return reply(o.status, o.body);
      if (c.method === 'GET') return server ? reply(200, { rev: server.rev, updatedAt: T, data: server.data }) : reply(404, { error: 'No backup' });
      if (c.method === 'DELETE') { server = null; return reply(200, { ok: true }); }
      const base = c.body!.baseRev;
      if (server && base !== server.rev) return reply(409, { error: 'changed', backup: { rev: server.rev, data: server.data } });
      server = { rev: (server?.rev ?? (base as number | undefined) ?? 0) + 1, data: c.body!.data };
      return reply(200, { ok: true, rev: server.rev, updatedAt: T });
    }));
  }

  it('is on by default only for singers in a choir', () => {
    expect(backupEnabled({ ...DEFAULT_PROFILE })).toBe(false);
    expect(backupEnabled({ ...DEFAULT_PROFILE, choirCode: 'k' })).toBe(true);
    expect(backupEnabled({ ...DEFAULT_PROFILE, choirCode: 'k', backup: false })).toBe(false);
    expect(backupEnabled({ ...DEFAULT_PROFILE, backup: true })).toBe(true);
  });

  it('uploads with the key as a bearer token, skips when nothing changed, and keeps the key out of the sh: keys', async () => {
    fakeServer();
    seedSinger(2);
    expect((await uploadBackup()).ok).toBe(true);
    const key = backupKey()!;
    expect(calls[0].auth).toBe(`Bearer ${key}`);
    expect(calls[0].body!.baseRev).toBeUndefined();
    expect(loadMeta()).toMatchObject({ rev: 1, error: null });
    expect(await uploadBackup()).toEqual({ ok: true, skipped: true });
    expect(calls).toHaveLength(1);
    const p = getProgress('piece0', 'P2')!;
    p.sections['s0-m1-8'].level = 4;
    writeJSON(progressKey('piece0', 'P2'), p);
    await uploadBackup();
    expect(calls).toHaveLength(2);
    expect(calls[1].body!.baseRev).toBe(1);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('sh:') && localStorage.getItem(k)!.includes(key))).toEqual([]);
  });

  it('when another phone wrote in between, merges its copy first, then uploads', async () => {
    fakeServer();
    seedSinger(1);
    await uploadBackup();
    // Another phone with the same key reached level 4 in a section and wrote rev 2.
    const other = JSON.parse(JSON.stringify(server!.data)) as BackupData;
    other.p['piece0|P2'].s['s0-m1-8'][0] = 4;
    server = { rev: 2, data: other };
    const p = getProgress('piece0', 'P2')!;
    p.sections['s1-m9-16'].level = 5;
    writeJSON(progressKey('piece0', 'P2'), p);
    expect((await uploadBackup()).ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'PUT', 'PUT']);
    expect(getProgress('piece0', 'P2')!.sections['s0-m1-8'].level).toBe(4);
    expect(getProgress('piece0', 'P2')!.sections['s1-m9-16'].level).toBe(5);
    expect(server!.rev).toBe(3);
    const up = server!.data as BackupData;
    expect(up.p['piece0|P2'].s['s0-m1-8'][0]).toBe(4);
    expect(up.p['piece0|P2'].s['s1-m9-16'][0]).toBe(5);
  });

  it('restore from code: pulls, merges, adopts the key and deletes this phone\'s old backup', async () => {
    fakeServer();
    seedSinger(2);
    await uploadBackup();
    const keyA = backupKey()!;
    const code = encodeRestoreCode(keyA);
    // Phone B: had its own (empty) key.
    localStorage.clear();
    _resetAllForTests();
    const keyB = backupKey(true)!;
    const serverCopy = server;
    const r = await restoreFromCode(code.toLowerCase());
    expect(r.pieces).toBe(2);
    expect(backupKey()).toBe(keyA);
    expect(calls.find((c) => c.method === 'DELETE')!.auth).toBe(`Bearer ${keyB}`);
    expect(loadProfile()).toMatchObject({ name: 'Anna Example', backup: true });
    expect(getProgress('piece1', 'P2')!.full!.level).toBe(2);
    expect(serverCopy).toBeTruthy();
    await expect(restoreFromCode('ABCD')).rejects.toThrow(/28 characters/);
  });

  it('an unknown code says so; delete removes the server copy and turns backups off', async () => {
    fakeServer();
    await expect(restoreFromCode(encodeRestoreCode('0123456789ABCDEFGHJKMNPQRS'))).rejects.toThrow(/No backup found/);
    seedSinger(1);
    saveProfile({ ...loadProfile(), backup: true });
    await uploadBackup();
    await deleteBackup();
    expect(calls.at(-1)!.method).toBe('DELETE');
    expect(loadProfile().backup).toBe(false);
    expect(loadMeta()).toEqual({});
  });

  it('remembers server errors (e.g. full) and retries on the next sync', async () => {
    fakeServer((c) => (c.method === 'PUT' ? { status: 507, body: { error: 'The server\'s backup space is full.' } } : null));
    seedSinger(1);
    expect(await uploadBackup()).toEqual({ ok: false, error: 'The server\'s backup space is full.' });
    expect(loadMeta().error).toMatch(/full/);
    await uploadBackup();
    expect(calls).toHaveLength(2);
  });

  it('suggests backups once, after a pass, to singers without a choir', () => {
    saveProfile({ ...DEFAULT_PROFILE, onboarded: true });
    expect(shouldSuggestBackup(false)).toBe(false);
    expect(shouldSuggestBackup(true)).toBe(true);
    expect(shouldSuggestBackup(true)).toBe(false);
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
