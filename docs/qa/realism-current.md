# Realism: before / after the scoring fixes

Generated 2026-10-05T15:00:44.549Z by `npx vitest run --config vitest.realism.config.ts` (files `qa/realism/cmp-*.test.ts`). The same rendered takes are scored by both pipelines:

- **before** = baseline app (frozen `qa/realism/baseline/`, as in `docs/qa/realism-baseline.md`): N=2048 window, `scoreAttempt`, onset-based delay learning that re-scores the same run, pass = accuracy only, and an uncalibrated estimate of 80 ms.
- **after** = current app at `8c0d8a7` plus uncommitted changes in `rc/game/scoring.ts`, `src/game/types.ts`, `src/ui/screens/Play.tsx`, `src/ui/screens/Results.tsx`, `src/ui/styles.css`. The analysis window comes from `windowFor(part.low)` (1024 for these alto parts). Then `scoreAttempt` → `scoreAligned`, two-run delay learning and the Android estimate of 130 ms. Play.tsx/session policy detected from the source: LATE_FAIL_MS=250; GUIDE_LEARN_MAX_ABOVE=150; timing gate: measured; liftSubharmonics: true; scoreAligned everyNote: true; session stores raw samples.
- **after (80 ms estimate)** = the current app with the old 80 ms estimate (an iPhone-like device). It separates the estimate change from the rest.

Run cells: `grade accuracy%` (✗ = run failed), `al±N` = the voice was shifted N ms for intonation, `→N ms` = the stored delay changed to N, `TF` = failed by the timing gate (median entry in ms), `[…]` = timing/wrong-note tips. Sequences are 3 consecutive runs (new performance each run) on a phone whose stored delay carries over.

## Key numbers

