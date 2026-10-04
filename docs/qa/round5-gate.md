# Round 5 QA gate: Schönberg Hero

HEAD `6f64465` (plus `0fa9199`). Date 2026-10-04. Priorities follow `docs/priorities.md`.

## Verdict

**NOT CLEAN: P0: 0, P1: 1 (R5-01), P2: 3, P3: 3.**

Nothing is broken. All builds and tests pass, the real-audio matrix is 40/40 musically right, and no screen throws a page error. One problem was introduced this round. The new **'behind-beat' coach insight fires at an onset level that ordinary singing already reaches.** That level is a 60–80 ms consonant plus about 50 ms of pitch-detection lag. Because 'behind-beat' suppresses 'scooping', a scooping singer is now told "Behind the beat… probably your Bluetooth headphones: run the delay check" instead of "Scooping". Scooping detection fell from **185/207 to 52/207** synthetic runs.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | `npx vitest run` | **PASS**: 15 files, 189 tests |
| 1 | `npx playwright test e2e/flow.spec.ts --project=chromium` | **PASS**: 3/3 (1.1 min) |
| 2 | QA probes (`vitest.qa.config.mjs`) | 13/16 files, 33/39 tests. **No product failures.** `r3cr-timing` CR-05 and CR-10 fail as expected: they re-implement the old formulas inline (confirmed in round 4 and in the source). `scoring-realism` and `r2-scoring-realism` (2 tests each) fail with **ENOENT on `public/pieces/pd/bach-bwv512.mxl`**, a file deleted in `b0f7a35` (round 1). That is a stale fixture, not a product bug (R5-07). |
| 3 | Real-audio matrix `PAR=3 r4audio-run.mjs` | **40/40 cases ran, 0 page errors, all verdicts musically right** (table below) |
| 4 | Synthetic singers `r5-singers.qa.test.ts` (2,277 scored runs: warm-up chorale, Debussy *Dieu*, Debussy *Yver*; every section and part, L4 standard ±25¢, 3 seeds) | quiet ✔, flat ✔, no 'great' on a failed run ✔. Good singer: see R5-04. Dragging singer: 'behind-beat' in only 63% of runs (R5-03). **Scooping singer: 'scooping' in only 25% of runs (R5-01)** |
| 4b | Diagnostic `r5-scoop-diag.qa.test.ts`, HEAD vs pre-round-4 (`bf37269`, copied to `r5-old/`) | Pins R5-01 to the new behind-beat rule and its suppression of scooping |
| 5 | Browser smoke `r5-smoke.mjs`, 390×844, `?simulate=perfect` and `?simulate=sloppy` | Home, Library, both Piece pages, Setup, Settings, Ranks, Expert, Tuner, Play L1 → Results, Arcade L4 → Results. **0 page errors, 0 horizontal overflow** in both modes. Perfect: L1 reached and L4 reached, 100%. Sloppy: "Not yet: 52% of 75%" and "Not yet: 51% of 85%". Screenshots are in `docs/qa/shots-r5/` |

### Real-audio matrix (all cases)

| Case | warm-up L2 | warm-up L3 | Dieu L2 | Dieu L3 | Coach notes |
|---|---|---|---|---|---|
| ok | pass 100 | pass 100 | pass 100 | pass 100 | great |
| flat30 | pass 85 | fail 45 | pass 85 | fail 77 | flat-overall first ✔ |
| late150 (calibrated) | pass 94 | pass 93 | fail 56 | fail 55 | behind-beat ✔ (with great on passes, missed-notes on fails) |
| late150-uncal | pass 100, learned 160 | pass 100, learned 159 | pass 100, learned 128 | pass 100, learned 128 | great ✔ |
| wrong | fail 52 | fail 52 | fail 51 | fail 51 | wrong-notes ✔ |
| silence | fail 0 | fail 0 | fail 0 | fail 0 | quiet only ✔ |
| x-late100 | pass 96 | pass 96 | fail 72 | fail 72 | behind-beat ✔ |
| x-early100 | pass 100 | pass 100 | pass 98 | pass 97 | great only (R5-06) |
| x-late250-uncal | learned 255 | learned 253 | learned 229 | learned 226 | great ✔ |
| x-late350-uncal | learned 360 | learned 360 | learned 325 | learned 327 | great ✔ |

