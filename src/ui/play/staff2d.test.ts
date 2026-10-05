import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { makePart, makeScore } from '../../game/testutil';
import { importScoreFile } from '../../music/import';
import type { Score } from '../../music/types';
import type { Part } from '../../music/types';
import {
  beamGroups, breakSystems, buildMeasures, clefFor, eventHas, eventSteps, keyAlts, layoutStaff, measureSpan, midiToStep,
  middleStep, spell, splitDuration, staffSpace, STAFF_GRADE, sungStep, systemAt, textRows, writtenValue, xAtBeat, type StaffEvent,
} from './staff2d';

const C = { fifths: 0, mode: 'major' as const };
const D = { fifths: 2, mode: 'major' as const };
const F = { fifths: -1, mode: 'major' as const };
const textW = (t: string) => t.length * 7;
const durs = (ps: { dur: number }[]) => ps.map((p) => +p.dur.toFixed(3));

describe('clef and spelling', () => {
  it('chooses the clef from the voice and range', () => {
    const p = makePart('x', [[67, 1]]);
    expect(clefFor({ ...p, voiceType: 'S' })).toBe('treble');
    expect(clefFor({ ...p, voiceType: 'A' })).toBe('treble');
    expect(clefFor({ ...makePart('t', [[55, 1]]), voiceType: 'T' })).toBe('treble8');
    expect(clefFor({ ...makePart('b', [[45, 1]]), voiceType: 'B' })).toBe('bass');
    expect(clefFor({ ...makePart('o', [[40, 1], [45, 1]]), voiceType: 'other' })).toBe('bass');
    expect(middleStep('treble')).toBe(34);
    expect(middleStep('treble8')).toBe(27);
    expect(middleStep('bass')).toBe(22);
  });

  it('spells pitches as staff steps in the key', () => {
    expect(spell(60, C)).toEqual({ step: 28, alt: 0 }); // C4
    expect(spell(66, D)).toEqual({ step: 31, alt: 1 }); // F♯4
    expect(spell(61, D)).toEqual({ step: 28, alt: 1 }); // C♯4
    expect(spell(60, D)).toEqual({ step: 28, alt: 0 }); // C♮4
    expect(spell(70, F)).toEqual({ step: 34, alt: -1 }); // B♭4
    expect(spell(77, { fifths: 6, mode: 'major' })).toEqual({ step: 37, alt: 1 }); // E♯5 in F♯ major
  });

  it('builds key-signature alterations per letter', () => {
    expect(keyAlts(2)).toEqual([1, 0, 0, 1, 0, 0, 0]); // F♯ C♯
    expect(keyAlts(-3)).toEqual([0, 0, -1, 0, 0, -1, -1]); // B♭ E♭ A♭
    expect(keyAlts(0)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('pitch → staff height', () => {
  it('interpolates between the letters of the key', () => {
    const c = keyAlts(0);
    expect(midiToStep(60, c)).toBeCloseTo(28);
    expect(midiToStep(62, c)).toBeCloseTo(29);
    expect(midiToStep(65, c)).toBeCloseTo(31); // F
    expect(midiToStep(61, c)).toBeCloseTo(28.5); // halfway C–D
    expect(midiToStep(64.5, c)).toBeCloseTo(30.5); // halfway E–F (a semitone step)
    const d = keyAlts(2);
    expect(midiToStep(66, d)).toBeCloseTo(31); // F♯ sits on the F line
    expect(midiToStep(65, d)).toBeCloseTo(30.5); // F♮ between E and F♯
  });

  it('puts the sung pitch exactly on the note being sung, also for accidentals', () => {
    // C♮ in D major: a perfectly sung C sits on the C, not halfway between B and C♯.
    const target = { midi: 60, ...spell(60, D) };
    expect(sungStep(60, D, target)).toBeCloseTo(28);
    expect(sungStep(66, D, { midi: 66, ...spell(66, D) })).toBeCloseTo(31);
  });

  it('shows 30 cents flat visibly below the note, and is exact further away', () => {
    const target = { midi: 64, ...spell(64, C) }; // E4, step 30
    const flat = sungStep(63.7, C, target);
    expect(flat).toBeLessThan(30 - 0.3); // ≥ 0.3 steps (a few px) below
    expect(flat).toBeGreaterThan(29);
    expect(sungStep(64.3, C, target)).toBeGreaterThan(30.3);
    // Two semitones off: the plain staff position.
    expect(sungStep(62, C, target)).toBeCloseTo(midiToStep(62, keyAlts(0)), 2);
    expect(sungStep(66, C, target)).toBeCloseTo(midiToStep(66, keyAlts(0)), 2);
  });

  it('is monotonic in pitch and folds octaves towards the target', () => {
    for (const key of [C, D, F, { fifths: 5, mode: 'major' as const }]) {
      for (const tm of [57, 60, 61, 64, 65, 66, 70]) {
        const target = { midi: tm, ...spell(tm, key) };
        let prev = -Infinity;
        for (let m = tm - 6; m <= tm + 6; m += 0.05) {
          const st = sungStep(m, key, target);
          expect(st).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = st;
        }
      }
    }
    const target = { midi: 60, ...spell(60, C) };
    expect(sungStep(48, C, target)).toBeCloseTo(28); // an octave down: drawn on the note
  });

  it('stays monotonic next to wide gaps (augmented seconds and wider)', () => {
    // G𝄪 (= A) in C♭ major: the F♭ below is 5 semitones away; B♯ in G♭ major: D♭ is 3 above.
    const cases = [
      { key: { fifths: -7 }, target: { midi: 69, step: 32, alt: 2 } },
      { key: { fifths: -6 }, target: { midi: 60, step: 27, alt: 1 } },
      { key: { fifths: 7 }, target: { midi: 64, step: 29, alt: -2 } },
    ];
    for (const { key, target } of cases) {
      let prev = -Infinity;
      for (let m = target.midi - 6.5; m <= target.midi + 6.5; m += 0.01) {
        const st = sungStep(m, key, target);
        expect(st).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = st;
      }
      expect(sungStep(target.midi, key, target)).toBeCloseTo(target.step);
    }
  });

  it('magnifies 30–50 cents to a clearly visible offset, about the same either side', () => {
    const target = { midi: 64, ...spell(64, C) }; // E4: D a whole tone below, F a semitone above
    for (const c of [30, 50]) {
      const below = target.step - sungStep(64 - c / 100, C, target);
      const above = sungStep(64 + c / 100, C, target) - target.step;
      expect(below).toBeGreaterThan(0.45);
      expect(above).toBeGreaterThan(0.45);
      expect(Math.abs(above - below)).toBeLessThan(0.15);
    }
    // A semitone below E still sits between D and E, never past D.
    expect(sungStep(63, C, target)).toBeGreaterThan(29);
  });
});

describe('rhythm', () => {
  it('knows written values, dots and triplets', () => {
    expect(writtenValue(1)).toEqual({ base: 1, dots: 0 });
    expect(writtenValue(1.5)).toEqual({ base: 1, dots: 1 });
    expect(writtenValue(0.75)).toEqual({ base: 0.5, dots: 1 });
    expect(writtenValue(3.5)).toEqual({ base: 2, dots: 2 });
    expect(writtenValue(1 / 3)).toEqual({ base: 0.5, dots: 0, tuplet: 3 });
    expect(writtenValue(2 / 3)).toEqual({ base: 1, dots: 0, tuplet: 3 });
    expect(writtenValue(2.5)).toBeNull();
  });

  it('splits notes that need ties, keeping simple syncopations', () => {
    expect(durs(splitDuration(0, 2.5, 0, 1, false))).toEqual([2, 0.5]);
    expect(durs(splitDuration(0.75, 1.25, 0, 1, false))).toEqual([0.25, 1]);
    expect(durs(splitDuration(0.5, 1, 0, 1, false))).toEqual([1]); // 8th–quarter–8th syncopation
    expect(durs(splitDuration(0, 1 + 2 / 3, 0, 1, false))).toEqual([1, 0.667]);
  });

  it('splits rests to show the beat', () => {
    expect(durs(splitDuration(1, 2, 0, 1, true))).toEqual([1, 1]);
    expect(durs(splitDuration(1, 3, 0, 1, true))).toEqual([1, 2]);
    expect(durs(splitDuration(0.5, 1.5, 0, 1, true))).toEqual([0.5, 1]);
    expect(durs(splitDuration(0, 2, 0, 1, true))).toEqual([2]);
    // No dotted half rest for three beats in 4/4: half + quarter (or quarter + half from beat 2).
    expect(durs(splitDuration(0, 3, 0, 1, true))).toEqual([2, 1]);
    expect(durs(splitDuration(1, 3, 0, 1, true))).toEqual([1, 2]);
    // 2/2: half rests on the beats, quarters inside them.
    expect(durs(splitDuration(0, 3, 0, 2, true))).toEqual([2, 1]);
    expect(durs(splitDuration(1, 3, 0, 2, true))).toEqual([1, 2]);
    // 6/8: dotted quarter rests for whole beats, eighths within a beat.
    expect(durs(splitDuration(0, 1.5, 0, 1.5, true))).toEqual([1.5]);
    expect(durs(splitDuration(0.5, 2.5, 0, 1.5, true))).toEqual([0.5, 0.5, 1.5]);
  });

  it('beams eighths within a beat; rests break beams; stems follow the farthest note', () => {
    const ev = (start: number, dur: number, step?: number): StaffEvent =>
      step == null ? { kind: 'rest', start, dur, base: dur, dots: 0 } : { kind: 'note', start, dur, base: dur, dots: 0, step };
    const evs = [ev(0, 0.5, 30), ev(0.5, 0.5, 31), ev(1, 0.5, 38), ev(1.5, 0.5, 36), ev(2, 0.5), ev(2.5, 0.5, 30), ev(3, 1, 30)];
    const g = beamGroups(evs, 0, 1, 34);
    expect(g).toEqual([[0, 1], [2, 3]]);
    expect(evs[0].stemUp).toBe(true);
    expect(evs[2].stemUp).toBe(false);
    expect(evs[5].beam).toBeUndefined();
  });
});

describe('bars', () => {
  it('fills rests, ties across the barline, and keeps the lyric on the first piece', () => {
    const part = makePart('s', [[null, 1], [67, 5], [65, 2]]);
    part.notes[0].lyric = 'Ah';
    const score = makeScore([part]);
    const ms = buildMeasures(score, part, 0, 1, 'treble');
    expect(ms[0].events.map((e) => e.kind)).toEqual(['rest', 'note']);
    expect(durs(ms[0].events)).toEqual([1, 3]);
    expect(ms[0].events[1]).toMatchObject({ tieStart: true, tieEnd: false, lyric: 'Ah', base: 2, dots: 1 });
    expect(ms[1].events[0]).toMatchObject({ kind: 'note', tieEnd: true, tieStart: false, dur: 2 });
    expect(ms[1].events[0].lyric).toBeUndefined();
    expect(ms[1].events.map((e) => e.kind)).toEqual(['note', 'note']);
    for (const m of ms) expect(m.events.reduce((a, e) => a + e.dur, 0)).toBeCloseTo(4);
  });

  it('prints accidentals against the key and carries them through the bar', () => {
    // C major: F♯ F♯ F♮ | F♯ ; and a tie into bar 2 needs no accidental.
    const part = makePart('s', [[66, 1], [66, 1], [65, 1], [66, 2], [66, 1], [65, 2]]);
    const score = makeScore([part]);
    const ms = buildMeasures(score, part, 0, 1, 'treble');
    const acc = (m: number) => ms[m].events.filter((e) => e.kind === 'note').map((e) => e.accidental);
    expect(acc(0)).toEqual([1, null, 0, 1]);
    // bar 2: tied F♯ (no sign), F♯ (sign again: the tie doesn't carry it), F♮ (natural)
    expect(acc(1)).toEqual([null, 1, 0]);
  });

  it('makes room for note names under the notes (their own row, wide enough between notes)', () => {
    // Sixteenths: the names ("Sol♯"-wide) push the notes apart.
    const part = makePart('s', Array.from({ length: 16 }, (_, i) => [60 + (i % 5), 0.25] as [number, number]));
    const score = makeScore([part]);
    const xs = (o: { nameW?: (m: number) => number }) =>
      layoutStaff(score, part, 0, 0, { width: 4000, sp: 9, textW, ...o }).systems[0].measures[0].events.map((e) => e.x);
    const plain = xs({});
    const named = xs({ nameW: () => 50 });
    for (let i = 1; i < named.length; i++) {
      expect(named[i] - named[i - 1]).toBeGreaterThanOrEqual(50);
      expect(plain[i] - plain[i - 1]).toBeLessThan(50);
    }
    // Rows: the names sit between the notes and the words; without names the words move up.
    const on = textRows(1, 12, { min: 3.2, pad: 2.6, names: true, notation: 'letter' });
    const off = textRows(1, 12, { min: 3.2, pad: 2.6, names: false, notation: 'letter' });
    expect(on.nameOff).toBeGreaterThanOrEqual(off.lyricOff - 0.2);
    expect(on.lyricOff - on.nameOff!).toBeGreaterThanOrEqual(1.75);
    expect(off.nameOff).toBeUndefined();
  });

  it('cancels the old key with naturals when a key change opens a system', () => {
    const part = makePart('s', [[60, 4], [62, 4], [64, 4], [65, 4]]);
    const score: Score = { ...makeScore([part]), keys: [{ beat: 0, time: 0, fifths: 3, mode: 'major' }, { beat: 8, time: 8, fifths: -2, mode: 'major' }] };
    const L = layoutStaff(score, part, 0, 3, { width: 390, sp: 9, textW, maxBars: 2 });
    const sys = L.systems.find((sy) => sy.startBeat === 8)!;
    expect(sys.cancelFifths).toBe(3);
    expect(sys.timeX - sys.keyX).toBeGreaterThan(5 * 0.85 * 9); // 3 naturals + 2 flats
    expect(L.systems[0].cancelFifths).toBe(0);
  });

  it('marks key changes and time-signature changes', () => {
    const part = makePart('s', [[60, 4], [62, 4], [64, 4]]);
    const score: Score = { ...makeScore([part]), keys: [{ beat: 0, time: 0, fifths: 0, mode: 'major' }, { beat: 4, time: 4, fifths: -2, mode: 'major' }] };
    score.measures[2] = { ...score.measures[2], timeSig: [3, 4] };
    const ms = buildMeasures(score, part, 0, 2, 'treble');
    expect(ms.map((m) => m.keyChange)).toEqual([false, true, false]);
    expect(ms[1].prevFifths).toBe(0);
    expect(ms.map((m) => m.timeChange)).toEqual([true, false, true]);
  });
});

describe('chords and overlapping notes (instrument parts)', () => {
  const note = (midi: number, startBeat: number, durBeats: number) =>
    ({ midi, start: startBeat, dur: durBeats, startBeat, durBeats, measure: Math.floor(startBeat / 4) });
  const partOf = (notes: ReturnType<typeof note>[]): Part => ({ id: 'o', name: 'Organ', voiceType: 'other', notes, low: 40, high: 80 });

  it('draws notes starting together as one chord on one stem', () => {
    const part = partOf([note(60, 0, 2), note(64, 0, 2), note(67, 0, 2), note(62, 2, 2)]);
    const ms = buildMeasures(makeScore([part]), part, 0, 0, 'treble');
    const notes = ms[0].events.filter((e) => e.kind === 'note');
    expect(notes).toHaveLength(2);
    expect(eventSteps(notes[0]).sort()).toEqual([28, 30, 32]);
    expect(notes[0].noteIndex).toBe(2); // the top note leads
    expect(eventHas(notes[0], 0) && eventHas(notes[0], 1)).toBe(true);
    expect(notes.some((e) => e.tieStart || e.chord?.some((c) => c.tieStart))).toBe(false);
  });

  it('never ties a note cut short by an overlap unless it really goes on (then it is tied into the next chord)', () => {
    // A held whole note under two halves: tied into the second chord, and every tie has a target.
    const held = partOf([note(48, 0, 4), note(60, 0, 2), note(62, 2, 2)]);
    const ms = buildMeasures(makeScore([held]), held, 0, 0, 'bass');
    const evs = ms[0].events.filter((e) => e.kind === 'note');
    expect(evs).toHaveLength(2);
    const ties = evs.flatMap((e, k) => [e, ...(e.chord ?? [])].filter((h) => h.tieStart).map((h) => ({ k, i: h.noteIndex })));
    for (const t of ties) expect(eventHas(evs[t.k + 1], t.i!)).toBe(true);
    // A slight legato overlap (MIDI) is trimmed, without any tie.
    const legato = partOf([note(60, 0, 1.05), note(62, 1, 1), note(64, 2, 2.1), note(65, 4, 4)]);
    const ms2 = buildMeasures(makeScore([legato]), legato, 0, 1, 'treble');
    const all = ms2.flatMap((m) => m.events).filter((e) => e.kind === 'note');
    expect(all.map((e) => e.midi)).toEqual([60, 62, 64, 65]);
    expect(all.some((e) => e.tieStart || e.tieEnd || e.chord)).toBe(false);
    for (const m of ms2) expect(m.events.reduce((a, e) => a + e.dur, 0)).toBeCloseTo(4);
  });
});

describe('staff size', () => {
  it('uses the height of a portrait phone for a bigger staff', () => {
    const portrait = staffSpace(390, 610, 12).sp;
    expect(portrait).toBeGreaterThan(11);
    expect(staffSpace(560, 260, 12).sp).toBeLessThanOrEqual(12);
  });

  it('colours "ok" notes visibly on the dark staff, distinct from good and missed', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const g of ['good', 'ok', 'miss'] as const) expect(contrast(STAFF_GRADE[g], '#0F1226')).toBeGreaterThanOrEqual(4.5);
    expect(new Set([STAFF_GRADE.good, STAFF_GRADE.ok, STAFF_GRADE.miss]).size).toBe(3);
  });
});

describe('systems and time → x', () => {
  it('breaks greedily with a bar limit', () => {
    expect(breakSystems([100, 100, 100, 100], [60, 60, 60, 60], 230, 4)).toEqual([[0, 1, 2], [3]]);
    expect(breakSystems([100, 100, 100, 100], [60, 60, 60, 60], 1000, 2)).toEqual([[0, 1], [2, 3]]);
    expect(breakSystems([300, 300], [250, 250], 200, 4)).toEqual([[0], [1]]); // an over-wide bar still gets a system
  });

  const part = makePart('s', [[60, 1], [62, 1], [64, 0.5], [65, 0.5], [67, 1], [69, 2], [67, 2], [65, 4], [64, 1], [62, 1], [60, 2], [60, 4]]);
  part.notes.forEach((n, i) => { n.lyric = ['Ky', 'ri', 'e', 'e', 'lei', 'son', 'Chri', 'ste', 'e', 'lei', 'son', 'Amen'][i]; });
  const score = makeScore([part]);

  it('lays out every bar once, within the width, onsets increasing', () => {
    for (const width of [390, 560, 844]) {
      const L = layoutStaff(score, part, 0, score.measures.length - 1, { width, sp: 9, textW });
      expect(L.systems.flatMap((s) => s.measures.map((m) => m.sm.index))).toEqual(score.measures.map((m) => m.index));
      for (const s of L.systems) {
        expect(s.x1).toBeLessThanOrEqual(width + 0.5);
        expect(s.measures.length).toBeLessThanOrEqual(width < 520 ? 4 : 4);
        for (let i = 1; i < s.bp.length; i++) {
          expect(s.bp[i].beat).toBeGreaterThan(s.bp[i - 1].beat);
          expect(s.bp[i].x).toBeGreaterThan(s.bp[i - 1].x);
        }
      }
      // Lyrics never overlap: neighbouring syllables are at least half their widths apart.
      for (const s of L.systems) {
        const les = s.measures.flatMap((m) => m.events).filter((le) => le.ev.lyric);
        for (let i = 1; i < les.length; i++) {
          expect(les[i].x - les[i - 1].x).toBeGreaterThanOrEqual((textW(les[i].ev.lyric!) + textW(les[i - 1].ev.lyric!)) / 2);
        }
      }
    }
  });

  it('maps time to x through the notes (onsets exactly at the noteheads)', () => {
    const L = layoutStaff(score, part, 0, score.measures.length - 1, { width: 390, sp: 9, textW });
    const s0 = L.systems[0];
    for (const m of s0.measures) for (const le of m.events) expect(xAtBeat(s0, le.ev.start)).toBeCloseTo(le.x);
    const a = s0.measures[0].events[0];
    const b = s0.measures[0].events[1];
    expect(xAtBeat(s0, 0.5)).toBeCloseTo((a.x + b.x) / 2);
    expect(xAtBeat(s0, -1)).toBeCloseTo(a.x);
    expect(xAtBeat(s0, 1e3)).toBeCloseTo(s0.x1);
    expect(systemAt(L.systems, 0)).toBe(0);
    expect(systemAt(L.systems, L.systems[1].startBeat + 0.1)).toBe(1);
  });

  it('finds the bars of a section', () => {
    expect(measureSpan(score, 0, 8)).toEqual([0, 1]);
    expect(measureSpan(score, 4, 12)).toEqual([1, 2]);
    expect(measureSpan(score, 4.5, 9)).toEqual([1, 2]);
  });
});

describe('built-in and choir-library pieces', () => {
  const dir = resolve(__dirname, '../../../public/pieces');
  const lib = resolve(__dirname, '../../../library/scores');
  const files = [resolve(dir, 'warmup-chorale.musicxml'), ...readdirSync(lib).map((f) => resolve(lib, f))];
  it('lay out every vocal part on a phone without gaps or overflows', async () => {
    for (const f of files) {
      const buf = readFileSync(f);
      const score = await importScoreFile(f, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      for (const part of score.parts.filter((p) => p.voiceType !== 'other')) {
        const ms = buildMeasures(score, part, 0, score.measures.length - 1);
        for (const m of ms) {
          // Written pieces fill each bar exactly (rests included).
          expect(m.events.reduce((a, e) => a + e.dur, 0), `${f} ${part.name} bar ${m.number}`).toBeCloseTo(m.endBeat - m.startBeat, 1);
          for (const e of m.events) expect(writtenValue(e.dur), `${f} ${part.name} bar ${m.number} dur ${e.dur}`).not.toBeNull();
        }
        // Every note of the part starts exactly once.
        const firsts = ms.flatMap((m) => m.events).reduce((a, e) => a + (e.first ? 1 : 0) + (e.chord?.filter((c) => c.first).length ?? 0), 0);
        expect(firsts).toBe(part.notes.length);
        const L = layoutStaff(score, part, 0, score.measures.length - 1, { width: 390, sp: 8.9, textW });
        for (const s of L.systems) expect(s.measures.length === 1 || s.x1 <= 390).toBe(true);
      }
    }
  }, 60_000);
});
