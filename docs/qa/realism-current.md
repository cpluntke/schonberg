# Realism: before / after the scoring fixes

Generated 2026-10-04T17:09:16.145Z by `npx vitest run --config vitest.realism.config.ts` (files `qa/realism/cmp-*.test.ts`). The same rendered takes are scored by both pipelines:

- **before** = baseline app (frozen `qa/realism/baseline/`, as in `docs/qa/realism-baseline.md`): N=2048 window, `scoreAttempt`, onset-based delay learning that re-scores the same run, pass = accuracy only, and an uncalibrated estimate of 80 ms.
- **after** = current app at `5eae9fe` plus uncommitted changes in `rc/ui/screens/Play.tsx`. The analysis window comes from `windowFor(part.low)` (1024 for these alto parts). Then `scoreAttempt` → `scoreAligned`, two-run delay learning and the Android estimate of 130 ms. Play.tsx/session policy detected from the source: LATE_FAIL_MS=250; GUIDE_LEARN_MAX_ABOVE=150; timing gate: measured; liftSubharmonics: true; session stores raw samples.
- **after (80 ms estimate)** = the current app with the old 80 ms estimate (an iPhone-like device). It separates the estimate change from the rest.

Run cells: `grade accuracy%` (✗ = run failed), `al±N` = the voice was shifted N ms for intonation, `→N ms` = the stored delay changed to N, `TF` = failed by the timing gate (median entry in ms), `[…]` = timing/wrong-note tips. Sequences are 3 consecutive runs (new performance each run) on a phone whose stored delay carries over.

## Key numbers

- **Good singer L1, calibrated:** before 100% in tune / 100% acc (S×6), after 100% / 100% (S×6).
- **Good singer L1, true 200 ms, uncalibrated** (in tune/acc over 6 sections): before run 1: 95%/99% S×6 (6/6 pass); run 2: 95%/99% S×6 (6/6 pass); run 3: 94%/99% S×6 (6/6 pass). After run 1: 100%/100% S×6 (6/6 pass); run 2: 100%/100% S×6 (6/6 pass); run 3: 99%/99% S×5 A×1 (6/6 pass). After with 80 ms estimate: run 1: 100%/100% S×6 (6/6 pass); run 2: 100%/100% S×6 (6/6 pass); run 3: 99%/99% S×5 A×1 (6/6 pass).
- **Good singer L1, true 280 ms, uncalibrated** (in tune/acc over 6 sections): before run 1: 99%/99% S×6 (6/6 pass); run 2: 100%/100% S×6 (6/6 pass); run 3: 100%/100% S×6 (6/6 pass). After run 1: 99%/99% S×6 (6/6 pass); run 2: 100%/100% S×6 (6/6 pass); run 3: 100%/100% S×6 (6/6 pass). After with 80 ms estimate: run 1: 99%/99% S×6 (6/6 pass); run 2: 100%/100% S×6 (6/6 pass); run 3: 100%/100% S×6 (6/6 pass).
- **Good singer L4, calibrated:** before 97% in tune / 98% acc (S×6), after 99% / 99% (S×6).
- **Good singer L4, true 200 ms, uncalibrated** (in tune/acc over 6 sections): before run 1: 79%/88% S×3 A×1 B×1 C×1 (4/6 pass); run 2: 78%/89% S×3 A×1 B×1 C×1 (4/6 pass); run 3: 78%/87% S×3 A×2 C×1 (5/6 pass). After run 1: 99%/98% S×5 A×1 (6/6 pass); run 2: 100%/99% S×6 (6/6 pass); run 3: 99%/99% S×6 (6/6 pass). After with 80 ms estimate: run 1: 99%/98% S×5 A×1 (6/6 pass); run 2: 100%/99% S×6 (6/6 pass); run 3: 99%/99% S×6 (6/6 pass).
- **Good singer L4, true 280 ms, uncalibrated** (in tune/acc over 6 sections): before run 1: 89%/90% S×5 D×1 (5/6 pass); run 2: 98%/98% S×6 (6/6 pass); run 3: 98%/97% S×5 A×1 (6/6 pass). After run 1: 99%/99% S×6 (6/6 pass); run 2: 99%/98% S×6 (6/6 pass); run 3: 98%/98% S×5 A×1 (6/6 pass). After with 80 ms estimate: run 1: 99%/99% S×6 (6/6 pass); run 2: 99%/98% S×6 (6/6 pass); run 3: 98%/98% S×5 A×1 (6/6 pass).
- **C/A/A check, Debussy bars 1–5 at L2, 3 runs × 4 seeds (letters per run):** true 200 ms: before C/B/B, C/B/C, C/C/C, C/C/C; after S/S/S, S/S/S, S/S/S, S/S/S. true 215 ms: before C/C/C, C/C/S, C/C/C, C/C/S; after S/S/S, S/S/S, S/S/S, S/S/S. true 230 ms: before C/C/C, S/S/S, S/S/S, S/S/S; after S/S/S, S/S/S, S/S/S, S/S/S. true 280 ms: before S/S/S, D/S/S, S/S/S, S/S/S; after S/S/S, S/S/S, S/S/S, S/S/S.
- **Tracker (good singer):** steady median 3.1 → 3.4¢, near-transition p90 20.0 → 19.4¢, displayed overshoot 19 → 21¢ (voice 28¢), invented 0% → 0%.
- **Tracker with speaker bleed −13 dB (L1):** octave/subharmonic readings 27% → 0%, >50¢ off 28% → 1%, scored 77% → 100% accuracy.
- **Speaker bleed, good singer, calibrated (accuracy, mean of 2 sections, before → after):** -18 dB: L1 91% → 100%, L4 82% → 97%; -13 dB: L1 77% → 100%, L4 62% → 87%; -8 dB: L1 42% → 90%, L4 26% → 69%.
- **Live cents bubble after a note change (good singer, L1):** readout toward the previous note beyond tolerance in 100% → 77% of changes (calibrated), 100% → 100% at true 280 ms uncalibrated (run 1); beyond the new note 4% → 12%; out of tolerance until 137 → 155 ms.
- **Real-recording path** (16-bit WAV + current-app sidecar → `scoreRecordingApp`): accuracy 99% direct vs 99% via the file (shift 80 / 80 ms).
- **Sanity guard (current app):** all must-fail runs fail.