- **Good singer L1, calibrated:** before 100% in tune / 100% acc (S×6), after 100% / 100% (S×6).
- **Good singer L1, true 200 ms, uncalibrated** (in tune/acc over 6 sections): before run 1: 95%/99% S×6 (6/6 pass); run 2: 95%/99% S×6 (6/6 pass); run 3: 94%/99% S×6 (6/6 pass). After run 1: 99%/99% S×5 B×1 (5/6 pass); run 2: 100%/100% S×6 (6/6 pass); run 3: 99%/99% S×5 B×1 (5/6 pass). After with 80 ms estimate: run 1: 99%/99% S×5 B×1 (5/6 pass); run 2: 100%/100% S×6 (6/6 pass); run 3: 99%/99% S×5 B×1 (5/6 pass).
- **Good singer L1, true 280 ms, uncalibrated** (in tune/acc over 6 sections): before run 1: 99%/99% S×6 (6/6 pass); run 2: 100%/100% S×6 (6/6 pass); run 3: 100%/100% S×6 (6/6 pass). After run 1: 99%/99% S×5 B×1 (5/6 pass); run 2: 100%/100% S×5 B×1 (5/6 pass); run 3: 100%/100% S×6 (6/6 pass). After with 80 ms estimate: run 1: 99%/99% S×5 B×1 (5/6 pass); run 2: 100%/100% S×5 B×1 (5/6 pass); run 3: 100%/100% S×6 (6/6 pass).
- **Good singer L4, calibrated:** before 97% in tune / 98% acc (S×6), after 100% / 99% (S×6).
- **Good singer L4, true 200 ms, uncalibrated** (in tune/acc over 6 sections): before run 1: 79%/88% S×3 A×1 B×1 C×1 (4/6 pass); run 2: 78%/89% S×3 A×1 B×1 C×1 (4/6 pass); run 3: 78%/87% S×3 A×2 C×1 (5/6 pass). After run 1: 99%/99% S×6 (6/6 pass); run 2: 100%/99% S×6 (6/6 pass); run 3: 100%/99% S×6 (6/6 pass). After with 80 ms estimate: run 1: 99%/99% S×6 (6/6 pass); run 2: 100%/99% S×6 (6/6 pass); run 3: 100%/99% S×6 (6/6 pass).
- **Good singer L4, true 280 ms, uncalibrated** (in tune/acc over 6 sections): before run 1: 89%/90% S×5 D×1 (5/6 pass); run 2: 98%/98% S×6 (6/6 pass); run 3: 98%/97% S×5 A×1 (6/6 pass). After run 1: 100%/99% S×6 (6/6 pass); run 2: 99%/98% S×6 (6/6 pass); run 3: 99%/98% S×5 A×1 (6/6 pass). After with 80 ms estimate: run 1: 100%/99% S×6 (6/6 pass); run 2: 99%/98% S×6 (6/6 pass); run 3: 99%/98% S×5 A×1 (6/6 pass).
- **C/A/A check, Debussy bars 1–5 at L2, 3 runs × 4 seeds (letters per run):** true 200 ms: before C/B/B, C/B/C, C/C/C, C/C/C; after S/S/S, S/S/S, S/S/S, S/S/S. true 215 ms: before C/C/C, C/C/S, C/C/C, C/C/S; after S/S/S, S/S/S, S/S/S, S/S/S. true 230 ms: before C/C/C, S/S/S, S/S/S, S/S/S; after S/S/S, S/S/S, S/S/S, S/S/S. true 280 ms: before S/S/S, D/S/S, S/S/S, S/S/S; after S/S/S, S/S/S, S/S/S, S/S/S.
- **Tracker (good singer):** steady median 3.1 → 4.0¢, near-transition p90 20.0 → 17.4¢, displayed overshoot 19 → 28¢ (voice 28¢), invented 0% → 0%.
- **Tracker with speaker bleed −13 dB (L1):** octave/subharmonic readings 27% → 0%, >50¢ off 28% → 1%, scored 77% → 98% accuracy.
- **Speaker bleed, good singer, calibrated (accuracy, mean of 2 sections, before → after):** -18 dB: L1 91% → 100%, L4 82% → 97%; -13 dB: L1 77% → 98%, L4 62% → 88%; -8 dB: L1 42% → 88%, L4 26% → 70%.
- **Live cents bubble after a note change (good singer, L1):** readout toward the previous note beyond tolerance in 100% → 73% of changes (calibrated), 100% → 100% at true 280 ms uncalibrated (run 1); beyond the new note 4% → 15%; out of tolerance until 137 → 151 ms.
- **Real-recording path** (16-bit WAV + current-app sidecar → `scoreRecordingApp`): accuracy 99% direct vs 99% via the file (shift 70 / 70 ms).
- **Sanity guard (current app):** all must-fail runs fail.
- **Fast notes (< 0.15 s), good singer, measured delay — share scored ok/miss, before (`54ea7b9`) → after:** L1 0.0% → 0.0%, L2 7.2% → 3.4%, L4 11.7% → 6.8%. See section 7.

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
11. **Fast notes (section 7).** A good singer lost 7 % (L2) and 12 % (L4) of notes shorter than 0.15 s, as `miss` — never `ok`, because the median rule for short notes is all-or-nothing. On a 0.1 s note only one or two readings fell in the judged body (40 % grace + 20 % tail), often mid-glide or already cut by the next syllable's consonant, and the tracker's median-of-3 flattened one- and two-frame plateaus and turning points. Changes: (a) very short notes are also judged on the median of all their readings inside the written note (transitions toward the neighbours excused, same caps as the arrival rule; readings > 6 semitones from the note and both neighbours, e.g. McLeod's ×⅕ subharmonic, dropped unless they are the majority), but only with ≥ 2 readings including an uninterrupted voiced run that stands for ≥ 30 % of the note and reaches past its first 35 %, credited in proportion up to 40 % — one reading, attack-only readings or scattered frames (consonants, guide bleed) are not enough; (b) the in-tune-moment rescue needs the note's median within min(50¢, 1.6 × tolerance), and also accepts the voice swinging evenly around the note (two consecutive readings on either side, each within 2× tolerance, neither more than 1.5× as far as the other); (c) the smoother is a one-frame look-ahead that only removes spikes, and each smoothed reading now carries its own frame's time, Hz, clarity and level. Now 3.5 % (L2) and 6.8 % (L4) are lost, mostly at 120–144 bpm 16ths where the voice never settles and the tracker reads it 20–50¢ off; 8 per 1000 fast notes have too few readings to be judged on their own. Wrong notes, −40¢ (L2+) and one note behind fail everywhere; the −40¢ singer's accuracy on fast runs rose by up to 16 points over `54ea7b9` (≤ 66 %, pass needs 80 %), mostly from the swing rule at L2, where −40¢ is only 5¢ outside the tolerance. The calibrated line-up (align.ts) still corrects by up to 80 ms, but first finds where the voice really lines up (±250 ms): about a note late (> 85 % of a typical note and > 100 ms) or early (> ½ note, 50–80 ms; the glide into each note makes one note ahead look only ~⅔ of a note early) means singing the neighbouring notes, and nothing is shifted; in fast passages (typical note < 0.16 s), lined up a little beyond 80 ms, it shifts 80 ms; wrong notes line up nowhere and are not shifted. Before, the ±80 ms moved a voice a note behind or ahead onto the right notes on 16ths (144 bpm L2 one behind: 82 %, a pass) and on 8ths at 144–176 bpm (one ahead up to 0.98); now all fail. Limits: on 16ths at ≥ 160 bpm a note (≤ 94 ms) is within a plausible delay error, so one note behind still lines up (as in the deployed version); a slow-gliding voice 70 ms late on 16ths at 176 bpm, L1 looks like 0.9 of a note behind and is not shifted. Uncalibrated, the search may still reach 450 ms total, so a voice one 16th behind can be lined up; a phone's real delay (Bluetooth 150–300 ms) can't be told from that without the delay check. Live display with a measured delay agrees with the result (5.2 % vs 5.2 %).

12. **Level 1 on “doo”, every note right (section 8).** On “doo” (a 20–45 ms “d” before every note, vowel “u”) every good voice passed every level-1 run in the six sections, calibrated and uncalibrated (goodChoir 30/30 + 30/30 per delay here; 60/60 + 60/60 with 10 seeds in a longer run; operatic, control, ringing and slow-transition voices 18/18 each), with no note below *good*, so the exemption never had to act. The pieces' fast bars and synthetic 16ths at 104/144 bpm on “doo” also all passed. The same voices on the lyrics lose 1–2 runs in 18–30 under the new rule: long notes graded *miss* with a median of 1–28¢, i.e. readings flipping an octave within the note on some vowels, and a few whole notes read an octave up. That is the tracker, not the singer, and one more reason level 1 is sung on “doo”. Singers with a wrong note always fail on “doo”: a single note a semitone off fails 12/12 (the 75% rule passed all 12), 40 % wrong notes and one note behind fail everywhere. A single note 70¢ flat fails 11/12; the one pass is a very short note (judged leniently, median under 1.5 × tolerance) that is forgiven. The −40¢ singer is inside ±50¢ by design. A note tied over the end of a section is now judged on the part before the end (`ScoringContext.end`); before, it always read as missed, and 14 of 254 sections in the library end on such a note.

13. **Wide vibrato at level 1 (section 9).** The vibrato window now follows the tempo (0.18 s of real time; before it was 0.18 score s, about 1.4 cycles of a 5.5 Hz vibrato at 70% tempo). With pitch-level readings on every library section (254), a centred vibrato of ±60/±70/±80¢ passes level 1 in every section before and after, also at 4.5 and 6.5 Hz and from the note start; the change shows at wider vibratos (±110¢: 208 → 220 sections, ±150¢: 145 → 180). Through rendered audio and the whole pipeline (on “doo”, calibrated): ±60¢ 249 → 247, ±70¢ 248 → 250, ±80¢ 251 → 250 of 254, i.e. unchanged within noise; the few failures are not vibrato: the same tenor/bass sections fail at every width, from the tracker reading low notes (E3) an octave up with this singer model's “u” formants (and one partly-judged note). Wrong singers are unchanged at every level (the window only differs at level 1), and at level 1 every section with a wrong note fails, except one 32nd note in Nicolette's bass too short to judge (forgiven like any very short note).

14. **Tracker misreadings let off at level 1.** Through rendered audio (every library section, on “doo”, calibrated), the honest wide-vibrato singer failed a few sections at every width, all from the tracker: low notes (E3, 165 Hz) read partly or wholly an octave up on “oo”, and high soprano notes (B4, A5) with subharmonic readings (−19 to −45 semitones). A low note (< 200 Hz) that is right once octave-up readings are folded down (`unsure: 'octave'`, never folded downward), and a note right once a minority of subharmonic readings (18–46 semitones under it, far from its neighbours) are replaced by the reading before (`unsure: 'tracker'`), are now let off at level 1. (A first version took any reading more than 6 semitones off: with pitch-level readings, the longest note of each of the 254 sections sung a fifth up, a fifth down or a sixth up for its last 40 % then passed level 1 in 146, 145 and 217 sections; with the band 11, 11 and 11, as before the let-off. Bursts at −19 semitones on a third of the note: 4 → 249 → 249. Pinned by a unit test.) Sections passing level 1 of 254, before (`cdc3a69`) → after: ±60¢ 249 → 254, ±70¢ 248 → 254, ±80¢ 251 → 253. The one left is Nicolette's bass bar 3 at ±80¢: a 0.48 s note whose 2½ vibrato cycles leave the median 50¢ sharp; no detector error. Wrong singers (audio, every other section): an octave down 0/127 → 0/127, one note a semitone flat 0 → 0, one note an octave down 17 → 0. Those 17 were all very short notes (0.09–0.27 s) sung an octave low: the clear-miss test stopped at 6 semitones, so an octave low counted as a possible tracker error; an octave off is now a clear miss (an octave up on a note under 200 Hz excepted). On the lyrics (level 1 is sung on “doo”), the narrower band costs a few runs: 3 of 48 good-singer runs of the latency grid have a note with octave-up readings that the first version let off (section 8: 28/30 instead of 30/30, calibrated). The range check shows no such artefact on held low notes (0–2 % octave-up readings, E2–D4, on lyrics and “doo”); a test pins that bursts of octave-up readings on a bass's low notes are credited.

15. **An octave low at level 1, and the phone speaker.** After the run, `liftSubharmonics` moves readings an octave under a note onto it when at least 30 % of the note reads at the right octave (the tracker flickering). A note sung an octave low gets few right-octave readings (the tracker reading a low “oo” an octave up): one random note sung an octave low on “doo”, 6 sections × 10 seeds, had more than 10 % right-octave readings in 2 of 60 takes on headphones (25 %, 35 %) and 1 of 60 on the phone speaker; honest notes with octave-low readings on the speaker read mostly at the right octave (70 % of them at more than half). At level 1 the lift now needs more than half (levels 2–5 unchanged). Runs passing level 1 (lift at 30 % → more than half → no octave lift at level 1): one note an octave low on headphones 1/60 → 0/60 → 0/60, on the phone speaker (−13 dB) 8/60 → 6/60 → 2/60; honest voices on “doo” on the phone speaker (5 voices, 204 runs) 81 → 69 → 23; honest wide vibrato through rendered audio (headphones) ±60/±70/±80¢ 254/254/253 → 254/254/253 → 253/252/–, the failures being honest notes with 8–19 % octave-low readings. So dropping the octave lift at level 1 fails honest singers; the majority rule is kept. Honest voices on headphones still pass every level-1 run on “doo” (section 8). Still open: (a) on the phone speaker the tracker often reads a note sung an octave low two octaves under the written note (its ×½ of the low voice; 21 of 60 such notes), and the ×¼ correction moves it back onto the note, which is why “one note an octave low, phone speaker” still passes now and then; honest notes are read mostly two octaves low there too (19 of 351 honest notes with low readings), so the readings alone can't tell them apart. (b) Honest voices on the phone speaker pass level 1 on “doo” in only about a third of runs (section 8: 11/30, 8/30, 7/18, 7/18; 26–27/30 under the old 75 % rule): whole notes read an octave low with no right-octave readings, which no correction can tell from a note sung an octave low. Level 1 with every note right needs headphones, or a stronger tracker against the guide's bleed. Decided: level 1 now counts only with headphones on (the pre-run card asks; without them a run is practice, docs/LEVELS.md), so (a) and (b) only affect practice runs.

## 1. Tracker fidelity (smoothed output vs ground-truth f0, cents), before → after

Takes: dieu-1-5 and warmup-7-12 (Alto), L4 tempo, calibrated, headphones unless noted. "after" = current window and the subharmonic correction the scorer applies.

| singer | steady med | steady p90 | near p90 | near p99 | >50¢ near | octave | missed voiced | false voiced | overshoot voice / tracker | invented | scored in tune / acc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| good choir singer | 3.1 → 4.0 | 8.4 → 11.4 | 20.0 → 17.4 | 74 → 44 | 3% → 1% | 0% → 0% | 3% → 1% | 14% → 4% | 28 / 19 → 28 | 0% → 0% | 98%/99% → 100%/99% |
| operatic vibrato | 7.5 → 6.9 | 18.8 → 17.8 | 29.1 → 24.2 | 106 → 93 | 4% → 2% | 0% → 0% | 2% → 1% | 14% → 6% | 41 / 34 → 48 | 0% → 0% | 96%/97% → 100%/99% |
| control (no vibrato, no overshoot) | 1.9 → 3.1 | 5.1 → 8.2 | 15.9 → 15.4 | 50 → 48 | 1% → 1% | 0% → 0% | 2% → 1% | 13% → 6% | 2 / 3 → 7 | 0% → 0% | 98%/99% → 100%/100% |
| ringing transitions (zeta 0.35) | 3.3 → 3.9 | 8.2 → 9.5 | 32.4 → 26.4 | 97 → 70 | 5% → 3% | 0% → 0% | 3% → 1% | 15% → 6% | 68 / 47 → 62 | 0% → 3% | 91%/95% → 98%/97% |
| good choir singer + speaker bleed −13 dB (L1) | 6.5 → 5.1 | 1904.7 → 13.3 | 1896.7 → 21.8 | 1945 → 99 | 17% → 2% | 27% → 0% | 3% → 3% | 10% → 4% | 29 / 480 → 31 | 24% → 3% | 73%/77% → 98%/98% |

## 2. Good singers: latency × section × level, before → after

### good choir singer

Calibrated = true and measured delay 150 ms. Oracle = true f0 with the true latency (no tracker), plain scorer.

| section | L | before in tune / acc | before | after in tune / acc | after | oracle acc before / after | bubble lag before / after |
|---|---|---|---|---|---|---|---|
| warmup-upbeat-6 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 71% |
| warmup-7-12 | 1 | 99% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 79% |
| dieu-1-5 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 85% |
| dieu-6-13 | 1 | 99% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 68% |
| tabourin-solo-1-8 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 75% |
| tabourin-solo-9-16 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 59% |
| warmup-upbeat-6 | 4 | 100% / 99% | S pass | 100% / 99% | S 99 | 99% / 100% | 100% / 71% |
| warmup-7-12 | 4 | 99% / 100% | S pass | 100% / 99% | S 99 | 100% / 100% | 100% / 79% |
| dieu-1-5 | 4 | 96% / 99% | S pass | 100% / 99% | S 99 | 99% / 100% | 100% / 90% |
| dieu-6-13 | 4 | 94% / 99% | S pass | 100% / 99% | S 99 | 99% / 99% | 100% / 65% |
| tabourin-solo-1-8 | 4 | 93% / 95% | S pass | 100% / 98% | S 98 | 98% / 99% | 100% / 75% |
| tabourin-solo-9-16 | 4 | 98% / 99% | S pass | 99% / 100% | S 100 | 100% / 100% | 100% / 65% |

Uncalibrated phone (fresh profile, then runs 2–3 with whatever the app stored):

| section | L | true | before | after | after (80 ms estimate) |
|---|---|---|---|---|---|
| warmup-upbeat-6 | 1 | 200 ms | S 100 · S 100 · S 100 | S 100 · S 100 al+60 →160ms · S 100 | S 100 al+100 · S 100 al+110 →185ms · S 100 |
| warmup-upbeat-6 | 1 | 280 ms | S 95 →266ms · S 100 · S 100 | B 95 ✗ al+130 · S 100 al+140 →265ms · S 100 | B 95 ✗ al+140 · S 100 al+140 →220ms · S 100 |
| warmup-7-12 | 1 | 200 ms | S 100 · S 100 · S 100 | S 100 · S 100 →130ms · S 100 | S 100 al+100 · S 100 al+110 →185ms · S 100 |
| warmup-7-12 | 1 | 280 ms | S 100 →250ms · S 100 · S 100 | S 100 al+120 · S 100 al+120 →250ms · S 100 | S 100 al+140 · S 100 al+140 →220ms · S 100 |
| dieu-1-5 | 1 | 200 ms | S 96 · S 97 · S 97 | S 100 al+60 · S 100 al+70 →195ms · S 100 | S 100 al+110 · S 100 al+120 →195ms · S 100 |
| dieu-1-5 | 1 | 280 ms | S 100 →256ms · S 100 · S 100 | S 100 al+150 · S 100 al+140 →275ms · S 100 | S 100 al+150 · S 100 al+150 →230ms · S 100 al+50 |
| dieu-6-13 | 1 | 200 ms | S 99 · S 99 · S 99 | S 100 al+70 · S 100 al+60 →195ms · S 100 | S 100 al+120 · S 100 al+110 →195ms · S 100 |
| dieu-6-13 | 1 | 280 ms | S 100 →247ms · S 98 · S 100 | S 100 al+140 · B 98 ✗ al+140 →270ms · S 100 | S 100 al+150 · B 98 ✗ al+150 →230ms · S 100 al+40 |
| tabourin-solo-1-8 | 1 | 200 ms | S 99 · S 100 · S 98 | B 97 ✗ al+80 · S 100 al+80 →210ms · B 93 ✗ | B 97 ✗ al+130 · S 100 al+130 →210ms · B 93 ✗ |
| tabourin-solo-1-8 | 1 | 280 ms | S 100 →253ms · S 100 · S 100 | S 100 al+140 · S 100 al+150 →275ms · S 100 | S 100 al+150 · S 100 al+150 →230ms · S 100 al+40 |
| tabourin-solo-9-16 | 1 | 200 ms | S 100 · S 100 · S 100 | S 99 al+60 · S 100 al+60 →190ms · S 100 | S 99 al+110 · S 100 al+100 →185ms · S 100 |
| tabourin-solo-9-16 | 1 | 280 ms | S 100 →208ms · S 100 · S 100 | S 100 al+140 · S 100 al+130 →265ms · S 100 | S 100 al+150 · S 100 al+150 →230ms · S 100 |
| warmup-upbeat-6 | 4 | 200 ms | S 99 · S 98 · S 98 | S 100 al+50 · S 99 al+50 →180ms · S 99 | S 100 al+100 · S 99 al+100 →180ms · S 99 |
| warmup-upbeat-6 | 4 | 280 ms | S 99 →242ms · S 99 · S 98 | S 99 al+130 · S 99 al+130 →260ms · S 99 | S 99 al+180 · S 99 al+180 →260ms · S 99 |
| warmup-7-12 | 4 | 200 ms | S 99 · S 99 · S 99 | S 99 al+60 · S 99 al+50 →185ms · S 100 | S 99 al+110 · S 99 al+100 →185ms · S 100 |
| warmup-7-12 | 4 | 280 ms | S 99 →255ms · S 98 · S 99 | S 99 al+130 · S 97 al+130 →260ms · S 99 | S 99 al+180 · S 97 al+180 →260ms · S 99 |
| dieu-1-5 | 4 | 200 ms | C 63 ✗ · C 65 ✗ · C 55 ✗ | S 100 al+70 · S 98 al+70 →200ms · S 98 | S 100 al+120 · S 98 al+120 →200ms · S 98 |
| dieu-1-5 | 4 | 280 ms | D 45 ✗ · S 99 →247ms · S 99 | S 99 al+150 · S 98 al+150 →280ms · S 100 | S 99 al+200 · S 98 al+200 →280ms · S 100 |
| dieu-6-13 | 4 | 200 ms | B 82 ✗ · B 82 ✗ · A 86 | S 99 al+80 · S 98 al+80 →210ms · S 99 | S 99 al+130 · S 98 al+130 →210ms · S 99 |
| dieu-6-13 | 4 | 280 ms | S 98 →263ms · S 95 · A 92 | S 99 al+140 · S 98 al+150 →275ms · A 92 | S 99 al+190 · S 98 al+200 →275ms · A 92 |
| tabourin-solo-1-8 | 4 | 200 ms | S 98 · A 92 · S 96 | S 100 al+80 · S 100 al+70 →205ms · S 99 | S 100 al+120 · S 100 al+120 →200ms · S 99 |
| tabourin-solo-1-8 | 4 | 280 ms | S 100 →248ms · S 100 · S 99 | S 100 al+160 · S 100 al+170 →295ms · S 99 | S 100 al+210 · S 100 al+220 →295ms · S 99 |
| tabourin-solo-9-16 | 4 | 200 ms | A 87 · S 97 · A 89 | S 95 al+70 · S 99 al+70 →200ms · S 98 | S 95 al+120 · S 99 al+110 →195ms · S 98 |
| tabourin-solo-9-16 | 4 | 280 ms | S 99 →219ms · S 99 · S 98 | S 99 al+150 · S 97 al+150 →280ms · S 99 | S 99 al+200 · S 97 al+200 →280ms · S 99 |

### operatic vibrato

Calibrated = true and measured delay 150 ms. Oracle = true f0 with the true latency (no tracker), plain scorer.

| section | L | before in tune / acc | before | after in tune / acc | after | oracle acc before / after | bubble lag before / after |
|---|---|---|---|---|---|---|---|
| dieu-1-5 | 1 | 99% / 100% | S pass | 100% / 99% | S 99 | 100% / 100% | 100% / 80% |
| dieu-6-13 | 1 | 99% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 79% |
| warmup-7-12 | 1 | 100% / 100% | S pass | 100% / 100% | S 100 | 100% / 100% | 100% / 86% |
| dieu-1-5 | 4 | 95% / 98% | S pass | 100% / 98% | S 98 | 97% / 99% | 100% / 90% |
| dieu-6-13 | 4 | 90% / 93% | A pass | 97% / 97% | S 97 | 97% / 98% | 100% / 71% |
| warmup-7-12 | 4 | 98% / 97% | S pass | 100% / 99% | S 99 | 99% / 99% | 100% / 79% |

Uncalibrated phone (fresh profile, then runs 2–3 with whatever the app stored):

| section | L | true | before | after | after (80 ms estimate) |
|---|---|---|---|---|---|
| dieu-1-5 | 1 | 200 ms | S 96 | S 100 al+60 | S 100 al+110 |
| dieu-1-5 | 1 | 280 ms | S 100 →256ms | S 100 al+150 | S 100 al+140 |
| dieu-6-13 | 1 | 200 ms | S 97 | S 100 al+60 | S 100 al+110 |
| dieu-6-13 | 1 | 280 ms | S 97 →247ms | B 98 ✗ al+140 | B 97 ✗ al+140 |
| warmup-7-12 | 1 | 200 ms | S 99 | S 100 | S 100 |
| warmup-7-12 | 1 | 280 ms | S 100 →254ms | S 100 al+120 | S 100 al+130 |
| dieu-1-5 | 4 | 200 ms | C 64 ✗ | S 98 al+60 | S 98 al+110 |
| dieu-1-5 | 4 | 280 ms | S 98 →249ms | S 98 al+150 | S 98 al+200 |
| dieu-6-13 | 4 | 200 ms | B 79 ✗ | S 95 al+70 | S 95 al+120 |
| dieu-6-13 | 4 | 280 ms | S 95 →247ms | S 97 al+150 | S 97 al+200 |
| warmup-7-12 | 4 | 200 ms | S 96 | S 97 | S 99 al+100 |
| warmup-7-12 | 4 | 280 ms | S 97 →253ms | S 96 al+130 | S 96 al+180 |

### Three runs in a row at L2 near the old learning threshold (Debussy bars 1–5)

| true | seed | before | after | after (80 ms estimate) |
|---|---|---|---|---|
| 200 ms | 1 | C 62 ✗ · B 73 ✗ · B 73 ✗ | S 100 al+60 · S 99 al+60 →190ms · S 99 | S 100 al+110 · S 99 al+110 →190ms · S 99 |
| 200 ms | 2 | C 66 ✗ · B 74 ✗ · C 66 ✗ | S 99 al+80 · S 99 al+70 →205ms · S 99 | S 99 al+130 · S 99 al+120 →205ms · S 99 |
| 200 ms | 3 | C 69 ✗ · C 63 ✗ · C 66 ✗ | S 99 al+80 · S 100 al+70 →205ms · S 100 | S 99 al+130 · S 100 al+120 →205ms · S 100 |
| 200 ms | 4 | C 65 ✗ · C 66 ✗ · C 69 ✗ | S 100 al+70 · S 100 al+90 →210ms · S 98 | S 100 al+120 · S 100 al+140 →210ms · S 98 |
| 215 ms | 1 | C 57 ✗ · C 61 ✗ · C 60 ✗ | S 98 al+80 · S 99 al+80 →210ms · S 99 | S 98 al+130 · S 99 al+120 →205ms · S 99 |
| 215 ms | 2 | C 65 ✗ · C 62 ✗ · S 98 →205ms | S 100 al+80 · S 99 al+80 →210ms · S 100 | S 100 al+130 · S 99 al+130 →210ms · S 100 |
| 215 ms | 3 | C 55 ✗ · C 58 ✗ · C 58 ✗ | S 99 al+80 · S 100 al+90 →215ms · S 100 | S 99 al+130 · S 100 al+140 →215ms · S 100 |
| 215 ms | 4 | C 60 ✗ · C 60 ✗ · S 99 →205ms | S 100 al+90 · S 100 al+90 →220ms · S 98 | S 100 al+140 · S 100 al+140 →220ms · S 98 |
| 230 ms | 1 | C 53 ✗ · C 56 ✗ · C 56 ✗ | S 96 al+90 · S 100 al+100 →225ms · S 99 | S 96 al+140 · S 100 al+140 →220ms · S 99 |
| 230 ms | 2 | S 100 →210ms · S 99 · S 98 | S 100 al+110 · S 99 al+100 →235ms · S 100 | S 100 al+150 · S 99 al+150 →230ms · S 100 |
| 230 ms | 3 | S 100 →207ms · S 100 · S 100 | S 100 al+100 · S 100 al+100 →230ms · S 100 | S 100 al+150 · S 100 al+150 →230ms · S 100 |
| 230 ms | 4 | S 99 →207ms · S 100 · S 99 | S 100 al+100 · S 100 al+110 →235ms · S 99 | S 100 al+140 · S 100 al+140 →220ms · S 99 |
| 280 ms | 1 | S 98 →247ms · S 100 · S 99 | S 100 al+140 · S 99 al+150 →275ms · S 99 | S 99 al+150 · S 99 al+150 →230ms · S 99 al+50 |
| 280 ms | 2 | D 47 ✗ · S 98 →247ms · S 100 | S 100 al+150 · S 99 al+150 →280ms · S 100 | S 100 al+150 · S 98 al+150 →230ms · S 100 al+50 |
| 280 ms | 3 | S 98 →247ms · S 100 · S 99 | S 99 al+140 · S 100 al+140 →270ms · S 99 | S 99 al+150 · S 100 al+150 →230ms · S 99 al+50 |
| 280 ms | 4 | S 100 →247ms · S 99 · S 98 | S 100 al+140 · S 100 al+140 →270ms · S 99 | S 99 al+150 · S 99 al+150 →230ms · S 99 al+50 |

### Phone speaker, no headphones (bleed sweep), before → after

| singer | bleed | section | L | latency | before in tune / acc | before | after in tune / acc | after | octave/subharm. readings |
|---|---|---|---|---|---|---|---|---|---|
| good choir singer | -18 dB | dieu-1-5 | 1 | cal | 89% / 93% | A pass | 100% / 100% | S 100 | 3% → 0% |
| good choir singer | -18 dB | dieu-1-5 | 4 | cal | 80% / 84% | B FAIL | 100% / 99% | S 99 | 18% → 0% |
| good choir singer | -18 dB | warmup-7-12 | 1 | cal | 92% / 90% | A pass | 100% / 100% | S 100 | 2% → 0% |
| good choir singer | -18 dB | warmup-7-12 | 4 | cal | 80% / 80% | B FAIL | 95% / 95% | A 95 | 14% → 2% |
| good choir singer | -13 dB | dieu-1-5 | 1 | cal | 61% / 69% | C FAIL | 98% / 99% | S 99 | 56% → 1% |
| good choir singer | -13 dB | dieu-1-5 | 4 | cal | 56% / 57% | C FAIL | 96% / 95% | S 95 | 61% → 2% |
| good choir singer | -13 dB | warmup-7-12 | 1 | cal | 86% / 86% | A pass | 97% / 98% | B 98 ✗ | 9% → 0% |
| good choir singer | -13 dB | warmup-7-12 | 4 | cal | 65% / 66% | C FAIL | 81% / 80% | B 80 ✗ | 25% → 11% |
| good choir singer | -8 dB | dieu-1-5 | 1 | cal | 39% / 47% | D FAIL | 97% / 98% | B 98 ✗ | 70% → 0% |
| good choir singer | -8 dB | dieu-1-5 | 4 | cal | 29% / 33% | D FAIL | 83% / 82% | B 82 ✗ | 77% → 5% |
| good choir singer | -8 dB | warmup-7-12 | 1 | cal | 42% / 38% | D FAIL | 78% / 78% | B 78 ✗ | 31% → 9% |
| good choir singer | -8 dB | warmup-7-12 | 4 | cal | 20% / 19% | D FAIL | 59% / 57% | C 57 ✗ | 77% → 29% |
| good choir singer | -13 dB | dieu-1-5 | 1 | uncal200 | 49% / 66% | C FAIL | 98% / 98% | B 98 ✗ | 56% → 1% |
| good choir singer | -13 dB | dieu-1-5 | 4 | uncal200 | 19% / 38% | D FAIL | 90% / 91% | A 91 | 61% → 3% |
| good choir singer | -13 dB | warmup-7-12 | 1 | uncal200 | 84% / 86% | A pass | 100% / 100% | S 100 | 8% → 0% |
| good choir singer | -13 dB | warmup-7-12 | 4 | uncal200 | 35% / 37% | D FAIL | 71% / 71% | B 71 ✗ | 47% → 24% |
| operatic vibrato | -13 dB | dieu-1-5 | 1 | cal | 77% / 80% | B pass | 100% / 99% | S 99 | 8% → 1% |
| operatic vibrato | -13 dB | dieu-1-5 | 4 | cal | 39% / 57% | C FAIL | 89% / 87% | A 87 | 61% → 3% |
| operatic vibrato | -13 dB | warmup-7-12 | 1 | cal | 71% / 72% | B FAIL | 94% / 95% | B 95 ✗ | 15% → 4% |
| operatic vibrato | -13 dB | warmup-7-12 | 4 | cal | 34% / 30% | D FAIL | 78% / 75% | B 75 ✗ | 40% → 13% |

## 3. Repeatability (good singer, Debussy bars 1–5, fresh profile each run)

| L | latency | mode | pipeline | accuracy min–max (sd) | in tune min–max | letters | passes |
|---|---|---|---|---|---|---|---|
| 1 | cal | micro | before | 100%–100% (0.0) | 100%–100% | S×10 | 10/10 |
| 1 | cal | micro | after | 100%–100% (0.0) | 100%–100% | S×10 | 10/10 |
| 1 | cal | performance | before | 99%–100% (0.3) | 95%–100% | S×10 | 10/10 |
| 1 | cal | performance | after | 99%–100% (0.2) | 100%–100% | S×10 | 10/10 |
| 1 | uncal200 | micro | before | 96%–98% (0.7) | 85%–94% | S×10 | 10/10 |
| 1 | uncal200 | micro | after | 100%–100% (0.0) | 100%–100% | S×10 | 10/10 |
| 1 | uncal200 | performance | before | 94%–97% (0.7) | 76%–94% | S×9 A×1 | 10/10 |
| 1 | uncal200 | performance | after | 100%–100% (0.0) | 100%–100% | S×10 | 10/10 |
| 4 | cal | micro | before | 98%–99% (0.5) | 94%–98% | S×10 | 10/10 |
| 4 | cal | micro | after | 99%–100% (0.3) | 100%–100% | S×10 | 10/10 |
| 4 | cal | performance | before | 97%–100% (0.9) | 94%–99% | S×10 | 10/10 |
| 4 | cal | performance | after | 98%–100% (0.8) | 100%–100% | S×10 | 10/10 |
| 4 | uncal200 | micro | before | 55%–67% (3.5) | 46%–48% | C×10 | 0/10 |
| 4 | uncal200 | micro | after | 98%–100% (0.6) | 100%–100% | S×10 | 10/10 |
| 4 | uncal200 | performance | before | 56%–75% (5.0) | 46%–55% | B×1 C×9 | 0/10 |
| 4 | uncal200 | performance | after | 95%–100% (1.4) | 96%–100% | S×10 | 10/10 |

## 4. Sanity and adversarial singers (device round trip 130 ms)

"measured 130" = the delay check was done; "uncalibrated" = 3 runs in a row with the app's learning. Echo = right notes, 300 ms behind what the singer hears; one note behind = each pitch one note late; late pitch arrival = consonant on time, pitch moves 200 ms after the beat.

| singer | section | L | delay | before | after |
|---|---|---|---|---|---|
| wrong notes (40 %) | dieu-1-5 | 1 | measured 130 | C 58 ✗ [wrong-notes] | C 58 ✗ [wrong-notes] |
| wrong notes (40 %) | dieu-1-5 | 2 | measured 130 | C 58 ✗ [wrong-notes] | C 58 ✗ [wrong-notes] |
| wrong notes (40 %) | dieu-1-5 | 4 | measured 130 | C 53 ✗ [wrong-notes] | C 56 ✗ [wrong-notes] |
| wrong notes (40 %) | dieu-1-5 | 1 | uncalibrated (true 130) | C 58 ✗ [wrong-notes] · C 57 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] | C 58 ✗ [wrong-notes] · C 57 ✗ [wrong-notes] · C 58 ✗ [wrong-notes] |
| wrong notes (40 %) | dieu-1-5 | 2 | uncalibrated (true 130) | C 56 ✗ [wrong-notes] · C 64 ✗ [wrong-notes] · C 64 ✗ [wrong-notes] | C 58 ✗ [wrong-notes] · C 56 ✗ [wrong-notes] · C 57 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 1 | measured 130 | C 62 ✗ [wrong-notes] | C 62 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 2 | measured 130 | C 62 ✗ [wrong-notes] | C 62 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 4 | measured 130 | C 62 ✗ [wrong-notes] | C 62 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 1 | uncalibrated (true 130) | C 62 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] | C 62 ✗ [wrong-notes] · C 61 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] |
| wrong notes (40 %) | warmup-7-12 | 2 | uncalibrated (true 130) | C 62 ✗ [wrong-notes] · C 61 ✗ [wrong-notes] · C 60 ✗ [wrong-notes] | C 61 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] · C 62 ✗ [wrong-notes] |
| flat −40¢ | dieu-1-5 | 1 | measured 130 | B 80 | B 77 ✗ |
| flat −40¢ | dieu-1-5 | 2 | measured 130 | D 28 ✗ | D 35 ✗ |
| flat −40¢ | dieu-1-5 | 4 | measured 130 | D 6 ✗ | D 7 ✗ |
| flat −40¢ | dieu-1-5 | 1 | uncalibrated (true 130) | B 81 · B 83 · B 76 | B 75 ✗ · B 82 ✗ · B 75 ✗ |
| flat −40¢ | dieu-1-5 | 2 | uncalibrated (true 130) | D 35 ✗ · C 55 ✗ · D 49 ✗ | D 32 ✗ · D 40 ✗ · D 46 ✗ |
| flat −40¢ | warmup-7-12 | 1 | measured 130 | B 78 | B 78 ✗ |
| flat −40¢ | warmup-7-12 | 2 | measured 130 | D 33 ✗ | D 31 ✗ |
| flat −40¢ | warmup-7-12 | 4 | measured 130 | D 0 ✗ | D 0 ✗ |
| flat −40¢ | warmup-7-12 | 1 | uncalibrated (true 130) | B 75 · C 67 ✗ · B 85 | B 77 ✗ · C 67 ✗ · B 81 ✗ |
| flat −40¢ | warmup-7-12 | 2 | uncalibrated (true 130) | D 12 ✗ · D 17 ✗ · D 15 ✗ | D 12 ✗ · D 19 ✗ · D 15 ✗ |
| echo (300 ms behind) | dieu-1-5 | 1 | measured 130 | C 53 ✗ [behind-beat] | C 58 ✗ al+80 [behind-beat] |
| echo (300 ms behind) | dieu-1-5 | 2 | measured 130 | C 50 ✗ [behind-beat] | C 58 ✗ TF318 [behind-beat] |
| echo (300 ms behind) | dieu-1-5 | 4 | measured 130 | D 50 ✗ [behind-beat] | C 63 ✗ TF315 [behind-beat] |
| echo (300 ms behind) | dieu-1-5 | 1 | uncalibrated (true 130) | C 55 ✗ [behind-beat] · C 52 ✗ [behind-beat] · C 57 ✗ [behind-beat] | S 100 ✗ al+290 TF290 [behind-beat] · S 100 ✗ al+290 →280ms TF290 [behind-beat] · S 100 al+80 |
| echo (300 ms behind) | dieu-1-5 | 2 | uncalibrated (true 130) | D 49 ✗ [behind-beat] · D 48 ✗ [behind-beat] · D 47 ✗ [behind-beat] | S 99 ✗ al+290 TF290 [behind-beat] · S 99 ✗ al+310 →280ms TF310 [behind-beat] · A 91 al+80 [wrong-notes,late-entries] |
| echo (300 ms behind) | warmup-7-12 | 1 | measured 130 | A 94 [behind-beat] | S 100 al+70 [behind-beat] |
| echo (300 ms behind) | warmup-7-12 | 2 | measured 130 | B 81 [behind-beat] | S 95 ✗ al+80 TF342 [behind-beat] |
| echo (300 ms behind) | warmup-7-12 | 4 | measured 130 | B 84 ✗ [behind-beat] | S 97 ✗ al+80 TF330 [behind-beat] |
| echo (300 ms behind) | warmup-7-12 | 1 | uncalibrated (true 130) | S 100 →400ms · S 100 · S 100 | S 100 al+140 [behind-beat] · S 100 al+140 →270ms [behind-beat] · S 100 al+70 |
| echo (300 ms behind) | warmup-7-12 | 2 | uncalibrated (true 130) | S 99 →400ms · S 99 · S 100 | S 100 al+150 [behind-beat] · S 99 al+150 →280ms [behind-beat] · S 100 al+80 [behind-beat] |
| one note behind | dieu-1-5 | 1 | measured 130 | D 17 ✗ [wrong-notes] | D 17 ✗ [wrong-notes] |
| one note behind | dieu-1-5 | 2 | measured 130 | D 17 ✗ [wrong-notes] | D 17 ✗ [wrong-notes] |
| one note behind | dieu-1-5 | 4 | measured 130 | D 17 ✗ [wrong-notes] | D 17 ✗ [wrong-notes] |
| one note behind | dieu-1-5 | 1 | uncalibrated (true 130) | D 17 ✗ [wrong-notes] · D 17 ✗ [wrong-notes] · D 17 ✗ [wrong-notes] | D 17 ✗ [wrong-notes] · D 17 ✗ [wrong-notes] · D 17 ✗ [wrong-notes] |
| one note behind | dieu-1-5 | 2 | uncalibrated (true 130) | D 20 ✗ [wrong-notes] · D 20 ✗ [wrong-notes] · D 27 ✗ [wrong-notes] | C 65 ✗ al+440 TF440 [behind-beat] · C 63 ✗ al+440 TF440 [behind-beat] · C 65 ✗ al+440 TF440 [behind-beat] |
| one note behind | warmup-7-12 | 1 | measured 130 | D 33 ✗ [wrong-notes] | D 33 ✗ [wrong-notes] |
| one note behind | warmup-7-12 | 2 | measured 130 | D 33 ✗ [wrong-notes] | D 33 ✗ [wrong-notes] |
| one note behind | warmup-7-12 | 4 | measured 130 | D 33 ✗ [wrong-notes] | D 33 ✗ [wrong-notes] |
| one note behind | warmup-7-12 | 1 | uncalibrated (true 130) | D 33 ✗ [wrong-notes] · D 33 ✗ [wrong-notes] · D 33 ✗ [wrong-notes] | C 55 ✗ al+440 TF440 [behind-beat] · C 52 ✗ al+440 TF440 [behind-beat] · C 57 ✗ al+440 TF440 [behind-beat] |
| one note behind | warmup-7-12 | 2 | uncalibrated (true 130) | D 33 ✗ [wrong-notes] · D 33 ✗ [wrong-notes] · D 33 ✗ [wrong-notes] | B 72 ✗ al+450 TF450 [behind-beat] · B 74 ✗ al+450 TF450 [behind-beat] · B 72 ✗ al+450 TF450 [behind-beat] |
| late pitch arrival (200 ms) | dieu-1-5 | 1 | measured 130 | C 50 ✗ [wrong-notes] | B 86 ✗ al+80 [wrong-notes] |
| late pitch arrival (200 ms) | dieu-1-5 | 2 | measured 130 | D 39 ✗ [behind-beat] | A 94 al+80 [behind-beat] |
| late pitch arrival (200 ms) | dieu-1-5 | 4 | measured 130 | D 35 ✗ [behind-beat] | A 91 al+80 [behind-beat] |
| late pitch arrival (200 ms) | dieu-1-5 | 1 | uncalibrated (true 130) | S 100 →333ms [early-entries] · S 100 [early-entries] · S 100 [early-entries] | S 100 al+150 · S 100 al+150 →280ms · S 100 al+60 |
| late pitch arrival (200 ms) | dieu-1-5 | 2 | uncalibrated (true 130) | D 26 ✗ [wrong-notes] · S 98 →325ms [early-entries] · S 98 [early-entries] | S 100 al+140 [behind-beat] · S 100 al+150 →275ms [behind-beat] · S 99 al+40 [early-entries] |
| late pitch arrival (200 ms) | warmup-7-12 | 1 | measured 130 | S 97 | S 100 al+70 |
| late pitch arrival (200 ms) | warmup-7-12 | 2 | measured 130 | A 91 [behind-beat] | S 99 ✗ al+70 TF263 [behind-beat] |
| late pitch arrival (200 ms) | warmup-7-12 | 4 | measured 130 | A 86 [behind-beat] | S 99 ✗ al+80 TF258 [behind-beat] |
| late pitch arrival (200 ms) | warmup-7-12 | 1 | uncalibrated (true 130) | S 99 →336ms · S 95 · S 100 | S 100 al+140 [behind-beat] · B 95 ✗ al+140 →270ms · S 100 al+60 |
| late pitch arrival (200 ms) | warmup-7-12 | 2 | uncalibrated (true 130) | S 99 →337ms · S 99 · S 100 | S 99 al+150 [behind-beat] · S 99 al+150 →280ms [behind-beat] · S 100 al+60 |

