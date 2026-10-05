// Level 1 on "doo": fast bars (good singer) and singers with wrong notes (report section 8).
// Guards: the good singer passes the fast bars on doo; a single wrong note (a semitone), 40% wrong
// notes and one note behind always fail.
import { expect, it } from 'vitest';
import { writePart } from './compare';
import { l1Adversarial, l1Fast } from './l1doo';

it('level 1 on doo: fast bars and wrong notes', async () => {
  const fast = await l1Fast(3);
  const adversarial = await l1Adversarial(2);
  writePart('l1-doo-adv', { fast, adversarial });
  for (const c of fast.filter((x) => x.doo)) expect.soft(c.passes / c.runs, `${c.singer} on doo`).toBeGreaterThanOrEqual(0.9);
  const mustFail = /wrong notes|one note behind|one wrong note|a semitone flat/;
  const bad = adversarial.filter((r) => mustFail.test(r.singer) && r.passed).map((r) => `${r.singer} ${r.target}`);
  expect.soft(bad).toEqual([]);
});