## Observations (hand-written for the run on the commit shown above; all takes are seeded)

1. **Good singers: fixed.** At every level and latency tested, the current app grades the good choir singer S on 6/6 sections (one A in 36 runs). Uncalibrated L4 at a true 200 ms used to give in tune 79 % with C on Debussy bars 1–5; it now gives 99 % in tune and 98–99 % accuracy. The voice is shifted (`al+…`) by 50–80 ms at a true 200 ms and 110–160 ms at a true 280 ms. Calibrated takes did not lose anything (L4 97 → 99 % in tune). Ablation and oracle are unchanged or better.
2. **C/A/A is gone.** At L2 near the old learning cliff (true 200/215/230/280 ms, 4 seeds × 3 runs) every run is S, where before it was C/C/S, C/B/C and so on. The two-run learning stores 185–205 ms for a true 200 ms and 250–290 ms for a true 280 ms (run 2). Repeatability at L4 uncalibrated: accuracy 55–75 % (0/10 pass) → 95–100 % (10/10 pass).
3. **Speaker bleed: mostly fixed.** Pooled octave/subharmonic readings drop from 27 % to 0 % at −13 dB (L1), and that take's accuracy goes from 77 % to 100 %. With headphones, the tracker is unchanged or better at N=1024 (steady 3.4¢ median, no invented overshoot). The fix still has limits on the warm-up chorale at L4 (no guide): 11 % residual subharmonic readings at −13 dB (B, fail) and 28 % at −8 dB (C, fail). At −8 dB Debussy L4 is B (80 %, fail). Loud bleed without headphones can still fail a good singer at L4 (P2).
4. **Echo singer (right notes, 300 ms late, device 130 ms).** With a *measured* delay it fails L2 and L4 via the timing gate (TF 317–337 ms) with a behind-beat tip. At L1 there is no gate, so on the warm-up it passes with S plus the tip; on Debussy it fails on accuracy. With an *uncalibrated* phone it passes every run with S at L1 and L2. The alignment absorbs the lateness (al +270…+300). The behind-beat tip shows in runs 1–2. After the delay is learned (capped at 130 + 150 = 280 ms because the guide plays), run 3 still needs al +140…+150 and **the tip disappears**. This is by design (no delay check means no way to separate late singing from delay), but the run-3 result tells the singer nothing about being late.
5. **New exploit: one note behind on an uncalibrated phone (P2).** Singing every pitch one note late scores 17 % with a measured delay and 17 % before the change. Uncalibrated, the lag search (up to +300 ms) lines the trace up with the *next* note on Debussy's quick ornaments. It then scores 71–77 % (B) and **passes L1 on run 2 (77 % ≥ 75 %)**. On the warm-up (longer notes) it reaches only 50 % at L2. Suggestion: cap the uncalibrated search at what the device can plausibly add (e.g. estimate + 150 ms, like the learning cap), or require the lag to agree with the median onset shift.
6. **Late pitch arrival (pitch moves 200 ms after the beat on every legato change).** It used to score C/D; it now scores A 91–94 % on Debussy at L2/L4 with a measured delay (warm-up: S, but the timing gate fails it at L2/L4, TF 257–265). Three allowances add up to forgive it: the calibrated ±80 ms alignment shift, the 35 %-of-note cap and the TRANSITION_MAX arrival window. On Debussy the median onset (≈ 230 ms) stays under the 250 ms gate.
7. **TRANSITION_MAX: 0.25 s is more lenient than the data needs.** For all realistic good voices tested (good, operatic, ringing ζ≈0.35, slow fn 3–4 Hz), scores are identical at 0.10, 0.15, 0.25 and 0.35 s. On these sections the 35 %-of-note cap and the arrival rule decide. Only the late-arrival singer reacts (Debussy L4 in tune 72 → 80 → 81 → 81 % for 0.10 → 0.15 → 0.25 → 0.35). Nothing is gained above 0.15 s for good singers. 0.15 s would keep the protection and cost slow arrivals a little more; 0.10 s starts to touch them (warm-up L4 late arrival 89 %). Recommendation: 0.15 s. The bigger lever on late arrival is the ±80 ms calibrated shift (item 6).
8. **Live cents bubble.** Comparing against the note at the reading's own time removes the playhead mismatch. Still, 77 % of note changes (calibrated, L1) briefly show more than the tolerance toward the previous pitch, for about 155 ms. That is the voice's real glide plus the 0.2 s readout average, which still mixes readings from the previous note when the step is ≤ 1.5 semitones. Uncalibrated at a true 280 ms it is 100 %, because readings are stamped late. Beyond-the-note readouts rose from 4 % to 12 % (the real overshoot is now visible).
9. **Learning cap.** While the guide plays (L1/L2), the learned delay is capped at estimate + 150 = 280 ms. A true round trip above ~280 ms (e.g. Bluetooth) can never be fully learned at L1/L2; the per-run alignment covers the rest (true 280 → learned 255–280 here).
10. **No regressions** in the grid, bleed or ablation tables beyond noise: one run went from 98 % to 93 % (S → A), still a pass. Wrong notes (40 %) fail everywhere (53–64 %), before and after. The −40¢ singer still passes L1 (B, inside ±50¢) and fails L2/L4.

## 1. Tracker fidelity (smoothed output vs ground-truth f0, cents), before → after

Takes: dieu-1-5 and warmup-7-12 (Alto), L4 tempo, calibrated, headphones unless noted. "after" = current window and the subharmonic correction the scorer applies.

