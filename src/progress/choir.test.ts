import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetAllForTests, exportBackup, loadCycle, loadProfile, saveCycle, saveProfile } from './store';
import {
  _resetSessionStateForTests, acceptInvite, createInvite, fetchPeople, inviteLink, leaveChoir, loadSession, loggedOutNotice, login, logout,
  LOGGED_OUT_ELSEWHERE, refreshSession, refreshSessionSoon, rememberedInvite, saveSession, sessionFor, superCreate, type Session,
  signUp, shareProgress, deleteMyAccount, lastLogout, dismissLogout, syncChoir, choirPieceId, localPieceId, fetchLibrary, addLibraryPiece,
  superLogin, superLogout, loadSuperSession, superAuth, superList, superLoggedOutNotice, refreshSuperSession, refreshSuperSessionSoon,
  _resetSuperStateForTests, staffRoles, onSessionChange, joinChoir, ensureChoirSharing, endSession, sharingEnded, sharingNeedsOk, startSharing, stopSharing,
} from './choir';
import { buildSnapshot } from './sync';
import { fetchMetrics } from './insights';
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
/** A singer's own change to the programme on this phone (kept until the choir changes it). */
const saveCycleTweak = () => saveCycle({ ...loadCycle(), concertDate: '2001-01-01' });

