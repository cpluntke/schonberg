// PracticeSession pause/resume with the audio layer faked (no Web Audio in jsdom).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePart, makeScore } from '../../game/testutil';
import type { RawPitch } from '../../audio/pitch';

const h = vi.hoisted(() => {
  const ctx = {
    state: 'running' as string,
    currentTime: 0,
    sampleRate: 48000,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return {
    ctx,
    unlock: { impl: async () => {} },
    trackers: [] as { alive: boolean; listeners: Set<(p: unknown) => void> }[],
    createTracker: { impl: async (): Promise<unknown> => { throw new Error('unset'); } },
    players: [] as { position: number; plays: { from: number; countInBeats: number }[]; ended: Set<() => void> }[],
  };
});

vi.mock('../../audio/context', () => ({
  getAudioContext: () => h.ctx,
  unlockAudio: () => h.unlock.impl(),
  outputLatencySec: () => 0,
}));

vi.mock('../../audio/player', async (orig) => {
  const real = await orig<typeof import('../../audio/player')>();
  class FakePlayer {
    position = 0;
    plays: { from: number; countInBeats: number }[] = [];
    ended = new Set<() => void>();
    constructor() { h.players.push(this); }
    scoreTimeAt(t: number) { return t; }
    onEnded(cb: () => void) { this.ended.add(cb); return () => { this.ended.delete(cb); }; }
    setPartGain() {}
    play(o: { from: number; countInBeats: number }) { this.plays.push({ from: o.from, countInBeats: o.countInBeats }); this.position = o.from - 1; }
    stop() {}
    fireEnded() { for (const cb of [...this.ended]) cb(); }
  }
  return { ...real, ScorePlayer: FakePlayer };
});

vi.mock('../../audio/pitch', async (orig) => {
  const real = await orig<typeof import('../../audio/pitch')>();
  return { ...real, PitchTracker: { create: () => h.createTracker.impl() } };
});

const { PracticeSession, releaseTracker, RESUME_TIMEOUT_MS } = await import('./session');

function fakeTracker() {
  const t = {
    alive: true,
    listeners: new Set<(p: unknown) => void>(),
    configureFor() {},
    onPitch(cb: (p: unknown) => void) { t.listeners.add(cb); return () => t.listeners.delete(cb); },
    stop() { t.alive = false; },
    sourceNode: {},
    windowN: 2048,
  };
  h.trackers.push(t);
  return t;
}

const part = makePart('S', [[60, 4], [62, 4], [64, 4], [65, 4], [67, 4]]);
const score = makeScore([part]);

function session(onDone = vi.fn()) {
  const s = new PracticeSession({
    score, part, from: 0, to: score.duration, rate: 1, guide: true, listenOnly: false, cue: 'none',
    scoring: { toleranceCents: 50, tuning: 'equal', octaveTolerant: false }, latencyMs: 0.001,
    range: [0, part.notes.length - 1], lowestMidi: 60, beat: 'off',
  }, onDone);
  const player = h.players[h.players.length - 1];
  return { s, player, onDone };
}

const sing = (midi: number, ctxTime: number): RawPitch => ({ ctxTime, hz: 440, midi, clarity: 0.95, rms: 0.1 });
const emit = (p: RawPitch) => { for (const cb of h.trackers[h.trackers.length - 1].listeners) cb(p); };

beforeEach(() => {
  releaseTracker();
  h.ctx.state = 'running';
  h.unlock.impl = async () => {};
  h.trackers.length = 0;
  h.players.length = 0;
  h.createTracker.impl = async () => fakeTracker();
});
afterEach(() => { vi.useRealTimers(); });

describe('PracticeSession resume', () => {
  it('resolves ok and plays again from the pause point', async () => {
    const { s, player } = session();
    await s.start();
    player.position = 6.5;
    s.pause();
    expect(s.phase).toBe('paused');
    expect(await s.resume()).toBe('ok');
    expect(s.phase).toBe('countin');
    expect(player.plays.at(-1)!.from).toBeCloseTo(6.5);
  });

  it('reports a mic that cannot be reopened instead of pretending to run', async () => {
    const { s, player } = session();
    await s.start();
    player.position = 6.5;
    s.pause();
    h.trackers[0].alive = false; // released after a minute in the background
    h.createTracker.impl = async () => { throw new Error('gone'); };
    expect(await s.resume()).toBe('mic');
    expect(s.phase).toBe('paused');
    expect(s.micError).toMatch(/microphone/i);
    expect(player.plays).toHaveLength(1);
  });

  it('times out a hanging context resume (iOS "interrupted") and stays paused', async () => {
    vi.useFakeTimers();
    const { s, player } = session();
    await s.start();
    player.position = 3;
    s.pause();
    h.ctx.state = 'interrupted';
    h.unlock.impl = () => new Promise(() => {}); // never settles
    const r = s.resume();
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS + 10);
    expect(await r).toBe('audio');
    expect(s.phase).toBe('paused');
    // Tapping again once the interruption is over works.
    h.ctx.state = 'running';
    h.unlock.impl = async () => {};
    expect(await s.resume()).toBe('ok');
  });

  it('a resume superseded by another pause is stale', async () => {
    const { s, player } = session();
    await s.start();
    player.position = 3;
    s.pause();
    let release!: () => void;
    h.unlock.impl = () => new Promise<void>((r) => { release = r; });
    const r = s.resume();
    s.pause(); // e.g. backgrounded again
    release();
    expect(await r).toBe('stale');
    expect(s.phase).toBe('paused');
  });
});

describe('PracticeSession pause', () => {
  it('pausing during a resumed run\'s count-in keeps the resume point (no bar twice, samples in order)', async () => {
    const { s, player } = session();
    await s.start();
    player.position = 1; // singing
    emit(sing(60, 0.9));
    player.position = 9;
    emit(sing(62, 8.995));
    s.pause();
    expect(s.resumePoint).toBeCloseTo(9);
    expect(await s.resume()).toBe('ok');
    // In the count-in (the player is a bar before the resume point).
    player.position = 7.2;
    expect(s.phase).toBe('countin');
    emit(sing(62, 7.2)); // before the resume point: dropped
    s.pause();
    expect(s.resumePoint).toBeCloseTo(9);
    expect(await s.resume()).toBe('ok');
    expect(player.plays.at(-1)!.from).toBeCloseTo(9);
    player.position = 9.5;
    emit(sing(62, 8.985)); // within the resume tolerance but earlier than a kept sample: dropped
    emit(sing(62, 9.5));
    const times = s.samples.map((x) => x.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times.at(-1)).toBeCloseTo(9.5);
  });

  it('pausing right after playback ended stays paused; resuming finishes', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { s, player } = session(onDone);
    await s.start();
    player.position = score.duration;
    (player as unknown as { fireEnded(): void }).fireEnded();
    s.pause();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDone).not.toHaveBeenCalled();
    expect(s.phase).toBe('paused');
    expect(await s.resume()).toBe('ok');
    await vi.advanceTimersByTimeAsync(10);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(s.phase).toBe('done');
  });
});
