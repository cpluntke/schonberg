// QA round 3 code review: PracticeSession start()/dispose() race (CR-01) with mocked audio.
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r3cr-session-race --silent=false
import { describe, it, expect, vi } from 'vitest';

const plays: { id: number; opts: unknown }[] = [];
const endedCbs = new Map<number, Set<() => void>>();
let nextId = 0;
let resolveTracker: ((t: unknown) => void) | null = null;

vi.mock('../../../src/audio/context', () => {
  const ctx = { state: 'running', currentTime: 0, addEventListener() {}, removeEventListener() {} };
  return { getAudioContext: () => ctx, unlockAudio: async () => {}, outputLatencySec: () => 0 };
});
vi.mock('../../../src/audio/pitch', () => ({
  PitchTracker: {
    create: () => new Promise((res) => { resolveTracker = res; }),
  },
}));
vi.mock('../../../src/audio/player', () => ({
  beatsInMeasure: () => 4,
  beatSecAt: () => 0.5,
  ScorePlayer: class {
    id = nextId++;
    position = 0;
    constructor() { endedCbs.set(this.id, new Set()); }
    play(opts: unknown) { plays.push({ id: this.id, opts }); }
    stop() {}
    scoreTimeAt() { return 0; }
    setPartGain() {}
    onEnded(cb: () => void) { endedCbs.get(this.id)!.add(cb); return () => endedCbs.get(this.id)!.delete(cb); }
  },
}));

import { PracticeSession } from '../../../src/ui/play/session';
import { makePart, makeScore } from '../../../src/game/testutil';

describe('CR-01 start() continues after dispose()', () => {
  it('disposed while waiting for the mic → still starts playback and later fires onDone', async () => {
    const part = makePart('S', [[60, 1], [62, 1], [64, 1], [65, 1]]);
    const score = makeScore([part]);
    const onDone = vi.fn();
    const s = new PracticeSession({
      score, part, from: 0, to: 4, rate: 1, guide: true, listenOnly: false, cue: 'note',
      scoring: { toleranceCents: 50, tuning: 'equal', octaveTolerant: false }, latencyMs: 100, range: [0, 3],
    }, onDone);
    const p = s.start();            // user taps Start; mic permission prompt is open
    await new Promise((r) => setTimeout(r, 0));
    s.dispose();                    // user taps Back / screen unmounts
    resolveTracker!({ onPitch: () => () => {}, stop() {} }); // user grants permission
    await p;
    const playedAfterDispose = plays.length;
    // simulate the section ending
    for (const cb of endedCbs.get(0)!) cb();
    console.log('CR-01', JSON.stringify({ playedAfterDispose, phaseAfter: s.phase, onDoneCalls: onDone.mock.calls.length }));
    expect(playedAfterDispose).toBe(0);
    expect(onDone).not.toHaveBeenCalled();
  });
});
