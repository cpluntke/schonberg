import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoute } from '../router';

// (no Web Audio in jsdom: the sounds are stand-ins that remember what they were asked to play)
const sounded: Record<string, number>[] = [];
vi.mock('../../audio/context', () => ({ getAudioContext: () => ({}), unlockAudio: async () => {} }));
vi.mock('../../audio/drone', () => ({
  Drone: class {
    set(t: Record<string, number>) { sounded.push(t); }
    stop() {}
    dispose() {}
  },
}));
import { TuningScreen, tuningSeen } from './Tuning';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// (jsdom doesn't scroll; the router scrolls to the top on every page)
window.scrollTo = (() => {}) as typeof window.scrollTo;
// Reduced motion: the pictures are still frames and glides jump (the animations' own still path).
window.matchMedia = ((query: string) => ({
  matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {},
})) as unknown as typeof window.matchMedia;

/** The explainer as App shows it: its page follows the address. */
function Harness() {
  const r = useRoute();
  return r.name === 'tuning' ? <TuningScreen page={r.page ?? 1} /> : <div data-testid="elsewhere">{r.name}</div>;
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const title = () => q('tuning-title')?.textContent;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '#/tuning');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function click(id: string) {
  await act(async () => { q(id)!.click(); await settle(); });
}

describe('Why choirs tune differently', () => {
  const titles = [
    'Two notes that fit', 'The wobble', 'Cents', 'So why not tune everything pure?', 'Now stack pure fifths', 'Share it out',
    'Choirs have a luxury', 'What matters most',
  ];

  it('eight pages, with Next and Back; seen once the last page is reached', async () => {
    await act(async () => { root.render(<Harness />); await settle(); });
    expect(title()).toBe(titles[0]);
    expect(q('tuning-back')).toBeNull(); // (page 1: nothing before it)
    expect(q('tuning-next')).not.toBeNull();
    expect(q('tuning-waves')).not.toBeNull();
    for (let i = 1; i < 8; i++) {
      expect(tuningSeen()).toBe(false);
      await click('tuning-next');
      expect(title()).toBe(titles[i]);
      expect(location.hash).toBe(`#/tuning/${i + 1}`);
      expect(q('tuning-back')).not.toBeNull();
      expect(document.querySelector('[aria-current="step"]')?.getAttribute('aria-label')).toBe(`Page ${i + 1} of 8: ${titles[i]}`);
    }
    // the last page: the two courses, the fifth first; Done instead of Next, no Skip
    expect(q('tuning-next')).toBeNull();
    expect(q('tuning-skip')).toBeNull();
    expect(q('tuning-done')).not.toBeNull();
    const courses = Array.from(document.querySelectorAll('[data-testid^="tuning-course-"]')).map((e) => e.getAttribute('data-testid'));
    expect(courses).toEqual(['tuning-course-fifth', 'tuning-course-third']);
    expect(tuningSeen()).toBe(true);
    await click('tuning-back');
    expect(title()).toBe(titles[6]);
    expect(location.hash).toBe('#/tuning/7');
  });

  it('nothing sounds before a tap', async () => {
    sounded.length = 0;
    for (let p = 1; p <= 8; p++) await act(async () => { root.render(<TuningScreen page={p} key={p} />); await settle(); });
    expect(sounded).toEqual([]);
  });

  it('each page has a picture and a sound to play; the sliders say what they mean', async () => {
    const pictures = ['tuning-waves', 'tuning-pulse', 'tuning-ruler', 'tuning-circle', 'tuning-circle', 'tuning-circle', 'tuning-pulse'];
    for (let p = 1; p <= 7; p++) {
      await act(async () => { root.render(<TuningScreen page={p} />); await settle(); });
      expect(q(pictures[p - 1]), `page ${p}`).not.toBeNull();
      // (a play / stop button; pages 4 and 5 play each fifth as it's tapped)
      expect(document.querySelectorAll('button[aria-pressed], [data-testid="tuning-add-fifth"]').length, `page ${p}`).toBeGreaterThan(0);
    }
    await act(async () => { root.render(<TuningScreen page={2} />); await settle(); });
    const s = q('tuning-fifth-slider') as HTMLInputElement;
    expect(s.getAttribute('aria-valuetext')).toBe('12 cents sharp');
    expect(document.querySelector('label[for="tun-fifth"]')).not.toBeNull();
    expect(q('tuning-rate')?.textContent).toMatch(/^About \d+ wobbles a second$/);
  });

  it('twelve pure fifths overshoot C by the comma; twelve piano fifths close the circle', async () => {
    for (const [page, end] of [[4, 'C again'], [5, '23.5 cents']] as const) {
      await act(async () => { root.render(<TuningScreen page={page} key={page} />); await settle(); });
      for (let i = 0; i < 12; i++) await click('tuning-add-fifth');
      expect(q('tuning-circle')?.textContent, `page ${page}`).toContain(end);
      expect(q('tuning-add-fifth')?.textContent).toBe('Start again');
      expect(q('tuning-both-cs')).not.toBeNull();
      // each tap played a fifth: pure on page 5, the piano's on page 4
      const step = sounded[sounded.length - 1];
      expect(step.hi / step.lo).toBeCloseTo(page === 5 ? 1.5 : 2 ** (7 / 12), 9);
      // both Cs: the same note (page 4), or the stacked C 23.5 cents above (page 5)
      await click('tuning-both-cs');
      const cs = sounded[sounded.length - 1];
      expect(cs.c2 / cs.c).toBeCloseTo(page === 5 ? 1.01364 : 1, 5);
      expect(q('tuning-both-cs')?.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('Skip goes to the courses page', async () => {
    await act(async () => { root.render(<Harness />); await settle(); });
    await click('tuning-skip');
    expect(location.hash).toBe('#/tuning/8');
    expect(title()).toBe('What matters most');
    await click('tuning-course-third');
    expect(location.hash).toBe('#/intonation/third');
  });
});
