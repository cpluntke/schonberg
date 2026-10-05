import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetAllForTests, exportBackup, loadCycle, loadProfile, saveProfile } from './store';
import {
  _resetSessionStateForTests, acceptInvite, createInvite, fetchPeople, inviteLink, leaveChoir, loadSession, loggedOutNotice, login, logout,
  LOGGED_OUT_ELSEWHERE, refreshSession, refreshSessionSoon, rememberedInvite, saveSession, sessionFor, superCreate, type Session,
  signUp, shareProgress, deleteMyAccount, lastLogout, dismissLogout, syncChoir, choirPieceId, localPieceId, fetchLibrary, addLibraryPiece,
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
    mockFetch((url) => (url.endsWith('/login') ? { body: session({ token: 'tok-new-' + 'y'.repeat(40) }) } : { status: 401, body: { loggedOut: true } }));
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

  it('members sign up with the choir code (no invite) and their session is kept like any other', async () => {
    const member = { ...account, id: 'm00000000001', name: 'Anna', role: 'member' as const };
    mockFetch(() => ({ status: 201, body: { token: 'tok-' + 'm'.repeat(40), code: 'kammerchor', choirName: 'Kammerchor', account: member, expiresAt: Date.now() + 30 * DAY } }));
    const s = await signUp('Kammerchor', 'Anna', 'password-123');
    expect(calls[0].url).toBe('/schonberg/api/choirs/kammerchor/members');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: 'Anna', password: 'password-123' });
    expect(loadSession()).toMatchObject({ token: s.token, account: { role: 'member' } });
    expect(exportBackup()).not.toContain(s.token);
    // Deleting the account forgets the session here too.
    mockFetch(() => ({ body: { ok: true } }));
    await deleteMyAccount('password-123');
    expect(headers(calls[0]).Authorization).toBe(`Bearer ${s.token}`);
    expect(loadSession()).toBeNull();
  });

  it('logged in, shared progress goes with the account (its name, the session) and still names this phone', async () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    mockFetch(() => ({ body: { ok: true, name: 'Anna' } }));
    await shareProgress('kammerchor', 'Anni', 'A', {});
    expect(calls[0].url).toBe('/schonberg/api/choirs/kammerchor/progress/Anni');
    expect(headers(calls[0]).Authorization).toBeUndefined();
    const tokenHeader = headers(calls[0])['X-Member-Token'];
    expect(tokenHeader).toBeTruthy();
    saveSession(session({ account: { ...account, id: 'm00000000001', name: 'Anna', role: 'member' } }));
    await shareProgress('kammerchor', 'Anni', 'A', {});
    expect(calls[1].url).toBe('/schonberg/api/choirs/kammerchor/progress/Anna');
    expect(headers(calls[1]).Authorization).toMatch(/^Bearer /);
    // The phone's token goes along once, so the server can move this phone's anonymous entry to the account.
    expect(headers(calls[1])['X-Member-Token']).toBe(tokenHeader);
  });

  it('why a login ended: expired or password changed keep sharing (paused); removed turns it off and forgets the account', async () => {
    const reasons: [string, string][] = [['expired', 'Your login has expired. Log in again.'], ['password', 'Your password was changed.'], ['removed', 'Your account was removed from this choir.']];
    for (const [reason, error] of reasons) {
      saveProfile({ ...loadProfile(), choirCode: 'kammerchor', shareProgress: true });
      localStorage.setItem('schonberg:syncMeta', JSON.stringify({ account: 'a1b2c3d4e5f6', rev: 3 }));
      saveSession(session());
      mockFetch(() => ({ status: 401, body: { error, loggedOut: true, reason } }));
      expect(await refreshSession()).toBeNull();
      expect(loadSession()).toBeNull();
      expect(loggedOutNotice()).toBe(error);
      const gone = reason === 'removed';
      expect(loadProfile().shareProgress).toBe(!gone);
      expect(localStorage.getItem('schonberg:syncMeta') === null).toBe(gone);
    }
  });

  it('deleting my account turns sharing off and withdraws an anonymous entry', async () => {
    saveProfile({ ...loadProfile(), name: 'Anna', choirCode: 'kammerchor', shareProgress: true });
    saveSession(session({ account: { ...account, role: 'member' } }));
    mockFetch(() => ({ body: { ok: true } }));
    await deleteMyAccount('password-123');
    expect(loadProfile().shareProgress).toBe(false);
    expect(loadSession()).toBeNull();
    expect(loggedOutNotice()).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    const w = calls.find((c) => c.url.endsWith('/progress/Anna'))!;
    expect(w.init.method).toBe('DELETE');
    expect(headers(w).Authorization).toBeUndefined();
    expect(headers(w)['X-Member-Token']).toBeTruthy();
  });

  it('why the login ended is kept (for Home and Settings after a reload) until the next login or dismissal', async () => {
    saveSession(session());
    mockFetch((url) => (url.endsWith('/login') ? { body: session({ token: 'tok-new-' + 'z'.repeat(40) }) } : { status: 401, body: { error: 'Your login has expired. Log in again.', loggedOut: true, reason: 'expired' } }));
    await refreshSession();
    expect(lastLogout()).toEqual({ reason: 'expired', message: 'Your login has expired. Log in again.', code: 'kammerchor', name: 'Clara' });
    expect(JSON.parse(localStorage.getItem('schonberg:loggedOut')!).name).toBe('Clara');
    dismissLogout();
    expect(lastLogout()).toBeNull();
    saveSession(session());
    await refreshSession();
    expect(lastLogout()).not.toBeNull();
    await login('kammerchor', 'Clara', 'password-123');
    expect(lastLogout()).toBeNull();
  });
});

