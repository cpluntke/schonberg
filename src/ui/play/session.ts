// Glue between audio (player + pitch tracker), live scoring and the renderers.
import type { Part, Score } from '../../music/types';
import type { AttemptResult, PitchSample, ScoringOptions } from '../../game/types';
import { getAudioContext, unlockAudio, outputLatencySec } from '../../audio/context';
import { PitchTracker, fixSubharmonic, type RawPitch } from '../../audio/pitch';
import { ScorePlayer, beatGrid, beatsInMeasure, beatSecAt } from '../../audio/player';
import { exposedBeats } from '../../music/exposure';
import { LiveScorer, scoreAttempt, type ScoringContext } from '../../game/scoring';
import { RunRecorder, type Recording } from '../../audio/recorder';

let sharedTracker: PitchTracker | null = null;
let trackerPromise: Promise<PitchTracker> | null = null;

/** One shared microphone tracker for the whole app session (avoids re-prompting on iOS). */
export async function getTracker(): Promise<PitchTracker> {
  if (sharedTracker && !sharedTracker.alive) {
    // The mic went away (headset unplugged, interruption): open it again.
    sharedTracker = null;
    trackerPromise = null;
  }
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
  /** Lowest note the singer is expected to sing (selects the pitch tracker's window). */
  lowestMidi?: number | null;
  /** Cold start: playback begins here (earlier than `from`, no count-in, no cue); scoring at `from`. */
  leadFrom?: number;
  /** Practice beat: 'alone' = only where nothing you can hear is playing. */
  beat?: 'off' | 'alone' | 'always';
  /** Keep a recording of the run (memory only) so it can be shared as a reference recording. */
  record?: boolean;
  /** Testing / demo: synthesise the singer instead of using the mic. */
  simulate?: 'perfect' | 'flat' | 'sloppy' | 'oneflat' | null;
}

export type SessionPhase = 'idle' | 'countin' | 'playing' | 'paused' | 'done';

/**
 * Outcome of PracticeSession.resume(): 'ok' = playing again; 'mic' = the microphone couldn't be
 * reopened (micError says why); 'audio' = the sound didn't start (context still suspended or
 * interrupted, e.g. during a call): the session stays paused, try again; 'stale' = superseded by a
 * later pause/resume or the session was closed.
 */
export type ResumeResult = 'ok' | 'mic' | 'audio' | 'stale';

/** How long a resume waits for the audio context to start (iOS can leave resume() pending while 'interrupted'). */
export const RESUME_TIMEOUT_MS = 3000;

