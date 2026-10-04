import { describe, expect, it } from 'vitest';
import { intervalLongName, intervalName, keyName, noteLabel, type NotationMode } from './notation';
import type { KeySig } from '../music/types';

const key = (fifths: number, mode: 'major' | 'minor' = 'major'): KeySig => ({ beat: 0, time: 0, fifths, mode });
const t = (midi: number, mode: NotationMode, k: KeySig) => noteLabel(midi, mode, k).text;

function table(k: KeySig, midis: number[], mode: NotationMode) {
  return midis.map((m) => t(m, mode, k));
}

describe('noteLabel – D major', () => {
  const D = key(2);
  const scale = [62, 64, 66, 67, 69, 71, 73, 74];
  it('letters', () => expect(table(D, scale, 'letter')).toEqual(['D', 'E', 'F♯', 'G', 'A', 'B', 'C♯', 'D']));
  it('fixed do', () => expect(table(D, scale, 'fixed')).toEqual(['Re', 'Mi', 'Fa♯', 'Sol', 'La', 'Si', 'Do♯', 'Re']));
  it('movable do', () => expect(table(D, scale, 'movable')).toEqual(['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti', 'Do']));
  it('jianpu', () => expect(table(D, scale, 'jianpu')).toEqual(['1', '2', '3', '4', '5', '6', '7', '1']));
  it('pc', () => expect(table(D, [60, 61, 62, 70, 71], 'pc')).toEqual(['0', '1', '2', 't', 'e']));
  it('chromatic notes use sharps / natural letters', () => {
    expect(table(D, [60, 63, 65, 68, 70], 'letter')).toEqual(['C', 'D♯', 'F', 'G♯', 'A♯']);
    expect(table(D, [63, 68, 70], 'movable')).toEqual(['Di', 'Fi', 'Si']);
    expect(t(68, 'jianpu', D)).toBe('♯4');
  });
  it('jianpu octave dots relative to the do in [55,66]', () => {
    expect(noteLabel(62, 'jianpu', D)).toEqual({ text: '1', dotsAbove: 0, dotsBelow: 0 });
    expect(noteLabel(74, 'jianpu', D)).toEqual({ text: '1', dotsAbove: 1, dotsBelow: 0 });
    expect(noteLabel(73, 'jianpu', D)).toEqual({ text: '7', dotsAbove: 0, dotsBelow: 0 });
    expect(noteLabel(57, 'jianpu', D)).toEqual({ text: '5', dotsAbove: 0, dotsBelow: 1 });
    expect(noteLabel(38, 'jianpu', D)).toEqual({ text: '1', dotsAbove: 0, dotsBelow: 2 });
  });
});

describe('noteLabel – B♭ major', () => {
  const Bb = key(-2);
  const scale = [70, 72, 74, 75, 77, 79, 81];
  it('letters', () => expect(table(Bb, scale, 'letter')).toEqual(['B♭', 'C', 'D', 'E♭', 'F', 'G', 'A']));
  it('fixed', () => expect(table(Bb, scale, 'fixed')).toEqual(['Si♭', 'Do', 'Re', 'Mi♭', 'Fa', 'Sol', 'La']));
  it('movable', () => expect(table(Bb, scale, 'movable')).toEqual(['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti']));
  it('jianpu', () => expect(table(Bb, scale, 'jianpu')).toEqual(['1', '2', '3', '4', '5', '6', '7']));
  it('chromatic notes use flats', () => {
    expect(table(Bb, [61, 66, 68, 71], 'letter')).toEqual(['D♭', 'G♭', 'A♭', 'B']);
    expect(table(Bb, [73, 78, 80], 'movable')).toEqual(['Me', 'Le', 'Te']);
    expect(t(80, 'jianpu', Bb)).toBe('♭7');
  });
  it('jianpu reference do is B♭3 (58)', () => {
    expect(noteLabel(58, 'jianpu', Bb).dotsAbove + noteLabel(58, 'jianpu', Bb).dotsBelow).toBe(0);
    expect(noteLabel(70, 'jianpu', Bb).dotsAbove).toBe(1);
  });
});