| singer | steady med | steady p90 | near p90 | near p99 | >50¢ near | octave | missed voiced | false voiced | overshoot voice / tracker | invented | scored in tune / acc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| good choir singer | 3.1 → 3.4 | 8.4 → 8.8 | 20.0 → 19.4 | 74 → 60 | 3% → 2% | 0% → 0% | 3% → 3% | 14% → 12% | 28 / 19 → 21 | 0% → 0% | 98%/99% → 99%/99% |
| operatic vibrato | 7.5 → 7.0 | 18.8 → 17.9 | 29.1 → 26.0 | 106 → 101 | 4% → 5% | 0% → 0% | 2% → 3% | 14% → 13% | 41 / 34 → 35 | 0% → 0% | 96%/97% → 99%/99% |
| control (no vibrato, no overshoot) | 1.9 → 2.1 | 5.1 → 5.8 | 15.9 → 14.0 | 50 → 47 | 1% → 1% | 0% → 0% | 2% → 2% | 13% → 13% | 2 / 3 → 3 | 0% → 0% | 98%/99% → 99%/100% |
| ringing transitions (zeta 0.35) | 3.3 → 3.6 | 8.2 → 8.5 | 32.4 → 28.4 | 97 → 118 | 5% → 4% | 0% → 0% | 3% → 3% | 15% → 14% | 68 / 47 → 50 | 0% → 0% | 91%/95% → 92%/98% |
| good choir singer + speaker bleed −13 dB (L1) | 6.5 → 4.7 | 1904.7 → 12.1 | 1896.7 → 22.4 | 1945 → 190 | 17% → 5% | 27% → 0% | 3% → 3% | 10% → 9% | 29 / 480 → 24 | 24% → 0% | 73%/77% → 100%/100% |

## 2. Good singers: latency × section × level, before → after

### good choir singer

Calibrated = true and measured delay 150 ms. Oracle = true f0 with the true latency (no tracker), plain scorer.

| section | L | before in tune / acc | before | after in tune / acc | after | oracle acc before / after | bubble lag before / after |
|---|---|---|---|---|---|---|---|
| warmup-upbeat-6 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 79% |
| warmup-7-12 | 1 | 99% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 79% |
| dieu-1-5 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 85% |
| dieu-6-13 | 1 | 99% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 74% |
| tabourin-solo-1-8 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 92% |
| tabourin-solo-9-16 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 53% |
| warmup-upbeat-6 | 4 | 100% / 99% | S pass | 100% / 98% | S 98 | 99% / 100% | 100% / 93% |
| warmup-7-12 | 4 | 99% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 86% |
| dieu-1-5 | 4 | 96% / 99% | S pass | 98% / 99% | S 99 | 99% / 99% | 100% / 85% |
| dieu-6-13 | 4 | 94% / 99% | S pass | 97% / 98% | S 98 | 99% / 99% | 100% / 68% |
| tabourin-solo-1-8 | 4 | 93% / 95% | S pass | 99% / 98% | S 98 | 98% / 99% | 100% / 83% |
| tabourin-solo-9-16 | 4 | 98% / 99% | S pass | 99% / 99% | S 99 | 100% / 100% | 100% / 82% |

Uncalibrated phone (fresh profile, then runs 2–3 with whatever the app stored):

| section | L | true | before | after | after (80 ms estimate) |
|---|---|---|---|---|---|
| warmup-upbeat-6 | 1 | 200 ms | S 100 · S 100 · S 100 | S 100 · S 100 al+70 · S 100 | S 100 al+100 · S 100 al+120 →190ms · S 100 |
| warmup-upbeat-6 | 1 | 280 ms | S 95 →266ms · S 100 · S 100 | S 95 al+120 · S 100 al+130 →255ms · S 100 | S 95 al+140 · S 100 al+140 →220ms · S 100 |
| warmup-7-12 | 1 | 200 ms | S 100 · S 100 · S 100 | S 100 · S 100 →130ms · S 100 | S 100 al+90 · S 100 al+100 →175ms · S 100 |
| warmup-7-12 | 1 | 280 ms | S 100 →250ms · S 100 · S 100 | S 100 al+120 · S 100 al+120 →250ms · S 100 | S 100 al+140 · S 100 al+140 →220ms · S 100 |
| dieu-1-5 | 1 | 200 ms | S 96 · S 97 · S 97 | S 100 al+60 · S 100 al+70 →195ms · S 100 | S 100 al+110 · S 100 al+120 →195ms · S 100 |
| dieu-1-5 | 1 | 280 ms | S 100 →256ms · S 100 · S 100 | S 100 al+140 · S 100 al+140 →270ms · S 100 | S 100 al+150 · S 100 al+150 →230ms · S 100 al+50 |
| dieu-6-13 | 1 | 200 ms | S 99 · S 99 · S 99 | S 100 al+60 · S 100 al+60 →190ms · S 100 | S 100 al+110 · S 100 al+110 →190ms · S 100 |
| dieu-6-13 | 1 | 280 ms | S 100 →247ms · S 98 · S 100 | S 100 al+130 · S 98 al+140 →265ms · S 100 | S 100 al+150 · S 98 al+150 →230ms · S 100 al+40 |
| tabourin-solo-1-8 | 1 | 200 ms | S 99 · S 100 · S 98 | S 100 al+80 · S 100 al+70 →205ms · A 93 | S 100 al+130 · S 100 al+120 →205ms · A 93 |
| tabourin-solo-1-8 | 1 | 280 ms | S 100 →253ms · S 100 · S 100 | S 100 al+150 · S 100 al+150 →280ms · S 100 | S 100 al+150 · S 100 al+150 →230ms · S 100 |
| tabourin-solo-9-16 | 1 | 200 ms | S 100 · S 100 · S 100 | S 99 al+60 · S 100 al+60 →190ms · S 100 | S 99 al+100 · S 100 al+100 →180ms · S 100 |
| tabourin-solo-9-16 | 1 | 280 ms | S 100 →208ms · S 100 · S 100 | S 100 al+120 · S 100 al+130 →255ms · S 100 | S 100 al+150 · S 100 al+150 →230ms · S 100 |
| warmup-upbeat-6 | 4 | 200 ms | S 99 · S 98 · S 98 | S 100 · S 97 al+60 →160ms · S 99 | S 100 al+90 · S 97 al+110 →180ms · S 99 |
| warmup-upbeat-6 | 4 | 280 ms | S 99 →242ms · S 99 · S 98 | S 99 al+120 · S 99 al+130 →255ms · S 98 | S 99 al+170 · S 99 al+180 →255ms · S 98 |
| warmup-7-12 | 4 | 200 ms | S 99 · S 99 · S 99 | S 99 al+50 · S 99 →155ms · S 100 | S 99 al+100 · S 99 al+90 →175ms · S 99 |
| warmup-7-12 | 4 | 280 ms | S 99 →255ms · S 98 · S 99 | S 99 al+130 · S 97 al+110 →250ms · S 99 | S 99 al+180 · S 97 al+160 →250ms · S 99 |
| dieu-1-5 | 4 | 200 ms | C 63 ✗ · C 65 ✗ · C 55 ✗ | S 99 al+80 · S 98 al+70 →205ms · S 97 | S 99 al+130 · S 98 al+120 →205ms · S 97 |
| dieu-1-5 | 4 | 280 ms | D 45 ✗ · S 99 →247ms · S 99 | S 99 al+150 · S 99 al+150 →280ms · S 99 | S 99 al+200 · S 99 al+200 →280ms · S 99 |
| dieu-6-13 | 4 | 200 ms | B 82 ✗ · B 82 ✗ · A 86 | S 99 al+80 · S 99 al+70 →205ms · S 99 | S 99 al+130 · S 99 al+120 →205ms · S 99 |
| dieu-6-13 | 4 | 280 ms | S 98 →263ms · S 95 · A 92 | S 98 al+160 · S 97 al+160 →290ms · A 91 | S 98 al+210 · S 97 al+210 →290ms · A 91 |
| tabourin-solo-1-8 | 4 | 200 ms | S 98 · A 92 · S 96 | S 100 al+70 · S 100 al+80 →205ms · S 99 | S 100 al+120 · S 100 al+130 →205ms · S 99 |
| tabourin-solo-1-8 | 4 | 280 ms | S 100 →248ms · S 100 · S 99 | S 100 al+150 · S 100 al+160 →285ms · S 99 | S 100 al+200 · S 100 al+210 →285ms · S 99 |
| tabourin-solo-9-16 | 4 | 200 ms | A 87 · S 97 · A 89 | A 94 al+60 · S 99 al+50 →185ms · S 98 | A 94 al+100 · S 99 al+100 →180ms · S 98 |
| tabourin-solo-9-16 | 4 | 280 ms | S 99 →219ms · S 99 · S 98 | S 99 al+130 · S 97 al+150 →270ms · S 99 | S 99 al+180 · S 97 al+200 →270ms · S 99 |

