import { useEffect, useState } from 'react';
import type { Score, Section } from '../music/types';
import { importScoreFile, PARSE_VERSION, upgradeStored } from '../music/import';
import { computeSections } from '../music/sections';
import { loadImportedScores, saveImportedScore, deleteImportedScore, loadCycle, saveCycle, subscribe } from '../progress/store';
import { cachedChoir, choirPieceId, localPieceId, syncChoir } from '../progress/choir';
import { hasPieceData, movePieceData } from '../progress/rekey';

export interface PieceInfo {
  id: string;
  title: string;
  composer: string;
  level?: string;
  description?: string;
  /** Edition / licence credit (shown in the Library and on the piece screen). */
  credit?: string;
  builtin: boolean;
  score: Score;
  sections: Section[];
}

interface ManifestEntry { id: string; file: string; title: string; composer: string; level?: string; description?: string; credit?: string; partNames?: string[] }

const pieces = new Map<string, PieceInfo>();
const virtual = new Map<string, PieceInfo>();
let loaded = false;
let loading: Promise<void> | null = null;
let loadError: string | null = null;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((l) => l()); }

export function makePiece(score: Score, extra: Partial<PieceInfo> = {}): PieceInfo {
  return {
    id: score.id,
    title: score.title || 'Untitled',
    composer: score.composer || '',
    ...(score.credit ? { credit: score.credit } : {}),
    builtin: false,
    score,
    sections: computeSections(score),
    ...extra,
  };
}

