# QA round 4: real-audio end-to-end scoring

Date: 2026-10-04 · Build: `0fa9199` (dev server on :5179) · Priority scale: `docs/priorities.md`

**Verdict:** Yes, real sung audio is scored correctly through the real microphone pipeline. Singing on time and in tune scores **100 % accuracy / 100 % pitch / 100 % rhythm** at L2 and L3 on both pieces. Flat singing, wrong notes and silence each get the right verdict and the right coach note. The automatic headphone-delay learning works on both pieces at 170–370 ms of uncalibrated delay. **No P0 or P1.** The remaining problems are in coaching, when the cause is timing: a singer who is late is told about pitch faults ("scooping", "wrong notes", "long notes sink") and is never told they are late (P2).

## Method

Everything after `getUserMedia` is the real app:
`MediaStreamSource → AnalyserNode(2048) → pitchy (McLeod) → gates + PitchSmoother → PracticeSession.onPitch (latency compensation, score-time mapping) → LiveScorer → analysis → Results screen / sessionStorage sh:lastResult`.

- **Mic injection** (`docs/qa/scripts/r4audio-run.mjs`, `page.addInitScript`): `navigator.mediaDevices.getUserMedia` returns `MediaStreamAudioDestinationNode.stream`, created on the **app's own AudioContext**. To get that context, the script imports the exact Vite module URL that the app loaded (`/src/audio/context.ts`; HMR adds `?t=` suffixes, which are resolved from `performance` resource entries). The stream carries a constant room-noise floor (about −54 dBFS).
- **Alignment:** this method avoids the problem of the fake WAV device looping. The script wraps `ScorePlayer.prototype.play` and only reads `this.s.startCtx/from/rate` after the original call, so it changes no app behaviour. It then schedules the singer's notes in AudioContext time: `startCtx + (note.start − from)/rate + offset`. That is sample-accurate against the app's own count-in (`START_DELAY` 0.1 s plus one bar of felt beats: 4 for the chorale, 3 for Debussy).
- **Voice:** one oscillator per note with a PeriodicWave of 8 harmonics (the same spectrum as `scripts/make-wav.mjs`). Vibrato is 5.5 Hz at **±40 cents**, fading in after 0.25 s. Each note also has breath noise at 2.5 % and a 40 ms attack and release.
- **Latency model:** the profile is calibrated with `latencyMs = 60`, and the voice is delayed by the same 60 ms, which models a singer who is exactly on time with a calibrated 60 ms round trip. In the "uncal" cases, `latencyMs = 0`, so the app uses `estimateLatencyMs()`, which is 80 ms here (outputLatency 0.03 + baseLatency 0.01 + 40). The voice is then delayed by the stated amount.
- **Targets:** warmup-chorale, Alto (P2), section `s1-m7-12` (Bars 7–12, 21 notes, 4/4 homophonic). debussy-dieu, Tenor (P3), section `s1-m5-12` (Bars 6–13, 43 notes, 3/4 at ♩=60, including triplet-16th ornaments of 0.17 s in bars 10–12). Each target ran at level 2 (own part audible in the synth; the fake mic cannot hear the speakers) and at level 3. Profile voice is set to the part's voice, tuning to equal temperament, strictness to standard.
- **Runs:** each run uses a fresh browser with a fresh profile, clicks Start, and waits for `#/results`. The script then reads `sh:lastResult`, the `result-score` and pass-banner text, and the profile latency, and takes a screenshot. Raw data is in `docs/qa/r4audio/results.json`, screenshots are `docs/qa/r4audio/*.png`, and the log is `docs/qa/r4audio/run.log`.
- **Two passes:** the first pass ran on the previous build. Commit `0fa9199` (latency learning ignores repeated-pitch onsets) landed during that pass. The tables below come from the **second, complete pass on `0fa9199`**. The first pass is archived in `results-pre-0fa9199.json`.

Reproduce: `PAR=2 node docs/qa/scripts/r4audio-run.mjs [filter]`. Example filters are `"debussy-dieu|L3"` and `x-` (the timing sweep).

## Results

Acc / Pitch / Rhythm are the `AttemptResult` fields. "Onset" is the median `onsetMs`. Insights are listed in the order the Results screen shows them.

### Warm-up chorale, Alto, Bars 7–12

