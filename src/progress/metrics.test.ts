import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetUsageForTests, attemptsBucket, browserSaysDoNotTrack, daysBucket, durationBucket, errorHash, flushUsage, installId, latencyBucket,
  localDay, pendingDays, setUsageStats, track, trackError, trackRun, trackStep, usageSnapshot, usageStatsOn,
} from './metrics';
import { memberToken } from './choir';
import { exportBackup } from './store';
import { metricsCsv, rangeFlags, sharedRange, sumKeys, type MetricsDay } from './insights';

const DAY = 86_400_000;
const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime(); // local noon, 5 Oct 2026
const BASE = 'https://choir.example/schonberg/api';

function setDnt(v: string | null) {
  Object.defineProperty(navigator, 'doNotTrack', { value: v, configurable: true });
}

describe('anonymous usage statistics', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    _resetUsageForTests();
    setDnt(null);
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, accepted: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); setDnt(null); });

  it('batches a day of events into one summary and sends finished days at most once a day', async () => {
    track('run.section.L1', 1, T0);
    track('run.section.L1', 1, T0 + 1000);
    track('sec.practice', 42.4, T0);
    expect(usageSnapshot(T0).today).toEqual({ 'run.section.L1': 2, 'sec.practice': 42 });
    // Nothing finished yet on the same day: nothing is sent.
    expect(await flushUsage(T0 + 2000, BASE)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // Next day: yesterday goes out in one request, today keeps counting.
    track('feat.lyrics', 1, T0 + DAY);
    expect(await flushUsage(T0 + DAY, BASE)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/metrics`);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ v: 1, id: installId(), days: [{ day: localDay(T0), c: { 'run.section.L1': 2, 'sec.practice': 42 } }] });
    expect(pendingDays(T0 + DAY)).toEqual([]);
    expect(usageSnapshot(T0 + DAY).today).toEqual({ 'feat.lyrics': 1 });
    // Same day again (e.g. the page is hidden): no second request.
    track('run.full.L3', 1, T0 - DAY);
    expect(await flushUsage(T0 + DAY + 5000, BASE)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the summary when sending fails and drops days older than a week', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('offline'); });
    track('run.section.L2', 1, T0);
    expect(await flushUsage(T0 + DAY, BASE)).toBe(false);
    expect(pendingDays(T0 + DAY).length).toBe(1);
    // Tried today already: tomorrow again.
    expect(await flushUsage(T0 + DAY + 1, BASE)).toBe(false);
    expect(await flushUsage(T0 + 2 * DAY, BASE)).toBe(true);
    track('run.section.L2', 1, T0);
    expect(await flushUsage(T0 + 9 * DAY, BASE)).toBe(false); // older than a week: dropped, nothing to send
    expect(pendingDays(T0 + 9 * DAY)).toEqual([]);
  });

  it('opting out stops counting and deletes what is pending; nothing is sent', async () => {
    track('run.section.L1', 1, T0);
    setUsageStats(false);
    expect(usageStatsOn()).toBe(false);
    expect(pendingDays(T0 + DAY)).toEqual([]);
    track('run.section.L1', 1, T0);
    trackRun({ kind: 'section', level: 1, passed: true, counted: true, seconds: 30 }, T0);
    expect(usageSnapshot(T0).today).toEqual({});
    expect(await flushUsage(T0 + DAY, BASE)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    setUsageStats(true);
    track('run.section.L1', 1, T0);
    expect(usageSnapshot(T0).today).toEqual({ 'run.section.L1': 1 });
  });

  it('honours Do Not Track by defaulting to off, unless the singer switches it on', () => {
    setDnt('1');
    expect(browserSaysDoNotTrack()).toBe(true);
    expect(usageStatsOn()).toBe(false);
    track('run.section.L1', 1, T0);
    expect(usageSnapshot(T0).today).toEqual({});
    setUsageStats(true);
    expect(usageStatsOn()).toBe(true);
    setDnt('0');
    setUsageStats(false);
    expect(usageStatsOn()).toBe(false);
  });

  it('uses its own random install id, never the member token, and keeps it out of backups', () => {
    const id = installId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(installId()).toBe(id);
    expect(id).not.toBe(memberToken());
    track('run.section.L1');
    expect(exportBackup()).not.toContain(id);
    expect(exportBackup()).not.toContain('run.section.L1');
  });

  it('turns a run into counters (modes, quality, delay bucket once a day, attempts to pass)', () => {
    const notes = [{ sec: 0.1, hit: true }, { sec: 0.2, hit: false }, { sec: 2, hit: true }];
    trackRun({ kind: 'section', level: 2, passed: false, counted: true, seconds: 31, triesKey: 'p|S|s1', display: 'score', notes,
      delaySuggested: true, latency: { ms: 120, source: 'learned' } }, T0);
    trackRun({ kind: 'section', level: 2, passed: true, counted: true, seconds: 29, triesKey: 'p|S|s1', display: 'fullscore',
      latency: { ms: 160, source: 'measured' }, full: undefined }, T0);
    trackRun({ kind: 'full', level: 3, passed: true, counted: true, seconds: 100, full: { counted: true, toFix: 2, blocked: false }, rehearsalReadyAfterDays: 5 }, T0);
    const c = usageSnapshot(T0).today;
    expect(c).toMatchObject({
      'run.section.L2': 2, 'pass.section.L2': 1, 'run.full.L3': 1, 'pass.full.L3': 1, 'sec.practice': 160,
      'feat.score': 1, 'feat.fullscore': 1, 'acc.xs.n': 2, 'acc.xs.hit': 1, 'acc.l.n': 1, 'acc.l.hit': 1,
      'q.runs': 3, 'q.delay_suggested': 1, 'att2pass.L2.2': 1, 'full.tofix': 1, 't2rr.d4_7': 1,
      'onb.first_run': 1, 'onb.first_pass': 1,
    });
    // One delay bucket per day (the latest).
    expect(Object.keys(c).filter((k) => k.startsWith('lat.'))).toEqual(['lat.measured.150']);
    // One-time steps count once per install.
    trackStep('first_run');
    expect(usageSnapshot(T0).today['onb.first_run']).toBe(1);
  });

  it('counts JS errors by a short hash and caps distinct hashes per day', () => {
    for (let i = 0; i < 25; i++) trackError(new Error(`boom kind ${String.fromCharCode(97 + i)}`));
    trackError(new Error('boom kind a'));
    const c = usageSnapshot().today;
    expect(c['err.js']).toBe(26);
    expect(Object.keys(c).filter((k) => k.startsWith('jserr.')).length).toBe(10);
    expect(errorHash('TypeError: x is 12')).toBe(errorHash('TypeError: x is 345'));
    expect(JSON.stringify(c)).not.toContain('boom');
  });

  it('buckets', () => {
    expect([durationBucket(0.1), durationBucket(0.3), durationBucket(1), durationBucket(3)]).toEqual(['xs', 's', 'm', 'l']);
    expect([latencyBucket(10), latencyBucket(99), latencyBucket(250), latencyBucket(900)]).toEqual(['0', '50', '200', '300']);
    expect([attemptsBucket(1), attemptsBucket(4), attemptsBucket(7), attemptsBucket(40)]).toEqual(['1', '4_5', '6_10', '11p']);
    expect([daysBucket(0), daysBucket(2), daysBucket(14), daysBucket(99)]).toEqual(['d0_1', 'd2_3', 'd8_14', 'd31p']);
  });
});

describe('shared voice range and insights helpers', () => {
  it('shares the steady range, and the reach only when it contains it', () => {
    expect(sharedRange({})).toBeUndefined();
    expect(sharedRange({ rangeLow: 70, rangeHigh: 60 })).toBeUndefined();
    expect(sharedRange({ rangeLow: 55, rangeHigh: 74, rangeReachLow: 52, rangeReachHigh: 77, rangeAt: 5 })).toEqual({ lo: 55, hi: 74, reachLo: 52, reachHi: 77, at: 5 });
    expect(sharedRange({ rangeLow: 55, rangeHigh: 74, rangeReachLow: 57, rangeReachHigh: 77 })).toEqual({ lo: 55, hi: 74 });
  });

  it('flags notes outside the steady range', () => {
    expect(rangeFlags({ name: 'A', measured: true, lo: 55, hi: 67, reachHi: 70 }, [53, 69])).toEqual([
      'top A4 above steady range (within reach)', 'bottom F3 below steady range']);
    expect(rangeFlags({ name: 'A', measured: false }, [53, 69])).toEqual([]);
  });

  it('exports CSV and sums counters', () => {
    const days: MetricsDay[] = [
      { day: '2026-10-01', installs: 2, c: { 'run.section.L1': 3 }, u: { 'feat.score': 2 }, tech: { 'os.ios': 2 }, jserr: {}, wau: 2, mau: 2 },
      { day: '2026-10-02', installs: 1, c: { 'run.full.L3': 1 }, u: {}, tech: {}, jserr: {} },
    ];
    expect(sumKeys(days, (k) => k.startsWith('run.'))).toBe(4);
    const csv = metricsCsv(days).trim().split('\n');
    expect(csv[0]).toBe('day,installs,wau,mau,return_base,return_back,c:run.full.L3,c:run.section.L1,installs_using:feat.score,tech:os.ios');
    expect(csv[1]).toBe('2026-10-01,2,2,2,,,0,3,2,2');
    expect(csv[2]).toBe('2026-10-02,1,,,,,1,0,0,0');
  });
});
