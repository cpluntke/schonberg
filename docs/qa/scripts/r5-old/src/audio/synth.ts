// Lightweight WebAudio voices: a soft choir-ish "oo" for backing parts, a slightly brighter
// "guide" for the singer's own part, and a woodblock-ish click. Designed for phones:
// ~6 nodes per voice, global polyphony cap with voice stealing.

import { midiToHz } from './pitch';

export type Timbre = 'oo' | 'guide';

export interface VoiceHandle {
  /** Fade out quickly (30 ms) at `when` (default now) and release all nodes. */
  stop(when?: number): void;
  readonly end: number;
}

export const MAX_VOICES = 24;
const ATTACK = 0.06;
const RELEASE = 0.12;
const VIB_DELAY = 0.3;
const VIB_RATE = 5;
const VIB_CENTS = 8;

interface Bus {
  input: GainNode;
  voices: VoiceHandle[];
}
const buses = new WeakMap<BaseAudioContext, Bus>();

/** Shared output bus (gain → gentle compressor → destination) per context. */
export function synthBus(ctx: BaseAudioContext): GainNode {
  return getBus(ctx).input;
}

function getBus(ctx: BaseAudioContext): Bus {
  let b = buses.get(ctx);
  if (!b) {
    const input = ctx.createGain();
    input.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    input.connect(comp);
    comp.connect(ctx.destination);
    b = { input, voices: [] };
    buses.set(ctx, b);
  }
  return b;
}

function reserveVoice(ctx: BaseAudioContext, start: number): Bus {
  const b = getBus(ctx);
  const now = ctx.currentTime;
  b.voices = b.voices.filter((v) => v.end > now);
  // Steal voices that would still be sounding at `start`, earliest-ending first.
  const overlapping = b.voices.filter((v) => v.end > start).sort((a, c) => a.end - c.end);
  let excess = overlapping.length - (MAX_VOICES - 1);
  for (let i = 0; excess > 0 && i < overlapping.length; i++, excess--) {
    overlapping[i].stop(Math.max(now, start));
  }
  return b;
}

export interface VoiceOptions {
  timbre?: Timbre;
  /** Linear peak gain, default 0.18 ("oo") / 0.22 ("guide"). */
  gain?: number;
}

/**
 * Schedule one sung note. `dest` is typically a per-part GainNode (so live part
 * volume changes affect already-scheduled notes) connected to `synthBus(ctx)`.
 */
export function scheduleVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  start: number,
  dur: number,
  opts: VoiceOptions = {},
): VoiceHandle {
  const bus = reserveVoice(ctx, start);
  const timbre = opts.timbre ?? 'oo';
  const peak = opts.gain ?? (timbre === 'guide' ? 0.22 : 0.18);
  const f = midiToHz(midi);
  const t0 = Math.max(start, ctx.currentTime);
  const d = Math.max(0.03, dur - (t0 - start));
  const attack = Math.min(ATTACK, d * 0.5);
  const offAt = t0 + d;
  let end = offAt + RELEASE;

  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.type = 'triangle';
  o2.type = timbre === 'guide' ? 'sawtooth' : 'sine';
  o1.frequency.value = f;
  o2.frequency.value = timbre === 'guide' ? f : f * 2; // "oo": a touch of 2nd partial
  o1.detune.value = -4;
  o2.detune.value = 4;

  const o2g = ctx.createGain();
  o2g.gain.value = timbre === 'guide' ? 0.25 : 0.3;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = timbre === 'guide' ? 2600 : 1200;
  lp.Q.value = 0.4;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  env.gain.setValueAtTime(peak, offAt);
  env.gain.linearRampToValueAtTime(0, end);

  o1.connect(lp);
  o2.connect(o2g).connect(lp);
  lp.connect(env).connect(dest);

  // Delayed vibrato only on notes long enough to hear it.
  let lfo: OscillatorNode | null = null;
  let lfoG: GainNode | null = null;
  if (d > VIB_DELAY + 0.15) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = VIB_RATE;
    lfoG = ctx.createGain();
    lfoG.gain.setValueAtTime(0, t0);
    lfoG.gain.setValueAtTime(0, t0 + VIB_DELAY);
    lfoG.gain.linearRampToValueAtTime(VIB_CENTS, Math.min(offAt, t0 + VIB_DELAY + 0.3));
    lfo.connect(lfoG);
    lfoG.connect(o1.detune);
    lfoG.connect(o2.detune);
    lfo.start(t0);
    lfo.stop(end + 0.01);
  }

  o1.start(t0);
  o2.start(t0);
  o1.stop(end + 0.01);
  o2.stop(end + 0.01);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const n of [o1, o2, o2g, lp, env, lfo, lfoG]) {
      try {
        n?.disconnect();
      } catch {
        /* ignore */
      }
    }
  };
  o1.onended = cleanup;

  const handle: VoiceHandle = {
    get end() {
      return end;
    },
    stop(when?: number) {
      const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
      if (t >= end) return;
      try {
        const g = env.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
        else g.cancelScheduledValues(t);
        if (t <= t0) {
          // Not started yet: never let it sound.
          env.gain.setValueAtTime(0, t);
        } else {
          env.gain.setTargetAtTime(0, t, 0.01);
        }
        const stopAt = t + 0.04;
        o1.stop(stopAt);
        o2.stop(stopAt);
        lfo?.stop(stopAt);
        end = stopAt;
      } catch {
        cleanup();
      }
    },
  };
  bus.voices.push(handle);
  return handle;
}

/** Woodblock-ish click. `accent` = downbeat (higher, louder). */
export function scheduleClick(ctx: BaseAudioContext, dest: AudioNode, when: number, accent = false, gain = 0.5): () => void {
  const t = Math.max(when, ctx.currentTime);
  const f = accent ? 1760 : 1320;
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.type = 'sine';
  o2.type = 'sine';
  o1.frequency.setValueAtTime(f * 1.05, t);
  o1.frequency.exponentialRampToValueAtTime(f, t + 0.02);
  o2.frequency.value = f * 2.76; // inharmonic partial → "wood"
  const g2 = ctx.createGain();
  g2.gain.value = 0.35;
  const env = ctx.createGain();
  const peak = gain * (accent ? 1 : 0.7);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
  env.gain.setValueAtTime(0, t + 0.065);
  o1.connect(env);
  o2.connect(g2).connect(env);
  env.connect(dest);
  o1.start(t);
  o2.start(t);
  o1.stop(t + 0.07);
  o2.stop(t + 0.07);
  const cleanup = () => {
    for (const n of [o1, o2, g2, env]) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  };
  o1.onended = cleanup;
  return () => {
    try {
      env.gain.cancelScheduledValues(ctx.currentTime);
      env.gain.setValueAtTime(0, ctx.currentTime);
      o1.stop();
      o2.stop();
    } catch {
      cleanup();
    }
  };
}