### operatic vibrato

Calibrated = true and measured delay 150 ms. Oracle = true f0 with the true latency (no tracker), plain scorer.

| section | L | before in tune / acc | before | after in tune / acc | after | oracle acc before / after | bubble lag before / after |
|---|---|---|---|---|---|---|---|
| dieu-1-5 | 1 | 99% / 100% | S pass | 100% / 99% | S 99 | 100% / 100% | 100% / 75% |
| dieu-6-13 | 1 | 99% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 79% |
| warmup-7-12 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 86% |
| dieu-1-5 | 4 | 95% / 98% | S pass | 98% / 98% | S 98 | 97% / 98% | 100% / 95% |
| dieu-6-13 | 4 | 90% / 93% | A pass | 95% / 95% | A 95 | 97% / 98% | 100% / 65% |
| warmup-7-12 | 4 | 98% / 97% | S pass | 100% / 99% | S 99 | 99% / 99% | 100% / 86% |

Uncalibrated phone (fresh profile, then runs 2–3 with whatever the app stored):

| section | L | true | before | after | after (80 ms estimate) |
|---|---|---|---|---|---|
| dieu-1-5 | 1 | 200 ms | S 96 | S 100 al+60 | S 100 al+110 |
| dieu-1-5 | 1 | 280 ms | S 100 →256ms | S 100 al+130 | S 100 al+150 |
| dieu-6-13 | 1 | 200 ms | S 97 | S 100 al+60 | S 100 al+110 |
| dieu-6-13 | 1 | 280 ms | S 97 →247ms | S 97 al+130 | S 97 al+140 |
| warmup-7-12 | 1 | 200 ms | S 99 | S 100 | S 100 |
| warmup-7-12 | 1 | 280 ms | S 100 →254ms | S 100 al+100 | S 100 al+140 |
| dieu-1-5 | 4 | 200 ms | C 64 ✗ | S 97 al+60 | S 97 al+110 |
| dieu-1-5 | 4 | 280 ms | S 98 →249ms | S 98 al+150 | S 98 al+200 |
| dieu-6-13 | 4 | 200 ms | B 79 ✗ | A 94 al+70 | A 94 al+120 |
| dieu-6-13 | 4 | 280 ms | S 95 →247ms | S 96 al+160 | S 96 al+210 |
| warmup-7-12 | 4 | 200 ms | S 96 | S 99 | S 99 al+100 |
| warmup-7-12 | 4 | 280 ms | S 97 →253ms | S 95 al+120 | S 95 al+170 |

### Three runs in a row at L2 near the old learning threshold (Debussy bars 1–5)

