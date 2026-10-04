# Round 7: first field feedback (scoring realism)

## What the singer reported

A trained alto sang Debussy *Dieu! qu'il la fait*, bars 1–5, at L1 on an Android phone and reported:

1. The device delay seemed off: the previous note's pitch leaked into the next note and was scored as off-pitch.
2. The pitch trace "massively overshoots for a second" at note changes ("sinc function wiggling").
3. The same performance, sung three times, was graded C, A, A.
4. A very small vibrato cut "In tune" by about 10%. One result showed "avg +3¢" but only 90% in tune.
5. She asked which pitch-detection algorithm the app uses and how long its window is. The answers are in `docs/SCORING.md`.

## What we found

`qa/realism` renders realistic singers and pushes them through the app's own tracker and scorer. Its before/after numbers are in `docs/qa/realism-baseline.md` and `docs/qa/realism-current.md`. The singers are modelled with:

- vibrato;
- underdamped transitions that overshoot;
- consonants, jitter and drift;
- a reverberant room, a phone microphone and backing bleed;
- a true delay that differs from the one the app assumes.

Findings:

- **A delay mismatch is the main cause.** At L4 on an uncalibrated phone (true delay 200 ms, assumed 80 ms), in-tune fell to 79%, with C grades on Debussy. The old onset-based delay learning switched on only above a threshold, so it kicked in between runs. That produced the C → A pattern.
- **Most of the overshoot is the readout, not the voice.** The live cents readout compared the latest reading with the note under the playhead. After every note change it showed the previous pitch against the new target for 150–300 ms. Real voices do overshoot by 10–40% of the interval, but the tracker reproduces that faithfully and doesn't invent it.
- **Vibrato is not the cause:** the vibrato filter worked. Small vibrato cost nothing.
- **Practising on the phone speaker** makes the detector lock onto subharmonics of voice plus backing.

## What changed

The scoring and delay rules are documented in full in `docs/SCORING.md`.

- **Line-up after every run:** a pitch-based lag search lines the voice up with the score.
  - Only intonation is judged on the lined-up voice; onsets, rhythm and tips stay honest.
  - The device delay is learned once two runs agree, with caps while the guide plays.
- **Intonation starts when the voice arrives:** judging starts from about 60 ms of in-tolerance singing, no more than 0.15 s and 35% of the note after the written start. It stops when the voice heads for the next note. Vibrato is cancelled by a cascaded filter.
- **Timing at L2 and above:**
  - With a measured delay, clearly late entries fail the run.
  - Without one, such runs, and runs whose delay is beyond the plausible range, don't count. The app asks for the 10-second delay check.
- **Live cents readout** compares each reading with the note that was due when it was sung.
- **Speaker-bleed subharmonics** are corrected at scoring time.
- **Shorter analysis window** (1024 samples) for upper voices whose range is known.
- **Run recordings:** Results → "Share this run's recording" produces a WAV plus run.json. `qa/realism` `scoreRecordingApp` re-scores it exactly as the app does. Use this for the reference recordings.

## QA

Three rounds of code review, two browser QA passes and the realism harness.

- **Final state:**
  - No P0 or P1.
  - 482 unit tests and 6 Playwright tests pass.
  - The realism sanity guard passes: wrong-note, flat, echo and one-note-behind singers fail where they should.
- **Accepted P2/P3:**
  - Very loud speaker bleed (−8 dB) can still fail a good singer at L4.
  - A stale measured delay more than 270 ms too low fails timing until the delay check is redone; the banner explains this.
  - Flat glides through the target get a little partial credit.
  - The timing gate's margin for on-time singers with long consonants at 70% tempo is narrow (248 ms against 250 ms in the worst synthetic case).
