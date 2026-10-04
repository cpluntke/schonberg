import { launch, BASE, shot, sleep } from './lib.mjs';
import { setProfile, playFromPiece } from './playlib.mjs';
const { browser, page, errors } = await launch();
page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('  [nav]', f.url()); });
await setProfile(page);
const runs = [
  { sim: 'sloppy', pieceId: 'debussy-dieu', part: 1, sec: 0, level: 1, tag: '06-debussy-alto-L1-sloppy' },
  { sim: 'perfect', pieceId: 'ravel-nicolette', part: 2, sec: 1, level: 1, tag: '06-ravel-tenor-L1-perfect' },
  { sim: 'perfect', pieceId: 'brahms-schaffe', part: 4, sec: 0, level: 1, tag: '06-brahms-bass2-L1-perfect' },
  { sim: 'flat', pieceId: 'bach-bwv315', part: 1, sec: 0, level: 2, tag: '06-bach-alto-L2-flat' },
  { sim: 'sloppy', pieceId: 'bruckner-locus-iste', part: 0, sec: 0, level: 1, tag: '06-bruckner-sop-L1-sloppy' },
];
for (const r of runs) {
  errors.length = 0;
  const res = await playFromPiece(page, r);
  console.log(`\n### ${r.tag} -> ${res.hash} in ${res.secs}s\n${res.text.replace(/\n+/g,' | ').slice(0, 600)}\nERR ${JSON.stringify(errors)}`);
}
await browser.close();