async function loadManifest(base: string, file: string): Promise<ManifestEntry[]> {
  try {
    const res = await fetch(`${base}pieces/${file}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Ids of built-in pieces that were renamed; progress and cycle entries are moved over. */
const RENAMED: Record<string, string> = {};
/** Built-in pieces that were withdrawn (e.g. an edition with wrong notes). */
const REMOVED: Record<string, string> = {
  'bach-bwv512': 'The Bach chorale “Gib dich zufrieden” was removed from the demo pieces because the edition had wrong notes.',
  'bach-bwv315': 'The Bach chorale “Gib dich zufrieden” was removed from the demo pieces because the edition had wrong notes.',
};

function migrateIds() {
  try {
    for (const [from, to] of Object.entries(RENAMED)) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const prefixes = [`sh:progress:${from}:`, `sh:part:${from}`];
        for (const pre of prefixes) {
          if (k.startsWith(pre)) {
            const nk = k.replace(from, to);
            if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k)!);
            localStorage.removeItem(k);
            i--;
          }
        }
      }
      const c = loadCycle();
      if (c.pieceIds.includes(from)) {
        c.pieceIds = c.pieceIds.map((x) => (x === from ? to : x));
        saveCycle(c);
      }
    }
    const c = loadCycle();
    const gone = c.pieceIds.filter((id) => REMOVED[id]);
    if (gone.length) {
      c.pieceIds = c.pieceIds.filter((id) => !REMOVED[id]);
      if (!c.pieceIds.includes('warmup-chorale')) c.pieceIds.unshift('warmup-chorale');
      saveCycle(c);
      localStorage.setItem('sh:notice', REMOVED[gone[0]]);
    }
  } catch { /* storage unavailable */ }
}

/**
 * Pieces that were built in until the choir library (`library/`, admins only) took them over. Solo
 * programmes drop them; the progress stays stored, so it comes back when a choir adds the piece
 * from its library (same id on the phone).
 */
const FORMER_BUILTINS = new Set([
  'bruckner-locus-iste', 'debussy-dieu', 'debussy-tabourin', 'debussy-yver', 'brahms-schaffe', 'ravel-nicolette', 'vierne-kyrie', 'faure-madrigal',
]);
/** The programme preset that used to be seeded from public/pieces/cycle.json. */
const FORMER_PRESET = { id: 'cycle-autumn-2026', name: 'Fauré · Debussy · Poulenc · Vierne', wanted: ['Vinea mea electa', 'Huit chansons françaises', 'Madrigal, Op. 35'] };
export const LIBRARY_NOTICE = 'The demo pieces by Bruckner, Debussy, Brahms, Ravel and Vierne are no longer built in: your choir admin can add them to your choir from the choir library. Your practice on them is kept.';

/** A solo programme (not the choir's) loses the pieces that are no longer built in. */
function dropFormerBuiltins() {
  const c = loadCycle();
  if (c.preset?.startsWith('choir:')) return; // the choir's programme: the choir sync owns it
  const gone = c.pieceIds.filter((id) => FORMER_BUILTINS.has(id) && !pieces.has(id));
  const fromPreset = c.preset === FORMER_PRESET.id;
  if (!gone.length && !fromPreset) return;
  const next = { ...c, pieceIds: c.pieceIds.filter((id) => !gone.includes(id)), focusPieceIds: (c.focusPieceIds ?? []).filter((id) => !gone.includes(id)) };
  if (fromPreset) {
    next.preset = undefined;
    next.wanted = (c.wanted ?? []).filter((w) => !FORMER_PRESET.wanted.includes(w.title));
    if (c.name === FORMER_PRESET.name) next.name = 'This cycle';
  }
  if (!next.pieceIds.length && pieces.has('warmup-chorale')) next.pieceIds = ['warmup-chorale'];
  saveCycle(next);
  if (gone.length) {
    try { localStorage.setItem('sh:notice', LIBRARY_NOTICE); } catch { /* storage blocked */ }
  }
}

/**
 * Older installs seeded the demo programme with made-up dates (rehearsal in 4 days, concert 28 days
 * after that), which read as the singer's own. Clear them once, only while they still look seeded.
 */
function dropDemoDates() {
  try { if (localStorage.getItem('sh:demoDatesCleared')) return; } catch { return; }
  const c = loadCycle();
  const day = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) / 86400000 : NaN);
  if (!c.preset && c.name === 'Demo cycle' && day(c.concertDate) - day(c.rehearsalDate) === 28) {
    saveCycle({ ...c, rehearsalDate: undefined, concertDate: undefined });
  }
  try { localStorage.setItem('sh:demoDatesCleared', '1'); } catch { /* storage blocked */ }
}

async function loadAll() {
  // Nothing here may leave the app on "Loading repertoire…": each step guards its own errors.
  try { migrateIds(); } catch (e) { console.error('migrateIds', e); }
  const base = import.meta.env.BASE_URL || './';
  const manifest = await loadManifest(base, 'manifest.json');
  if (!manifest.length) loadError = 'Could not load the built-in pieces.';
  await Promise.all(
    manifest.map(async (m) => {
      try {
        const r = await fetch(`${base}pieces/${m.file}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const score = await importScoreFile(m.file, await r.arrayBuffer());
        score.id = m.id;
        score.source = 'builtin';
        score.title = m.title;
        if (m.composer) score.composer = m.composer;
        if (m.partNames) {
          const vocal = score.parts.filter((x) => x.notes.length);
          m.partNames.forEach((name, i) => {
            if (!vocal[i]) return;
            vocal[i].name = name;
            const v = name[0].toUpperCase();
            if ('SATB'.includes(v)) vocal[i].voiceType = v as 'S' | 'A' | 'T' | 'B';
          });
        }
        pieces.set(m.id, makePiece(score, {
          id: m.id, title: m.title, composer: m.composer, level: m.level, description: m.description, credit: m.credit, builtin: true,
        }));
      } catch (e) {
        console.error('Failed to load built-in piece', m.id, e);
      }
    }),
  );
  try {
    const imported = await loadImportedScores();
    // One bad score must not hide the others.
    for (const s of imported) {
      try { pieces.set(s.id, makePiece(upgradeStored(s))); } catch (e) { console.error('Failed to load imported score', s?.id, e); }
    }
  } catch (e) {
    console.error(e);
  }
  try { dropFormerBuiltins(); } catch (e) { console.error('dropFormerBuiltins', e); }
  try { dropDemoDates(); } catch (e) { console.error('dropDemoDates', e); }
  try { seedCycle(); } catch (e) { console.error('seedCycle', e); }
  loaded = true;
  emit();
  // Your choir's programme and scores (in the background; works offline from the last sync).
  void syncChoirNow();
}

/** First start: the default solo programme. */
function seedCycle() {
  const cycle = loadCycle();
  let seeded = false;
  try { seeded = !!localStorage.getItem('sh:cycleSeeded'); } catch { /* storage blocked */ }
  if (!cycle.pieceIds.length && !seeded) {
    // The default solo programme: the built-in Abendlied.
    const preferred = ['warmup-chorale'].filter((id) => pieces.has(id));
    cycle.pieceIds = preferred.length ? preferred : [...pieces.values()].filter((p) => p.builtin).slice(0, 4).map((p) => p.id);
    cycle.name = cycle.name === 'This cycle' ? 'Demo cycle' : cycle.name;
    // No made-up dates: they stay empty until the singer or the choir sets them.
    saveCycle(cycle);
    try { localStorage.setItem('sh:cycleSeeded', '1'); } catch { /* storage blocked */ }
  }
}

