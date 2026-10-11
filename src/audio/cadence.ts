// A few held chords one after the other, for the tuning explainer's cadence (ui/screens/Tuning.tsx):
// a warm, steady organ-choir sound (no vibrato: it would hide the beating), soft attacks, legato
// from chord to chord (a voice that keeps its note just retunes it), a longer last chord, and a
// small room. Scheduled on the audio clock, so the timing holds on a busy phone.

import { synthBus } from './synth';

/** Partials 1..12: 1/n up to the 6th (the 4th–6th carry the beating of a third), then a softer 1/n² roll-off so the chord isn't buzzy. */
export const CHOIR_PARTIALS = 12;
export function choirPartial(n: number): number {
  return n <= 6 ? 1 / n : (1 / 6) * (6 / n) ** 2;
}

/** Bass a little stronger, inner voices a little softer, the soprano clear (per-voice level, bass first). */
export const VOICE_LEVELS = [0.064, 0.044, 0.044, 0.054];

export interface CadenceShape {
  /** Seconds from one chord to the next. */
  chordSec: number;
  /** How long the last chord holds before it fades. */
  lastSec: number;
  attack: number;
  /** The crossfade from one chord into the next. */
  xfade: number;
  /** The last chord's fade. */
  release: number;
}
export const SHAPE: CadenceShape = { chordSec: 2.3, lastSec: 3.2, attack: 0.15, xfade: 0.14, release: 0.9 };

/** When each chord starts after the first and when the sound has died away (seconds). */
export function cadenceTimes(chords: number, s: CadenceShape = SHAPE): { starts: number[]; end: number } {
  const starts = Array.from({ length: chords }, (_, i) => i * s.chordSec);
  return { starts, end: (chords - 1) * s.chordSec + s.lastSec + s.release };
}

/**
 * Each voice's notes as held segments: a voice that keeps its note from one chord to the next holds
 * it (and retunes it if the chord asks). `midi[i][v]`: chord i, voice v.
 */
export function voiceSegments(midi: readonly (readonly number[])[]): { voice: number; from: number; to: number }[] {
  const out: { voice: number; from: number; to: number }[] = [];
  const voices = midi[0]?.length ?? 0;
  for (let v = 0; v < voices; v++) {
    let from = 0;
    for (let i = 1; i <= midi.length; i++) {
      if (i < midi.length && midi[i][v] === midi[i - 1][v]) continue;
      out.push({ voice: v, from, to: i - 1 });
      from = i;
    }
  }
  return out;
}

interface Held { osc: OscillatorNode; env: GainNode }

/** A small generated room: decaying stereo noise, darkened a little, about 1.2 s to silence. */
function roomImpulse(ctx: BaseAudioContext, decay = 1.2): AudioBuffer {
  const len = Math.round(ctx.sampleRate * (decay + 0.1));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  // (a fixed seed: the same room every time)
  let seed = 22222;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    const pre = Math.round(ctx.sampleRate * 0.012);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / ctx.sampleRate;
      lp += 0.35 * (rnd() - lp); // one-pole low-pass: a warmer tail
      d[i] = lp * Math.exp((-6.9 * t) / decay);
    }
  }
  return buf;
}

export class ChordPlayer {
  private out: GainNode;
  private lp: BiquadFilterNode;
  private wet: GainNode;
  private verb: ConvolverNode;
  private wave: PeriodicWave;
  private held: Held[] = [];
  private closed = false;

  constructor(private ctx: BaseAudioContext) {
    this.out = ctx.createGain();
    const lp = this.lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    lp.Q.value = 0.3;
    this.verb = ctx.createConvolver();
    this.verb.buffer = roomImpulse(ctx);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.2;
    const bus = synthBus(ctx);
    this.out.connect(lp);
    lp.connect(bus); // dry
    lp.connect(this.verb).connect(this.wet).connect(bus); // and a little room
    const re = new Float32Array(CHOIR_PARTIALS + 1);
    const im = new Float32Array(CHOIR_PARTIALS + 1);
    for (let n = 1; n <= CHOIR_PARTIALS; n++) im[n] = choirPartial(n);
    this.wave = ctx.createPeriodicWave(re, im);
  }

  /**
   * Play `hz[i][v]` (chord i, voice v; the voices in `midi` say which notes are held over) from
   * `at` (audio time). Returns when each chord starts and when it has all died away (audio time).
   */
  play(hz: readonly (readonly number[])[], midi: readonly (readonly number[])[], at: number, s: CadenceShape = SHAPE): { starts: number[]; end: number } {
    const { starts, end } = cadenceTimes(hz.length, s);
    if (this.closed) return { starts: starts.map((t) => at + t), end: at + end };
    const last = hz.length - 1;
    for (const seg of voiceSegments(midi)) {
      const t0 = at + starts[seg.from];
      const osc = this.ctx.createOscillator();
      osc.setPeriodicWave(this.wave);
      osc.frequency.setValueAtTime(hz[seg.from][seg.voice], t0);
      // a held note retunes softly as the chord around it changes
      for (let i = seg.from + 1; i <= seg.to; i++) osc.frequency.setTargetAtTime(hz[i][seg.voice], at + starts[i], 0.04);
      const env = this.ctx.createGain();
      const level = VOICE_LEVELS[seg.voice] ?? VOICE_LEVELS[1];
      env.gain.setValueAtTime(0, t0);
      // (legato: a note that takes over from another fades in over the crossfade)
      env.gain.linearRampToValueAtTime(level, t0 + (seg.from === 0 ? s.attack : s.xfade));
      let stopAt: number;
      if (seg.to === last) {
        const fade = at + starts[last] + s.lastSec;
        env.gain.setValueAtTime(level, fade);
        env.gain.setTargetAtTime(0, fade, s.release / 4);
        stopAt = fade + s.release + 0.1;
      } else {
        const next = at + starts[seg.to + 1];
        env.gain.setValueAtTime(level, next);
        env.gain.linearRampToValueAtTime(0, next + s.xfade);
        stopAt = next + s.xfade + 0.05;
      }
      osc.connect(env).connect(this.out);
      osc.start(t0);
      osc.stop(stopAt);
      const h = { osc, env };
      this.held.push(h);
      osc.onended = () => { osc.disconnect(); env.disconnect(); this.held = this.held.filter((x) => x !== h); };
    }
    return { starts: starts.map((t) => at + t), end: at + end };
  }

  /** Fade out whatever sounds or is still to come. */
  stop() {
    const now = this.ctx.currentTime;
    for (const { osc, env } of this.held) {
      env.gain.cancelScheduledValues(now);
      env.gain.setValueAtTime(env.gain.value, now);
      env.gain.linearRampToValueAtTime(0, now + 0.12);
      try { osc.stop(now + 0.15); } catch { /* not started yet: stop() before start() throws in some engines */ }
    }
  }

  /** Silence for good. */
  dispose() {
    if (this.closed) return;
    this.stop();
    this.closed = true;
    setTimeout(() => { this.out.disconnect(); this.lp.disconnect(); this.verb.disconnect(); this.wet.disconnect(); }, 1500);
  }
}
