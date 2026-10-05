import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetAllForTests, exportBackup, loadProfile, saveProfile } from './store';
import {
  _resetSessionStateForTests, acceptInvite, createInvite, fetchPeople, inviteLink, leaveChoir, loadSession, loggedOutNotice, login, logout,
  LOGGED_OUT_ELSEWHERE, refreshSession, refreshSessionSoon, rememberedInvite, saveSession, sessionFor, superCreate, type Session,
} from './choir';
import { parseHash, href } from '../ui/router';

const DAY = 86_400_000;
const account = { id: 'a1b2c3d4e5f6', name: 'Clara', role: 'admin' as const, voices: [], createdAt: 1 };
const session = (over: Partial<Session> = {}): Session => ({ token: 'tok-' + 'x'.repeat(40), code: 'kammerchor', choirName: 'Kammerchor', account, expiresAt: Date.now() + 30 * DAY, ...over });

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
function mockFetch(reply: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = reply(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
}
const headers = (c: Call) => (c.init.headers ?? {}) as Record<string, string>;

beforeEach(() => {
  localStorage.clear();
  _resetAllForTests();
  _resetSessionStateForTests();
  vi.stubEnv('VITE_CHOIR_URL', '/schonberg/api');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('choir accounts client', () => {
  it('logs in: keeps the session token (not the password) and sends it as a bearer token', async () => {
    mockFetch((url) => (url.endsWith('/login') ? { body: session() } : { body: { accounts: [], invites: [], legacy: {}, you: null } }));
    const s = await login('KammerChor', 'Clara', 'password-123');
    expect(calls[0].url).toBe('/schonberg/api/choirs/kammerchor/login');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: 'Clara', password: 'password-123' });
    expect(loadSession()?.token).toBe(s.token);
    expect(JSON.stringify(localStorage)).not.toContain('password-123');
    // the login is not part of a backup file
    expect(exportBackup()).not.toContain(s.token);
    await fetchPeople('kammerchor', { bearer: s.token });
    expect(headers(calls[1]).Authorization).toBe(`Bearer ${s.token}`);
    expect(headers(calls[1])['X-Super-Admin']).toBeUndefined();
    expect(sessionFor('kammerchor')?.account.name).toBe('Clara');
    expect(sessionFor('otherchoir')).toBeNull();
  });

  it('forgets a session the server ended (401) and an expired one', async () => {
    saveSession(session());
    mockFetch(() => ({ status: 401, body: { error: "You've been logged out. Log in again.", loggedOut: true } }));
    await expect(fetchPeople('kammerchor', { bearer: session().token })).rejects.toThrow('logged out');
    expect(loadSession()).toBeNull();
    saveSession(session({ expiresAt: Date.now() - 1 }));
    expect(loadSession()).toBeNull();
    saveSession(session());
    expect(await refreshSession()).toBeNull();
    expect(loadSession()).toBeNull();
  });

  it('refreshSession picks up a changed role or voices', async () => {
    saveSession(session());
    const { token: _t, ...fresh } = session({ account: { ...account, role: 'lead', voices: ['A'] } });
    mockFetch(() => ({ body: fresh }));
    const s = await refreshSession();
    expect(s?.account.voices).toEqual(['A']);
    expect(loadSession()?.account.role).toBe('lead');
    expect(loadSession()?.token).toBe(session().token);
  });

  it('logout clears the phone first, then tells the server', async () => {
    saveSession(session());
    mockFetch(() => ({ body: { ok: true } }));
    await logout();
    expect(loadSession()).toBeNull();
    expect(calls[0].url).toBe('/schonberg/api/session');
    expect(calls[0].init.method).toBe('DELETE');
    expect(headers(calls[0]).Authorization).toContain('Bearer ');
  });

  it('accepting an invite logs in; invite links carry the token in the #fragment only', async () => {
    mockFetch(() => ({ status: 201, body: session({ account: { ...account, name: 'Anna', role: 'lead', voices: ['A'] } }) }));
    await acceptInvite('invite-token-0123456789abcdef', 'Anna', 'password-123');
    expect(calls[0].url).toBe('/schonberg/api/invites/accept');
    expect(calls[0].url).not.toContain('invite-token');
    expect(loadSession()?.account.voices).toEqual(['A']);
    expect(inviteLink('abc_DEF-123')).toMatch(/#\/invite\/abc_DEF-123$/);
  });

  it('remembers invite links this phone made, until they expire', async () => {
    const inv = { id: 'i1i1i1i1i1i1', role: 'lead', voices: ['T'], note: 'Tom', createdAt: 1, expiresAt: Date.now() + 7 * DAY, by: 'Clara' };
    mockFetch(() => ({ status: 201, body: { token: 'tok-invite-0123456789abc', invite: inv } }));
    await createInvite('kammerchor', { bearer: session().token }, 'lead', ['T'], 'Tom');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ role: 'lead', voices: ['T'], note: 'Tom' });
    expect(rememberedInvite('i1i1i1i1i1i1')).toBe('tok-invite-0123456789abc');
    expect(rememberedInvite('unknown')).toBeNull();
    mockFetch(() => ({ status: 201, body: { code: 'neu', name: 'Neu', token: 'tok-admin-0123456789abcd', invite: { ...inv, id: 'i2i2i2i2i2i2', expiresAt: Date.now() - 1 } } }));
    await superCreate('super-pw', 'neu', 'Neu', 'Clara');
    expect(headers(calls[0])['X-Super-Admin']).toBe('super-pw');
    expect(headers(calls[0]).Authorization).toBeUndefined();
    expect(rememberedInvite('i2i2i2i2i2i2')).toBeNull();
  });

  it('leaving the choir logs out of that choir only', async () => {
    mockFetch(() => ({ body: { ok: true } }));
    saveProfile({ ...loadProfile(), choirCode: 'otherchoir' });
    saveSession(session());
    leaveChoir();
    expect(loadSession()).not.toBeNull();
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    leaveChoir();
    expect(loadSession()).toBeNull();
  });

  it('routes #/invite/<token>', () => {
    expect(parseHash('#/invite/abc_DEF-123')).toEqual({ name: 'invite', token: 'abc_DEF-123' });
    expect(parseHash('#/invite')).toEqual({ name: 'invite' });
    expect(href({ name: 'invite', token: 'abc' })).toBe('#/invite/abc');
  });

  it('a login ended elsewhere (401) leaves a notice until the next login', async () => {
    saveSession(session());
    mockFetch((url) => (url.endsWith('/login') ? { body: session({ token: 'tok-new-' + 'y'.repeat(40) }) } : { status: 401, body: { error: 'x', loggedOut: true } }));
    await expect(fetchPeople('kammerchor', { bearer: session().token })).rejects.toThrow();
    expect(loadSession()).toBeNull();
    expect(loggedOutNotice()).toBe(LOGGED_OUT_ELSEWHERE);
    await login('kammerchor', 'Clara', 'password-123');
    expect(loggedOutNotice()).toBeNull();
    // a 401 for a token that isn't this phone's current login changes nothing
    await expect(fetchPeople('kammerchor', { bearer: 'some-other-token-0123456789' })).rejects.toThrow();
    expect(loadSession()).not.toBeNull();
    expect(loggedOutNotice()).toBeNull();
  });

  it('a new login (e.g. another choir) ends the previous one on the server', async () => {
    const old = session({ code: 'otherchoir', token: 'tok-old-' + 'z'.repeat(40) });
    saveSession(old);
    mockFetch((url) => (url.endsWith('/invites/accept') ? { status: 201, body: session() } : { body: { ok: true } }));
    await acceptInvite('invite-token-0123456789abcdef', 'Clara', 'password-123');
    await new Promise((r) => setTimeout(r, 0));
    expect(loadSession()?.code).toBe('kammerchor');
    const del = calls.find((c) => c.url === '/schonberg/api/session' && c.init.method === 'DELETE');
    expect(del && headers(del).Authorization).toBe(`Bearer ${old.token}`);
  });

  it('refreshSessionSoon asks the server at most every 20 s', async () => {
    saveSession(session());
    const { token: _t, ...fresh } = session();
    mockFetch(() => ({ body: fresh }));
    refreshSessionSoon();
    refreshSessionSoon();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.filter((c) => c.url === '/schonberg/api/session')).toHaveLength(1);
  });
});
