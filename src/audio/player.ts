// Score playback with a lookahead scheduler (setInterval 25 ms, 150 ms ahead on the
// AudioContext clock). Score time advances at `rate` × real time.
//
// Time mapping: once playback starts, score time `from` sounds at ctx time `startCtx`;
//   scoreTime = from + (ctxTime − startCtx) · rate       (negative-relative during count-in)
// `scoreTimeAt(ctxTime)` is that pure mapping on the scheduling clock. `position` is
// latency-aware: it is the score time the listener is *hearing* now
// (ctx.currentTime − output latency), which is what the highway should draw.
// For mic samples use `scoreTimeAt(p.ctxTime − latencyMs/1000)` with the measured
// round-trip latency (see latency.ts).

import type { Measure, Part, Score } from '../music/types';
import { outputLatencySec } from './context';
import { scheduleClick, scheduleVoice, synthBus, type Timbre, type VoiceHandle } from './synth';

export interface PlayOptions {
  from: number;
  to?: number;
  rate: number;
  partGains: Record<string, number>;
  countInBeats?: number;
  /** Beat clicks during playback: on every beat, or only on beats the predicate picks. */
  click?: boolean | ((scoreTime: number) => boolean);
  cuePartId?: string;
  cue?: 'note' | 'chord' | 'none';
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export function scoreTimeFromCtx(startCtx: number, startScore: number, rate: number, ctxTime: number): number {
  return startScore + (ctxTime - startCtx) * rate;
}

export function ctxTimeFromScore(startCtx: number, startScore: number, rate: number, scoreTime: number): number {
  return startCtx + (scoreTime - startScore) / rate;
}

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return Math.min(1.25, Math.max(0.5, rate));
}

/** Clip a note to [from, to): notes starting before `from` are dropped, notes crossing `to` cut. */
export function clipNote(start: number, dur: number, from: number, to: number): { start: number; dur: number } | null {
  const eps = 1e-6;
  if (start < from - eps || start >= to - eps) return null;
  const end = Math.min(start + dur, to);
  if (end - start <= eps) return null;
  return { start, dur: end - start };
}

/** Number of felt beats in a measure and whether it is compound (6/8, 9/8, 12/8 …). */
export function beatsInMeasure(timeSig: [number, number]): number {
  const [num, den] = timeSig;
  if (den >= 8 && num > 3 && num % 3 === 0) return num / 3;
  return Math.max(1, num);
}

