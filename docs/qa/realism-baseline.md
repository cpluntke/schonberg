# Realism baseline: synthetic singer through the real pipeline (baseline, frozen HEAD scorer + tracker)

Generated 2026-10-04T16:19:50.859Z by `npx vitest run --config vitest.realism.config.ts`. Harness: `qa/realism/` (see its README). Scorer: `qa/realism/baseline/scoring.ts` (frozen copy of `src/game/scoring.ts` at the baseline commit); tracker: `qa/realism/baseline/pitch.ts` (pitchy MPM, gates, median-of-3 smoother), offline at 48 kHz, N=2048, hop 20 ms ±3 ms jitter, 128-frame quanta. Raw data: `qa/realism/out/report.json`.

Singer model: per-note intonation error, vibrato with onset delay and wander, 2nd-order (underdamped) legato transitions, scoops, drift, onset jitter, consonant noise bursts at lyric syllables, breath gaps, glottal source with jitter/shimmer/aspiration and 5 alto formants; channel: room reverb (RT60 0.4 s, −9 dB wet), 150 Hz phone-mic high-pass, background noise at 32 dB SNR, optional speaker bleed of the backing. Latency: true acoustic round trip vs what the app assumes.

Levels (standard strictness): L1 = 70 % tempo, ±50¢, guide on, pass 75 %; L4 = 100 % tempo, ±25¢, pass 85 %. "In tune" = `pitch`, the letter comes from `accuracy` (S ≥ 95, A ≥ 85, B ≥ 70, C ≥ 50).

## Key numbers

