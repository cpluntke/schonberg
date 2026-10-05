import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetAllForTests, DEFAULT_PROFILE, saveProfile } from '../../progress/store';
import { saveSession, type Session } from '../../progress/choir';
import { shareMyProgress, shareError } from './shareProgress';

const session = (): Session => ({
  token: 't'.repeat(43), code: 'kammerchor', choirName: 'Kammerchor', expiresAt: Date.now() + 86_400_000,
  account: { id: 'acc000000001', name: 'Anna', role: 'member', voices: [], createdAt: 1 },
});
let calls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  localStorage.clear();
  _resetAllForTests();
  vi.stubEnv('VITE_CHOIR_URL', '/schonberg/api');
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
  saveProfile({ ...DEFAULT_PROFILE, name: 'Anna', voice: 'A', onboarded: true, choirCode: 'kammerchor', shareProgress: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('sharing with the section lead and the choir account', () => {
  it('anonymous: shares with the phone\'s member token', async () => {
    await shareMyProgress(true);
    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('logged in: waits until this phone\'s progress is confirmed as the account\'s (no move during a merge question)', async () => {
    saveSession(session());
    await shareMyProgress(true);
    expect(calls).toHaveLength(0);
    localStorage.setItem('schonberg:syncMeta', JSON.stringify({ account: 'acc000000001', rev: 1 }));
    localStorage.setItem('schonberg:syncAsk', JSON.stringify({ account: 'acc000000001', accountName: 'Anna', here: 'Ben', pieces: 1, updatedAt: 1 }));
    await shareMyProgress(true);
    expect(calls).toHaveLength(0);
    localStorage.removeItem('schonberg:syncAsk');
    await shareMyProgress(true);
    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('logged out after sharing with the account: pauses instead of sharing anonymously', async () => {
    localStorage.setItem('schonberg:syncMeta', JSON.stringify({ account: 'acc000000001', rev: 1 }));
    await shareMyProgress(true);
    expect(calls).toHaveLength(0);
    expect(shareError()).toMatch(/Log in again/);
  });
});
