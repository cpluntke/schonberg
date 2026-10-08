// Turns per-note results into at most three plain-language coaching insights.

import type { Score, ScoreNote } from '../music/types';
import { barRangeLabel } from '../music/sections';
import type { Grade, Insight, NoteResult, PitchSample } from './types';
import type { ScoringContext } from './scoring';

const GRADE_VALUE: Record<Grade, number> = { perfect: 1, good: 0.85, ok: 0.5, miss: 0 };

const LONG_NOTE_SEC = 1.2;
const DRIFT_CENTS = 15;
const ENTRY_REST_SEC = 0.5;
/** A consonant this long (ms) sung on the beat (starting within CONS_ON_BEAT_MS of it) counts for the tip. */
const CONS_TIP_MS = 120;
const CONS_ON_BEAT_MS = 80;
/** Shorter "consonants" (a stop's burst: t, k, p) don't count as consonants for the tip's share. */
const CONS_REAL_MS = 60;
const LATE_MS = 180;
const LEAP_SEMITONES = 5;

interface Candidate extends Insight {
  /** Tie-break inside a severity level (bigger = more important). */
  weight: number;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** "bar 12" / "bars 12–14" ("upbeat–bar 3" from a pickup bar 0, as the sections are named) */
export function barsText(score: Score, range: [number, number]): string {
  return barRangeLabel(score, range[0], range[1], true);
}

/**
 * "bars 3, 7 and 12" (deduplicated, at most `max` listed). A pickup bar numbered 0 is "the upbeat",
 * as in the section names and the bar strip (barRangeLabel): "the upbeat and bars 1 and 2".
 */
export function barList(score: Score, measures: number[], max = 4): string {
  const uniq = [...new Set(measures)].sort((a, b) => a - b);
  const more = uniq.length > max ? ' and elsewhere' : '';
  const shownIdx = uniq.slice(0, max);
  const upbeat = shownIdx[0] === 0 && barRangeLabel(score, 0, 0) === 'Upbeat';
  const rest = (upbeat ? shownIdx.slice(1) : shownIdx).map((m) => barRangeLabel(score, m, m, true).replace(/^bar /, ''));
  const join = (xs: string[]) => (xs.length > 1 && !more ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(', '));
  const bars = rest.length ? `${rest.length === 1 ? 'bar' : 'bars'} ${join(rest)}` : '';
  if (!upbeat) return `${bars}${more}`;
  return `${bars ? `the upbeat and ${bars}` : 'the upbeat'}${more}`;
}

/**
 * Worst contiguous window of 2–4 measures given a badness per measure.
 * `bounds` = inclusive measure range the window must stay in.
 */
export function worstWindow(badness: Map<number, number>, bounds: [number, number]): [number, number] {
  const [lo, hi] = bounds;
  if (hi <= lo) return [lo, hi];
  let best: [number, number] = [lo, Math.min(hi, lo + 1)];
  let bestSum = -1;
  for (let a = lo; a <= hi; a++) {
    let sum = 0;
    for (let b = a; b <= Math.min(hi, a + 3); b++) {
      sum += badness.get(b) ?? 0;
      if (sum > bestSum + 1e-9) { bestSum = sum; best = [a, b]; }
    }
  }
  // Trim edges without badness, then ensure at least two bars.
  let [a, b] = best;
  while (a < b && !(badness.get(a) ?? 0)) a++;
  while (b > a && !(badness.get(b) ?? 0)) b--;
  if (b === a) {
    if (b < hi) b++;
    else if (a > lo) a--;
  }
  return [a, b];
}

function addTo(map: Map<number, number>, k: number, v: number) {
  map.set(k, (map.get(k) ?? 0) + v);
}

/**
 * Analyze one attempt. `samples` (optional) enables early-entry detection, which needs the pitch
 * sung before the written start of a note.
 */
/** Median onset (ms, incl. detection lag and consonant) above which a run counts as behind the beat. */
export const BEHIND_MS = 180;

export function analyze(ctx: ScoringContext, notes: NoteResult[], samples?: PitchSample[]): Insight[] {
  const { score, part } = ctx;
  if (!notes.length) return [];
  const pn = part.notes;
  const noteOf = (r: NoteResult): ScoreNote => pn[r.index];
  const firstM = noteOf(notes[0]).measure;
  const lastM = noteOf(notes[notes.length - 1]).measure;
  const bounds: [number, number] = [Math.min(firstM, lastM), Math.max(firstM, lastM)];
  const window = (bad: Map<number, number>) => worstWindow(bad, bounds);
  const out: Candidate[] = [];

  // Scooped notes have a biased median (the glide); judge intonation on the others.
  const sungNotes = notes.filter((n) => n.cents !== null && !n.octave && Math.abs(n.cents) < 100 && n.scoop === null);

  // 1. Overall flat / sharp tendency.
  const overall = median(sungNotes.map((n) => n.cents!));
  if (overall !== null && sungNotes.length >= 3 && Math.abs(overall) > 12) {
    const flat = overall < 0;
    const bad = new Map<number, number>();
    for (const n of sungNotes) {
      const c = n.cents!;
      if (flat ? c < -12 : c > 12) addTo(bad, noteOf(n).measure, Math.abs(c));
    }
    const m = window(bad);
    const c = Math.round(Math.abs(overall));
    out.push({
      kind: flat ? 'flat-overall' : 'sharp-overall',
      title: flat ? 'You tend to sing flat' : 'You tend to sing sharp',
      detail: flat
        ? `Overall you sat about ${c} cents under the pitch, most clearly in ${barsText(score, m)}. Keep the sound bright and the breath moving; think each note slightly higher than you feel it.`
        : `Overall you sat about ${c} cents above the pitch, most clearly in ${barsText(score, m)}. Release tension in the throat and let the notes settle rather than pushing them up.`,
      measures: m,
      severity: Math.abs(overall) > 25 ? 3 : Math.abs(overall) > 20 ? 2 : 1,
      weight: Math.abs(overall) * 2,
    });
  }

  // 2. Sagging / rising on long notes.
  const longNotes = notes.filter((n) => noteOf(n).dur >= LONG_NOTE_SEC && n.drift !== null);
  for (const dir of [-1, 1] as const) {
    const drifting = longNotes.filter((n) => dir * n.drift! >= DRIFT_CENTS);
    if (!drifting.length || drifting.length < Math.max(1, 0.3 * longNotes.length)) continue;
    const bad = new Map<number, number>();
    for (const n of drifting) addTo(bad, noteOf(n).measure, Math.abs(n.drift!));
    const m = window(bad);
    const amount = Math.round(mean(drifting.map((n) => Math.abs(n.drift!))));
    const where = barList(score, drifting.map((n) => noteOf(n).measure));
    out.push({
      kind: dir < 0 ? 'flat-long-notes' : 'sharp-long-notes',
      title: dir < 0 ? 'Long notes sink' : 'Long notes creep up',
      detail: dir < 0
        ? `On the held notes in ${where} the pitch drops by about ${amount} cents by the end. Keep the breath support going right to the end of the note and think the line onward.`
        : `On the held notes in ${where} the pitch rises by about ${amount} cents. Keep the sound relaxed and steady instead of pushing through the note.`,
      measures: m,
      severity: amount >= 30 || drifting.length >= 3 ? 2 : 1,
      weight: amount * drifting.length,
    });
  }

  // Both "sink" and "creep" at once is noise (wide vibrato), not a tendency: drop both.
  if (out.some((c) => c.kind === 'flat-long-notes') && out.some((c) => c.kind === 'sharp-long-notes')) {
    for (let i = out.length - 1; i >= 0; i--) if (out[i].kind === 'flat-long-notes' || out[i].kind === 'sharp-long-notes') out.splice(i, 1);
  }

  // 3. Entries after rests: late (onset) and early (voiced before the written start).
  const entries = notes.filter((n) => {
    const i = n.index;
    if (i === 0) return true;
    const prev = pn[i - 1];
    return pn[i].start - (prev.start + prev.dur) >= ENTRY_REST_SEC - 1e-6;
  });
  if (entries.length) {
    const withOnset = entries.filter((n) => n.onsetMs !== null);
    const lateOnes = withOnset.filter((n) => n.onsetMs! > LATE_MS);
    const meanOnset = mean(withOnset.map((n) => n.onsetMs!));
    if (withOnset.length && meanOnset > LATE_MS && lateOnes.length) {
      const bad = new Map<number, number>();
      for (const n of lateOnes) addTo(bad, noteOf(n).measure, n.onsetMs!);
      const m = window(bad);
      out.push({
        kind: 'late-entries',
        title: 'Late after rests',
        detail: `Your entries came in about ${Math.round(meanOnset)} ms late on average (${barList(score, lateOnes.map((n) => noteOf(n).measure))}). Breathe in tempo during the rest and hear your first note before you sing it.`,
        measures: m,
        severity: meanOnset > 350 ? 3 : 2,
        weight: meanOnset / 10,
      });
    }
    if (samples && samples.length) {
      const sorted = [...samples].sort((a, b) => a.time - b.time);
      const early = entries.filter((n) => sungEarly(n.index, sorted, ctx));
      if (early.length && early.length >= Math.max(1, 0.4 * entries.length)) {
        const bad = new Map<number, number>();
        for (const n of early) addTo(bad, noteOf(n).measure, 1);
        const m = window(bad);
        out.push({
          kind: 'early-entries',
          title: 'Coming in early',
          detail: `You started before the beat at ${barList(score, early.map((n) => noteOf(n).measure))}. Count the rest through and let the conductor's (or the click's) beat place your entry.`,
          measures: m,
          severity: 2,
          weight: early.length * 10,
        });
      }
    }
  }

  // 3a. Consonants sung on the beat (an s or sh heard running into the vowel, see NoteResult.consonantMs):
  // counted as on time, but the vowel lands late; the choir habit is the consonant just before the beat.
  {
    const onBeat = notes.filter((n) => (n.consonantMs ?? 0) >= CONS_TIP_MS && n.onsetMs !== null && n.onsetMs <= CONS_ON_BEAT_MS);
    const withCons = notes.filter((n) => (n.consonantMs ?? 0) >= CONS_REAL_MS);
    if (onBeat.length >= 3 && onBeat.length >= 0.4 * withCons.length) {
      const bad = new Map<number, number>();
      for (const n of onBeat) addTo(bad, noteOf(n).measure, 1);
      const ms = Math.round(mean(onBeat.map((n) => n.consonantMs!)) / 10) * 10;
      out.push({
        kind: 'consonant-on-beat',
        title: 'Consonants on the beat',
        detail: `Your s/sh landed on the beat (${barList(score, onBeat.map((n) => noteOf(n).measure))}), so the vowel came about ${ms} ms later. It counts as on time, but try placing the consonant just before the beat, so the vowel sits on it, as the choir will.`,
        measures: window(bad),
        severity: 1,
        weight: onBeat.length * 3,
      });
    }
  }

  // 3b. Consistently behind the beat on every note (not just entries): usually an uncalibrated
  // headphone delay, or dragging. Onsets include ~50 ms of natural detection lag.
  // Scooped notes start "late" because the pitch arrives late, not the voice: leave them out.
  // Repeated pitches carry no timing information (the voice is already there): leave them out too.
  const timed = (n: NoteResult) => {
    const prev = n.index > 0 ? pn[n.index - 1] : null;
    return n.onsetMs !== null && n.scoop === null && !(prev && prev.midi === pn[n.index].midi && pn[n.index].start - (prev.start + prev.dur) < 1.0);
  };
  const onsets = notes.filter(timed).map((n) => n.onsetMs!);
  const medOnset = median(onsets);
  // An on-time singer measures ~50 ms (detection lag) + up to ~80 ms (consonant before the vowel):
  // only flag clearly later than that.
  if (onsets.length >= 4 && medOnset !== null && medOnset > BEHIND_MS) {
    const lateNotes = notes.filter((n) => timed(n) && n.onsetMs! > BEHIND_MS);
    const bad = new Map<number, number>();
    for (const n of lateNotes) addTo(bad, noteOf(n).measure, n.onsetMs!);
    out.push({
      kind: 'behind-beat',
      title: 'Behind the beat',
      detail: `Your notes started about ${Math.round(medOnset - 70)} ms after the beat, quite evenly. Place each syllable's consonant just before the beat so the vowel lands on it. (With Bluetooth headphones, run the delay check in Voice setup once.)`,
      measures: window(bad),
      severity: 3,
      weight: 500 + medOnset, // the root cause: rank above the symptoms it produces
    });
  }

  // 4. Scooping into notes from below.
  const scoopable = notes.filter((n) => n.cents !== null);
  const scoops = scoopable.filter((n) => n.scoop === 'below');
  if (scoopable.length >= 4 && scoops.length >= 0.3 * scoopable.length) {
    const bad = new Map<number, number>();
    for (const n of scoops) addTo(bad, noteOf(n).measure, 1);
    const m = window(bad);
    const pct = Math.round((100 * scoops.length) / scoopable.length);
    out.push({
      kind: 'scooping',
      title: 'Scooping up into notes',
      detail: `${pct}% of your notes started from below and slid up (e.g. ${barsText(score, m)}). Aim for the centre of the pitch from the very start: hear it first, then sing it on the consonant.`,
      measures: m,
      severity: pct >= 50 ? 3 : pct >= 40 ? 2 : 1,
      weight: pct * 3,
    });
  }

  // 5. Missed leaps.
  const leapsMissed = notes.filter((n) => {
    if (n.index === 0) return false;
    const leap = Math.abs(pn[n.index].midi - pn[n.index - 1].midi);
    if (leap < LEAP_SEMITONES) return false;
    return (n.grade === 'miss' || n.grade === 'ok') && (n.cents === null || Math.abs(n.cents) > 30 || n.hitRatio < 0.35);
  });
  const leapsTotal = notes.filter((n) => n.index > 0 && Math.abs(pn[n.index].midi - pn[n.index - 1].midi) >= LEAP_SEMITONES).length;
  if (leapsMissed.length >= 2 || (leapsMissed.length === 1 && leapsTotal <= 2)) {
    const bad = new Map<number, number>();
    for (const n of leapsMissed) addTo(bad, noteOf(n).measure, 1 + (n.cents === null ? 1 : Math.min(2, Math.abs(n.cents) / 100)));
    const m = window(bad);
    // Worst bars first.
    const worst = [...bad.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    out.push({
      kind: 'leaps',
      title: 'Big leaps miss the target',
      detail: `${leapsMissed.length} of ${leapsTotal} leaps of a fourth or more landed off the note, worst in ${barList(score, worst, 3)}. Practise the leap slowly: sing the interval, check it against the piano, then put it back in tempo.`,
      measures: m,
      severity: leapsMissed.length >= 0.5 * leapsTotal ? 3 : 2,
      weight: leapsMissed.length * 10,
    });
  }

  // 6. Octave errors.
  const octaves = notes.filter((n) => n.octave);
  if (octaves.length) {
    const bad = new Map<number, number>();
    for (const n of octaves) addTo(bad, noteOf(n).measure, 1);
    const m = window(bad);
    out.push({
      kind: 'octave',
      title: 'Wrong octave',
      detail: `In ${barList(score, octaves.map((n) => noteOf(n).measure))} you sang the right note in the wrong octave. Check where your part actually sits, and listen to the starting pitch again.`,
      measures: m,
      severity: octaves.length >= 3 ? 3 : 2,
      weight: octaves.length * 12,
    });
  }

  // 7. Cluster of missed notes (lowest-scoring bars).
  const perM = new Map<number, number[]>();
  for (const n of notes) {
    const k = noteOf(n).measure;
    if (!perM.has(k)) perM.set(k, []);
    perM.get(k)!.push(GRADE_VALUE[n.grade]);
  }
  const badness = new Map<number, number>();
  for (const [k, vs] of perM) badness.set(k, 1 - mean(vs));
  const mm = window(badness);
  const windowVals: number[] = [];
  for (let k = mm[0]; k <= mm[1]; k++) if (perM.has(k)) windowVals.push(...perM.get(k)!);
  const windowAcc = mean(windowVals);
  if (windowVals.length && windowAcc < 0.5) {
    out.push({
      kind: 'missed-notes',
      title: `Trouble spot: ${barsText(score, mm)}`,
      detail: `Only ${Math.round(windowAcc * 100)}% of the notes in ${barsText(score, mm)} landed. Loop these bars slowly with your part playing until the notes are secure, then take the support away.`,
      measures: mm,
      severity: windowAcc < 0.25 ? 3 : 2,
      weight: (1 - windowAcc) * 100,
    });
  }

  // 8. Wrong notes: clearly voiced, but a semitone or more away (not an octave slip).
  const wrong = notes.filter((n) => n.voicedRatio >= 0.4 && n.cents !== null && !n.octave && Math.abs(n.cents) >= 70 && n.scoop === null);
  if (wrong.length >= 2 || (wrong.length === 1 && notes.length <= 4)) {
    const bad = new Map<number, number>();
    for (const n of wrong) addTo(bad, noteOf(n).measure, Math.min(3, Math.abs(n.cents!) / 100));
    const m = window(bad);
    const up = wrong.filter((n) => n.cents! > 0).length;
    const dir = up > wrong.length * 0.7 ? 'too high' : up < wrong.length * 0.3 ? 'too low' : 'off';
    const semis = Math.round(mean(wrong.map((n) => Math.abs(n.cents!))) / 100);
    out.push({
      kind: 'wrong-notes',
      title: `Wrong notes in ${barsText(score, m)}`,
      detail: `${wrong.length} note${wrong.length > 1 ? 's were' : ' was'} sung clearly but ${dir}, typically by ${semis <= 1 ? 'about a semitone' : `about ${semis} semitones`} (in ${barList(score, wrong.map((n) => noteOf(n).measure))}; worst in ${barsText(score, m)}). Learn the pitches first: loop these bars slowly with your part playing and note names on.`,
      measures: m,
      severity: wrong.length >= 0.3 * notes.length ? 3 : 2,
      weight: wrong.length * 15,
    });
  }

  // 9. Barely heard: likely a mic / volume problem rather than singing.
  const voicedAvg = mean(notes.map((n) => n.voicedRatio));
  if (voicedAvg < 0.25) {
    out.push({
      kind: 'quiet',
      title: 'We could hardly hear you',
      detail: 'Your voice was detected on only a small part of the notes. Sing out at rehearsal volume, keep the phone 20–50 cm away, and check that the microphone isn’t blocked or muted. The Tuner in Settings shows whether your voice comes through.',
      severity: 3,
      weight: 1000,
    });
  }

  // If we barely heard the singer, the other diagnoses are noise.
  if (out.some((c) => c.kind === 'quiet')) out.splice(0, out.length, ...out.filter((c) => c.kind === 'quiet'));
  // Behind the beat explains "scoops" and pitch misses at note starts: drop those then.
  if (out.some((c) => c.kind === 'behind-beat')) {
    for (let i = out.length - 1; i >= 0; i--) if (out[i].kind === 'wrong-notes' || out[i].kind === 'late-entries') out.splice(i, 1);
  }

  // Sort: severity desc, then weight desc. Keep at most 3; reserve a slot for praise.
  out.sort((a, b) => b.severity - a.severity || b.weight - a.weight);
  const accuracy = mean(notes.map((n) => GRADE_VALUE[n.grade]));
  const result: Insight[] = [];
  const great = accuracy >= 0.9;
  for (const c of out.slice(0, great ? 2 : 3)) {
    const { weight: _w, ...ins } = c;
    result.push(ins);
  }
  // A weak run always gets at least one concrete pointer.
  if (!result.length && accuracy < 0.85) {
    result.push({
      kind: 'missed-notes',
      title: `Weakest spot: ${barsText(score, mm)}`,
      detail: `Most points were lost in ${barsText(score, mm)}. Loop these bars slowly, first with your part playing, then without.`,
      measures: mm,
      severity: 2,
    });
  }
  if (great) {
    result.push({
      kind: 'great',
      title: 'Excellent run',
      detail: `${Math.round(accuracy * 100)}% accuracy across ${barsText(score, bounds)}. ${result.length ? 'Polish the point above, then move on' : 'Move on to the next level or the next section'}.`,
      measures: bounds,
      severity: 1,
    });
  }
  return result;
}

/** True when a voiced pitch near the target was sung in the 200 ms before the written start. `samples` sorted by time. */
function sungEarly(index: number, samples: PitchSample[], ctx: ScoringContext): boolean {
  const note = ctx.part.notes[index];
  const from = note.start - 0.2;
  const to = note.start - 0.02;
  // Ignore if the previous note of the part is still sounding in that window.
  if (index > 0) {
    const p = ctx.part.notes[index - 1];
    if (p.start + p.dur > from) return false;
  }
  let lo = 0, hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].time < from) lo = mid + 1; else hi = mid;
  }
  let total = 0;
  let near = 0;
  for (let i = lo; i < samples.length && samples[i].time < to; i++) {
    const s = samples[i];
    total++;
    if (s.midi === null) continue;
    let d = 100 * (s.midi - note.midi);
    d -= 1200 * Math.round(d / 1200);
    if (Math.abs(d) <= 150) near++;
  }
  return total > 0 && near / total >= 0.5;
}

