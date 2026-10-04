# Realism harness: synthetic singer → real pipeline → score

The earlier synthetic tests used idealised singers: steady pitch, instant note changes, perfect timing. This harness renders **audio** of a realistic singer as a phone would record it. It runs that audio through an offline copy of the app's pitch tracker, maps the readings to score time exactly as `session.ts` does, and scores them with a pluggable scorer. The same path scores **real recordings** (WAV + sidecar JSON).

## Run

```sh
npx vitest run --config vitest.realism.config.ts                         # baseline: frozen HEAD scorer + tracker
REALISM_IMPL=current npx vitest run --config vitest.realism.config.ts    # working tree (src/game/scoring.ts, src/audio/pitch.ts)
REALISM_SEEDS=5 npx vitest run --config vitest.realism.config.ts         # fewer repeatability seeds (default 10)
```

A full run takes about 4 minutes on 4 cores. All randomness is seeded, so a run is reproducible. Outputs:

| impl | JSON | Markdown |
|---|---|---|
| `head` (default) | `qa/realism/out/report.json` | `docs/qa/realism-baseline.md` |
| `current` | `qa/realism/out/report-current.json` | `docs/qa/realism-current.md` |

It also writes an example take, `qa/realism/out/example-dieu-1-5-alto-L1-uncal200.wav`, with its `.json` sidecar. The take is scored again through `scoreRecording` as a round-trip check.

The test fails only when a bad singer passes. One exception follows from the level design: a −40¢ flat singer may pass L1, because −40¢ is inside L1's ±50¢ window.

## Files

| file | what |
|---|---|
| `singer.ts` | `renderSinger(opts)`: the singer and channel model, 48 kHz mono Float32, plus the ground-truth f0 (`truthMidi` at 1 kHz). Defines the `SINGERS` and `CHANNELS` presets. |
| `tracker.ts` | `trackOffline(pcm, sampleRate, { windowN, hopMs, jitterMs, quantum, untilSec, impl })`: the browser `PitchTracker`, run offline. |
| `harness.ts` | `scorePcm`, `scoreRecording(wavPath, sidecar, scorer?)`, `readingsToSamples`, `oracleSamples`, `emulateLatencyLearn` (port of the Play.tsx delay learning), `gradeLetter`, `levelSetup`, the `Scorer` type and `SCORE_HEAD` / `SCORE_CURRENT`. |
| `fidelity.ts` | Tracker vs truth error statistics, overshoot (voice vs tracker), per-note loss breakdown, and an emulation of the live cents bubble. |
| `experiment.ts` | `runTake(cfg)`: one take end to end (render → track → score, plus oracle, loss and bubble). |
| `run.test.ts` | The experiments and the report writers. |
| `scores.ts` | Loads built-in pieces exactly as `library.ts` does: `noteRangeFor`, `findPart`. |
| `wav.ts` | WAV reader (16/24-bit PCM, 32-bit float, any channel count mixed to mono) and a 16-bit writer. |
| `baseline/` | Frozen copies of `src/game/scoring.ts`, `analysis.ts` and `src/audio/pitch.ts` at the baseline commit, so the baseline numbers do not move while `src/` changes. |

## Pipeline emulated

- **Tracker** (`src/audio/pitch.ts`): every `hopMs` (20 ms, ±3 ms setInterval jitter) it reads the newest `windowN` samples (2048), quantised to 128-frame render quanta. It runs `detectPitch` → `gatePitch` → `PitchSmoother` and stamps the reading with `ctxTime = currentTime − windowSec/2 − hop`.
- **Mapping** (`session.ts onPitch`): `scoreTime = scoreTimeAtSample0 + (stampSec − latencyMs/1000) · rate`. Samples before `from − 0.6` are dropped. The app stops listening `min(700, latency + 120)` ms after the player ends.
- **Scoring**: `Scorer = (ctx, samples, opts) => AttemptResult`, which defaults to `scoreAttempt`. Options come from the level (`ladder.ts`, standard strictness): equal temperament, not octave-tolerant (an alto on the alto part).
- **After the run** (`Play.tsx`): when the profile is uncalibrated, consistent late onsets → learn the delay and re-score. The result is `Scored.learned`. The grade letter and "avg ¢" are computed as in `Results.tsx`.

## Singer and channel model (`singer.ts`)

