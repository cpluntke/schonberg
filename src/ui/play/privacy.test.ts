import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetAllForTests, loadProfile, saveProfile } from '../../progress/store';
import { retryPrivacyRemovals, setBoardHidden, setSharing } from './privacy';

type Call = { url: string; method: string };
let calls: Call[] = [];
let status = 200;
beforeEach(() => {
  localStorage.clear();
  _resetAllForTests();
  vi.stubEnv('VITE_CHOIR_URL', '/schonberg/api');
  vi.stubEnv('VITE_LEADERBOARD_URL', '/schonberg/api');
  calls = [];
  status = 200;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    return new Response(JSON.stringify(status < 400 ? { ok: true } : { error: 'x' }), { status, headers: { 'Content-Type': 'application/json' } });
  }));
  saveProfile({ ...loadProfile(), name: 'Anna Maria Magdalena von Hohenzollern-Sigmaringen', choirCode: 'kammerchor', shareProgress: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('privacy switches: what is on the server goes, retried until it did', () => {
  it('leaving the board deletes the entries under the (40-character) board name', async () => {
    expect(await setBoardHidden(true)).toBe(true);
    expect(loadProfile().boardHidden).toBe(true);
    expect(calls.map((c) => [c.method, decodeURIComponent(c.url)])).toEqual([['DELETE', '/schonberg/api/choirs/kammerchor/entries/Anna Maria Magdalena von Hohenzollern-Si']]);
  });

  it('offline: the switch holds, the removal is owed and done when the server is back', async () => {
    status = 503;
    expect(await setSharing(false)).toBe(false);
    expect(loadProfile()).toMatchObject({ shareProgress: false, shareOptOut: true });
    status = 200;
    calls = [];
    expect(await retryPrivacyRemovals()).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['DELETE']);
    calls = [];
    expect(await retryPrivacyRemovals()).toBe(true);
    expect(calls).toHaveLength(0); // nothing owed any more
  });

  it('a refusal (nothing shared under that name) ends the retries; switching back on cancels an owed removal', async () => {
    status = 404;
    expect(await setSharing(false)).toBe(true);
    status = 503;
    await setBoardHidden(true);
    await setBoardHidden(false);
    calls = [];
    expect(await retryPrivacyRemovals()).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