## 5. TRANSITION_MAX sweep (current scorer + alignment, calibrated 150 ms)

Cells: in tune / accuracy grade (✗ = fails the level). Generated scorer variants differ only in `TRANSITION_MAX` (35 %-of-note cap unchanged).

| singer | section | L | 0.1 s | 0.15 s | 0.25 s | 0.35 s |
|---|---|---|---|---|---|---|
| good choir singer | dieu-1-5 | 2 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| good choir singer | dieu-1-5 | 4 | 100% / 99% S | 100% / 99% S | 100% / 99% S | 100% / 99% S |
| good choir singer | warmup-7-12 | 2 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| good choir singer | warmup-7-12 | 4 | 100% / 99% S | 100% / 99% S | 100% / 99% S | 100% / 99% S |
| operatic vibrato | dieu-1-5 | 2 | 100% / 98% S | 100% / 98% S | 100% / 98% S | 100% / 98% S |
| operatic vibrato | dieu-1-5 | 4 | 100% / 98% S | 100% / 98% S | 100% / 98% S | 100% / 98% S |
| operatic vibrato | warmup-7-12 | 2 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| operatic vibrato | warmup-7-12 | 4 | 100% / 99% S | 100% / 99% S | 100% / 99% S | 100% / 99% S |
| ringing transitions (zeta 0.35) | dieu-1-5 | 2 | 100% / 98% S | 100% / 98% S | 100% / 98% S | 100% / 98% S |
| ringing transitions (zeta 0.35) | dieu-1-5 | 4 | 96% / 96% S | 96% / 96% S | 96% / 96% S | 96% / 96% S |
| ringing transitions (zeta 0.35) | warmup-7-12 | 2 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| ringing transitions (zeta 0.35) | warmup-7-12 | 4 | 100% / 100% S | 100% / 99% S | 100% / 99% S | 100% / 99% S |
| slow transitions (fn 3–4 Hz) | dieu-1-5 | 2 | 96% / 98% S | 96% / 98% S | 96% / 98% S | 96% / 98% S |
| slow transitions (fn 3–4 Hz) | dieu-1-5 | 4 | 96% / 91% A | 96% / 91% A | 96% / 91% A | 96% / 91% A |
| slow transitions (fn 3–4 Hz) | warmup-7-12 | 2 | 100% / 100% S | 100% / 100% S | 100% / 100% S | 100% / 100% S |
| slow transitions (fn 3–4 Hz) | warmup-7-12 | 4 | 100% / 99% S | 100% / 98% S | 100% / 99% S | 100% / 99% S |
| late pitch arrival (200 ms) | dieu-1-5 | 2 | 86% / 88% A | 94% / 93% A | 96% / 94% A | 96% / 94% A |
| late pitch arrival (200 ms) | dieu-1-5 | 4 | 81% / 86% A | 89% / 92% A | 90% / 92% A | 90% / 92% A |
| late pitch arrival (200 ms) | warmup-7-12 | 2 | 91% / 94% A ✗ | 98% / 99% S ✗ | 100% / 100% S ✗ | 100% / 100% S ✗ |
| late pitch arrival (200 ms) | warmup-7-12 | 4 | 89% / 96% S ✗ | 97% / 98% S ✗ | 100% / 100% S ✗ | 100% / 100% S ✗ |
| wrong notes (40 %) | dieu-1-5 | 2 | 58% / 58% C ✗ | 58% / 58% C ✗ | 58% / 58% C ✗ | 58% / 58% C ✗ |
| wrong notes (40 %) | dieu-1-5 | 4 | 54% / 56% C ✗ | 54% / 56% C ✗ | 54% / 56% C ✗ | 54% / 56% C ✗ |
| wrong notes (40 %) | warmup-7-12 | 2 | 62% / 62% C ✗ | 62% / 62% C ✗ | 62% / 62% C ✗ | 62% / 62% C ✗ |
| wrong notes (40 %) | warmup-7-12 | 4 | 62% / 62% C ✗ | 62% / 62% C ✗ | 62% / 62% C ✗ | 62% / 62% C ✗ |
| one note behind | dieu-1-5 | 2 | 17% / 17% D ✗ | 17% / 17% D ✗ | 17% / 17% D ✗ | 17% / 17% D ✗ |
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
| 5 + consonants (full) | dieu-1-5 | 4 | 96% / 99% S | 100% / 99% S | 99% / 100% |
| 5 + consonants (full) | warmup-7-12 | 1 | 99% / 100% S | 100% / 100% S | 100% / 100% |
| 5 + consonants (full) | warmup-7-12 | 4 | 99% / 100% S | 100% / 99% S | 100% / 100% |