The learner under-estimates Debussy delays by about 20–25 ms, which does not matter. The harness voice has a 40 ms attack and **no consonant**, so this matrix cannot show R5-01.

### Synthetic singer summary (L4 standard, pass 85%)

Singer model: ±50¢ vibrato at 5.5 Hz, a 60–80 ms unvoiced consonant on each syllable, ±30–60 ms timing jitter, ±6¢ scatter and 50 Hz samples. The tracker lag is 50 ms unless stated; the real-audio "ok" median onset is about 48–57 ms.

| Singer | HEAD pass | HEAD insights (count out of 207) | Pre-r4 `bf37269` |
|---|---|---|---|
| good, lag 0 (literal brief model) | 204/207 | great 197, behind-beat 3 | same pass rate, scooping 2 |
| good, lag 50 | 150/207 | great 103, missed-notes 30, wrong-notes 18, behind-beat 5 | 150/207, scooping 25 |
| good, lag 50, jitter 0–45 | 188/207 | **behind-beat 64**, great 156 | 188/207, scooping 40 |
| good, lag 50, consonant 60–80, no jitter | 202/207 | **behind-beat 191** (on passing "great" runs) | 202/207, scooping 104 |
| good, lag 50, consonant 40–60, jitter 0–45 | 205/207 | great 188, behind-beat 2 | same |
| drag +150 ms | 23/207 | behind-beat 130, missed-notes 116, wrong-notes 64, leaps 66 | behind-beat 0, wrong-notes 152 |
| scoop 150¢ over 150 ms | 24/207 | **scooping 52**, behind-beat 135, flat-overall 168 | **scooping 185** |
| flat −35¢ | 0/207 | flat-overall 206 (ranked first in 20) | flat-overall 172 |
| quiet (15% voiced) | 0/207 | **quiet only: 207/207** | quiet only 0/207 |
| 'great' on a failed run | **0 of 2,277 runs** | (structural: 'great' needs ≥90%, and the highest pass mark is 85%) | |

## Findings

### R5-01: P1 (new this round). 'Behind the beat' fires on ordinary consonant onsets and hides 'Scooping'

`analysis.ts` step 3b fires when the median onset of unscooped notes is over 120 ms. Each onset already includes about 50 ms of pitch-detection lag. Calibration does not remove this lag: `latency.ts` calibrates on the RMS onset, not the pitch onset, and the real-audio "ok" case shows a median onset of 48–57 ms. A consonant-led syllable sung on the beat adds 60–80 ms more. So an on-time singer sits at **about 110–130 ms, right at the threshold**. 'Behind-beat' then deletes 'scooping', 'wrong-notes' and 'late-entries'.

- **Scooper:** 'scooping' falls from 185/207 runs (pre-r4) to **52/207**; 'behind-beat' takes it in 135 runs. In the diagnostic, HEAD actually marks *more* notes as scooped (for example 15/21 against 10/21). The scooping insight still qualifies, and is then removed by the suppression rule. Example: warm-up chorale Alto, bars 7–12, consonant 60 ms, scoop 150¢ over 150 ms. HEAD gives `[behind-beat, sharp-long-notes]`; the old code gives `[scooping, sharp-long-notes]`.
- **On-time singer with 60–80 ms consonants on the beat:** 'behind-beat' (severity 3, ranked first) appears in **191/207** runs, even on passing "Excellent run" results. The text tells an already-calibrated singer that it is "probably their Bluetooth delay: run the delay check". Re-running the check cannot remove it, so there is no workaround.
- Why P1: the coach is the "scored feedback" step of the core loop. It now blames a technique fault (scooping) on hardware and points the singer at the wrong fix.
- Suggested fix (src not edited):
  - Do not suppress 'scooping' when the scooping criterion is met. At least require that the unscooped onsets used for 'behind-beat' are a majority of the notes.
  - Raise the threshold to about 50 ms lag + 80 ms consonant + a margin (≈170 ms), or subtract the detection lag before applying 120 ms.
  - Do not suggest the delay check when `profile.latencyMs` is already set.
- Repro: `R5_OLD= npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs --silent=false docs/qa/scripts/r5-scoop-diag.qa.test.ts`, and the `scoop150` block in `r5-singers.qa.test.ts`.

