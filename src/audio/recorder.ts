// Records the microphone during a practice run, sample-accurately on the AudioContext clock, so a
// run can be shared as a reference recording (WAV + run.json) and re-scored offline with the exact
// same pipeline (see qa/realism/).
//
// Audio stays in memory on the phone; nothing is uploaded. Only the last run is kept.

const WORKLET = `
class ShRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; }; this.sent = false; }
  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      if (!this.sent) { this.port.postMessage({ start: currentTime }); this.sent = true; }
      this.port.postMessage({ data: ch.slice(0) });
    }
    return true;
  }
}
registerProcessor('sh-recorder', ShRecorder);
`;

/** At most this many seconds are kept (≈ 9 MB at 48 kHz, 16 bit). */
const MAX_SEC = 300;

const loaded = new WeakSet<BaseAudioContext>();

export interface Recording {
  /** 16-bit PCM, mono. */
  pcm: Int16Array;
  sampleRate: number;
  /** AudioContext time of the first sample. */
  startCtxTime: number;
}

export class RunRecorder {
  private chunks: Int16Array[] = [];
  private length = 0;
  private startCtxTime: number | null = null;
  private stopped = false;

  private constructor(
    private ctx: AudioContext,
    private node: AudioWorkletNode,
    private sink: GainNode,
    private source: AudioNode,
  ) {
    node.port.onmessage = (e: MessageEvent<{ start?: number; data?: Float32Array }>) => {
      if (this.stopped) return;
      if (e.data.start != null && this.startCtxTime == null) this.startCtxTime = e.data.start;
      const d = e.data.data;
      if (!d || this.length >= MAX_SEC * ctx.sampleRate) return;
      const out = new Int16Array(d.length);
      for (let i = 0; i < d.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767)));
      this.chunks.push(out);
      this.length += out.length;
    };
  }

  /** Start recording `source` (the mic). Resolves null where AudioWorklet isn't available. */
  static async start(ctx: AudioContext, source: AudioNode): Promise<RunRecorder | null> {
    try {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return null;
      if (!loaded.has(ctx)) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        loaded.add(ctx);
      }
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
    return { pcm, sampleRate: this.ctx.sampleRate, startCtxTime: this.startCtxTime };
  }
}

/** 16-bit mono PCM WAV file. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
  return out;
}
