import { describe, expect, it } from 'vitest';
import { avatarInitials, backTab, showsSidebar, showsTabBar, stampedTab, tabOf } from './nav';
import { parseHash, type Route } from './router';

describe('tabs', () => {
  it('the four tab roots light themselves', () => {
    for (const n of ['home', 'pieces', 'train', 'choir'] as const) expect(tabOf({ name: n })).toBe(n);
  });

  it('sub-screens light the tab they belong to', () => {
    expect(tabOf({ name: 'ranks' })).toBe('choir');
    expect(tabOf({ name: 'expert' })).toBe('train');
    expect(tabOf({ name: 'tuner' })).toBe('train');
    expect(tabOf({ name: 'intonation' })).toBe('train');
    // (whatever tab was shown before)
    expect(tabOf({ name: 'ranks' }, 'home')).toBe('choir');
  });

  it('a piece, Settings and Diagnostics light the tab they were opened from', () => {
    expect(tabOf({ name: 'piece' }, 'home')).toBe('home');
    expect(tabOf({ name: 'piece' }, 'choir')).toBe('choir');
    expect(tabOf({ name: 'piece' })).toBe('pieces'); // opened from a link
    expect(tabOf({ name: 'settings' }, 'train')).toBe('train');
    expect(tabOf({ name: 'settings' })).toBe('home');
    expect(tabOf({ name: 'diagnostics' }, 'pieces')).toBe('pieces');
    // Your progress: from Today's week card, or from the You sheet on any tab
    expect(tabOf({ name: 'progress' })).toBe('home');
    expect(tabOf({ name: 'progress' }, 'train')).toBe('train');
  });

  it('staff screens and practice screens light no singer tab', () => {
    expect(tabOf({ name: 'choiradmin' }, 'home')).toBeNull();
    expect(tabOf({ name: 'play' }, 'home')).toBeNull();
    expect(tabOf({ name: 'results' })).toBeNull();
  });

  it('phones: the tab bar only under the tab roots and the staff screens', () => {
    const yes: Route['name'][] = ['home', 'pieces', 'train', 'choir', 'choiradmin', 'section', 'choirinsights', 'superadmin', 'usage'];
    const no: Route['name'][] = ['piece', 'progress', 'ranks', 'settings', 'expert', 'tuner', 'diagnostics', 'play', 'results', 'setup', 'intonation', 'invite'];
    for (const n of yes) expect(showsTabBar({ name: n }), n).toBe(true);
    for (const n of no) expect(showsTabBar({ name: n }), n).toBe(false);
  });

  it('wide screens: the sidebar on sub-screens too, never while practising or in setup', () => {
    for (const h of ['#/', '#/pieces', '#/piece/x', '#/progress', '#/ranks', '#/settings', '#/expert', '#/tuner', '#/diagnostics', '#/intonation', '#/choiradmin']) {
      expect(showsSidebar(parseHash(h)), h).toBe(true);
    }
    for (const h of ['#/play/p/S/s1?level=1', '#/results', '#/setup', '#/intonation/fifth/2', '#/lyrics/p/S', '#/memorymap/p/S']) {
      expect(showsSidebar(parseHash(h)), h).toBe(false);
    }
  });
});

describe('old addresses keep working', () => {
  it('#/library is the Pieces tab; the new tabs have their own addresses', () => {
    expect(parseHash('#/library')).toEqual({ name: 'pieces' });
    expect(parseHash('#/pieces')).toEqual({ name: 'pieces' });
    expect(parseHash('#/train')).toEqual({ name: 'train' });
    expect(parseHash('#/choir')).toEqual({ name: 'choir' });
    // (still screens of their own, reached from the Choir tab and the You sheet)
    expect(parseHash('#/ranks')).toEqual({ name: 'ranks' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
  });
});

describe('avatar initials', () => {
  it('two letters for one name, first and last initial for more, the voice without a name', () => {
    expect(avatarInitials('Clara', 'A')).toBe('CL');
    expect(avatarInitials('Clara Maria Weiß', 'A')).toBe('CW');
    expect(avatarInitials('  ', 'T')).toBe('T');
    expect(avatarInitials('Zoë', 'S')).toBe('ZO');
  });
});

describe('the tab a history entry was opened from', () => {
  it('is read from the entry; ← on a screen opened cold goes to the tab it lights', () => {
    sessionStorage.removeItem('sh:fromTab');
    history.replaceState(null, '', '#/piece/x');
    expect(stampedTab()).toBeNull();
    expect(backTab('piece')).toEqual({ name: 'pieces' });
    expect(backTab('settings')).toEqual({ name: 'home' });
    history.replaceState({ shTab: 'choir' }, '', '#/piece/x');
    expect(stampedTab()).toBe('choir');
    expect(backTab('piece')).toEqual({ name: 'choir' });
    history.replaceState({ shTab: 'nonsense' }, '', '#/piece/x');
    expect(stampedTab()).toBeNull();
    sessionStorage.setItem('sh:fromTab', 'train');
    expect(backTab('progress')).toEqual({ name: 'train' });
    sessionStorage.removeItem('sh:fromTab');
    history.replaceState(null, '', '#/');
  });
});
