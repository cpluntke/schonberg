#!/usr/bin/env node
// Generates the built-in ORIGINAL demo pieces in public/pieces/ as MusicXML (score-partwise 3.1)
// and checks them for range problems and parallel fifths/octaves.
//   node scripts/gen-pieces.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/pieces');
const DIV = 4; // divisions per quarter

const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function parsePitch(p) {
  const m = p.match(/^([A-G])(#|b)?(\d)$/);
  if (!m) throw new Error('bad pitch ' + p);
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = +m[3];
  return { step: m[1], alter, octave, midi: (octave + 1) * 12 + STEPS[m[1]] + alter };
}

/** Alteration of a step implied by a key signature. */
function keyAlter(fifths, step) {
  const sharps = 'FCGDAEB';
  const flats = 'BEADGCF';
  if (fifths > 0) return sharps.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return flats.slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

const TYPES = {
  0.5: ['eighth', 0], 0.75: ['eighth', 1], 1: ['quarter', 0], 1.5: ['quarter', 1],
  2: ['half', 0], 3: ['half', 1], 4: ['whole', 0],
};

const RANGES = { S: [60, 79], A: [55, 74], T: [48, 67], B: [40, 62] };
const VOICES = ['S', 'A', 'T', 'B'];
const PART_INFO = {
  S: { name: 'Soprano', abbr: 'S.', clef: '<clef><sign>G</sign><line>2</line></clef>' },
  A: { name: 'Alto', abbr: 'A.', clef: '<clef><sign>G</sign><line>2</line></clef>' },
  // tenor: treble-8vb clef, pitches written at sounding octave (octave 3) — standard MusicXML practice
  T: { name: 'Tenor', abbr: 'T.', clef: '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>' },
  B: { name: 'Bass', abbr: 'B.', clef: '<clef><sign>F</sign><line>4</line></clef>' },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * piece: { id, title, composer, bpm, tempoText, fifths, mode, time:[n,d], pickup?: beats,
 *          measures: [ { cols: [[dur, S, A, T, B, lyric], ...], doubleBar?, rehearsal? } ] }
 * Homophonic columns: every voice sings the column's syllable.
 */
function build(piece) {
  const problems = [];
  // voice → measure → notes
  const voices = Object.fromEntries(VOICES.map((v) => [v, []]));
  piece.measures.forEach((m, mi) => {
    const len = m.cols.reduce((s, c) => s + c[0], 0);
    const expected = mi === 0 && piece.pickup ? piece.pickup : (piece.time[0] * 4) / piece.time[1];
    if (Math.abs(len - expected) > 1e-9) problems.push(`m${mi}: length ${len} != ${expected}`);
    VOICES.forEach((v, vi) => {
      voices[v].push(
        m.cols.map((c) => ({ dur: c[0], pitch: c[1 + vi] ? parsePitch(c[1 + vi]) : null, lyric: c[5] })),
      );
    });
  });

  // checks: ranges, crossing, parallels between consecutive columns
  const cols = piece.measures.flatMap((m, mi) => m.cols.map((c) => ({ mi, midis: c.slice(1, 5).map((p) => (p ? parsePitch(p).midi : null)) })));
  for (const { mi, midis } of cols) {
    VOICES.forEach((v, i) => {
      const x = midis[i];
      if (x !== null && (x < RANGES[v][0] || x > RANGES[v][1])) problems.push(`m${mi} ${v} out of range: ${x}`);
    });
    for (let i = 0; i < 3; i++) if (midis[i] !== null && midis[i + 1] !== null && midis[i] < midis[i + 1]) problems.push(`m${mi} voice crossing ${VOICES[i]}/${VOICES[i + 1]}`);
  }
  for (let k = 1; k < cols.length; k++) {
    const a = cols[k - 1].midis;
    const b = cols[k].midis;
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        if ([a[i], a[j], b[i], b[j]].some((x) => x === null)) continue;
        if (a[i] === b[i] && a[j] === b[j]) continue;
        const i1 = (a[i] - a[j]) % 12;
        const i2 = (b[i] - b[j]) % 12;
        if (a[i] !== b[i] && a[j] !== b[j] && i1 === i2 && (i1 === 7 || i1 === 0))
          problems.push(`m${cols[k].mi}: parallel ${i1 === 7 ? 'fifths' : 'octaves'} ${VOICES[i]}/${VOICES[j]}`);
      }
  }

  // XML
  const partList = VOICES.map(
    (v, i) => `    <score-part id="P${i + 1}">
      <part-name>${PART_INFO[v].name}</part-name>
      <part-abbreviation>${PART_INFO[v].abbr}</part-abbreviation>
      <score-instrument id="P${i + 1}-I1"><instrument-name>Voice</instrument-name></score-instrument>
    </score-part>`,
  ).join('\n');

  const parts = VOICES.map((v, vi) => {
    let hyphen = false; // previous syllable ended with "-"
    const measures = voices[v].map((notes, mi) => {
      const m = piece.measures[mi];
      const number = piece.pickup ? mi : mi + 1;
      let x = `    <measure number="${number}"${mi === 0 && piece.pickup ? ' implicit="yes"' : ''}>\n`;
      if (mi === 0) {
        x += `      <attributes>
        <divisions>${DIV}</divisions>
        <key><fifths>${piece.fifths}</fifths><mode>${piece.mode}</mode></key>
        <time><beats>${piece.time[0]}</beats><beat-type>${piece.time[1]}</beat-type></time>
        ${PART_INFO[v].clef}
      </attributes>\n`;
        if (vi === 0)
          x += `      <direction placement="above">
        <direction-type><words font-weight="bold">${esc(piece.tempoText)}</words></direction-type>
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${piece.bpm}</per-minute></metronome></direction-type>
        <sound tempo="${piece.bpm}"/>
      </direction>\n`;
      }
      if (m.rehearsal && vi === 0)
        x += `      <direction placement="above"><direction-type><rehearsal>${esc(m.rehearsal)}</rehearsal></direction-type></direction>\n`;
      for (const n of notes) {
        const [type, dots] = TYPES[n.dur] ?? (() => { throw new Error('no type for ' + n.dur); })();
        x += '      <note>\n';
        if (n.pitch) {
          x += `        <pitch><step>${n.pitch.step}</step>${n.pitch.alter ? `<alter>${n.pitch.alter}</alter>` : ''}<octave>${n.pitch.octave}</octave></pitch>\n`;
        } else x += '        <rest/>\n';
        x += `        <duration>${n.dur * DIV}</duration>\n        <voice>1</voice>\n        <type>${type}</type>\n`;
        for (let d = 0; d < dots; d++) x += '        <dot/>\n';
        if (n.pitch && n.pitch.alter !== keyAlter(piece.fifths, n.pitch.step))
          x += `        <accidental>${n.pitch.alter > 0 ? 'sharp' : n.pitch.alter < 0 ? 'flat' : 'natural'}</accidental>\n`;
        if (n.pitch && n.lyric) {
          const ends = n.lyric.endsWith('-');
          const text = n.lyric.replace(/-$/, '');
          const syl = hyphen ? (ends ? 'middle' : 'end') : ends ? 'begin' : 'single';
          hyphen = ends;
          x += `        <lyric number="1"><syllabic>${syl}</syllabic><text>${esc(text)}</text></lyric>\n`;
        }
        x += '      </note>\n';
      }
      const last = mi === piece.measures.length - 1;
      if (last) x += '      <barline location="right"><bar-style>light-heavy</bar-style></barline>\n';
      else if (m.doubleBar) x += '      <barline location="right"><bar-style>light-light</bar-style></barline>\n';
      x += '    </measure>\n';
      return x;
    });
    return `  <part id="P${vi + 1}">\n${measures.join('')}  </part>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${esc(piece.title)}</work-title></work>
  <identification>
    <creator type="composer">${esc(piece.composer)}</creator>
    ${piece.poet ? `<creator type="lyricist">${esc(piece.poet)}</creator>` : ''}
    <rights>${esc(piece.rights)}</rights>
    <encoding><software>schonberg-hero scripts/gen-pieces.mjs</software></encoding>
  </identification>
  <part-list>
${partList}
  </part-list>
${parts}
</score-partwise>
`;
  return { xml, problems };
}

// ---------------------------------------------------------------------------
// 1. Abendlied (warm-up chorale). Text: Matthias Claudius, "Abendlied" (1779), stanza 1 — public domain.
//    Music: original, homophonic, D major.
const C = (dur, S, A, T, B, lyric) => [dur, S, A, T, B, lyric];
const abendlied = {
  id: 'warmup-chorale',
  title: 'Abendlied (Warm-up Chorale)',
  composer: 'Schönberg Hero (original)',
  poet: 'Matthias Claudius (1779)',
  rights: 'Music: original for Schönberg Hero (CC0). Text: public domain.',
  bpm: 72,
  tempoText: 'Ruhig',
  fifths: 2,
  mode: 'major',
  time: [4, 4],
  pickup: 1,
  measures: [
    { cols: [C(1, 'A4', 'F#4', 'D4', 'D3', 'Der')] },
    { cols: [C(1, 'D5', 'F#4', 'A3', 'D3', 'Mond'), C(1, 'C#5', 'E4', 'A3', 'A2', 'ist'), C(1, 'B4', 'D4', 'F#3', 'B2', 'auf-'), C(1, 'A4', 'D4', 'A3', 'F#3', 'ge-')] },
    { cols: [C(1, 'B4', 'G4', 'E4', 'E3', 'gan-'), C(2, 'A4', 'E4', 'C#4', 'A2', 'gen,'), C(1, 'A4', 'F#4', 'D4', 'D3', 'die')] },
    { cols: [C(1, 'B4', 'G4', 'D4', 'G2', 'gold-'), C(1, 'C#5', 'E4', 'A3', 'A2', 'nen'), C(1, 'D5', 'G4', 'B3', 'G2', 'Stern-'), C(1, 'E5', 'G4', 'B3', 'G2', 'lein')] },
    { cols: [C(1, 'D5', 'F#4', 'D4', 'A2', 'pran-'), C(2, 'C#5', 'G4', 'E4', 'A2', 'gen'), C(1, 'D5', 'F#4', 'D4', 'D3', 'am')] },
    { cols: [C(1, 'E5', 'A4', 'A3', 'C#3', 'Him-'), C(1, 'F#5', 'A4', 'A3', 'D3', 'mel'), C(1, 'G5', 'B4', 'D4', 'B2', 'hell'), C(1, 'F#5', 'A4', 'D4', 'D3', 'und')] },
    { cols: [C(3, 'E5', 'A4', 'C#4', 'A2', 'klar;'), C(1, 'C#5', 'A4', 'E4', 'A2', 'der')], doubleBar: true },
    { cols: [C(1, 'D5', 'F#4', 'B3', 'B2', 'Wald'), C(1, 'C#5', 'F#4', 'C#4', 'A#2', 'steht'), C(1, 'B4', 'F#4', 'D4', 'B2', 'schwarz'), C(1, 'B4', 'G4', 'E4', 'E3', 'und')] },
    { cols: [C(1, 'B4', 'F#4', 'C#4', 'F#3', 'schwei-'), C(2, 'A#4', 'F#4', 'C#4', 'F#2', 'get,'), C(1, 'A4', 'E4', 'C#4', 'A2', 'und')] },
    { cols: [C(1, 'A4', 'F#4', 'D4', 'D3', 'aus'), C(1, 'B4', 'G4', 'D4', 'B2', 'den'), C(1, 'C#5', 'A4', 'E4', 'A2', 'Wie-'), C(1, 'D5', 'F#4', 'D4', 'B2', 'sen')] },
    { cols: [C(1, 'E5', 'B4', 'D4', 'G#2', 'stei-'), C(2, 'C#5', 'A4', 'E4', 'A2', 'get'), C(1, 'A4', 'E4', 'C#4', 'G2', 'der')] },
    { cols: [C(1, 'D5', 'F#4', 'D4', 'F#2', 'wei-'), C(1, 'E5', 'B4', 'D4', 'G2', 'ße'), C(1, 'G5', 'B4', 'E4', 'E2', 'Ne-'), C(1, 'F#5', 'B4', 'D4', 'B2', 'bel')] },
    { cols: [C(1, 'E5', 'B4', 'D4', 'G2', 'wun-'), C(1, 'C#5', 'G4', 'A3', 'A2', 'der-'), C(2, 'D5', 'F#4', 'A3', 'D3', 'bar.')] },
  ],
};

const PIECES = [
  {
    piece: abendlied,
    level: 'easy',
    description: 'Homophonic four-part warm-up in D major on Claudius’ “Der Mond ist aufgegangen”. Learn the app, tune your chords.',
  },
];

mkdirSync(OUT, { recursive: true });
const manifest = [];
let bad = false;
for (const { piece, level, description } of PIECES) {
  const { xml, problems } = build(piece);
  if (problems.length) {
    console.warn(`${piece.id}:\n  ` + problems.join('\n  '));
    if (problems.some((p) => /length|range|crossing/.test(p))) bad = true;
  }
  const file = `${piece.id}.musicxml`;
  writeFileSync(resolve(OUT, file), xml);
  manifest.push({ id: piece.id, file, title: piece.title, composer: piece.composer, level, description });
  console.log(`wrote ${file}`);
}
writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote manifest.json');
if (bad) process.exit(1);
