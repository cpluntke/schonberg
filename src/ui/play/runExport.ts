// The last run's recording + everything needed to re-score it offline (qa/realism/scoreRecording).
// Kept in memory only; shared as a .zip (run.wav + run.json) when the singer chooses to.

import { zipSync, strToU8 } from 'fflate';
import { encodeWav, type Recording } from '../../audio/recorder';
import type { AttemptResult, PitchSample, ScoringOptions } from '../../game/types';
import { outputLatencySec, getAudioContext } from '../../audio/context';

export interface RunMeta {
  pieceId: string;
  pieceTitle: string;
  partId: string;
  partName: string;
  from: number;
  to: number;
  rate: number;
  level: number;
  scoring: ScoringOptions;
  /** Delay the app applied during the run (ms) and whether it was measured with the delay check. */
  latencyMs: number;
  calibrated: boolean;
  /** Shift found by lining the voice up after the run (ms). */
  alignedMs: number;
  samples: PitchSample[];
  result: AttemptResult;
}

export interface RunExport {
  recording: Recording & { scoreTimeAtSample0: number; windowN: number };
  meta: RunMeta;
  at: number;
}

let last: RunExport | null = null;

export function setLastRun(r: RunExport | null): void {
  last = r;
}

export function getLastRun(): RunExport | null {
  return last;
}

/** run.json: the sidecar format read by qa/realism (version 1), plus context for debugging. */
export function runJson(r: RunExport): string {
  const { meta, recording } = r;
  let device: Record<string, unknown> = {};
  try {
    const ctx = getAudioContext();
    device = {
      userAgent: navigator.userAgent,
      sampleRate: ctx.sampleRate,
      baseLatencyMs: Math.round((ctx.baseLatency || 0) * 1000),
      outputLatencyMs: Math.round(outputLatencySec(ctx) * 1000),
    };
  } catch { /* ignore */ }
  const res = meta.result;
  return JSON.stringify({
    version: 1,
    pieceId: meta.pieceId,
    pieceTitle: meta.pieceTitle,
    partId: meta.partId,
    partName: meta.partName,
    from: meta.from,
    to: meta.to,
    rate: meta.rate,
    level: meta.level,
    toleranceCents: meta.scoring.toleranceCents,
    tuning: meta.scoring.tuning,
    octaveTolerant: meta.scoring.octaveTolerant,
    latencyMs: meta.latencyMs,
    calibrated: meta.calibrated,
    alignedMs: meta.alignedMs,
    sampleRate: recording.sampleRate,
    scoreTimeAtSample0: recording.scoreTimeAtSample0,
    windowN: recording.windowN,
    truncated: recording.truncated,
    app: { build: typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev', recordedAt: new Date(r.at).toISOString() },
    device,
    result: {
      accuracy: res.accuracy, pitch: res.pitch, rhythm: res.rhythm, counts: res.counts,
      notes: res.notes.map((n) => ({ i: n.index, g: n.grade, c: n.cents == null ? null : Math.round(n.cents), hit: +n.hitRatio.toFixed(2), on: n.onsetMs == null ? null : Math.round(n.onsetMs) })),
      insights: res.insights.map((i) => i.kind),
    },
    // The app's own pitch readings (score time, fractional MIDI) for comparison with offline tracking.
    samples: meta.samples.map((s) => [+s.time.toFixed(3), s.midi == null ? null : +s.midi.toFixed(3), +s.clarity.toFixed(2), +s.rms.toFixed(4)]),
  });
}

export function runFileName(r: RunExport): string {
  const d = new Date(r.at);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const safe = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  return `schonberg-${safe(r.meta.pieceId)}-${safe(r.meta.partName)}-L${r.meta.level}-${stamp}.zip`;
}

export function runZip(r: RunExport): Uint8Array {
  return zipSync({
    'run.wav': [encodeWav(r.recording.pcm, r.recording.sampleRate), { level: 0 }],
    'run.json': strToU8(runJson(r)),
  });
}

/** Share (phone share sheet: the WAV plus run.json as text, which Android accepts) or download a zip. */
export async function shareRun(r: RunExport): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const name = runFileName(r);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof File !== 'undefined' && nav.share && nav.canShare) {
    const base = name.replace(/\.zip$/, '');
    const files = [
      new File([encodeWav(r.recording.pcm, r.recording.sampleRate) as BlobPart], `${base}.wav`, { type: 'audio/wav' }),
      new File([runJson(r)], `${base}.json.txt`, { type: 'text/plain' }),
    ];
    if (nav.canShare({ files })) {
      try {
        await nav.share({ files, title: 'Schönberg Hero recording', text: `${r.meta.pieceTitle}, ${r.meta.partName}, L${r.meta.level}` });
        return 'shared';
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
        // Fall through to a download.
      }
    }
  }
  const blob = new Blob([runZip(r) as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