| true | seed | before | after | after (80 ms estimate) |
|---|---|---|---|---|
| 200 ms | 1 | C 62 ✗ · B 73 ✗ · B 73 ✗ | S 100 al+60 · S 98 al+70 →195ms · S 99 | S 100 al+110 · S 99 al+120 →195ms · S 99 |
| 200 ms | 2 | C 66 ✗ · B 74 ✗ · C 66 ✗ | S 99 al+60 · S 98 al+70 →195ms · S 99 | S 99 al+110 · S 98 al+120 →195ms · S 99 |
| 200 ms | 3 | C 69 ✗ · C 63 ✗ · C 66 ✗ | S 99 al+80 · S 99 al+70 →205ms · S 99 | S 99 al+130 · S 99 al+120 →205ms · S 99 |
| 200 ms | 4 | C 65 ✗ · C 66 ✗ · C 69 ✗ | S 99 al+70 · S 100 al+80 →205ms · S 98 | S 99 al+120 · S 100 al+130 →205ms · S 98 |
| 215 ms | 1 | C 57 ✗ · C 61 ✗ · C 60 ✗ | S 98 al+80 · S 96 al+80 →210ms · S 98 | S 98 al+130 · S 96 al+130 →210ms · S 98 |
| 215 ms | 2 | C 65 ✗ · C 62 ✗ · S 98 →205ms | S 99 al+80 · S 98 al+80 →210ms · S 99 | S 99 al+130 · S 98 al+130 →210ms · S 99 |
| 215 ms | 3 | C 55 ✗ · C 58 ✗ · C 58 ✗ | S 99 al+80 · S 100 al+80 →210ms · S 100 | S 99 al+130 · S 100 al+130 →210ms · S 100 |
| 215 ms | 4 | C 60 ✗ · C 60 ✗ · S 99 →205ms | S 99 al+100 · S 99 al+100 →230ms · S 98 | S 99 al+150 · S 99 al+140 →225ms · S 98 |
| 230 ms | 1 | C 53 ✗ · C 56 ✗ · C 56 ✗ | S 95 al+100 · S 99 al+100 →230ms · S 99 | S 95 al+150 · S 99 al+140 →225ms · S 99 |
| 230 ms | 2 | S 100 →210ms · S 99 · S 98 | S 100 al+100 · S 99 al+100 →230ms · S 99 | S 100 al+150 · S 99 al+150 →230ms · S 99 |
| 230 ms | 3 | S 100 →207ms · S 100 · S 100 | S 100 al+100 · S 100 al+100 →230ms · S 100 | S 100 al+150 · S 100 al+150 →230ms · S 100 |
| 230 ms | 4 | S 99 →207ms · S 100 · S 99 | S 100 al+100 · S 99 al+110 →235ms · S 99 | S 100 al+150 · S 99 al+150 →230ms · S 99 |
| 280 ms | 1 | S 98 →247ms · S 100 · S 99 | S 99 al+140 · S 100 al+140 →270ms · S 99 | S 99 al+150 · S 99 al+150 →230ms · S 99 al+40 |
| 280 ms | 2 | D 47 ✗ · S 98 →247ms · S 100 | S 99 al+150 · S 97 al+150 →280ms · S 99 | S 99 al+150 · S 98 al+150 →230ms · S 98 al+50 |
| 280 ms | 3 | S 98 →247ms · S 100 · S 99 | S 99 al+140 · S 99 al+150 →275ms · S 99 | S 98 al+150 · S 99 al+150 →230ms · S 99 al+50 |
| 280 ms | 4 | S 100 →247ms · S 99 · S 98 | S 100 al+140 · S 100 al+150 →275ms · S 99 | S 99 al+150 · S 98 al+150 →230ms · S 99 al+50 |

### Phone speaker, no headphones (bleed sweep), before → after

| singer | bleed | section | L | latency | before in tune / acc | before | after in tune / acc | after | octave/subharm. readings |
|---|---|---|---|---|---|---|---|---|---|
| good choir singer | -18 dB | dieu-1-5 | 1 | cal | 89% / 93% | A pass | 100% / 100% | S 100 | 3% → 0% |
| good choir singer | -18 dB | dieu-1-5 | 4 | cal | 80% / 84% | B FAIL | 98% / 99% | S 99 | 18% → 0% |
| good choir singer | -18 dB | warmup-7-12 | 1 | cal | 92% / 90% | A pass | 100% / 100% | S 100 | 2% → 0% |
| good choir singer | -18 dB | warmup-7-12 | 4 | cal | 80% / 80% | B FAIL | 95% / 95% | A 95 | 14% → 2% |
| good choir singer | -13 dB | dieu-1-5 | 1 | cal | 61% / 69% | C FAIL | 100% / 100% | S 100 | 56% → 0% |
| good choir singer | -13 dB | dieu-1-5 | 4 | cal | 56% / 57% | C FAIL | 94% / 95% | A 95 | 61% → 2% |
| good choir singer | -13 dB | warmup-7-12 | 1 | cal | 86% / 86% | A pass | 100% / 100% | S 100 | 9% → 0% |
| good choir singer | -13 dB | warmup-7-12 | 4 | cal | 65% / 66% | C FAIL | 81% / 80% | B 80 ✗ | 25% → 11% |
| good choir singer | -8 dB | dieu-1-5 | 1 | cal | 39% / 47% | D FAIL | 100% / 100% | S 100 | 70% → 0% |
| good choir singer | -8 dB | dieu-1-5 | 4 | cal | 29% / 33% | D FAIL | 83% / 80% | B 80 ✗ | 77% → 5% |
| good choir singer | -8 dB | warmup-7-12 | 1 | cal | 42% / 38% | D FAIL | 82% / 80% | B 80 | 31% → 9% |
| good choir singer | -8 dB | warmup-7-12 | 4 | cal | 20% / 19% | D FAIL | 59% / 57% | C 57 ✗ | 77% → 28% |
| good choir singer | -13 dB | dieu-1-5 | 1 | uncal200 | 49% / 66% | C FAIL | 99% / 99% | S 99 | 56% → 0% |
| good choir singer | -13 dB | dieu-1-5 | 4 | uncal200 | 19% / 38% | D FAIL | 80% / 91% | A 91 | 61% → 3% |
| good choir singer | -13 dB | warmup-7-12 | 1 | uncal200 | 84% / 86% | A pass | 100% / 100% | S 100 | 8% → 0% |
| good choir singer | -13 dB | warmup-7-12 | 4 | uncal200 | 35% / 37% | D FAIL | 71% / 71% | B 71 ✗ | 47% → 25% |
| operatic vibrato | -13 dB | dieu-1-5 | 1 | cal | 77% / 80% | B pass | 100% / 99% | S 99 | 8% → 0% |
| operatic vibrato | -13 dB | dieu-1-5 | 4 | cal | 39% / 57% | C FAIL | 92% / 93% | A 93 | 61% → 2% |
| operatic vibrato | -13 dB | warmup-7-12 | 1 | cal | 71% / 72% | B FAIL | 95% / 95% | S 95 | 15% → 4% |
| operatic vibrato | -13 dB | warmup-7-12 | 4 | cal | 34% / 30% | D FAIL | 77% / 73% | B 73 ✗ | 40% → 13% |

## 3. Repeatability (good singer, Debussy bars 1–5, fresh profile each run)

