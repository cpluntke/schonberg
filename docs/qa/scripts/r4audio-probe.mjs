// R4 audio e2e: list parts / sections of the target pieces via the app's own (Vite-served) modules.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:5179/#/');
await page.waitForTimeout(2500);
const info = await page.evaluate(async () => {
  const lib = await import('/src/ui/library.ts');
  await lib.ensureLoaded();
  const out = {};
  for (const id of ['warmup-chorale', 'debussy-dieu']) {
    const p = lib.getPiece(id);
    out[id] = {
      timeSigs: [...new Set(p.score.measures.map((m) => m.timeSig.join('/')))], tempos: p.score.tempos,
      parts: p.score.parts.map((x) => ({ id: x.id, name: x.name, voiceType: x.voiceType, n: x.notes.length, lo: Math.min(...x.notes.map((n) => n.midi)), hi: Math.max(...x.notes.map((n) => n.midi)) })),
      sections: p.sections.map((s) => ({ id: s.id, label: s.label, start: +s.start.toFixed(2), end: +s.end.toFixed(2) })),
    };
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
