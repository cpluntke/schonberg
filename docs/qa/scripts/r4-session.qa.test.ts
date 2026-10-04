// QA round 4: real PracticeSession (src/ui/play/session.ts) with mocked audio/mic/player.
// Checks R3-04 (Finish trims notes still in the latency tail), CR-10 (end-of-run tail wait),
// CR-01/CR-04 guards, and edge cases of the new tail timer (pause / dispose / interruption during the tail).
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r4-session --silent=false
import { describe, it, expect, vi } from 'vitest';

const H = vi.hoisted(() => {
  const st = {
    pitchCb: null as ((p: { ctxTime: number; midi: number | null; clarity: number; rms: number }) => void) | null,
    players: [] as any[],
    unlockGate: null as Promise<void> | null,
  };
  class MockPlayer {
    position = 0;
    plays = 0;
    ended = new Set<() => void>();
    constructor() { st.players.push(this); }
    play() { this.plays++; }
    stop() {}
    scoreTimeAt(ctx: number) { return ctx; }
    setPartGain() {}
    onEnded(cb: () => void) { this.ended.add(cb); return () => this.ended.delete(cb); }
    fireEnded() { for (const cb of [...this.ended]) cb(); }
  }
  return { st, MockPlayer };
});
vi.mock('../../../src/audio/context', () => {
  const ctx = { state: 'running', currentTime: 0, addEventListener() {}, removeEventListener() {} };
  return { getAudioContext: () => ctx, unlockAudio: async () => { if (H.st.unlockGate) await H.st.unlockGate; }, outputLatencySec: () => 0 };
});
vi.mock('../../../src/audio/pitch', () => ({
  PitchTracker: { create: async () => ({ alive: true, onPitch: (cb: never) => { H.st.pitchCb = cb; return () => { H.st.pitchCb = null; }; }, stop() {} }) },
}));
vi.mock('../../../src/audio/player', () => ({ beatsInMeasure: () => 4, beatSecAt: () => 0.5, ScorePlayer: H.MockPlayer }));

import { PracticeSession } from '../../../src/ui/play/session';
import { makePart, makeScore } from '../../../src/game/testutil';
import type { AttemptResult } from '../../../src/game/types';

const part = makePart('S', [[60, 1], [62, 1], [64, 1], [65, 1], [67, 1]], 120); // five 0.5 s notes
const score = makeScore([part], 120);
const END = 2.5;
function mk(latencyMs: number, onDone: (r: AttemptResult | null) => void) {
  return new PracticeSession({
    score, part, from: 0, to: END, rate: 1, guide: true, listenOnly: false, cue: 'note',
    scoring: { toleranceCents: 35, tuning: 'equal', octaveTolerant: false }, latencyMs, range: [0, 4],
  }, onDone);
}
/** Feed perfectly sung samples for sung score time in [t0, t1); they arrive at ctx = t + latency (lat in ms). */
function feed(t0: number, t1: number, lat: number) {
  for (let t = t0; t < t1 - 1e-9; t += 0.01) {
    const n = part.notes.find((x) => t >= x.start + 0.02 && t < x.start + x.dur - 0.02);
    H.st.pitchCb?.({ ctxTime: t + lat / 1000, midi: n ? n.midi : null, clarity: n ? 0.95 : 0.2, rms: n ? 0.1 : 0.002 });
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('R4 session', () => {
  it('R3-04: Finish right after note 3 ends, latency 80/150/250 ms', async () => {
    for (const lat of [80, 150, 250]) {
      let res: AttemptResult | null = null;
      const s = mk(lat, (r) => { res = r; });
      await s.start();
      const p = H.st.players[H.st.players.length - 1];
      const pos = part.notes[2].start + part.notes[2].dur + 0.01;
      p.position = 0.1; void s.position; // countin → playing
      feed(-0.2, pos - lat / 1000, lat); // only what has arrived
      p.position = pos;
      s.finish();
      const r = res as AttemptResult | null;
      console.log('R4-partial', JSON.stringify({ lat, partial: s.partial, scored: r?.notes.length ?? 0, grades: r?.notes.map((n) => n.grade), acc: r ? Math.round(r.accuracy * 100) : null }));
      expect(r?.notes.every((n) => n.grade === 'perfect') ?? true).toBe(true);
    }
  });

  it('CR-10: natural end waits for the latency tail (250 ms)', async () => {
    const lat = 250;
    let res: AttemptResult | null = null; let calls = 0;
    const s = mk(lat, (r) => { res = r; calls++; });
    await s.start();
    const p = H.st.players[H.st.players.length - 1];
    p.position = 0.1; void s.position;
    feed(-0.2, END - lat / 1000, lat);
    p.position = END;
    p.fireEnded();
    const phaseAtEnd = s.phase;
    feed(END - lat / 1000, END + 0.05, lat); // late samples arrive during the tail
    await wait(lat + 200);
    const r = res as AttemptResult | null;
    console.log('R4-tail', JSON.stringify({ phaseAtEnd, calls, partial: s.partial, grades: r?.notes.map((n) => n.grade), lastHit: r?.notes[4].hitRatio }));
    expect(r?.notes[4].grade).toBe('perfect');
    expect(calls).toBe(1);
  });

  it('tail edge: pause (or interruption) during the tail, dispose during the tail', async () => {
    // pause in tail
    let calls = 0; let res: AttemptResult | null = null;
    const s = mk(250, (r) => { res = r; calls++; });
    await s.start();
    const p = H.st.players[H.st.players.length - 1];
    p.position = 0.1; void s.position;
    feed(-0.2, END, 250);
    p.position = END; p.fireEnded();
    s.pause();
    const phaseAfterPause = s.phase;
    await wait(500);
    console.log('R4-tail-pause', JSON.stringify({ phaseAfterPause, onDoneCalls: calls, phaseLater: s.phase, partial: s.partial, notes: (res as AttemptResult | null)?.notes.length }));
    // dispose in tail
    let calls2 = 0;
    const s2 = mk(250, () => { calls2++; });
    await s2.start();
    const p2 = H.st.players[H.st.players.length - 1];
    p2.position = END; void s2.position; p2.fireEnded();
    s2.dispose();
    await wait(500);
    console.log('R4-tail-dispose', JSON.stringify({ onDoneCalls: calls2 }));
    expect(calls2).toBe(0);
  });

  it('CR-04: pause tapped while resume() awaits unlockAudio', async () => {
    const s = mk(80, () => {});
    await s.start();
    const p = H.st.players[H.st.players.length - 1];
    p.position = 1; void s.position;
    s.pause();
    const before = p.plays;
    let release!: () => void; H.st.unlockGate = new Promise((r) => { release = r; });
    const rp = s.resume();
    s.pause(); // singer taps Pause again while resume is pending
    release(); await rp; H.st.unlockGate = null;
    console.log('R4-resume-race', JSON.stringify({ playsAfter: p.plays - before, phase: s.phase }));
    expect(p.plays - before).toBe(0);
    expect(s.phase).toBe('paused');
  });
});
