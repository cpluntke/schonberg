# Realism: before / after the scoring fixes

Generated 2026-10-04T22:04:35.167Z by `npx vitest run --config vitest.realism.config.ts` (files `qa/realism/cmp-*.test.ts`). The same rendered takes are scored by both pipelines:

- **before** = baseline app (frozen `qa/realism/baseline/`, as in `docs/qa/realism-baseline.md`): N=2048 window, `scoreAttempt`, onset-based delay learning that re-scores the same run, pass = accuracy only, and an uncalibrated estimate of 80 ms.
- **after** = current app at the working tree. The analysis window comes from `windowFor(part.low)` (1024 for these alto parts). Then `scoreAttempt` → `scoreAligned`, two-run delay learning and the Android estimate of 130 ms. Play.tsx/session policy detected from the source: –.
- **after (80 ms estimate)** = the current app with the old 80 ms estimate (an iPhone-like device). It separates the estimate change from the rest.

Run cells: `grade accuracy%` (✗ = run failed), `al±N` = the voice was shifted N ms for intonation, `→N ms` = the stored delay changed to N, `TF` = failed by the timing gate (median entry in ms), `[…]` = timing/wrong-note tips. Sequences are 3 consecutive runs (new performance each run) on a phone whose stored delay carries over.

## Key numbers

- **Fast notes (< 0.15 s), good singer, measured delay — share scored ok/miss, before (`54ea7b9`) → after:** L1 1.6% → 0.7%, L2 7.2% → 2.8%, L4 11.7% → 5.8%. See section 7.

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

## 7. Fast notes (good singer, measured delay), before → after

Before = the app at `54ea7b9` (`scoring.ts`, `align.ts`, `pitch.ts` from git), after = the working tree, both through the current pipeline on the same renders (true delay 150 ms, measured). "Fast" = shorter than 0.15 s as sung. Cells: accuracy, and the share of fast notes scored ok/miss. Synthetic runs are scales, thirds and neighbour figures, 2 bars per phrase; `ta` = a consonant on every note, `a` = none (melisma-like), `nolyr` = the singer model's default (a consonant on about half).

| passage | L1 before | L1 after | L2 before | L2 after | L4 before | L4 after |
|---|---|---|---|---|---|---|
| debussy-yver A b1-23 | 100% | 100% | 100% | 100% | 99% | 99% |
| debussy-dieu A b1-5 | 100% | 100% | 98% | 99% | 98% | 98% |
| ravel-nicolette A b20-45 | 98% | 98% | 97% | 98% | 97% | 98% |
| synth 80bpm 16ths ta | 100% | 100% | 96% | 99% | 94% | 97% |
| synth 80bpm 16ths a | 100% | 100% | 98% | 99% | 97% | 97% |
| synth 80bpm 16ths nolyr | 99% | 100% | 96% | 99% | 94% | 96% |
| synth 104bpm 16ths ta | 97% | 100% | 90% · 3.1% | 96% · 1.0% | 82% · 9.9% (2✗) | 92% · 3.1% |
| synth 104bpm 16ths a | 100% | 100% | 93% · 4.2% | 97% · 1.6% | 94% · 1.6% | 96% · 0.5% |
| synth 104bpm 16ths nolyr | 99% | 100% | 91% · 4.2% | 97% · 1.0% | 90% · 4.7% | 94% · 2.1% |
| synth 120bpm 16ths ta | 96% | 100% | 84% · 9.4% | 94% · 3.6% | 74% · 18.2% (2✗) | 85% · 9.4% (1✗) |
| synth 120bpm 16ths a | 99% | 100% | 94% · 2.1% | 96% · 1.0% | 89% · 6.3% | 93% · 3.6% |
| synth 120bpm 16ths nolyr | 98% | 100% | 90% · 4.7% | 95% · 2.1% | 85% · 8.3% (1✗) | 91% · 3.1% |
| synth 144bpm 8ths ta | 100% | 100% | 98% | 99% | 95% | 98% |
| synth 144bpm 8ths a | 100% | 100% | 100% | 100% | 98% | 99% |
| synth 144bpm 8ths nolyr | 100% | 100% | 98% | 99% | 97% | 98% |
| synth 144bpm 16ths ta | 92% · 2.1% | 99% · 0.0% | 74% · 18.2% (2✗) | 91% · 5.2% | 69% · 24.0% (2✗) | 81% · 14.1% (2✗) |
| synth 144bpm 16ths a | 97% · 2.1% | 98% · 1.6% | 87% · 8.3% | 92% · 4.2% | 80% · 14.6% (2✗) | 87% · 7.8% |
| synth 144bpm 16ths nolyr | 96% · 0.5% | 99% · 0.5% | 85% · 10.4% | 90% · 5.7% | 76% · 17.7% (2✗) | 85% · 8.9% (1✗) |