describe('noteLabel – F♯ minor (la-based)', () => {
  const fs = key(3, 'minor');
  const harmonic = [66, 68, 69, 71, 73, 74, 77, 78];
  it('letters incl. E♯ leading tone', () =>
    expect(table(fs, harmonic, 'letter')).toEqual(['F♯', 'G♯', 'A', 'B', 'C♯', 'D', 'E♯', 'F♯']));
  it('fixed', () => expect(table(fs, harmonic, 'fixed')).toEqual(['Fa♯', 'Sol♯', 'La', 'Si', 'Do♯', 'Re', 'Mi♯', 'Fa♯']));
  it('movable: tonic is La, raised 7th is Si', () =>
    expect(table(fs, harmonic, 'movable')).toEqual(['La', 'Ti', 'Do', 'Re', 'Mi', 'Fa', 'Si', 'La']));
  it('jianpu: tonic is 6, raised 7th is ♯5', () =>
    expect(table(fs, harmonic, 'jianpu')).toEqual(['6', '7', '1', '2', '3', '4', '♯5', '6']));
  it('E natural (natural 7th) is Sol / 5', () => {
    expect(t(76, 'letter', fs)).toBe('E');
    expect(t(76, 'movable', fs)).toBe('Sol');
  });
  it('jianpu dots: A3 (57) is the reference 1', () => {
    expect(noteLabel(57, 'jianpu', fs)).toEqual({ text: '1', dotsAbove: 0, dotsBelow: 0 });
    expect(noteLabel(66, 'jianpu', fs)).toEqual({ text: '6', dotsAbove: 0, dotsBelow: 0 });
    expect(noteLabel(54, 'jianpu', fs)).toEqual({ text: '6', dotsAbove: 0, dotsBelow: 1 });
  });
});

describe('noteLabel – C minor', () => {
  const c = key(-3, 'minor');
  const harmonic = [60, 62, 63, 65, 67, 68, 71, 72];
  it('letters', () => expect(table(c, harmonic, 'letter')).toEqual(['C', 'D', 'E♭', 'F', 'G', 'A♭', 'B', 'C']));
  it('fixed', () => expect(table(c, harmonic, 'fixed')).toEqual(['Do', 'Re', 'Mi♭', 'Fa', 'Sol', 'La♭', 'Si', 'Do']));
  it('movable', () => expect(table(c, harmonic, 'movable')).toEqual(['La', 'Ti', 'Do', 'Re', 'Mi', 'Fa', 'Si', 'La']));
  it('jianpu', () => expect(table(c, harmonic, 'jianpu')).toEqual(['6', '7', '1', '2', '3', '4', '♯5', '6']));
  it('chromatic: G♭, D♭ (flats)', () => {
    expect(t(66, 'letter', c)).toBe('G♭');
    expect(t(61, 'letter', c)).toBe('D♭');
    expect(t(61, 'movable', c)).toBe('Te');
  });
  it('pc', () => expect(t(63, 'pc', c)).toBe('3'));
});

describe('noteLabel – other keys', () => {
  it('F♯ major spells E♯; G♭ major spells C♭', () => {
    expect(t(65, 'letter', key(6))).toBe('E♯');
    expect(t(71, 'letter', key(-6))).toBe('C♭');
  });
  it('D minor leading tone is C♯', () => expect(t(61, 'letter', key(-1, 'minor'))).toBe('C♯'));
  it('C major chromatics', () => expect(table(key(0), [61, 63, 66, 68, 70], 'letter')).toEqual(['C♯', 'E♭', 'F♯', 'A♭', 'B♭']));
  it('A minor: G♯ is Si', () => {
    expect(t(68, 'letter', key(0, 'minor'))).toBe('G♯');
    expect(t(68, 'movable', key(0, 'minor'))).toBe('Si');
    expect(t(69, 'movable', key(0, 'minor'))).toBe('La');
  });
  it('rounds fractional midi', () => expect(t(61.6, 'letter', key(2))).toBe('D'));
});

describe('intervals', () => {
  it('simple names', () => {
    expect([...Array(13).keys()].map(intervalName)).toEqual(['P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8']);
  });
  it('compound names', () => {
    expect([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].map(intervalName))
      .toEqual(['m9', 'M9', 'm10', 'M10', 'P11', 'A11', 'P12', 'm13', 'M13', 'm14', 'M14', 'P15']);
  });
  it('sign is ignored', () => expect(intervalName(-3)).toBe('m3'));
  it('long names', () => {
    expect(intervalLongName(3)).toBe('minor third');
    expect(intervalLongName(6)).toBe('tritone');
    expect(intervalLongName(7)).toBe('perfect fifth');
    expect(intervalLongName(12)).toBe('octave');
    expect(intervalLongName(14)).toBe('major ninth');
    expect(intervalLongName(-11)).toBe('major seventh');
    expect(intervalLongName(0)).toBe('unison');
  });
});

describe('keyName', () => {
  it('names', () => {
    expect(keyName(key(2))).toBe('D major');
    expect(keyName(key(3, 'minor'))).toBe('F♯ minor');
    expect(keyName(key(-2))).toBe('B♭ major');
    expect(keyName(key(-3, 'minor'))).toBe('C minor');
    expect(keyName(key(0, 'minor'))).toBe('A minor');
    expect(keyName(key(-7))).toBe('C♭ major');
    expect(keyName(key(7, 'minor'))).toBe('A♯ minor');
  });
});
