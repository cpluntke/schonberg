// Round-trip latency calibration.
//
// We play a 2-beat count followed by 6 clicks at 90 bpm; the singer sings "ta" (or claps)
// exactly with each click they HEAR. A sung onset therefore reaches our pitch readings at
//   scheduled ctx time + output latency (DAC/speaker/Bluetooth) + input latency (mic/ADC/buffers)
// and the median of (detected − scheduled) is that round-trip latency, which is exactly the
// offset the game subtracts from mic sample times before mapping them to score time
// (`player.scoreTimeAt(p.ctxTime − latencyMs/1000)`).
// Note: on a phone speaker without headphones the mic also hears the click itself; that
// acoustic loopback has the same round-trip delay, so it measures the same quantity.

import type { PitchTracker, RawPitch } from './pitch';
import { median } from './pitch';
import { scheduleClick, synthBus } from './synth';

export const LATENCY_BPM = 90;
export const LATENCY_BEATS = 6;
const COUNT_BEATS = 2;
/** Search window around each scheduled click (seconds). Asymmetric because latency is ≥ 0. */
export const WINDOW_BEFORE = 0.2;
export const WINDOW_AFTER = 0.45;

export interface OnsetOptions {
  /** RMS threshold for an onset (default: max(0.015, 3 × noise floor)). */
  threshold?: number;
  /** Analysis window length of the readings, used to refine onset time. */
  windowSec?: number;
}

/**
 * Pure: for each scheduled beat ctx time, find the first rising edge (rms crossing the
 * threshold from below, or an unvoiced→voiced transition) within [T − 0.2 s, T + 0.45 s].
 * Returns detected onset ctx times (null when none).
 */
export function detectOnsets(
  readings: Pick<RawPitch, 'ctxTime' | 'rms' | 'midi'>[],
  beats: number[],
  opts: OnsetOptions = {},
): (number | null)[] {
  const rs = [...readings].sort((a, b) => a.ctxTime - b.ctxTime);
  const floor = estimateNoiseFloor(rs, beats.length ? beats[0] - WINDOW_BEFORE : Infinity);
  const thr = opts.threshold ?? Math.max(0.015, floor * 3);
  const w = opts.windowSec ?? 0;
  return beats.map((T) => {
    const lo = T - WINDOW_BEFORE;
    const hi = T + WINDOW_AFTER;
    let prev: (typeof rs)[number] | null = null;
    for (const r of rs) {
      if (r.ctxTime < lo) {
        prev = r;
        continue;
      }
      if (r.ctxTime > hi) break;
      const rising = r.rms >= thr && (prev == null || prev.rms < thr);
      const voicedStart = r.midi != null && prev != null && prev.midi == null && r.rms >= thr * 0.5;
      if (rising || voicedStart) {
        // The reading's ctxTime is the window centre; a step onset crosses the threshold
        // as soon as a small part of it has entered the window, i.e. near the window end.
        let peak = r.rms;
        for (const q of rs) if (q.ctxTime >= r.ctxTime && q.ctxTime <= r.ctxTime + 0.1) peak = Math.max(peak, q.rms);
        const frac = peak > 0 ? Math.min(1, (r.rms / peak) ** 2) : 1;
        return r.ctxTime + w / 2 - frac * w;
      }
      prev = r;
    }
    return null;
  });
}

function estimateNoiseFloor(rs: Pick<RawPitch, 'ctxTime' | 'rms'>[], before: number): number {
  const xs = rs.filter((r) => r.ctxTime < before).map((r) => r.rms);
  return xs.length ? median(xs) : 0;
}

/** Pure: median latency in ms (clamped 0..500); ok=false with fewer than 3 detections. */
export function latencyFromOnsets(beats: number[], onsets: (number | null)[]): { latencyMs: number; ok: boolean } {
  const d: number[] = [];
  beats.forEach((T, i) => {
    const o = onsets[i];
    if (o != null) d.push((o - T) * 1000);
  });
  if (d.length < 3) return { latencyMs: d.length ? clampMs(median(d)) : 0, ok: false };
  // Consistency check: the "ta"s must line up with the clicks. Keep the onsets within 60 ms of
  // the median and require at least 3 of them; otherwise we probably heard something unrelated.
  const med = median(d);
  const close = d.filter((x) => Math.abs(x - med) <= 60);
  if (close.length < Math.max(3, Math.ceil(d.length * 0.6))) return { latencyMs: clampMs(med), ok: false };
  return { latencyMs: clampMs(median(close)), ok: true };
}

function clampMs(x: number): number {
  return Math.round(Math.min(500, Math.max(0, x)));
}

/**
 * Run the calibration. Resolves ~6.5 s after start. `onBeat(i, n)` is called (approximately
 * on time) for each of the n measured beats so the UI can flash.
 */
export async function measureLatency(
  ctx: AudioContext,
  tracker: PitchTracker,
  onBeat?: (i: number, n: number) => void,
): Promise<{ latencyMs: number; ok: boolean }> {
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      /* ignore */
    }
  }
  const beat = 60 / LATENCY_BPM;
  const readings: Pick<RawPitch, 'ctxTime' | 'rms' | 'midi'>[] = [];
  const off = tracker.onPitch((p) => readings.push({ ctxTime: p.ctxTime, rms: p.rms, midi: p.midi }));

  const t0 = ctx.currentTime + 0.6; // leave time to sample the noise floor
  const out = synthBus(ctx);
  const beats: number[] = [];
  for (let i = 0; i < COUNT_BEATS + LATENCY_BEATS; i++) {
    const t = t0 + i * beat;
    scheduleClick(ctx, out, t, i < COUNT_BEATS || i === COUNT_BEATS, i < COUNT_BEATS ? 0.35 : 0.6);
    if (i >= COUNT_BEATS) beats.push(t);
  }
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (onBeat) {
    beats.forEach((t, i) => {
      timers.push(setTimeout(() => onBeat(i, LATENCY_BEATS), Math.max(0, (t - ctx.currentTime) * 1000)));
    });
  }
  const endAt = beats[beats.length - 1] + WINDOW_AFTER + 0.15;
  await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, (endAt - ctx.currentTime) * 1000)));
  off();
  timers.forEach(clearTimeout);
  const windowSec = tracker.windowSec;
  const onsets = detectOnsets(readings, beats, { windowSec });
  return latencyFromOnsets(beats, onsets);
}
