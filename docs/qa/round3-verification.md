# Round 3: verification

**Build:** I tested `1facfd6`. Commit `7e69e6b` (code-review fixes: session races, tempo-aware latency learning, latency tail at the end of a run, the howto card under StrictMode) landed at 09:26 while I was testing. Vite hot-reloaded it, and the items it touches were re-checked on `7e69e6b`: howto, interruption, latency learning, unit and e2e suites.
**Device:** Chromium (Playwright), phone size 390×844, plus 844×390 landscape and 180×370 (200% zoom). Fake mic or `?simulate=`. Production build (`vite build` + `vite preview` on :5180, scratch dir) used for the howto check.
**Priorities:** per `docs/priorities.md`. The Bach chorale was deliberately removed. Bach-only data findings are **Moot**, and the removal cleanup was tested.

**Automated suites (HEAD `7e69e6b`)**
- `npx vitest run`: **189/189 pass** (also 189/189 on `1facfd6`).
- `npx playwright test e2e/flow.spec.ts --project=chromium`: **3/3 pass** (on both commits).
- Re-run of the round-2 QA specs `r2-regressions` and `r2-glitch-compare`: all pass. The output is used below.

**New scripts** (`docs/qa/scripts/`)
- `r3-scoring.qa.test.ts`: onset run with vibrato and dropouts, JI on real pieces, latency heuristic, partial-finish trim, octave singer.
- `r3-onset-compare.qa.test.ts`: HEAD vs `d2dedc4` scoring; the pre-change copy is in `r3-old/scoring.ts`.
- `r3-browser.mjs`: removed-piece notice, URL validation, howto, setup dates, focus, Ranks, rename, reduced motion, partial results, interruption.
- `r3-howto-prod.mjs`, `r3-interrupt.mjs`, `r3-misc.mjs`: tap targets, 200% zoom, landscape, Debussy directions, heat strip.
- Shared helpers: `r3-lib.mjs`.
- Run QA specs with `npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r3- --silent=false`.

**Screenshots:** `docs/qa/shots-r3/`.

## Summary

| | Count |
|---|---|
| Prior open findings re-checked | 71: 33 round-1 still open after round 2, 11 R2, 27 R2X |
| Fixed | 22 |
| Partially fixed | 21 |
| Not fixed | 25 |
| Moot | 1 (R2X-01) |
| Not re-verified | 2 (F19, A16) |
| **New findings** | P0: 0 · **P1: 1** · P2: 1 · P3: 8 |

There are **no open P0s**. The one open P1 is new, **R3-01**: a regression from the "sustained onset" change in `232b934`. Singers with ordinary vibrato (±40–50¢) get Rhythm scores of 13–50% on repeated notes, even with perfect timing. Bruckner Alto, bars 1–8, scores 30% (it was 100%).

All earlier P1s are now Fixed, Moot, or Partially fixed. The partial one is A1, the latency default: it's better, but auto-learning rarely triggers. The rest:
- R2-11: Fixed by the removal notice.
- F2: Fixed through R2-11.
- R2X-01: Moot.
- A5: Fixed, verified with a simulated suspend.

## 1. Status of prior open findings

### Round 2: regression findings (round2-verification.md)

