import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arrivalScroll, go, href, leaveTo, openAt, parseHash, practiceParent, pushGuard, isDroppingGuard } from './router';

/** history.back() and wait until it has landed. */
function back(): Promise<void> {
  return new Promise((resolve) => {
    const on = () => { window.removeEventListener('popstate', on); setTimeout(resolve, 0); };
    window.addEventListener('popstate', on);
    history.back();
  });
}
/** Wait for the router's own history steps (popstate + whatever follows). */
const settle = () => new Promise((r) => setTimeout(r, 30));

const play = { name: 'play', pieceId: 'p1', partId: 'S', sectionId: 's1', level: 1, mode: '2d' } as const;

describe('practice screens sit right above their piece', () => {
  beforeEach(async () => {
    // A fresh start on Home with nothing practice-like below.
    history.replaceState(null, '', '#/');
    await settle();
  });

  it('from Home: the piece is put below Play, so back reaches it and then Home', async () => {
    const n = history.length;
    go(play);
    expect(location.hash).toMatch(/^#\/play\/p1\/S\/s1/);
    expect(history.length).toBe(n + 2);
    await back();
    expect(location.hash).toBe('#/piece/p1');
    await back();
    expect(location.hash).toBe('#/');
  });

  it('Play → Results → Again → Results: one entry, and back lands on the piece', async () => {
    location.hash = '#/piece/p1';
    await settle();
    const n = history.length;
    go(play);
    expect(history.length).toBe(n + 1);
    go({ name: 'results' }, true);
    go(play, true);
    go({ name: 'results' }, true);
    expect(history.length).toBe(n + 1);
    expect(location.hash).toBe('#/results');
    await back();
    expect(location.hash).toBe('#/piece/p1');
  });

  it('leaveTo(piece) from Results steps back instead of stacking the piece again', async () => {
    location.hash = '#/piece/p1';
    await settle();
    go(play);
    go({ name: 'results' }, true);
    const n = history.length;
    leaveTo({ name: 'piece', pieceId: 'p1' });
    await settle();
    expect(location.hash).toBe('#/piece/p1');
    expect(history.length).toBe(n); // nothing pushed
  });

  it('a Results opened cold (no history below) is replaced by the piece', async () => {
    history.replaceState(null, '', '#/results');
    const n = history.length;
    leaveTo({ name: 'piece', pieceId: 'p1' });
    await settle();
    expect(location.hash).toBe('#/piece/p1');
    expect(history.length).toBe(n);
  });

  it('a run\'s guard entry is dropped before Results replaces Play', async () => {
    location.hash = '#/piece/p1';
    await settle();
    go(play);
    const n = history.length;
    pushGuard();
    pushGuard(); // only one
    expect(history.length).toBe(n + 1);
    go({ name: 'results' }, true);
    expect(isDroppingGuard()).toBe(true);
    await settle();
    expect(location.hash).toBe('#/results');
    await back();
    expect(location.hash).toBe('#/piece/p1');
  });

  it('virtual drills belong to their piece; expert drills to expert mode', () => {
    expect(practiceParent({ ...play, pieceId: 'p1~entries~S' })).toEqual({ name: 'piece', pieceId: 'p1' });
    expect(practiceParent({ ...play, pieceId: 'row-2026-10-07-P0' })).toEqual({ name: 'expert' });
    expect(practiceParent({ name: 'results' })).toBeNull();
  });

  it('a Play opened cold (nothing below): Again keeps it unstamped, so ← replaces it with the piece', async () => {
    history.replaceState(null, '', '#/play/p1/S/s1?level=1');
    await settle();
    go({ name: 'results' }, true);
    go(play, true);
    expect((history.state as { shUp?: string } | null)?.shUp).toBeUndefined();
    const n = history.length;
    leaveTo({ name: 'piece', pieceId: 'p1' });
    await settle();
    expect(location.hash).toBe('#/piece/p1');
    expect(history.length).toBe(n); // replaced, nothing pushed, nothing stepped out of
  });
});

describe('the intonation lab\'s addresses', () => {
  it('round-trips the ladder and a rung; nonsense falls back to the ladder', () => {
    for (const r of [{ name: 'intonation' }, { name: 'intonation', interval: 'third' }, { name: 'intonation', interval: 'fifth', rung: 4 }] as const) {
      expect(parseHash(href(r))).toEqual(r);
    }
    expect(parseHash('#/intonation/third/9')).toEqual({ name: 'intonation', interval: 'third' });
    expect(parseHash('#/intonation/sixth/2')).toEqual({ name: 'intonation' });
  });
});

describe('where a new screen opens', () => {
  let toTop: ReturnType<typeof vi.fn>;
  let into: ReturnType<typeof vi.fn>;
  const orig = Element.prototype.scrollIntoView;
  beforeEach(async () => {
    history.replaceState(null, '', '#/');
    await settle();
    toTop = vi.fn();
    into = vi.fn();
    vi.stubGlobal('scrollTo', toTop);
    Element.prototype.scrollIntoView = into as unknown as Element['scrollIntoView'];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = orig;
    document.getElementById('account')?.remove();
  });
  const part = () => { const el = document.createElement('section'); el.id = 'account'; document.body.append(el); return el; };

  it('an ordinary screen change starts at the top', () => {
    go({ name: 'settings' });
    part();
    arrivalScroll();
    expect(toTop).toHaveBeenCalledWith(0, 0);
    expect(into).not.toHaveBeenCalled();
  });

  it('openAt (Log in / Make an account) lands on that part once drawn, and only that once', () => {
    openAt({ name: 'settings' }, 'account');
    expect(location.hash).toBe('#/settings');
    const el = part();
    arrivalScroll();
    expect(into).toHaveBeenCalledTimes(1);
    expect(into.mock.instances[0]).toBe(el);
    expect(toTop).not.toHaveBeenCalled();
    // the next screen change is an ordinary one again
    arrivalScroll();
    expect(toTop).toHaveBeenCalledWith(0, 0);
    expect(into).toHaveBeenCalledTimes(1);
  });

  it('openAt to a part that isn\'t there (no choir server): the top, and nothing left over', () => {
    openAt({ name: 'settings' }, 'account');
    arrivalScroll();
    expect(toTop).toHaveBeenCalledWith(0, 0);
    part();
    arrivalScroll();
    expect(into).not.toHaveBeenCalled();
  });

  it('openAt on the screen already shown: scrolls there right away', () => {
    history.replaceState(null, '', '#/settings');
    const el = part();
    openAt({ name: 'settings' }, 'account');
    expect(into.mock.instances[0]).toBe(el);
    arrivalScroll();
    expect(toTop).toHaveBeenCalledWith(0, 0);
  });
});
