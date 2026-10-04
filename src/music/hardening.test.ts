// Synthetic "tricky exporter" cases for the importer (MuseScore / Sibelius / Dorico / Finale quirks).
// Every case must import without crashing and satisfy the invariants in ./invariants.ts.
import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { strToU8, zipSync } from 'fflate';
import { parseMusicXML } from './musicxml';
import { parseMidi } from './midi';
import { importScoreFile } from './import';
import { computeSections } from './sections';
import { invariantViolations, USER_FACING_ERROR } from './invariants';
import type { Score } from './types';

// ---------------------------------------------------------------------------
// builders

const STEPS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
function pitch(midi: number): string {
  const pc = midi % 12;
  return `<pitch><step>${STEPS[pc]}</step>${ALTERS[pc] ? '<alter>1</alter>' : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
}
interface N {
  midi?: number; // undefined = rest
  dur: number; // divisions
  voice?: number;
  staff?: number;
  chord?: boolean;
  lyric?: string;
  extra?: string; // raw xml inside <note> (after duration)
  pre?: string; // raw xml at the start of <note>
}
function n(o: N): string {
  return (
    '<note>' +
    (o.pre ?? '') +
    (o.chord ? '<chord/>' : '') +
    (o.midi === undefined ? '<rest/>' : pitch(o.midi)) +
    `<duration>${o.dur}</duration>` +
    `<voice>${o.voice ?? 1}</voice>` +
    (o.staff ? `<staff>${o.staff}</staff>` : '') +
    (o.extra ?? '') +
    (o.lyric ? `<lyric number="1"><syllabic>single</syllabic><text>${o.lyric}</text></lyric>` : '') +
    '</note>'
  );
}
const backup = (d: number) => `<backup><duration>${d}</duration></backup>`;
const forward = (d: number) => `<forward><duration>${d}</duration></forward>`;
const attrs = (div = 4, extra = '') => `<attributes><divisions>${div}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${extra}</attributes>`;

function partwise(parts: { name: string; measures: string[]; numbers?: string[] }[], head = ''): string {
  const pl = parts.map((p, i) => `<score-part id="P${i + 1}"><part-name>${p.name}</part-name></score-part>`).join('');
  const body = parts
    .map((p, i) => `<part id="P${i + 1}">${p.measures.map((m, k) => `<measure number="${p.numbers?.[k] ?? k + 1}">${m}</measure>`).join('')}</part>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${head}<part-list>${pl}</part-list>${body}</score-partwise>`;
}

function check(s: Score): Score {
  const v = invariantViolations(s, computeSections(s));
  expect(v.slice(0, 10)).toEqual([]);
  return s;
}
const sung = (s: Score) => s.parts.filter((p) => p.voiceType !== 'other');

// ---------------------------------------------------------------------------

describe('importer hardening: exporter quirks', () => {
  it('Sibelius-style: one part, 2 staves, voices 1–4 on staff 1 and 5–8 on staff 2 (SATB on a grand staff)', () => {
    const m = (first: boolean) =>
      (first ? attrs(4, '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>') : '') +
      n({ midi: 72, dur: 16, voice: 1, staff: 1, lyric: 'Ah' }) +
      backup(16) +
      n({ midi: 67, dur: 8, voice: 2, staff: 1, lyric: 'oh' }) +
      n({ midi: 65, dur: 8, voice: 2, staff: 1 }) +
      backup(16) +
      n({ midi: 60, dur: 16, voice: 5, staff: 2, lyric: 'eh' }) +
      backup(16) +
      n({ midi: 48, dur: 4, voice: 6, staff: 2 }) +
      n({ midi: 50, dur: 4, voice: 6, staff: 2 }) +
      n({ midi: 52, dur: 8, voice: 6, staff: 2 });
    const s = check(parseMusicXML(partwise([{ name: 'Choir', measures: [m(true), m(false), m(false)] }])));
    expect(sung(s).length).toBe(4);
    expect(sung(s).map((p) => p.notes[0].midi)).toEqual([72, 67, 60, 48]);
  });

  it('Dorico-style: <print>, <credit>, <defaults>, layout-heavy header; title from credits', () => {
    const head =
      `<identification><creator type="composer">Anon.</creator><encoding><software>Dorico 5.1</software></encoding></identification>` +
      `<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling><page-layout><page-height>1683</page-height></page-layout></defaults>` +
      `<credit page="1"><credit-type>title</credit-type><credit-words font-size="24">Ave verum — “Kyrie” ñ</credit-words></credit>` +
      `<credit page="1"><credit-type>composer</credit-type><credit-words>W. A. M.</credit-words></credit>`;
    const meas = (i: number) =>
      `<print new-system="${i % 2 ? 'yes' : 'no'}"><system-layout><system-margins><left-margin>0</left-margin></system-margins></system-layout></print>` +
      (i === 0 ? attrs() : '') +
      n({ midi: 67, dur: 16, lyric: 'A' });
    const s = check(parseMusicXML(partwise([{ name: 'Soprano', measures: [0, 1, 2, 3].map(meas) }], head)));
    expect(s.title).toBe('Ave verum — “Kyrie” ñ');
    expect(s.composer).toBe('Anon.');
  });

  it('Finale-style <score-timewise>', () => {
    const xml = `<?xml version="1.0"?><score-timewise version="3.0"><part-list><score-part id="P1"><part-name>Alto</part-name></score-part><score-part id="P2"><part-name>Bass</part-name></score-part></part-list>
      <measure number="1"><part id="P1">${attrs()}${n({ midi: 64, dur: 16, lyric: 'la' })}</part><part id="P2">${attrs()}${n({ midi: 48, dur: 16 })}</part></measure>
      <measure number="2"><part id="P1">${n({ midi: 65, dur: 16 })}</part><part id="P2">${n({ midi: 50, dur: 16 })}</part></measure></score-timewise>`;
    const s = check(parseMusicXML(xml));
    expect(s.parts.map((p) => p.notes.length)).toEqual([2, 2]);
  });

  it('grace notes with chords (and grace without duration) are skipped', () => {
    const g = (midi: number, chord = false) => `<note><grace slash="yes"/>${chord ? '<chord/>' : ''}${pitch(midi)}<voice>1</voice><type>eighth</type></note>`;
    const m = attrs() + g(72) + g(76, true) + n({ midi: 74, dur: 8 }) + g(70) + n({ midi: 72, dur: 8 });
    const s = check(parseMusicXML(partwise([{ name: 'Soprano', measures: [m] }])));
    expect(s.parts[0].notes.map((x) => x.midi)).toEqual([74, 72]);
  });

  it('cross-staff notes (same voice moves to staff 2) stay in one lane', () => {
    const m =
      attrs(4, '<staves>2</staves>') +
      n({ midi: 60, dur: 4, staff: 1, lyric: 'a' }) +
      n({ midi: 55, dur: 4, staff: 2, lyric: 'b' }) +
      n({ midi: 53, dur: 4, staff: 2, lyric: 'c' }) +
      n({ midi: 62, dur: 4, staff: 1, lyric: 'd' });
    const s = check(parseMusicXML(partwise([{ name: 'Alto', measures: [m] }])));
    expect(sung(s).length).toBe(1);
    expect(sung(s)[0].notes.map((x) => x.midi)).toEqual([60, 55, 53, 62]);
  });

  it('<forward> gaps in voice 2 and hidden rests', () => {
    const m =
      attrs() +
      n({ midi: 72, dur: 4 }) + n({ midi: 74, dur: 4 }) + n({ midi: 76, dur: 8 }) +
      backup(16) + forward(8) + n({ midi: 64, dur: 4, voice: 2 }) + n({ midi: undefined, dur: 4, voice: 2, pre: '' }).replace('<note>', '<note print-object="no">');
    const s = check(parseMusicXML(partwise([{ name: 'Soprano/Alto', measures: [m, m] }])));
    expect(sung(s).length).toBe(2);
  });

  it('tuplets with odd divisions (divisions=15, quintuplets/triplets) stay monophonic and contiguous', () => {
    const div = 15;
    const quint = Array.from({ length: 5 }, (_, i) => n({ midi: 60 + i, dur: 3, extra: '<time-modification><actual-notes>5</actual-notes><normal-notes>4</normal-notes></time-modification>' })).join('');
    const trip = Array.from({ length: 3 }, (_, i) => n({ midi: 65 + i, dur: 5 })).join('');
    const m = attrs(div) + quint + trip + n({ midi: 70, dur: 30 });
    // 7-tuplet with rounding (durations that don't add up exactly, as some exporters write)
    const sept = `<attributes><divisions>4</divisions></attributes>` + Array.from({ length: 7 }, (_, i) => n({ midi: 60 + i, dur: 2 })).join('') + n({ midi: 67, dur: 2 });
    const s = check(parseMusicXML(partwise([{ name: 'Tenor', measures: [m, sept] }])));
    expect(s.parts[0].notes.length).toBe(17);
  });

  it('tempo change via <sound tempo> placed in a later part only', () => {
    const tempoDir = (bpm: number) => `<direction placement="above"><direction-type><words>Allegro</words></direction-type><sound tempo="${bpm}"/></direction>`;
    const s = check(
      parseMusicXML(
        partwise([
          { name: 'Soprano', measures: [attrs() + n({ midi: 72, dur: 16 }), n({ midi: 72, dur: 16 })] },
          { name: 'Bass', measures: [attrs() + tempoDir(60) + n({ midi: 48, dur: 16 }), tempoDir(120) + n({ midi: 48, dur: 16 })] },
        ]),
      ),
    );
    expect(s.tempos.map((t) => t.bpm)).toEqual([60, 120]);
    expect(s.duration).toBeCloseTo(4 + 2, 5);
  });

  it('mid-piece and mid-measure key/time changes', () => {
    const m1 = attrs() + n({ midi: 60, dur: 16 });
    const m2 = `<attributes><key><fifths>-3</fifths><mode>minor</mode></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>` + n({ midi: 63, dur: 12 });
    const m3 = n({ midi: 63, dur: 6 }) + `<attributes><key><fifths>2</fifths></key></attributes>` + n({ midi: 62, dur: 6 });
    const m4 = `<attributes><time><beats>3+2</beats><beat-type>8</beat-type></time></attributes>` + n({ midi: 62, dur: 10 });
    const m5 = `<attributes><time symbol="common"><beats>6</beats><beat-type>8</beat-type></time></attributes>` + n({ midi: 62, dur: 12 });
    const s = check(parseMusicXML(partwise([{ name: 'Alto', measures: [m1, m2, m3, m4, m5] }])));
    expect(s.keys.map((k) => k.fifths)).toEqual([0, -3, 2]);
    expect(s.measures.map((m) => m.durBeats)).toEqual([4, 3, 3, 2.5, 3]);
  });

  it('<transpose> with <double/> and an octave-down tenor', () => {
    const m = attrs(4, '<transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>-1</octave-change><double/></transpose>') + n({ midi: 64, dur: 16 });
    const s = check(parseMusicXML(partwise([{ name: 'Baritone', measures: [m] }])));
    expect(s.parts[0].notes[0].midi).toBe(52);
  });

  it('<cue/> notes are skipped but still advance time', () => {
    const cue = `<note><cue/>${pitch(80)}<duration>8</duration><voice>1</voice></note>`;
    const m = attrs() + cue + n({ midi: 67, dur: 8 });
    const s = check(parseMusicXML(partwise([{ name: 'Soprano', measures: [m] }])));
    expect(s.parts[0].notes.map((x) => [x.midi, x.startBeat])).toEqual([[67, 2]]);
  });

  it('<instrument-change> and percussion <unpitched> notes', () => {
    const unp = `<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>4</duration><voice>1</voice></note>`;
    const ic = `<sound><instrument-change instrument-id="P1-I2"><instrument-sound>voice.alto</instrument-sound></instrument-change></sound>`;
    const s = check(parseMusicXML(partwise([
      { name: 'Percussion', measures: [attrs() + unp + unp + unp + unp] },
      { name: 'Alto', measures: [attrs() + ic + n({ midi: 64, dur: 16, lyric: 'x' })] },
    ])));
    expect(s.parts[0].notes.length).toBe(0);
    expect(s.parts[1].notes.length).toBe(1);
  });

  it('multi-measure rests (<multiple-rest>) and measure="yes" rests', () => {
    const mr = (k: number) => (k === 0 ? attrs(4, '<measure-style><multiple-rest>3</multiple-rest></measure-style>') : '') + `<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>`;
    const s = check(parseMusicXML(partwise([{ name: 'Bass', measures: [mr(0), mr(1), mr(2), n({ midi: 48, dur: 16 })] }])));
    expect(s.measures.length).toBe(4);
    expect(s.parts[0].notes[0].startBeat).toBe(12);
  });

  it('whole-measure rests without <duration> do not break the bar grid', () => {
    const s = check(parseMusicXML(partwise([{ name: 'Bass', measures: [attrs() + '<note><rest measure="yes"/><voice>1</voice></note>', n({ midi: 48, dur: 16 })] }])));
    expect(s.parts[0].notes[0].startBeat).toBe(4);
  });

  it('repeats, voltas, segno/coda: linearized without crashing', () => {
    const fwd = '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>';
    const v1 = '<barline location="left"><ending number="1" type="start"/></barline>';
    const v1e = '<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward" times="2"/></barline>';
    const v2 = '<barline location="left"><ending number="2" type="start"/></barline>';
    const ds = '<direction><direction-type><words>D.S. al Coda</words></direction-type><sound dalsegno="1"/></direction>';
    const s = check(parseMusicXML(partwise([{ name: 'Soprano', measures: [attrs() + fwd + n({ midi: 72, dur: 16 }), v1 + n({ midi: 74, dur: 16 }) + v1e, v2 + n({ midi: 76, dur: 16 }) + ds] }])));
    expect(s.parts[0].notes.length).toBe(3);
  });

  it('pickup measures numbered "0" and "X1" (and non-numeric labels)', () => {
    const s = check(
      parseMusicXML(
        partwise([{ name: 'Soprano', numbers: ['X1', '1', '2', '2a', ''], measures: [attrs() + n({ midi: 67, dur: 4 }), n({ midi: 72, dur: 16 }), n({ midi: 72, dur: 16 }), n({ midi: 72, dur: 16 }), n({ midi: 72, dur: 16 })] }]),
      ),
    );
    expect(s.measures[0].durBeats).toBe(1);
    const s0 = check(parseMusicXML(partwise([{ name: 'Soprano', numbers: ['0', '1'], measures: [attrs() + n({ midi: 67, dur: 4 }), n({ midi: 72, dur: 16 })] }])));
    expect(computeSections(s0)[0].label).toMatch(/Upbeat/);
  });

  it('lyrics: <extend/>, <elision>, multiple <text>, unicode, lyrics on rests, empty text', () => {
    const ly = (inner: string) => `<lyric number="1">${inner}</lyric>`;
    const m =
      attrs() +
      n({ midi: 60, dur: 4, extra: ly('<syllabic>begin</syllabic><text>Gló</text>') }) +
      n({ midi: 62, dur: 4, extra: ly('<syllabic>end</syllabic><text>ri­a</text><extend type="start"/>') }) +
      n({ midi: 64, dur: 2, extra: ly('<extend type="stop"/>') }) +
      n({ midi: 65, dur: 2, extra: ly('<syllabic>single</syllabic><text>Dio</text><elision>‿</elision><syllabic>single</syllabic><text>è</text>') }) +
      n({ midi: undefined, dur: 2, extra: ly('<text>rest!</text>') }) +
      n({ midi: 67, dur: 2, extra: ly('<text></text>') + '<lyric number="2"><text>二</text></lyric>' });
    const s = check(parseMusicXML(partwise([{ name: 'Soprano', measures: [m] }])));
    const l = s.parts[0].notes.map((x) => x.lyric);
    // the last note's verse-1 lyric is empty; verse 2 is a real other verse and is not used
    expect(l).toEqual(['Gló', 'ria', undefined, 'Dio‿è', undefined]);
  });

  it('empty parts, rest-only parts, 1-note parts and a part with no measures', () => {
    const xml = partwise([
      { name: 'Soprano', measures: [attrs() + n({ midi: 72, dur: 16 })] },
      { name: 'Alto', measures: [attrs() + n({ midi: undefined, dur: 16 })] },
      { name: 'Tenor', measures: [attrs()] },
      { name: 'Bass', measures: [] },
    ]);
    const s = check(parseMusicXML(xml));
    expect(s.parts.map((p) => p.notes.length)).toEqual([1, 0, 0, 0]);
  });

  it('a score with no notes at all imports (UI reports "no notes") and has a sane grid', () => {
    const s = check(parseMusicXML(partwise([{ name: 'Soprano', measures: [attrs() + n({ dur: 16 }), n({ dur: 16 })] }])));
    expect(s.parts[0].notes.length).toBe(0);
  });

  it('degenerate attributes: divisions 0/negative, missing divisions, odd time signatures, absurd tempos', () => {
    const m1 = `<attributes><divisions>0</divisions><time><beats>0</beats><beat-type>4</beat-type></time></attributes>` + n({ midi: 60, dur: 1 });
    const m2 = `<attributes><divisions>-2</divisions><time><beats>abc</beats><beat-type>0</beat-type></time></attributes><sound tempo="0"/><sound tempo="-5"/><sound tempo="NaN"/>` + n({ midi: 60, dur: 2 });
    const m3 = `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>c. 0</per-minute></metronome></direction-type></direction>` + n({ midi: 62, dur: 0 }) + n({ midi: 64, dur: 4 });
    const s = check(parseMusicXML(partwise([{ name: 'Soprano', measures: [m1, m2, m3] }])));
    expect(s.tempos.every((t) => t.bpm > 0)).toBe(true);
  });

  it('overlapping notes in one voice (bad <backup>) are made monophonic for a sung part', () => {
    const m = attrs() + n({ midi: 72, dur: 8, lyric: 'a' }) + backup(4) + n({ midi: 74, dur: 8, lyric: 'b' }) + n({ midi: 76, dur: 4 });
    const s = check(parseMusicXML(partwise([{ name: 'Soprano', measures: [m] }])));
    expect(sung(s).length).toBeGreaterThan(0);
  });

  it('chord + different durations in one voice of a sung part', () => {
    const m = attrs() + n({ midi: 72, dur: 16, lyric: 'a' }) + n({ midi: 67, dur: 4, chord: true }) + backup(12) + n({ midi: 65, dur: 12, voice: 1 });
    check(parseMusicXML(partwise([{ name: 'Soprano', measures: [m] }])));
  });

  it('notes longer than their measure (overfull bars) and backup past the bar start', () => {
    const m = attrs() + n({ midi: 60, dur: 24 }) + backup(40) + n({ midi: 64, dur: 4, voice: 2 });
    check(parseMusicXML(partwise([{ name: 'Alto', measures: [m, n({ midi: 62, dur: 16 })] }])));
  });

  it('parts with different measure counts', () => {
    check(parseMusicXML(partwise([
      { name: 'Soprano', measures: [attrs() + n({ midi: 72, dur: 16 }), n({ midi: 72, dur: 16 }), n({ midi: 72, dur: 16 })] },
      { name: 'Alto', measures: [attrs() + n({ midi: 64, dur: 16 })] },
    ])));
  });

  it('namespaced / DOCTYPE-heavy XML with BOM and entities', async () => {
    const xml =
      '﻿<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
      partwise([{ name: 'Soprano &amp; Alto', measures: [attrs() + n({ midi: 72, dur: 16, lyric: 'caf&#233;' })] }]).replace(/^<\?xml[^>]*>/, '');
    const s = check(await importScoreFile('x.musicxml', strToU8(xml).buffer as ArrayBuffer));
    expect(s.parts[0].notes[0].lyric).toBe('café');
  });

  it('.mxl whose container points to a missing file / has extra META-INF files', async () => {
    const xml = partwise([{ name: 'Soprano', measures: [attrs() + n({ midi: 72, dur: 16 })] }]);
    const zip = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="missing.musicxml"/></rootfiles></container>'),
      'META-INF/manifest.xml': strToU8('<manifest/>'),
      'score.musicxml': strToU8(xml),
    });
    check(await importScoreFile('a.mxl', zip.buffer as ArrayBuffer));
  });

  it('rejects garbage with a user-facing error', async () => {
    for (const [name, data] of [
      ['a.musicxml', strToU8('hello')],
      ['a.mxl', strToU8('PK\u0003\u0004garbage')],
      ['a.mid', strToU8('MThdxx')],
      ['a.xml', strToU8('<html><body/></html>')],
      ['a.musicxml', new Uint8Array(0)],
      ['a.pdf', strToU8('%PDF')],
      ['a.mxl', zipSync({ 'readme.txt': strToU8('hi') })],
    ] as const) {
      const err = await importScoreFile(name, data.buffer as ArrayBuffer).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, name).toBeInstanceOf(Error);
      expect((err as Error).message, name).toMatch(USER_FACING_ERROR);
    }
  });
});

describe('importer hardening: scale', () => {
  it('500-measure SATB piece with lyrics imports in < 1 s', () => {
    const N = 500;
    const voices: [string, number][] = [['Soprano', 72], ['Alto', 65], ['Tenor', 57], ['Bass', 48]];
    const xml = partwise(
      voices.map(([name, base]) => ({
        name,
        measures: Array.from({ length: N }, (_, k) =>
          (k === 0 ? attrs() : '') +
          (k % 50 === 25 ? `<direction><direction-type><rehearsal>${String.fromCharCode(65 + ((k / 50) | 0))}</rehearsal></direction-type><sound tempo="${80 + (k % 7)}"/></direction>` : '') +
          [0, 1, 2, 3].map((b) => n({ midi: base + ((k + b) % 5), dur: 4, lyric: `la${b}` })).join(''),
        ),
      })),
    );
    // jsdom's DOMParser is ~10x slower than a browser's native one: budget only our own work
    let t0 = performance.now();
    new DOMParser().parseFromString(xml, 'application/xml');
    const domMs = performance.now() - t0;
    t0 = performance.now();
    const s = parseMusicXML(xml);
    const sec = computeSections(s);
    const ms = performance.now() - t0;
    expect(invariantViolations(s, sec)).toEqual([]);
    expect(s.measures.length).toBe(N);
    expect(ms - domMs).toBeLessThan(1000);
  });

  it('a very dense part (piano, 300 bars of 16th-note chords) does not blow the stack', () => {
    const N = 300;
    const m = (k: number) =>
      (k === 0 ? attrs(4, '<staves>2</staves>') : '') +
      Array.from({ length: 16 }, (_, b) => n({ midi: 60 + (b % 12), dur: 1, staff: 1 }) + n({ midi: 64 + (b % 12), dur: 1, chord: true, staff: 1 }) + n({ midi: 67 + (b % 12), dur: 1, chord: true, staff: 1 })).join('') +
      backup(16) +
      Array.from({ length: 16 }, (_, b) => n({ midi: 36 + (b % 12), dur: 1, voice: 5, staff: 2 })).join('');
    const s = check(parseMusicXML(partwise([{ name: 'Piano', measures: Array.from({ length: N }, (_, k) => m(k)) }])));
    expect(s.parts[0].notes.length).toBe(N * 64);
  });
});

describe('importer hardening: MIDI', () => {
  it('legato overlaps, chords and unterminated notes in a vocal track are made monophonic', () => {
    const midi = new Midi();
    midi.header.setTempo(100);
    const t = midi.addTrack();
    t.name = 'Soprano';
    for (let i = 0; i < 20; i++) t.addNote({ midi: 67 + (i % 5), ticks: i * 480, durationTicks: 520 }); // overlaps the next note
    t.addNote({ midi: 60, ticks: 480 * 5, durationTicks: 480 }); // one chord
    const s = check(parseMidi(midi.toArray()));
    expect(sung(s).length).toBe(1);
  });

  it('huge MIDI (60k notes) does not blow the stack', () => {
    const midi = new Midi();
    const t = midi.addTrack();
    t.name = 'Piano';
    t.instrument.number = 0;
    for (let i = 0; i < 60000; i++) t.addNote({ midi: 40 + (i % 40), ticks: i * 60, durationTicks: 60 });
    const t0 = performance.now();
    const s = parseMidi(midi.toArray());
    expect(invariantViolations(s, computeSections(s))).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(10000); // generous: guards against quadratic blow-ups, not machine speed
  }, 30_000);

  it('MIDI with a stray event far in the future, zero-length notes and weird time signatures', () => {
    const midi = new Midi();
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [0, 0] });
    midi.header.timeSignatures.push({ ticks: 480 * 3, timeSignature: [5, 8] });
    const t = midi.addTrack();
    t.name = 'Alto';
    t.addNote({ midi: 64, ticks: 0, durationTicks: 0 });
    t.addNote({ midi: 65, ticks: 480, durationTicks: 480 });
    t.addNote({ midi: 66, ticks: 480 * 4000, durationTicks: 480 });
    check(parseMidi(midi.toArray()));
  });

  it('MIDI with no notes', () => {
    const midi = new Midi();
    midi.addTrack().name = 'Empty';
    const s = check(parseMidi(midi.toArray()));
    expect(s.parts.length).toBe(0);
  });
});