| ID | Pri | Status | Evidence |
|---|---|---|---|
| R2-11 | P1 | **Fixed** | `r3-browser removed`. With `bach-bwv315` or the old `bach-bwv512` in the cycle, Home shows "The Bach chorale "Gib dich zufrieden" was removed from the demo pieces because the edition had wrong notes." with an OK button. The cycle is cleaned to `["warmup-chorale"]` (the warm-up is added if missing). OK clears `sh:notice`, and the notice stays gone after a reload. The old link shows "This piece isn't on this device any more." See `shots-r3/r3-removed-notice.png`. One gap remains: R3-09. |
| R2-01 | P2 | **Fixed** | `highway2d.ts` now takes `beatSec` (the felt beat in score seconds, from `beatSecAt`) and compares it with score-time `ahead`. Units are consistent at 70% and in 2/2 / 6/8. Count-in screenshot: `r3-dieu-countin.png`. |
| R2-02 | P2 | **Partially fixed** | Finish after 9 s on the warm-up at L2 shows the banner "Practice run: stopped early, so it doesn't count toward the level…". The level is not awarded. **Still wrong:** the coach note below it still says "Excellent run… Move on to the next level or the next section", and the heat strip says "bars 0–2" while the section is labelled "Upbeat–bar 6". The progress is still stored under the shared `practice` pseudo-section (`{"practice":{"level":2,…}}`). See `r3-partial-results.png`. |
| R2-03 | P2 | **Fixed** | `r2-regressions`: octave-below rhythm is 1.0, with onsets all 0. `r3-scoring` "R3-octave": octave-below acc/rhythm is identical to in-octave on the warm-up, Dieu and Bruckner at every level. |
| R2-04 | P2 | **Fixed** (but see R3-01) | `r2-regressions` "R2-blip-onset": a 20 ms blip now leaves the onset at 420/400 ms (it was 0). The 60 ms sustained run is what causes R3-01. |
| R2-05 | P3 | **Fixed** | `r2-glitch-compare`: notes of 0.30 and 0.35 s with one ±12 frame or two +7 frames now score 100% (was 0). Notes of 0.45–0.6 s with a single glitch frame still drop to 50% ("ok"). That predates round 1, is unchanged, and is not counted. |
| R2-06 | P3 | **Fixed** | Word directions are drawn at `H-24` and dynamics at `H-6`. Debussy *Dieu!* L1 shows "Très mod…" above "mf", with no overlap (`r3-dieu-start.png`). |
| R2-07 | P3 | **Fixed** (code) | `Play.tsx` reads and clears `sh:fromResults` once when Play mounts (`fromResultsRef`), so the flag can't outlive the run. |
| R2-08 | P3 | **Fixed** | `octaveTolerant = singerIsHigh !== partIsHigh`. L1 no longer forgives same-register octave errors. |
| R2-09 | P3 | **Fixed** (code) | `requestWakeLock` releases the lock if the session was disposed, paused or done while the request was pending. |
| R2-10 | P3 | **Fixed** | Cents are now reported against the pure target. A tempered singer reads +13.7¢ on a major third (`r2-regressions` R2-JI). For a singer matching the tempered backing over whole parts (warm-up, Bruckner, Dieu), the median is 0¢ and the only insight is "great". There is no spurious flat/sharp insight (`r3-scoring` R3-JI). Per-note readouts on thirds show ±14–16¢, which is by design. |

### Round 2: exploratory findings (round2-exploratory.md)