/**
 * Where you sing alone (no audible part playing), tempo drifts: compare when each of your notes
 * starts with the written beat (signed: early counts too) and say if you rushed or dragged.
 * `exposed` = indices of your notes in such passages; `samples` = readings against the applied delay.
 */
export function soloTimingInsight(ctx: ScoringContext, exposed: number[], samples: PitchSample[]): Insight | null {
  const pn = ctx.part.notes;
  const sorted = [...samples].filter((s) => s.midi !== null).sort((a, b) => a.time - b.time);
  const near = (m: number, target: number) => {
    let d = m - target;
    d -= 12 * Math.round(d / 12);
    return Math.abs(d);
  };
  const devs: { m: number; d: number }[] = [];
  for (const i of exposed) {
    const n = pn[i];
    const prev = i > 0 ? pn[i - 1] : null;
    if (prev && prev.midi === n.midi && n.start - (prev.start + prev.dur) < 0.25) continue; // no audible change
    const legato = prev && prev.start + prev.dur >= n.start - 0.25;
    const lo = Math.max(n.start - 0.35, legato ? prev!.start + prev!.dur * 0.5 : -Infinity);
    const hi = n.start + Math.min(0.5, n.dur);
    let hit: number | null = null;
    let run = 0;
    for (const s of sorted) {
      if (s.time < lo) continue;
      if (s.time > hi) break;
      const ok = legato ? near(s.midi!, n.midi) < near(s.midi!, prev!.midi) && near(s.midi!, n.midi) <= 1.5 : near(s.midi!, n.midi) <= 1.5;
      if (ok) {
        if (++run >= 2) { hit = s.time - 0.02; break; } // first of two in a row
      } else run = 0;
    }
    if (hit !== null) devs.push({ m: n.measure, d: hit - n.start });
  }
  if (devs.length < 4) return null;
  const med = median(devs.map((x) => x.d))!;
  const rush = med < -0.09;
  const drag = med > 0.13;
  if (!rush && !drag) return null;
  // Name the bars where it showed, not the whole stretch.
  const off = devs.filter((x) => (rush ? x.d < -0.09 : x.d > 0.13));
  const ms = (off.length ? off : devs).map((x) => x.m);
  const range: [number, number] = [Math.min(...ms), Math.max(...ms)];
  const amt = Math.round(Math.abs(med) * 1000);
  return {
    kind: 'tempo-drift',
    title: rush ? 'You rushed where you sing alone' : 'You dragged where you sing alone',
    detail: `With nobody else playing (${barsText(ctx.score, range)}) your notes came about ${amt} ms ${rush ? 'early' : 'late'}. Keep the pulse going in your head through the solo, or set Settings → Practice beat to "When I sing alone".`,
    measures: range,
    severity: amt > 200 ? 3 : 2,
  };
}
