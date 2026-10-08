// Before/after: bad and adversarial singers, and the TRANSITION_MAX sweep. Guards are checked here.
import { expect, it } from 'vitest';
import { writePart } from './compare';
import { sanity, transitionSweep } from './cmp-experiments';
import { SINGERS } from './singer';

it('sanity and adversarial singers (before vs after)', async () => {
  const rows = await sanity();
  writePart('sanity', rows);
  // The current app must fail these (flat −40¢ at L1 is inside ±50¢ by design and is not checked).
  const bad: string[] = [];
  for (const r of rows) {
    const after = r.chains.find((c) => c.label === 'after')!;
    after.runs.forEach((x, k) => {
      void k;
      const mustFail =
        r.singer === SINGERS.wrongNotes.name || r.singer === SINGERS.oneBehind.name ||
        // Singing a quarter of each note and hissing (or the backing) through the rest is never enough.
        r.singer.startsWith(SINGERS.fragmentsHiss.name) ||
        // Late with a hiss from each beat (a consonant can't hide 300 ms): as the echo singer.
        (r.singer === SINGERS.lateHiss.name && r.level >= 2 && r.latency.startsWith('measured')) ||
        (r.singer === SINGERS.flat40.name && r.level >= 2) ||
        // The echo singer must not pass L2+ when the delay is measured (a learned delay can't tell
        // device delay from late singing, so passing there is by design).
        (r.singer === SINGERS.echo300.name && r.level >= 2 && r.latency.startsWith('measured'));
      if (mustFail && x.passed) bad.push(`${r.singer} ${r.target} L${r.level} ${r.latency} run ${k + 1}`);
    });
  }
  writePart('sanity-violations', bad);
  expect.soft(bad).toEqual([]);
});

it('TRANSITION_MAX sweep', async () => {
  writePart('tm', await transitionSweep());
});
