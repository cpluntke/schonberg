import { describe, expect, it } from 'vitest';
import { detectOnsets, latencyFromOnsets } from './latency';

function readings(beats: number[], latency: number, opts: { miss?: number[] } = {}) {
  const out: { ctxTime: number; rms: number; midi: number | null }[] = [];
  for (let t = 0; t < beats[beats.length - 1] + 1; t += 0.02) {
    let rms = 0.003;
    let midi: number | null = null;
    beats.forEach((b, i) => {
      if (opts.miss?.includes(i)) return;
      const on = b + latency;
      if (t >= on && t < on + 0.25) {
        rms = 0.2;
        midi = 57;
      }
    });
    out.push({ ctxTime: t, rms, midi });
  }
  return out;
}

describe('latency', () => {
  const beats = [1.3, 1.967, 2.633, 3.3, 3.967, 4.633];
  it('recovers a constant latency', () => {
    const r = latencyFromOnsets(beats, detectOnsets(readings(beats, 0.18), beats));
    expect(r.ok).toBe(true);
    expect(Math.abs(r.latencyMs - 180)).toBeLessThanOrEqual(25);
  });
  it('fails with fewer than 3 detections', () => {
    const r = latencyFromOnsets(beats, detectOnsets(readings(beats, 0.1, { miss: [0, 1, 2, 3] }), beats));
    expect(r.ok).toBe(false);
  });
  it('clamps', () => {
    expect(latencyFromOnsets([0, 1, 2], [-0.1, 0.9, 1.95]).latencyMs).toBe(0);
    expect(latencyFromOnsets([0, 1, 2], [0.7, 1.7, 2.7]).latencyMs).toBe(500);
  });
});
