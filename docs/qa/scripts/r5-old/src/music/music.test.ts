import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { Midi } from '@tonejs/midi';
import { parseMusicXML } from './musicxml';
import { importScoreFile } from './import';
import { parseMidi } from './midi';
import { computeSections } from './sections';
import { beatTimes, beatToTime, keyAtTime, measureAtTime, soundingAt, tempoAtTime, timeToBeat } from './time';

// ---------------------------------------------------------------------------
// tiny MusicXML builders

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "C4:4" → quarter (divisions 4); "r:4" rest; suffixes: "~" tie start, "^" tie stop, "*" chord, "@2" voice 2; lyric after "/" */
function note(spec: string): string {
  const [main, lyr] = spec.split('/');
  const m = main.match(/^([A-G][#b]?\d|r):(\d+)([~^*]*)(?:@(\d))?$/)!;
  if (!m) throw new Error(spec);
  const [, p, dur, flags, voice] = m;
  let x = '<note>';
  if (flags.includes('*')) x += '<chord/>';
  if (p === 'r') x += '<rest/>';
  else {
    const pm = p.match(/^([A-G])([#b]?)(\d)$/)!;
    x += `<pitch><step>${pm[1]}</step>${pm[2] ? `<alter>${pm[2] === '#' ? 1 : -1}</alter>` : ''}<octave>${pm[3]}</octave></pitch>`;
  }
  x += `<duration>${dur}</duration>`;
  if (flags.includes('^')) x += '<tie type="stop"/>';
  if (flags.includes('~')) x += '<tie type="start"/>';
  x += `<voice>${voice ?? 1}</voice>`;
  if (lyr) {
    const syl = lyr.endsWith('-') ? (lyr.startsWith('-') ? 'middle' : 'begin') : lyr.startsWith('-') ? 'end' : 'single';
    x += `<lyric number="1"><syllabic>${syl}</syllabic><text>${lyr.replace(/^-|-$/g, '')}</text></lyric>`;
  }
  return x + '</note>';
}
const midiOf = (p: string) => {
  const pm = p.match(/^([A-G])([#b]?)(\d)$/)!;
  return (+pm[3] + 1) * 12 + STEP[pm[1]] + (pm[2] === '#' ? 1 : pm[2] === 'b' ? -1 : 0);
};

interface PartSpec {
  name: string;
  measures: string[]; // whitespace separated note specs or raw xml chunks starting with "<"
  attrs?: string;
}
function score(parts: PartSpec[], opts: { title?: string; tempo?: number; fifths?: number; time?: string } = {}): string {
  const plist = parts.map((p, i) => `<score-part id="P${i + 1}"><part-name>${p.name}</part-name></score-part>`).join('');
  const body = parts
    .map(
      (p, i) =>
        `<part id="P${i + 1}">` +
        p.measures
          .map((m, mi) => {
            let x = `<measure number="${mi + 1}">`;
            if (mi === 0)
              x += `<attributes><divisions>4</divisions><key><fifths>${opts.fifths ?? 0}</fifths></key><time><beats>${(opts.time ?? '4/4').split('/')[0]}</beats><beat-type>${(opts.time ?? '4/4').split('/')[1]}</beat-type></time>${p.attrs ?? ''}</attributes>`;
            if (mi === 0 && i === 0 && opts.tempo) x += `<direction><direction-type><words>T</words></direction-type><sound tempo="${opts.tempo}"/></direction>`;
            x += m
              .trim()
              .split(/\s+(?=[^>]*(?:<|$))/)
              .filter(Boolean)
              .map((t) => (t.startsWith('<') ? t : note(t)))
              .join('');
            return x + '</measure>';
          })
          .join('') +
        '</part>',
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${opts.title ?? 'Test'}</work-title></work><identification><creator type="composer">Tester</creator></identification><part-list>${plist}</part-list>${body}</score-partwise>`;
}

// ---------------------------------------------------------------------------

describe('parseMusicXML', () => {
  const satb = score(
    [
      { name: 'Soprano', measures: ['C5:4/Ky- D5:4/-ri- E5:8/-e', 'F5:16'] },
      { name: 'Alto', measures: ['A4:8/Ky- A4:8/-rie', 'A4:16'] },
      { name: 'Tenor', measures: ['E4:16/Ky-', 'C4:16/-rie'], attrs: '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>' },
      { name: 'Bass', measures: ['A2:16/Kyrie', 'F2:16'] },
    ],
    { title: 'Kyrie', tempo: 60, fifths: -1 },
  );

  it('parses a simple 4-part score', () => {
    const s = parseMusicXML(satb);
    expect(s.title).toBe('Kyrie');
    expect(s.composer).toBe('Tester');
    expect(s.source).toBe('musicxml');
    expect(s.parts.map((p) => p.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass']);
    expect(s.parts.map((p) => p.voiceType)).toEqual(['S', 'A', 'T', 'B']);
    expect(s.measures).toHaveLength(2);
    expect(s.measures[1].startBeat).toBe(4);
    expect(s.measures[1].start).toBeCloseTo(4); // 60 bpm
    expect(s.keys[0].fifths).toBe(-1);
    const sop = s.parts[0];
    expect(sop.notes.map((n) => n.midi)).toEqual([72, 74, 76, 77]);
    expect(sop.notes[2]).toMatchObject({ startBeat: 2, durBeats: 2, start: 2, dur: 2, measure: 0 });
    expect(sop.low).toBe(72);
    expect(sop.high).toBe(77);
    // tenor in treble-8vb: written octave 4 here stays as written (no clef shift)
    expect(s.parts[2].notes[0].midi).toBe(64);
    expect(s.duration).toBeCloseTo(8);
    expect(parseMusicXML(satb).id).toBe(s.id); // stable id
    expect(parseMusicXML(satb, { id: 'x' }).id).toBe('x');
  });

  it('keeps lyrics with syllabic info', () => {
    const s = parseMusicXML(satb);
    expect(s.parts[0].notes.slice(0, 3).map((n) => [n.lyric, n.syllabic])).toEqual([
      ['Ky', 'begin'],
      ['ri', 'middle'],
      ['e', 'end'],
    ]);
    expect(s.parts[3].notes[0]).toMatchObject({ lyric: 'Kyrie', syllabic: 'single' });
    expect(s.parts[3].notes[1].lyric).toBeUndefined();
  });

  it('merges tied notes (also across barlines) and keeps the first syllable', () => {
    const s = parseMusicXML(score([{ name: 'Alto', measures: ['G4:8~/A- G4:8^~', 'G4:4^ A4:12/-men'] }]));
    const n = s.parts[0].notes;
    expect(n).toHaveLength(2);
    expect(n[0]).toMatchObject({ midi: 67, startBeat: 0, durBeats: 5, lyric: 'A', syllabic: 'begin' });
    expect(n[1]).toMatchObject({ midi: 69, startBeat: 5, durBeats: 3, lyric: 'men', syllabic: 'end' });
  });

  it('splits chords in one voice into two singable parts (top → 1, lower → 2)', () => {
    const s = parseMusicXML(score([{ name: 'Tenor', measures: ['E4:8/Ah C4:8* F4:8 D4:8*', 'G4:16'] }]));
    expect(s.parts.map((p) => p.name)).toEqual(['Tenor 1', 'Tenor 2']);
    expect(s.parts.map((p) => p.id)).toEqual(['P1-1', 'P1-2']);
    expect(s.parts[0].notes.map((n) => n.midi)).toEqual([64, 65, 67]);
    expect(s.parts[1].notes.map((n) => n.midi)).toEqual([60, 62, 67]); // unison note shared
    expect(s.parts[1].notes[0].lyric).toBe('Ah'); // chord lyric shared
    expect(s.parts.every((p) => p.voiceType === 'T')).toBe(true);
  });

  it('splits two voices on one staff ("Soprano/Alto"), filling absent voices from the other', () => {
    const s = parseMusicXML(
      score([
        {
          name: 'Soprano/Alto',
          measures: [
            'C5:8/Glo- D5:8/-ri- <backup><duration>16</duration></backup> A4:8@2/Glo- B4:8@2/-ri-',
            'E5:16/-a', // alto absent → sings with soprano
            'F5:16/Ah <backup><duration>16</duration></backup> r:16@2',
          ],
        },
      ]),
    );
    expect(s.parts.map((p) => p.name)).toEqual(['Soprano', 'Alto']);
    expect(s.parts.map((p) => p.voiceType)).toEqual(['S', 'A']);
    expect(s.parts[0].notes.map((n) => n.midi)).toEqual([72, 74, 76, 77]);
    expect(s.parts[1].notes.map((n) => n.midi)).toEqual([69, 71, 76]); // rests in m3
    expect(s.parts[1].notes.map((n) => n.lyric)).toEqual(['Glo', 'ri', 'a']);
  });

  it('applies <transpose> to get sounding pitch', () => {
    const s = parseMusicXML(
      score([
        {
          name: 'Clarinet in Bb',
          measures: ['D5:16'],
          attrs: '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic><octave-change>-1</octave-change></transpose>',
        },
      ]),
    );
    expect(s.parts[0].notes[0].midi).toBe(74 - 2 - 12);
  });

  it('builds a tempo map from <sound tempo> and <metronome> and converts to seconds', () => {
    const met = '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>40</per-minute></metronome></direction-type></direction>';
    const xml = score([{ name: 'Soprano', measures: ['C5:8 <sound tempo="120"/> C5:8', `${met} C5:16`, 'C5:16'] }], { tempo: 60 });
    const s = parseMusicXML(xml);
    expect(s.tempos.map((t) => [t.beat, t.bpm])).toEqual([
      [0, 60],
      [2, 120],
      [4, 60], // dotted quarter = 40 → 60 quarter bpm (repeated value kept as change from 120)
    ]);
    const n = s.parts[0].notes;
    expect(n[0]).toMatchObject({ start: 0, dur: 2 });
    expect(n[1].start).toBeCloseTo(2);
    expect(n[1].dur).toBeCloseTo(1);
    expect(n[2].start).toBeCloseTo(3);
    expect(n[3].start).toBeCloseTo(7);
    expect(s.duration).toBeCloseTo(11);
    expect(tempoAtTime(s, 2.5)).toBe(120);
  });

  it('defaults to 90 bpm and handles a pickup measure', () => {
    const xml = score([{ name: 'Bass', measures: ['C3:4', 'C3:16'] }]).replace('<measure number="1">', '<measure number="0" implicit="yes">');
    const s = parseMusicXML(xml);
    expect(s.tempos).toEqual([{ beat: 0, time: 0, bpm: 90 }]);
    expect(s.measures[0]).toMatchObject({ number: '0', durBeats: 1 });
    expect(s.measures[1].startBeat).toBe(1);
    expect(s.parts[0].notes[1].start).toBeCloseTo(60 / 90);
  });

  it('reads rehearsal marks, double bars, key changes, elisions and ignores grace/cue notes', () => {
    const reh = '<direction><direction-type><rehearsal>B</rehearsal></direction-type></direction>';
    const dbl = '<barline location="right"><bar-style>light-light</bar-style></barline>';
    const key = '<attributes><key><fifths>3</fifths><mode>minor</mode></key></attributes>';
    const grace = '<note><grace/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice></note>';
    const cue = '<note><cue/><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note>';
    const elis =
      '<note><pitch><step>E</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><lyric number="1"><syllabic>single</syllabic><text>che</text><elision/><syllabic>single</syllabic><text>a</text></lyric><lyric number="2"><text>X</text></lyric></note>';
    const s = parseMusicXML(score([{ name: 'S', measures: [`C5:16 ${dbl}`, `${reh} ${key} ${grace} ${cue} ${elis}`] }]));
    expect(s.measures[0].doubleBar).toBe(true);
    expect(s.measures[1].rehearsalMark).toBe('B');
    expect(s.keys.map((k) => [k.fifths, k.mode, k.beat])).toEqual([
      [0, 'major', 0],
      [3, 'minor', 4],
    ]);
    expect(keyAtTime(s, 100).fifths).toBe(3);
    const n = s.parts[0].notes;
    expect(n.map((x) => x.midi)).toEqual([72, 76]);
    expect(n[1].startBeat).toBe(5); // after the cue note's duration
    expect(n[1].lyric).toBe('che‿a');
    expect(s.parts[0].voiceType).toBe('S');
  });

  it('marks empty parts and piano accompaniment as "other"', () => {
    const piano = {
      name: 'Piano',
      measures: ['C4:16 E4:16* G4:16* <backup><duration>16</duration></backup> C3:16@5'],
      attrs: '<staves>2</staves>',
    };
    const s = parseMusicXML(score([{ name: 'Soprano', measures: ['C5:16/la'] }, piano, { name: 'Organ', measures: ['r:16'] }]));
    expect(s.parts.map((p) => [p.name, p.voiceType, p.notes.length])).toEqual([
      ['Soprano', 'S', 1],
      ['Piano', 'other', 4],
      ['Organ', 'other', 0],
    ]);
  });

  it('guesses voice types from range when names are generic, and from names when present', () => {
    const s = parseMusicXML(
      score([
        { name: 'Basso', measures: ['C3:16'] },
        { name: 'Voice', measures: ['G5:16'] },
        { name: 'Basso continuo', measures: ['C3:16'] },
      ]),
    );
    expect(s.parts.map((p) => p.voiceType)).toEqual(['B', 'S', 'other']);
  });

  it('converts score-timewise', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE score-timewise PUBLIC "-//Recordare//DTD MusicXML 3.1 Timewise//EN" "http://www.musicxml.org/dtds/timewise.dtd">
      <score-timewise><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list>
      <measure number="1"><part id="P1"><attributes><divisions>1</divisions></attributes>${note('A4:4/la')}</part></measure>
      <measure number="2"><part id="P1">${note('B4:4/lu')}</part></measure></score-timewise>`;
    const s = parseMusicXML(xml);
    expect(s.parts[0].notes.map((n) => [n.midi, n.startBeat, n.lyric])).toEqual([
      [69, 0, 'la'],
      [71, 4, 'lu'],
    ]);
  });

  it('throws a clear error for non-MusicXML', () => {
    expect(() => parseMusicXML('<html/>')).toThrow(/Not a MusicXML/);
    expect(() => parseMusicXML('<<<')).toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('importScoreFile', () => {
  const xml = score([{ name: 'Soprano', measures: ['C5:16/Ä'] }], { title: 'Zip' });
  const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

  it('reads .mxl via META-INF/container.xml', async () => {
    const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/main.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
    const zip = zipSync({ 'META-INF/container.xml': strToU8(container), 'score/main.musicxml': strToU8(xml), 'other.xml': strToU8('<x/>') });
    const s = await importScoreFile('test.mxl', ab(zip));
    expect(s.title).toBe('Zip');
    expect(s.parts[0].notes[0].lyric).toBe('Ä');
  });

  it('falls back to the first xml in an .mxl without container', async () => {
    const zip = zipSync({ 'META-INF/foo.xml': strToU8('<x/>'), 'a.xml': strToU8(xml) });
    expect((await importScoreFile('a.mxl', ab(zip))).title).toBe('Zip');
  });

  it('decodes UTF-16 with BOM and DOCTYPE', async () => {
    const text = '﻿' + xml.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
    const buf = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      buf[2 * i] = text.charCodeAt(i) & 0xff;
      buf[2 * i + 1] = text.charCodeAt(i) >> 8;
    }
    const s = await importScoreFile('x.musicxml', ab(buf));
    expect(s.parts[0].notes[0].lyric).toBe('Ä');
  });

  it('rejects unknown extensions', async () => {
    await expect(importScoreFile('x.pdf', new ArrayBuffer(4))).rejects.toThrow(/Unsupported/);
  });
});

// ---------------------------------------------------------------------------

describe('parseMidi', () => {
  function buildMidi() {
    const midi = new Midi();
    midi.header.setTempo(120);
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] });
    midi.header.keySignatures.push({ ticks: 0, key: 'D', scale: 'major' });
    midi.header.meta.push({ ticks: 0, type: 'lyrics', text: 'Hal-' }, { ticks: midi.header.ppq, type: 'lyrics', text: 'le-' }, { ticks: midi.header.ppq * 2, type: 'lyrics', text: 'lu' });
    midi.header.update();
    const s = midi.addTrack();
    s.name = 'Soprano';
    [74, 76, 78].forEach((m, i) => s.addNote({ midi: m, time: i * 0.5, duration: 0.5 }));
    const b = midi.addTrack();
    b.name = 'Bass';
    b.channel = 1;
    [50, 45].forEach((m, i) => b.addNote({ midi: m, time: i * 0.75, duration: 0.75 }));
    const x = midi.addTrack();
    x.name = 'Track 3';
    x.channel = 2;
    [60, 64, 67].forEach((m) => x.addNote({ midi: m, time: 0, duration: 1.5 }));
    return midi.toArray();
  }

  it('parses parts, tempo, time & key signatures and lyrics', () => {
    const s = parseMidi(buildMidi(), { title: 'Alleluia' });
    expect(s.source).toBe('midi');
    expect(s.title).toBe('Alleluia');
    expect(s.tempos[0].bpm).toBeCloseTo(120);
    expect(s.keys[0]).toMatchObject({ fifths: 2, mode: 'major' });
    expect(s.measures[0].timeSig).toEqual([3, 4]);
    expect(s.measures[0].durBeats).toBe(3);
    const [sop, bass, other] = s.parts;
    expect(sop).toMatchObject({ name: 'Soprano', voiceType: 'S', low: 74, high: 78 });
    expect(sop.notes[1]).toMatchObject({ midi: 76, startBeat: 1, durBeats: 1 });
    expect(sop.notes[1].start).toBeCloseTo(0.5);
    expect(sop.notes.map((n) => [n.lyric, n.syllabic])).toEqual([
      ['Hal', 'begin'],
      ['le', 'middle'],
      ['lu', 'end'],
    ]);
    expect(bass.voiceType).toBe('B');
    expect(bass.notes[1].measure).toBe(0);
    expect(other.voiceType).toBe('other'); // chords
    expect(s.duration).toBeCloseTo(1.5);
  });

  it('imports .mid via importScoreFile', async () => {
    const bytes = buildMidi();
    const s = await importScoreFile('song.mid', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(s.parts.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe('built-in pieces', () => {
  const dir = resolve(__dirname, '../../public/pieces');
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as { id: string; file: string; level: string }[];

  for (const entry of manifest) {
    it(`${entry.id} parses into 4 sung SATB parts with lyrics and sections`, () => {
      const s = parseMusicXML(readFileSync(resolve(dir, entry.file), 'utf8'), { id: entry.id });
      expect(s.id).toBe(entry.id);
      expect(s.parts.map((p) => p.voiceType)).toEqual(['S', 'A', 'T', 'B']);
      const ranges: Record<string, [number, number]> = { S: [60, 79], A: [55, 74], T: [48, 67], B: [40, 62] };
      for (const p of s.parts) {
        expect(p.notes.length).toBeGreaterThan(10);
        expect(p.notes.every((n) => n.lyric)).toBe(true);
        expect(p.low).toBeGreaterThanOrEqual(ranges[p.voiceType][0]);
        expect(p.high).toBeLessThanOrEqual(ranges[p.voiceType][1]);
      }
      const secs = computeSections(s);
      expect(secs.length).toBeGreaterThanOrEqual(2);
      expect(secs[0].startMeasure).toBe(0);
      expect(secs[secs.length - 1].endMeasure).toBe(s.measures.length - 1);
      for (let i = 1; i < secs.length; i++) expect(secs[i].startMeasure).toBe(secs[i - 1].endMeasure + 1);
      for (const sec of secs) expect(sec.endMeasure - sec.startMeasure + 1).toBeGreaterThanOrEqual(2);
    });
  }

  it('warm-up chorale: pickup, tempo and double-bar section split', () => {
    const s = parseMusicXML(readFileSync(resolve(dir, 'warmup-chorale.musicxml'), 'utf8'));
    expect(s.title).toBe('Abendlied (Warm-up Chorale)');
    expect(s.measures[0]).toMatchObject({ number: '0', durBeats: 1 });
    expect(s.tempos[0].bpm).toBe(72);
    expect(s.keys[0]).toMatchObject({ fifths: 2, mode: 'major' });
    expect(s.parts[0].notes[1]).toMatchObject({ midi: 74, lyric: 'Mond', start: 60 / 72 });
    const secs = computeSections(s);
    expect(secs.map((x) => x.label)).toEqual(['Upbeat–bar 6', 'Bars 7–12']);
    expect(secs[0].id).toBe('s0-m0-6');
  });
});

// ---------------------------------------------------------------------------

describe('computeSections', () => {
  const bars = (n: number, fn: (i: number) => string) => Array.from({ length: n }, (_, i) => fn(i));

  it('splits a long through-composed piece into ~8-bar phrases at rests', () => {
    // a rest at the start of bar 7 (index 6) makes a good boundary
    const xml = score([{ name: 'Soprano', measures: bars(14, (i) => (i === 6 ? 'r:4 C5:12' : 'C5:16~')) }]);
    const secs = computeSections(parseMusicXML(xml));
    expect(secs.map((s) => [s.startMeasure, s.endMeasure])).toEqual([
      [0, 5],
      [6, 13],
    ]);
    expect(secs[0].label).toBe('Bars 1–6');
  });

  it('uses rehearsal marks as labels and boundaries; never leaves 1-bar sections', () => {
    const reh = (l: string) => `<direction><direction-type><rehearsal>${l}</rehearsal></direction-type></direction>`;
    const xml = score([{ name: 'S', measures: bars(11, (i) => (i === 1 ? reh('A') : i === 6 ? reh('B') : '') + ' C5:16') }]);
    const s = parseMusicXML(xml);
    const secs = computeSections(s);
    expect(secs.map((x) => [x.label, x.startMeasure, x.endMeasure])).toEqual([
      ['A', 0, 5],
      ['B', 6, 10],
    ]);
    expect(secs[1].start).toBeCloseTo(s.measures[6].start);
    expect(secs[1].end).toBeCloseTo(s.duration);
  });

  it('respects targetBars', () => {
    const xml = score([{ name: 'S', measures: bars(16, () => 'C5:8 r:8') }]);
    const secs = computeSections(parseMusicXML(xml), { targetBars: 4 });
    expect(secs).toHaveLength(4);
    expect(secs.every((s) => s.endMeasure - s.startMeasure === 3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('time helpers', () => {
  const xml = score(
    [
      { name: 'Soprano', measures: ['C5:8 D5:8', 'E5:16'] },
      { name: 'Bass', measures: ['C3:16', 'C3:8 <sound tempo="120"/> G2:8'] },
    ],
    { tempo: 60, time: '4/4' },
  );
  const s = parseMusicXML(xml);

  it('beatToTime / timeToBeat are inverse', () => {
    for (const b of [0, 1.5, 4, 6, 7.25]) expect(timeToBeat(s.tempos, beatToTime(s.tempos, b))).toBeCloseTo(b);
    expect(beatToTime(s.tempos, 7)).toBeCloseTo(6.5);
  });

  it('measureAtTime / tempoAtTime / keyAtTime', () => {
    expect(measureAtTime(s, -1)).toBe(0);
    expect(measureAtTime(s, 3.99)).toBe(0);
    expect(measureAtTime(s, 4)).toBe(1);
    expect(measureAtTime(s, 1e6)).toBe(1);
    expect(tempoAtTime(s, 5)).toBe(60);
    expect(tempoAtTime(s, 6.2)).toBe(120);
    expect(keyAtTime(s, 3)).toMatchObject({ fifths: 0, mode: 'major' });
  });

  it('soundingAt', () => {
    expect(soundingAt(s, 0.5).sort()).toEqual([48, 72]);
    expect(soundingAt(s, 2.5).sort()).toEqual([48, 74]);
    expect(soundingAt(s, 6.1).sort()).toEqual([43, 76]);
    expect(soundingAt(s, 6.1, s.parts[0].id)).toEqual([43]);
    expect(soundingAt(s, 100)).toEqual([]);
  });

  it('beatTimes with downbeats and tempo change', () => {
    const bt = beatTimes(s, 0, 7);
    expect(bt.map((b) => +b.time.toFixed(3))).toEqual([0, 1, 2, 3, 4, 5, 6, 6.5]);
    expect(bt.filter((b) => b.downbeat).map((b) => b.time)).toEqual([0, 4]);
    expect(beatTimes(s, 4.5, 5.5).map((b) => b.time)).toEqual([5]);
  });

  it('compound meter beats are dotted quarters', () => {
    const s68 = parseMusicXML(score([{ name: 'S', measures: ['C5:12'] }], { time: '6/8', tempo: 60 }));
    expect(beatTimes(s68, 0, 10).map((b) => b.time)).toEqual([0, 1.5]);
  });
});