## 7. Fast notes (good singer, measured delay), before → after

Before = the app at `54ea7b9` (`scoring.ts`, `align.ts`, `pitch.ts` from git), after = the working tree, both through the current pipeline on the same renders (true delay 150 ms, measured). "Fast" = shorter than 0.15 s as sung. Cells: accuracy, and the share of fast notes scored ok/miss. Synthetic runs are scales, thirds and neighbour figures, 2 bars per phrase; `ta` = a consonant on every note, `a` = none (melisma-like), `nolyr` = the singer model's default (a consonant on about half).

| passage | L1 before | L1 after | L2 before | L2 after | L4 before | L4 after |
|---|---|---|---|---|---|---|
| debussy-yver A b1-23 | 100% | 100% | 100% | 100% | 99% | 99% |
| debussy-dieu A b1-5 | 100% | 100% | 98% | 99% | 98% | 98% |
| ravel-nicolette A b20-45 | 99% (2✗) | 100% | 97% | 99% | 97% | 99% |
| synth 80bpm 16ths ta | 100% | 100% | 96% | 99% | 94% | 98% |
| synth 80bpm 16ths a | 100% | 100% | 98% | 98% | 97% | 97% |
| synth 80bpm 16ths nolyr | 100% | 100% | 96% | 99% | 94% | 96% |
| synth 104bpm 16ths ta | 100% | 100% | 90% · 3.1% | 96% · 1.0% | 82% · 9.9% (2✗) | 92% · 2.6% |
| synth 104bpm 16ths a | 100% | 100% | 93% · 4.2% | 96% · 2.6% | 94% · 1.6% | 95% · 1.6% |
| synth 104bpm 16ths nolyr | 100% | 100% | 91% · 4.2% | 96% · 1.6% | 90% · 4.7% | 94% · 2.6% |
| synth 120bpm 16ths ta | 99% | 100% | 84% · 9.4% | 93% · 3.6% | 74% · 18.2% (2✗) | 85% · 9.4% (1✗) |
| synth 120bpm 16ths a | 99% | 100% | 94% · 2.1% | 96% · 1.6% | 89% · 6.3% | 93% · 3.6% |
| synth 120bpm 16ths nolyr | 99% | 100% | 90% · 4.7% | 95% · 2.1% | 85% · 8.3% (1✗) | 91% · 3.1% |
| synth 144bpm 8ths ta | 100% | 100% | 98% | 99% | 95% | 98% |
| synth 144bpm 8ths a | 100% | 100% | 100% | 100% | 98% | 98% |
| synth 144bpm 8ths nolyr | 100% | 100% | 98% | 99% | 97% | 98% |
| synth 144bpm 16ths ta | 98% · 0.0% | 99% · 0.0% | 74% · 18.2% (2✗) | 89% · 7.3% | 69% · 24.0% (2✗) | 79% · 16.1% (2✗) |
| synth 144bpm 16ths a | 97% · 0.0% | 100% · 0.0% | 87% · 8.3% | 91% · 4.7% | 80% · 14.6% (2✗) | 84% · 11.5% (2✗) |
| synth 144bpm 16ths nolyr | 98% · 0.0% | 100% · 0.0% | 85% · 10.4% | 89% · 6.3% | 76% · 17.7% (2✗) | 84% · 10.9% (2✗) |