**Why short notes were lost** (good singer, all levels; the diagnosis replays the scorer on the exact samples it judged and names the rule that dropped each ok/miss note; counts per 1000 notes of that length):

| reason | 0.15–0.25 s before | 0.15–0.25 s after | <0.15 s before | <0.15 s after |
|---|---|---|---|---|
| tracker smear / smoother lag | 2.9 | 1.3 | 29.8 | 14.6 |
| singer not settled (glide) | 1.0 | 0.0 | 36.5 | 22.6 |
| no readings: consonant / silence | 0.3 | 0.0 | 0.5 | 0.2 |
| only transition readings in the note | 0.0 | 0.0 | 0.0 | 0.7 |
| arrival never reached | 0.0 | 0.0 | 9.9 | 0.0 |
| no readings: tracker gated (unclear) | 0.0 | 0.0 | 6.4 | 0.0 |
| **all lost** | 4.2 | 1.3 | 83.1 | 38.2 |
| notes | 3078 | 3078 | 4032 | 4032 |

**Adversarial singers** (accuracy, ✗ = fails the level; `plain` = without the end-of-run line-up, i.e. what the live view shows; `al+N` = the voice was shifted N ms):

| singer | passage | L | before | after |
|---|---|---|---|---|
| wrong notes (40 %) | debussy-yver A b1-23 | 1 | 60% ✗ (plain 60%) | 60% ✗ (plain 60%) |
| wrong notes (40 %) | debussy-yver A b1-23 | 2 | 60% ✗ (plain 60%) | 60% ✗ (plain 60%) |
| wrong notes (40 %) | debussy-yver A b1-23 | 4 | 56% ✗ (plain 56%) | 56% ✗ (plain 56%) |
| wrong notes (40 %) | debussy-dieu A b1-5 | 1 | 58% ✗ (plain 58%) | 58% ✗ (plain 58%) |
| wrong notes (40 %) | debussy-dieu A b1-5 | 2 | 58% ✗ (plain 58%) | 58% ✗ (plain 58%) |
| wrong notes (40 %) | debussy-dieu A b1-5 | 4 | 52% ✗ (plain 52%) | 52% ✗ (plain 52%) |
| wrong notes (40 %) | ravel-nicolette A b20-45 | 1 | 58% ✗ (plain 58%) | 58% ✗ (plain 58%) |
| wrong notes (40 %) | ravel-nicolette A b20-45 | 2 | 57% ✗ (plain 57%) | 58% ✗ (plain 58%) |
| wrong notes (40 %) | ravel-nicolette A b20-45 | 4 | 56% ✗ (plain 56%) | 57% ✗ (plain 57%) |
| wrong notes (40 %) | synth 104bpm 16ths ta | 1 | 60% ✗ (plain 60%) | 61% ✗ (plain 61%) |
| wrong notes (40 %) | synth 104bpm 16ths ta | 2 | 52% ✗ (plain 52%) | 58% ✗ (plain 58%) |
| wrong notes (40 %) | synth 104bpm 16ths ta | 4 | 48% ✗ (plain 48%) | 54% ✗ (plain 54%) |
| wrong notes (40 %) | synth 144bpm 8ths ta | 1 | 60% ✗ (plain 60%) | 60% ✗ (plain 60%) |
| wrong notes (40 %) | synth 144bpm 8ths ta | 2 | 59% ✗ (plain 59%) | 59% ✗ (plain 59%) |
| wrong notes (40 %) | synth 144bpm 8ths ta | 4 | 58% ✗ (plain 58%) | 59% ✗ (plain 59%) |
| wrong notes (40 %) | synth 144bpm 16ths ta | 1 | 58% ✗ (plain 58%) | 60% ✗ (plain 60%) |
| wrong notes (40 %) | synth 144bpm 16ths ta | 2 | 52% ✗ (plain 52%) | 59% ✗ (plain 59%) |
| wrong notes (40 %) | synth 144bpm 16ths ta | 4 | 43% ✗ (plain 42%) | 55% ✗ (plain 54%) |
| wrong notes (40 %) | synth 144bpm 16ths a | 1 | 59% ✗ (plain 59%) | 59% ✗ (plain 59%) |
| wrong notes (40 %) | synth 144bpm 16ths a | 2 | 59% ✗ (plain 59%) | 59% ✗ (plain 59%) |
| wrong notes (40 %) | synth 144bpm 16ths a | 4 | 51% ✗ (plain 51%) | 57% ✗ (plain 57%) |
| flat −40¢ | debussy-yver A b1-23 | 1 | 77% (plain 76%) | 77% (plain 76%) |
| flat −40¢ | debussy-yver A b1-23 | 2 | 32% ✗ (plain 32%) | 31% ✗ (plain 31%) |
| flat −40¢ | debussy-yver A b1-23 | 4 | 4% ✗ (plain 4%) | 3% ✗ (plain 3%) |
| flat −40¢ | debussy-dieu A b1-5 | 1 | 81% (plain 81%) | 80% (plain 80%) |
| flat −40¢ | debussy-dieu A b1-5 | 2 | 18% ✗ (plain 18%) | 21% ✗ (plain 21%) |
| flat −40¢ | debussy-dieu A b1-5 | 4 | 25% ✗ (plain 25%) | 30% ✗ (plain 30%) |
| flat −40¢ | ravel-nicolette A b20-45 | 1 | 77% (plain 77%) | 77% (plain 77%) |
| flat −40¢ | ravel-nicolette A b20-45 | 2 | 35% ✗ (plain 35%) | 39% ✗ (plain 39%) |
| flat −40¢ | ravel-nicolette A b20-45 | 4 | 10% ✗ (plain 10%) | 18% ✗ (plain 18%) |
| flat −40¢ | synth 104bpm 16ths ta | 1 | 78% (plain 78%) | 84% (plain 84%) |
| flat −40¢ | synth 104bpm 16ths ta | 2 | 45% ✗ (plain 45%) | 55% ✗ (plain 55%) |
| flat −40¢ | synth 104bpm 16ths ta | 4 | 19% ✗ (plain 19%) | 29% ✗ (plain 29%) |
| flat −40¢ | synth 144bpm 8ths ta | 1 | 83% (plain 83%) | 82% (plain 82%) |
| flat −40¢ | synth 144bpm 8ths ta | 2 | 50% ✗ (plain 50%) | 68% ✗ (plain 68%) |
| flat −40¢ | synth 144bpm 8ths ta | 4 | 14% ✗ (plain 14%) | 30% ✗ (plain 30%) |
| flat −40¢ | synth 144bpm 16ths ta | 1 | 75% (plain 75%) | 82% (plain 82%) |
| flat −40¢ | synth 144bpm 16ths ta | 2 | 39% ✗ (plain 39%) | 58% ✗ (plain 58%) |
| flat −40¢ | synth 144bpm 16ths ta | 4 | 19% ✗ (plain 19%) | 31% ✗ (plain 31%) |
| flat −40¢ | synth 144bpm 16ths a | 1 | 74% ✗ (plain 74%) | 77% (plain 77%) |
| flat −40¢ | synth 144bpm 16ths a | 2 | 37% ✗ (plain 37%) | 55% ✗ (plain 54%) |
| flat −40¢ | synth 144bpm 16ths a | 4 | 28% ✗ (plain 28%) | 42% ✗ (plain 42%) |
| one note behind | debussy-yver A b1-23 | 1 | 15% ✗ (plain 15%) | 15% ✗ (plain 15%) |
| one note behind | debussy-yver A b1-23 | 2 | 15% ✗ (plain 15%) | 15% ✗ (plain 15%) |
| one note behind | debussy-yver A b1-23 | 4 | 15% ✗ (plain 15%) | 15% ✗ (plain 15%) |
| one note behind | debussy-dieu A b1-5 | 1 | 17% ✗ (plain 17%) | 17% ✗ (plain 17%) |
| one note behind | debussy-dieu A b1-5 | 2 | 17% ✗ (plain 17%) | 17% ✗ (plain 17%) |
| one note behind | debussy-dieu A b1-5 | 4 | 17% ✗ (plain 17%) | 17% ✗ (plain 17%) |
| one note behind | ravel-nicolette A b20-45 | 1 | 32% ✗ (plain 32%) | 32% ✗ (plain 32%) |
| one note behind | ravel-nicolette A b20-45 | 2 | 30% ✗ (plain 30%) | 31% ✗ (plain 31%) |
| one note behind | ravel-nicolette A b20-45 | 4 | 31% ✗ (plain 31%) | 32% ✗ (plain 32%) |
| one note behind | synth 104bpm 16ths ta | 1 | 8% ✗ (plain 8%) | 8% ✗ (plain 8%) |
| one note behind | synth 104bpm 16ths ta | 2 | 83% (plain 8%, al+80) | 8% ✗ (plain 8%) |
| one note behind | synth 104bpm 16ths ta | 4 | 8% ✗ (plain 8%) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 8ths ta | 1 | 8% ✗ (plain 8%) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 8ths ta | 2 | 8% ✗ (plain 8%) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 8ths ta | 4 | 9% ✗ (plain 9%) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 16ths ta | 1 | 8% ✗ (plain 8%) | 13% ✗ (plain 13%) |
| one note behind | synth 144bpm 16ths ta | 2 | 76% ✗ (plain 8%, al+80) | 87% (plain 11%, al+80) |
| one note behind | synth 144bpm 16ths ta | 4 | 69% ✗ (plain 8%, al+80) | 81% ✗ (plain 11%, al+80) |
| one note behind | synth 144bpm 16ths a | 1 | 8% ✗ (plain 8%) | 12% ✗ (plain 12%) |
| one note behind | synth 144bpm 16ths a | 2 | 11% ✗ (plain 11%) | 11% ✗ (plain 10%) |
| one note behind | synth 144bpm 16ths a | 4 | 8% ✗ (plain 8%) | 9% ✗ (plain 9%) |

**Live display vs result, uncalibrated phone** (true delay 200 ms, estimate 130 ms; fast notes shown ok/miss while singing vs in the result after the line-up): debussy-yver A b1-23 L2: 0/0 live vs 0/0 result; debussy-yver A b1-23 L4: 0/0 live vs 0/0 result; debussy-dieu A b1-5 L2: 0/0 live vs 0/0 result; debussy-dieu A b1-5 L4: 0/0 live vs 0/0 result; ravel-nicolette A b20-45 L2: 0/0 live vs 0/0 result; ravel-nicolette A b20-45 L4: 0/0 live vs 0/0 result; synth 104bpm 16ths ta L2: 4/96 live vs 1/96 result; synth 104bpm 16ths ta L4: 15/96 live vs 2/96 result; synth 144bpm 16ths a L2: 63/96 live vs 1/96 result; synth 144bpm 16ths a L4: 65/96 live vs 6/96 result.
