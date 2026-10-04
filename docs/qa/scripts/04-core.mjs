import { launch, BASE, shot, sleep } from './lib.mjs';
import { setProfile, playFromPiece } from './playlib.mjs';
const { browser, page, errors } = await launch();
await setProfile(page);
const runs = [
  { sim: 'perfect', pieceId: 'bach-bwv512', part: 0, sec: 0, level: 0, tag: '04-bach-L0' },
  { sim: 'perfect', pieceId: 'bach-bwv512', part: 0, sec: 0, level: 1, tag: '04-bach-L1-perfect' },
  { sim: 'perfect', pieceId: 'bach-bwv512', part: 0, sec: 0, level: 2, tag: '04-bach-L2-perfect' },
  { sim: 'perfect', pieceId: 'bach-bwv512', part: 0, sec: 0, level: 3, tag: '04-bach-L3-perfect' },
  { sim: 'perfect', pieceId: 'bach-bwv512', part: 0, sec: 0, level: 4, tag: '04-bach-L4-perfect' },
  { sim: 'flat', pieceId: 'bach-bwv512', part: 3, sec: 1, level: 1, tag: '04-bach-bass-L1-flat' },
  { sim: 'sloppy', pieceId: 'debussy-dieu', part: 1, sec: 0, level: 1, tag: '04-debussy-alto-L1-sloppy' },
  { sim: 'perfect', pieceId: 'ravel-nicolette', part: 2, sec: 1, level: 1, tag: '04-ravel-tenor-L1-perfect' },
  { sim: 'perfect', pieceId: 'brahms-schaffe', part: 4, sec: 0, level: 1, tag: '04-brahms-bass2-L1-perfect' },
];
for (const r of runs) {
  errors.length = 0;
  const res = await playFromPiece(page, r);
  console.log(`\n### ${r.tag} -> ${res.hash} in ${res.secs}s\n${res.text.replace(/\n+/g,' | ').slice(0, 700)}\nERR ${JSON.stringify(errors)}`);
}
await page.goto(BASE + '#/piece/bach-bwv512'); await sleep(1200); await shot(page, '04-bach-piece-after');
console.log('\nPIECE', (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 900));
await page.goto(BASE + '#/'); await sleep(1200); await shot(page, '04-home-after');
console.log('\nHOME', (await page.innerText('main')).replace(/\n+/g,' | ').slice(0, 900));
await browser.close();