beforeEach(() => {
  localStorage.clear();
  _resetAllForTests();
  _resetSessionStateForTests();
  _resetSuperStateForTests();
  vi.stubEnv('VITE_CHOIR_URL', '/schonberg/api');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sharing with the section lead: the singer's own choice", () => {
  it('stopping: nothing asks to start again, a new join or login keeps it off', async () => {
    mockFetch(() => ({ body: { code: 'kammerchor', name: 'Kammerchor', cycle: null, pieces: [], updatedAt: 1, leads: [] } }));
    saveProfile({ ...loadProfile(), name: 'Anna', choirCode: 'kammerchor', shareProgress: true });
    stopSharing();
    expect(loadProfile()).toMatchObject({ shareProgress: false, shareOptOut: true });
    expect(sharingNeedsOk()).toBe(false);
    ensureChoirSharing();
    await joinChoir('kammerchor');
    expect(loadProfile().shareProgress).toBe(false);
    startSharing();
    expect(loadProfile()).toMatchObject({ shareProgress: true, shareOptOut: false });
  });
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
    await superCreate({ superAdmin: 'super-pw' }, 'neu', 'Neu', 'Clara');
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

  it('joining a choir shares progress with the section lead (no opt-out)', async () => {
    mockFetch(() => ({ body: info([], null) }));
    await joinChoir('kammerchor');
    expect(loadProfile()).toMatchObject({ choirCode: 'kammerchor', shareProgress: true, leaderboardOptIn: true });
  });

  it('the one-time switch-on skips a phone whose account the choir removed, and a new login shares again', async () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor', shareProgress: true });
    saveSession(session({ account: { ...account, role: 'member' as const } }));
    endSession('removed');
    expect(loadProfile().shareProgress).toBe(false);
    ensureChoirSharing();
    expect(loadProfile().shareProgress).toBe(false);
    expect(sharingEnded()).toBe(true);
    mockFetch(() => ({ body: session({ account: { ...account, role: 'member' as const } }) }));
    await login('kammerchor', 'Clara', 'password-123');
    expect(loadProfile().shareProgress).toBe(true);
    expect(sharingEnded()).toBe(false);
  });

  it('earlier members: switched on silently only when logged in to the choir; otherwise asked', () => {
    // Never touched the old box, not logged in (could be an account deleted before this version): asked.
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor', shareProgress: undefined });
    ensureChoirSharing();
    expect(loadProfile().shareProgress).toBeFalsy();
    expect(sharingNeedsOk()).toBe(true);
    // Switched off, not logged in (could also be an account deleted before this version): asked, not switched.
    localStorage.removeItem('schonberg:shareMandatory');
    saveProfile({ ...loadProfile(), shareProgress: false });
    ensureChoirSharing();
    expect(loadProfile().shareProgress).toBe(false);
    expect(sharingNeedsOk()).toBe(true);
    startSharing();
    expect(loadProfile().shareProgress).toBe(true);
    expect(sharingNeedsOk()).toBe(false);
    // Switched off but logged in to the choir (so not removed): switched on.
    localStorage.removeItem('schonberg:shareMandatory');
    saveProfile({ ...loadProfile(), shareProgress: false });
    saveSession(session({ account: { ...account, role: 'member' as const } }));
    ensureChoirSharing();
    expect(loadProfile().shareProgress).toBe(true);
    // Once only: a later switch-off (e.g. a removal) isn't undone by the migration.
    saveProfile({ ...loadProfile(), shareProgress: false });
    ensureChoirSharing();
    expect(loadProfile().shareProgress).toBe(false);
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

  it('a score whose download fails is tried again next time; one that can\'t be read waits a day', async () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    const pieces = [
      { id: 'aaaaaaaaaaaa', title: 'Madrigal, Op. 35', composer: 'Gabriel Fauré', filename: 'faure-madrigal.mxl', uploadedAt: 1, size: 9, libraryId: 'faure-madrigal' },
      { id: 'bbbbbbbbbbbb', title: 'Broken', composer: '', filename: 'broken.musicxml', uploadedAt: 1, size: 9 },
    ];
    let offline = true;
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/file') && offline) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(url.endsWith('/file') ? {} : info(pieces, { name: 'Autumn', pieceIds: ['faure-madrigal'] })), { status: 200 });
    }));
    const imported: string[] = [];
    const importer = async (_name: string, _data: ArrayBuffer, meta: { id: string }) => {
      if (meta.id.endsWith('bbbbbbbbbbbb')) throw new Error('not a score');
      imported.push(meta.id);
    };
    // Offline mid-sync (or the page reloading): nothing is imported and nothing is remembered as bad.
    expect((await syncChoir(importer, (id) => imported.includes(id))).newPieces).toBe(0);
    expect(JSON.parse(localStorage.getItem('sh:choirBadScores') ?? '[]')).toEqual([]);
    // Back online: the Madrigal arrives; the unreadable score is set aside (not fetched on every start).
    offline = false;
    expect((await syncChoir(importer, (id) => imported.includes(id))).newPieces).toBe(1);
    expect(imported).toEqual(['faure-madrigal']);
    const fetchedBroken = () => calls.filter((c) => c.url.endsWith('/pieces/bbbbbbbbbbbb/file')).length;
    const before = fetchedBroken();
    await syncChoir(importer, (id) => imported.includes(id));
    expect(fetchedBroken()).toBe(before);
    // A day later it is tried again.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + DAY + 1);
    await syncChoir(importer, (id) => imported.includes(id));
    expect(fetchedBroken()).toBe(before + 1);
    vi.restoreAllMocks();
  });

  it('a score stored by an older importer is downloaded and imported again (not counted as new)', async () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    mockFetch((url) => (url.endsWith('/file') ? { body: {} } : {
      body: info([{ id: 'aaaaaaaaaaaa', title: 'Kyrie', composer: 'Louis Vierne', filename: 'vierne-kyrie.mxl', uploadedAt: 1, size: 9, libraryId: 'vierne-kyrie' }],
        { name: 'Autumn', pieceIds: ['vierne-kyrie'] }),
    }));
    const got: string[] = [];
    const importer = async (_n: string, _d: ArrayBuffer, meta: { id: string }) => { got.push(meta.id); };
    // up to date: not fetched
    expect((await syncChoir(importer, () => true, () => false, () => false)).newPieces).toBe(0);
    expect(got).toEqual([]);
    // stored by an older version: fetched and imported again, but it isn't a new score
    expect((await syncChoir(importer, () => true, () => false, (id) => id === 'vierne-kyrie')).newPieces).toBe(0);
    expect(got).toEqual(['vierne-kyrie']);
  });

  it('an older phone\'s list of bad scores (bare ids, kept even after a network error) is forgotten', async () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    localStorage.setItem('sh:choirBadScores', JSON.stringify(['faure-madrigal']));
    mockFetch((url) => (url.endsWith('/file') ? { body: {} } : {
      body: info([{ id: 'aaaaaaaaaaaa', title: 'Madrigal, Op. 35', composer: 'Gabriel Fauré', filename: 'faure-madrigal.mxl', uploadedAt: 1, size: 9, libraryId: 'faure-madrigal' }],
        { name: 'Autumn', pieceIds: ['faure-madrigal'] }),
    }));
    const got: string[] = [];
    expect((await syncChoir(async (_n, _d, meta) => { got.push(meta.id); }, () => false)).newPieces).toBe(1);
    expect(got).toEqual(['faure-madrigal']);
  });

  it('the programme is applied again only when the running cycle changes, not when other cycles do', async () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    const cyc = (id: string, start: string, updatedAt: number, pieceIds: string[], end?: string) => ({ id, name: id, start, ...(end ? { end } : {}), updatedAt, createdAt: 1, pieceIds });
    let cycles = [cyc('autumn', '2000-01-01', 7, ['a']), cyc('spring', '2999-01-01', 8, ['b'])];
    let cu = 8;
    mockFetch(() => ({ body: { ...info([]), cycle: null, cycles, cycleUpdatedAt: cu } }));
    const sync = async () => (await syncChoir(async () => {}, () => true)).programme;
    expect(await sync()).toBe(true);
    expect(loadCycle()).toMatchObject({ name: 'autumn', pieceIds: ['a'], preset: 'choir:kammerchor' });
    // a local tweak lasts while only another cycle changes
    saveCycleTweak();
    cycles = [cycles[0], cyc('spring', '2999-01-02', 9, ['c'])];
    cu = 9;
    expect(await sync()).toBe(false);
    expect(loadCycle().concertDate).toBe('2001-01-01');
    // the running cycle is edited: applied again
    cycles = [cyc('autumn', '2000-01-01', 10, ['a', 'd']), cycles[1]];
    expect(await sync()).toBe(true);
    expect(loadCycle().pieceIds).toEqual(['a', 'd']);
    // it ends: between cycles its programme goes
    cycles = [cyc('autumn', '2000-01-01', 11, ['a', 'd'], '2000-02-01'), cycles[1]];
    expect(await sync()).toBe(true);
    expect(loadCycle().pieceIds).toEqual([]);
  });

  it('a phone that applied the programme before cycles had dates keeps its tweaks after the update', async () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    const cu = Date.UTC(2020, 5, 1, 12);
    localStorage.setItem('sh:choirApplied', `kammerchor:${cu}`);
    saveCycleTweak();
    let cycles = [{ id: 'first', name: 'autumn', start: '2000-01-01', updatedAt: cu, pieceIds: ['a'] }];
    mockFetch(() => ({ body: { ...info([], { name: 'autumn', pieceIds: ['a'] }), cycleUpdatedAt: cu, cycles } }));
    expect((await syncChoir(async () => {}, () => true)).programme).toBe(false);
    expect(localStorage.getItem('sh:choirApplied')).toBe(`kammerchor:first:${cu}`);
    expect(loadCycle().concertDate).toBe('2001-01-01');
    // but a cycle that started (by date) after that change was never applied there: it is now
    localStorage.setItem('sh:choirApplied', `kammerchor:${cu}`);
    cycles = [{ id: 'spring', name: 'spring', start: '2021-01-01', updatedAt: cu - 1, pieceIds: ['b'] }];
    expect((await syncChoir(async () => {}, () => true)).programme).toBe(true);
    expect(loadCycle()).toMatchObject({ name: 'spring', pieceIds: ['b'] });
  });

  it('joining another choir that is between cycles drops the old choir\'s programme', async () => {
    saveProfile({ ...loadProfile(), choirCode: 'kammerchor' });
    saveCycle({ ...loadCycle(), name: 'Old choir', pieceIds: ['x'], preset: 'choir:otherchoir' });
    localStorage.setItem('sh:choirApplied', 'otherchoir:3');
    mockFetch(() => ({ body: { ...info([]), cycles: [{ id: 'spring', name: 'Spring', start: '2999-01-01', pieceIds: ['b'] }] } }));
    expect((await syncChoir(async () => {}, () => true)).programme).toBe(true);
    expect(loadCycle()).toMatchObject({ name: '', pieceIds: [], preset: 'choir:kammerchor' });
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
    // into the cycle being edited
    await addLibraryPiece('kammerchor', { bearer: 'tok' }, 'faure-madrigal', true, 'c1');
    expect(JSON.parse(calls[2].init.body as string)).toEqual({ programme: true, cycleId: 'c1' });
  });
});

