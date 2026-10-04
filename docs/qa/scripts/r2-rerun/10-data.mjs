import { launch, BASE, sleep } from './lib.mjs';
const { browser, page } = await launch();
await page.goto(BASE + '#/library'); await sleep(4000);
const out = await page.evaluate(async () => {
  const lib = await import('/src/ui/library.ts');
  await lib.ensureLoaded();
  const res = {};
  for (const p of lib.allPieces()) {
    const s = p.score;
    const ms = s.measures.slice(0, 3).map(m => `#${m.number} beats ${m.startBeat}+${m.durBeats} ts ${m.timeSig.join('/')}`);
    const parts = s.parts.map(pt => {
      const n0 = pt.notes[0];
      const lyr = pt.notes.filter(n => n.lyric).length;
      const mid = pt.notes.map(n => n.midi); 
      return `${pt.name}[${pt.voiceType}] n=${pt.notes.length} lyr=${lyr} range=${Math.min(...mid)}-${Math.max(...mid)} first@${n0?.start?.toFixed(2)}s`;
    });
    // gaps where all parts silent > 1.5 beats
    res[p.id] = { title: p.title, keys: JSON.stringify(s.keys ?? s.keySignatures ?? '').slice(0,150), tempos: JSON.stringify(s.tempos ?? '').slice(0,150), ms, parts, nMeas: s.measures.length, dur: s.duration?.toFixed(1) };
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