**Why short notes were lost** (good singer, all levels; the diagnosis replays the scorer on the exact samples it judged and names the rule that dropped each ok/miss note; counts per 1000 notes of that length):

| reason | 0.15–0.25 s before | 0.15–0.25 s after | <0.15 s before | <0.15 s after |
|---|---|---|---|---|
| tracker smear (window, reverb, smoother) | 2.9 | 1.6 | 28.8 | 18.1 |
| too few readings in the note to judge it | 0.0 | 0.3 | 0.0 | 9.2 |
| singer not settled (glide) | 1.0 | 0.0 | 36.2 | 15.1 |
| no readings: consonant / silence | 0.0 | 0.0 | 0.2 | 0.2 |
| only transition readings in the note | 0.0 | 0.0 | 0.0 | 1.2 |
| arrival never reached | 0.0 | 0.0 | 9.7 | 0.0 |
| no readings: tracker gated (unclear) | 0.0 | 0.0 | 6.0 | 0.0 |
| **all lost** | 3.9 | 1.9 | 80.9 | 43.9 |
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
| wrong notes (40 %) | ravel-nicolette A b20-45 | 1 | 58% ✗ (plain 58%) | 60% ✗ (plain 60%) |
| wrong notes (40 %) | ravel-nicolette A b20-45 | 2 | 57% ✗ (plain 57%) | 59% ✗ (plain 59%) |
| wrong notes (40 %) | ravel-nicolette A b20-45 | 4 | 56% ✗ (plain 56%) | 58% ✗ (plain 58%) |
| wrong notes (40 %) | synth 104bpm 16ths ta | 1 | 60% ✗ (plain 60%) | 60% ✗ (plain 60%) |
| wrong notes (40 %) | synth 104bpm 16ths ta | 2 | 52% ✗ (plain 52%) | 58% ✗ (plain 58%) |
| wrong notes (40 %) | synth 104bpm 16ths ta | 4 | 48% ✗ (plain 48%) | 54% ✗ (plain 54%) |
| wrong notes (40 %) | synth 144bpm 8ths ta | 1 | 60% ✗ (plain 60%) | 60% ✗ (plain 60%) |
| wrong notes (40 %) | synth 144bpm 8ths ta | 2 | 59% ✗ (plain 59%) | 59% ✗ (plain 59%) |
| wrong notes (40 %) | synth 144bpm 8ths ta | 4 | 58% ✗ (plain 58%) | 59% ✗ (plain 59%) |
| wrong notes (40 %) | synth 144bpm 16ths ta | 1 | 59% ✗ (plain 59%) | 60% ✗ (plain 60%) |
| wrong notes (40 %) | synth 144bpm 16ths ta | 2 | 52% ✗ (plain 52%) | 57% ✗ (plain 57%) |
| wrong notes (40 %) | synth 144bpm 16ths ta | 4 | 43% ✗ (plain 42%) | 50% ✗ (plain 50%) |
| wrong notes (40 %) | synth 144bpm 16ths a | 1 | 58% ✗ (plain 58%) | 58% ✗ (plain 58%) |
| wrong notes (40 %) | synth 144bpm 16ths a | 2 | 59% ✗ (plain 59%) | 59% ✗ (plain 59%) |
| wrong notes (40 %) | synth 144bpm 16ths a | 4 | 51% ✗ (plain 51%) | 54% ✗ (plain 54%) |
| flat −40¢ | debussy-yver A b1-23 | 1 | 79% ✗ (plain 79%) | 79% ✗ (plain 79%) |
| flat −40¢ | debussy-yver A b1-23 | 2 | 32% ✗ (plain 32%) | 30% ✗ (plain 30%) |
| flat −40¢ | debussy-yver A b1-23 | 4 | 4% ✗ (plain 4%) | 3% ✗ (plain 3%) |
| flat −40¢ | debussy-dieu A b1-5 | 1 | 81% ✗ (plain 81%) | 78% ✗ (plain 78%) |
| flat −40¢ | debussy-dieu A b1-5 | 2 | 18% ✗ (plain 18%) | 25% ✗ (plain 25%) |
| flat −40¢ | debussy-dieu A b1-5 | 4 | 25% ✗ (plain 25%) | 27% ✗ (plain 27%) |
| flat −40¢ | ravel-nicolette A b20-45 | 1 | 76% ✗ (plain 76%) | 73% ✗ (plain 73%) |
| flat −40¢ | ravel-nicolette A b20-45 | 2 | 35% ✗ (plain 35%) | 37% ✗ (plain 37%) |
| flat −40¢ | ravel-nicolette A b20-45 | 4 | 10% ✗ (plain 10%) | 15% ✗ (plain 17%) |
| flat −40¢ | synth 104bpm 16ths ta | 1 | 78% ✗ (plain 78%) | 74% ✗ (plain 74%) |
| flat −40¢ | synth 104bpm 16ths ta | 2 | 45% ✗ (plain 45%) | 54% ✗ (plain 54%) |
| flat −40¢ | synth 104bpm 16ths ta | 4 | 19% ✗ (plain 19%) | 25% ✗ (plain 25%) |
| flat −40¢ | synth 144bpm 8ths ta | 1 | 80% ✗ (plain 80%) | 80% (plain 80%) |
| flat −40¢ | synth 144bpm 8ths ta | 2 | 50% ✗ (plain 50%) | 66% ✗ (plain 66%) |
| flat −40¢ | synth 144bpm 8ths ta | 4 | 14% ✗ (plain 14%) | 25% ✗ (plain 25%) |
| flat −40¢ | synth 144bpm 16ths ta | 1 | 79% ✗ (plain 79%) | 78% (plain 78%) |
| flat −40¢ | synth 144bpm 16ths ta | 2 | 39% ✗ (plain 39%) | 49% ✗ (plain 49%) |
| flat −40¢ | synth 144bpm 16ths ta | 4 | 19% ✗ (plain 19%) | 30% ✗ (plain 30%) |
| flat −40¢ | synth 144bpm 16ths a | 1 | 73% ✗ (plain 73%) | 76% ✗ (plain 76%) |
| flat −40¢ | synth 144bpm 16ths a | 2 | 37% ✗ (plain 37%) | 51% ✗ (plain 49%) |
| flat −40¢ | synth 144bpm 16ths a | 4 | 28% ✗ (plain 28%) | 32% ✗ (plain 32%) |
| one note behind | debussy-yver A b1-23 | 1 | 15% ✗ (plain 15%) | 15% ✗ (plain 15%) |
| one note behind | debussy-yver A b1-23 | 2 | 15% ✗ (plain 15%) | 15% ✗ (plain 15%) |
| one note behind | debussy-yver A b1-23 | 4 | 15% ✗ (plain 15%) | 15% ✗ (plain 15%) |
| one note behind | debussy-dieu A b1-5 | 1 | 17% ✗ (plain 17%) | 17% ✗ (plain 17%) |
| one note behind | debussy-dieu A b1-5 | 2 | 17% ✗ (plain 17%) | 17% ✗ (plain 17%) |
| one note behind | debussy-dieu A b1-5 | 4 | 17% ✗ (plain 17%) | 17% ✗ (plain 17%) |
| one note behind | ravel-nicolette A b20-45 | 1 | 32% ✗ (plain 32%) | 32% ✗ (plain 32%) |
| one note behind | ravel-nicolette A b20-45 | 2 | 30% ✗ (plain 30%) | 31% ✗ (plain 31%) |
| one note behind | ravel-nicolette A b20-45 | 4 | 31% ✗ (plain 31%) | 32% ✗ (plain 32%) |
| one note behind | synth 104bpm 16ths ta | 1 | 9% ✗ (plain 9%) | 8% ✗ (plain 8%) |
| one note behind | synth 104bpm 16ths ta | 2 | 83% (plain 8%, al+80) | 8% ✗ (plain 8%) |
| one note behind | synth 104bpm 16ths ta | 4 | 8% ✗ (plain 8%) | 9% ✗ (plain 9%) |
| one note behind | synth 144bpm 8ths ta | 1 | 8% ✗ (plain 8%) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 8ths ta | 2 | 8% ✗ (plain 8%) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 8ths ta | 4 | 9% ✗ (plain 9%) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 16ths ta | 1 | 8% ✗ (plain 8%) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 16ths ta | 2 | 76% ✗ (plain 8%, al+80) | 9% ✗ (plain 9%) |
| one note behind | synth 144bpm 16ths ta | 4 | 69% ✗ (plain 8%, al+80) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 16ths a | 1 | 8% ✗ (plain 8%) | 8% ✗ (plain 8%) |
| one note behind | synth 144bpm 16ths a | 2 | 11% ✗ (plain 11%) | 11% ✗ (plain 10%) |
| one note behind | synth 144bpm 16ths a | 4 | 8% ✗ (plain 8%) | 9% ✗ (plain 9%) |

