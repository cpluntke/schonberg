import type { AttemptResult } from '../../game/types';

export interface LastResult {
  pieceId: string;
  partId: string;
  sectionId: string;
  level: number;
  mode: '2d' | '3d';
  from: number;
  to: number;
  result: AttemptResult;
  passed: boolean;
  prevLevel: number;
  newLevel: number;
  /** True when the attempt counted toward the section ladder. */
  ladder: boolean;
  /** Best score at this section+level before this attempt (null if first). */
  prevBest?: number | null;
  /** Why a run of a real section didn't count toward its level. */
  notCounted?: string;
  /** Headphone/mic delay learned from this run (ms), if any. */
  latencyAdjusted?: number;
  /** The voice was lined up with the music by this many ms before scoring (device delay). */
  alignedMs?: number;
}

let last: LastResult | null = null;

export function setLastResult(r: LastResult) {
  last = r;
  try { sessionStorage.setItem('sh:lastResult', JSON.stringify(r)); } catch { /* quota */ }
}

export function getLastResult(): LastResult | null {
  if (last) return last;
  try {
    const s = sessionStorage.getItem('sh:lastResult');
    if (s) last = JSON.parse(s);
  } catch { /* ignore */ }
  return last;
}