### R5-02: P2 (made wider this round). The latency learner (threshold 150 → 110 ms) can store a wrong delay for uncalibrated singers

Under the same arithmetic as R5-01, an uncalibrated singer with consonants on the beat has a median onset of about 110–130 ms. A scooper is at about 176 ms and a steady dragger at about 230 ms. All of them now qualify (`med/rate > 110`, IQR < 120). The learner then stores the consonant length, the scoop or the drag as the singer's headphone delay in the profile. It only runs while `latencyMs` is 0, so it never corrects itself. Every later run is shifted, and a dragger's lateness is hidden for good. The workaround is to run the delay check in Voice setup. This finding comes from reading `Play.tsx` together with the measured onset medians; I did not drive it in the browser.

### R5-03: P2 (improved, not complete). A dragging singer (+150 ms) gets 'behind-beat' in only 130/207 runs

The other runs, mostly Debussy short-note sections, get "Wrong notes / Big leaps / Trouble spot", which tells the singer to learn pitches they already sing correctly. On short notes the late voice misses the note window, so the onset is null and the previous pitch carries over. This is better than pre-r4 (behind-beat 0, wrong-notes 152), so it is not a regression.

### R5-04: P2 (pre-existing, identical at `bf37269`). A good singer fails L4 on fast Debussy sections once detection lag is included

With 50 ms lag and ±30–60 ms jitter, the good singer passes L4 in 150/207 runs. By section:

- *Yver* bars 1–10: 3/15
- *Yver* bars 17–23: 4/15
- *Dieu* bars 1–5: 7/12
- *Dieu* bars 6–13: 6/12
- warm-up chorale: 24/24

The result depends heavily on the singer model:

- lag 0 (the brief's literal model): 204/207
- jitter 0–45 ms: 188/207
- consonants 40–60 ms: 205/207

The cause is that the ~50 ms pitch-detection lag is never compensated. On short notes the previous pitch, delayed by the lag and jitter, spills into the next note's body. Retrying and the lower levels are workarounds. This is worth confirming with real singers; it would become P1 if real recordings reproduce it.

### R5-05: P3. "Strongly flat ranks first" does not hold on runs that are mostly misses

With the singer 35¢ flat, 'flat-overall' is shown in 206/207 runs but ranked first in only 20. 'Trouble spot' (severity 3, weight about 100) beats it (weight 70). It is still in the top 3, so the advice is not lost.

### R5-06: P3. A singer 100 ms early gets no 'early-entries' note (real audio)

The real-audio `x-early100` cases give 'great' only.

### R5-07: P3 (tooling). Two old QA realism probes reference a deleted Bach fixture

The `scoring-realism` and `r2-scoring-realism` probes read `pd/bach-bwv512.mxl`, which was removed in round 1, so they fail with ENOENT. The round-4 report counted 14/16 probe files passing; the current count is 13/16.

### Verified OK this round

- Onset detection on short consonant-led notes: the lag-0 good singer passes 204/207.
- 'quiet' suppresses every other insight: 207/207.
- No 'great' on a failed run.
- Flat/sharp over 25¢ is severity 3.
- Mic-lost, storage-guard and date changes: no regressions in unit tests, e2e or smoke. They were not exercised further.
- Landscape howto: not re-checked.

## Files added (QA only; `src/`, `public/`, `e2e/` and configs are untouched)

- `docs/qa/scripts/r5-singers.qa.test.ts`: synthetic singer matrix. Set `R5_OLD=1` to score with the pre-r4 code and `R5_PERSEC=1` for pass rates per section. Its scoop, drag and good-singer assertions fail on purpose; they document R5-01, R5-03 and R5-04.
- `docs/qa/scripts/r5-scoop-diag.qa.test.ts`: side-by-side HEAD vs old for scooping.
- `docs/qa/scripts/r5-old/src/`: `git archive bf37269 src` copy, the baseline for the comparisons.
- `docs/qa/scripts/r5-smoke.mjs` and `docs/qa/shots-r5/`: browser smoke and screenshots.
- `r4audio-run.mjs` rewrote `docs/qa/r4audio/*.png` and `results.json`.