| L | latency | mode | pipeline | accuracy min–max (sd) | in tune min–max | letters | passes |
|---|---|---|---|---|---|---|---|
| 1 | cal | micro | before | 100%–100% (0.0) | 100%–100% | S×10 | 10/10 |
| 1 | cal | micro | after | 100%–100% (0.0) | 100%–100% | S×10 | 10/10 |
| 1 | cal | performance | before | 99%–100% (0.3) | 95%–100% | S×10 | 10/10 |
| 1 | cal | performance | after | 99%–100% (0.2) | 95%–100% | S×10 | 10/10 |
| 1 | uncal200 | micro | before | 96%–98% (0.7) | 85%–94% | S×10 | 10/10 |
| 1 | uncal200 | micro | after | 100%–100% (0.0) | 100%–100% | S×10 | 10/10 |
| 1 | uncal200 | performance | before | 94%–97% (0.7) | 76%–94% | S×9 A×1 | 10/10 |
| 1 | uncal200 | performance | after | 99%–100% (0.4) | 97%–100% | S×10 | 10/10 |
| 4 | cal | micro | before | 98%–99% (0.5) | 94%–98% | S×10 | 10/10 |
| 4 | cal | micro | after | 98%–100% (0.6) | 97%–100% | S×10 | 10/10 |
| 4 | cal | performance | before | 97%–100% (0.9) | 94%–99% | S×10 | 10/10 |
| 4 | cal | performance | after | 97%–100% (0.8) | 95%–100% | S×10 | 10/10 |
| 4 | uncal200 | micro | before | 55%–67% (3.5) | 46%–48% | C×10 | 0/10 |
| 4 | uncal200 | micro | after | 98%–99% (0.6) | 94%–100% | S×10 | 10/10 |
| 4 | uncal200 | performance | before | 56%–75% (5.0) | 46%–55% | B×1 C×9 | 0/10 |
| 4 | uncal200 | performance | after | 95%–100% (1.3) | 95%–99% | S×10 | 10/10 |

## 4. Sanity and adversarial singers (device round trip 130 ms)

"measured 130" = the delay check was done; "uncalibrated" = 3 runs in a row with the app's learning. Echo = right notes, 300 ms behind what the singer hears; one note behind = each pitch one note late; late pitch arrival = consonant on time, pitch moves 200 ms after the beat.

