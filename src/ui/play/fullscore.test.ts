import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makePart, makeScore } from '../../game/testutil';
import { importScoreFile } from '../../music/import';
import type { Part, Score, VoiceType } from '../../music/types';
import {
  accompaniment, defaultShow, hasOtherStaves, layoutFullScore, MAX_VOICE_STAVES, planStaves, shortName, voiceParts,
  type StaffSpec,
} from './fullscore';
import { layoutStaff } from './staff2d';

const textW = (t: string) => t.length * 7;

async function load(file: string): Promise<Score> {
  const buf = readFileSync(file);
  return importScoreFile(file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

function part(id: string, vt: VoiceType, spec: [number | null, number][], name = id): Part {
  return { ...makePart(id, spec), voiceType: vt, name };
}

const bars = (n: number, midi: number, d: number) => Array.from({ length: (n * 4) / d }, () => [midi, d] as [number, number]);

describe('which staves', () => {
  it('orders voices soprano to bass (divisi in score order), accompaniment last', () => {
    const s = makeScore([
      part('org', 'other', bars(2, 48, 2), 'Organ'),
      part('b', 'B', bars(2, 48, 1), 'Bass'),
      part('t2', 'T', bars(2, 55, 1), 'Tenor 2'),
      part('s', 'S', bars(2, 72, 1), 'Soprano'),
      part('t1', 'T', bars(2, 57, 1), 'Tenor 1'),
      part('a', 'A', bars(2, 65, 1), 'Alto'),
    ]);
    expect(planStaves(s, 'a', 'all').map((x) => x.id)).toEqual(['s', 'a', 't2', 't1', 'b', 'acc']);
    expect(planStaves(s, 'a', 'voices').map((x) => x.id)).toEqual(['s', 'a', 't2', 't1', 'b']);
    expect(planStaves(s, 'a', 'mine').map((x) => x.id)).toEqual(['a']);
    expect(planStaves(s, 'a', 'all').map((x) => x.short)).toEqual(['S', 'A', 'T2', 'T1', 'B', 'Org.']);
  });

  it('finds your own staff among divisi parts', async () => {
    const tab = await load('public/pieces/pd/debussy-tabourin.mxl');
    const st = planStaves(tab, 'P3-2', 'all');
    expect(st.map((x) => x.short)).toEqual(['A solo', 'A1', 'A2', 'T1', 'T2', 'B']);
    expect(st.filter((x) => x.own).map((x) => x.id)).toEqual(['P3-2']);
    expect(planStaves(tab, 'P3-1', 'voices').findIndex((x) => x.own)).toBe(3);
    expect(st.every((x) => x.kind === 'voice')).toBe(true);
    expect(defaultShow(tab, 'P3-2')).toBe('voices'); // nothing to accompany
  });

  it('puts organ and pedal on one grand staff (split at middle C) under SATB', async () => {
    const kyrie = await load('public/pieces/pd/vierne-kyrie.mxl');
    const st = planStaves(kyrie, 'P2', 'all');
    expect(st.map((x) => x.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'acc:up', 'acc:lo']);
    expect(st.slice(4).map((x) => [x.clef, x.name, x.short])).toEqual([['treble', 'Organ', 'Org.'], ['bass', 'Organ', 'Org.']]);
    expect(st[4].part.notes.every((n) => n.midi >= 60)).toBe(true);
    expect(st[5].part.notes.every((n) => n.midi < 60)).toBe(true);
    // Every organ and pedal note is in the reduction.
    const organ = kyrie.parts.filter((p) => p.voiceType === 'other').reduce((a, p) => a + p.notes.length, 0);
    expect(st[4].part.notes.length + st[5].part.notes.length).toBe(organ);
    expect(defaultShow(kyrie, 'P2')).toBe('all');
    expect(hasOtherStaves(kyrie, 'P2')).toEqual({ voices: true, accompaniment: true });
  });

  it('keeps the accompaniment to one staff when it fits one clef, two at most', () => {
    expect(accompaniment([part('fl', 'other', bars(1, 72, 1), 'Flute')]).map((p) => p.id)).toEqual(['acc']);
    expect(accompaniment([part('vc', 'other', bars(1, 45, 1), 'Cello')]).map((p) => p.id)).toEqual(['acc']);
    const many = ['Violin 1', 'Violin 2', 'Viola', 'Cello'].map((n, i) => part(`p${i}`, 'other', bars(1, 76 - 10 * i, 1), n));
    const acc = accompaniment(many);
    expect(acc.map((p) => p.id)).toEqual(['acc:up', 'acc:lo']);
    expect(acc[0].name).toBe('Accompaniment');
    expect(accompaniment([])).toEqual([]);
  });

  it('shows the accompaniment by default only up to six voices', () => {
    const voices = (n: number) => Array.from({ length: n }, (_, i) => part(`v${i}`, (['S', 'A', 'T', 'B'] as const)[i % 4], bars(1, 60, 1)));
    const pno = part('pno', 'other', [[48, 4], [72, 4]], 'Piano');
    expect(defaultShow(makeScore([...voices(MAX_VOICE_STAVES), pno]), 'v0')).toBe('all');
    expect(defaultShow(makeScore([...voices(MAX_VOICE_STAVES + 2), pno]), 'v0')).toBe('voices');
    expect(planStaves(makeScore([...voices(8), pno]), 'v0', 'all').length).toBe(10); // still possible on request
  });

  it('never puts your own part into the reduction, even if it is an instrument line', () => {
    const s = makeScore([part('s', 'S', bars(1, 72, 1)), part('x', 'other', bars(1, 60, 1)), part('pno', 'other', bars(1, 48, 1))]);
    const st = planStaves(s, 'x', 'all');
    expect(st.map((x) => [x.id, x.own])).toEqual([['s', false], ['x', true], ['acc', false]]);
    expect(voiceParts(s, 'x').map((p) => p.id)).toEqual(['s', 'x']);
  });

  it('abbreviates part names', () => {
    expect(shortName({ name: 'Bass II', voiceType: 'B' })).toBe('B2');
    expect(shortName({ name: 'Sopran', voiceType: 'S' })).toBe('S');
    expect(shortName({ name: 'Alto Solo', voiceType: 'A' })).toBe('A solo');
    expect(shortName({ name: 'Pianoforte', voiceType: 'other' })).toBe('Pno.');
    expect(shortName({ name: 'Harp', voiceType: 'other' })).toBe('Harp');
  });
});

describe('joint layout', () => {
  // Different rhythms per staff: quarters, eighths, halves with a dotted rhythm, a whole-bar rest.
  const s = makeScore([
    part('s', 'S', bars(12, 72, 1)),
    part('a', 'A', bars(12, 65, 0.5)),
    part('t', 'T', Array.from({ length: 12 }, () => [[57, 1.5], [59, 0.5], [60, 2]] as [number, number][]).flat()),
    part('b', 'B', [[null, 4], ...bars(11, 48, 2)]),
  ]);
  const lyricsOn = (st: StaffSpec[]) => new Set(st.map((x) => x.id));

  it('aligns barlines and same-beat notes across staves', () => {
    const staves = planStaves(s, 'a', 'voices');
    const F = layoutFullScore(s, staves, 0, 11, { width: 1280, sp: 8, textW, lyricIds: lyricsOn(staves), left: 60 });
    expect(F.staves.length).toBe(4);
    for (let j = 0; j < F.count; j++) {
      const ref = F.staves[0].systems[j];
      const beatX = new Map<number, number>();
      for (const fs of F.staves) {
        const sys = fs.systems[j];
        expect(sys.measures.map((m) => [m.x0, m.x1])).toEqual(ref.measures.map((m) => [m.x0, m.x1]));
        expect(sys.bp).toBe(ref.bp);
        for (const m of sys.measures) {
          for (const le of m.events) {
            expect(le.x).toBeGreaterThan(m.x0);
            expect(le.x).toBeLessThan(m.x1);
            if (le.ev.measureRest) continue;
            const k = Math.round(le.ev.start * 1000);
            if (beatX.has(k)) expect(le.x).toBeCloseTo(beatX.get(k)!, 6);
            else beatX.set(k, le.x);
          }
        }
      }
      // Onsets move strictly to the right.
      const xs = [...beatX.entries()].sort((p, q) => p[0] - q[0]).map((e) => e[1]);
      for (let q = 1; q < xs.length; q++) expect(xs[q]).toBeGreaterThan(xs[q - 1]);
    }
    // The bass's first bar is a centred whole-bar rest.
    const m0 = F.staves[3].systems[0].measures[0];
    expect(m0.events[0].ev.measureRest).toBe(true);
    expect(m0.events[0].x).toBeCloseTo((m0.x0 + m0.x1) / 2, -1);
  });

  it('gives the densest staff its room (a bar is at least as wide as each staff alone)', () => {
    const staves = planStaves(s, 's', 'voices');
    const F = layoutFullScore(s, staves, 0, 11, { width: 100000, sp: 8, textW, lyricIds: new Set(), left: 0, maxBars: 1 });
    const joint = F.staves[0].systems[1].measures[0];
    for (const st of staves) {
      const alone = layoutStaff(s, st.part, 0, 11, { width: 100000, sp: 8, textW, maxBars: 1, left: 0 }).systems[1].measures[0];
      expect(joint.x1 - joint.x0).toBeGreaterThanOrEqual(alone.x1 - alone.x0 - 1e-6);
    }
  });

  it('breaks into systems with more bars on a wider screen, every bar once in order', () => {
    const staves = planStaves(s, 'a', 'voices');
    const count = (width: number) => {
      const F = layoutFullScore(s, staves, 0, 11, { width, sp: 7, textW, lyricIds: new Set(), left: 50, maxBars: 12 });
      const idx = F.staves[0].systems.flatMap((sy) => sy.measures.map((m) => m.sm.index));
      expect(idx).toEqual(Array.from({ length: 12 }, (_, i) => i));
      for (const sy of F.staves[0].systems) expect(sy.x1).toBeLessThanOrEqual(width - 8 + 1e-6);
      return F.count;
    };
    const narrow = count(700);
    const wide = count(1440);
    expect(wide).toBeLessThan(narrow);
    expect(12 / wide).toBeGreaterThanOrEqual(4); // a laptop shows at least four bars per system here
    const capped = layoutFullScore(s, staves, 0, 11, { width: 5000, sp: 7, textW, lyricIds: new Set(), left: 50, maxBars: 5 });
    expect(Math.max(...capped.staves[0].systems.map((sy) => sy.measures.length))).toBe(5);
  });

  it('lyrics under every voice push columns apart where a syllable needs it', () => {
    const lyr = (p: Part, w: string) => ({ ...p, notes: p.notes.map((n) => ({ ...n, lyric: w, syllabic: 'single' as const })) });
    const sc = makeScore([lyr(part('s', 'S', bars(2, 72, 0.5)), 'Hallelujah'), part('a', 'A', bars(2, 65, 0.5))]);
    const staves = planStaves(sc, 'a', 'voices');
    const xs = (ids: Set<string>) => layoutFullScore(sc, staves, 0, 1, { width: 100000, sp: 8, textW, lyricIds: ids, left: 0 })
      .staves[1].systems[0].measures[0].events.map((e) => e.x);
    const plain = xs(new Set());
    const words = xs(new Set(['s']));
    expect(words[1] - words[0]).toBeGreaterThan(plain[1] - plain[0]);
    expect(words[1] - words[0]).toBeGreaterThanOrEqual(textW('Hallelujah') + 0.6 * 8 - 1e-6);
  });
});
