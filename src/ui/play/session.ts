// Glue between audio (player + pitch tracker), live scoring and the renderers.
import type { Part, Score } from '../../music/types';
import type { AttemptResult, PitchSample, ScoringOptions } from '../../game/types';
import { getAudioContext, unlockAudio, outputLatencySec } from '../../audio/context';
import { PitchTracker, type RawPitch } from '../../audio/pitch';
import { ScorePlayer, beatsInMeasure, beatSecAt } from '../../audio/player';
import { LiveScorer, type ScoringContext } from '../../game/scoring';

let sharedTracker: PitchTracker | null = null;
let trackerPromise: Promise<PitchTracker> | null = null;

/** One shared microphone tracker for the whole app session (avoids re-prompting on iOS). */
export async function getTracker(): Promise<PitchTracker> {
  if (sharedTracker) return sharedTracker;
  if (!trackerPromise) {
    trackerPromise = PitchTracker.create(getAudioContext())
      .then((t) => (sharedTracker = t))
      .catch((e) => {
        trackerPromise = null;
        throw e;
      });
  }
  return trackerPromise;
}

export function releaseTracker() {
  sharedTracker?.stop();
  sharedTracker = null;
  trackerPromise = null;
}

export interface SessionConfig {
  score: Score;
  part: Part;
  from: number;
  to: number;
  rate: number;
  /** Own part audible. */
  guide: boolean;
  /** 0 = listen only (no mic, all parts). */
  listenOnly: boolean;
  cue: 'note' | 'chord' | 'none';
  scoring: ScoringOptions;
  latencyMs: number;
  range: [number, number] | null;
  /** Testing / demo: synthesise the singer instead of using the mic. */
  simulate?: 'perfect' | 'flat' | 'sloppy' | null;
}

export type SessionPhase = 'idle' | 'countin' | 'playing' | 'paused' | 'done';

export class PracticeSession {
  readonly cfg: SessionConfig;
  readonly player: ScorePlayer;
  readonly samples: PitchSample[] = [];
  live: LiveScorer | null = null;
  phase: SessionPhase = 'idle';
  micError: string | null = null;
  partGains: Record<string, number> = {};
  private tracker: PitchTracker | null = null;
  private unsubPitch: (() => void) | null = null;
  private unsubEnd: (() => void) | null = null;
  private resumeFrom: number;
  private simTimer: number | null = null;
  /** Samples earlier than this are ignored (count-in before the start, or before a resume point). */
  private minTime: number;
  /** Effective mic round-trip latency: calibrated, else a conservative estimate. */
  readonly latencyMs: number;
  private wakeLock: { release(): Promise<void> } | null = null;
  private onDone: (r: AttemptResult | null) => void;
  latest: PitchSample | null = null;

  constructor(cfg: SessionConfig, onDone: (r: AttemptResult | null) => void) {
    this.cfg = cfg;
    this.onDone = onDone;
    this.resumeFrom = cfg.from;
    this.minTime = cfg.from - 0.6;
    this.latencyMs = cfg.latencyMs > 0 ? cfg.latencyMs : estimateLatencyMs();
    this.player = new ScorePlayer(getAudioContext(), cfg.score);
    for (const p of cfg.score.parts) {
      if (p.id === cfg.part.id) this.partGains[p.id] = cfg.listenOnly || cfg.guide ? 0.9 : 0;
      else this.partGains[p.id] = p.voiceType === 'other' ? 0.55 : 0.7;
    }
    if (cfg.range && !cfg.listenOnly) {
      const ctx: ScoringContext = { score: cfg.score, part: cfg.part, range: cfg.range };
      this.live = new LiveScorer(ctx, cfg.scoring);
    }
  }

  /** Must be called from a user gesture (tap) for iOS. */
  async start(): Promise<void> {
    await unlockAudio();
    if (!this.cfg.listenOnly && this.cfg.simulate) {
      this.startSimulation(this.cfg.simulate);
    } else if (!this.cfg.listenOnly && !this.tracker) {
      try {
        this.tracker = await getTracker();
      } catch (e) {
        const err = e as { code?: string; message?: string };
        this.micError =
          err.code === 'denied' ? 'Microphone access was blocked. Allow it in your browser settings to be scored.'
            : err.code === 'insecure' ? 'The microphone needs a secure (https) connection.'
              : 'No microphone found.';
        throw e;
      }
      this.unsubPitch = this.tracker.onPitch((p) => this.onPitch(p));
    }
    this.play(this.resumeFrom, true);
    this.requestWakeLock();
  }

  private play(from: number, countIn: boolean) {
    this.unsubEnd?.();
    this.unsubEnd = this.player.onEnded(() => this.finish());
    this.player.play({
      from,
      to: this.cfg.to,
      rate: this.cfg.rate,
      partGains: this.partGains,
      countInBeats: countIn ? this.countInBeats(from) : 0,
      click: false,
      cuePartId: this.cfg.part.id,
      cue: from === this.cfg.from ? this.cfg.cue : 'note',
    });
    this.phase = 'countin';
  }