**Live display vs result, measured delay** (good singer, L2+L4, after): fast notes shown ok/miss while singing 5.2% vs 5.1% in the result.

**Live display vs result, uncalibrated phone** (true delay 200 ms, estimate 130 ms; notes shorter than 0.25 s shown ok/miss while singing vs in the result after the line-up): debussy-yver A b1-23 L2: 0/0 live vs 0/0 result; debussy-yver A b1-23 L4: 0/0 live vs 0/0 result; debussy-dieu A b1-5 L2: 2/9 live vs 0/9 result; debussy-dieu A b1-5 L4: 0/9 live vs 0/9 result; ravel-nicolette A b20-45 L2: 0/24 live vs 0/24 result; ravel-nicolette A b20-45 L4: 0/24 live vs 0/24 result; synth 104bpm 16ths ta L2: 14/96 live vs 1/96 result; synth 104bpm 16ths ta L4: 30/96 live vs 4/96 result; synth 144bpm 16ths a L2: 78/96 live vs 2/96 result; synth 144bpm 16ths a L4: 80/96 live vs 6/96 result.

## 8. Level 1 on “doo”: every note right (current app)

Each good voice sings the six sections on the lyrics and on “doo” (a 20–45 ms “d” before every note, vowel “u”) at 70% tempo: calibrated (150 ms) and an uncalibrated phone (true 200 ms, first run); on headphones, and on “doo” also on the *phone speaker* (the backing, the own part included, bleeding into the mic at −13 dB). *new* = passes with every note right (ladder.attemptPasses; unreliable notes forgiven unless clearly wrong), *old* = accuracy ≥ 75%. *below good*: notes graded ok/miss, of which *forgiven* by the exemption; *wrong*: notes that failed the run (target · note · grade · cents).

