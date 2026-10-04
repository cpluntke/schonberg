// QA round 3 code review: timing / count-in / latency-learning probes.
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r3cr-timing --silent=false
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMusicXML } from '../../../src/music/musicxml';
import { computeSections } from '../../../src/music/sections';
import { beatSecAt } from '../../../src/audio/player';
import { entryDrill } from '../../../src/ui/excerpt';
import { makePart, makeScore, sampleSinging } from '../../../src/game/testutil';
import { scoreAttempt } from '../../../src/game/scoring';

describe('CR-03 count-in beat length in a pickup (anacrusis) bar', () => {
  it('warmup-chorale: count-in beat at section start vs real quarter', () => {
    const xml = readFileSync('public/pieces/warmup-chorale.musicxml', 'utf8');
    const score = parseMusicXML(xml);
    const m0 = score.measures[0];
    const bpm = score.tempos[0].bpm;
    const secs = computeSections(score);
    const rows = secs.map((s) => {
      const m = score.measures[s.startMeasure];
      return { id: s.id, label: s.label, startBar: m.number, barBeats: m.durBeats, ts: m.timeSig.join('/'), countInBeatSec: +beatSecAt(score, s.start).toFixed(3) };
    });
    console.log('CR-03', JSON.stringify({ bpm, quarterSec: 60 / bpm, m0: { number: m0.number, durBeats: m0.durBeats, ts: m0.timeSig }, sections: rows }));
    // A felt beat in 4/4 should be one quarter (60/bpm s). In the pickup bar it is a fraction of that.
    expect(beatSecAt(score, 0)).toBeCloseTo(60 / bpm, 3);
  });

  it('entry drill: count-in beat derived from (window+gap)/4, not the tempo', () => {
    const xml = readFileSync('public/pieces/warmup-chorale.musicxml', 'utf8');
    const score = parseMusicXML(xml);
    const part = score.parts.find((p) => p.notes.length)!;
    const d = entryDrill(score, part.id)!;
    const q = 60 / d.tempos[0].bpm;
    console.log('CR-03b', JSON.stringify(d.measures.slice(0, 4).map((m) => ({ dur: +m.dur.toFixed(3), beat: +beatSecAt(d, m.start).toFixed(3), quarter: +q.toFixed(3) }))));
  });
});

describe('CR-05 latency auto-learning ignores playback rate', () => {
  it('singer exactly on time, 200 ms un-compensated latency, L1 rate 0.7', () => {
    // entries after rests: note, rest, note, rest...
    const spec: [number | null, number][] = [];
    for (let i = 0; i < 8; i++) spec.push([62 + (i % 3), 1], [null, 1]);
    const part = makePart('S', spec, 60);
    const score = makeScore([part], 60);
    const rate = 0.7;
    const extraLatencySec = 0.2; // real seconds
    const scoreShift = extraLatencySec * rate; // what the samples are actually shifted by in score time
    const samples = sampleSinging(part, (n) => n.midi).map((s) => ({ ...s, time: s.time + scoreShift }));
    const ctx = { score, part, range: [0, part.notes.length - 1] as [number, number] };
    const opts = { toleranceCents: 50, tuning: 'equal' as const, octaveTolerant: false };
    const r = scoreAttempt(ctx, samples, opts);
    const onsets = r.notes.map((n) => n.onsetMs!).sort((a, b) => a - b);
    const med = onsets[Math.floor(onsets.length / 2)];
    // Play.tsx: latencyAdjusted = sess.latencyMs + (med - 40); shift = (adj - old)/1000 (applied in score s)
    const learnedDelta = med - 40;
    const correctDelta = extraLatencySec * 1000 - 40 / rate; // in real ms, same target of +40 score-ms
    console.log('CR-05', JSON.stringify({ medOnsetScoreMs: Math.round(med), learnedDeltaMs: Math.round(learnedDelta), correctRealDeltaMs: Math.round(correctDelta), rescoreShiftScoreSec: learnedDelta / 1000, rescoreShiftShouldBe: (learnedDelta / 1000) * rate, triggers: med > 120 }));
    expect(Math.abs(learnedDelta - correctDelta)).toBeLessThan(20);
  });
});

describe('CR-10 last note loses latency-worth of samples (playback ends at endCtx, mic lags)', () => {
  it('final 1.0 s note, 250 ms Bluetooth latency', () => {
    const part = makePart('S', [[62, 1], [64, 1], [65, 1], [67, 1]], 60);
    const score = makeScore([part], 60);
    const ctx = { score, part, range: [0, 3] as [number, number] };
    const opts = { toleranceCents: 30, tuning: 'equal' as const, octaveTolerant: false };
    const all = sampleSinging(part, (n) => n.midi);
    const end = 4;
    const full = scoreAttempt(ctx, all, opts);
    const cut = scoreAttempt(ctx, all.filter((s) => s.time <= end - 0.25), opts);
    console.log('CR-10', JSON.stringify({ full: full.notes.map((n) => n.grade), cut: cut.notes.map((n) => [n.grade, +n.hitRatio.toFixed(2)]), accFull: full.accuracy, accCut: cut.accuracy }));
    expect(cut.notes[3].grade).toBe(full.notes[3].grade);
  });
});