/** A stored title worth keeping over the choir's: not empty, not "Untitled", not just the file's name. */
export function keptTitle(title: string | undefined, fileName: string): boolean {
  const t = (title ?? '').trim();
  const stem = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  return !!t && t !== 'Untitled' && t.toLowerCase() !== stem.toLowerCase();
}

let syncing: Promise<Awaited<ReturnType<typeof syncChoir>>> | null = null;
/** Download the choir's new scores and apply its programme. */
export function syncChoirNow(): Promise<Awaited<ReturnType<typeof syncChoir>>> {
  if (!syncing) {
    syncing = syncChoir(async (name, data, meta) => {
      const score = await importScoreFile(name, data);
      score.id = meta.id;
      if (meta.title) score.title = meta.title;
      if (meta.composer) score.composer = meta.composer;
      if (meta.credit) score.credit = meta.credit;
      score.choir = meta.choir;
      // Imported again by a newer importer: the singer keeps the names they gave it, but not a title
      // that is only the file's name (an earlier import of a score without a title), nor an empty one.
      const old = pieces.get(score.id)?.score;
      if (old?.choir) {
        if (keptTitle(old.title, name)) score.title = old.title;
        if (old.composer?.trim()) score.composer = old.composer;
      }
      const saved = await saveImportedScore(score);
      pieces.set(score.id, makePiece(score));
      emit();
      // A re-import that couldn't be stored (storage full) is used now, but not downloaded again
      // on every start: failing here puts it on the once-a-day retry list.
      if (!saved && old) throw new Error('re-imported score kept in memory only');
    }, (id) => pieces.has(id), (id) => {
      // The singer's own imports stay in the cycle when the choir's programme arrives (not the choir's scores).
      const p = pieces.get(id);
      return !!p && isOwnPiece(p);
    }, (id) => {
      // A choir score stored by an older importer (e.g. without the notes' written spelling) is
      // downloaded again; until then (offline) the stored one keeps working.
      const p = pieces.get(id);
      // (MIDI files gain nothing from it: they have no written spelling)
      return !!p && !p.builtin && !!p.score.choir && p.score.source === 'musicxml' && (p.score.parseVersion ?? 1) < PARSE_VERSION;
    }).then(async (r) => { await adoptLibraryIds(); await fixChoirTitles(); return r; }).finally(() => { syncing = null; emit(); });
  }
  return syncing;
}

/**
 * A choir score stored with only its file's name as the title (or none, or no composer), e.g. a score
 * without a title imported before the choir sent one: the choir's title and composer replace them.
 */
export async function fixChoirTitles(): Promise<void> {
  const info = cachedChoir();
  if (!info) return;
  for (const p of info.pieces) {
    const piece = pieces.get(localPieceId(info.code, p));
    if (!piece || piece.builtin || !piece.score.choir) continue;
    const score = { ...piece.score };
    let changed = false;
    if (p.title?.trim() && !keptTitle(score.title, p.filename || '') && score.title !== p.title) { score.title = p.title; changed = true; }
    if (p.composer?.trim() && !score.composer?.trim()) { score.composer = p.composer; changed = true; }
    if (!changed) continue;
    try { await saveImportedScore(score); } catch (e) { console.error('fixChoirTitles', e); }
    pieces.set(score.id, makePiece(score));
  }
}

/**
 * A choir score that came from the choir library is kept under its library id (choir.ts localPieceId).
 * A phone that stored it earlier under its choir-score id ("choir-<code>-<id>") has it twice once the
 * library copy arrives: the singer's progress moves over to the library copy (where the programme, the
 * leaderboard and the section lead look for it) and the old copy goes.
 */
export async function adoptLibraryIds(): Promise<void> {
  const info = cachedChoir();
  if (!info) return;
  for (const p of info.pieces) {
    const to = localPieceId(info.code, p);
    const from = choirPieceId(info.code, p.id);
    // (only once the library copy is on the phone; also data an account copy brought back after the old score went)
    if (to === from || !pieces.has(to) || (!pieces.has(from) && !hasPieceData(from))) continue;
    try {
      movePieceData(from, to);
    } catch { continue; /* storage unavailable: tried again next time */ }
    if (pieces.has(from)) await removeImported(from);
  }
}

export function ensureLoaded(): Promise<void> {
  if (!loading) loading = loadAll();
  return loading;
}

type Resolver = (id: string) => PieceInfo | undefined;
const resolvers: Resolver[] = [];

