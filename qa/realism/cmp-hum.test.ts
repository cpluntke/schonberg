// Microphone trouble: the real run with mains hum (qa/fixtures/hum-run.wav, a bass singing C#4 while
// the tracker read F#2 and C#3) and synthetic takes with the same kind of hum and distortion, before
// (the tracker as it was: no input filters, no harmonic check) and after. Report section 10.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { scoreRecordingApp, type Sidecar } from './harness';
import { AFTER, measured, noteDueAt, runSession, type PipelineSpec, type RunSetup, type SessionOutcome } from './pipeline';
import { PITCH_NO_CHECK } from './tracker';
import { loadPiece, noteRangeFor, REPO_ROOT } from './scores';
import { SINGERS, onDoo, renderSinger, truthAt, CHANNELS, type SingerProfile } from './singer';
import { addHum, HUM_TROUBLE, HUM_ONLY, type HumChannel } from './humchannel';
import { levelSetup } from './harness';
import { writePart } from './compare';
import { gitVariant } from './variants';
import { offlineQuality, rawBlocks } from './quality';
import { wrongNotes } from '../../src/progress/ladder';
import type { Part } from '../../src/music/types';

const FIX = resolve(REPO_ROOT, 'qa/fixtures');
declare const process: { env: Record<string, string | undefined> };
/** The app before the microphone work (tracker, scorer and line-up as committed there). */
export const MIC_BASE_REF = process.env.MIC_BASE_REF ?? 'c04ca36';
let beforeSpec: PipelineSpec | null = null;
/** Before: the scorer and tracker at MIC_BASE_REF (McLeod's reading as it is, no input filters, no hint). */
async function before(): Promise<PipelineSpec> {
  if (!beforeSpec) {
    const v = await gitVariant(MIC_BASE_REF);
    beforeSpec = { ...AFTER, impl: v.impl, pitch: v.pitch, pitchKey: v.key, noInputFilter: true, noHint: true };
  }
  return beforeSpec;
}
/** The current scorer with the old tracker: what the input filters and the harmonic check alone change. */
const OLD_TRACKER: PipelineSpec = { ...AFTER, pitch: PITCH_NO_CHECK, pitchKey: 'nocheck', noInputFilter: true, noHint: true };

interface Row {
  label: string;
  /** Voiced readings within ±50¢ of the target (written note, or the sung pitch for synthetic takes), and at ⅓ / ½ of it. */
  atPitch: number; third: number; half: number; voiced: number;
  letter: string; accuracy: number; passed: boolean; counts: Record<string, number>;
  wrong: number; mic: number; problems?: string[];
}

function share(o: SessionOutcome, target: (sec: number, scoreTime: number) => number | null): Pick<Row, 'atPitch' | 'third' | 'half' | 'voiced'> {
  let n = 0, at = 0, third = 0, half = 0;
  for (const s of o.samples) {
    if (s.midi == null) continue;
    const t = target(NaN, s.time);
    if (t == null || !Number.isFinite(t)) continue;
    n++;
    const d = s.midi - t;
    if (Math.abs(d) <= 0.5) at++;
    else if (Math.abs(d + 19) <= 0.5) third++;
    else if (Math.abs(d + 12) <= 0.5) half++;
  }
  return { atPitch: at / Math.max(1, n), third: third / Math.max(1, n), half: half / Math.max(1, n), voiced: n };
}

function row(label: string, o: SessionOutcome, target: (sec: number, scoreTime: number) => number | null, problems?: string[]): Row {
  const r = o.result;
  return {
    label, ...share(o, target), letter: o.letter, accuracy: r.accuracy, passed: o.passed, counts: r.counts,
    wrong: wrongNotes(r).length, mic: r.notes.filter((n) => n.unsure === 'mic').length, ...(problems ? { problems } : {}),
  };
}

const rows: { fixture: Row[]; synthetic: Row[]; quality: Record<string, unknown> } = { fixture: [], synthetic: [], quality: {} };

it('the real run with hum: before vs after', async () => {
  const wav = resolve(FIX, 'hum-run.wav');
  const sc: Sidecar = JSON.parse(readFileSync(resolve(FIX, 'hum-run.json'), 'utf8'));
  const piece = await loadPiece(sc.pieceId);
  const part = piece.score.parts.find((p) => p.id === sc.partId)!;
  const written = (_: number, t: number) => noteDueAt(part, t);
  const b = await scoreRecordingApp(wav, sc, await before());
  const old = await scoreRecordingApp(wav, sc, OLD_TRACKER);
  const filterOnly = await scoreRecordingApp(wav, sc, { ...OLD_TRACKER, noInputFilter: false });
  const checkOnly = await scoreRecordingApp(wav, sc, { ...AFTER, noInputFilter: true });
  const after = await scoreRecordingApp(wav, sc, AFTER);
  // The input-quality summary the app stores with the run.
  const buf = readFileSync(wav);
  const { readWav } = await import('./wav');
  const pcm = readWav(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)).pcm;
  const blocks = rawBlocks(pcm, sc.sampleRate);
  const { inputPlanFor } = await import('./pipeline');
  const take = { pcm, sampleRate: sc.sampleRate, scoreTimeAtSample0: sc.scoreTimeAtSample0, rate: sc.rate } as never;
  const plan = inputPlanFor(take, part, noteRangeFor(part, sc.from, sc.to)!, sc.octaveTolerant);
  const due = (rec: number) => noteDueAt(part, sc.scoreTimeAtSample0 + (rec - sc.latencyMs / 1000) * sc.rate);
  const q = offlineQuality(after.readings, blocks, due, plan);
  rows.quality = q as unknown as Record<string, unknown>;
  rows.fixture.push(
    row(`before (${MIC_BASE_REF})`, b, written), row('old tracker, new scoring', old, written), row('+ input filters only', filterOnly, written),
    row('+ harmonic check only', checkOnly, written), row('after', after, written, q.problems),
  );
  writePart('hum', rows);

  // The tracker: from mostly F#2 / C#3 to the C#4 that was sung.
  const [rb, , , , ra] = rows.fixture;
  expect(rb.atPitch).toBeLessThan(0.4);
  expect(ra.atPitch).toBeGreaterThan(0.85);
  expect(ra.third).toBeLessThan(0.05);
  // Found: hum at ~59 Hz (notched) and distortion; the clipping (a few ms) is too little to mention.
  expect(q.hum?.hz).toBeCloseTo(58.7, 0);
  expect(plan.notches.length).toBe(1);
  expect(q.problems).toEqual(expect.arrayContaining(['hum', 'distortion']));
  expect(q.problems).not.toContain('clipping');
  // Level 1: no note is blamed on the singer; what the tracker couldn't hear is mic trouble.
  expect(rb.wrong).toBeGreaterThan(0);
  expect(ra.wrong).toBe(0);
  expect(ra.mic).toBeGreaterThan(0);
  expect(ra.accuracy).toBeGreaterThanOrEqual(rb.accuracy);
});

