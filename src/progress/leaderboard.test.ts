import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AttemptResult } from '../game/types';
import type { Section } from '../music/types';
import { _resetAllForTests, recordAttempt, saveProfile, loadProfile, snapshotReadiness } from './store';
import {
  computeMyEntry, decodeShareCode, encodeShareCode, getLeaderboardBackend, httpBackend, importShareCodes,
  localBackend, rankEntries, type LeaderboardEntry,
} from './leaderboard';

const DAY = 86_400_000;
const res = (accuracy: number, score: number): AttemptResult => ({
  accuracy, pitch: accuracy, rhythm: accuracy, score, maxCombo: 0,
  counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, notes: [], perMeasure: {}, insights: [],
});
const sections = ['s0', 's1'].map((id, index) => ({ id, index, label: id, startMeasure: 0, endMeasure: 0, start: 0, end: 0 })) as Section[];
const entry: LeaderboardEntry = {
  name: 'Zoë Müller', voice: 'A', pieceId: 'friede-auf-erden', readiness: 0.625, weeklyScore: 12345,
  streak: 6, improved: 0.25, updatedAt: 1_790_000_000_000,
};

beforeEach(() => { localStorage.clear(); _resetAllForTests(); });

describe('leaderboard', () => {
  it('share code roundtrip (unicode)', () => {
    const code = encodeShareCode(entry);
    expect(code).toMatch(/^SH1\.[A-Za-z0-9_-]+$/);
    expect(decodeShareCode(code)).toEqual(entry);
    expect(decodeShareCode(`My ranking: ${code} !`)).toEqual(entry);
    expect(decodeShareCode('SH1.garbage!!')).toBeNull();
    expect(decodeShareCode('hello')).toBeNull();
  });
  it('imports share codes into the local backend, newer wins', async () => {
    const older = encodeShareCode({ ...entry, readiness: 0.1, updatedAt: entry.updatedAt - 1000 });
    expect(importShareCodes('choir', `${encodeShareCode(entry)}\n${older}`)).toBe(2);
    const list = await localBackend.list('choir', 'friede-auf-erden');
    expect(list).toHaveLength(1);
    expect(list[0].readiness).toBe(0.625);
  });
  it('computeMyEntry', () => {
    saveProfile({ ...loadProfile(), name: 'Me', voice: 'T' });
    const now = new Date(2026, 9, 10, 12).getTime();
    snapshotReadiness('p', 'T', 0, now - 8 * DAY);
    recordAttempt('p', 'T', 's0', 1, res(0.9, 500), 30, now - DAY);
    recordAttempt('p', 'T', 's0', 1, res(0.95, 700), 30, now - DAY);
    recordAttempt('p', 'T', 's0', 2, res(0.9, 400), 30, now);
    recordAttempt('p', 'T', 's1', 1, res(0.5, 999), 30, now - 9 * DAY); // too old for weekly
    const e = computeMyEntry('p', 'T', sections, now);
    expect(e).toMatchObject({ name: 'Me', voice: 'T', pieceId: 'p', weeklyScore: 1100, streak: 2 });
    // Section levels not confirmed by a full run count half: s0 at level 2 of 4, of two sections.
    expect(e.readiness).toBeCloseTo(1 / 8);
    expect(e.improved).toBeCloseTo(0.125);
  });
  it('ranking', () => {
    const a = { ...entry, name: 'A', readiness: 0.5, streak: 10, improved: 0 };
    const b = { ...entry, name: 'B', readiness: 0.9, streak: 1, improved: 0.4 };
    expect(rankEntries([a, b], 'readiness')[0].name).toBe('B');
    expect(rankEntries([a, b], 'streak')[0].name).toBe('A');
    expect(rankEntries([a, b], 'improved')[0].name).toBe('B');
  });
  it('backend selection and http client', async () => {
    expect(getLeaderboardBackend().kind).toBe('local');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ entries: [entry, { junk: true }] }), { status: 200 });
    });
    const be = httpBackend('https://x.test/', fetchMock as unknown as typeof fetch);
    expect(await be.list('ab c')).toEqual([entry]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.test/choirs/ab%20c/entries');
    await be.put('ab c', entry);
    expect(fetchMock.mock.calls[1][0]).toBe('https://x.test/choirs/ab%20c/entries/Zo%C3%AB%20M%C3%BCller');
  });
});
