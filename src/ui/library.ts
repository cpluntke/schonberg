import { useEffect, useState } from 'react';
import type { Score, Section } from '../music/types';
import { importScoreFile } from '../music/import';
import { computeSections } from '../music/sections';
import { loadImportedScores, saveImportedScore, deleteImportedScore, loadCycle, saveCycle, subscribe } from '../progress/store';

export interface PieceInfo {
  id: string;
  title: string;
  composer: string;
  level?: string;
  description?: string;
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

interface CyclePreset {
  id: string;
  name: string;
  pieceIds: string[];
  wanted?: { title: string; composer: string; note?: string }[];
  titles?: Record<string, { title: string; composer: string }>;
  rehearsalWeekday?: number;
  rehearsalTime?: string;
  focusPieceIds?: string[];
  concertDate?: string;
}

async function loadPreset(base: string): Promise<CyclePreset | null> {
  try {
    const r = await fetch(`${base}pieces/cycle.json`);
    if (!r.ok) return null;
    const p = await r.json();
    return p && typeof p.id === 'string' && Array.isArray(p.pieceIds) ? p : null;
  } catch {
    return null;
  }
}

async function loadAll() {
  migrateIds();
  const base = import.meta.env.BASE_URL || './';
  const manifest = [
    ...(await loadManifest(base, 'repertoire.json')),
    ...(await loadManifest(base, 'manifest.json')),
  ];
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
          id: m.id, title: m.title, composer: m.composer, level: m.level, description: m.description, builtin: true,
        }));
      } catch (e) {
        console.error('Failed to load built-in piece', m.id, e);
      }
    }),
  );
  try {
    const imported = await loadImportedScores();
    for (const s of imported) pieces.set(s.id, makePiece(s));
  } catch (e) {
    console.error(e);
  }
  // The choir's current programme (public/pieces/cycle.json) replaces the demo cycle once.
  const preset = await loadPreset(base);
  const cycle = loadCycle();
  let seeded = false;
  let presetApplied: string | null = null;
  try {
    seeded = !!localStorage.getItem('sh:cycleSeeded');
    presetApplied = localStorage.getItem('sh:cyclePreset');
  } catch { /* storage blocked */ }
  const untouched = !cycle.pieceIds.length || cycle.name === 'Demo cycle' || cycle.preset != null;
  if (preset && presetApplied !== preset.id && untouched) {
    const own = cycle.pieceIds.filter((id) => pieces.get(id) && !pieces.get(id)!.builtin);
    const ids = preset.pieceIds.filter((id) => pieces.has(id));
    // Programme pieces we couldn't ship become "import your score" slots.
    const missing = preset.pieceIds.filter((id) => !pieces.has(id) && preset.titles?.[id]).map((id) => ({ ...preset.titles![id], note: 'import your choir’s score' }));
    saveCycle({
      name: preset.name,
      pieceIds: [...ids, ...own.filter((id) => !ids.includes(id))],
      wanted: [...(preset.wanted ?? []), ...missing],
      rehearsalWeekday: preset.rehearsalWeekday,
      rehearsalTime: preset.rehearsalTime,
      focusPieceIds: (preset.focusPieceIds ?? []).filter((id) => pieces.has(id)),
      concertDate: preset.concertDate,
      preset: preset.id,
    });
    try {
      localStorage.setItem('sh:cyclePreset', preset.id);
      localStorage.setItem('sh:cycleSeeded', '1');
    } catch { /* storage blocked */ }
  } else if (!cycle.pieceIds.length && !seeded) {
    const preferred = ['warmup-chorale', 'debussy-dieu', 'ravel-nicolette', 'bruckner-locus-iste'].filter((id) => pieces.has(id));
    cycle.pieceIds = preferred.length ? preferred : [...pieces.values()].filter((p) => p.builtin).slice(0, 4).map((p) => p.id);
    cycle.name = cycle.name === 'This cycle' ? 'Demo cycle' : cycle.name;
    const iso = (days: number) => {
      const d = new Date(Date.now() + days * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    cycle.rehearsalDate ??= iso(4);
    cycle.concertDate ??= iso(32);
    saveCycle(cycle);
    try { localStorage.setItem('sh:cycleSeeded', '1'); } catch { /* storage blocked */ }
  }
  loaded = true;
  emit();
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
