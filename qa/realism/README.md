# Realism harness: synthetic singer → real pipeline → score

The earlier synthetic tests used idealised singers: steady pitch, instant note changes, perfect timing. This harness renders **audio** of a realistic singer as a phone would record it. It runs that audio through an offline copy of the app's pitch tracker, maps the readings to score time exactly as `session.ts` does, and scores them with a pluggable scorer. The same path scores **real recordings** (WAV + sidecar JSON).

## Run

```sh
npx vitest run --config vitest.realism.config.ts                       # before/after comparison → docs/qa/realism-current.md
REALISM_SEEDS=5 npx vitest run --config vitest.realism.config.ts       # fewer repeatability seeds (default 10)
REALISM_BASELINE=1 npx vitest run --config vitest.realism.config.ts qa/realism/run.test.ts   # baseline-only report
```

The default run takes about 2.5 minutes on 4 cores. It runs the `cmp-*.test.ts` files in parallel, and each writes a part to `out/parts/`. The global teardown (`global-setup.ts` → `report-current.ts`) merges the parts into `qa/realism/out/report-current.json` and `docs/qa/realism-current.md`. Hand-written notes in `observations-current.md` are spliced into that doc. Every take is rendered once and scored by both pipelines (`pipeline.ts`):

- **before**: the baseline app (frozen copies in `baseline/`, delay estimate 80 ms).
- **after**: the current app in `src/`, used live with no copies. The `Play.tsx`/`session.ts` end-of-run policy (timing gate, learn cap, subharmonic lift) is read from the source by regex, so the emulation follows edits. The doc lists what was detected.

`cmp-sanity.test.ts` fails when a bad or adversarial singer passes where it must not. That is the regression guard for exploits.

`run.test.ts` (baseline only) writes `qa/realism/out/report.json` and `docs/qa/realism-baseline.md`. Generated files under `out/` (`parts/`, `variants/`, `*.wav`) are git-ignored.

## Files

| file | what |
|---|---|
| `singer.ts` | `renderSinger(opts)`: the singer and channel model, plus ground-truth f0. Presets in `SINGERS`, including adversarial ones (echo 300 ms, one note behind, late pitch arrival, exact 40 % wrong notes, flat −40¢) and `CHANNELS`. |
| `tracker.ts` | `trackOffline(pcm, sampleRate, { windowN, hopMs, jitterMs, quantum, untilSec, impl })`. |
| `pipeline.ts` | `runSession(BEFORE / AFTER, setup, profile)`: one practice run through the whole app pipeline. A `Profile` (stored delay, source, hint) carries over between runs. Also `PLAY_POLICY` and `afterScorerView`. |
| `compare.ts`, `cmp-experiments.ts`, `cmp-*.test.ts` | Before/after experiments on shared renders. |
| `report-current.ts`, `global-setup.ts`, `observations-current.md` | Merges the parts into the before/after doc. |
| `variants.ts` | Generates copies of `src/game/scoring.ts` and `align.ts` with another `TRANSITION_MAX` (the sweep). `gitVariant(ref)` loads `scoring.ts`, `align.ts` and `pitch.ts` as committed at a git ref (pass `{ ...AFTER, impl, pitch, pitchKey }` to `runSession`). |
| `fastnotes.ts`, `cmp-fast.test.ts` | Fast notes: the pieces' fast bars and synthetic 8ths/16ths at 80–144 bpm (with/without consonants), good and adversarial singers, before (`FAST_BASE_REF`, default `54ea7b9`) vs after on the same renders. `diagnose(run)` replays the scorer on the exact samples and names the rule that dropped each ok/miss note. Report section 7. |
| `l1doo.ts`, `cmp-l1-doo*.test.ts` | Level 1 on “doo” with the every-note rule: good voices on lyrics vs “doo”, fast bars, singers with wrong notes; old (75%) vs new rule. Report section 8. |
| `vibrato.ts`, `cmp-vibrato.test.ts` | Wide vibrato at level 1 on every library section (pitch-level readings), and wrong notes at every level, scorer at `VIB_BASE_REF` vs now. Report section 9. `vibratoAudio()` runs the same through rendered audio and the whole pipeline (slow: about 6 min per vibrato width). |
| `quality.ts`, `humchannel.ts`, `cmp-hum.test.ts` | Microphone trouble. `quality.ts` is the offline copy of the app's input-quality path: raw blocks every 250 ms (a 32768-sample spectrum for mains hum, the new samples for clipping), the mains frequency found in the silence before the first note, the input-filter plan, and the run's `InputQuality` summary. `humchannel.ts` adds hum and hum-driven distortion (the voice modulated by the hum's 3rd harmonic) to a rendered take. `cmp-hum.test.ts` runs the real recording `qa/fixtures/hum-run.wav` (+ `hum-run.json`, the app's run export: Vierne Kyrie, bass, level 1, mains hum at 59 Hz; the tracker read the sung C#4 as F#2 and C#3) and synthetic takes, before (`MIC_BASE_REF`, default `c04ca36`) vs after. Report section 10. |
| `harness.ts` | `scoreRecording` (raw scorer path), `scoreRecordingApp` (current app end of run), `scorePcm`, `readingsToSamples`, `oracleSamples`, `emulateLatencyLearn` (old learning), `gradeLetter`, `levelSetup`, the `Scorer` type. |
| `fidelity.ts` | Tracker vs truth, overshoot, loss breakdown, and the cents bubble (`reference: 'playhead' | 'sample'`). |
| `experiment.ts`, `run.test.ts` | The original baseline experiments. |
| `scores.ts`, `wav.ts`, `dsp.ts`, `prng.ts` | Piece loading, WAV I/O, DSP and the seeded RNG. |
| `baseline/` | Frozen `scoring.ts`, `analysis.ts` and `pitch.ts` at the baseline commit 282d509. |

## Pipeline emulated

- **Tracker** (`src/audio/pitch.ts`): every `hopMs` (20 ms, ±3 ms setInterval jitter) it reads the newest `windowN` samples (2048), quantised to 128-frame render quanta. It runs `detectPitch` (McLeod, then the harmonic check of `src/audio/harmonics.ts`, with the note due and the previous reading as tie-breakers) → `gatePitch` → `PitchSmoother` and stamps the reading with `ctxTime = currentTime − windowSec/2 − hop`. The current app's tracker hears the input through filters (`src/audio/inputFilter.ts`: a high-pass at 0.7 × the part's lowest note, at most 90 Hz, and notches at the mains hum found before the first note); `pipeline.ts` applies the same (`inputPlanFor`) unless `noInputFilter`.
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
 "sampleRate":48000,"scoreTimeAtSample0":-2.1,"windowN":1024,"calibrated":false}