describe('choir library pieces', () => {
  const info = (pieces: unknown[], cycle: unknown = null) => ({
    code: 'kammerchor', name: 'Kammerchor', cycle, pieces, updatedAt: 5, cycleUpdatedAt: 5, leads: [],
  });

  it('a library piece keeps its library id on the phone (so earlier progress comes back); an upload gets the choir id', async () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    mockFetch((url) => (url.endsWith('/file') ? { body: {} } : {
      body: info([
        { id: 'aaaaaaaaaaaa', title: 'Madrigal, Op. 35', composer: 'Gabriel Fauré', filename: 'faure-madrigal.mxl', uploadedAt: 1, size: 9, libraryId: 'faure-madrigal', credit: 'Edition: Robert Kerr (CC BY-SA 4.0)' },
        { id: 'bbbbbbbbbbbb', title: 'Our own', composer: '', filename: 'own.musicxml', uploadedAt: 1, size: 9 },
        { id: 'cccccccccccc', title: 'Odd', composer: '', filename: 'odd.mxl', uploadedAt: 1, size: 9, libraryId: '../Bad Id' },
      ], { name: 'Autumn', pieceIds: ['faure-madrigal', 'debussy-dieu'] }),
    }));
    const got: { name: string; meta: Record<string, unknown> }[] = [];
    const r = await syncChoir(async (name, _data, meta) => { got.push({ name, meta }); }, () => false);
    expect(r).toMatchObject({ ok: true, newPieces: 3, programme: true });
    expect(got.map((g) => g.meta.id)).toEqual(['faure-madrigal', choirPieceId('kammerchor', 'bbbbbbbbbbbb'), choirPieceId('kammerchor', 'cccccccccccc')]);
    expect(got[0].meta).toMatchObject({ title: 'Madrigal, Op. 35', credit: 'Edition: Robert Kerr (CC BY-SA 4.0)', choir: 'kammerchor' });
    expect(calls.filter((c) => c.url.endsWith('/file')).map((c) => c.url)[0]).toBe('/schonberg/api/choirs/kammerchor/pieces/aaaaaaaaaaaa/file');
    // The programme keeps ids of pieces this phone doesn't have (yet): they light up when the score arrives.
    expect(loadCycle().pieceIds).toEqual(['faure-madrigal', 'debussy-dieu']);
    expect(localPieceId('kammerchor', { id: 'bbbbbbbbbbbb' })).toBe('choir-kammerchor-bbbbbbbbbbbb');
  });

  it('admins list the library and add a piece with one call (bearer or super-admin password)', async () => {
    mockFetch((url) => (url.endsWith('/library')
      ? { body: { pieces: [{ id: 'faure-madrigal', title: 'Madrigal, Op. 35', composer: 'Gabriel Fauré', size: 9, scoreId: null, inProgramme: false }] } }
      : { body: { ok: true, added: true, programme: true, piece: { id: 'aaaaaaaaaaaa' }, choir: info([]) } }));
    const l = await fetchLibrary('kammerchor', { bearer: 'tok' });
    expect(l.pieces[0].id).toBe('faure-madrigal');
    expect(headers(calls[0]).Authorization).toBe('Bearer tok');
    const r = await addLibraryPiece('kammerchor', { superAdmin: 'pw' }, 'faure-madrigal', true);
    expect(r.programme).toBe(true);
    expect(calls[1].url).toBe('/schonberg/api/choirs/kammerchor/library/faure-madrigal');
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ programme: true });
    expect(headers(calls[1])['X-Super-Admin']).toBe('pw');
  });
});
