// QA round 6: singers who OBEY written staccato marks (Ravel Nicolette 237, Debussy Yver 143, Dieu 7).
// The importer ignores <staccato/>, so scoring expects full written duration. Here the singer sings
// staccato notes for a fraction of their written length (other notes legato), good singer otherwise.
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { expect, it } from 'vitest';
import { scoreAttempt } from '../../../src/game/scoring';
import { importScoreFile } from '../../../src/music/import';
import { computeSections } from '../../../src/music/sections';
import { effectiveTolerance, levelSpec } from '../../../src/progress/ladder';
import type { PitchSample } from '../../../src/game/types';
import type { Score, Part } from '../../../src/music/types';

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }

/** partId -> set of "measureIndex:quarterOffset" of staccato note onsets. */
function staccatoMap(xml: string): Map<string, Set<string>> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out = new Map<string, Set<string>>();
  for (const p of Array.from(doc.getElementsByTagName('part'))) {
    const set = new Set<string>();
    let div = 1;
    Array.from(p.getElementsByTagName('measure')).forEach((m, mi) => {
      let pos = 0, last = 0;
      for (const el of Array.from(m.children)) {
        if (el.tagName === 'attributes') { const d = el.getElementsByTagName('divisions')[0]; if (d) div = Number(d.textContent); }
        else if (el.tagName === 'backup') pos -= Number(el.getElementsByTagName('duration')[0].textContent);
        else if (el.tagName === 'forward') pos += Number(el.getElementsByTagName('duration')[0].textContent);
        else if (el.tagName === 'note') {
          const chord = el.getElementsByTagName('chord').length > 0;
          const dur = Number(el.getElementsByTagName('duration')[0]?.textContent ?? 0);
          const at = chord ? last : pos;
          if (el.getElementsByTagName('staccato').length || el.getElementsByTagName('staccatissimo').length) set.add(`${mi}:${(at / div).toFixed(3)}`);
          if (!chord) { last = pos; pos += dur; }
        }
      }
    });
    out.set(p.getAttribute('id')!, set);
  }
  return out;
}

const FILES = ['pd/ravel-nicolette.mxl', 'pd/debussy-yver.mxl', 'pd/debussy-dieu.mxl'];

function sing(score: Score, part: Part, stac: Set<string>, a: number, z: number, from: number, to: number, frac: number, seed: number, rate: number): PitchSample[] {
  const R = rng(seed);
  const ms = (x: number) => (x / 1000) * rate;
  const notes = part.notes.slice(a, z + 1);
  const real = notes.map((n, i) => {
    const prev = i > 0 ? notes[i - 1] : null;
    const legato = !!prev && prev.start + prev.dur >= n.start - 1e-6;
    const m = score.measures[n.measure];
    const isStac = stac.has(`${n.measure}:${(n.startBeat - m.startBeat).toFixed(3)}`);
    const s = n.start + ms((R() < 0.5 ? -1 : 1) * (20 + R() * 30));
    const cons = !legato || n.lyric ? ms(40 + R() * 30) : 0;
    return { n, s, e: 0, cons, legato, isStac, cents: (R() * 2 - 1) * 6 };
  });
  for (let i = 0; i < real.length; i++) {
    const r = real[i], next = real[i + 1];
    r.e = next && next.legato ? next.s : r.n.start + r.n.dur - ms(40);
    if (r.isStac) r.e = Math.min(r.e, r.s + r.cons + Math.max(ms(60), frac * r.n.dur));
  }
  const out: PitchSample[] = [];
  const ph = R() * 6.28;
  for (let t = from - 0.4; t < to + 0.5; t += 0.02) {
    const u = t - ms(30);
    const r = real.find((x) => u >= x.s && u < x.e);
    const midi = r && u >= r.s + r.cons ? r.n.midi + (r.cents + 50 * Math.sin(2 * Math.PI * 5.5 * u / rate + ph)) / 100 : null;
    out.push({ time: t, midi, clarity: midi == null ? 0.3 : 0.95, rms: midi == null ? 0.003 : 0.1 });
  }
  return out;
}

it('R6 singer obeying staccato marks', async () => {
  for (const f of FILES) {
    const buf = readFileSync(process.cwd() + '/public/pieces/' + f);
    const zip = unzipSync(new Uint8Array(buf));
    const xmlName = Object.keys(zip).find((k) => k.endsWith('.xml') && !k.startsWith('META'))!;
    const smap = staccatoMap(strFromU8(zip[xmlName]));
    const score = await importScoreFile(f, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    let matched = 0;
    for (const p of score.parts) { const st = smap.get(p.id) ?? new Set(); matched += p.notes.filter((n) => st.has(`${n.measure}:${(n.startBeat - score.measures[n.measure].startBeat).toFixed(3)}`)).length; }
    console.log(f, 'parts', score.parts.map((p) => p.id).join(','), 'xml parts', [...smap.keys()].join(','), 'staccato marks', [...smap.values()].reduce((s, x) => s + x.size, 0), 'matched to notes', matched);
    for (const frac of [0.5, 0.65]) for (const L of [1, 2, 3]) {
      const spec = levelSpec(L);
      const opts = { toleranceCents: effectiveTolerance(L, 'standard'), tuning: 'equal' as const, octaveTolerant: false };
      let n = 0, pass = 0; const fails: string[] = [];
      for (const sec of computeSections(score)) for (const part of score.parts) {
        const st = smap.get(part.id) ?? new Set<string>();
        const idx = part.notes.map((nn, i) => [nn, i] as const).filter(([nn]) => nn.start >= sec.start - 1e-6 && nn.start < sec.end - 1e-6).map(([, i]) => i);
        if (idx.length < 4) continue;
        const nSt = idx.filter((i) => st.has(`${part.notes[i].measure}:${(part.notes[i].startBeat - score.measures[part.notes[i].measure].startBeat).toFixed(3)}`)).length;
        if (!nSt) continue;
        for (const seed of [1, 2]) {
          const r = scoreAttempt({ score, part, range: [idx[0], idx[idx.length - 1]] }, sing(score, part, st, idx[0], idx[idx.length - 1], sec.start, sec.end, frac, seed * 31 + idx[0], spec.rate), opts);
          expect(Number.isFinite(r.accuracy)).toBe(true);
          n++; if (r.accuracy >= spec.pass) pass++; else fails.push(`${part.name} ${sec.label} (${nSt}/${idx.length} stacc) ${(r.accuracy * 100).toFixed(0)} ${r.insights.map((i) => i.kind).join(',')}`);
        }
      }
      console.log(`## ${f} staccato sung at ${frac * 100}% L${L}: pass ${pass}/${n}`);
      for (const x of fails.slice(0, 4)) console.log('   FAIL', x);
    }
  }
});
