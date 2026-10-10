// Wires the anonymous usage statistics (src/progress/metrics.ts) into the app: what a finished run
// tells them, and the once-a-day facts (choir account, sync, sharing, joining a choir).

import { flushLive, installUsageStats, track, trackOnce, trackRun, type RunKind } from '../progress/metrics';
import { attemptLog, loadProfile, subscribe, type FullRunRecord } from '../progress/store';
import { loadSession, onSessionChange } from '../progress/choir';
import type { AttemptResult } from '../game/types';
import type { Part } from '../music/types';

function noteState(): void {
  const p = loadProfile();
  const s = loadSession();
  if (s) trackOnce('feat.account', 'feat.account');
  if (s && p.sync !== false) trackOnce('feat.sync', 'feat.sync');
  if (p.choirCode && p.shareProgress) trackOnce('feat.share', 'feat.share');
}

let started = false;
export function startUsageStats(): void {
  if (started) return;
  started = true;
  installUsageStats();
  noteState();
  let code = loadProfile().choirCode ?? '';
  subscribe(() => {
    const c = loadProfile().choirCode ?? '';
    if (c && c !== code) track('feat.choir_join');
    code = c;
  });
  onSessionChange(noteState);
}

const DAY_MS = 86_400_000;

/** Calendar days since the piece was first practised (from the practice log). */
function daysSinceFirstPractice(pieceId: string, now = Date.now()): number | undefined {
  let first = Infinity;
  for (const e of attemptLog()) if (e.pieceId === pieceId && e.at < first) first = e.at;
  return Number.isFinite(first) ? Math.floor((now - first) / DAY_MS) : undefined;
}

export interface PlayRun {
  pieceId: string;
  part: Part;
  sectionId: string;
  level: number;
  /** The level's step (attempts-to-pass are counted per step). */
  step?: 'slow' | 'tempo';
  mode: '2d' | '3d';
  listenOnly: boolean;
  /** A real section of the piece (not the whole piece, a drill, entries or a cold start). */
  realSection: boolean;
  /** Counted toward the level (section ladder or counted full run). */
  ladder: boolean;
  passed: boolean;
  rate: number;
  durationSec: number;
  display: 'score' | 'highway';
  fullScore: boolean;
  result?: AttemptResult;
  full?: FullRunRecord;
  suggestDelayCheck?: boolean;
  timingUnsure?: number;
  timingFail?: number;
  alignedMs?: number;
  latencyUsedMs?: number;
  latencySource?: 'measured' | 'learned';
}

/** What one finished run on the practice screen tells the statistics. */
export function trackPlayRun(r: PlayRun): void {
  try {
    const kind: RunKind = r.listenOnly ? 'listen'
      : r.mode === '3d' ? 'arcade'
        : r.sectionId === 'all' ? 'full'
          : r.sectionId === 'cold' ? 'cold'
            : !r.realSection ? 'drill'
              : r.ladder ? 'section' : 'practice';
    const ready = r.full && r.full.prevLevel < 3 && r.full.newLevel >= 3 ? daysSinceFirstPractice(r.pieceId) : undefined;
    trackRun({
      kind,
      level: r.listenOnly ? 0 : r.level,
      passed: r.passed,
      counted: r.ladder,
      seconds: r.durationSec,
      triesKey: r.ladder ? `${r.pieceId}|${r.part.id}|${r.sectionId}${r.step === 'slow' ? '|slow' : ''}` : undefined,
      display: r.listenOnly ? undefined : r.fullScore ? 'fullscore' : r.display,
      notes: r.result?.notes.map((n) => ({ sec: (r.part.notes[n.index]?.dur ?? 0) / (r.rate || 1), hit: n.grade !== 'miss' })),
      delaySuggested: r.suggestDelayCheck,
      timingUnsure: r.timingUnsure != null,
      timingFail: r.timingFail != null,
      aligned: !!r.alignedMs,
      latency: r.latencyUsedMs != null ? { ms: r.latencyUsedMs, source: r.latencySource === 'measured' ? 'measured' : r.latencySource === 'learned' ? 'learned' : 'est' } : undefined,
      full: r.full ? { counted: r.full.opened, toFix: r.full.toFix.length, tooMuch: !!r.full.tooMuch } : undefined,
      rehearsalReadyAfterDays: ready,
    });
    void flushLive(); // (the last 24 hours: at most every few minutes)
  } catch { /* statistics never break a run */ }
}