| Case | Lvl | Pass | Acc | Pitch | Rhythm | Onset | Insights / message |
|---|---|---|---|---|---|---|---|
| (1) correct, on time | 2 | ✅ | 100 % | 100 % | 100 % | 51 ms | Excellent run |
| (1) correct, on time | 3 | ✅ | 100 % | 100 % | 100 % | 48 ms | Excellent run |
| (2) 30 ¢ flat | 2 | ✅ (tol 35¢) | 85 % | 94 % | 100 % | 52 | **You tend to sing flat** (avg −30¢) |
| (2) 30 ¢ flat | 3 | ❌ (tol 30¢) | 45 % | 46 % | 100 % | 53 | Big leaps miss the target · Trouble spot 9–12 · **You tend to sing flat** (3rd) |
| (3) 150 ms late, calibrated | 2 | ✅ | 94 % | 85 % | 81 % | 204 | Scooping up into notes · Excellent run |
| (3) 150 ms late, calibrated | 3 | ✅ | 93 % | 85 % | 81 % | 204 | Scooping up into notes · Excellent run |
| (3b) 150 ms, latencyMs=0 | 2 | ✅ | 100 % | 100 % | 100 % | 35 | **"…set your delay to 170 ms and re-scored"** · Excellent run |
| (3b) 150 ms, latencyMs=0 | 3 | ✅ | 100 % | 100 % | 100 % | 35 | learned **170 ms**, re-scored |
| (4) every 2nd note +1 semitone | 2 | ❌ | 52 % | 52 % | 99 % | 52 | **Wrong notes in bars 8–11** · Big leaps miss |
| (4) every 2nd note +1 semitone | 3 | ❌ | 52 % | 52 % | 99 % | 53 | **Wrong notes in bars 9–12** · Big leaps miss |
| (5) silence | 2 | ❌ | 0 % | 0 | 0 | – | **We could hardly hear you** · Trouble spot 7–10 · Big leaps miss |
| (5) silence | 3 | ❌ | 0 % | 0 | 0 | – | **We could hardly hear you** · Trouble spot 7–10 · Big leaps miss |

### Debussy "Dieu! qu'il la fait bon regarder!", Tenor, Bars 6–13

| Case | Lvl | Pass | Acc | Pitch | Rhythm | Onset | Insights / message |
|---|---|---|---|---|---|---|---|
| (1) correct, on time | 2 | ✅ | 100 % | 100 % | 100 % | 55 ms | Excellent run |
| (1) correct, on time | 3 | ✅ | 100 % | 100 % | 100 % | 55 ms | Excellent run |
| (2) 30 ¢ flat | 2 | ✅ | 85 % | 100 % | 100 % | 55 | **You tend to sing flat** |
| (2) 30 ¢ flat | 3 | ❌ | 74 % | 71 % | 100 % | 55 | **You tend to sing flat** |
| (3) 150 ms late, calibrated | 2 | ❌ | 56 % | 49 % | 63 % | 198 | **Wrong notes in bars 10–12** ("off by about 2 semitones") · Trouble spot 9–12 · Scooping |
| (3) 150 ms late, calibrated | 3 | ❌ | 57 % | 48 % | 63 % | 198 | same |
| (3b) 150 ms, latencyMs=0 | 2 | ❌ | 70 % | 64 % | 70 % | 153 | Wrong notes 10–12 · Scooping; **no delay learned** (only 70 ms beyond the 80 ms estimate) |
| (3b) 150 ms, latencyMs=0 | 3 | ❌ | 66 % | 63 % | 70 % | 153 | same |
| (4) every 2nd note +1 semitone | 2 | ❌ | 51 % | 51 % | 93 % | 62 | **Wrong notes in bars 9–12** |
| (4) every 2nd note +1 semitone | 3 | ❌ | 51 % | 51 % | 93 % | 56 | **Wrong notes in bars 9–12** |
| (5) silence | 2 | ❌ | 0 % | 0 | 0 | – | **We could hardly hear you** · Trouble spot 6–9 |
| (5) silence | 3 | ❌ | 0 % | 0 | 0 | – | **We could hardly hear you** · Trouble spot 6–9 |

### Timing sweep (extra cases `x-*`)

| Case | Chorale L2 / L3 | Debussy L2 / L3 |
|---|---|---|
| 100 ms early (calibrated) | ✅ 100 % / ✅ 100 %, no timing note | ✅ 98 % / ✅ 97 %, no timing note |
| 100 ms late (calibrated) | ✅ 96 % / ✅ 96 %, "Scooping" + "Excellent run" | ❌ 72 % / ❌ 72 %, "Wrong notes in bars 10–12" + "Scooping" |
| 250 ms, latencyMs=0 | ✅ 100 %, learned 268 / 264 ms | ✅ 100 %, learned 227 / 236 ms |
| 350 ms, latencyMs=0 | ✅ 100 %, learned 370 / 368 ms | ✅ 100 %, learned 338 / 337 ms |

