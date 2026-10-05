// Wide vibrato at level 1 (report section 9): a vibrato centred on every note must not fail the
// every-note rule, and singers on wrong notes must not get through at any level (vibrato.ts).
import { expect, it } from 'vitest';
import { writePart } from './compare';
import { VIB_SINGERS, VIB_WRONG, vibratoExperiment } from './vibrato';

it('wide vibrato at level 1, and wrong notes at every level', async () => {
  const good = await vibratoExperiment(VIB_SINGERS, [1]);
  const wrong = await vibratoExperiment(VIB_WRONG, [1, 2, 3, 4, 5]);
  writePart('vibrato', { baseRef: good.baseRef, good: good.rows, wrong: wrong.rows });
  // Up to ±80¢ every section passes; wider vibratos pass at least as often as before.
  for (const r of good.rows) {
    if (/±(60|70|80)¢/.test(r.singer)) expect.soft(r.after, `${r.singer}: sections passed`).toBe(r.sections);
    if (!Number.isNaN(r.before)) expect.soft(r.after, `${r.singer}: no harder than before`).toBeGreaterThanOrEqual(r.before);
  }
  for (const r of wrong.rows) {
    if (!Number.isNaN(r.before)) expect.soft(r.after, `${r.singer} L${r.level}: no easier than before`).toBeLessThanOrEqual(r.before);
    // Level 1: any section with a wrong note fails. (Levels 2–5 judge by percentage: a section with
    // one wrong note in five passes there by design; they only must not get easier.)
    // The one exception at level 1: a single wrong note so short that its own readings can't judge
    // it (a 32nd in Nicolette's bass, 0.13 s at 70%) is forgiven like any very short note.
    if (r.level === 1 && /one note/.test(r.singer)) expect.soft(r.after, `${r.singer} L1: sections passed`).toBeLessThanOrEqual(1);
    else if (r.level === 1 || /all a semitone|octave/.test(r.singer)) expect.soft(r.after, `${r.singer} L${r.level}: sections passed`).toBe(0);
  }
});