/** Mic error text for the singer. */
export function micErrorMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  return code === 'denied' ? 'Microphone access was blocked. Allow it in your browser settings to be scored.'
    : code === 'insecure' ? 'The microphone needs a secure (https) connection.'
      : code === 'setup' ? 'The microphone opened, but the app couldn\'t listen to it. Close other apps using audio, then try again.'
        : 'No microphone found.';
}

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
  /** Effective mic round-trip latency: calibrated, else a conservative estimate (set in start()). */
  latencyMs: number;
  private disposed = false;
  private endTimer: number | null = null;
  /** The playback reached its end (finish follows after the mic latency). */
  private ended = false;
  private resumeToken = 0;
  private onStateChange: (() => void) | null = null;
  /** Called when the audio system interrupts playback (phone call, Siri, other app). */
  onInterrupted: (() => void) | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private onDone: (r: AttemptResult | null) => void;
  latest: PitchSample | null = null;
  /** Beats (score time) where the singer was on their own in the last playback. */
  exposed = new Set<number>();
  /** Measures the singer peeked at during an off-book run. */
  readonly peeked = new Set<number>();
  private recorder: RunRecorder | null = null;
  private plays = 0;
  /** The run's recording (only for uninterrupted runs), with the score time of its first sample. */
  recording: (Recording & { scoreTimeAtSample0: number; windowN: number }) | null = null;

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
      const ctx: ScoringContext = { score: cfg.score, part: cfg.part, range: cfg.range, end: cfg.to };
      this.live = new LiveScorer(ctx, cfg.scoring);
    }
  }

  /** Must be called from a user gesture (tap) for iOS. */
  async start(): Promise<void> {
    await unlockAudio();
    if (this.disposed) return;
    // Now that the context runs, outputLatency is meaningful.
    if (!(this.cfg.latencyMs > 0)) this.latencyMs = estimateLatencyMs();
    const ctx = getAudioContext();
    if (!this.onStateChange) {
      this.onStateChange = () => {
        if (ctx.state !== 'running' && (this.phase === 'playing' || this.phase === 'countin')) {
          this.pause();
          this.onInterrupted?.();
        }
      };
      ctx.addEventListener('statechange', this.onStateChange);
    }
    if (!this.cfg.listenOnly && this.cfg.simulate) {
      this.startSimulation(this.cfg.simulate);
    } else if (!this.cfg.listenOnly && !this.tracker) {
      try {
        this.tracker = await getTracker();
      } catch (e) {
        this.micError = micErrorMessage(e);
        throw e;
      }
      if (this.disposed) return; // the singer left while the permission prompt was open
      this.tracker.configureFor(this.cfg.lowestMidi ?? null);
      this.unsubPitch = this.tracker.onPitch((p) => this.onPitch(p));
      if (this.cfg.record && !this.recorder) {
        this.recorder = await RunRecorder.start(ctx, this.tracker.sourceNode);
        if (this.disposed) { this.recorder?.stop(); this.recorder = null; return; }
      }
    }
    if (this.disposed) return;
    this.play(this.resumeFrom, true);
    this.requestWakeLock();
  }

  private play(from: number, countIn: boolean) {
    this.plays++;
    this.ended = false;
    this.unsubEnd?.();
    this.unsubEnd = this.player.onEnded(() => {
      this.ended = true;
      // The singer's last notes reach us one round-trip latency later: keep listening briefly.
      if (this.cfg.listenOnly) return this.finish();
      this.endTimer = window.setTimeout(() => this.finish(), Math.min(700, this.latencyMs + 120));
    });
    // Cold start: the other voices lead in for a couple of bars instead of a count-in.
    const lead = this.cfg.leadFrom != null && this.cfg.leadFrom < from - 1e-6 && Math.abs(from - this.cfg.from) < 1e-6 ? this.cfg.leadFrom : null;
    this.player.play({
      from: lead ?? from,
      to: this.cfg.to,
      rate: this.cfg.rate,
      partGains: this.partGains,
      countInBeats: lead != null ? 0 : countIn ? this.countInBeats(from) : 0,
      click: this.clickFor(lead ?? from),
      cuePartId: this.cfg.part.id,
      // After a resume, give the note as a reminder — except at concert level, which only gets the chord.
      cue: lead != null ? 'none' : from === this.cfg.from || this.cfg.cue !== 'note' ? this.cfg.cue : 'note',
    });
    this.phase = 'countin';
  }

  /** The practice beat for a playback starting at `from`. */
  private clickFor(from: number): boolean | ((t: number) => boolean) {
    const mode = this.cfg.beat ?? 'alone';
    if (this.cfg.listenOnly) return false;
    // Where you're on your own is worked out whatever the setting (the coach uses it for tempo).
    const audible = new Set(Object.entries(this.partGains).filter(([, g]) => g > 0).map(([id]) => id));
    const beats = beatGrid(this.cfg.score, from, this.cfg.to);
    const m = this.cfg.score.measures.find((x) => from >= x.start - 1e-6 && from < x.start + x.dur - 1e-6);
    // A stretch of at least a bar on your own.
    this.exposed = exposedBeats(this.cfg.score, audible, beats, Math.max(2, beatsInMeasure(m?.timeSig ?? [4, 4])));
    const ex = this.exposed;
    if (mode === 'always') return true;
    if (mode === 'off') return false;
    return ex.size ? (t: number) => ex.has(t) : false;
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
    // Raw readings are kept (and exported); the end of the run corrects speaker-bleed subharmonics
    // after lining the voice up (game/align.ts). The live display corrects them on the fly.
    const s: PitchSample = { time: t, midi: p.midi, clarity: p.clarity, rms: p.rms };
    const shown = p.midi != null && !this.cfg.scoring.octaveTolerant ? { ...s, midi: fixSubharmonic(p.midi, this.noteDueAt(t)) } : s;
    this.latest = shown;
    this.keep(s, shown);
  }

  /** Store a sample (in time order: drawing and scoring binary-search the samples by time). */
  private keep(s: PitchSample, shown: PitchSample) {
    if (s.time < this.minTime) return;
    const last = this.samples[this.samples.length - 1];
    if (last && s.time < last.time) return;
    this.samples.push(s);
    this.live?.push(shown);
  }

  /** Written pitch of the singer's note sounding at score time t (null in rests). */
  private noteDueAt(t: number): number | null {
    const ns = this.cfg.part.notes;
    let lo = 0;
    let hi = ns.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ns[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx >= 0 && t < ns[idx].start + ns[idx].dur ? ns[idx].midi : null;
  }

  private startSimulation(kind: 'perfect' | 'flat' | 'sloppy' | 'oneflat') {
    if (this.simTimer != null) return;
    const notes = this.cfg.part.notes;
    // 'oneflat': the third note of the run (the section's, or the whole piece's) 70¢ flat.
    const flatIdx = (this.cfg.range?.[0] ?? 0) + 2;
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
        const off = kind === 'flat' ? -0.35 : kind === 'sloppy' ? (Math.sin(k * 1.7) > 0.3 ? 0.9 : 0.1) : kind === 'oneflat' && k === flatIdx ? -0.7 : 0;
        midi = n.midi + vib + off;
      }
      const s: PitchSample = { time: t, midi, clarity: midi == null ? 0.3 : 0.97, rms: midi == null ? 0.002 : 0.1 };
      this.latest = s;
      this.keep(s, s);
    }, 20);
  }

  private stopSimulation() {
    if (this.simTimer != null) clearInterval(this.simTimer);
    this.simTimer = null;
  }

  /** True when the microphone went away during this session (unplugged, taken by another app). */
  get micLost(): boolean {
    return !!this.tracker && !this.tracker.alive;
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
    this.resumeToken++;
    if (this.phase !== 'playing' && this.phase !== 'countin') return;
    // The run already ended (only the last notes' latency was being waited for): finish on resume.
    if (this.endTimer != null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    const pos = this.player.position;
    // During a (resumed run's) count-in the music hasn't reached the resume point yet: keep it, so
    // no bar is sung twice and sample times keep increasing.
    if (!(this.phase === 'countin' && pos < this.resumeFrom)) {
      this.resumeFrom = Math.max(this.cfg.from, Math.min(pos, this.cfg.to));
    }
    // A pause counts as breaking the run only once the singer's first note has started (pausing
    // during the count-in or the opening rest just starts again).
    if (this.resumeFrom > this.firstNoteTime() + 1e-3) this.pausedMidRun = true;
    this.unsubEnd?.();
    this.unsubEnd = null;
    this.player.stop();
    // A resumed run has a second time mapping: its recording couldn't be re-scored, so drop it.
    this.recorder?.stop();
    this.recorder = null;
    this.phase = 'paused';
    this.releaseWakeLock();
  }

  /**
   * Carry on after a pause. Resolves 'ok' only once playback has started again; on failure the
   * session stays paused (or reports the mic error) so the screen can say so.
   */
  async resume(): Promise<ResumeResult> {
    if (this.phase !== 'paused') return 'stale';
    const token = ++this.resumeToken;
    const stale = () => token !== this.resumeToken || this.phase !== 'paused' || this.disposed;
    // iOS suspends the context when the app is backgrounded; resume() can hang while 'interrupted'.
    const ctx = getAudioContext();
    let timer: number | undefined;
    await Promise.race([
      unlockAudio().catch(() => {}),
      new Promise<void>((res) => { timer = window.setTimeout(res, RESUME_TIMEOUT_MS); }),
    ]);
    clearTimeout(timer);
    if (stale()) return 'stale';
    if (ctx.state !== 'running') return 'audio';
    // The mic may have been released or lost while paused (backgrounded, headset change): reopen it.
    if (this.tracker && !this.tracker.alive && !this.cfg.simulate) {
      this.unsubPitch?.();
      this.unsubPitch = null;
      try {
        this.tracker = await getTracker();
      } catch (e) {
        if (stale()) return 'stale';
        this.micError = (e as { code?: string })?.code === 'denied' ? micErrorMessage(e) : 'The microphone could not be reopened.';
        return 'mic';
      }
      if (stale()) return 'stale';
      this.tracker.configureFor(this.cfg.lowestMidi ?? null);
      this.unsubPitch = this.tracker.onPitch((p) => this.onPitch(p));
    }
    if (this.ended) {
      // Paused while waiting for the last notes: nothing left to play, finish now.
      this.phase = 'playing';
      this.endTimer = window.setTimeout(() => this.finish(), 0);
      return 'ok';
    }
    this.minTime = this.resumeFrom - 0.02;
    this.play(this.resumeFrom, true);
    this.requestWakeLock();
    return 'ok';
  }

  private async requestWakeLock() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && !this.wakeLock) {
        const lock = await wl.request('screen');
        if (this.disposed || this.phase === 'paused' || this.phase === 'done') lock.release().catch(() => {});
        else this.wakeLock = lock;
      }
    } catch { /* not allowed / unsupported */ }
  }

  private releaseWakeLock() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  /** True when the last finish() came before the end of the section. */
  partial = false;

  /** The run was paused and resumed (not sung in one go). */
  get resumed(): boolean {
    return this.pausedMidRun && this.plays > 1;
  }

  private pausedMidRun = false;

  /** Score time of the singer's first note in this run. */
  private firstNoteTime(): number {
    const r = this.cfg.range;
    return r ? this.cfg.part.notes[r[0]]?.start ?? this.cfg.from : this.cfg.from;
  }

  finish() {
    if (this.phase === 'done') return;
    if (this.endTimer != null) clearTimeout(this.endTimer);
    this.endTimer = null;
    const pos = this.player.position;
    this.partial = this.phase === 'countin' || pos < this.cfg.to - 0.25;
    this.phase = 'done';
    this.unsubEnd?.();
    this.stopSimulation();
    this.releaseWakeLock();
    this.player.stop();
    const rec = this.recorder?.stop() ?? null;
    this.recorder = null;
    // A paused-and-resumed run has two time mappings; only keep uninterrupted recordings.
    if (rec && this.plays === 1 && this.tracker) {
      this.recording = { ...rec, scoreTimeAtSample0: this.player.scoreTimeAt(rec.startCtxTime), windowN: this.tracker.windowN };
    }
    let result = this.live ? this.live.finish(this.samples) : null;
    if (this.partial && this.cfg.range) {
      // Score only the notes that had started when the singer stopped.
      const [a, b] = this.cfg.range;
      let last = a - 1;
      for (let i = a; i <= b; i++) {
        const n = this.cfg.part.notes[i];
        // Only notes that were completely sung and whose sound has reached us (mic lags by the latency).
        if (n.start + n.dur <= pos - (this.latencyMs / 1000) * this.cfg.rate + 0.05) last = i;
      }
      result = last < a ? null : scoreAttempt({ score: this.cfg.score, part: this.cfg.part, range: [a, last], end: this.cfg.to }, this.samples, this.cfg.scoring);
    }
    this.onDone(result);
  }

  /** Stop without producing a result (navigating away). */
  dispose() {
    this.disposed = true;
    if (this.endTimer != null) clearTimeout(this.endTimer);
    this.endTimer = null;
    if (this.onStateChange) getAudioContext().removeEventListener('statechange', this.onStateChange);
    this.onStateChange = null;
    this.stopSimulation();
    this.releaseWakeLock();
    this.recorder?.stop();
    this.recorder = null;
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

/**
 * Uncalibrated devices: output latency + input/processing. Android browsers add the most (often
 * 120–250 ms round trip), iPhones less. Only a starting point: every run lines the voice up with
 * the music and learns the real delay (see game/align.ts).
 */
export function estimateLatencyMs(): number {
  let out = 0;
  try { out = outputLatencySec() * 1000; } catch { /* no context yet */ }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Android/i.test(ua)) return Math.round(Math.max(130, out + 70));
  const mobile = /iPhone|iPad|iPod|Mobile/i.test(ua);
  return Math.round(Math.max(mobile ? 80 : 50, out + 40));
}
