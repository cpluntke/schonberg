// A piece's id changed on this phone (a choir-library score stored earlier under its choir-score id,
// "choir-<code>-<id>", now kept under its library id): everything the singer did on it moves to the new
// id. Where the new id already has something (e.g. from when the piece was built in), the two are merged
// the way two phones' copies are (sync.ts), so nothing newer is lost.

import { allKeys, loadCycle, rawGet, rawRemove, rawSet, saveCycle } from './store';
import { mergeBars, mergeProgress } from './sync';
import type { WordsProgress } from './words';

const parse = (s: string | null): unknown => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Per section: the higher stage passed, the best accuracy per stage, the later time. */
function mergeWords(a: Record<string, WordsProgress>, b: Record<string, WordsProgress>): Record<string, WordsProgress> {
  const out = { ...a };
  for (const [s, w] of Object.entries(b)) {
    const o = out[s];
    if (!isObj(o)) { out[s] = w; continue; }
    const best: Record<number, number> = { ...o.best };
    for (const [k, v] of Object.entries(w.best ?? {})) best[Number(k)] = Math.max(best[Number(k)] ?? 0, Number(v) || 0);
    out[s] = { passed: Math.max(o.passed ?? -1, w.passed ?? -1), best, at: Math.max(o.at ?? 0, w.at ?? 0) };
  }
  return out;
}

/** The lyrics quiz: answer counts add up. */
function mergeQuiz(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a, ...b };
  for (const field of ['lines', 'words']) {
    const la = isObj(a[field]) ? (a[field] as Record<string, [number, number]>) : {};
    const lb = isObj(b[field]) ? (b[field] as Record<string, [number, number]>) : {};
    const m: Record<string, [number, number]> = { ...la };
    for (const [k, v] of Object.entries(lb)) {
      const o = m[k];
      m[k] = Array.isArray(o) && Array.isArray(v) ? [(o[0] || 0) + (v[0] || 0), (o[1] || 0) + (v[1] || 0)] : v;
    }
    if (field in a || field in b) out[field] = m;
  }
  out.rounds = (Number(a.rounds) || 0) + (Number(b.rounds) || 0);
  if (a.bestScore != null || b.bestScore != null) out.bestScore = Math.max(Number(a.bestScore) || 0, Number(b.bestScore) || 0);
  return out;
}

/** Whether anything is stored under `from` (so a move is due). */
export function hasPieceData(from: string): boolean {
  return allKeys().some((k) => k === `sh:part:${from}` || ['sh:progress:', 'sh:bars:', 'sh:words:', 'sh:lyricsQuiz:'].some((p) => k.startsWith(`${p}${from}:`)));
}

/** Move (merging) all of a piece's data from one id to another. Idempotent; throws only if storage fails. */
export function movePieceData(from: string, to: string): void {
  if (from === to) return;
  for (const k of allKeys()) {
    const kind = ['sh:progress:', 'sh:bars:', 'sh:words:', 'sh:lyricsQuiz:'].find((p) => k.startsWith(`${p}${from}:`));
    if (!kind && k !== `sh:part:${from}`) continue;
    const nk = kind ? `${kind}${to}:${k.slice(kind.length + from.length + 1)}` : `sh:part:${to}`;
    const src = rawGet(k);
    const dst = rawGet(nk);
    let out = src;
    if (dst != null && src != null) {
      const a = parse(dst), b = parse(src);
      if (kind === 'sh:progress:' && isObj(a) && isObj(b)) out = JSON.stringify(mergeProgress(a as never, b as never));
      else if (kind === 'sh:bars:' && isObj(a) && isObj(b)) out = JSON.stringify(mergeBars(a as never, b as never));
      else if (kind === 'sh:words:' && isObj(a) && isObj(b)) out = JSON.stringify(mergeWords(a as never, b as never));
      else if (kind === 'sh:lyricsQuiz:' && isObj(a) && isObj(b)) out = JSON.stringify(mergeQuiz(a, b));
      else out = dst; // (the part chosen on the new id stays)
    }
    if (out != null) rawSet(nk, out);
    rawRemove(k);
  }
  // Readiness history ("piece|part" → day → %): the days merge (the higher value on the same day).
  const rh = parse(rawGet('sh:readiness2'));
  if (isObj(rh)) {
    let changed = false;
    for (const id of Object.keys(rh)) {
      if (!id.startsWith(`${from}|`)) continue;
      const nid = `${to}|${id.slice(from.length + 1)}`;
      const merged: Record<string, number> = { ...(isObj(rh[nid]) ? (rh[nid] as Record<string, number>) : {}) };
      for (const [day, v] of Object.entries(isObj(rh[id]) ? (rh[id] as Record<string, number>) : {})) merged[day] = Math.max(merged[day] ?? 0, Number(v) || 0);
      rh[nid] = merged;
      delete rh[id];
      changed = true;
    }
    if (changed) rawSet('sh:readiness2', JSON.stringify(rh));
  }
  // The practice log, the sections already seen, the last run's piece.
  const log = parse(rawGet('sh:log'));
  if (Array.isArray(log) && log.some((e) => isObj(e) && e.pieceId === from)) {
    rawSet('sh:log', JSON.stringify(log.map((e) => (isObj(e) && e.pieceId === from ? { ...e, pieceId: to } : e))));
  }
  const seen = parse(rawGet('sh:seenSections'));
  if (Array.isArray(seen) && seen.some((s) => typeof s === 'string' && s.startsWith(`${from}|`))) {
    rawSet('sh:seenSections', JSON.stringify([...new Set(seen.map((s) => (typeof s === 'string' && s.startsWith(`${from}|`) ? `${to}|${s.slice(from.length + 1)}` : s)))]));
  }
  const last = parse(rawGet('sh:lastRunPiece'));
  if (isObj(last) && last.pieceId === from) rawSet('sh:lastRunPiece', JSON.stringify({ ...last, pieceId: to }));
  // The programme and the next rehearsal's focus.
  const c = loadCycle();
  const swap = (ids: string[] | undefined) => (ids ? [...new Set(ids.map((x) => (x === from ? to : x)))] : ids);
  if (c.pieceIds.includes(from) || c.focusPieceIds?.includes(from)) saveCycle({ ...c, pieceIds: swap(c.pieceIds)!, ...(c.focusPieceIds ? { focusPieceIds: swap(c.focusPieceIds) } : {}) });
}
