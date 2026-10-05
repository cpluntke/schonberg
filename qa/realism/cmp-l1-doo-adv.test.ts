// Level 1 on "doo": fast bars (good singer) and singers with wrong notes (report section 8).
// Guards: the good singer passes the fast bars on doo; a single wrong note (a semitone), one note
// an octave low, 40% wrong notes and one note behind always fail (headphones). On the phone speaker
// (the guide bleeding into the mic) the same singers are reported, not guarded: there the tracker
// can read a note sung an octave low two octaves under the written note, which the end-of-run ×¼
// correction moves back onto it (see observations).
import { expect, it } from 'vitest';
import { writePart } from './compare';
import { OCTAVE_LOW, SPEAKER, l1Adversarial, l1Fast } from './l1doo';
import { SINGERS } from './singer';

it('level 1 on doo: fast bars and wrong notes', async () => {
  const fast = await l1Fast(3);
  const adversarial = await l1Adversarial(2);
  const speaker = await l1Adversarial(2, { channel: SPEAKER, singers: [{ ...SINGERS.goodChoir, name: 'one wrong note (a semitone, random)', wrongCount: 1 }, OCTAVE_LOW] });
  writePart('l1-doo-adv', { fast, adversarial: [...adversarial, ...speaker] });
  for (const c of fast.filter((x) => x.doo)) expect.soft(c.passes / c.runs, `${c.singer} on doo`).toBeGreaterThanOrEqual(0.9);
  const mustFail = /wrong notes|one note behind|one wrong note|a semitone flat|an octave low/;
  const bad = adversarial.filter((r) => mustFail.test(r.singer) && r.passed).map((r) => `${r.singer} ${r.target}`);
  expect.soft(bad).toEqual([]);
});
