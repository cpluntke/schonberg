import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoute } from '../router';

// (no Web Audio in jsdom: the sounds are stand-ins that remember what they were asked to play)
const sounded: Record<string, number>[] = [];
vi.mock('../../audio/context', () => ({ getAudioContext: () => ({ currentTime: 0 }), unlockAudio: async () => {} }));
vi.mock('../../audio/drone', () => ({
  Drone: class {
    set(t: Record<string, number>) { sounded.push(t); }
    stop() {}
    dispose() {}
  },
}));
const cadences: number[][][] = [];
vi.mock('../../audio/cadence', () => ({
  ChordPlayer: class {
    play(hz: number[][], _midi: unknown, at: number) {
      cadences.push(hz);
      return { starts: hz.map((_, i) => at + i * 0.05), end: at + hz.length * 0.05 };
    }
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

async function input(id: string, value: number) {
  const el = q(id) as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { set.call(el, String(value)); el.dispatchEvent(new Event('input', { bubbles: true })); await settle(); });
}
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('Why choirs tune differently', () => {
  const titles = [
    'The string', 'Why? The waves', 'Find them yourself', 'The big question', 'So why not make every interval just?', 'Now stack just fifths',
    'Share it out', 'Choirs have a luxury', 'Hear a cadence', 'What matters most',
  ];
  const N = titles.length;

  it('ten pages, with Next and Back; seen once the last page is reached', async () => {
    await act(async () => { root.render(<Harness />); await settle(); });
    expect(title()).toBe(titles[0]);
    expect(q('tuning-back')).toBeNull(); // (page 1: nothing before it)
    expect(q('tuning-next')).not.toBeNull();
    expect(q('tuning-string')).not.toBeNull();
    for (let i = 1; i < N; i++) {
      expect(tuningSeen()).toBe(false);
      await click('tuning-next');
      expect(title()).toBe(titles[i]);
      expect(location.hash).toBe(`#/tuning/${i + 1}`);
      expect(q('tuning-back')).not.toBeNull();
      expect(document.querySelector('[aria-current="step"]')?.getAttribute('aria-label')).toBe(`Page ${i + 1} of ${N}: ${titles[i]}`);
    }
    // the last page: the two courses, the fifth first; Done instead of Next, no Skip
    expect(q('tuning-next')).toBeNull();
    expect(q('tuning-skip')).toBeNull();
    expect(q('tuning-done')).not.toBeNull();
    const courses = Array.from(document.querySelectorAll('[data-testid^="tuning-course-"]')).map((e) => e.getAttribute('data-testid'));
    expect(courses).toEqual(['tuning-course-fifth', 'tuning-course-third']);
    expect(tuningSeen()).toBe(true);
    await click('tuning-back');
    expect(title()).toBe(titles[N - 2]);
    expect(location.hash).toBe(`#/tuning/${N - 1}`);
  });

  it('nothing sounds before a tap', async () => {
    sounded.length = 0;
    cadences.length = 0;
    for (let p = 1; p <= N; p++) await act(async () => { root.render(<TuningScreen page={p} key={p} />); await settle(); });
    expect(sounded).toEqual([]);
    expect(cadences).toEqual([]);
  });

  it('each page has a picture and a sound to play; the sliders say what they mean', async () => {
    const pictures = ['tuning-string', 'tuning-waves', 'tuning-string', null, 'tuning-circle', 'tuning-circle', 'tuning-circle', 'tuning-pulse', 'tuning-staff'];
    for (let p = 1; p <= N - 1; p++) {
      await act(async () => { root.render(<TuningScreen page={p} />); await settle(); });
      if (pictures[p - 1]) expect(q(pictures[p - 1]!), `page ${p}`).not.toBeNull();
      // (a play / stop button; pages 5 and 6 play each fifth as it's tapped)
      expect(document.querySelectorAll('button[aria-pressed], [data-testid="tuning-add-fifth"]').length, `page ${p}`).toBeGreaterThan(0);
    }
    await act(async () => { root.render(<TuningScreen page={1} />); await settle(); });
    const s = q('tuning-bridge-slider') as HTMLInputElement;
    expect(s.getAttribute('aria-valuetext')).toBe('Bridge at 84.0% of the string');
    expect(document.querySelector('label[for="tun-bridge"]')).not.toBeNull();
    expect(q('tuning-bridge')?.getAttribute('role')).toBe('slider');
  });

  it('the string: the octave at half, the fifth at two thirds, the part sounding f / fraction', async () => {
    await act(async () => { root.render(<TuningScreen page={1} />); await settle(); });
    expect(q('tuning-task-octave')?.getAttribute('data-done')).toBe('false');
    sounded.length = 0;
    await click('tuning-part');
    expect(sounded[sounded.length - 1].part).toBeCloseTo(196 / 0.84, 6);
    // the bridge near half, resting: found, and it settles on the spot (and the part follows)
    await input('tuning-bridge-slider', 0.505);
    await wait(700);
    expect(q('tuning-task-octave')?.getAttribute('data-done')).toBe('true');
    expect(q('tuning-bridge')?.getAttribute('aria-valuetext')).toBe('Bridge at half the string');
    expect(sounded[sounded.length - 1].part).toBeCloseTo(392, 6);
    // the keys move the bridge too
    await act(async () => { q('tuning-bridge')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle(); });
    expect(Number(q('tuning-bridge')?.getAttribute('aria-valuenow'))).toBeCloseTo(0.505, 6);
    // Show me: both marks, the bridge at the next spot
    await click('tuning-showme');
    expect(q('tuning-string')?.textContent).toContain('⅔');
    expect(q('tuning-string')?.textContent).toContain('½');
  });

  it('find them yourself: the whole string sounds with the part; still at the exact ratio, ticked when held', async () => {
    await act(async () => { root.render(<TuningScreen page={3} />); await settle(); });
    sounded.length = 0;
    await click('tuning-find-play');
    expect(sounded[0]).toEqual({ whole: 196, part: 196 / 0.8 });
    await input('tuning-bridge-slider', 0.51);
    expect(q('tuning-near')?.textContent).toBe('Near the octave');
    expect(q('tuning-rate')?.textContent).toBe('About 8 beats a second'); // |196/0.51 − 392|
    await input('tuning-bridge-slider', 0.5);
    expect(q('tuning-rate')?.textContent).toBe('Still');
    expect(q('tuning-task-octave')?.getAttribute('data-done')).toBe('false');
    await wait(1100);
    expect(q('tuning-task-octave')?.getAttribute('data-done')).toBe('true');
    await input('tuning-bridge-slider', 0.6665);
    expect(q('tuning-near')?.textContent).toBe('Near the fifth');
    await wait(1100);
    expect(q('tuning-task-fifth')?.getAttribute('data-done')).toBe('true');
    expect(q('tuning-found-both')).not.toBeNull();
  });

  it('the big question: two fifths to play, then the answer', async () => {
    await act(async () => { root.render(<TuningScreen page={4} />); await settle(); });
    expect(q('tuning-answer')).toBeNull();
    sounded.length = 0;
    await click('tuning-just-fifth');
    expect(sounded[0].sol / sounded[0].do).toBeCloseTo(1.5, 9);
    await click('tuning-piano-fifth');
    expect(sounded[1].sol / sounded[1].do).toBeCloseTo(2 ** (7 / 12), 9);
    await click('tuning-reveal');
    const a = q('tuning-answer')!.textContent!;
    expect(a).toContain('Exactly the same');
    expect(a).toContain('700 cents');
    expect(a).toContain('702');
    expect(a).toContain('100 from one piano key to the next');
    expect(q('tuning-zoom')?.textContent).toContain('0.6674');
    expect(q('tuning-zoom')?.textContent).toContain('0.6667');
    expect(q('tuning-reveal')).toBeNull();
  });

  it('twelve just fifths overshoot C by the comma; twelve piano fifths close the circle', async () => {
    for (const [page, end] of [[5, 'C again'], [6, '23.5 cents']] as const) {
      await act(async () => { root.render(<TuningScreen page={page} key={page} />); await settle(); });
      for (let i = 0; i < 12; i++) await click('tuning-add-fifth');
      expect(q('tuning-circle')?.textContent, `page ${page}`).toContain(end);
      expect(q('tuning-add-fifth')?.textContent).toBe('Start again');
      expect(q('tuning-both-cs')).not.toBeNull();
      // each tap played a fifth: just on page 6, the piano's on page 5
      const step = sounded[sounded.length - 1];
      expect(step.hi / step.lo).toBeCloseTo(page === 6 ? 1.5 : 2 ** (7 / 12), 9);
      // both Cs: the same note (page 5), or the stacked C 23.5 cents above (page 6)
      await click('tuning-both-cs');
      const cs = sounded[sounded.length - 1];
      expect(cs.c2 / cs.c).toBeCloseTo(page === 6 ? 1.01364 : 1, 5);
      expect(q('tuning-both-cs')?.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('share it out: the circle closes, and it has a name', async () => {
    await act(async () => { root.render(<TuningScreen page={7} />); await settle(); });
    expect(q('tuning-et')).toBeNull();
    await click('tuning-share');
    expect(q('tuning-et')?.textContent).toContain('equal temperament');
    expect(q('tuning-et')?.textContent).toContain('every fifth is 700 cents');
    expect(q('tuning-each-fifth')?.textContent).toBe('Each fifth: 700.0 cents');
  });

  it('the cadence: the piano’s pitches, or each chord just; the chord that sounds is lit', async () => {
    await act(async () => { root.render(<TuningScreen page={9} />); await settle(); });
    cadences.length = 0;
    await click('tuning-cadence-just');
    expect(cadences).toHaveLength(1);
    const [I] = cadences[0];
    // C E G in 4 : 5 : 6 over the piano's C
    expect(I[0]).toBeCloseTo(130.813, 3);
    expect(I[2] / (2 * I[0])).toBeCloseTo(5 / 4, 9);
    expect(I[1] / I[0]).toBeCloseTo(3 / 2, 9);
    await wait(120);
    expect(document.querySelector('[data-on="true"]')).not.toBeNull();
    await wait(300);
    expect(q('tuning-cadence-just')?.getAttribute('aria-pressed')).toBe('false');
    await click('tuning-cadence-both');
    expect(cadences).toHaveLength(3);
    expect(cadences[1][1][1]).toBeCloseTo(440 * 2 ** ((57 - 69) / 12), 6); // the piano first: its A
  });

  it('Skip goes to the courses page', async () => {
    await act(async () => { root.render(<Harness />); await settle(); });
    await click('tuning-skip');
    expect(location.hash).toBe(`#/tuning/${N}`);
    expect(title()).toBe('What matters most');
    expect(tuningSeen()).toBe(true);
    await click('tuning-course-third');
    expect(location.hash).toBe('#/intonation/third');
  });
});