| ID | Pri | Status | Evidence |
|---|---|---|---|
| R2X-01 | P1 | **Moot** | The Bach piece was removed (`9c52b25`). |
| R2X-02 | P2 | **Partially fixed** | `styles.css` has a `prefers-reduced-motion` block. Under `reducedMotion:'reduce'`, the `.btn` transition is `0s`. The arcade drops glow bursts and popup motion. Still missing: no Settings toggle, the arcade is still offered and runs normally (`r3-reduced-motion-arcade.png`), and there is no paged highway. |
| R2X-03 | P2 | **Not fixed** | At 180×370 the scrollWidth is Home 248, Settings 222, Ranks 212, Play 217 (same as round 2). See `r3-zoom200-play.png`. |
| R2X-04 | P2 | **Fixed** | `Results.tsx`: "ok" tiles on `#1D4F63` now use `#EEF0FF` text. Tiles have aria-labels "Bar n: x%". |
| R2X-05 | P2 | **Partially fixed** | `r3-browser rename`: an imported MIDI → Rename → title and composer are saved, persist after a reload, and show in the Library. An empty title is ignored. Built-in pieces don't offer Rename. Still missing: part names and the S/A/T/B mapping can't be edited, and the default title is still the file name ("qa-test-song"). |
| R2X-06 | P2 | **Fixed** | With no name, Ranks shows a "Your name" field and "Share my ranking code" is disabled. After saving, sharing is enabled. Cosmetic leftover: R3-07. |
| R2X-07 | P2 | **Fixed** | Each other singer has a "Remove {name}" button (44×44). Removed entries are gone from the UI and from `sh:leaderboard:local:*`, and stay gone after a reload. There is no "clear board" button and no undo; acceptable. |
| R2X-08 | P2 | **Partially fixed** | Ranks "Choir overview" table (piece × S/A/T/B average readiness), built from your own progress plus collected codes (`r3-ranks-overview.png`). Still missing: per-section detail and "who hasn't reported". |
| R2X-09 | P2 | **Fixed** in Settings (R2) | Concert before rehearsal and past dates are flagged in Settings. The new date fields in Setup are not validated: R3-06. |
| R2X-10 | P2 | **Fixed** | After every route change, focus is on the screen's `<h1>` and `document.title` is updated: Library, Piece, Play (sr-only h1 "Abendlied…: Soprano, Upbeat–bar 6"), Ranks, Settings, Expert, Tuner, Results. The first Tab goes to the first control. |
| R2X-11 | P2 | **Fixed** | Mixer chips are labelled `Hear {part}` (and "(your part)"), and show "(off)" text when muted. The own-part chip is disabled with a title at levels where it is muted. |
| R2X-12 | P3 | **Partially fixed** | "Edit dates" is now 44 px (no inline height). It still opens Settings at the top, not at the cycle section. |
| R2X-13 | P3 | **Not fixed** | The drill title is still "Drill" (`Play.tsx:33`). |
| R2X-14 | P3 | **Not fixed** | The whole-piece "Arcade" button on the Piece screen is still always enabled (`Piece.tsx:201`). |
| R2X-15 | P3 | **Not fixed** | `Settings.tsx restore()` still shows `confirm()` before validating the file. |
| R2X-16 | P3 | **Not fixed** | `Library.tsx` `setError` is still replaced for each failing file. |
| R2X-17 | P3 | **Not fixed** | There is no duplicate detection. |
| R2X-18 | P3 | **Not fixed** | The MusicXML lyric code is unchanged since R2. |
| R2X-19 | P3 | **Fixed** | `sections.ts`: a pickup bar numbered 0 is labelled "Upbeat–bar N". Warm-up: "Upbeat–bar 6", "Bars 7–12". The `music.test` expectation is updated. |
| R2X-20 | P3 | **Not fixed** | Heat tiles are 41×44 on Debussy Dieu Results (`r3-misc` SMALL results). |
| R2X-21 | P3 | **Not fixed** | `index.html` has no description or og tags. |
| R2X-22 | P3 | **Not fixed** | The mic-blocked copy is unchanged. |
| R2X-23 | P3 | **Not fixed** | L1 copy is still "note names shown" (`ladder.ts:30`). |
| R2X-24 | P3 | **Not fixed** | No change to the Expert subtitle. |
| R2X-25 | P3 | **Not fixed** | Settings "Name" is still read-only (`Settings.tsx:104`). The name can now be set on Ranks. |
| R2X-26 | P3 | **Not fixed** | No change to the Piece ladder chips. |
| R2X-27 | P3 | **Fixed** | Pasting your own code shows "That's your own ranking code. Paste codes from other singers." |

### Round-1 findings still open after round 2

