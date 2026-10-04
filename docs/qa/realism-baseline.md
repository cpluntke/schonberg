# Realism baseline: synthetic singer through the real pipeline (baseline, frozen HEAD scorer + tracker)

Generated 2026-10-04T16:07:24.383Z by `npx vitest run --config vitest.realism.config.ts`. Harness: `qa/realism/` (see its README). Scorer: `qa/realism/baseline/scoring.ts` (frozen copy of `src/game/scoring.ts` at the baseline commit); tracker: `qa/realism/baseline/pitch.ts` (pitchy MPM, gates, median-of-3 smoother), offline at 48 kHz, N=2048, hop 20 ms ±3 ms jitter, 128-frame quanta. Raw data: `qa/realism/out/report.json`.

Singer model: per-note intonation error, vibrato with onset delay and wander, 2nd-order (underdamped) legato transitions, scoops, drift, onset jitter, consonant noise bursts at lyric syllables, breath gaps, glottal source with jitter/shimmer/aspiration and 5 alto formants; channel: room reverb (RT60 0.4 s, −9 dB wet), 150 Hz phone-mic high-pass, background noise at 32 dB SNR, optional speaker bleed of the backing. Latency: true acoustic round trip vs what the app assumes.

Levels (standard strictness): L1 = 70 % tempo, ±50¢, guide on, pass 75 %; L4 = 100 % tempo, ±25¢, pass 85 %. "In tune" = `pitch`, the letter comes from `accuracy` (S ≥ 95, A ≥ 85, B ≥ 70, C ≥ 50).

## Key numbers