describe('super-admin login', () => {
  const SUPER_TOKEN = 'super-' + 'y'.repeat(40);
  const loginReply = () => ({ body: { token: SUPER_TOKEN, expiresAt: Date.now() + 30 * DAY } });

  it('logs in once with the password; keeps only the token, sent as a bearer token on super calls', async () => {
    mockFetch((url) => (url.endsWith('/super/login') ? loginReply() : { body: { choirs: [] } }));
    let changed = 0;
    const off = onSessionChange(() => { changed++; });
    await superLogin('super-secret-pw');
    off();
    expect(changed).toBe(1);
    expect(calls[0].url).toBe('/schonberg/api/super/login');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ password: 'super-secret-pw' });
    expect(loadSuperSession()?.token).toBe(SUPER_TOKEN);
    expect(JSON.stringify(localStorage)).not.toContain('super-secret-pw');
    expect(JSON.stringify(sessionStorage)).not.toContain('super-secret-pw');
    await superList(superAuth()!);
    expect(headers(calls[1]).Authorization).toBe(`Bearer ${SUPER_TOKEN}`);
    expect(headers(calls[1])['X-Super-Admin']).toBeUndefined();
    await fetchMetrics(superAuth()!, 7);
    expect(headers(calls[2]).Authorization).toBe(`Bearer ${SUPER_TOKEN}`);
  });

  it('is never in a backup file or in the progress kept with an account', async () => {
    mockFetch(() => loginReply());
    await superLogin('super-secret-pw');
    saveSession(session());
    expect(exportBackup()).not.toContain(SUPER_TOKEN);
    expect(JSON.stringify(buildSnapshot().data)).not.toContain(SUPER_TOKEN);
  });

  it('a wrong password keeps nothing', async () => {
    mockFetch(() => ({ status: 403, body: { error: 'Wrong super-admin password' } }));
    await expect(superLogin('nope')).rejects.toThrow('Wrong super-admin password');
    expect(loadSuperSession()).toBeNull();
    expect(superAuth()).toBeNull();
  });

  it('logout clears the phone first, then revokes the session on the server', async () => {
    mockFetch(() => loginReply());
    await superLogin('super-secret-pw');
    mockFetch(() => ({ body: { ok: true } }));
    const p = superLogout();
    expect(loadSuperSession()).toBeNull();
    await p;
    expect(calls[0].url).toBe('/schonberg/api/super/session');
    expect(calls[0].init.method).toBe('DELETE');
    expect(headers(calls[0]).Authorization).toBe(`Bearer ${SUPER_TOKEN}`);
    expect(superLoggedOutNotice()).toBeNull();
  });

  it('a session the server rejects (401: expired, password changed) is forgotten, with a notice', async () => {
    mockFetch(() => loginReply());
    await superLogin('super-secret-pw');
    mockFetch(() => ({ status: 401, body: { error: 'Your super-admin login has ended. Log in again.', superLoggedOut: true } }));
    await expect(superList(superAuth()!)).rejects.toThrow('ended');
    expect(loadSuperSession()).toBeNull();
    expect(superLoggedOutNotice()).toContain('Log in again');
    // the account session (another token) is untouched by it
    saveSession(session());
    mockFetch(() => loginReply());
    await superLogin('super-secret-pw');
    mockFetch(() => ({ status: 401, body: { error: 'ended', superLoggedOut: true } }));
    await expect(fetchMetrics(superAuth()!, 7)).rejects.toThrow();
    expect(loadSuperSession()).toBeNull();
    expect(loadSession()?.token).toBe(session().token);
  });

  it('refreshSuperSession renews the end date; refreshSuperSessionSoon asks at most every 20 s', async () => {
    mockFetch(() => loginReply());
    await superLogin('super-secret-pw');
    const later = Date.now() + 33 * DAY;
    mockFetch(() => ({ body: { ok: true, expiresAt: later } }));
    expect((await refreshSuperSession())?.expiresAt).toBe(later);
    refreshSuperSessionSoon();
    refreshSuperSessionSoon();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.filter((c) => c.url.endsWith('/super/session')).length).toBe(2);
  });

  it('staff roles: the Admin tab and its sub-tabs by login', async () => {
    expect(staffRoles('kammerchor')).toMatchObject({ tabs: [], label: null });
    saveSession(session({ account: { ...account, role: 'member' } }));
    expect(staffRoles('kammerchor')).toMatchObject({ tabs: [], label: null });
    saveSession(session({ account: { ...account, role: 'lead', voices: ['A', 'T'] } }));
    expect(staffRoles('kammerchor')).toMatchObject({ tabs: ['sections'], label: 'Section' });
    expect(staffRoles('otherchoir')).toMatchObject({ tabs: [], label: null }); // a login for another choir
    saveSession(session());
    expect(staffRoles('kammerchor')).toMatchObject({ tabs: ['choir', 'sections'], label: 'Admin' });
    mockFetch(() => loginReply());
    await superLogin('super-secret-pw');
    expect(staffRoles('kammerchor')).toMatchObject({ tabs: ['choir', 'sections', 'choirs', 'usage'], label: 'Admin' });
    saveSession(session({ account: { ...account, role: 'lead', voices: ['A'] } }));
    expect(staffRoles('kammerchor')).toMatchObject({ tabs: ['sections', 'choirs', 'usage'], label: 'Admin' });
    saveSession(null);
    expect(staffRoles(undefined)).toMatchObject({ tabs: ['choirs', 'usage'], label: 'Admin' });
  });

  it('old staff hash routes still open (they now land in the Admin tab)', () => {
    for (const r of ['choiradmin', 'section', 'choirinsights', 'superadmin', 'usage']) expect(parseHash(`#/${r}`)).toEqual({ name: r });
  });
});