| ID | Pri | Status | Evidence |
|---|---|---|---|
| F2 | P1 | **Fixed** (via R2-11) | The Bach progress can't be migrated, because the piece is gone. The singer is now told, and the cycle is cleaned. |
| F5 | P2 | **Partially fixed** | Same as R2-02. Partial runs now score only notes that were completely sung (`n.start+n.dur <= pos+0.05`), but at ≥150 ms latency the last of those notes is still graded as a miss (R3-04). |
| F9 | P2 | **Partially fixed** (unchanged) | Share-code values are clamped: streak ≤ 1000, future `updatedAt` up to now+1 day. Implausible values are still accepted. |
| F14 | P3 | **Partially fixed** | `router.ts` (`7f7810b`): arcade `level=1` becomes L2, `level=9` becomes 4, `level=-3` becomes 0. Drill `from=30&to=5` and `from=-5` are rejected, and a full-piece drill is used instead. Ladder sections ignore `from`/`to`. **Gap:** arcade `level=abc` gives **L1 Arcade** (R3-05). |
| F15 | P3 | **Not fixed** | The `Expert.tsx` `NAMES` array is still sharp-only. |
| F16 | P3 | **Not fixed** | `Results.tsx` next-step logic for generated drills is unchanged. |
| F19 | P3 | **Not re-verified** | Time box. No change to the Brahms data. |
| UX-05 | P2 | **Partially fixed** (unchanged) | There is still no tuning or drone drill. |
| UX-06 | P2 | **Partially fixed** | Setup step 1 now has optional rehearsal and concert dates (`r3-setup-dates.png`). There is still no per-piece target and no on-track/behind indicator. |
| UX-07 | P2 | **Partially fixed** | The countdown timing is fixed (R2-01). There is still no entry-pitch or chord cue during rests. |
| UX-08 | P2 | **Partially fixed** | The overlap is fixed (R2-06). Tempo words still don't change playback. |
| UX-09 | P2 | **Partially fixed** (unchanged) | There are still no breath marks or phrase view. |
| UX-10 | P2 | **Partially fixed** (unchanged) | No lyric data or code change. The Bach part of the finding is moot. |
| UX-12 | P2 | **Partially fixed** | "Edit dates" is fixed. Still 40 px tall: Settings "Voice part" (101×40) and "Delay in milliseconds" (90×40), and the Ranks "Piece" select (190×40). |
| UX-13 | P2 | **Partially fixed** | Share now uses `navigator.share` (clipboard as fallback). There is still no daily plan. |
| UX-14 | P3 | **Not fixed** | `lanesFor` is unchanged. |
| UX-15 | P3 | **Partially fixed** | Same as F14: arcade below L2 is clamped, except `level=abc`. |
| UX-16 | P3 | **Partially fixed** (unchanged) | The greeting is still "Guten Morgen/Tag". |
| UX-18 | P3 | **Not fixed** | The next-up order is unchanged. |
| UX-19 | P3 | **Fixed** | The warm-up reads "Upbeat–bar 6". |
| UX-20 | P3 | **Not fixed** | `repertoire.json` still says "Five-part motet (SATBB)". |
| UX-22 | P3 | **Not fixed** | There is no verse picker. |
| UX-23 | P3 | **Not fixed** | Unchanged. |
| UX-24 | P3 | **Not fixed** | Unchanged. |
| A1 | P1 | **Partially fixed** | Improvements: the latency estimate now runs after `unlockAudio()` (`232b934`). Uncalibrated runs learn a delay from consistently late entries and re-score with it (`Play.tsx onDone`), and since `7e69e6b` this is tempo-aware. Gaps: learning needs ≥ 4 entries after rests of ≥ 0.4 s in one run. Each warm-up section has **1**, so with a simulated 250–350 ms Bluetooth delay nothing is learned (`r3-scoring` R3-latency: `entries:1, learnedMs:null`). See R3-03. Safari still doesn't expose `outputLatency`. |
| A5 | P1 | **Fixed** (desktop simulation) | `session.ts` listens for `statechange` and pauses on any non-running state, which also covers iOS `interrupted`. `r3-interrupt.mjs`: `AudioContext.suspend()` mid-run shows the Paused overlay. Resume brings the context back to `running`, and the run completes with Results ("Level 2 reached"). **15/15 runs** passed on `1facfd6` and `7e69e6b`. Not tested on a real iOS device. |
| A11 | P2 | **Not fixed** | `perfect` still needs `|medDev| ≤ tol/2` (`scoring.ts:410`). |
| A12 | P2 | **Partially fixed** (unchanged) | `RMS_GATE` is still a static 0.005. |
| A14 | P2 | **Not fixed** | Pitch analysis still runs on `setInterval` on the main thread. |
| A15 | P3 | **Fixed** (code) | `session.play()`: after a resume, L4 (`cue:'chord'`) keeps the chord cue. Other levels get the note. |
| A16 | P3 | **Not re-verified** | Needs an iOS device. |
| A17 | P3 | **Partially fixed** | Results shows "You came in consistently late after rests… set your delay to N ms and re-scored", but only when auto-learning triggers (rarely, see A1). There is no general "+X ms late" chip. |
| A18 | P3 | **Not fixed** | The precache config is unchanged. Fine at the current size. |