The learned delay is within about 25 ms of the true delay, which is the voice offset: 250 ms → 227–268 ms learned, 350 ms → 337–370 ms learned.

### Notes on the measurements

- **Fixed detection lag of about 50 ms.** With perfect alignment, onsets on pitch changes measure 45–70 ms, and repeated pitches measure about 10 ms. The lag comes from the 40 ms attack, the 46 ms analysis window (time-stamped at its centre), and the median-of-3 smoother. The scorer's `rhythmValue` (centred at 40 ms with ±60 ms grace) and the latency learner's "−40 ms" absorb most of it.
- **Real-time accuracy.** Pitch accuracy is excellent. Median cents is ±0.01 ¢ on correct runs and −29.99 ¢ on the 30 ¢-flat runs. A ±40 ¢ vibrato is not penalised.
- **No errors.** There were no page errors or console errors in any run. getUserMedia was called once per session, as designed for the shared tracker.
- **Previous build.** Before `0fa9199`, the chorale never learned the delay: repeated-pitch onsets near 0 ms inflated the IQR. Uncalibrated singers 250–350 ms late got 91 % and then a 73 % **fail**, with "Long notes sink" and "Scooping" notes. HEAD fixes this (see the 3b and sweep rows).

## Findings

| ID | Priority | Title | Evidence | Suggested fix |
|---|---|---|---|---|
| R4A-01 | P2 | A late singer gets pitch coaching and never a timing coach note | Chorale, 150 ms late with calibrated latency: rhythm 81 %, but the notes say "Scooping up into notes" and "Excellent run". Debussy, 150 ms late: "Wrong notes in bars 10–12 … off by about 2 semitones" plus "Scooping" for correct pitches. No `late-entries` note in any late run: that note only looks at entries after rests of 0.5 s or more, and neither section has one. The same happens at 100 ms late. | Add a general "behind the beat" insight when the median onset of pitch-change notes is above about 150 ms with a consistent spread, not only after rests. Suppress scooping, wrong-notes and drift notes for a note when its deviation matches the *previous* note's pitch within the first `onsetMs` (timing, not pitch). Do not show "Excellent run" when rhythm is below 85 %. |
| R4A-02 | P2 | A 100–150 ms delay fails ornamented passages, and the auto-learner ignores it when uncalibrated | Debussy Tenor bars 10–12 (triplet 16ths, 0.17 s): 100 ms late gives 72 % (L2 and L3 fail), and 70 ms beyond the latency estimate gives 66–70 % fail. The learner needs a median above 150 ms, so it does not trigger. The ~50 ms fixed detection lag (see Notes on the measurements) uses up part of the timing budget. | Make the learner's threshold relative (for example, median minus the measured detection lag above 80 ms). For short notes (< 0.25 s), judge the pitch over the note *plus* a latency-sized tail window, or weight them less in accuracy. Consider stamping `RawPitch.ctxTime` nearer the newest audio (window end minus a quarter) to cut the fixed lag. |
| R4A-03 | P3 | The flat note is ranked below incidental notes when the singer is uniformly flat at L3 | Chorale L3, 30 ¢ flat: insights in order are "Big leaps miss the target", "Trouble spot: bars 9–12", then "You tend to sing flat". All 3 leaps "missed" only because every note was 30 ¢ flat. | When `flat-overall` / `sharp-overall` explains most of the misses, rank it first and suppress the leaps and missed-notes notes that it explains. |
| R4A-04 | P3 | Silence also produces "Big leaps miss the target" and "Trouble spot" | Chorale silence: "We could hardly hear you", then "Trouble spot: bars 7–10", then "Big leaps miss the target". | When the `quiet` insight fires (or voiced ratio is about 0), show only it. |
| R4A-05 | P3 | Early singing is not reported | 100 ms early: 97–100 %, no early note. On the chorale L2 it showed "Long notes sink" instead (previous build). | Optional: mirror R4A-01 for consistent negative onsets (voiced before the note at pitch-change points). |

**No P0/P1:** the core loop with real audio (choose part, sing, scored feedback) scores correctly on both pieces at L2 and L3, and pass/fail matches the level thresholds.

## Files

- `docs/qa/scripts/r4audio-run.mjs`: injection, alignment and case runner.
- `docs/qa/scripts/r4audio-probe.mjs`: lists the parts and sections through the app's own modules.
- `docs/qa/r4audio/results.json`: per-note detail as `[index, grade, cents, onsetMs, hitRatio]`, plus `run.log` and screenshots.
- `docs/qa/r4audio/results-pre-0fa9199.json`: the same matrix on the previous build.
