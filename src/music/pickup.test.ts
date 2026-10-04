import { describe, it, expect } from 'vitest';
import { parseMusicXML } from './musicxml';

const note = (step: string, oct: number, dur: number) =>
  `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>quarter</type></note>`;

describe('pickup bars', () => {
  it('treats a short first bar as a pickup even without implicit="yes"', () => {
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="0"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${note('G', 4, 1)}</measure>
        <measure number="1">${note('C', 5, 1)}${note('D', 5, 1)}${note('E', 5, 1)}${note('F', 5, 1)}</measure>
        <measure number="2">${note('G', 5, 4)}</measure>
      </part></score-partwise>`;
    const s = parseMusicXML(xml);
    expect(s.measures[0].durBeats).toBe(1);
    const n = s.parts[0].notes;
    expect(n[1].startBeat).toBe(1); // C5 right after the upbeat, no padding
  });
});

import { voiceTypeFromName } from './musicxml';
describe('voice names in other languages', () => {
  it('recognises Dutch part names', () => {
    expect(voiceTypeFromName('Sopraan')).toBe('S');
    expect(voiceTypeFromName('Alt')).toBe('A');
    expect(voiceTypeFromName('Tenor')).toBe('T');
    expect(voiceTypeFromName('Bas')).toBe('B');
  });
});
