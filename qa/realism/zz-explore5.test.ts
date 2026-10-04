import { it } from 'vitest';
import { synthPassage, renderTake, CAL_MS } from './fastnotes';
import { SINGERS, CHANNELS } from './singer';
import { trackOffline, PITCH_CURRENT, type PitchImpl } from './tracker';
import { scoreAttempt } from '../../src/game/scoring';
import { detectPitch, gatePitch, PitchSmoother } from '../../src/audio/pitch';
import { levelSetup, oracleSamples } from './harness';
import { hashSeed } from './prng';
const ident = () => ({ push: (m: number | null) => m });
// Spike-rejecting smoother: output the middle of the last 3 voiced readings unless it sticks out from both neighbours by > T.
function spike(T: number, resetAfter: number, delayFirst: boolean) {
  return () => {
    let h: number[] = []; let un = 0;
    return { push(m: number | null) {
      if (m == null) { un++; if (un >= resetAfter) h = []; return null; }
      un = 0; h.push(m); if (h.length > 3) h.shift();
      if (h.length < 3) return delayFirst && h.length === 2 ? h[0] : h[h.length - 1];
      const [a, b, c] = h;
      if ((b - a > T && b - c > T) || (a - b > T && c - b > T)) return [a, b, c].sort((x, y) => x - y)[1];
      return b;
    } };
  };
}
// One-frame look-ahead: push(m_k) returns the value for frame k-1 (null if k-1 unvoiced); a spike
// (k-1 away from both voiced neighbours by > T, same side) is replaced by the median (medAlways: always median).
function delayed(T: number, medAlways = false) {
  return () => {
    let a: number | null = null, b: number | null = null;
    return { push(m: number | null) {
      const prev = a, mid = b; a = b; b = m;
      if (mid == null) return null;
      if (prev == null || m == null) return mid;
      const med = [prev, mid, m].sort((x, y) => x - y)[1];
      if (medAlways) return med;
      if ((mid - prev > T && mid - m > T) || (prev - mid > T && m - mid > T)) return med;
      return mid;
    } };
  };
}
const IMPLS: Record<string, { impl: PitchImpl; stampHop: boolean }> = {
  'dly spk1.5': { impl: { ...PITCH_CURRENT, newSmoother: delayed(1.5) }, stampHop: true },
  'dly spk1.0': { impl: { ...PITCH_CURRENT, newSmoother: delayed(1.0) }, stampHop: true },
  'dly med3': { impl: { ...PITCH_CURRENT, newSmoother: delayed(0, true) }, stampHop: true },
  'cur': { impl: PITCH_CURRENT, stampHop: true },
  'raw': { impl: { ...PITCH_CURRENT, newSmoother: ident }, stampHop: false },
  //'raw-hop': { impl: { ...PITCH_CURRENT, newSmoother: ident }, stampHop: true },
  //'cur-nohop': { impl: PITCH_CURRENT, stampHop: false },
  //'spk1.5 r3': { impl: { ...PITCH_CURRENT, newSmoother: spike(1.5, 3, false) }, stampHop: true },
  //'spk1.5 r1': { impl: { ...PITCH_CURRENT, newSmoother: spike(1.5, 1, false) }, stampHop: true },
  'spk1.5 r1 d': { impl: { ...PITCH_CURRENT, newSmoother: spike(1.5, 1, true) }, stampHop: true },
};
it('tracker variants', async () => {
  for (const [chName, ch] of [['phone', CHANNELS.phoneHeadphones], ['clean', CHANNELS.clean]] as const) {
    for (const bpm of [104, 144]) for (const ly of ['ta', 'a', null] as const) {
      const p = synthPassage(bpm, 0.25, ly);
      const res: Record<string, number[]> = {};
      for (const level of [2, 4]) for (const seed of [1, 2, 3]) {
        const take = renderTake(p, SINGERS.goodChoir, level, seed, ch);
        const L = levelSetup(level);
        const opts = { toleranceCents: L.toleranceCents, tuning: 'equal' as const, octaveTolerant: false };
        const ctx = { score: p.score, part: p.part, range: p.range };
        const miss = (s: any[]) => { const r = scoreAttempt(ctx, s, opts); return r.notes.filter(n => n.grade === 'miss' || n.grade === 'ok').length / r.notes.length; };
        (res[`oracle L${level}`] ??= []).push(miss(oracleSamples(take, { latencyMs: CAL_MS, from: p.from })));
        for (const [name, v] of Object.entries(IMPLS)) {
          const rd = trackOffline(take.pcm, take.sampleRate, { windowN: 1024, jitterMs: 3, seed: hashSeed('hop', seed), impl: v.impl });
          const s = rd.map(r => ({ time: take.scoreTimeAtSample0 + ((v.stampHop ? r.stampSec : r.centreSec) - CAL_MS / 1000) * take.rate, midi: r.midi, clarity: r.clarity, rms: r.rms })).filter(x => x.time > p.from - 0.6);
          (res[`${name} L${level}`] ??= []).push(miss(s));
        }
      }
      const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
      console.log(chName, p.id.padEnd(24), Object.entries(res).map(([k, v]) => `${k} ${(100 * mean(v)).toFixed(1)}`).join(' | '));
    }
  }
});
