// QA: which time signatures / tempi occur in built-in pieces; count-in beats the session asks for
// vs. felt beats the player clicks; pitch ranges per part (octave sanity check).
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { importScoreFile } from '../../../src/music/import';
import { beatsInMeasure, beatSecAt } from '../../../src/audio/player';
const files = JSON.parse(readFileSync(process.cwd() + '/public/pieces/repertoire.json', 'utf8')).map((r: { file: string }) => r.file).concat(['warmup-chorale.musicxml']);
const countInBeats = (num: number, den: number) => { const c = den === 8 && num % 3 === 0; const beats = c ? num / 3 : num; return Math.max(2, Math.min(4, beats)) * (c ? 1.5 : 4 / den); };
test('meters', async () => {
  const out: string[] = [];
  for (const f of files) {
    const b = readFileSync(process.cwd() + '/public/pieces/' + f);
    const s = await importScoreFile(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const sigs = [...new Set(s.measures.map((m) => m.timeSig.join('/')))];
    const ci = sigs.map((x) => { const [n, d] = x.split('/').map(Number); const k = Math.round(countInBeats(n, d)); return `${x}: session asks ${countInBeats(n, d)} → player clicks ${k} felt beats (bar has ${beatsInMeasure([n, d])})`; });
    const ranges = s.parts.map((p) => `${p.name}(${p.voiceType}) ${Math.min(...p.notes.map((n) => n.midi))}-${Math.max(...p.notes.map((n) => n.midi))}`);
    const tempos = s.tempos.map((t) => t.bpm.toFixed(0)).slice(0, 6);
    const minDur = Math.min(...s.parts.flatMap((p) => p.notes.map((n) => n.dur)));
    out.push(`${f}: tempos ${tempos} | shortest note ${minDur.toFixed(3)}s\n   ${ci.join('\n   ')}\n   ${ranges.join(', ')}`);
  }
  console.log(out.join('\n'));
});