  /** Count-in: one bar of felt beats (2/2 → 2, 6/8 → 2, 3/4 → 3), at least 2 and at most 4. */
  countInBeats(from: number): number {
    const m = this.cfg.score.measures.find((x) => from >= x.start - 1e-6 && from < x.start + x.dur - 1e-6);
    const felt = beatsInMeasure(m?.timeSig ?? [4, 4]);
    return Math.max(2, Math.min(4, felt));
  }

  /** Length of one count-in beat in score seconds. */
  beatSec(at: number): number {
    return beatSecAt(this.cfg.score, at);
  }

  private onPitch(p: RawPitch) {
    if (this.phase !== 'playing' && this.phase !== 'countin') return;
    const t = this.player.scoreTimeAt(p.ctxTime - this.latencyMs / 1000);
    const s: PitchSample = { time: t, midi: p.midi, clarity: p.clarity, rms: p.rms };
    this.latest = s;
    if (t < this.minTime) return;
    this.samples.push(s);
    this.live?.push(s);
  }

  private startSimulation(kind: 'perfect' | 'flat' | 'sloppy') {
    if (this.simTimer != null) return;
    const notes = this.cfg.part.notes;
    let k = 0;
    this.simTimer = window.setInterval(() => {
      if (this.phase !== 'playing' && this.phase !== 'countin') return;
      const t = this.player.position;
      while (k > 0 && notes[k].start > t) k--;
      while (k < notes.length - 1 && notes[k].start + notes[k].dur <= t) k++;
      const n = notes[k];
      const inNote = n && t >= n.start + 0.03 && t < n.start + n.dur - 0.03;
      let midi: number | null = null;
      if (inNote) {
        const vib = 0.25 * Math.sin(2 * Math.PI * 5.5 * t);
        const off = kind === 'flat' ? -0.35 : kind === 'sloppy' ? (Math.sin(k * 1.7) > 0.3 ? 0.9 : 0.1) : 0;
        midi = n.midi + vib + off;
      }
      const s: PitchSample = { time: t, midi, clarity: midi == null ? 0.3 : 0.97, rms: midi == null ? 0.002 : 0.1 };
      this.latest = s;
      if (t < this.minTime) return;
      this.samples.push(s);
      this.live?.push(s);
    }, 20);
  }

  private stopSimulation() {
    if (this.simTimer != null) clearInterval(this.simTimer);
    this.simTimer = null;
  }

  /** Score time where the current/next playback starts (section start or resume point). */
  get resumePoint(): number {
    return this.resumeFrom;
  }

  /** Called every animation frame by the screen. */
  get position(): number {
    const pos = this.player.position;
    if (this.phase === 'countin' && pos >= this.resumeFrom) this.phase = 'playing';
    return this.phase === 'paused' ? this.resumeFrom : pos;
  }

  setGain(partId: string, g: number) {
    this.partGains[partId] = g;
    this.player.setPartGain(partId, g);
  }

  pause() {
    if (this.phase !== 'playing' && this.phase !== 'countin') return;
    this.resumeFrom = Math.max(this.cfg.from, Math.min(this.player.position, this.cfg.to));
    this.unsubEnd?.();
    this.unsubEnd = null;
    this.player.stop();
    this.phase = 'paused';
    this.releaseWakeLock();
  }

  async resume() {
    if (this.phase !== 'paused') return;
    await unlockAudio(); // iOS suspends the context when the app is backgrounded
    this.minTime = this.resumeFrom - 0.02;
    this.play(this.resumeFrom, true);
    this.requestWakeLock();
  }

  private async requestWakeLock() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && !this.wakeLock) this.wakeLock = await wl.request('screen');
    } catch { /* not allowed / unsupported */ }
  }

  private releaseWakeLock() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  finish() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.unsubEnd?.();
    this.stopSimulation();
    this.releaseWakeLock();
    this.player.stop();
    const result = this.live ? this.live.finish(this.samples) : null;
    this.onDone(result);
  }

  /** Stop without producing a result (navigating away). */
  dispose() {
    this.stopSimulation();
    this.releaseWakeLock();
    this.unsubPitch?.();
    this.unsubPitch = null;
    this.unsubEnd?.();
    this.unsubEnd = null;
    if (this.phase !== 'done') {
      this.phase = 'done';
      this.player.stop();
    }
  }
}

/** Uncalibrated devices: output latency + input/processing (~40 ms), at least 80 ms on phones. */
export function estimateLatencyMs(): number {
  let out = 0;
  try { out = outputLatencySec() * 1000; } catch { /* no context yet */ }
  const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return Math.round(Math.max(mobile ? 80 : 50, out + 40));
}
