// Fast notes, before (git FAST_BASE_REF) vs after (working tree), on the same renders. Guards:
// a good singer's fast notes are no longer lost, and singers on the wrong notes still fail.
import { expect, it } from 'vitest';
import { writePart } from './compare';
import { fastExperiment, type FastRun } from './fastnotes';
import { levelSetup } from './harness';
import { SINGERS } from './singer';

const misses = (r: FastRun) => r.fast.ok + r.fast.miss;
const total = (r: FastRun) => r.fast.perfect + r.fast.good + r.fast.ok + r.fast.miss;

it('fast notes (before vs after)', async () => {
  const rep = await fastExperiment();
  writePart('fast', rep);
  expect(rep.mismatches).toBe(0); // the diagnosis replays exactly what the app scored

  // Good singer: fast notes (< 0.15 s) at L2 and L4 are rarely lost, and less often than before.
  for (const level of [2, 4]) {
    const rows = rep.good.filter((r) => r.level === level);
    const n = rows.reduce((s, r) => s + total(r.after), 0);
    const after = rows.reduce((s, r) => s + misses(r.after), 0) / n;
    // (before the fix: 7.2 % at L2 and 11.7 % at L4; after: 3.5 % and 6.8 %)
    expect.soft(after, `good singer L${level}: share of fast notes lost`).toBeLessThan(level === 2 ? 0.045 : 0.075);
    if (rep.baseRef) {
      const before = rows.reduce((s, r) => s + misses(r.before!), 0) / n;
      expect.soft(after, `good singer L${level}: fewer fast notes lost than before`).toBeLessThan(before);
    }
  }
  // ...and passes the pieces' fast bars at every level.
  for (const r of rep.good.filter((x) => !x.passage.startsWith('synth'))) expect.soft(r.after.passed, `good singer ${r.passage} L${r.level}`).toBe(true);

  // Singers on the wrong notes still fail.
  for (const r of rep.adversarial) {
    const pass = levelSetup(r.level).pass;
    const label = `${r.singer} ${r.passage} L${r.level}`;
    if (r.singer === SINGERS.wrongNotes.name) expect.soft(r.after.passed, label).toBe(false);
    if (r.singer === SINGERS.flat40.name && r.level >= 2) expect.soft(r.after.passed, label).toBe(false);
    if (r.singer === SINGERS.oneBehind.name) {
      // Neither the scorer (the live view / unshifted run) nor the end-of-run line-up accepts it:
      // with a measured delay, nothing is shifted when the voice lines up about a note late or early
      // (align.ts).
      expect.soft(r.after.plainAcc, label).toBeLessThan(pass);
      expect.soft(r.after.passed, label).toBe(false);
    }
  }
});
