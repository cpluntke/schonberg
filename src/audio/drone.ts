// Held tones for the intonation lab: steady (no vibrato), rich in overtones so the beating between
// partials is easy to hear, retunable while they sound (tuning by hand).

import { synthBus } from './synth';

/** Harmonics 1..N at 1/n: like a soft reed organ. The 4th–6th partials carry the beats of a third. */
const PARTIALS = 10;
const ATTACK = 0.12;
const RELEASE = 0.25;

interface Tone { osc: OscillatorNode; env: GainNode }

export class Drone {
  private tones = new Map<string, Tone>();
  private out: GainNode;
  private wave: PeriodicWave;

  constructor(private ctx: AudioContext, gain = 0.5) {
    this.out = ctx.createGain();
    this.out.gain.value = gain;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4000;
    lp.Q.value = 0.3;
    this.out.connect(lp).connect(synthBus(ctx));
    const re = new Float32Array(PARTIALS + 1);
    const im = new Float32Array(PARTIALS + 1);
    for (let n = 1; n <= PARTIALS; n++) im[n] = 1 / n;
    this.wave = ctx.createPeriodicWave(re, im);
  }

  /** Sound exactly these tones (id → Hz): new ones fade in, missing ones fade out, the rest glide. */
  set(tones: Record<string, number>, level = 0.16) {
    const now = this.ctx.currentTime;
    for (const [id, t] of this.tones) {
      if (id in tones) continue;
      this.release(t, now);
      this.tones.delete(id);
    }
    for (const [id, hz] of Object.entries(tones)) {
      const t = this.tones.get(id);
      if (t) {
        t.osc.frequency.setTargetAtTime(hz, now, 0.015);
        continue;
      }
      const osc = this.ctx.createOscillator();
      osc.setPeriodicWave(this.wave);
      osc.frequency.value = hz;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(level, now + ATTACK);
      osc.connect(env).connect(this.out);
      osc.start(now);
      this.tones.set(id, { osc, env });
    }
  }

  stop() {
    const now = this.ctx.currentTime;
    for (const t of this.tones.values()) this.release(t, now);
    this.tones.clear();
  }

  get playing() { return this.tones.size > 0; }

  private release(t: Tone, now: number) {
    t.env.gain.cancelScheduledValues(now);
    t.env.gain.setValueAtTime(t.env.gain.value, now);
    t.env.gain.linearRampToValueAtTime(0, now + RELEASE);
    t.osc.stop(now + RELEASE + 0.05);
    t.osc.onended = () => { t.osc.disconnect(); t.env.disconnect(); };
  }
}