function measureAt(measures: Measure[], t: number): Measure | undefined {
  let lo = 0;
  let hi = measures.length - 1;
  let found: Measure | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (measures[mid].start <= t + 1e-9) {
      found = measures[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found ?? measures[0];
}

/** Duration of one felt beat in score seconds at score time `t`. */
export function beatSecAt(score: Score, t: number): number {
  const m = measureAt(score.measures, t);
  if (m && m.dur > 0 && m.durBeats > 0) {
    // Seconds per quarter in this bar × quarters per felt beat. Works for short pickup bars too
    // (which aren't a full bar long, so bar length / beats would be far too fast).
    const secPerQuarter = m.dur / m.durBeats;
    const quartersPerBar = (m.timeSig[0] * 4) / m.timeSig[1];
    return secPerQuarter * (quartersPerBar / beatsInMeasure(m.timeSig));
  }
  let bpm = 90;
  for (const te of score.tempos) if (te.time <= t + 1e-9) bpm = te.bpm;
  return 60 / bpm;
}

/** Felt beats (score seconds) in [from, to). */
export function beatGrid(score: Score, from: number, to: number): { time: number; downbeat: boolean }[] {
  const out: { time: number; downbeat: boolean }[] = [];
  if (score.measures.length) {
    for (const m of score.measures) {
      if (m.start >= to || m.start + m.dur <= from) continue;
      const n = beatsInMeasure(m.timeSig);
      const nominal = (m.timeSig[0] * 4) / m.timeSig[1];
      const short = m.durBeats > 0 && m.durBeats < nominal - 1e-6;
      // A pickup (incomplete) bar keeps the bar's beat length and counts from its end, so a
      // one-beat upbeat gets one click, not a whole bar squeezed into it.
      const bd = short ? (m.dur / m.durBeats) * (nominal / n) : m.dur / n;
      const times: { t: number; down: boolean }[] = [];
      if (short) {
        for (let j = 1; m.start + m.dur - j * bd >= m.start - 1e-6; j++) times.unshift({ t: m.start + m.dur - j * bd, down: false });
      } else {
        for (let k = 0; k < n; k++) times.push({ t: m.start + k * bd, down: k === 0 });
      }
      for (const { t, down } of times) if (t >= from - 1e-6 && t < to - 1e-6) out.push({ time: t, downbeat: down });
    }
    return out;
  }
  const bd = beatSecAt(score, from);
  for (let t = from; t < to - 1e-6; t += bd) out.push({ time: t, downbeat: false });
  return out;
}

/** MIDI pitches of notes sounding at `t` (attacked at or before `t`) across all parts, each pitch once. */
export function chordAt(score: Score, t: number): number[] {
  const out = new Set<number>();
  for (const p of score.parts) {
    for (const n of p.notes) {
      if (n.start > t + 1e-6) break;
      // (A piano or organ part can hold several notes at once.)
      if (n.start + n.dur > t + 1e-6) out.add(n.midi);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The starting chord for a run from `from` to `to`: the harmony where the music starts, i.e. at
 * `from`, or, when every part rests there (a pickup bar of rests, a passage opening on a rest), at
 * the first note of any part after it.
 */
export function cueChord(score: Score, from: number, to: number): number[] {
  let at = Infinity;
  for (const p of score.parts) {
    const n = p.notes.find((x) => x.start + x.dur > from + 1e-6);
    if (n && n.start < to) at = Math.min(at, Math.max(from, n.start));
  }
  return Number.isFinite(at) ? chordAt(score, at) : [];
}

export function firstNoteIn(part: Part | undefined, from: number, to: number): number | null {
  if (!part) return null;
  for (const n of part.notes) if (n.start >= from - 1e-6 && n.start < to) return n.midi;
  return null;
}

// ---------------------------------------------------------------------------
// ScorePlayer
// ---------------------------------------------------------------------------

const LOOKAHEAD = 0.15;
const TICK_MS = 25;
const START_DELAY = 0.1;

type Ev =
  | { kind: 'note'; t: number; partId: string; midi: number; dur: number }
  | { kind: 'click'; t: number; downbeat: boolean };

interface Session {
  startCtx: number;
  from: number;
  to: number;
  rate: number;
  endCtx: number;
  out: GainNode;
  partNodes: Map<string, GainNode>;
  clickNode: GainNode;
  events: Ev[];
  idx: number;
  voices: VoiceHandle[];
  clicks: (() => void)[];
  cuePartId?: string;
}

export class ScorePlayer {
  private s: Session | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private endedCbs = new Set<() => void>();
  private gains: Record<string, number> = {};
  private lastPos = 0;
  /** Time mapping of the most recent playback, kept after it ends (late mic samples still map). */
  private lastMap: { startCtx: number; from: number; rate: number } | null = null;

  constructor(
    private ctx: AudioContext,
    private score: Score,
  ) {}

  get playing(): boolean {
    return this.s != null;
  }

  /** Score seconds being heard now (negative = count-in before `from`). */
  get position(): number {
    if (!this.s) return this.lastPos;
    return this.scoreTimeAt(this.ctx.currentTime - outputLatencySec(this.ctx));
  }

  scoreTimeAt(ctxTime: number): number {
    const m = this.s ?? this.lastMap;
    if (!m) return this.lastPos;
    return scoreTimeFromCtx(m.startCtx, m.from, m.rate, ctxTime);
  }

  /** AudioContext time at which score time `t` is scheduled in the current playback (NaN if stopped). */
  ctxTimeAt(scoreTime: number): number {
    if (!this.s) return NaN;
    return ctxTimeFromScore(this.s.startCtx, this.s.from, this.s.rate, scoreTime);
  }

  onEnded(cb: () => void): () => void {
    this.endedCbs.add(cb);
    return () => this.endedCbs.delete(cb);
  }

  setPartGain(partId: string, gain: number): void {
    const g = Math.max(0, Math.min(1, gain));
    this.gains[partId] = g;
    const node = this.s?.partNodes.get(partId);
    if (node) {
      const now = this.ctx.currentTime;
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(g, now, 0.02);
    }
  }

  play(opts: PlayOptions): void {
    this.stop();
    const ctx = this.ctx;
    const rate = clampRate(opts.rate);
    const from = Math.max(0, opts.from);
    const to = Math.min(opts.to ?? this.score.duration, this.score.duration);
    if (!(to > from)) return;
    this.gains = { ...opts.partGains };

    const out = ctx.createGain();
    out.connect(synthBus(ctx));
    const partNodes = new Map<string, GainNode>();
    for (const p of this.score.parts) {
      const g = ctx.createGain();
      g.gain.value = this.gains[p.id] ?? 0;
      g.connect(out);
      partNodes.set(p.id, g);
    }
    const clickNode = ctx.createGain();
    clickNode.connect(out);

    const beatReal = beatSecAt(this.score, from) / rate;
    const nCount = Math.max(0, Math.round(opts.countInBeats ?? 0));
    const countStart = ctx.currentTime + START_DELAY;
    const startCtx = countStart + nCount * beatReal;
    const endCtx = startCtx + (to - from) / rate;

    const events: Ev[] = [];
    for (const p of this.score.parts) {
      for (const n of p.notes) {
        const c = clipNote(n.start, n.dur, from, to);
        if (c) events.push({ kind: 'note', t: c.start, partId: p.id, midi: n.midi, dur: c.dur });
      }
    }
    if (opts.click) {
      const pick = opts.click;
      for (const b of beatGrid(this.score, from, to)) {
        if (pick === true || pick(b.time)) events.push({ kind: 'click', t: b.time, downbeat: b.downbeat });
      }
    }
    events.sort((a, b) => a.t - b.t);

    const s: Session = {
      startCtx, from, to, rate, endCtx, out, partNodes, clickNode, events, idx: 0,
      voices: [], clicks: [], cuePartId: opts.cuePartId,
    };
    this.s = s;

    // Count-in clicks + starting-pitch cue (scheduled up front; they're few).
    for (let i = 0; i < nCount; i++) {
      s.clicks.push(scheduleClick(ctx, clickNode, countStart + i * beatReal, i === 0));
    }
    const cue = opts.cue ?? 'none';
    if (nCount > 0 && cue !== 'none') {
      const midis =
        cue === 'note'
          ? [firstNoteIn(this.score.parts.find((p) => p.id === opts.cuePartId), from, to)].filter(
              (m): m is number => m != null,
            )
          : cueChord(this.score, from, to);
      // Hold the cue until one beat before the entrance so there's time to breathe.
      const cueDur = Math.max(0.4, (nCount - 1) * beatReal);
      for (const m of midis) {
        s.voices.push(scheduleVoice(ctx, out, m, countStart, cueDur, { timbre: 'guide', gain: cue === 'chord' ? 0.12 : 0.2 }));
      }
    }

    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const s = this.s;
    if (!s) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    while (s.idx < s.events.length) {
      const ev = s.events[s.idx];
      const at = ctxTimeFromScore(s.startCtx, s.from, s.rate, ev.t);
      if (at > horizon) break;
      s.idx++;
      if (ev.kind === 'click') {
        if (at > now - 0.05) s.clicks.push(scheduleClick(ctx, s.clickNode, at, ev.downbeat, 0.4));
        continue;
      }
      if ((this.gains[ev.partId] ?? 0) <= 0) continue;
      const realDur = ev.dur / s.rate;
      if (at + realDur <= now + 0.02) continue; // missed entirely (throttled tab)
      const node = s.partNodes.get(ev.partId);
      if (!node) continue;
      const timbre: Timbre = ev.partId === s.cuePartId ? 'guide' : 'oo';
      s.voices.push(scheduleVoice(ctx, node, ev.midi, at, realDur, { timbre }));
    }
    // Drop finished handles so long pieces don't accumulate.
    if (s.voices.length > 64) s.voices = s.voices.filter((v) => v.end > now);
    if (s.clicks.length > 64) s.clicks = s.clicks.slice(-16);

    if (now >= s.endCtx) {
      this.lastPos = s.to;
      this.teardown(s, false);
      for (const cb of [...this.endedCbs]) {
        try {
          cb();
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  /** Stop immediately (30 ms fade). Does not fire onEnded. */
  stop(): void {
    const s = this.s;
    if (!s) return;
    this.lastPos = this.scoreTimeAt(this.ctx.currentTime);
    this.teardown(s, true);
  }

  private teardown(s: Session, fade: boolean): void {
    this.lastMap = { startCtx: s.startCtx, from: s.from, rate: s.rate };
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.s = null;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (fade) {
      s.out.gain.cancelScheduledValues(now);
      s.out.gain.setValueAtTime(s.out.gain.value, now);
      s.out.gain.linearRampToValueAtTime(0, now + 0.03);
      for (const v of s.voices) v.stop(now + 0.03);
      for (const c of s.clicks) c();
    }
    // Release tails (120 ms) before disconnecting the per-session graph.
    const delayMs = fade ? 80 : 250;
    setTimeout(() => {
      for (const n of s.partNodes.values()) n.disconnect();
      s.clickNode.disconnect();
      s.out.disconnect();
    }, delayMs);
  }
}

/** One guide-voice note through the shared bus (e.g. "give me my note"). */
export function playTone(ctx: AudioContext, midi: number, dur: number, when?: number): void {
  scheduleVoice(ctx, synthBus(ctx), midi, when ?? ctx.currentTime + 0.02, dur, { timbre: 'guide' });
}

export function playChord(ctx: AudioContext, midis: number[], dur: number, when?: number): void {
  const t = when ?? ctx.currentTime + 0.02;
  const g = midis.length > 1 ? 0.22 / Math.sqrt(midis.length) : 0.22;
  for (const m of midis) scheduleVoice(ctx, synthBus(ctx), m, t, dur, { timbre: 'oo', gain: g });
}
