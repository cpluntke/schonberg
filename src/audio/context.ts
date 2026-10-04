// Singleton AudioContext + iOS-friendly unlock.

let ctx: AudioContext | null = null;

type AudioContextCtor = typeof AudioContext;

/** Returns the app-wide AudioContext (created lazily, latencyHint 'interactive'). */
export function getAudioContext(): AudioContext {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctor: AudioContextCtor =
    (globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor })
      .AudioContext ??
    (globalThis as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
  ctx = new Ctor({ latencyHint: 'interactive' });
  return ctx;
}

/**
 * Call from a user gesture (click/touchend). Resumes the context and plays a
 * one-sample silent buffer, which is what iOS Safari needs to actually start
 * audio output (and to keep the ringer-switch from muting WebAudio on newer iOS
 * we also try navigator.audioSession when available).
 */
export async function unlockAudio(): Promise<void> {
  const c = getAudioContext();
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    // iOS 17+: 'play-and-record' keeps output audible while the mic is open.
    if (nav.audioSession && nav.audioSession.type === 'auto') nav.audioSession.type = 'play-and-record';
  } catch {
    /* ignore */
  }
  try {
    const buf = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
    src.onended = () => src.disconnect();
  } catch {
    /* ignore */
  }
  if (c.state !== 'running') {
    try {
      await c.resume();
    } catch {
      /* ignore: will retry on next gesture */
    }
  }
}

/**
 * Output-side latency in seconds as reported by the browser
 * (outputLatency where supported — not on all Safari versions — plus baseLatency).
 */
export function outputLatencySec(c: AudioContext = getAudioContext()): number {
  const out = (c as AudioContext & { outputLatency?: number }).outputLatency || 0;
  const base = c.baseLatency || 0;
  return out + base;
}