| singer | sung on | delay | new | old | acc | below good | forgiven | wrong notes | median onset ms |
|---|---|---|---|---|---|---|---|---|---|
| good choir singer | lyrics | cal | 28/30 | 30/30 | 100% | 4 | 0 | dieu-6-13 #53 miss 13¢; dieu-6-13 #55 miss 28¢; dieu-6-13 #61 miss 4¢; tabourin-solo-1-8 #1 miss 27¢ | 21 |
| good choir singer | lyrics | uncal200 | 29/30 | 30/30 | 100% | 1 | 0 | tabourin-solo-1-8 #1 miss 1200¢ | 70 |
| good choir singer | doo | cal | 30/30 | 30/30 | 100% | 0 | 0 | – | 18 |
| good choir singer | doo | uncal200 | 30/30 | 30/30 | 100% | 0 | 0 | – | 68 |
| operatic vibrato | lyrics | cal | 18/18 | 18/18 | 100% | 0 | 0 | – | 22 |
| operatic vibrato | lyrics | uncal200 | 16/18 | 18/18 | 100% | 2 | 0 | dieu-6-13 #61 ok -3¢; tabourin-solo-9-16 #38 ok 15¢ | 72 |
| operatic vibrato | doo | cal | 18/18 | 18/18 | 100% | 0 | 0 | – | 21 |
| operatic vibrato | doo | uncal200 | 18/18 | 18/18 | 100% | 0 | 0 | – | 70 |
| control (no vibrato, no overshoot) | lyrics | cal | 17/18 | 18/18 | 100% | 1 | 0 | tabourin-solo-9-16 #33 ok 1¢ | 22 |
| control (no vibrato, no overshoot) | lyrics | uncal200 | 17/18 | 18/18 | 100% | 1 | 0 | dieu-6-13 #64 miss 5¢ | 71 |
| control (no vibrato, no overshoot) | doo | cal | 18/18 | 18/18 | 100% | 0 | 0 | – | 21 |
| control (no vibrato, no overshoot) | doo | uncal200 | 18/18 | 18/18 | 100% | 0 | 0 | – | 70 |
| ringing transitions (zeta 0.35) | lyrics | cal | 16/18 | 18/18 | 99% | 2 | 0 | warmup-upbeat-6 #19 miss 8¢; tabourin-solo-1-8 #1 miss 1191¢ | 24 |
| ringing transitions (zeta 0.35) | lyrics | uncal200 | 18/18 | 18/18 | 100% | 0 | 0 | – | 73 |
| ringing transitions (zeta 0.35) | doo | cal | 18/18 | 18/18 | 100% | 0 | 0 | – | 22 |
| ringing transitions (zeta 0.35) | doo | uncal200 | 18/18 | 18/18 | 100% | 0 | 0 | – | 73 |
| slow transitions (fn 3–4 Hz) | lyrics | cal | 17/18 | 18/18 | 100% | 1 | 0 | dieu-6-13 #55 ok 4¢ | 41 |
| slow transitions (fn 3–4 Hz) | lyrics | uncal200 | 16/18 | 18/18 | 99% | 3 | 0 | dieu-6-13 #58 ok -8¢; tabourin-solo-9-16 #17 miss 8¢; tabourin-solo-9-16 #22 miss 11¢ | 91 |
| slow transitions (fn 3–4 Hz) | doo | cal | 18/18 | 18/18 | 100% | 0 | 0 | – | 46 |
| slow transitions (fn 3–4 Hz) | doo | uncal200 | 18/18 | 18/18 | 100% | 0 | 0 | – | 94 |
| good choir singer | doo, phone speaker | cal | 10/30 | 27/30 | 88% | 93 | 31 | warmup-upbeat-6 #13 miss -1210¢; warmup-upbeat-6 #15 miss -1191¢; warmup-upbeat-6 #17 miss -1187¢; warmup-upbeat-6 #19 miss -1188¢ …+58 | 23 |
| good choir singer | doo, phone speaker | uncal200 | 8/30 | 26/30 | 87% | 98 | 42 | warmup-upbeat-6 #10 miss -1198¢; warmup-upbeat-6 #12 miss -1180¢; warmup-upbeat-6 #13 miss -21¢; warmup-upbeat-6 #14 miss -1182¢ …+52 | 74 |
| operatic vibrato | doo, phone speaker | cal | 7/18 | 16/18 | 89% | 54 | 28 | warmup-upbeat-6 #15 miss -1197¢; warmup-upbeat-6 #19 miss -1185¢; warmup-upbeat-6 #10 miss -1150¢; warmup-upbeat-6 #13 miss -1185¢ …+22 | 28 |
| operatic vibrato | doo, phone speaker | uncal200 | 7/18 | 15/18 | 89% | 50 | 22 | warmup-upbeat-6 #15 miss -1202¢; warmup-upbeat-6 #16 miss 0¢; warmup-upbeat-6 #17 miss -86¢; warmup-upbeat-6 #19 miss -1198¢ …+24 | 76 |