- **Good choir singer, L1, calibrated (true = assumed = 150 ms):** in tune 99% (min 98%), accuracy 100% (min 100%), letters S×6, passes 6/6
- **Good choir singer, L4, calibrated (true = assumed = 150 ms):** in tune 97% (min 95%), accuracy 98% (min 97%), letters S×6, passes 6/6
- **Good choir singer, L1, uncalibrated phone (true 200, assumed 80):** in tune 95% (min 85%), accuracy 98% (min 96%), letters S×6, passes 6/6
- **Good choir singer, L4, uncalibrated phone (true 200, assumed 80):** in tune 80% (min 47%), accuracy 89% (min 63%), letters S×4 B×1 C×1, passes 4/6
- **Good choir singer, L1, uncalibrated phone (true 280, assumed 80):** in tune 80% (min 49%), accuracy 90% (min 62%), letters S×4 A×1 C×1, passes 5/6
- **Good choir singer, L4, uncalibrated phone (true 280, assumed 80):** in tune 56% (min 37%), accuracy 64% (min 43%), letters A×2 C×2 D×2, passes 2/6
- **Operatic vibrato, L1, calibrated (true = assumed = 150 ms):** in tune 99% (min 97%), accuracy 100% (min 99%), letters S×6, passes 6/6
- **Operatic vibrato, L4, calibrated (true = assumed = 150 ms):** in tune 95% (min 90%), accuracy 96% (min 91%), letters S×5 A×1, passes 6/6
- **Operatic vibrato, L1, uncalibrated phone (true 200, assumed 80):** in tune 95% (min 85%), accuracy 99% (min 96%), letters S×6, passes 6/6
- **Operatic vibrato, L4, uncalibrated phone (true 200, assumed 80):** in tune 77% (min 46%), accuracy 85% (min 54%), letters S×2 A×2 B×1 C×1, passes 4/6
- **Operatic vibrato, L1, uncalibrated phone (true 280, assumed 80):** in tune 79% (min 49%), accuracy 91% (min 62%), letters S×4 A×1 C×1, passes 5/6
- **Operatic vibrato, L4, uncalibrated phone (true 280, assumed 80):** in tune 56% (min 36%), accuracy 64% (min 43%), letters A×2 C×3 D×1, passes 2/6
- **Same takes, perfect tracker + true latency ("oracle"), good singer:** L1 100% in tune / 100% accuracy; L4 99% / 99%.
- **Tracker (good singer, N=2048):** steady-state median |error| 3.3¢ (p90 8.2¢); within ±150 ms of transitions p90 19.3¢, p99 118.6¢; readings >50¢ off the truth: 1% overall, 3% near transitions, 0% in steady parts.
- **Overshoot:** voice overshoot (pitch centre) 28¢ (13% of the interval), tracker shows 20¢; tracker invents >25¢ extra overshoot in 0% of transitions. Control voice without overshoot: tracker shows 3¢ (invented in 0%). Ringing voice (ζ≈0.35): voice 68¢, tracker 48¢.
- **Live cents bubble right after a note change (good singer, L1):** shows > tolerance toward the *previous* note in 100% of changes when calibrated, 100% at true 200/assumed 80, 100% at 280/80; beyond the new note (displayed "overshoot") in 5% / 7% / 4%; out of tolerance until 201 / 259 / 323 ms after the bar changes.
- **Repeatability dieu-1-5 L1 cal (same performance, micro-randomness only, 10 seeds):** accuracy 100%–100% (sd 0.0 pts), in tune 99%–100%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L1 cal (performance varies too, 10 seeds):** accuracy 99%–100% (sd 0.3 pts), in tune 98%–100%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L1 uncal200 (same performance, micro-randomness only, 10 seeds):** accuracy 96%–97% (sd 0.5 pts), in tune 85%–94%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L1 uncal200 (performance varies too, 10 seeds):** accuracy 91%–98% (sd 1.6 pts), in tune 76%–95%, letters S×8 A×2, passes 10/10.
- **Repeatability dieu-1-5 L4 cal (same performance, micro-randomness only, 10 seeds):** accuracy 98%–99% (sd 0.6 pts), in tune 95%–99%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L4 cal (performance varies too, 10 seeds):** accuracy 97%–100% (sd 1.0 pts), in tune 92%–99%, letters S×10, passes 10/10.
- **Repeatability dieu-1-5 L4 uncal200 (same performance, micro-randomness only, 10 seeds):** accuracy 56%–65% (sd 2.5 pts), in tune 46%–48%, letters C×10, passes 0/10.
- **Repeatability dieu-1-5 L4 uncal200 (performance varies too, 10 seeds):** accuracy 56%–75% (sd 5.4 pts), in tune 44%–55%, letters B×2 C×8, passes 0/10.
- **Repeatability warmup-7-12 L1 uncal200 (same performance, micro-randomness only, 10 seeds):** accuracy 95%–100% (sd 1.4 pts), in tune 93%–99%, letters S×10, passes 10/10.
- **Repeatability warmup-7-12 L4 cal (same performance, micro-randomness only, 10 seeds):** accuracy 99%–100% (sd 0.5 pts), in tune 99%–99%, letters S×10, passes 10/10.
- **Sanity:** every bad-singer run that must fail fails. Wrong notes (40 %): max accuracy 75%. Flat −40¢ passes L1 in 5/6 runs (−40¢ is inside L1's ±50¢ window, by design), and fails L2 and L4.
- **WAV round trip** (16-bit file + sidecar through `scoreRecording`): accuracy 96% direct vs 96% via `qa/realism/out/example-dieu-1-5-alto-L1-uncal200.wav`.

## Observations (baseline)

_See the final section of qa/realism/README.md for how to re-run after fixes (`REALISM_IMPL=current`)._

## 1. Tracker fidelity (smoothed output vs ground-truth f0, cents)

Takes: dieu-1-5 and warmup-7-12 (Alto), L4 tempo, calibrated, headphones, unless noted. "near" = within ±150 ms of a pitch change or voice onset. ">50¢" = readings off the true sung pitch by more than 50¢ (spikes the voice does not have). Overshoot = largest excursion beyond the new note in the 400 ms after a legato change (voice centre / tracker). "Scored" = mean in-tune and accuracy of those takes with this tracker.

| singer | tracker | steady med/p90 | near med/p90/p99 | >50¢ steady / near | octave | missed voiced | false voiced | overshoot voice → tracker | invented | scored in tune / acc |
|---|---|---|---|---|---|---|---|---|---|---|
| good choir singer | N2048 hop20 | 3.3 / 8.2 | 4.3 / 19.3 / 119 | 0% / 3% | 0% | 2% | 15% | 28 → 20 | 0% | 99% / 100% |
| good choir singer | N1024 hop20 | 3.6 / 8.9 | 4.7 / 19.6 / 114 | 0% / 3% | 0% | 2% | 14% | 28 → 22 | 0% | 98% / 99% |
| good choir singer | N1024 hop10 | 3.6 / 9.6 | 4.5 / 19.9 / 114 | 0% / 3% | 0% | 2% | 11% | 28 → 26 | 0% | 99% / 100% |
| operatic vibrato | N2048 hop20 | 7.0 / 19.1 | 7.9 / 26.0 / 86 | 0% / 2% | 0% | 2% | 14% | 41 → 32 | 0% | 95% / 97% |
| operatic vibrato | N1024 hop20 | 6.6 / 18.0 | 7.4 / 27.3 / 88 | 0% / 4% | 0% | 3% | 13% | 41 → 37 | 0% | 96% / 97% |
| operatic vibrato | N1024 hop10 | 6.2 / 16.6 | 6.8 / 22.9 / 77 | 0% / 2% | 0% | 2% | 9% | 41 → 44 | 0% | 97% / 97% |
| control (no vibrato, no overshoot) | N2048 hop20 | 1.8 / 4.2 | 2.9 / 16.8 / 50 | 0% / 1% | 0% | 2% | 14% | 2 → 3 | 0% | 98% / 99% |
| control (no vibrato, no overshoot) | N1024 hop20 | 2.1 / 4.9 | 3.1 / 13.7 / 55 | 0% / 1% | 0% | 2% | 13% | 2 → 3 | 0% | 96% / 99% |
| control (no vibrato, no overshoot) | N1024 hop10 | 2.4 / 6.0 | 3.6 / 13.3 / 44 | 0% / 1% | 0% | 1% | 10% | 2 → 6 | 0% | 99% / 99% |
| ringing transitions (zeta 0.35) | N2048 hop20 | 3.5 / 8.6 | 6.3 / 31.1 / 91 | 0% / 5% | 0% | 2% | 14% | 68 → 48 | 0% | 91% / 95% |
| ringing transitions (zeta 0.35) | N1024 hop20 | 3.9 / 9.5 | 6.2 / 29.4 / 131 | 0% / 4% | 0% | 3% | 12% | 68 → 49 | 0% | 90% / 94% |
| ringing transitions (zeta 0.35) | N1024 hop10 | 3.8 / 10.1 | 5.9 / 23.5 / 69 | 0% / 3% | 0% | 2% | 9% | 68 → 58 | 0% | 92% / 94% |
| good choir singer + speaker bleed (L1) | N2048 hop20 | 4.7 / 14.4 | 5.7 / 172.2 / 1907 | 7% / 13% | 8% | 4% | 10% | 29 → 351 | 18% | 79% / 84% |
| good choir singer + speaker bleed (L1) | N1024 hop20 | 5.3 / 16.9 | 6.5 / 1175.6 / 1950 | 8% / 13% | 9% | 4% | 10% | 29 → 390 | 21% | 79% / 84% |
| good choir singer + speaker bleed (L1) | N1024 hop10 | 5.3 / 20.5 | 6.9 / 1191.3 / 2783 | 9% / 13% | 10% | 3% | 6% | 29 → 415 | 21% | 77% / 81% |

Raw (unsmoothed) detector, N=2048, good singer: steady median 3.2¢ p90 8.0¢, near transitions p90 17.4¢ p99 107¢, >50¢ near 3%.

## 2. Good singers: latency × section × level

"learned" = what the Results screen shows after Play.tsx learns the delay from late entries and re-scores (uncalibrated profiles only; blank = the rule did not fire). "oracle" = same take scored from the true f0 with the true latency (no tracker, no latency error). Loss: notes perfect / demoted to good only by |median| > tol/2 / hit ratio < 0.8; "early" = share of out-of-tolerance body samples in the first 150 ms of the note body.

### good choir singer

| section | L | latency | in tune | rhythm | acc | grade | pass | avg | learned → acc/grade | oracle in tune/acc | perfect / median-demoted / low-hit | early | bubble lag/over |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| warmup-upbeat-6 | 1 | cal | 100% | 100% | 100% | S | pass | +3¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 0% | 100% / 0% |
| warmup-upbeat-6 | 1 | uncal200 | 98% | 98% | 100% | S | pass | +4¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 100% | 100% / 0% |
| warmup-upbeat-6 | 1 | uncal280 | 90% | 90% | 99% | S | pass | +5¢ | 255 ms → 100% S | 100% / 100% | 20 / 0 / 1 (of 21) | 100% | 100% / 0% |
| warmup-upbeat-6 | 4 | cal | 99% | 100% | 99% | S | pass | ±0¢ |  | 100% / 99% | 19 / 2 / 0 (of 21) | 0% | 100% / 21% |
| warmup-upbeat-6 | 4 | uncal200 | 90% | 92% | 96% | S | pass | +2¢ |  | 100% / 100% | 16 / 2 / 3 (of 21) | 96% | 100% / 21% |
| warmup-upbeat-6 | 4 | uncal280 | 82% | 78% | 91% | A | pass | +2¢ | 254 ms → 99% S | 100% / 99% | 9 / 1 / 11 (of 21) | 73% | 100% / 21% |
| warmup-7-12 | 1 | cal | 99% | 100% | 100% | S | pass | ±0¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 0% | 100% / 7% |
| warmup-7-12 | 1 | uncal200 | 99% | 99% | 100% | S | pass | ±0¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 100% | 100% / 14% |
| warmup-7-12 | 1 | uncal280 | 90% | 90% | 99% | S | pass | ±0¢ | 248 ms → 100% S | 100% / 100% | 20 / 0 / 1 (of 21) | 94% | 100% / 14% |
| warmup-7-12 | 4 | cal | 99% | 100% | 100% | S | pass | ±0¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 0% | 100% / 21% |
| warmup-7-12 | 4 | uncal200 | 91% | 92% | 98% | S | pass | −1¢ |  | 100% / 100% | 18 / 0 / 3 (of 21) | 100% | 100% / 7% |
| warmup-7-12 | 4 | uncal280 | 82% | 77% | 93% | A | pass | −3¢ | 254 ms → 99% S | 100% / 99% | 11 / 0 / 10 (of 21) | 76% | 100% / 7% |
| dieu-1-5 | 1 | cal | 100% | 100% | 100% | S | pass | −1¢ |  | 100% / 100% | 24 / 0 / 0 (of 24) | 0% | 100% / 5% |
| dieu-1-5 | 1 | uncal200 | 85% | 99% | 96% | S | pass | +2¢ |  | 100% / 100% | 18 / 3 / 3 (of 24) | 100% | 100% / 5% |
| dieu-1-5 | 1 | uncal280 | 49% | 55% | 62% | C | FAIL | +2¢ | 256 ms → 100% S | 100% / 100% | 9 / 0 / 15 (of 24) | 100% | 100% / 0% |
| dieu-1-5 | 4 | cal | 99% | 100% | 99% | S | pass | ±0¢ |  | 100% / 99% | 23 / 1 / 0 (of 24) | 100% | 100% / 5% |
| dieu-1-5 | 4 | uncal200 | 47% | 63% | 63% | C | FAIL | −1¢ |  | 100% / 99% | 7 / 0 / 17 (of 24) | 98% | 100% / 5% |
| dieu-1-5 | 4 | uncal280 | 37% | 56% | 43% | D | FAIL | +2¢ | 263 ms → 99% S | 100% / 99% | 4 / 0 / 20 (of 24) | 77% | 85% / 5% |
| dieu-6-13 | 1 | cal | 98% | 100% | 100% | S | pass | −2¢ |  | 100% / 100% | 41 / 0 / 1 (of 42) | 100% | 100% / 3% |
| dieu-6-13 | 1 | uncal200 | 96% | 99% | 99% | S | pass | −2¢ |  | 100% / 100% | 40 / 0 / 2 (of 42) | 100% | 100% / 0% |
| dieu-6-13 | 1 | uncal280 | 70% | 82% | 85% | A | pass | ±0¢ | 256 ms → 100% S | 100% / 100% | 18 / 1 / 23 (of 42) | 100% | 100% / 9% |
| dieu-6-13 | 4 | cal | 95% | 100% | 99% | S | pass | +3¢ |  | 99% / 99% | 38 / 1 / 3 (of 42) | 0% | 100% / 15% |
| dieu-6-13 | 4 | uncal200 | 72% | 87% | 85% | B | FAIL | +3¢ |  | 99% / 99% | 22 / 2 / 18 (of 42) | 100% | 100% / 18% |
| dieu-6-13 | 4 | uncal280 | 42% | 59% | 51% | C | FAIL | +1¢ | 231 ms → 99% S | 99% / 100% | 10 / 1 / 31 (of 42) | 86% | 100% / 12% |
| tabourin-solo-1-8 | 1 | cal | 100% | 100% | 100% | S | pass | +1¢ |  | 100% / 100% | 16 / 0 / 0 (of 16) | 0% | 100% / 8% |
| tabourin-solo-1-8 | 1 | uncal200 | 97% | 98% | 99% | S | pass | ±0¢ |  | 100% / 100% | 15 / 0 / 1 (of 16) | 100% | 100% / 8% |
| tabourin-solo-1-8 | 1 | uncal280 | 92% | 87% | 97% | S | pass | −1¢ | 253 ms → 100% S | 100% / 100% | 13 / 1 / 2 (of 16) | 100% | 100% / 0% |
| tabourin-solo-1-8 | 4 | cal | 95% | 100% | 97% | S | pass | +4¢ |  | 99% / 98% | 13 / 3 / 0 (of 16) | 0% | 100% / 0% |
| tabourin-solo-1-8 | 4 | uncal200 | 90% | 88% | 96% | S | pass | +5¢ |  | 99% / 99% | 12 / 1 / 3 (of 16) | 89% | 100% / 0% |
| tabourin-solo-1-8 | 4 | uncal280 | 43% | 72% | 46% | D | FAIL | +4¢ | 260 ms → 98% S | 99% / 98% | 3 / 1 / 12 (of 16) | 94% | 100% / 8% |
| tabourin-solo-9-16 | 1 | cal | 100% | 100% | 100% | S | pass | −1¢ |  | 100% / 100% | 23 / 0 / 0 (of 23) | 0% | 100% / 6% |
| tabourin-solo-9-16 | 1 | uncal200 | 96% | 99% | 96% | S | pass | −2¢ |  | 100% / 100% | 22 / 0 / 1 (of 23) | 31% | 100% / 12% |
| tabourin-solo-9-16 | 1 | uncal280 | 89% | 88% | 99% | S | pass | −5¢ | 222 ms → 100% S | 100% / 100% | 21 / 0 / 2 (of 23) | 99% | 100% / 0% |
| tabourin-solo-9-16 | 4 | cal | 97% | 100% | 97% | S | pass | +2¢ |  | 99% / 100% | 21 / 0 / 2 (of 23) | 7% | 100% / 18% |
| tabourin-solo-9-16 | 4 | uncal200 | 90% | 92% | 96% | S | pass | +3¢ |  | 99% / 100% | 17 / 1 / 5 (of 23) | 100% | 100% / 18% |
| tabourin-solo-9-16 | 4 | uncal280 | 51% | 75% | 57% | C | FAIL | ±0¢ | 240 ms → 99% S | 99% / 100% | 5 / 1 / 17 (of 23) | 81% | 100% / 18% |

### operatic vibrato

| section | L | latency | in tune | rhythm | acc | grade | pass | avg | learned → acc/grade | oracle in tune/acc | perfect / median-demoted / low-hit | early | bubble lag/over |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| warmup-upbeat-6 | 1 | cal | 100% | 100% | 100% | S | pass | +3¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 0% | 100% / 0% |
| warmup-upbeat-6 | 1 | uncal200 | 98% | 99% | 100% | S | pass | +1¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 100% | 100% / 0% |
| warmup-upbeat-6 | 1 | uncal280 | 90% | 89% | 100% | S | pass | +6¢ | 259 ms → 100% S | 100% / 100% | 21 / 0 / 0 (of 21) | 100% | 100% / 7% |
| warmup-upbeat-6 | 4 | cal | 96% | 100% | 96% | S | pass | −2¢ |  | 99% / 97% | 16 / 3 / 2 (of 21) | 0% | 100% / 21% |
| warmup-upbeat-6 | 4 | uncal200 | 89% | 92% | 96% | S | pass | +5¢ |  | 99% / 98% | 15 / 3 / 3 (of 21) | 83% | 100% / 36% |
| warmup-upbeat-6 | 4 | uncal280 | 79% | 78% | 90% | A | pass | +2¢ | 261 ms → 98% S | 97% / 98% | 9 / 1 / 11 (of 21) | 67% | 100% / 29% |
| warmup-7-12 | 1 | cal | 99% | 100% | 99% | S | pass | +1¢ |  | 100% / 100% | 20 / 1 / 0 (of 21) | 0% | 100% / 14% |
| warmup-7-12 | 1 | uncal200 | 98% | 99% | 100% | S | pass | +2¢ |  | 100% / 100% | 21 / 0 / 0 (of 21) | 100% | 100% / 14% |
| warmup-7-12 | 1 | uncal280 | 90% | 90% | 99% | S | pass | −3¢ | 244 ms → 100% S | 100% / 100% | 19 / 0 / 2 (of 21) | 97% | 100% / 7% |
| warmup-7-12 | 4 | cal | 98% | 100% | 98% | S | pass | −2¢ |  | 98% / 99% | 18 / 3 / 0 (of 21) | 0% | 100% / 21% |
| warmup-7-12 | 4 | uncal200 | 89% | 91% | 96% | S | pass | −2¢ |  | 99% / 98% | 15 / 2 / 4 (of 21) | 87% | 100% / 36% |
| warmup-7-12 | 4 | uncal280 | 83% | 78% | 91% | A | pass | −2¢ | 250 ms → 98% S | 98% / 99% | 9 / 1 / 11 (of 21) | 80% | 100% / 29% |
| dieu-1-5 | 1 | cal | 100% | 100% | 99% | S | pass | +1¢ |  | 100% / 100% | 23 / 1 / 0 (of 24) | 0% | 100% / 0% |
| dieu-1-5 | 1 | uncal200 | 85% | 99% | 96% | S | pass | +2¢ |  | 100% / 99% | 17 / 4 / 3 (of 24) | 100% | 100% / 5% |
| dieu-1-5 | 1 | uncal280 | 49% | 55% | 62% | C | FAIL | +2¢ | 260 ms → 99% S | 100% / 99% | 9 / 0 / 15 (of 24) | 100% | 100% / 0% |
| dieu-1-5 | 4 | cal | 92% | 100% | 97% | S | pass | ±0¢ |  | 94% / 97% | 19 / 4 / 1 (of 24) | 38% | 100% / 10% |
| dieu-1-5 | 4 | uncal200 | 46% | 60% | 54% | C | FAIL | +4¢ |  | 95% / 98% | 6 / 1 / 17 (of 24) | 89% | 100% / 15% |
| dieu-1-5 | 4 | uncal280 | 36% | 56% | 43% | D | FAIL | +4¢ | 251 ms → 96% S | 95% / 99% | 4 / 0 / 20 (of 24) | 80% | 90% / 10% |
| dieu-6-13 | 1 | cal | 97% | 99% | 99% | S | pass | ±0¢ |  | 100% / 100% | 40 / 1 / 1 (of 42) | 100% | 100% / 9% |
| dieu-6-13 | 1 | uncal200 | 96% | 99% | 99% | S | pass | −3¢ |  | 100% / 100% | 40 / 0 / 2 (of 42) | 100% | 100% / 3% |
| dieu-6-13 | 1 | uncal280 | 66% | 82% | 86% | A | pass | −4¢ | 256 ms → 100% S | 100% / 100% | 19 / 1 / 22 (of 42) | 100% | 100% / 9% |
| dieu-6-13 | 4 | cal | 90% | 100% | 91% | A | pass | +1¢ |  | 94% / 97% | 27 / 7 / 8 (of 42) | 54% | 100% / 21% |
| dieu-6-13 | 4 | uncal200 | 71% | 87% | 81% | B | FAIL | +2¢ |  | 95% / 98% | 15 / 6 / 21 (of 42) | 94% | 100% / 18% |
| dieu-6-13 | 4 | uncal280 | 44% | 58% | 51% | C | FAIL | −1¢ | 231 ms → 96% S | 98% / 97% | 6 / 3 / 33 (of 42) | 84% | 100% / 15% |
| tabourin-solo-1-8 | 1 | cal | 100% | 100% | 100% | S | pass | +3¢ |  | 100% / 100% | 16 / 0 / 0 (of 16) | 28% | 100% / 0% |
| tabourin-solo-1-8 | 1 | uncal200 | 97% | 98% | 99% | S | pass | +1¢ |  | 100% / 100% | 15 / 0 / 1 (of 16) | 78% | 100% / 0% |
| tabourin-solo-1-8 | 1 | uncal280 | 90% | 88% | 98% | S | pass | −1¢ | 249 ms → 100% S | 100% / 100% | 14 / 1 / 1 (of 16) | 98% | 100% / 0% |
| tabourin-solo-1-8 | 4 | cal | 95% | 99% | 98% | S | pass | +6¢ |  | 98% / 98% | 14 / 1 / 1 (of 16) | 43% | 100% / 0% |
| tabourin-solo-1-8 | 4 | uncal200 | 82% | 90% | 87% | A | pass | +4¢ |  | 99% / 97% | 8 / 3 / 5 (of 16) | 86% | 100% / 17% |
| tabourin-solo-1-8 | 4 | uncal280 | 47% | 73% | 52% | C | FAIL | +7¢ | 260 ms → 97% S | 98% / 97% | 3 / 1 / 12 (of 16) | 89% | 100% / 0% |
| tabourin-solo-9-16 | 1 | cal | 99% | 100% | 100% | S | pass | −3¢ |  | 100% / 100% | 23 / 0 / 0 (of 23) | 17% | 100% / 6% |
| tabourin-solo-9-16 | 1 | uncal200 | 97% | 98% | 99% | S | pass | −3¢ |  | 100% / 100% | 22 / 0 / 1 (of 23) | 100% | 100% / 18% |
| tabourin-solo-9-16 | 1 | uncal280 | 91% | 89% | 99% | S | pass | −6¢ | 222 ms → 100% S | 100% / 100% | 21 / 1 / 1 (of 23) | 100% | 100% / 12% |
| tabourin-solo-9-16 | 4 | cal | 98% | 100% | 97% | S | pass | +2¢ |  | 99% / 99% | 18 / 4 / 1 (of 23) | 35% | 100% / 24% |
| tabourin-solo-9-16 | 4 | uncal200 | 88% | 92% | 95% | A | pass | +3¢ |  | 99% / 99% | 17 / 2 / 4 (of 23) | 79% | 100% / 35% |
| tabourin-solo-9-16 | 4 | uncal280 | 48% | 75% | 54% | C | FAIL | +1¢ | 240 ms → 95% A | 98% / 100% | 4 / 1 / 18 (of 23) | 73% | 100% / 35% |

### Phone speaker, no headphones (backing bleed −13 dB, speaker high-passed at 400 Hz)

| singer | section | L | latency | in tune | rhythm | acc | grade | pass | learned |
|---|---|---|---|---|---|---|---|---|---|
| good choir singer | dieu-1-5 | 1 | cal | 82% | 96% | 90% | A | pass |  |
| good choir singer | dieu-1-5 | 1 | uncal200 | 51% | 85% | 59% | C | FAIL |  |
| good choir singer | dieu-1-5 | 4 | cal | 57% | 91% | 61% | C | FAIL |  |
| good choir singer | dieu-1-5 | 4 | uncal200 | 26% | 55% | 39% | D | FAIL |  |
| good choir singer | warmup-7-12 | 1 | cal | 77% | 84% | 78% | B | pass |  |
| good choir singer | warmup-7-12 | 1 | uncal200 | 69% | 80% | 71% | B | FAIL |  |
| good choir singer | warmup-7-12 | 4 | cal | 34% | 64% | 32% | D | FAIL |  |
| good choir singer | warmup-7-12 | 4 | uncal200 | 49% | 68% | 54% | C | FAIL |  |
| operatic vibrato | dieu-1-5 | 1 | cal | 90% | 96% | 88% | A | pass |  |
| operatic vibrato | dieu-1-5 | 1 | uncal200 | 66% | 88% | 73% | B | FAIL |  |
| operatic vibrato | dieu-1-5 | 4 | cal | 44% | 88% | 43% | D | FAIL |  |
| operatic vibrato | dieu-1-5 | 4 | uncal200 | 23% | 52% | 35% | D | FAIL |  |
| operatic vibrato | warmup-7-12 | 1 | cal | 84% | 91% | 84% | B | pass |  |
| operatic vibrato | warmup-7-12 | 1 | uncal200 | 80% | 85% | 83% | B | pass |  |
| operatic vibrato | warmup-7-12 | 4 | cal | 38% | 66% | 37% | D | FAIL |  |
| operatic vibrato | warmup-7-12 | 4 | uncal200 | 40% | 71% | 40% | D | FAIL |  |

## 3. Repeatability (good choir singer)

"micro" = identical performance (same intonation errors, timing, transitions), only glottal jitter/shimmer, noise, vibrato phase/wander and tracker hop jitter change. "performance" = a new, equally good performance each run (what "sang it the same way" really means for a human).

| section | L | latency | mode | accuracy min–max (sd) | in tune min–max | letters | shown letters | passes |
|---|---|---|---|---|---|---|---|---|
| dieu-1-5 | 1 | cal | micro | 100%–100% (0.0) | 99%–100% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 1 | cal | performance | 99%–100% (0.3) | 98%–100% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 1 | uncal200 | micro | 96%–97% (0.5) | 85%–94% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 1 | uncal200 | performance | 91%–98% (1.6) | 76%–95% | S×8 A×2 | S×8 A×2 | 10/10 |
| dieu-1-5 | 4 | cal | micro | 98%–99% (0.6) | 95%–99% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 4 | cal | performance | 97%–100% (1.0) | 92%–99% | S×10 | S×10 | 10/10 |
| dieu-1-5 | 4 | uncal200 | micro | 56%–65% (2.5) | 46%–48% | C×10 | C×10 | 0/10 |
| dieu-1-5 | 4 | uncal200 | performance | 56%–75% (5.4) | 44%–55% | B×2 C×8 | B×2 C×8 | 0/10 |
| warmup-7-12 | 1 | uncal200 | micro | 95%–100% (1.4) | 93%–99% | S×10 | S×10 | 10/10 |
| warmup-7-12 | 4 | cal | micro | 99%–100% (0.5) | 99%–99% | S×10 | S×10 | 10/10 |

### Three runs in a row by a new (uncalibrated) singer, dieu bars 1–5, L1

Run 1 uses the 80 ms estimate; when Play.tsx learns a delay, the run is re-scored with it ("shown") and later runs use the learned value.

| true latency | seed | run 1 (assumed → shown) | run 2 | run 3 |
|---|---|---|---|---|
| 200 ms | 1 | 80 ms: S 96% | 80 ms: S 96% | 80 ms: S 96% |
| 200 ms | 2 | 80 ms: S 97% | 80 ms: S 96% | 80 ms: A 95% |
| 200 ms | 3 | 80 ms: S 98% | 80 ms: A 94% | 80 ms: S 96% |
| 250 ms | 1 | 80 ms: B 72% → learned 219 ms: S 100% | 219 ms: S 100% | 219 ms: S 100% |
| 250 ms | 2 | 80 ms: B 82% → learned 212 ms: S 100% | 212 ms: S 100% | 212 ms: S 100% |
| 250 ms | 3 | 80 ms: B 81% → learned 220 ms: S 100% | 220 ms: S 100% | 220 ms: S 100% |
| 300 ms | 1 | 80 ms: C 56% → learned 279 ms: S 99% | 279 ms: S 96% | 279 ms: S 100% |
| 300 ms | 2 | 80 ms: C 57% → learned 274 ms: S 100% | 274 ms: S 100% | 274 ms: S 100% |
| 300 ms | 3 | 80 ms: C 56% → learned 277 ms: S 100% | 277 ms: S 100% | 277 ms: S 100% |

## 4. Sanity: bad singers

| singer | section | L | latency | in tune | acc | grade | pass | learned |
|---|---|---|---|---|---|---|---|---|
| flat −40¢ | dieu-1-5 | 1 | cal | 76% | 76% | B | pass |  |
| flat −40¢ | dieu-1-5 | 1 | uncal200 | 72% | 79% | B | pass |  |
| flat −40¢ | dieu-1-5 | 2 | cal | 20% | 25% | D | FAIL |  |
| flat −40¢ | dieu-1-5 | 2 | uncal200 | 13% | 14% | D | FAIL |  |
| flat −40¢ | dieu-1-5 | 4 | cal | 3% | 6% | D | FAIL |  |
| flat −40¢ | dieu-1-5 | 4 | uncal200 | 7% | 15% | D | FAIL |  |
| flat −40¢ | warmup-7-12 | 1 | cal | 93% | 81% | B | pass |  |
| flat −40¢ | warmup-7-12 | 1 | uncal200 | 88% | 80% | B | pass |  |
| flat −40¢ | warmup-7-12 | 2 | cal | 37% | 32% | D | FAIL |  |
| flat −40¢ | warmup-7-12 | 2 | uncal200 | 41% | 41% | D | FAIL |  |
| flat −40¢ | warmup-7-12 | 4 | cal | 2% | 0% | D | FAIL |  |
| flat −40¢ | warmup-7-12 | 4 | uncal200 | 3% | 0% | D | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 1 | cal | 94% | 81% | B | pass |  |
| flat −40¢ | tabourin-solo-1-8 | 1 | uncal200 | 72% | 65% | C | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 2 | cal | 17% | 16% | D | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 2 | uncal200 | 30% | 27% | D | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 4 | cal | 13% | 11% | D | FAIL |  |
| flat −40¢ | tabourin-solo-1-8 | 4 | uncal200 | 24% | 21% | D | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 1 | cal | 67% | 67% | C | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 1 | uncal200 | 58% | 75% | B | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 2 | cal | 66% | 70% | B | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 2 | uncal200 | 31% | 45% | D | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 4 | cal | 46% | 45% | D | FAIL |  |
| wrong notes (40 %) | dieu-1-5 | 4 | uncal200 | 16% | 28% | D | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 1 | cal | 57% | 57% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 1 | uncal200 | 57% | 56% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 2 | cal | 51% | 52% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 2 | uncal200 | 48% | 52% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 4 | cal | 56% | 56% | C | FAIL |  |
| wrong notes (40 %) | warmup-7-12 | 4 | uncal200 | 52% | 56% | C | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 1 | cal | 68% | 69% | C | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 1 | uncal200 | 67% | 69% | C | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 2 | cal | 62% | 62% | C | FAIL |  |
| wrong notes (40 %) | tabourin-solo-1-8 | 2 | uncal200 | 57% | 63% | C | FAIL |  |
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
| 2 + small vibrato (±20¢, 5.5 Hz) | dieu-1-5 | 4 | 100% | 98% | S | 100% / 99% | 21 / 3 / 0 |
| 2 + small vibrato (±20¢, 5.5 Hz) | warmup-7-12 | 1 | 100% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 2 + small vibrato (±20¢, 5.5 Hz) | warmup-7-12 | 4 | 100% | 99% | S | 100% / 99% | 20 / 1 / 0 |
| 3 + 2nd-order transitions & scoops | dieu-1-5 | 1 | 100% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 3 + 2nd-order transitions & scoops | dieu-1-5 | 4 | 100% | 98% | S | 100% / 99% | 21 / 3 / 0 |
| 3 + 2nd-order transitions & scoops | warmup-7-12 | 1 | 100% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 3 + 2nd-order transitions & scoops | warmup-7-12 | 4 | 99% | 97% | S | 100% / 98% | 17 / 4 / 0 |
| 4 + onset jitter ±25 ms | dieu-1-5 | 1 | 100% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 4 + onset jitter ±25 ms | dieu-1-5 | 4 | 100% | 99% | S | 100% / 99% | 22 / 2 / 0 |
| 4 + onset jitter ±25 ms | warmup-7-12 | 1 | 100% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 4 + onset jitter ±25 ms | warmup-7-12 | 4 | 100% | 98% | S | 100% / 99% | 18 / 3 / 0 |
| 5 + consonants (= full good singer) | dieu-1-5 | 1 | 100% | 100% | S | 100% / 100% | 24 / 0 / 0 |
| 5 + consonants (= full good singer) | dieu-1-5 | 4 | 99% | 99% | S | 100% / 99% | 23 / 1 / 0 |
| 5 + consonants (= full good singer) | warmup-7-12 | 1 | 99% | 100% | S | 100% / 100% | 21 / 0 / 0 |
| 5 + consonants (= full good singer) | warmup-7-12 | 4 | 99% | 100% | S | 100% / 100% | 21 / 0 / 0 |

## 6. Scoring-option sensitivity (same samples re-scored)

| singer | section | L | latency | default (vibWin 0.18, grace 0.08) | vibratoWindow 0 | vibratoWindow 0.30 | onsetGrace 0.15 | onsetGrace 0.25 |
|---|---|---|---|---|---|---|---|---|
| good choir singer | warmup-7-12 | 1 | cal | 99% / 100% S | 99% / 100% S | 99% / 100% S | 99% / 100% S | 99% / 100% S |
| good choir singer | warmup-7-12 | 1 | uncal200 | 99% / 100% S | 98% / 100% S | 99% / 100% S | 100% / 100% S | 100% / 100% S |
| good choir singer | warmup-7-12 | 4 | cal | 99% / 100% S | 94% / 99% S | 99% / 100% S | 99% / 100% S | 99% / 99% S |
| good choir singer | warmup-7-12 | 4 | uncal200 | 91% / 98% S | 89% / 99% S | 91% / 98% S | 98% / 100% S | 100% / 100% S |
| good choir singer | dieu-1-5 | 1 | cal | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| good choir singer | dieu-1-5 | 1 | uncal200 | 85% / 96% S | 82% / 95% S | 86% / 96% S | 87% / 96% S | 87% / 96% S |
| good choir singer | dieu-1-5 | 4 | cal | 99% / 99% S | 96% / 99% S | 99% / 99% S | 98% / 99% S | 98% / 99% S |
| good choir singer | dieu-1-5 | 4 | uncal200 | 47% / 63% C | 50% / 66% C | 53% / 68% C | 57% / 68% C | 57% / 68% C |
| operatic vibrato | warmup-7-12 | 1 | cal | 99% / 99% S | 94% / 99% S | 100% / 99% S | 99% / 100% S | 99% / 99% S |
| operatic vibrato | warmup-7-12 | 1 | uncal200 | 98% / 100% S | 92% / 99% S | 99% / 100% S | 100% / 100% S | 100% / 100% S |
| operatic vibrato | warmup-7-12 | 4 | cal | 98% / 98% S | 54% / 58% C | 99% / 98% S | 97% / 97% S | 97% / 95% S |
| operatic vibrato | warmup-7-12 | 4 | uncal200 | 89% / 96% S | 48% / 45% D | 89% / 95% A | 95% / 96% S | 99% / 99% S |
| operatic vibrato | dieu-1-5 | 1 | cal | 100% / 99% S | 94% / 98% S | 100% / 99% S | 100% / 99% S | 100% / 99% S |
| operatic vibrato | dieu-1-5 | 1 | uncal200 | 85% / 96% S | 75% / 93% A | 86% / 96% S | 87% / 96% S | 87% / 96% S |
| operatic vibrato | dieu-1-5 | 4 | cal | 92% / 97% S | 72% / 75% B | 93% / 97% S | 91% / 95% S | 91% / 95% S |
| operatic vibrato | dieu-1-5 | 4 | uncal200 | 46% / 54% C | 32% / 40% D | 50% / 56% C | 54% / 61% C | 54% / 60% C |

Cells: in tune / accuracy grade.
