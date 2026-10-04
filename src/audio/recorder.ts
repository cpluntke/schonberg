// Records the microphone during a practice run, sample-accurately on the AudioContext clock, so a
// run can be shared as a reference recording (WAV + run.json) and re-scored offline with the exact
// same pipeline (see qa/realism/).
//
// Audio stays in memory on the phone; nothing is uploaded. Only the last run is kept.

const WORKLET = `
// Converts to 16 bit and posts ~4096-frame batches (transferred, not copied).
class ShRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true;
    this.buf = new Int16Array(4096);
    this.n = 0;
    this.sent = false;
    this.port.onmessage = (e) => { if (e.data === 'stop') { this.flush(); this.on = false; } };
  }
  flush() {
    if (this.n === 0) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ data: out }, [out.buffer]);
    this.n = 0;
  }
  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      if (!this.sent) { this.port.postMessage({ start: currentTime }); this.sent = true; }
      for (let i = 0; i < ch.length; i++) {
        const v = ch[i] * 32767;
        this.buf[this.n++] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
        if (this.n === this.buf.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('sh-recorder', ShRecorder);
`;

/** At most this many seconds are kept (≈ 23 MB at 48 kHz, 16 bit). */
const MAX_SEC = 240;

const loading = new WeakMap<BaseAudioContext, Promise<void>>();

export interface Recording {
  /** 16-bit PCM, mono. */
  pcm: Int16Array;
  sampleRate: number;
  /** AudioContext time of the first sample. */
  startCtxTime: number;
  /** True when the run was longer than the recording limit (the end is missing). */
  truncated: boolean;
}

export class RunRecorder {
  private chunks: Int16Array[] = [];
  private length = 0;
  private startCtxTime: number | null = null;
  private stopped = false;
  private truncated = false;

  private constructor(
    private ctx: AudioContext,
    private node: AudioWorkletNode,
    private sink: GainNode,
    private source: AudioNode,
  ) {
    node.port.onmessage = (e: MessageEvent<{ start?: number; data?: Int16Array }>) => {
      if (this.stopped) return;
      if (e.data.start != null && this.startCtxTime == null) this.startCtxTime = e.data.start;
      const d = e.data.data;
      if (!d) return;
      if (this.length >= MAX_SEC * ctx.sampleRate) {
        this.truncated = true;
        return;
      }
      this.chunks.push(d);
      this.length += d.length;
    };
  }

  /** Start recording `source` (the mic). Resolves null where AudioWorklet isn't available. */
  static async start(ctx: AudioContext, source: AudioNode): Promise<RunRecorder | null> {
    try {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return null;
      let ready = loading.get(ctx);
      if (!ready) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        ready = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
        loading.set(ctx, ready);
        ready.catch(() => loading.delete(ctx));
      }
      await ready;
      const node = new AudioWorkletNode(ctx, 'sh-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      // Browsers only process nodes that lead to the destination: route through a muted gain.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
      return new RunRecorder(ctx, node, sink, source);
    } catch (e) {
      console.warn('Recording unavailable', e);
      return null;
    }
  }

  /** Stop and return what was recorded (null if nothing). */
  stop(): Recording | null {
    if (!this.stopped) {
      this.stopped = true;
      try { this.node.port.postMessage('stop'); } catch { /* ignore */ }
      try {
        this.source.disconnect(this.node);
        this.node.disconnect();
        this.sink.disconnect();
      } catch { /* ignore */ }
    }
    if (this.startCtxTime == null || this.length === 0) return null;
    const pcm = new Int16Array(this.length);
    let o = 0;
    for (const c of this.chunks) { pcm.set(c, o); o += c.length; }
    this.chunks = [];
    return { pcm, sampleRate: this.ctx.sampleRate, startCtxTime: this.startCtxTime, truncated: this.truncated };
  }
}

/** 16-bit mono PCM WAV file (little-endian samples, as on every phone). */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(out.buffer);
  const le = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  if (le) out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  else for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
  return out;
}