/** A take of the same passage (Vierne Kyrie, bass, bars of the real run) by a synthetic singer. */
async function take(singer: SingerProfile, shift: number, hum: HumChannel | null, seed: number): Promise<{ setup: RunSetup; sungTruth: (t: number) => number }> {
  const piece = await loadPiece('vierne-kyrie');
  const part: Part = piece.score.parts.find((p) => p.id === 'P4')!;
  const from = 255, to = 282;
  const range = noteRangeFor(part, from, to)!;
  const L = levelSetup(1);
  const sung = shift ? { ...part, notes: part.notes.map((n) => ({ ...n, midi: n.midi + shift })) } : part;
  const t = renderSinger({
    score: piece.score, part: sung, range, from, to, rate: L.rate, trueLatencyMs: 150, assumedLatencyMs: 450, guide: true,
    profile: singer, channel: { ...CHANNELS.phoneHeadphones, micHpfHz: 60, voiceRms: 0.12 }, performanceSeed: seed, microSeed: seed,
  });
  if (hum) t.pcm = addHum(t.pcm, t.sampleRate, hum, seed);
  const setup: RunSetup = { take: t, part, ctx: { score: piece.score, part, range, end: to }, from, to, level: 1, microSeed: seed };
  return { setup, sungTruth: (sec) => truthAt(t.truthMidi, sec) };
}

it('synthetic hum and distortion: honest, wrong-note, F#2 and octave-low singers', async () => {
  const good = onDoo(SINGERS.goodChoir);
  const cases: { label: string; singer: SingerProfile; shift: number; hum: HumChannel | null; expectPass: boolean | null }[] = [
    { label: 'good, clean mic', singer: good, shift: 0, hum: null, expectPass: true },
    { label: 'good, hum only', singer: good, shift: 0, hum: HUM_ONLY, expectPass: true },
    { label: 'good, hum + distortion', singer: good, shift: 0, hum: HUM_TROUBLE, expectPass: null },
    { label: '2 wrong notes, hum + distortion', singer: { ...good, wrongCount: 2 }, shift: 0, hum: HUM_TROUBLE, expectPass: false },
    { label: 'sings F#2 (19 st low), hum + distortion', singer: good, shift: -19, hum: HUM_TROUBLE, expectPass: false },
    { label: 'sings an octave low, hum + distortion', singer: good, shift: -12, hum: HUM_TROUBLE, expectPass: false },
  ];
  for (const c of cases) {
    for (const seed of [1, 2]) {
      const { setup, sungTruth } = await take(c.singer, c.shift, c.hum, seed);
      // Readings are compared with what was sung (ground truth at the reading's moment).
      const s0 = setup.take.scoreTimeAtSample0;
      const truthAtScore = (_: number, t: number) => { const v = sungTruth((t - s0) / setup.take.rate + 0.15); return Number.isFinite(v) ? v : null; };
      const b = runSession(await before(), setup, measured(150));
      const a = runSession(AFTER, setup, measured(150));
      const rb = row(`${c.label} s${seed} before`, b, truthAtScore);
      const ra = row(`${c.label} s${seed} after`, a, truthAtScore);
      rows.synthetic.push(rb, ra);
      // What was sung is what is read (also an F#2 or an octave low)…
      expect(ra.atPitch, ra.label).toBeGreaterThan(0.9);
      if (c.expectPass != null) expect(ra.passed, ra.label).toBe(c.expectPass);
      // …a wrong note stays wrong, never "mic trouble"…
      if (c.expectPass === false) expect(ra.wrong, ra.label).toBeGreaterThan(0);
      if (c.singer.wrongCount) {
        const wrongIdx = new Set(setup.take.notes.filter((n) => n.wrong).map((n) => n.index));
        for (const n of a.result.notes) if (wrongIdx.has(n.index)) expect(n.unsure, `${ra.label} note ${n.index}`).not.toBe('mic');
      }
      // …and a clean take is untouched.
      if (!c.hum) {
        expect(ra.accuracy, ra.label).toBeCloseTo(rb.accuracy, 2);
        expect(ra.letter).toBe(rb.letter);
      }
    }
  }
  writePart('hum', rows);
});