Round-1 items marked Fixed in round 2 (including A13 and A19, marked Fixed "mostly" and "6× still marginal") were not re-tested. The only exceptions were F1 and F3, which are covered by the e2e suite and the partial-run check.

## 2. New findings

| ID | Priority | Type | Title | Steps | Expected / Actual | Evidence |
|---|---|---|---|---|---|---|
| R3-01 | **P1** | bug (regression, `232b934`) | Repeated notes sung with normal vibrato get almost no onsets, so Rhythm is 13–50% for perfectly timed singing | Sing any passage with repeated pitches (common in chorales and the built-in pieces) with ±40–50¢ vibrato, at L2–L4. | **Expected:** Rhythm about 100% when the timing is perfect, as before `232b934`. **Actual:** for a repeated note (`legatoFrom === note.midi`), the onset needs `inTol` on the **raw, unsmoothed** deviation for 60 ms in a row (`ONSET_RUN`). With ±40¢ vibrato at 5.5 Hz, the raw deviation stays inside ±25–35¢ for only about 25 ms at a time, so the run never completes. Those notes get `onsetMs = null`, which scores 0 for rhythm. Synthetic results (HEAD vs `d2dedc4`): 8 repeated G4s, vib ±40/tol 35 → **28% vs 100%**; vib ±40–60 at tol 25–35 → **13%** (was 100%). Built-in pieces, first section, perfect timing, vib ±50, L2 tolerance: Bruckner Alto **30%** (14/20 notes without onset), Bass 41%, Tenor 50%; Debussy *Dieu* Soprano **53%**; Yver Alto 72%, Tenor 67%; warm-up Alto 71%. Accuracy and levels are unaffected, but the Rhythm stat on Results ("Lock in rhythm and entries" is the point of L2) is badly wrong for the ordinary vibrato of an adult choral voice. Suggested fix: for repeated notes, use the vibrato-smoothed deviation (or a looser threshold), or fall back to an amplitude re-attack. Alternatively, treat a sustained repeated pitch as on time. | `r3-onset-compare.qa.test.ts` (R3-cmp-repeat, R3-cmp-piece); `r3-scoring` R3-repeat-vib |
| R3-02 | P3 | bug (from `232b934`) | One pitch-tracker dropout resets the 60 ms onset run, so entries are graded late when the signal is noisy | Entries after rests with 15–30% per-frame detector dropouts (a quiet voice, a noisy room). | **Expected:** onset close to the true entry. **Actual:** `runStart` resets on any unvoiced frame. With 15% dropout, onsets are 73–193 ms late (rhythm 94%); with 30%, 133–287 ms (rhythm 73%). Perfect singing at 0% dropout scores 100%. A gap of one or two frames should be tolerated. | `r3-scoring` R3-dropout-onset |
| R3-03 | P2 | design gap / risk (`232b934`, `7e69e6b`) | Auto-learned headphone delay almost never triggers on section runs. When it does, it can silently absorb a singer's genuine lateness | (a) Uncalibrated Bluetooth user, warm-up L1/L2. (b) A beginner with wired headphones (correct estimate) who comes in late at most entries in a longer section. | (a) Each warm-up section has only 1 entry after a ≥ 0.4 s rest, so the `≥ 4 entries` rule never fires. At 250–350 ms of real delay nothing is learned, and rhythm stays at 78–85% (`R3-latency`: `entries:1, learnedMs:null`). A1 stays partial for the main use case. (b) In sections that do have ≥ 4 entries, a consistently late singer (median > 120 ms, IQR < 160) has their lateness written to `profile.latencyMs` permanently, up to 500 ms. The setup tip ("run voice setup… delay") disappears, and from then on every run is shifted, so the late-entry coaching can't fire. Suggested fix: learn per device over several runs, ask before saving ("Were you wearing Bluetooth headphones?"), or only apply the value after a quick calibration tap. | `r3-scoring` R3-latency; `Play.tsx onDone` |
| R3-04 | P3 | bug (from F5 fix) | Finish mid-section: the last fully-sung note is graded as a miss when output latency is ≥ 150 ms | Uncalibrated or Bluetooth setup, tap Finish just after a note ends. | `finish()` keeps notes with `end ≤ playback pos + 0.05`, but mic samples are stamped `ctxTime − latency`, so the tail of that note hasn't arrived yet. Probe (0.5 s notes): latency 80 ms → all perfect; 150 ms → last note "ok" (acc 83%); 250 ms → last note **miss** (67%). `7e69e6b` added a latency-tail wait only for the natural end of a run, not for Finish. | `r3-scoring` R3-partial |
| R3-05 | P3 | bug (`7f7810b`) | Arcade URL with a non-numeric level still runs Arcade at L1 | Open `#/arcade/warmup-chorale/P1/s0-m0-6?level=abc`. | **Expected:** L2 (the arcade minimum). **Actual:** `parseHash` returns `level:1, mode:'3d'`, and the screen shows "L1 Note-learning · Arcade". The `Number.isFinite(lv) ? clamp : 1` fallback skips the arcade minimum. | `r3-browser url` log |
| R3-06 | P3 | UX (`7f7810b`) | The new Setup date fields accept a concert before the rehearsal and dates in the past | Setup step 1: rehearsal 2026-11-20, concert 2026-11-01, then rehearsal 2020-01-01. | Settings warns about both (R2X-09). Setup saves them silently (no `role=alert`), and the "N sections a day" target is then computed from nonsense dates. | `r3-browser setup`; `shots-r3/r3-setup-dates-filled.png` |
| R3-07 | P3 | cosmetic (`9c52b25`) | Before a name is set, Ranks lists you as "Me (you)" | Skip onboarding, open Ranks. | The board shows "M · Me (you)". Sharing is correctly blocked until a name is saved. Show "You" or prompt for the name in the row instead of the placeholder "Me". | `r3-browser ranks` log |
| R3-08 | P3 | layout (`fcbd4fe`) | Landscape 844×390: the first-run howto card pushes the level card's header off the top, and the "Soprano · you" chip is clipped | First L1 practice run on a phone in landscape. | The card's eyebrow "LEVEL 1 · NOTE-LEARNING" and half the title sit above the viewport, and the page can't scroll (scrollHeight 390). "Start singing" stays visible. While the run plays, the own-part mixer chip shows "Sopran… · you", clipped. | `r3-howto-prod-844x390.png`, `r3-land-running.png` |
| R3-09 | P3 | gap (`232b934`) | A singer with Bach progress who had already removed Bach from the cycle isn't told it was withdrawn | `sh:progress:bach-bwv315:*` exists, Bach not in `sh:cycle`, reload. | No notice appears. The progress keys stay orphaned in storage, and the old link says only "This piece isn't on this device any more." Also check `sh:progress:*` keys against `REMOVED` when deciding whether to show the notice. | `r3-browser removed` ("no bach in cycle, progress only") |
| R3-10 | P3 | copy (`fcbd4fe`) | Howto text: "The blue line is your voice. Keep it on the bar; it turns blue when you hit it." | First practice run. | "It" seems to mean the bar (the hit note bar turns blue), but it reads as the blue line turning blue. Suggest: "…the note bar turns blue when you hit it." | `r3-howto-prod-390x844.png` |

## Not counted as findings / notes

- **Howto in dev (StrictMode):** on `1facfd6` the card never appeared in dev, because the `useState` initializer wrote `sh:seenHowto` and StrictMode ran it twice. Production showed it. `7e69e6b` moved the write into an effect, and the card now shows on the first L1 run in dev and production, then stays hidden after a reload.
- **Interruption flake:** on `1facfd6`, 2 of 14 runs did not finish as expected after a simulated suspend. One never paused and ended back on the ready card; in the other, Resume worked but the run returned to the ready card without Results. I couldn't reproduce this in 3 further runs on `7e69e6b`, which fixed a resume/pause race and a "start after dispose" race. Not counted. Worth one manual check on iOS.
- **Medium notes:** 0.45–0.6 s notes with a single 20 ms octave glitch still drop to "ok" (50%). This predates round 1 and is unchanged (`r2-glitch-compare`).
- **URL drills:** a drill with invalid `from`/`to` falls back silently to a whole-piece "Drill". That is reasonable.
- **Landscape running layout:** Pause at y 336–384, no scroll. Results in landscape scrolls vertically (876 px), which is expected.