- **Good choir singer, L1, calibrated (true = assumed = 150 ms):** in tune 99% (min 98%), accuracy 100% (min 99%), letters S×6, passes 6/6
- **Good choir singer, L4, calibrated (true = assumed = 150 ms):** in tune 97% (min 95%), accuracy 98% (min 94%), letters S×5 A×1, passes 6/6
- **Good choir singer, L1, uncalibrated phone (true 200, assumed 80):** in tune 96% (min 90%), accuracy 98% (min 96%), letters S×6, passes 6/6
- **Good choir singer, L4, uncalibrated phone (true 200, assumed 80):** in tune 78% (min 47%), accuracy 88% (min 67%), letters S×2 A×2 B×1 C×1, passes 4/6
- **Good choir singer, L1, uncalibrated phone (true 280, assumed 80):** in tune 79% (min 49%), accuracy 90% (min 59%), letters S×4 B×1 C×1, passes 5/6
- **Good choir singer, L4, uncalibrated phone (true 280, assumed 80):** in tune 58% (min 38%), accuracy 66% (min 45%), letters A×2 C×3 D×1, passes 2/6
- **Operatic vibrato, L1, calibrated (true = assumed = 150 ms):** in tune 100% (min 99%), accuracy 100% (min 99%), letters S×6, passes 6/6
- **Operatic vibrato, L4, calibrated (true = assumed = 150 ms):** in tune 94% (min 88%), accuracy 96% (min 92%), letters S×5 A×1, passes 6/6
- **Operatic vibrato, L1, uncalibrated phone (true 200, assumed 80):** in tune 95% (min 85%), accuracy 99% (min 96%), letters S×6, passes 6/6
- **Operatic vibrato, L4, uncalibrated phone (true 200, assumed 80):** in tune 78% (min 46%), accuracy 86% (min 55%), letters S×2 A×2 B×1 C×1, passes 4/6
- **Operatic vibrato, L1, uncalibrated phone (true 280, assumed 80):** in tune 80% (min 49%), accuracy 90% (min 62%), letters S×4 A×1 C×1, passes 5/6
- **Operatic vibrato, L4, uncalibrated phone (true 280, assumed 80):** in tune 55% (min 37%), accuracy 63% (min 42%), letters A×2 C×2 D×2, passes 2/6
- **Same takes, perfect tracker + true latency ("oracle"), good singer:** L1 100% in tune / 100% accuracy; L4 99% / 99%.
- **Tracker (good singer, N=2048):** steady-state median |error| 3.5¢ (p90 8.5¢); within ±150 ms of transitions p90 19.0¢, p99 118.2¢; readings >50¢ off the truth: 1% overall, 3% near transitions, 0% in steady parts.
- **Overshoot:** voice overshoot (pitch centre) 28¢ (13% of the interval), tracker shows 19¢; tracker invents >25¢ extra overshoot in 0% of transitions. Control voice without overshoot: tracker shows 3¢ (invented in 0%). Ringing voice (ζ≈0.35): voice 68¢, tracker 50¢.
- **Live cents bubble right after a note change (good singer, L1):** shows > tolerance toward the *previous* note in 100% of changes when calibrated, 100% at true 200/assumed 80, 100% at 280/80; beyond the new note (displayed "overshoot") in 5% / 6% / 4%; out of tolerance until 148 / 260 / 320 ms after the bar changes.
- **Repeatability dieu-1-5 L1 cal (same performance, micro-randomness only, 10 seeds):** accuracy 100%–100% (sd 0.0 pts), in tune 99%–100%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L1 cal (performance varies too, 10 seeds):** accuracy 96%–100% (sd 1.2 pts), in tune 96%–100%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L1 uncal200 (same performance, micro-randomness only, 10 seeds):** accuracy 96%–97% (sd 0.4 pts), in tune 85%–94%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L1 uncal200 (performance varies too, 10 seeds):** accuracy 94%–97% (sd 0.9 pts), in tune 76%–95%, letters S×8 A×2, passes 10/10.
- **Repeatability dieu-1-5 L4 cal (same performance, micro-randomness only, 10 seeds):** accuracy 97%–99% (sd 0.8 pts), in tune 95%–99%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L4 cal (performance varies too, 10 seeds):** accuracy 95%–100% (sd 1.3 pts), in tune 91%–99%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L4 uncal200 (same performance, micro-randomness only, 10 seeds):** accuracy 55%–67% (sd 3.8 pts), in tune 46%–48%, letters C×10, passes 0/10.
- **Repeatability dieu-1-5 L4 uncal200 (performance varies too, 10 seeds):** accuracy 57%–80% (sd 6.4 pts), in tune 45%–54%, letters B×2 C×8, passes 0/10.
- **Repeatability warmup-7-12 L1 uncal200 (same performance, micro-randomness only, 10 seeds):** accuracy 99%–100% (sd 0.3 pts), in tune 96%–99%, letters S×10, passes 10/10.
- **Repeatability warmup-7-12 L4 cal (same performance, micro-randomness only, 10 seeds):** accuracy 99%–100% (sd 0.5 pts), in tune 99%–99%, letters S×10, passes 10/10.
- **Phone speaker instead of headphones (good singer, calibrated, mean of 2 sections):** bleed −18 dB: L1 97% acc / 95% in tune (2% octave/subharmonic readings), L4 85% acc / 83% in tune (9% octave/subharmonic readings); −13 dB: L1 82% acc / 82% in tune (7% octave/subharmonic readings), L4 46% acc / 44% in tune (51% octave/subharmonic readings); −8 dB: L1 38% acc / 34% in tune (46% octave/subharmonic readings), L4 16% acc / 16% in tune (83% octave/subharmonic readings).
- **Three runs in a row, new uncalibrated singer, dieu bars 1–5 (shown letters per seed):** L1 true 250 ms: S/S/S, S/S/S, S/S/S, S/S/S; L1 true 300 ms: S/S/S, S/S/S, S/S/S, S/S/S; L2 true 200 ms: C/B/C, B/C/C, C/C/C, C/C/C; L2 true 215 ms: C/C/C, C/C/C, C/S/S, S/S/S; L2 true 230 ms: S/S/S, S/S/S, S/S/S, S/S/S.
- **Sanity:** every bad-singer run that must fail fails. Wrong notes (40 %): max accuracy 75%. Flat −40¢ passes L1 in 5/6 runs (−40¢ is inside L1's ±50¢ window, by design), and fails L2 and L4.
- **WAV round trip** (16-bit file + sidecar through `scoreRecording`): accuracy 96% direct vs 96% via `qa/realism/out/example-dieu-1-5-alto-L1-uncal200.wav`.

## Observations (baseline)

1. **With calibrated latency and headphones, the baseline scores a good singer fairly.** The good choir singer gets S on all 6 sections at L1 and 5 of 6 at L4 (in tune 95–100 %). The "oracle" (true f0 + true latency) gives 99–100 %, so neither the tracker nor the scorer loses meaningful points on a realistic voice when timing is right. The ablation agrees: idealised → + scatter/drift → + small vibrato → + 2nd-order transitions → + onset jitter → + consonants stays at 97–100 % in tune and accuracy at every step.
2. **Latency mismatch is the dominant cause of lost points.** True 200 ms vs assumed 80 ms costs little at L1 (70 % tempo, ±50¢) but at L4 it drops in tune to 47–91 % (mean 78 %) and fails 2 of 6 sections. Debussy bars 1–5 (0.17 s ornaments) drop to C, 47 % in tune with "avg −1¢". At 280/80, L1 Debussy bars 1–5 is C (49 % in tune) and L4 is C/D on 4 of 6 sections. The lost body time sits at note starts ("early" column mostly 75–100 %): the previous note's pitch is still in the first part of each body. This is complaint 2, and it is also the best match for complaint 4 ("avg +3¢ but 90 % in tune"). Several uncalibrated L4 rows show |avg| ≤ 5¢ with 82–91 % in tune.
3. **The latency learning in Play.tsx has a cliff.** It fires only when the median onset / rate > 170 ms (and IQR / rate < 120 ms). At L1 that means a true round trip somewhere between 200 and 250 ms; at L2/L4 (rate 1.0), about 215–230 ms. Above the cliff, the run is re-scored and every later run is S. Below it, nothing is learned and a 200 ms phone stays at C/B on Debussy at L2 every time. Near the cliff it is random: at L2 with a true 215 ms the 4 seeds give C/C/C, C/C/C, **C/S/S** and S/S/S. In C/S/S, run 1 learns nothing, run 2 learns the delay (and is re-scored), and run 3 uses it. That is the C/A/A pattern Jenny reported. Micro-randomness alone (same performance) moves calibrated accuracy by ≤ 0.8 pts sd and never changes the letter, so the scorer itself is stable.
4. **The tracker does not invent overshoot (with headphones).** Voice overshoot after legato changes is 28¢ (13 % of the interval) for the good singer and 68¢ for a ringing voice (ζ≈0.35). The smoothed tracker shows less: 19¢ and 50¢. Against a control voice with no overshoot it shows 3¢, and in 0 % of transitions does it show more than 25¢ beyond the true pitch. Steady-state error is 3.5¢ median (p90 8.5¢); spikes over 50¢ occur only within ±150 ms of transitions (3 % of those readings). The "sinc-like wiggle" in the trace is real voice dynamics (2nd-order ringing plus vibrato starting), slightly smoothed. N=1024 or a 10 ms hop changes the scores by ≤ 2 pts; they mostly show more of the real overshoot.
5. **What the singer sees right after a note change is mostly readout lag, not overshoot.** The cents bubble compares the *latest* reading with the note under the *playhead*. The latest reading is always ≥ input latency + half a window + one hop behind the playhead, so for about 150 ms after every bar change (calibrated) the bubble shows the previous pitch against the new target. This takes 260 ms at 200/80 and 320 ms at 280/80. "Beyond the new note" readouts happen in only ~5 % of changes. Comparing the readout with the note at the sample's own score time would remove this.
6. **Practising on the phone speaker breaks the tracker.** With the backing bleeding into the mic, MPM locks onto the common period of the voice and the equal-tempered backing. It reads f0/3 (−19 st, voice + a part a fifth away) or an octave below; the smoother's octave guard does not catch −19 st. At −18 dB bleed, L4 loses 4–25 pts. At −13 dB, half of the L4 readings are octave/subharmonic errors (C/D grades). At −8 dB, everything fails. L1 suffers less because the guide (own part) reinforces the singer's period. The trace shows these as huge jumps, clamped to the edge of the highway, and they cluster at transitions (+12 % "invented" excursions). So if Jenny practised without headphones, this alone explains "massive overshoot" and erratic grades.
7. **Scoring mechanisms that cost points:** (a) the fixed 80 ms onset grace is in score time and cannot absorb a latency error (raising it to 0.15–0.25 s recovers up to 10 pts of in tune at L4 uncal200, e.g. Debussy 47 → 57 %, which is still B); (b) the vibrato window works: without it, operatic vibrato at L4 drops from 91–97 % to 54–68 % in tune; with it, a small vibrato costs nothing (ablation step 2), so vibrato alone does not reproduce complaint 4; (c) grade steps: "perfect" needs |median| ≤ tol/2 (12.5¢ at L4), and good singers lose 0–4 notes per section to that rule (operatic up to 7/42), while one "ok" in a 16-note section costs 3 pts; (d) the short-note leniency (body < 150 ms gets "good" from any in-tolerance raw sample) lets misaligned neighbour pitches count: the 40 % wrong-note singer scores *higher* uncalibrated (75 % vs 67 % on Debussy bars 1–5 at L1, 0.2 pts short of passing).
8. **Sanity:** wrong notes (40 %) fail everywhere. A −40¢ flat singer passes L1 with B on 5 of 6 runs because −40¢ is inside L1's ±50¢ window; this follows from the level design (L2 and L4 fail).

## 1. Tracker fidelity (smoothed output vs ground-truth f0, cents)

Takes: dieu-1-5 and warmup-7-12 (Alto), L4 tempo, calibrated, headphones, unless noted. "near" = within ±150 ms of a pitch change or voice onset. ">50¢" = readings off the true sung pitch by more than 50¢ (spikes the voice does not have). Overshoot = largest excursion beyond the new note in the 400 ms after a legato change (voice centre / tracker). "Scored" = mean in-tune and accuracy of those takes with this tracker.

| singer | tracker | steady med/p90 | near med/p90/p99 | >50¢ steady / near | octave | missed voiced | false voiced | overshoot voice → tracker | invented | scored in tune / acc |
|---|---|---|---|---|---|---|---|---|---|---|
| good choir singer | N2048 hop20 | 3.5 / 8.5 | 4.9 / 19.0 / 118 | 0% / 3% | 0% | 2% | 14% | 28 → 19 | 0% | 99% / 99% |
| good choir singer | N1024 hop20 | 3.7 / 9.1 | 5.1 / 21.0 / 122 | 0% / 3% | 0% | 2% | 13% | 28 → 22 | 3% | 96% / 99% |
| good choir singer | N1024 hop10 | 3.9 / 9.4 | 5.1 / 18.2 / 112 | 0% / 3% | 0% | 2% | 9% | 28 → 26 | 0% | 99% / 99% |
| operatic vibrato | N2048 hop20 | 7.6 / 19.9 | 8.5 / 25.2 / 74 | 0% / 2% | 0% | 2% | 15% | 41 → 34 | 0% | 94% / 96% |
| operatic vibrato | N1024 hop20 | 6.9 / 19.5 | 8.0 / 26.1 / 73 | 0% / 2% | 0% | 2% | 13% | 41 → 39 | 0% | 96% / 96% |
| operatic vibrato | N1024 hop10 | 6.4 / 17.8 | 7.7 / 22.7 / 69 | 0% / 2% | 0% | 2% | 9% | 41 → 47 | 0% | 94% / 97% |
| control (no vibrato, no overshoot) | N2048 hop20 | 2.0 / 5.6 | 2.8 / 20.3 / 75 | 0% / 3% | 0% | 3% | 14% | 2 → 3 | 0% | 97% / 99% |
| control (no vibrato, no overshoot) | N1024 hop20 | 2.5 / 6.6 | 3.2 / 16.7 / 58 | 0% / 2% | 0% | 2% | 14% | 2 → 5 | 0% | 95% / 99% |
| control (no vibrato, no overshoot) | N1024 hop10 | 3.1 / 8.5 | 3.9 / 15.8 / 57 | 0% / 1% | 0% | 2% | 10% | 2 → 7 | 0% | 98% / 98% |
| ringing transitions (zeta 0.35) | N2048 hop20 | 3.4 / 8.8 | 5.8 / 27.9 / 77 | 0% / 4% | 0% | 2% | 13% | 68 → 50 | 0% | 91% / 92% |
| ringing transitions (zeta 0.35) | N1024 hop20 | 3.9 / 9.3 | 6.0 / 29.6 / 121 | 0% / 4% | 0% | 3% | 11% | 68 → 52 | 0% | 84% / 94% |
| ringing transitions (zeta 0.35) | N1024 hop10 | 3.8 / 9.7 | 6.0 / 25.5 / 67 | 0% / 2% | 0% | 2% | 9% | 68 → 61 | 0% | 91% / 95% |
| good choir singer + speaker bleed (L1) | N2048 hop20 | 5.0 / 14.4 | 6.0 / 95.9 / 1904 | 8% / 11% | 8% | 4% | 9% | 29 → 196 | 12% | 82% / 84% |
| good choir singer + speaker bleed (L1) | N1024 hop20 | 5.4 / 17.5 | 5.9 / 1186.0 / 1904 | 8% / 12% | 8% | 3% | 8% | 29 → 244 | 15% | 82% / 84% |
| good choir singer + speaker bleed (L1) | N1024 hop10 | 5.2 / 18.6 | 5.9 / 1186.7 / 1908 | 8% / 11% | 9% | 3% | 6% | 29 → 251 | 15% | 81% / 83% |

Raw (unsmoothed) detector, N=2048, good singer: steady median 3.4¢ p90 8.4¢, near transitions p90 19.3¢ p99 103¢, >50¢ near 3%.

## 2. Good singers: latency × section × level

"learned" = what the Results screen shows after Play.tsx learns the delay from late entries and re-scores (uncalibrated profiles only; blank = the rule did not fire). "oracle" = same take scored from the true f0 with the true latency (no tracker, no latency error). Loss: notes perfect / demoted to good only by |median| > tol/2 / hit ratio < 0.8; "early" = share of out-of-tolerance body samples in the first 150 ms of the note body.

### good choir singer

| section | L | latency | in tune | rhythm | acc | grade | pass | avg | learned → acc/grade | oracle in tune/acc | perfect / median-demoted / low-hit | early | bubble lag/over |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| warmup-upbeat-6 | 1 | cal | 100% | 100% | 100% | S | pass | +4¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 0% | 100% / 0% |
| warmup-upbeat-6 | 1 | uncal200 | 98% | 99% | 100% | S | pass | +4¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 100% | 100% / 0% |
| warmup-upbeat-6 | 1 | uncal280 | 90% | 89% | 99% | S | pass | +5¢ | 255 ms → 100% S | 100% / 100% | 20 / 0 / 1 (of 21) | 100% | 100% / 0% |
| warmup-upbeat-6 | 4 | cal | 100% | 100% | 98% | S | pass | ±0¢ |  | 100% / 99% | 18 / 3 / 0 (of 21) | 0% | 100% / 21% |
| warmup-upbeat-6 | 4 | uncal200 | 89% | 92% | 97% | S | pass | +3¢ |  | 100% / 100% | 17 / 1 / 3 (of 21) | 94% | 100% / 21% |
| warmup-upbeat-6 | 4 | uncal280 | 81% | 78% | 91% | A | pass | +2¢ | 254 ms → 100% S | 100% / 99% | 9 / 1 / 11 (of 21) | 73% | 100% / 21% |
| warmup-7-12 | 1 | cal | 99% | 100% | 100% | S | pass | ±0¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 0% | 100% / 7% |
| warmup-7-12 | 1 | uncal200 | 98% | 99% | 99% | S | pass | −1¢ |  | 100% / 100% | 20 / 0 / 1 (of 21) | 100% | 100% / 14% |
| warmup-7-12 | 1 | uncal280 | 90% | 89% | 100% | S | pass | +1¢ | 248 ms → 100% S | 100% / 100% | 21 / 0 / 0 (of 21) | 100% | 100% / 14% |
| warmup-7-12 | 4 | cal | 99% | 100% | 99% | S | pass | −1¢ |  | 100% / 100% | 20 / 1 / 0 (of 21) | 0% | 100% / 7% |
| warmup-7-12 | 4 | uncal200 | 86% | 91% | 95% | A | pass | −2¢ |  | 100% / 100% | 16 / 0 / 5 (of 21) | 55% | 100% / 14% |
| warmup-7-12 | 4 | uncal280 | 82% | 77% | 94% | A | pass | −4¢ | 254 ms → 99% S | 100% / 99% | 12 / 0 / 9 (of 21) | 74% | 100% / 7% |
| dieu-1-5 | 1 | cal | 100% | 100% | 100% | S | pass | +2¢ |  | 100% / 100% | 24 / 0 / 0 (of 24) | 0% | 100% / 5% |
| dieu-1-5 | 1 | uncal200 | 90% | 99% | 96% | S | pass | +2¢ |  | 100% / 100% | 18 / 4 / 2 (of 24) | 100% | 100% / 5% |
| dieu-1-5 | 1 | uncal280 | 49% | 55% | 59% | C | FAIL | +3¢ | 256 ms → 100% S | 100% / 100% | 9 / 0 / 15 (of 24) | 100% | 100% / 0% |
| dieu-1-5 | 4 | cal | 99% | 100% | 99% | S | pass | ±0¢ |  | 100% / 99% | 23 / 1 / 0 (of 24) | 100% | 100% / 5% |
| dieu-1-5 | 4 | uncal200 | 47% | 63% | 67% | C | FAIL | ±0¢ |  | 100% / 99% | 7 / 0 / 17 (of 24) | 98% | 100% / 10% |
| dieu-1-5 | 4 | uncal280 | 38% | 52% | 45% | D | FAIL | ±0¢ | 263 ms → 99% S | 100% / 99% | 4 / 0 / 20 (of 24) | 81% | 85% / 10% |
| dieu-6-13 | 1 | cal | 99% | 100% | 100% | S | pass | −2¢ |  | 100% / 100% | 41 / 0 / 1 (of 42) | 100% | 100% / 3% |
| dieu-6-13 | 1 | uncal200 | 96% | 99% | 99% | S | pass | −1¢ |  | 100% / 100% | 40 / 0 / 2 (of 42) | 100% | 100% / 6% |
| dieu-6-13 | 1 | uncal280 | 65% | 82% | 85% | B | pass | ±0¢ | 256 ms → 100% S | 100% / 100% | 16 / 1 / 25 (of 42) | 100% | 100% / 6% |
| dieu-6-13 | 4 | cal | 95% | 100% | 98% | S | pass | +2¢ |  | 99% / 99% | 35 / 4 / 3 (of 42) | 33% | 100% / 15% |
| dieu-6-13 | 4 | uncal200 | 69% | 89% | 84% | B | FAIL | +1¢ |  | 99% / 99% | 20 / 2 / 20 (of 42) | 99% | 100% / 18% |
| dieu-6-13 | 4 | uncal280 | 46% | 58% | 54% | C | FAIL | −1¢ | 231 ms → 98% S | 99% / 100% | 11 / 0 / 31 (of 42) | 87% | 100% / 15% |
| tabourin-solo-1-8 | 1 | cal | 100% | 100% | 100% | S | pass | +1¢ |  | 100% / 100% | 16 / 0 / 0 (of 16) | 0% | 100% / 0% |
| tabourin-solo-1-8 | 1 | uncal200 | 97% | 98% | 99% | S | pass | ±0¢ |  | 100% / 100% | 15 / 0 / 1 (of 16) | 100% | 100% / 0% |
| tabourin-solo-1-8 | 1 | uncal280 | 92% | 88% | 98% | S | pass | −1¢ | 253 ms → 100% S | 100% / 100% | 14 / 0 / 2 (of 16) | 100% | 100% / 0% |
| tabourin-solo-1-8 | 4 | cal | 95% | 100% | 97% | S | pass | +5¢ |  | 99% / 98% | 13 / 2 / 1 (of 16) | 100% | 100% / 0% |
| tabourin-solo-1-8 | 4 | uncal200 | 90% | 88% | 95% | S | pass | +3¢ |  | 99% / 99% | 11 / 2 / 3 (of 16) | 89% | 100% / 0% |
| tabourin-solo-1-8 | 4 | uncal280 | 47% | 72% | 52% | C | FAIL | +4¢ | 260 ms → 98% S | 99% / 98% | 3 / 1 / 12 (of 16) | 94% | 100% / 8% |
| tabourin-solo-9-16 | 1 | cal | 98% | 100% | 99% | S | pass | −2¢ |  | 100% / 100% | 22 / 0 / 1 (of 23) | 0% | 100% / 18% |
| tabourin-solo-9-16 | 1 | uncal200 | 96% | 99% | 96% | S | pass | −3¢ |  | 100% / 100% | 22 / 0 / 1 (of 23) | 31% | 100% / 12% |
| tabourin-solo-9-16 | 1 | uncal280 | 89% | 89% | 99% | S | pass | −5¢ | 222 ms → 100% S | 100% / 100% | 21 / 0 / 2 (of 23) | 98% | 100% / 6% |
| tabourin-solo-9-16 | 4 | cal | 95% | 100% | 94% | A | pass | +3¢ |  | 99% / 100% | 20 / 1 / 2 (of 23) | 8% | 100% / 24% |
| tabourin-solo-9-16 | 4 | uncal200 | 86% | 91% | 90% | A | pass | +1¢ |  | 99% / 100% | 13 / 4 / 6 (of 23) | 78% | 100% / 24% |
| tabourin-solo-9-16 | 4 | uncal280 | 51% | 75% | 58% | C | FAIL | +2¢ | 240 ms → 99% S | 99% / 100% | 6 / 1 / 16 (of 23) | 80% | 100% / 12% |

### operatic vibrato

| section | L | latency | in tune | rhythm | acc | grade | pass | avg | learned → acc/grade | oracle in tune/acc | perfect / median-demoted / low-hit | early | bubble lag/over |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| warmup-upbeat-6 | 1 | cal | 100% | 100% | 100% | S | pass | +2¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 0% | 100% / 0% |
| warmup-upbeat-6 | 1 | uncal200 | 98% | 99% | 100% | S | pass | ±0¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 100% | 100% / 0% |
| warmup-upbeat-6 | 1 | uncal280 | 90% | 89% | 99% | S | pass | +9¢ | 255 ms → 100% S | 100% / 100% | 19 / 2 / 0 (of 21) | 100% | 100% / 0% |
| warmup-upbeat-6 | 4 | cal | 96% | 100% | 96% | S | pass | −2¢ |  | 99% / 97% | 16 / 3 / 2 (of 21) | 0% | 100% / 14% |
| warmup-upbeat-6 | 4 | uncal200 | 89% | 92% | 96% | S | pass | +5¢ |  | 99% / 98% | 15 / 3 / 3 (of 21) | 75% | 100% / 36% |
| warmup-upbeat-6 | 4 | uncal280 | 79% | 77% | 90% | A | pass | +2¢ | 259 ms → 97% S | 97% / 98% | 7 / 3 / 11 (of 21) | 69% | 100% / 29% |
| warmup-7-12 | 1 | cal | 100% | 100% | 99% | S | pass | ±0¢ |  | 100% / 100% | 20 / 1 / 0 (of 21) | 0% | 100% / 14% |
| warmup-7-12 | 1 | uncal200 | 98% | 98% | 99% | S | pass | −2¢ |  | 100% / 100% | 20 / 0 / 1 (of 21) | 92% | 100% / 14% |
| warmup-7-12 | 1 | uncal280 | 90% | 90% | 99% | S | pass | ±0¢ | 248 ms → 100% S | 100% / 100% | 19 / 0 / 2 (of 21) | 97% | 100% / 7% |
| warmup-7-12 | 4 | cal | 97% | 100% | 98% | S | pass | −3¢ |  | 98% / 99% | 18 / 3 / 0 (of 21) | 0% | 100% / 21% |
| warmup-7-12 | 4 | uncal200 | 90% | 91% | 96% | S | pass | −1¢ |  | 99% / 98% | 16 / 2 / 3 (of 21) | 90% | 100% / 21% |
| warmup-7-12 | 4 | uncal280 | 82% | 78% | 91% | A | pass | −3¢ | 250 ms → 98% S | 98% / 99% | 9 / 1 / 11 (of 21) | 82% | 100% / 29% |
| dieu-1-5 | 1 | cal | 100% | 100% | 100% | S | pass | ±0¢ |  | 100% / 100% | 24 / 0 / 0 (of 24) | 100% | 100% / 0% |
| dieu-1-5 | 1 | uncal200 | 85% | 99% | 96% | S | pass | +4¢ |  | 100% / 99% | 17 / 4 / 3 (of 24) | 100% | 100% / 5% |
| dieu-1-5 | 1 | uncal280 | 49% | 55% | 62% | C | FAIL | +2¢ | 260 ms → 100% S | 100% / 99% | 9 / 0 / 15 (of 24) | 100% | 100% / 0% |
| dieu-1-5 | 4 | cal | 91% | 100% | 96% | S | pass | −3¢ |  | 94% / 97% | 17 / 5 / 2 (of 24) | 33% | 100% / 5% |
| dieu-1-5 | 4 | uncal200 | 46% | 60% | 55% | C | FAIL | +2¢ |  | 95% / 98% | 7 / 0 / 17 (of 24) | 87% | 100% / 15% |
| dieu-1-5 | 4 | uncal280 | 37% | 52% | 42% | D | FAIL | +1¢ | 265 ms → 95% S | 95% / 99% | 4 / 0 / 20 (of 24) | 79% | 95% / 10% |
| dieu-6-13 | 1 | cal | 99% | 100% | 100% | S | pass | ±0¢ |  | 100% / 100% | 42 / 0 / 0 (of 42) | 100% | 100% / 6% |
| dieu-6-13 | 1 | uncal200 | 96% | 99% | 99% | S | pass | −1¢ |  | 100% / 100% | 39 / 1 / 2 (of 42) | 100% | 100% / 0% |
| dieu-6-13 | 1 | uncal280 | 66% | 82% | 86% | A | pass | −2¢ | 256 ms → 100% S | 100% / 100% | 19 / 2 / 21 (of 42) | 100% | 100% / 9% |
| dieu-6-13 | 4 | cal | 88% | 100% | 92% | A | pass | ±0¢ |  | 94% / 97% | 30 / 5 / 7 (of 42) | 57% | 97% / 21% |
| dieu-6-13 | 4 | uncal200 | 68% | 87% | 81% | B | FAIL | +3¢ |  | 95% / 98% | 19 / 3 / 20 (of 42) | 94% | 100% / 18% |
| dieu-6-13 | 4 | uncal280 | 44% | 59% | 53% | C | FAIL | ±0¢ | 231 ms → 96% S | 98% / 97% | 10 / 0 / 32 (of 42) | 83% | 100% / 18% |
| tabourin-solo-1-8 | 1 | cal | 100% | 100% | 100% | S | pass | +3¢ |  | 100% / 100% | 16 / 0 / 0 (of 16) | 19% | 100% / 0% |
| tabourin-solo-1-8 | 1 | uncal200 | 98% | 98% | 99% | S | pass | +1¢ |  | 100% / 100% | 15 / 1 / 0 (of 16) | 87% | 100% / 0% |
| tabourin-solo-1-8 | 1 | uncal280 | 90% | 88% | 97% | S | pass | ±0¢ | 249 ms → 100% S | 100% / 100% | 13 / 1 / 2 (of 16) | 98% | 100% / 8% |
| tabourin-solo-1-8 | 4 | cal | 95% | 100% | 98% | S | pass | +5¢ |  | 98% / 98% | 14 / 2 / 0 (of 16) | 17% | 100% / 0% |
| tabourin-solo-1-8 | 4 | uncal200 | 88% | 90% | 93% | A | pass | +4¢ |  | 99% / 97% | 8 / 4 / 4 (of 16) | 91% | 100% / 17% |
| tabourin-solo-1-8 | 4 | uncal280 | 40% | 72% | 43% | D | FAIL | +7¢ | 260 ms → 96% S | 98% / 97% | 2 / 1 / 13 (of 16) | 85% | 100% / 0% |
| tabourin-solo-9-16 | 1 | cal | 100% | 100% | 100% | S | pass | −5¢ |  | 100% / 100% | 23 / 0 / 0 (of 23) | 33% | 100% / 12% |
| tabourin-solo-9-16 | 1 | uncal200 | 98% | 98% | 99% | S | pass | −2¢ |  | 100% / 100% | 22 / 0 / 1 (of 23) | 100% | 100% / 24% |
| tabourin-solo-9-16 | 1 | uncal280 | 91% | 88% | 97% | S | pass | −6¢ | 222 ms → 100% S | 100% / 100% | 19 / 3 / 1 (of 23) | 100% | 100% / 12% |
| tabourin-solo-9-16 | 4 | cal | 98% | 100% | 97% | S | pass | +2¢ |  | 99% / 99% | 19 / 3 / 1 (of 23) | 38% | 100% / 29% |
| tabourin-solo-9-16 | 4 | uncal200 | 87% | 91% | 93% | A | pass | +3¢ |  | 99% / 99% | 15 / 4 / 4 (of 23) | 78% | 100% / 35% |
| tabourin-solo-9-16 | 4 | uncal280 | 50% | 75% | 59% | C | FAIL | +2¢ | 240 ms → 92% A | 98% / 100% | 5 / 2 / 16 (of 23) | 68% | 100% / 29% |

### Phone speaker, no headphones (backing bleeds into the mic; speaker high-passed at 400 Hz)

Bleed level is the backing RMS relative to the voice RMS at the mic. L1 includes the own part (guide) in the backing, L4 only the other parts. "octave/subharm." = share of voiced readings more than 600¢ off the true sung pitch.

| singer | bleed | section | L | latency | in tune | rhythm | acc | grade | pass | octave/subharm. | >50¢ off | learned |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| good choir singer | -18 dB | dieu-1-5 | 1 | cal | 95% | 100% | 99% | S | pass | 1% | 1% |  |
| good choir singer | -18 dB | dieu-1-5 | 4 | cal | 92% | 96% | 95% | A | pass | 3% | 4% |  |
| good choir singer | -18 dB | warmup-7-12 | 1 | cal | 95% | 95% | 95% | S | pass | 4% | 4% |  |
| good choir singer | -18 dB | warmup-7-12 | 4 | cal | 73% | 80% | 75% | B | FAIL | 15% | 16% |  |
| good choir singer | -13 dB | dieu-1-5 | 1 | cal | 86% | 96% | 87% | A | pass | 4% | 4% |  |
| good choir singer | -13 dB | dieu-1-5 | 4 | cal | 58% | 92% | 63% | C | FAIL | 51% | 52% |  |
| good choir singer | -13 dB | warmup-7-12 | 1 | cal | 78% | 88% | 76% | B | pass | 11% | 11% |  |
| good choir singer | -13 dB | warmup-7-12 | 4 | cal | 30% | 67% | 30% | D | FAIL | 52% | 52% |  |
| good choir singer | -8 dB | dieu-1-5 | 1 | cal | 30% | 82% | 36% | D | FAIL | 53% | 54% |  |
| good choir singer | -8 dB | dieu-1-5 | 4 | cal | 21% | 65% | 21% | D | FAIL | 82% | 83% |  |
| good choir singer | -8 dB | warmup-7-12 | 1 | cal | 38% | 64% | 39% | D | FAIL | 39% | 39% |  |
| good choir singer | -8 dB | warmup-7-12 | 4 | cal | 11% | 55% | 11% | D | FAIL | 84% | 85% |  |
| good choir singer | -13 dB | dieu-1-5 | 1 | uncal200 | 60% | 85% | 69% | C | FAIL | 24% | 25% |  |
| good choir singer | -13 dB | dieu-1-5 | 4 | uncal200 | 26% | 57% | 42% | D | FAIL | 54% | 55% |  |
| good choir singer | -13 dB | warmup-7-12 | 1 | uncal200 | 69% | 80% | 71% | B | FAIL | 19% | 20% |  |
| good choir singer | -13 dB | warmup-7-12 | 4 | uncal200 | 54% | 68% | 60% | C | FAIL | 27% | 27% |  |
| operatic vibrato | -13 dB | dieu-1-5 | 1 | cal | 82% | 96% | 91% | A | pass | 3% | 4% |  |
| operatic vibrato | -13 dB | dieu-1-5 | 4 | cal | 54% | 86% | 55% | C | FAIL | 36% | 39% |  |
| operatic vibrato | -13 dB | warmup-7-12 | 1 | cal | 85% | 89% | 86% | A | pass | 5% | 6% |  |
| operatic vibrato | -13 dB | warmup-7-12 | 4 | cal | 38% | 67% | 36% | D | FAIL | 36% | 39% |  |

## 3. Repeatability (good choir singer)

"micro" = identical performance (same intonation errors, timing, transitions), only glottal jitter/shimmer, noise, vibrato phase/wander and tracker hop jitter change. "performance" = a new, equally good performance each run (what "sang it the same way" really means for a human).

| section | L | latency | mode | accuracy min–max (sd) | in tune min–max | letters | shown letters | passes |
|---|---|---|---|---|---|---|---|---|
| dieu-1-5 | 1 | cal | micro | 100%–100% (0.0) | 99%–100% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 1 | cal | performance | 96%–100% (1.2) | 96%–100% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 1 | uncal200 | micro | 96%–97% (0.4) | 85%–94% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 1 | uncal200 | performance | 94%–97% (0.9) | 76%–95% | S×8 A×2 | S×8 A×2 | 10/10 |
| dieu-1-5 | 4 | cal | micro | 97%–99% (0.8) | 95%–99% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 4 | cal | performance | 95%–100% (1.3) | 91%–99% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 4 | uncal200 | micro | 55%–67% (3.8) | 46%–48% | C×10 | C×10 | 0/10 |
| dieu-1-5 | 4 | uncal200 | performance | 57%–80% (6.4) | 45%–54% | B×2 C×8 | B×2 C×8 | 0/10 |
| warmup-7-12 | 1 | uncal200 | micro | 99%–100% (0.3) | 96%–99% | S×10 | S×10 | 10/10 |
| warmup-7-12 | 4 | cal | micro | 99%–100% (0.5) | 99%–99% | S×10 | S×10 | 10/10 |

### Three runs in a row by a new (uncalibrated) singer, dieu bars 1–5

Run 1 uses the 80 ms estimate; when Play.tsx learns a delay, the run is re-scored with it ("shown") and later runs use the learned value.

| L | true latency | seed | run 1 (assumed → shown) | run 2 | run 3 |
|---|---|---|---|---|---|
| 1 | 250 ms | 1 | 80 ms: B 73% → learned 220 ms: S 100% | 220 ms: S 100% | 220 ms: S 100% |
| 1 | 250 ms | 2 | 80 ms: B 78% → learned 212 ms: S 100% | 212 ms: S 100% | 212 ms: S 100% |
| 1 | 250 ms | 3 | 80 ms: B 81% → learned 219 ms: S 100% | 219 ms: S 100% | 219 ms: S 100% |
| 1 | 250 ms | 4 | 80 ms: B 75% → learned 224 ms: S 100% | 224 ms: S 100% | 224 ms: S 100% |
| 1 | 300 ms | 1 | 80 ms: C 56% → learned 279 ms: S 100% | 279 ms: S 100% | 279 ms: S 100% |
| 1 | 300 ms | 2 | 80 ms: C 57% → learned 274 ms: S 100% | 274 ms: S 100% | 274 ms: S 100% |
| 1 | 300 ms | 3 | 80 ms: C 56% → learned 277 ms: S 100% | 277 ms: S 100% | 277 ms: S 100% |
| 1 | 300 ms | 4 | 80 ms: C 57% → learned 283 ms: S 100% | 283 ms: S 99% | 283 ms: S 100% |
| 2 | 200 ms | 1 | 80 ms: C 62% | 80 ms: B 71% | 80 ms: C 66% |
| 2 | 200 ms | 2 | 80 ms: B 72% | 80 ms: C 65% | 80 ms: C 70% |
| 2 | 200 ms | 3 | 80 ms: C 57% | 80 ms: C 59% | 80 ms: C 67% |
| 2 | 200 ms | 4 | 80 ms: C 70% | 80 ms: C 66% | 80 ms: C 67% |
| 2 | 215 ms | 1 | 80 ms: C 60% | 80 ms: C 57% | 80 ms: C 61% |
| 2 | 215 ms | 2 | 80 ms: C 57% | 80 ms: C 55% | 80 ms: C 57% |
| 2 | 215 ms | 3 | 80 ms: C 54% | 80 ms: C 57% → learned 207 ms: S 99% | 207 ms: S 98% |
| 2 | 215 ms | 4 | 80 ms: C 60% → learned 205 ms: S 99% | 205 ms: S 100% | 205 ms: S 99% |
| 2 | 230 ms | 1 | 80 ms: C 56% → learned 205 ms: S 99% | 205 ms: S 99% | 205 ms: S 99% |
| 2 | 230 ms | 2 | 80 ms: C 56% → learned 207 ms: S 100% | 207 ms: S 99% | 207 ms: S 98% |
| 2 | 230 ms | 3 | 80 ms: C 53% → learned 207 ms: S 96% | 207 ms: S 99% | 207 ms: S 98% |
| 2 | 230 ms | 4 | 80 ms: C 53% → learned 211 ms: S 99% | 211 ms: S 99% | 211 ms: S 99% |

## 4. Sanity: bad singers

| singer | section | L | latency | in tune | acc | grade | pass | learned |
|---|---|---|---|---|---|---|---|---|
| flat −40¢ | dieu-1-5 | 1 | cal | 75% | 79% | B | pass |  |
| flat −40¢ | dieu-1-5 | 1 | uncal200 | 67% | 78% | B | pass |  |
| flat −40¢ | dieu-1-5 | 2 | cal | 18% | 25% | D | FAIL |  |
| flat −40¢ | dieu-1-5 | 2 | uncal200 | 12% | 11% | D | FAIL |  |
| flat −40¢ | dieu-1-5 | 4 | cal | 3% | 6% | D | FAIL |  |
| flat −40¢ | dieu-1-5 | 4 | uncal200 | 7% | 13% | D | FAIL |  |
| flat −40¢ | warmup-7-12 | 1 | cal | 93% | 81% | B | pass |  |
| flat −40¢ | warmup-7-12 | 1 | uncal200 | 89% | 82% | B | pass |  |
| flat −40¢ | warmup-7-12 | 2 | cal | 38% | 35% | D | FAIL |  |
| flat −40¢ | warmup-7-12 | 2 | uncal200 | 35% | 36% | D | FAIL |  |
| flat −40¢ | warmup-7-12 | 4 | cal | 2% | 0% | D | FAIL |  |
| flat −40¢ | warmup-7-12 | 4 | uncal200 | 3% | 0% | D | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 1 | cal | 94% | 81% | B | pass |  |
| flat −40¢ | tabourin-solo-1-8 | 1 | uncal200 | 66% | 59% | C | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 2 | cal | 32% | 27% | D | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 2 | uncal200 | 23% | 21% | D | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 4 | cal | 13% | 11% | D | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 4 | uncal200 | 12% | 11% | D | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 1 | cal | 67% | 67% | C | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 1 | uncal200 | 62% | 75% | B | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 2 | cal | 65% | 66% | C | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 2 | uncal200 | 31% | 44% | D | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 4 | cal | 42% | 45% | D | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 4 | uncal200 | 15% | 25% | D | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 1 | cal | 57% | 57% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 1 | uncal200 | 57% | 57% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 2 | cal | 51% | 52% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 2 | uncal200 | 48% | 52% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 4 | cal | 57% | 56% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 4 | uncal200 | 54% | 56% | C | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 1 | cal | 68% | 69% | C | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 1 | uncal200 | 66% | 68% | C | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 2 | cal | 62% | 62% | C | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 2 | uncal200 | 56% | 62% | C | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 4 | cal | 43% | 44% | D | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 4 | uncal200 | 44% | 48% | D | FAIL |  |

## 5. Ablation: adding realism one factor at a time (calibrated, headphones)

| step | section | L | in tune | acc | grade | oracle in tune / acc | perfect / median-demoted / low-hit |
|---|---|---|---|---|---|---|---|
| 0 idealised (steady, instant steps, on time) | dieu-1-5 | 1 | 100% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 0 idealised (steady, instant steps, on time) | dieu-1-5 | 4 | 99% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 0 idealised (steady, instant steps, on time) | warmup-7-12 | 1 | 100% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 0 idealised (steady, instant steps, on time) | warmup-7-12 | 4 | 100% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 1 + intonation scatter (sd 5¢) & drift | dieu-1-5 | 1 | 100% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 1 + intonation scatter (sd 5¢) & drift | dieu-1-5 | 4 | 99% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 1 + intonation scatter (sd 5¢) & drift | warmup-7-12 | 1 | 100% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 1 + intonation scatter (sd 5¢) & drift | warmup-7-12 | 4 | 100% | 100% | S | 100% / 99% | 21 / 0 / 0 |
| 2 + small vibrato (±20¢, 5.5 Hz) | dieu-1-5 | 1 | 100% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 2 + small vibrato (±20¢, 5.5 Hz) | dieu-1-5 | 4 | 100% | 99% | S | 100% / 99% | 22 / 2 / 0 |
| 2 + small vibrato (±20¢, 5.5 Hz) | warmup-7-12 | 1 | 100% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 2 + small vibrato (±20¢, 5.5 Hz) | warmup-7-12 | 4 | 100% | 99% | S | 100% / 99% | 20 / 1 / 0 |
| 3 + 2nd-order transitions & scoops | dieu-1-5 | 1 | 100% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 3 + 2nd-order transitions & scoops | dieu-1-5 | 4 | 100% | 99% | S | 100% / 99% | 22 / 2 / 0 |
| 3 + 2nd-order transitions & scoops | warmup-7-12 | 1 | 100% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 3 + 2nd-order transitions & scoops | warmup-7-12 | 4 | 99% | 97% | S | 100% / 98% | 17 / 4 / 0 |
| 4 + onset jitter ±25 ms | dieu-1-5 | 1 | 100% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 4 + onset jitter ±25 ms | dieu-1-5 | 4 | 100% | 99% | S | 100% / 99% | 22 / 2 / 0 |
| 4 + onset jitter ±25 ms | warmup-7-12 | 1 | 100% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 4 + onset jitter ±25 ms | warmup-7-12 | 4 | 100% | 98% | S | 100% / 99% | 18 / 3 / 0 |
| 5 + consonants (= full good singer) | dieu-1-5 | 1 | 100% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 5 + consonants (= full good singer) | dieu-1-5 | 4 | 99% | 99% | S | 100% / 99% | 23 / 1 / 0 |
| 5 + consonants (= full good singer) | warmup-7-12 | 1 | 99% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 5 + consonants (= full good singer) | warmup-7-12 | 4 | 99% | 99% | S | 100% / 100% | 20 / 1 / 0 |

## 6. Scoring-option sensitivity (same samples re-scored)

| singer | section | L | latency | default (vibWin 0.18, grace 0.08) | vibratoWindow 0 | vibratoWindow 0.30 | onsetGrace 0.15 | onsetGrace 0.25 |
|---|---|---|---|---|---|---|---|---|
| good choir singer | warmup-7-12 | 1 | cal | 99% / 100% S | 99% / 100% S | 99% / 100% S | 99% / 100% S | 99% / 100% S |
| good choir singer | warmup-7-12 | 1 | uncal200 | 98% / 99% S | 98% / 100% S | 98% / 99% S | 100% / 100% S | 100% / 100% S |
| good choir singer | warmup-7-12 | 4 | cal | 99% / 99% S | 95% / 99% S | 99% / 99% S | 98% / 99% S | 98% / 98% S |
| good choir singer | warmup-7-12 | 4 | uncal200 | 86% / 95% A | 89% / 99% S | 84% / 90% A | 94% / 95% S | 96% / 95% S |
| good choir singer | dieu-1-5 | 1 | cal | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| good choir singer | dieu-1-5 | 1 | uncal200 | 90% / 96% S | 81% / 95% S | 90% / 96% S | 91% / 96% S | 91% / 96% S |
| good choir singer | dieu-1-5 | 4 | cal | 99% / 99% S | 95% / 99% S | 99% / 99% S | 99% / 99% S | 99% / 99% S |
| good choir singer | dieu-1-5 | 4 | uncal200 | 47% / 67% C | 51% / 70% C | 53% / 72% B | 57% / 71% B | 57% / 71% B |
| operatic vibrato | warmup-7-12 | 1 | cal | 100% / 99% S | 94% / 99% S | 100% / 99% S | 99% / 100% S | 99% / 99% S |
| operatic vibrato | warmup-7-12 | 1 | uncal200 | 98% / 99% S | 92% / 99% S | 98% / 99% S | 99% / 100% S | 100% / 99% S |
| operatic vibrato | warmup-7-12 | 4 | cal | 97% / 98% S | 54% / 60% C | 98% / 98% S | 97% / 97% S | 96% / 96% S |
| operatic vibrato | warmup-7-12 | 4 | uncal200 | 90% / 96% S | 49% / 47% D | 89% / 95% S | 97% / 97% S | 100% / 98% S |
| operatic vibrato | dieu-1-5 | 1 | cal | 100% / 100% S | 92% / 97% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| operatic vibrato | dieu-1-5 | 1 | uncal200 | 85% / 96% S | 76% / 93% A | 86% / 96% S | 87% / 96% S | 87% / 96% S |
| operatic vibrato | dieu-1-5 | 4 | cal | 91% / 96% S | 68% / 69% C | 92% / 96% S | 90% / 95% S | 90% / 94% A |
| operatic vibrato | dieu-1-5 | 4 | uncal200 | 46% / 55% C | 34% / 43% D | 50% / 56% C | 54% / 60% C | 54% / 60% C |

Cells: in tune / accuracy grade.