describe('the intonation lab straight into a cycle (library, no editor)', () => {
  it('targets the running cycle, else the next; sends the programme back with only the lab changed', async () => {
    const { targetCycle, setInProgramme } = await import('./choir');
    const day = (n: number) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const past = { id: 'p', name: 'Past', start: day(-60), end: day(-30), pieceIds: ['a'] };
    const run = { id: 'r', name: 'Now', start: day(-5), pieceIds: ['a', 'b'], focusPieceIds: ['b'], concertDate: day(40), wanted: [{ title: 'X', composer: 'Y' }], createdAt: 1, updatedAt: 2 };
    const next = { id: 'n', name: 'Next', start: day(20), pieceIds: [] };
    expect(targetCycle([past, run, next])?.id).toBe('r');
    expect(targetCycle([past, next])?.id).toBe('n');
    expect(targetCycle([past])).toBeNull();
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ choir: {}, cycles: [], current: null, cycleUpdatedAt: 3 }), { status: 200 }); }));
    vi.stubEnv('VITE_CHOIR_URL', '/schonberg/api');
    await setInProgramme('abc', { bearer: 't' }, run, 'lab:intonation', true, 7);
    await setInProgramme('abc', { bearer: 't' }, { ...run, pieceIds: ['a', 'b', 'lab:intonation'] }, 'lab:intonation', false, 8);
    expect(sent[0]).toEqual({ name: 'Now', start: run.start, end: null, pieceIds: ['a', 'b', 'lab:intonation'], focusPieceIds: ['b'], concertDate: run.concertDate, wanted: run.wanted, base: 7 });
    expect((sent[1] as { pieceIds: string[] }).pieceIds).toEqual(['a', 'b']);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