| singer | section | L | delay | before | after |
|---|---|---|---|---|---|
| wrong notes (40 %) | dieu-1-5 | 1 | measured 130 | C 58 ✗ [wrong-notes] | C 58 ✗ [wrong-notes] |
| wrong notes (40 %) | dieu-1-5 | 2 | measured 130 | C 58 ✗ [wrong-notes] | C 58 ✗ [wrong-notes] |
| wrong notes (40 %) | dieu-1-5 | 4 | measured 130 | C 53 ✗ [wrong-notes] | C 55 ✗ [wrong-notes] |
| wrong notes (40 %) | dieu-1-5 | 1 | uncalibrated (true 130) | C 58 ✗ [wrong-notes] · C 57 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] | C 58 ✗ [wrong-notes] · C 58 ✗ [wrong-notes] · C 58 ✗ [wrong-notes] |
| wrong notes (40 %) | dieu-1-5 | 2 | uncalibrated (true 130) | C 56 ✗ [wrong-notes] · C 64 ✗ [wrong-notes] · C 64 ✗ [wrong-notes] | C 57 ✗ [wrong-notes] · C 55 ✗ [wrong-notes] · C 56 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 1 | measured 130 | C 62 ✗ [wrong-notes] | C 62 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 2 | measured 130 | C 62 ✗ [wrong-notes] | C 62 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 4 | measured 130 | C 62 ✗ [wrong-notes] | C 62 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 1 | uncalibrated (true 130) | C 62 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] | C 62 ✗ [wrong-notes] · C 61 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 2 | uncalibrated (true 130) | C 62 ✗ [wrong-notes] · C 61 ✗ [wrong-notes] · C 60 ✗ [wrong-notes] | C 62 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] |
| flat −40¢ | dieu-1-5 | 1 | measured 130 | B 80 | B 80 |
| flat −40¢ | dieu-1-5 | 2 | measured 130 | D 28 ✗ | D 32 ✗ |
| flat −40¢ | dieu-1-5 | 4 | measured 130 | D 6 ✗ | D 2 ✗ |
| flat −40¢ | dieu-1-5 | 1 | uncalibrated (true 130) | B 81 · B 83 · B 76 | B 82 · B 83 · B 75 |
| flat −40¢ | dieu-1-5 | 2 | uncalibrated (true 130) | D 35 ✗ · C 55 ✗ · D 49 ✗ | D 25 ✗ · D 37 ✗ · D 41 ✗ |
| flat −40¢ | warmup-7-12 | 1 | measured 130 | B 78 | B 78 |
| flat −40¢ | warmup-7-12 | 2 | measured 130 | D 33 ✗ | D 32 ✗ |
| flat −40¢ | warmup-7-12 | 4 | measured 130 | D 0 ✗ | D 0 ✗ |
| flat −40¢ | warmup-7-12 | 1 | uncalibrated (true 130) | B 75 · C 67 ✗ · B 85 | B 75 · C 69 ✗ · B 82 |
| flat −40¢ | warmup-7-12 | 2 | uncalibrated (true 130) | D 12 ✗ · D 17 ✗ · D 15 ✗ | D 12 ✗ · D 19 ✗ · D 12 ✗ |
| echo (300 ms behind) | dieu-1-5 | 1 | measured 130 | C 53 ✗ [behind-beat] | C 61 ✗ al+80 [behind-beat] |
| echo (300 ms behind) | dieu-1-5 | 2 | measured 130 | C 50 ✗ [behind-beat] | C 58 ✗ al+80 TF317 [behind-beat] |
| echo (300 ms behind) | dieu-1-5 | 4 | measured 130 | D 50 ✗ [behind-beat] | C 50 ✗ al+80 TF319 [behind-beat] |
| echo (300 ms behind) | dieu-1-5 | 1 | uncalibrated (true 130) | C 55 ✗ [behind-beat] · C 52 ✗ [behind-beat] · C 57 ✗ [behind-beat] | S 99 ✗ al+290 TF290 [behind-beat] · S 100 ✗ al+290 →280ms TF290 [behind-beat] · S 100 al+80 |
| echo (300 ms behind) | dieu-1-5 | 2 | uncalibrated (true 130) | D 49 ✗ [behind-beat] · D 48 ✗ [behind-beat] · D 47 ✗ [behind-beat] | S 99 ✗ al+300 TF300 [behind-beat] · S 99 ✗ al+300 →280ms TF300 [behind-beat] · A 91 al+70 [wrong-notes] |
| echo (300 ms behind) | warmup-7-12 | 1 | measured 130 | A 94 [behind-beat] | S 100 al+70 [behind-beat] |
| echo (300 ms behind) | warmup-7-12 | 2 | measured 130 | B 81 [behind-beat] | S 98 ✗ al+80 TF337 [behind-beat] |
| echo (300 ms behind) | warmup-7-12 | 4 | measured 130 | B 84 ✗ [behind-beat] | S 97 ✗ al+80 TF321 [behind-beat] |
| echo (300 ms behind) | warmup-7-12 | 1 | uncalibrated (true 130) | S 100 →400ms · S 100 · S 100 | S 100 al+140 [behind-beat] · S 99 al+140 →270ms [behind-beat] · S 100 al+70 |
| echo (300 ms behind) | warmup-7-12 | 2 | uncalibrated (true 130) | S 99 →400ms · S 99 · S 100 | S 100 al+150 [behind-beat] · S 100 al+150 →280ms [behind-beat] · S 100 al+80 |
| one note behind | dieu-1-5 | 1 | measured 130 | D 17 ✗ [wrong-notes] | D 17 ✗ [wrong-notes] |
| one note behind | dieu-1-5 | 2 | measured 130 | D 17 ✗ [wrong-notes] | D 17 ✗ [wrong-notes] |
| one note behind | dieu-1-5 | 4 | measured 130 | D 17 ✗ [wrong-notes] | D 17 ✗ [wrong-notes] |
| one note behind | dieu-1-5 | 1 | uncalibrated (true 130) | D 17 ✗ [wrong-notes] · D 17 ✗ [wrong-notes] · D 17 ✗ [wrong-notes] | D 17 ✗ [wrong-notes] · D 17 ✗ [wrong-notes] · D 17 ✗ [wrong-notes] |
| one note behind | dieu-1-5 | 2 | uncalibrated (true 130) | D 20 ✗ [wrong-notes] · D 20 ✗ [wrong-notes] · D 27 ✗ [wrong-notes] | C 65 ✗ al+440 TF440 [behind-beat] · C 61 ✗ al+440 TF440 [behind-beat] · C 63 ✗ al+440 TF440 [behind-beat] |
| one note behind | warmup-7-12 | 1 | measured 130 | D 33 ✗ [wrong-notes] | D 33 ✗ [wrong-notes] |
| one note behind | warmup-7-12 | 2 | measured 130 | D 33 ✗ [wrong-notes] | D 33 ✗ [wrong-notes] |
| one note behind | warmup-7-12 | 4 | measured 130 | D 33 ✗ [wrong-notes] | D 33 ✗ [wrong-notes] |
| one note behind | warmup-7-12 | 1 | uncalibrated (true 130) | D 33 ✗ [wrong-notes] · D 33 ✗ [wrong-notes] · D 33 ✗ [wrong-notes] | C 55 ✗ al+440 TF440 [behind-beat] · D 48 ✗ al+450 TF450 [behind-beat] · C 55 ✗ al+440 TF440 [behind-beat] |
| one note behind | warmup-7-12 | 2 | uncalibrated (true 130) | D 33 ✗ [wrong-notes] · D 33 ✗ [wrong-notes] · D 33 ✗ [wrong-notes] | B 75 ✗ al+450 TF450 [behind-beat] · B 74 ✗ al+450 TF450 [behind-beat] · B 74 ✗ al+450 TF450 [behind-beat] |
| late pitch arrival (200 ms) | dieu-1-5 | 1 | measured 130 | C 50 ✗ [wrong-notes] | A 91 al+80 [wrong-notes] |
| late pitch arrival (200 ms) | dieu-1-5 | 2 | measured 130 | D 39 ✗ [behind-beat] | A 90 al+80 [behind-beat] |
| late pitch arrival (200 ms) | dieu-1-5 | 4 | measured 130 | D 35 ✗ [behind-beat] | A 92 al+80 [behind-beat] |
| late pitch arrival (200 ms) | dieu-1-5 | 1 | uncalibrated (true 130) | S 100 →333ms [early-entries] · S 100 [early-entries] · S 100 [early-entries] | S 99 al+150 · S 100 al+150 →280ms · S 100 al+60 |
| late pitch arrival (200 ms) | dieu-1-5 | 2 | uncalibrated (true 130) | D 26 ✗ [wrong-notes] · S 98 →325ms [early-entries] · S 98 [early-entries] | S 100 al+140 [behind-beat] · S 100 al+150 →275ms [behind-beat] · S 98 al+40 [early-entries] |
| late pitch arrival (200 ms) | warmup-7-12 | 1 | measured 130 | S 97 | S 100 al+70 |
| late pitch arrival (200 ms) | warmup-7-12 | 2 | measured 130 | A 91 [behind-beat] | S 99 ✗ al+70 TF265 [behind-beat] |
| late pitch arrival (200 ms) | warmup-7-12 | 4 | measured 130 | A 86 [behind-beat] | S 97 ✗ al+70 TF257 [behind-beat] |
| late pitch arrival (200 ms) | warmup-7-12 | 1 | uncalibrated (true 130) | S 99 →336ms · S 95 · S 100 | S 100 al+140 [behind-beat] · S 95 al+140 →270ms · S 100 al+60 |
| late pitch arrival (200 ms) | warmup-7-12 | 2 | uncalibrated (true 130) | S 99 →337ms · S 99 · S 100 | S 99 al+140 [behind-beat] · S 99 al+150 →275ms [behind-beat] · S 100 al+70 |

## 5. TRANSITION_MAX sweep (current scorer + alignment, calibrated 150 ms)

Cells: in tune / accuracy grade (✗ = fails the level). Generated scorer variants differ only in `TRANSITION_MAX` (35 %-of-note cap unchanged).

