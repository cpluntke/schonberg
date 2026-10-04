// QA: main-thread cost of one PitchTracker tick (McLeod on 2048 samples) and detector behaviour on
// synthetic voice frames: breathy noise, low bass, vibrato, octave (sub-harmonic) robustness.
import { test } from 'vitest';
import { detectPitch, gatePitch, hzToMidi, PitchSmoother } from '../../../src/audio/pitch';
const SR = 48000;
function frame(f0: number, opts: { noise?: number; amp?: number; h?: number[]; t0?: number } = {}) {
  const N = 2048; const a = new Float32Array(N); const h = opts.h ?? [1, 0.55, 0.35, 0.22, 0.14, 0.09];
  let s = 7; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  for (let i = 0; i < N; i++) { const t = i / SR + (opts.t0 ?? 0); let v = 0; for (let k = 0; k < h.length; k++) v += h[k] * Math.sin(2 * Math.PI * f0 * (k + 1) * t); a[i] = (opts.amp ?? 0.1) * v + (opts.noise ?? 0) * rnd(); }
  return a;
}
test('pitch cost & robustness', () => {
  const f = frame(220);
  for (let i = 0; i < 50; i++) detectPitch(f, SR);
  const t0 = performance.now(); const n = 500;
  for (let i = 0; i < n; i++) detectPitch(f, SR);
  const per = (performance.now() - t0) / n;
  const lines = [`detectPitch(2048) = ${per.toFixed(3)} ms/tick on this machine → ×50/s = ${(per * 50).toFixed(1)} ms/s main thread (≈${(per * 50 / 10).toFixed(1)}% CPU); at 5× slower phone ≈ ${(per * 5).toFixed(2)} ms/tick`];
  const cases: [string, Float32Array][] = [
    ['A3 clean', frame(220)],
    ['A3 breathy (noise 0.05 vs amp 0.1)', frame(220, { noise: 0.05 })],
    ['A3 very breathy (noise 0.1)', frame(220, { noise: 0.1 })],
    ['A3 quiet amp 0.01 (iOS raw-mode level?)', frame(220, { amp: 0.01 })],
    ['A3 quiet amp 0.02', frame(220, { amp: 0.02 })],
    ['E2 bass 82 Hz', frame(82.4)],
    ['D2 bass 73 Hz', frame(73.4)],
    ['C2 bass 65 Hz', frame(65.4)],
    ['bass, weak fundamental (h=[0.2,1,0.7,0.5])', frame(98, { h: [0.2, 1, 0.7, 0.5, 0.3] })],
    ['C6 soprano 1047 Hz', frame(1046.5, { h: [1, 0.3, 0.1] })],
    ['soprano A5 strong 2nd harmonic', frame(880, { h: [0.5, 1, 0.3] })],
  ];
  for (const [name, fr] of cases) {
    const r = detectPitch(fr, SR); const g = gatePitch(r);
    lines.push(`${name.padEnd(44)} hz ${r.hz.toFixed(1).padStart(7)} clarity ${r.clarity.toFixed(2)} rms ${r.rms.toFixed(3)} → ${g == null ? 'GATED (unvoiced)' : 'midi ' + g.toFixed(2)}`);
  }
  console.log(lines.join('\n'));
});
