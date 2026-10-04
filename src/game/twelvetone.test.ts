import { describe, expect, it } from 'vitest';
import { isValidRow, rowForms, rowOfTheDay, rowToScore, transposeRow } from './twelvetone';

const day = new Date(2026, 9, 4, 12);

describe('rowOfTheDay', () => {
  it('is a valid 12-tone row', () => {
    const r = rowOfTheDay(day);
    expect(r).toHaveLength(12);
    expect(new Set(r).size).toBe(12);
    expect(isValidRow(r)).toBe(true);
  });
  it('is deterministic per calendar day and changes between days', () => {
    expect(rowOfTheDay(new Date(2026, 9, 4, 0, 5))).toEqual(rowOfTheDay(new Date(2026, 9, 4, 23, 55)));
    const rows = new Set(Array.from({ length: 30 }, (_, i) => rowOfTheDay(new Date(2026, 0, 1 + i)).join(',')));
    expect(rows.size).toBe(30);
  });
});

describe('rowForms', () => {
  const row = [0, 11, 7, 8, 3, 1, 2, 10, 6, 5, 4, 9];
  const f = rowForms(row);
  it('P0, R0, I0, RI0', () => {
    expect(f.P0).toEqual(row);
    expect(f.R0).toEqual([...row].reverse());
    expect(f.I0).toEqual([0, 1, 5, 4, 9, 11, 10, 2, 6, 7, 8, 3]);
    expect(f.RI0).toEqual([...f.I0].reverse());
  });
  it('48 valid forms', () => {
    expect(Object.keys(f)).toHaveLength(48);
    for (const r of Object.values(f)) expect(isValidRow(r)).toBe(true);
  });
  it('transposeRow', () => {
    expect(transposeRow(row, 5)).toEqual(row.map((p) => (p + 5) % 12));
    expect(f.P5).toEqual(transposeRow(row, 5));
    expect(transposeRow(row, -1)[0]).toBe(11);
  });
});

describe('rowToScore', () => {
  const row = rowOfTheDay(day);
  for (const [low, high] of [[55, 79], [43, 64], [60, 72], [48, 67]] as const) {
    it(`realizes the row within [${low}, ${high}]`, () => {
      const s = rowToScore(row, { low, high, date: day, seed: 3 });
      expect(s.id).toBe('row-20261004');
      expect(s.source).toBe('builtin');
      expect(s.parts).toHaveLength(1);
      const p = s.parts[0];
      expect(p.name).toBe('Row');
      expect(p.notes).toHaveLength(24);
      const first = p.notes.slice(0, 12);
      expect(first.map((n) => n.midi % 12)).toEqual(row);
      expect(new Set(p.notes.slice(12).map((n) => n.midi % 12)).size).toBe(12);
      for (const n of p.notes) {
        expect(n.midi).toBeGreaterThanOrEqual(low);
        expect(n.midi).toBeLessThanOrEqual(high);
        expect(n.lyric).toMatch(/^[0-9te]$/);
      }
      for (let i = 1; i < 12; i++) expect(Math.abs(first[i].midi - first[i - 1].midi)).toBeLessThanOrEqual(12);
      for (let i = 13; i < 24; i++) expect(Math.abs(p.notes[i].midi - p.notes[i - 1].midi)).toBeLessThanOrEqual(12);
      // leaps vary
      const leaps = new Set(first.slice(1).map((n, i) => Math.abs(n.midi - first[i].midi)));
      expect(leaps.size).toBeGreaterThanOrEqual(4);
      // rhythm: mixed durations, contiguous phrase, then ≥ one bar of rest
      expect(new Set(p.notes.map((n) => n.durBeats)).size).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < 12; i++) expect(p.notes[i].startBeat).toBeCloseTo(p.notes[i - 1].startBeat + p.notes[i - 1].durBeats);
      const gap = p.notes[12].startBeat - (p.notes[11].startBeat + p.notes[11].durBeats);
      expect(gap).toBeGreaterThanOrEqual(4);
      // measures / timing
      expect(s.measures.every((m) => m.timeSig[0] === 4 && m.timeSig[1] === 4)).toBe(true);
      const last = p.notes[23];
      expect(last.start + last.dur).toBeLessThanOrEqual(s.duration + 1e-9);
      expect(s.measures[s.measures.length - 1].start + s.measures[s.measures.length - 1].dur).toBeCloseTo(s.duration);
      for (const n of p.notes) expect(n.measure).toBe(Math.floor(n.startBeat / 4));
      expect(n0Time(s)).toBe(0);
      expect(s.keys[0].fifths).toBe(0);
      expect(s.tempos[0].bpm).toBe(72);
      expect(p.low).toBe(Math.min(...p.notes.map((n) => n.midi)));
    });
  }
  it('narrow ranges are widened to an octave', () => {
    const s = rowToScore(row, { low: 60, high: 65, date: day });
    const ms = s.parts[0].notes.map((n) => n.midi);
    expect(Math.max(...ms) - Math.min(...ms)).toBeLessThanOrEqual(12);
  });
  it('is deterministic for a seed', () => {
    expect(rowToScore(row, { low: 55, high: 79, seed: 9, date: day })).toEqual(rowToScore(row, { low: 55, high: 79, seed: 9, date: day }));
  });
  it('second form option', () => {
    const s = rowToScore(row, { low: 55, high: 79, date: day, secondForm: 'RI0' });
    expect(s.parts[0].notes.slice(12).map((n) => n.midi % 12)).toEqual(rowForms(row).RI0);
  });
});

function n0Time(s: { parts: { notes: { start: number }[] }[] }) {
  return s.parts[0].notes[0].start;
}
