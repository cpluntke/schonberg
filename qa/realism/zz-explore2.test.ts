import { it } from 'vitest';
import { renderRun, diagnose, synthPassage } from './fastnotes';
import { SINGERS, truthAt } from './singer';
import { LiveScorer, judgedSpan } from '../../src/game/scoring';
import { afterScorerView } from './pipeline';
it('explore2', async () => {
  for (const ly of ['ta', 'a'] as const) {
    const p = synthPassage(144, 0.25, ly);
    const run = renderRun(p, SINGERS.goodChoir, 4, 1);
    const d = diagnose(run);
    const take = run.take; const o = run.outcome;
    const lat = o.latencyUsedMs / 1000;
    console.log('=====', p.id, 'aligned', o.alignedMs);
    // print readings with truth
    const rd = o.readings.map(r => ({ t: take.scoreTimeAtSample0 + (r.stampSec - lat) * take.rate, raw: r.rawMidi, m: r.midi, cl: r.clarity, tr: truthAt(take.truthMidi, r.stampSec) }));
    let shown = 0;
    for (const n of d.notes) {
      if (n.reason === 'hit' || shown > 14) continue;
      shown++;
      const note = p.part.notes[n.index];
      const prev = p.part.notes[n.index - 1]; const next = p.part.notes[n.index + 1];
      const rn = take.notes.find(x => x.index === n.index)!;
      console.log(`#${n.index} midi ${note.midi} (prev ${prev?.midi} next ${next?.midi}) start ${note.start.toFixed(3)} dur ${note.dur.toFixed(3)} grade ${n.grade} ${n.reason} body ${n.bodyReadings} judged ${n.judgedReadings} | sung ${(100*(rn.targetMidi-note.midi)).toFixed(0)}c vowel@${((rn.vowelSec - lat)*take.rate + take.scoreTimeAtSample0 - note.start).toFixed(3)} cons ${rn.consonantSec==null?'-':((rn.consonantSec - lat)*take.rate + take.scoreTimeAtSample0 - note.start).toFixed(3)}`);
      for (const r of rd.filter(r => r.t >= note.start - 0.06 && r.t < note.start + note.dur + 0.06)) {
        const f = (x: number | null) => x == null || !Number.isFinite(x) ? '   .  ' : ((x - note.midi) * 100).toFixed(0).padStart(6);
        console.log(`   t${(r.t - note.start).toFixed(3).padStart(7)} raw${f(r.raw)} sm${f(r.m)} truth${f(r.tr)} cl ${r.cl.toFixed(2)}`);
      }
    }
  }
});