```

`scoreTimeAtSample0` is the score time of the WAV's first sample, before latency compensation. Audio sample k plays at score time `scoreTimeAtSample0 + (k/sampleRate)·rate`.

```ts
// e.g. in a scratch test file under qa/realism/ (run with the realism vitest config)
import { scoreRecording, scoreRecordingApp, SCORE_HEAD } from './harness';

// Exactly what the current app shows (sidecar windowN, scoreAligned + subharmonic lift, timing gate):
const app = await scoreRecordingApp('path/run.wav', 'path/run.json');
console.log(app.letter, app.passed, app.alignedMs, app.timingFailMs, app.profile /* delay the app would store */);

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

For the full app end of run, pass an `AfterImpl` (`{ scoreAttempt, scoreAligned, medianOnsetMs }`) as `{ ...AFTER, impl }` to `runSession`. `variants.ts` does this for the TRANSITION_MAX sweep.

## Baseline experiments (run.test.ts)

1. **Tracker fidelity:** good, operatic, control (no overshoot) and ringing voices, plus a speaker-bleed take, each with N=2048/hop 20, N=1024/hop 20 and N=1024/hop 10. Reports error statistics overall, near transitions and in steady parts; spikes > 50¢; octave errors; missed and false voicing; and overshoot (voice vs tracker).
2. **Good singers** across 6 sections (warm-up chorale both halves, Debussy *Dieu!* Alto bars 1–5 and 6–13, *Tabourin* Alto solo bars 1–8 and 9–16) × L1/L4 × {calibrated, 200/80, 280/80}. Includes oracle scores, a loss breakdown, the cents bubble, and a bleed-level sweep (−18/−13/−8 dB).
3. **Repeatability:** 10 seeds with micro-randomness only, then with the performance varied too. A further sub-experiment has a new uncalibrated singer do 3 runs in a row with the app's delay learning.
4. **Sanity:** a flat −40¢ singer and a singer with 40 % wrong notes at L1/L2/L4.
5. **Ablation:** idealised → each realism factor added in turn (with oracle).
6. **Scoring options:** vibratoWindow 0/0.18/0.30 and onsetGrace 0.08/0.15/0.25 on the same samples.