**Fast bars** (Debussy *Yver* 1–23, *Dieu* 1–5, Ravel *Nicolette* 20–45, synthetic 16ths at 104/144 bpm and 8ths at 144 bpm; good singer, calibrated):

| singer | sung on | delay | new | old | acc | below good | forgiven | wrong notes | median onset ms |
|---|---|---|---|---|---|---|---|---|---|
| good choir singer, fast bars | lyrics | cal | 17/18 | 18/18 | 100% | 1 | 0 | ravel-nicolette A b20-45 #107 miss -15¢ | 23 |
| good choir singer, fast bars | doo | cal | 18/18 | 18/18 | 100% | 0 | 0 | – | 19 |

**Singers with wrong notes, on “doo”** (calibrated, headphones unless *phone speaker*: the backing, the own part included, bleeding into the mic at −13 dB; runs passing level 1, new vs old rule):

| singer | new | old | mean acc | wrong / run | forgiven |
|---|---|---|---|---|---|
| wrong notes (40 %) | 0/12 | 0/12 | 61% | 9.7 | 0 |
| one note behind | 0/12 | 0/12 | 25% | 18.7 | 0 |
| one wrong note (a semitone, random) | 0/12 | 12/12 | 96% | 1.0 | 0 |
| one note a semitone flat | 0/12 | 12/12 | 96% | 1.0 | 0 |
| one note 70¢ flat | 1/12 | 12/12 | 96% | 0.9 | 1 |
| flat −40¢ | 0/12 | 7/12 | 77% | 2.3 | 9 |
| one note an octave low | 0/12 | 12/12 | 96% | 1.0 | 0 |
| one wrong note (a semitone, random), phone speaker | 0/12 | 10/12 | 83% | 3.1 | 14 |
| one note an octave low, phone speaker | 1/12 | 11/12 | 85% | 2.8 | 11 |

## 9. Wide vibrato at level 1, and wrong notes at every level (current app)

Every vocal part × section of the library (warm-up and choir library), sung on “doo” at the level's tempo with a vibrato centred on every note (5.5 Hz real time unless noted, from 0.15 s into the note, random phase). Pitch-level readings every 20 ms real, no audio, so the question is the scorer's smoothing alone. Before = the scorer at `cdc3a69` (vibrato window 0.18 score s at every tempo), after = the window follows the tempo (0.18 s real). Sections passing level 1 (every note right):

| singer | sections | before | after |
|---|---|---|---|
| vibrato ±60¢ | 254 | 254 | 254 |
| vibrato ±70¢ | 254 | 254 | 254 |
| vibrato ±80¢ | 254 | 254 | 254 |
| vibrato ±80¢ at 4.5 Hz | 254 | 254 | 254 |
| vibrato ±80¢ at 6.5 Hz | 254 | 254 | 254 |
| vibrato ±80¢ from the note start | 254 | 254 | 254 |
| vibrato ±110¢ | 254 | 208 | 220 |
| vibrato ±150¢ | 254 | 145 | 180 |

**Wrong notes, with a ±40¢ vibrato** (only the sections where the singer sings a wrong note; sections passing; levels 2–5 judge by percentage, so a single wrong note passes there by design):

| singer | level | sections | before | after |
|---|---|---|---|---|
| every 4th note a semitone off | 1 | 253 | 0 | 0 |
| one note a semitone flat (the 3rd) | 1 | 254 | 1 | 1 |
| all a semitone flat | 1 | 254 | 0 | 0 |
| an octave down | 1 | 254 | 0 | 0 |
| every 4th note a semitone off | 2 | 253 | 13 | 13 |
| one note a semitone flat (the 3rd) | 2 | 254 | 249 | 249 |
| all a semitone flat | 2 | 254 | 0 | 0 |
| an octave down | 2 | 254 | 0 | 0 |
| every 4th note a semitone off | 3 | 253 | 13 | 13 |
| one note a semitone flat (the 3rd) | 3 | 254 | 249 | 249 |
| all a semitone flat | 3 | 254 | 0 | 0 |
| an octave down | 3 | 254 | 0 | 0 |
| every 4th note a semitone off | 4 | 253 | 0 | 0 |
| one note a semitone flat (the 3rd) | 4 | 254 | 243 | 243 |
| all a semitone flat | 4 | 254 | 0 | 0 |
| an octave down | 4 | 254 | 0 | 0 |
| every 4th note a semitone off | 5 | 253 | 0 | 0 |
| one note a semitone flat (the 3rd) | 5 | 254 | 243 | 243 |
| all a semitone flat | 5 | 254 | 0 | 0 |
| an octave down | 5 | 254 | 0 | 0 |
