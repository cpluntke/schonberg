import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetAllForTests, loadProfile, saveProfile } from './store';
import { fetchPresence, startPresence, PRESENCE_BEAT } from './presence';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
function mockFetch(body: unknown, status = 200) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
}
const sent = () => calls.filter((c) => c.init.method === 'POST').map((c) => JSON.parse(String(c.init.body)) as { id: string; voice: string; on: boolean });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  _resetAllForTests();
  vi.stubEnv('VITE_CHOIR_URL', '/schonberg/api');
  saveProfile({ ...loadProfile(), choirCode: 'kammerchor', voice: 'A' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('practising now', () => {
  it('the singing screen sends heartbeats with a random id (not the member token) and an "I left" at the end', () => {
    vi.useFakeTimers();
    mockFetch({ counts: {} });
    const stop = startPresence('A');
    vi.advanceTimersByTime(PRESENCE_BEAT * 2 + 10);
    stop();
    const s = sent();
    expect(s.map((x) => x.on)).toEqual([true, true, true, false]);
    expect(s.every((x) => x.voice === 'A' && /^[0-9a-f]{32}$/.test(x.id) && x.id === s[0].id)).toBe(true);
    expect(s[0].id).not.toBe(localStorage.getItem('sh:memberToken'));
    expect(localStorage.getItem('sh:presenceId')).toBeNull(); // (per tab only)
    expect(calls[0].url).toBe('/schonberg/api/choirs/kammerchor/presence');
    vi.advanceTimersByTime(PRESENCE_BEAT * 3);
    expect(sent()).toHaveLength(4); // stopped for good
  });

  it('nothing is sent without a choir, a choir server or a SATB voice', () => {
    mockFetch({});
    startPresence('other')();
    saveProfile({ ...loadProfile(), choirCode: undefined });
    startPresence('A')();
    vi.stubEnv('VITE_CHOIR_URL', '');
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    startPresence('A')();
    expect(calls).toHaveLength(0);
  });

  it('reads the counts, leaving this phone out, and cleans what comes back', async () => {
    mockFetch({ counts: { S: 2, A: -1, T: 'x', B: 1.7 } });
    expect(await fetchPresence()).toEqual({ S: 2, A: 0, T: 0, B: 1 });
    expect(calls[0].url).toMatch(/\/choirs\/kammerchor\/presence\?me=[0-9a-f]{32}$/);
    mockFetch({ error: 'x' }, 429);
    expect(await fetchPresence()).toBeNull();
  });
});