/** Generated pieces (drills, rows) can be rebuilt from their id after a reload. */
export function registerResolver(r: Resolver) {
  resolvers.push(r);
}

export function getPiece(id: string): PieceInfo | undefined {
  if (RENAMED[id]) id = RENAMED[id];
  const p = pieces.get(id) ?? virtual.get(id);
  if (p) return p;
  for (const r of resolvers) {
    const v = r(id);
    if (v) {
      virtual.set(id, v);
      return v;
    }
  }
  return undefined;
}

/**
 * The programme's pieces on this phone: the cycle's pieces that are here, the singer's own imports
 * included (an import can fill a wanted slot, rehearsal focus too). The Choir tab and Ranks use this.
 */
export function programmePieces(cycle: { pieceIds: string[] } = loadCycle()): PieceInfo[] {
  return cycle.pieceIds.map((id) => getPiece(id)).filter((p): p is PieceInfo => !!p);
}

/** A score the singer imported themselves (not built in, not one of the choir's). */
export function isOwnPiece(p: Pick<PieceInfo, 'id' | 'builtin' | 'score'>): boolean {
  return !p.builtin && !p.id.startsWith('choir-') && !p.score.choir;
}

export function registerVirtual(p: PieceInfo) {
  virtual.set(p.id, p);
}

export function allPieces(): PieceInfo[] {
  const order: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  return [...pieces.values()].sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? 1 : -1;
    return (order[a.level ?? ''] ?? 9) - (order[b.level ?? ''] ?? 9) || a.title.localeCompare(b.title);
  });
}

export async function addImported(score: Score): Promise<PieceInfo & { persisted: boolean }> {
  const persisted = await saveImportedScore(score);
  const p = makePiece(score);
  pieces.set(p.id, p);
  const cycle = loadCycle();
  if (!cycle.pieceIds.includes(p.id)) {
    cycle.pieceIds = [p.id, ...cycle.pieceIds];
    saveCycle(cycle);
  }
  emit();
  return Object.assign(p, { persisted });
}

export async function removeImported(id: string) {
  await deleteImportedScore(id);
  pieces.delete(id);
  const cycle = loadCycle();
  cycle.pieceIds = cycle.pieceIds.filter((x) => x !== id);
  saveCycle(cycle);
  emit();
}

export function useLibrary(): { ready: boolean; error: string | null; version: number } {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    const unsub = subscribe(l);
    ensureLoaded();
    return () => {
      listeners.delete(l);
      unsub();
    };
  }, []);
  return { ready: loaded, error: loadError, version };
}

/** Sections in which this part actually sings. */
export function singableSections(p: PieceInfo, partId: string): Section[] {
  const part = p.score.parts.find((x) => x.id === partId);
  if (!part) return [];
  return p.sections.filter((s) => part.notes.some((n) => n.start >= s.start - 1e-6 && n.start < s.end - 1e-6));
}

export function noteRangeFor(p: PieceInfo, partId: string, from: number, to: number): [number, number] | null {
  const part = p.score.parts.find((x) => x.id === partId);
  if (!part) return null;
  let a = -1;
  let b = -1;
  part.notes.forEach((n, i) => {
    if (n.start >= from - 1e-6 && n.start < to - 1e-6) {
      if (a < 0) a = i;
      b = i;
    }
  });
  return a < 0 ? null : [a, b];
}

/** Pick the part matching the singer's voice type, else the first vocal part. */
export function defaultPartId(p: PieceInfo, voice: string): string {
  const parts = p.score.parts;
  return (parts.find((x) => x.voiceType === voice) ?? parts.find((x) => x.voiceType !== 'other') ?? parts[0])?.id ?? '';
}

/** The part this singer practises in a piece: remembered choice, else by voice type. */
export function chosenPartId(p: PieceInfo, voice: string): string {
  try {
    const saved = localStorage.getItem(`sh:part:${p.id}`);
    if (saved && p.score.parts.some((x) => x.id === saved)) return saved;
  } catch { /* ignore */ }
  return defaultPartId(p, voice);
}

export function rememberPart(pieceId: string, partId: string) {
  try { localStorage.setItem(`sh:part:${pieceId}`, partId); } catch { /* ignore */ }
}

/** Rename an imported piece (title / composer) and persist it. */
export async function renameImported(id: string, title: string, composer: string) {
  const p = pieces.get(id);
  if (!p || p.builtin) return;
  p.title = p.score.title = title.trim() || p.title;
  p.composer = p.score.composer = composer.trim();
  await saveImportedScore(p.score);
  emit();
}