- **Pitch:** a per-note intonation error ~ N(bias, sd). Legato changes follow an underdamped 2nd-order response (fn 5–12 Hz, ζ 0.35–0.8), which gives real overshoot and ringing. Vibrato starts 100–300 ms into a note, with rate and extent wander. There is also OU drift and optional scoops from below after rests.
- **Timing:** onset jitter, a lead/lag bias, and consonant noise bursts of 30–90 ms on lyric syllables that start with a consonant. 70 % of each consonant falls before the beat. The voice stops 40–120 ms early before a rest (breath).
- **Source:** band-limited pulse train (harmonic k at 1/k², i.e. −12 dB/oct) with per-cycle jitter and shimmer and aspiration noise. Five Klatt-style cascaded alto formants cycle through a/e/i/o/u per syllable.
- **Channel:** exponential-noise room reverb (RT60, wet level), a phone-mic high-pass, pink-ish background noise at a set SNR, and optional backing bleed. The bleed is the app's own backing (other parts, plus the own part at L1–2), high-passed like a phone speaker.
- **Latency:** the voice reaches the mic at `τ(s) = (s − s0)/rate + trueLatency`. The app maps readings with its own `latencyMs`.
- **Seeds:** `performanceSeed` drives intonation, timing, transitions, vibrato settings and drift. `microSeed` drives glottal jitter and shimmer, noise, vibrato phase and wander, and tracker hop jitter. The repeatability experiment varies them separately.

## Scoring a real recording

The app exports a 16-bit PCM WAV and a sidecar:

```json
{"version":1,"pieceId":"debussy-dieu","partId":"P2","from":0.0,"to":15.0,"rate":0.7,"level":1,
 "toleranceCents":50,"tuning":"equal","octaveTolerant":true,"latencyMs":80,
 "sampleRate":48000,"scoreTimeAtSample0":-2.1}
```

`scoreTimeAtSample0` is the score time of the WAV's first sample, before latency compensation. Audio sample k plays at score time `scoreTimeAtSample0 + (k/sampleRate)·rate`.

```ts
// e.g. in a scratch test file under qa/realism/ (run with the realism vitest config)
import { scoreRecording, SCORE_HEAD, SCORE_CURRENT } from './harness';

const r = await scoreRecording('path/take.wav', 'path/take.json');            // working-tree scorer
const b = await scoreRecording('path/take.wav', 'path/take.json', SCORE_HEAD); // baseline scorer
console.log(r.letter, r.result.accuracy, r.result.pitch, r.avgCents, r.passed);
// r.readings: raw tracker output (rec time, Hz, smoothed MIDI); r.samples: mapped PitchSamples.
// Try a different latency assumption: scoreRecording(wav, { ...sidecar, latencyMs: 220 }).
// Emulate the app's delay learning: scoreRecording(wav, sidecar, undefined, { uncalibrated: true }) → r.learned.
```

Real recordings have no ground truth, so the fidelity statistics do not apply. Score, latency and tracker comparisons work the same way.

## Plugging in a new scorer

```ts
import type { Scorer } from './harness';
import { scoreAttemptAligned } from '../../src/game/scoring'; // hypothetical
const scorer: Scorer = (ctx, samples, opts) => scoreAttemptAligned(ctx, samples, opts);
await runTake({ target, singer: SINGERS.goodChoir, level: 4, latency: LATENCIES[1], performanceSeed: 1, microSeed: 1, scorer });
```

`run.test.ts` takes its scorer and tracker from `REALISM_IMPL`. To compare a new end-of-run function, set `REALISM_IMPL=current` once it is the default `scoreAttempt`, or change the `SCORER` constant at the top of `run.test.ts`.

## Experiments (run.test.ts)

1. **Tracker fidelity:** good, operatic, control (no overshoot) and ringing voices, plus a speaker-bleed take, each with N=2048/hop 20, N=1024/hop 20 and N=1024/hop 10. Reports error statistics overall, near transitions and in steady parts; spikes > 50¢; octave errors; missed and false voicing; and overshoot (voice vs tracker).
2. **Good singers** across 6 sections (warm-up chorale both halves, Debussy *Dieu!* Alto bars 1–5 and 6–13, *Tabourin* Alto solo bars 1–8 and 9–16) × L1/L4 × {calibrated, 200/80, 280/80}. Includes oracle scores, a loss breakdown, the cents bubble, and a bleed-level sweep (−18/−13/−8 dB).
3. **Repeatability:** 10 seeds with micro-randomness only, then with the performance varied too. A further sub-experiment has a new uncalibrated singer do 3 runs in a row with the app's delay learning.
4. **Sanity:** a flat −40¢ singer and a singer with 40 % wrong notes at L1/L2/L4.
5. **Ablation:** idealised → each realism factor added in turn (with oracle).
6. **Scoring options:** vibratoWindow 0/0.18/0.30 and onsetGrace 0.08/0.15/0.25 on the same samples.
