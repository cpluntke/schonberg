// Tiny WAV reader/writer: PCM 16-bit and IEEE float 32-bit, mono or multi-channel (mixed to mono).

export interface WavData { sampleRate: number; channels: number; pcm: Float32Array }

export function readWav(bytes: Uint8Array): WavData {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: { off: number; len: number } | null = null;
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const len = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const sampleRate = dv.getUint32(body + 4, true);
      const bits = dv.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first 2 bytes of the sub-format GUID.
      if (format === 0xfffe && len >= 26) format = dv.getUint16(body + 24, true);
      fmt = { format, channels, sampleRate, bits };
    } else if (id === 'data') {
      data = { off: body, len: Math.min(len, bytes.length - body) };
    }
    o = body + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('WAV without fmt/data chunk');
  const { format, channels, sampleRate, bits } = fmt;
  const bps = bits / 8;
  const frames = Math.floor(data.len / (bps * channels));
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      const p = data.off + (i * channels + c) * bps;
      if (format === 1 && bits === 16) s += dv.getInt16(p, true) / 32768;
      else if (format === 3 && bits === 32) s += dv.getFloat32(p, true);
      else if (format === 1 && bits === 24) s += ((dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16)) / 8388608);
      else throw new Error(`Unsupported WAV format ${format} / ${bits}-bit`);
    }
    pcm[i] = s / channels;
  }
  return { sampleRate, channels, pcm };
}

/** Encode mono PCM as 16-bit WAV (what the app exports). */
export function writeWav16(pcm: Float32Array, sampleRate: number): Uint8Array {
  const n = pcm.length;
  const out = new Uint8Array(44 + n * 2);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true);
  return out;
}