| singer | section | L | 0.1 s | 0.15 s | 0.25 s | 0.35 s |
|---|---|---|---|---|---|---|
| good choir singer | dieu-1-5 | 2 | 99% / 99% S | 99% / 99% S | 99% / 99% S | 99% / 99% S |
| good choir singer | dieu-1-5 | 4 | 98% / 99% S | 98% / 99% S | 98% / 99% S | 98% / 99% S |
| good choir singer | warmup-7-12 | 2 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| good choir singer | warmup-7-12 | 4 | 100% / 99% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| operatic vibrato | dieu-1-5 | 2 | 99% / 98% S | 99% / 98% S | 99% / 98% S | 99% / 98% S |
| operatic vibrato | dieu-1-5 | 4 | 98% / 98% S | 98% / 98% S | 98% / 98% S | 98% / 98% S |
| operatic vibrato | warmup-7-12 | 2 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| operatic vibrato | warmup-7-12 | 4 | 100% / 99% S | 100% / 99% S | 100% / 99% S | 100% / 99% S |
| ringing transitions (zeta 0.35) | dieu-1-5 | 2 | 95% / 96% S | 95% / 96% S | 95% / 96% S | 95% / 96% S |
| ringing transitions (zeta 0.35) | dieu-1-5 | 4 | 83% / 95% S | 83% / 95% S | 83% / 95% S | 83% / 95% S |
| ringing transitions (zeta 0.35) | warmup-7-12 | 2 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| ringing transitions (zeta 0.35) | warmup-7-12 | 4 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| slow transitions (fn 3–4 Hz) | dieu-1-5 | 2 | 90% / 95% A | 90% / 95% A | 90% / 95% A | 90% / 95% A |
| slow transitions (fn 3–4 Hz) | dieu-1-5 | 4 | 86% / 92% A | 86% / 92% A | 86% / 92% A | 86% / 92% A |
| slow transitions (fn 3–4 Hz) | warmup-7-12 | 2 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| slow transitions (fn 3–4 Hz) | warmup-7-12 | 4 | 100% / 99% S | 100% / 99% S | 100% / 99% S | 100% / 99% S |
| late pitch arrival (200 ms) | dieu-1-5 | 2 | 78% / 92% A | 86% / 96% S | 87% / 97% S | 87% / 97% S |
| late pitch arrival (200 ms) | dieu-1-5 | 4 | 72% / 88% A | 80% / 94% A | 81% / 94% A | 81% / 94% A |
| late pitch arrival (200 ms) | warmup-7-12 | 2 | 92% / 96% S ✗ | 96% / 99% S ✗ | 100% / 100% S ✗ | 100% / 100% S ✗ |
| late pitch arrival (200 ms) | warmup-7-12 | 4 | 89% / 96% S ✗ | 96% / 98% S ✗ | 100% / 100% S ✗ | 100% / 100% S ✗ |
| wrong notes (40 %) | dieu-1-5 | 2 | 58% / 58% C ✗ | 58% / 58% C ✗ | 58% / 58% C ✗ | 58% / 58% C ✗ |
| wrong notes (40 %) | dieu-1-5 | 4 | 54% / 55% C ✗ | 54% / 55% C ✗ | 54% / 55% C ✗ | 54% / 55% C ✗ |
| wrong notes (40 %) | warmup-7-12 | 2 | 62% / 62% C ✗ | 62% / 62% C ✗ | 62% / 62% C ✗ | 62% / 62% C ✗ |
| wrong notes (40 %) | warmup-7-12 | 4 | 62% / 62% C ✗ | 62% / 62% C ✗ | 62% / 62% C ✗ | 62% / 62% C ✗ |
| one note behind | dieu-1-5 | 2 | 16% / 17% D ✗ | 16% / 17% D ✗ | 16% / 17% D ✗ | 16% / 17% D ✗ |
| one note behind | dieu-1-5 | 4 | 17% / 17% D ✗ | 17% / 17% D ✗ | 17% / 17% D ✗ | 17% / 17% D ✗ |
| one note behind | warmup-7-12 | 2 | 33% / 33% D ✗ | 33% / 33% D ✗ | 33% / 33% D ✗ | 33% / 33% D ✗ |
| one note behind | warmup-7-12 | 4 | 33% / 33% D ✗ | 33% / 33% D ✗ | 33% / 33% D ✗ | 33% / 33% D ✗ |

## 6. Ablation (calibrated, headphones), before → after

| step | section | L | before in tune / acc | after in tune / acc | oracle acc before / after |
|---|---|---|---|---|---|
| 0 idealised | dieu-1-5 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 0 idealised | dieu-1-5 | 4 | 100% / 100% S | 100% / 99% S | 100% / 100% |
| 0 idealised | warmup-7-12 | 1 | 97% / 99% S | 100% / 100% S | 100% / 100% |
| 0 idealised | warmup-7-12 | 4 | 99% / 100% S | 100% / 100% S | 100% / 100% |
| 1 + scatter & drift | dieu-1-5 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 1 + scatter & drift | dieu-1-5 | 4 | 99% / 100% S | 100% / 100% S | 100% / 100% |
| 1 + scatter & drift | warmup-7-12 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 1 + scatter & drift | warmup-7-12 | 4 | 100% / 100% S | 100% / 100% S | 99% / 99% |
| 2 + small vibrato | dieu-1-5 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 2 + small vibrato | dieu-1-5 | 4 | 99% / 98% S | 100% / 98% S | 99% / 99% |
| 2 + small vibrato | warmup-7-12 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 2 + small vibrato | warmup-7-12 | 4 | 100% / 99% S | 100% / 99% S | 99% / 99% |
| 3 + transitions & scoops | dieu-1-5 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 3 + transitions & scoops | dieu-1-5 | 4 | 100% / 99% S | 100% / 99% S | 99% / 99% |
| 3 + transitions & scoops | warmup-7-12 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 3 + transitions & scoops | warmup-7-12 | 4 | 99% / 97% S | 100% / 98% S | 98% / 99% |
| 4 + onset jitter | dieu-1-5 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 4 + onset jitter | dieu-1-5 | 4 | 100% / 99% S | 100% / 99% S | 99% / 99% |
| 4 + onset jitter | warmup-7-12 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 4 + onset jitter | warmup-7-12 | 4 | 100% / 98% S | 100% / 98% S | 99% / 99% |
| 5 + consonants (full) | dieu-1-5 | 1 | 100% / 100% S | 100% / 100% S | 100% / 100% |
| 5 + consonants (full) | dieu-1-5 | 4 | 96% / 99% S | 98% / 99% S | 99% / 99% |
| 5 + consonants (full) | warmup-7-12 | 1 | 99% / 100% S | 100% / 100% S | 100% / 100% |
| 5 + consonants (full) | warmup-7-12 | 4 | 99% / 100% S | 100% / 100% S | 100% / 100% |
