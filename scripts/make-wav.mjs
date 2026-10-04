#!/usr/bin/env node
// Generate a mono 48 kHz 16-bit WAV with a vocal-ish tone sequence (for fake-mic e2e tests).
// Usage: node scripts/make-wav.mjs out.wav 57:1 59:1 rest:0.5 62:2
//   <midi>:<seconds> sings that MIDI note (fractional allowed), rest:<seconds> is silence.
import { writeFileSync } from 'node:fs';

const SR = 48000;
const [, , out, ...specs] = process.argv;
if (!out || specs.length === 0) {
  console.error('usage: node scripts/make-wav.mjs out.wav 57:1 59:1 rest:0.5 62:2');
  process.exit(1);
}

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
const HARM = [1, 0.55, 0.35, 0.22, 0.14, 0.09, 0.05, 0.03];

const segs = specs.map((s) => {
  const [a, b] = s.split(':');
  const dur = Number(b);
  if (!(dur > 0)) throw new Error(`bad duration in "${s}"`);
  return { midi: a === 'rest' ? null : Number(a), dur };
});
const total = Math.round(segs.reduce((t, s) => t + s.dur, 0) * SR);
const pcm = new Int16Array(total);
let idx = 0;
let phase = 0;
for (const { midi, dur } of segs) {
  const n = Math.round(dur * SR);
  const f0 = midi == null ? 0 : 440 * 2 ** ((midi - 69) / 12);
  for (let i = 0; i < n; i++, idx++) {
    const t = i / SR;
    let v = 0.002 * rand(); // room noise
    if (midi != null) {
      // attack/release 40 ms, vibrato 5.5 Hz ±25 cents fading in after 0.3 s
      const env = Math.min(1, t / 0.04, (dur - t) / 0.04);
      const vibDepth = 25 * Math.min(1, Math.max(0, (t - 0.3) / 0.3));
      const f = f0 * 2 ** ((vibDepth * Math.sin(2 * Math.PI * 5.5 * t)) / 1200);
      phase += (2 * Math.PI * f) / SR;
      let s = 0;
      for (let h = 0; h < HARM.length; h++) s += HARM[h] * Math.sin((h + 1) * phase);
      v += env * (0.25 * s + 0.006 * rand());
    }
    pcm[idx] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.byteLength, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.byteLength, 40);
writeFileSync(out, Buffer.concat([header, Buffer.from(pcm.buffer)]));
console.log(`wrote ${out} (${(total / SR).toFixed(2)} s)`);
