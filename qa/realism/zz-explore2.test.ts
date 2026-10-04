import { it } from 'vitest';
import { renderRun, diagnose, synthPassage } from './fastnotes';
import { SINGERS, truthAt } from './singer';
import { shortNoteDev } from '../../src/game/scoring';
it('explore2', async () => {
  for (const [ly, lvl] of [['a', 4], ['ta', 2], [null, 4]] as const) {
    const p = synthPassage(144, 0.25, ly);
    const run = renderRun(p, SINGERS.goodChoir, lvl, 2);
    const d = diagnose(run);
    const take = run.take; const o = run.outcome;
    const lat = o.latencyUsedMs / 1000;
    console.log('=====', p.id, 'L', lvl, 'aligned', o.alignedMs, 'acc', o.result.accuracy);
    const rd = o.readings.map(r => ({ t: take.scoreTimeAtSample0 + (r.stampSec - lat) * take.rate, raw: r.rawMidi, m: r.midi, cl: r.clarity, tr: truthAt(take.truthMidi, r.stampSec), trc: truthAt(take.truthCentre, r.stampSec) }));
    let shown = 0;
    for (const n of d.notes) {
      if (n.reason === 'hit' || shown > 8) continue;
      shown++;
      const note = p.part.notes[n.index];
      const prev = p.part.notes[n.index - 1]; const next = p.part.notes[n.index + 1];
      const rn = take.notes.find(x => x.index === n.index)!;
      console.log(`#${n.index} midi ${note.midi} (prev ${prev?.midi} next ${next?.midi}) dur ${note.dur.toFixed(3)} grade ${n.grade} ${n.reason} judged ${n.judgedReadings} | sung ${(100*(rn.targetMidi-note.midi)).toFixed(0)}c vowel@${((rn.vowelSec - lat)*take.rate + take.scoreTimeAtSample0 - note.start).toFixed(3)} cmd@${((rn.cmdSec - lat)*take.rate + take.scoreTimeAtSample0 - note.start).toFixed(3)} cons ${rn.consonantSec==null?'-':((rn.consonantSec - lat)*take.rate + take.scoreTimeAtSample0 - note.start).toFixed(3)}`);
      for (const r of rd.filter(r => r.t >= note.start - 0.06 && r.t < note.start + note.dur + 0.06)) {
        const f = (x: number | null) => x == null || !Number.isFinite(x) ? '   .  ' : ((x - note.midi) * 100).toFixed(0).padStart(6);
        console.log(`   t${(r.t - note.start).toFixed(3).padStart(7)} raw${f(r.raw)} sm${f(r.m)} truth${f(r.tr)} centre${f(r.trc)} cl ${r.cl.toFixed(2)}`);
      }
    }
  }
});
