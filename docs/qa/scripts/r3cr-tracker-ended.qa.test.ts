// QA round 3 code review: shared mic tracker stays cached after its track ends (CR-02).
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r3cr-tracker-ended --silent=false
import { describe, it, expect, vi } from 'vitest';

const node = () => ({ connect() {}, disconnect() {} });
const fakeCtx = {
  state: 'running', currentTime: 1, sampleRate: 48000, destination: {},
  createMediaStreamSource: () => node(),
  createAnalyser: () => ({ ...node(), fftSize: 2048, smoothingTimeConstant: 0, getFloatTimeDomainData() {} }),
  createGain: () => ({ ...node(), gain: { value: 1 } }),
  addEventListener() {}, removeEventListener() {},
};
vi.mock('../../../src/audio/context', () => ({ getAudioContext: () => fakeCtx, unlockAudio: async () => {}, outputLatencySec: () => 0 }));

import { getTracker } from '../../../src/ui/play/session';

describe('CR-02 dead tracker is reused', () => {
  it('after the mic track fires "ended", getTracker() returns the stopped tracker', async () => {
    let endedHandler: (() => void) | null = null;
    let gumCalls = 0;
    const track = { addEventListener: (ev: string, cb: () => void) => { if (ev === 'ended') endedHandler = cb; }, stop() {} };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { gumCalls++; return stream; } } });
    const t1 = await getTracker();
    endedHandler!(); // headset unplugged / OS revoked capture / phone call
    const t2 = await getTracker();
    let got = 0;
    t2.onPitch(() => got++);
    (t2 as unknown as { tick(): void }).tick();
    console.log('CR-02', JSON.stringify({ same: t1 === t2, gumCalls, readingsDelivered: got }));
    expect(t2).not.toBe(t1);
  });
});
