# Round 1: functional QA

**Build tested:** dev server at http://localhost:5179. The code changed while I was testing: commits `b0f7a35`, `9122c91` and `baa0d5a` landed and Vite hot-reloaded. Every finding below was re-checked against HEAD `baa0d5a`. A few early runs were cut off by HMR reloads; those runs were repeated and are not counted as bugs.
**Device:** Chromium (Playwright) at 390×844 phone size, mobile with touch, fake mic. Also tested at 844×390 landscape and 320×640.
**Scripts:** `docs/qa/scripts/*.mjs`. Run them from the repo root with `node docs/qa/scripts/NN-*.mjs`.
**Fixtures:** `docs/qa/fixtures/`: a generated MIDI file, invalid files, and WAVs for the fake mic.
**Screenshots:** `docs/qa/shots/`.
**Priorities:** per `docs/priorities.md`.

## Summary

| Priority | Count |
|---|---|
| P0 | 0 |
| P1 | 3 |
| P2 | 6 |
| P3 | 10 |

## Findings

| ID | Pri | Type | Title | Steps to reproduce | Expected vs actual | Evidence |
|---|---|---|---|---|---|---|
| F1 | **P1** | bug | Pickup bar padded to a full bar: 3 beats of silence after the upbeat in Bach BWV 315 (and in any MusicXML pickup without `implicit="yes"`) | 1. Open `?simulate=perfect#/play/bach-bwv315/P2/s0-m0-5?level=1` and start. 2. Watch after the first note "Gib". | **Expected:** the 1-beat upbeat "Gib" leads straight into bar 2 "dich". **Actual:** the importer makes measure 1 four beats long (`#1 beats 0+4`), even though every part has only one quarter note in it. All voices go silent for 3 beats, the highway is empty and the entry countdown runs. This is the built-in piece described as "the ideal first piece to learn the app". Cause: `src/music/musicxml.ts` ~L647-651 pads any short non-final measure to the time signature unless `implicit="yes"`. It should treat a short *first* measure as an anacrusis. | `10-data.mjs` output (`bach-bwv315 ms: "#1 beats 0+4"`). The source mxl has a single `<duration>4</duration>` (divisions 4) in measure 1. Empty highway: `shots/09-bach-movable-1.png`, `shots/09-bach-jianpu-1.png`, `shots/11-arcade-run1.png` |
| F2 | **P1** (P0 if a build with `bach-bwv512` ever reached singers) | bug | Renaming the built-in piece id `bach-bwv512` → `bach-bwv315` orphans existing progress | 1. On a build from before `b0f7a35`, practise Bach (progress key `sh:progress:bach-bwv512:*`, cycle contains `bach-bwv512`). 2. Update to HEAD. | **Expected:** progress, cycle membership and leaderboard entries carry over, or are migrated. **Actual:** the piece disappears from Home and the cycle without any message. Old links show "This piece isn't on this device any more". Readiness and levels for it are lost, and the old progress keys stay in storage unused. It also happened live during this test: Bach vanished from Home in the middle of a session. Needs an id alias or a migration in `store.ts`. The same applies to any future rename in `repertoire.json`. | `05-bachload.mjs` (4 loads → "Not found"); `git show b0f7a35 --stat` (rename `pd/bach-bwv512.mxl => bach-bwv315.mxl`) |
| F3 | **P1** | bug | Level 1 run at reduced tempo says "practice only, won't count" but still passes the level | 1. Bach, Alto, Bars 1–6, Level 1, with `simulate=perfect`. 2. Set the tempo slider to 40%; the label reads "(slower than the level: practice only, won't count)". 3. Sing it to the end. | **Expected:** no level change. **Actual:** `sh:progress:bach-bwv315:P2` gets `{"s0-m0-5":1}` and the piece screen shows level 1 passed. `Play.tsx` `onDone` calls `recordAttempt(...level...)` unconditionally; only `snapshotReadiness` is gated on `ladder`. So the ladder reports a level the UI promised not to award. | `11-results-flow.mjs` log: "progress after 40% run {"sh:progress:bach-bwv315:P2":{"s0-m0-5":1}}"; `shots/11-slow-tempo.png`, `shots/11-slow-results.png` |
| F4 | P2 | bug | Quit/Back on the play screen after "Again" or "Try again" opens a stale Results screen | 1. Piece → level 1 → sing to Results. 2. Tap **Again** and start. 3. Pause → **Quit** (or tap the top-left Back). | **Expected:** you return to the piece screen. **Actual:** you land on the previous Results page (`#/results`). `back()` calls `history.back()`, and Results had replaced the earlier Play entry. Workaround: tap "All sections". | `11-results-flow.mjs`: "Quit after Again -> #/results"; `shots/11-quit-after-again.png`. Same in `07-controls.mjs` ("after quit", "back during play" → `#/results`) |
| F5 | P2 | bug | Finishing early scores the whole section: unsung bars count as misses and a failed attempt is recorded | A) Start Bach Tenor L2 and tap **Finish** after about 16 s (around 60%). B) Start and tap **Finish** during the count-in. | **Expected:** only the bars actually sung are scored, or an early finish is not recorded / not counted. **Actual (A):** 44% "Not yet", 15 misses, and the coach note "Trouble spot: bars 3–6 … only 21% landed" for bars never reached. **Actual (B):** 0%, "miss 27", "We could hardly hear you", logged as an attempt that affects stats and the streak. | `shots/17-finish-partial.png`, `shots/07-finish-countin.png`, `shots/07-finish-early-results.png` |
| F6 | P2 | UX | Landscape (844×390): the Pause/Finish/Restart row is below the fold during play | Rotate to landscape on any play screen and start. | **Expected:** transport controls visible. **Actual:** the controls row starts at y=396 with a 390 px viewport, and the highway is squeezed to about 240 px. You have to scroll the page (80 px) mid-song to pause. In arcade the same row is off-screen. | `16-landscape.mjs` (pause at [396,456], innerHeight 390); `shots/15-land-play.png`, `shots/15-land-arcade.png` |
| F7 | P2 | bug | A malformed URI in the hash crashes the app (blank screen) | 1. Open `http://localhost:5179/#/piece/%E0%A4%A` fresh. 2. Or change the hash to it while the app is open. | **Expected:** fall back to Home or "Not found". **Actual (fresh load):** white screen with `URIError: URI malformed` (uncaught `decodeURIComponent` in `parseHash`). **Actual (hash change):** the route doesn't update and the previous screen, including a running session, stays. Rare, because the app never generates such links, but a mangled shared link would hit it. | `shots/17-malformed-uri.png`; pageerror "URI malformed" ×3 |
| F8 | P2 | UX / a11y | Heat-strip bars on Results are tiny touch targets | Results screen → "Bar by bar". | **Expected:** at least 44×44 px targets (as round-1 UX asked). **Actual:** each bar is 19.6×30 px for a 6-bar section, and narrower for longer sections. Tapping the wrong bar starts the wrong drill. | `11-results-flow.mjs` "heat bar size {width: 19.56, height: 30}"; `shots/06-bach-alto-L2-flat-after.png` |
| F9 | P2 | bug | Pasted ranking codes aren't sanity-checked; a future timestamp pins the entry for good | Ranks → paste a code built with `encodeShareCode` format: `["Zukunft","B","bach-bwv315",2000,99999999999,999999,5000,<now+1 year>]`. | **Expected:** reject implausible values (readiness > 100%, streak longer than the app has existed, future `updatedAt`). **Actual:** accepted as #1 with a "10000-day streak", 1,000,000,000 points and 100% readiness. Section battle B goes to 100%. Because "newer updatedAt wins", that singer's genuine later codes can never replace it. HTML in names is escaped correctly (no XSS). | `13-ranks-settings.mjs` log "RANKS2"; `shots/13-ranks-after-paste.png` |
| F10 | P3 | UX | Import error messages leak raw parser text | Library → import an empty `.xml`. Also import random bytes as `.mid`. | **Empty .xml:** shows "Invalid MusicXML: This page contains the following errors:error on line 1 at column 1: Document is empty Below is a rendering of the page up to the first error." (Chromium DOMParser text). **Random .mid:** shows a generic "could not read this file". The other cases are friendly: .txt, HTML-as-.musicxml, rests-only, bad zip. When several files are imported at once, only the last error is shown. | `shots/03-import-empty.png`, `shots/03-import-random-mid.png` |
| F11 | P3 | copy | Library footer says "Built-in pieces are original study pieces written for this app." | Library, scroll to the bottom. | Most built-ins are public-domain Bach/Bruckner/Debussy/Brahms/Ravel (Settings credits them correctly). | `shots/03-library-after-imports.png` |
| F12 | P3 | UX | Home repertoire row shows "38%" next to "not started" | Pass one Bach Soprano section to level 3, then open Home. | The status label uses the *minimum* section level, so a piece at 38% still reads "not started". Something like "in progress" or "1/2 at L3" would be clearer. | `13-ranks-settings.mjs` HOME log |
| F13 | P3 | UX | A concert date before the rehearsal date is accepted without warning | Settings → rehearsal 2026-10-10, concert 2026-10-06. | Home shows "6d Rehearsal · 2d Concert". A warning or swap was expected. | `shots/13-home-dates.png` |
| F14 | P3 | bug | Hand-edited or crafted play URLs bypass the locks | `#/arcade/...?level=1` (arcade is locked below L2); `?level=abc` (becomes Listen); `drill?from=30&to=5` (count-in shows "29"). | Should clamp or validate: arcade at ≥ L2, unknown levels → 1, from < to. | `15-robust.mjs` log; `shots/15-deeplink-*` |
| F15 | P3 | UX | Zwölfton: the row card spells G♯/D♯/A♯ but the highway axis spells A♭/E♭/B♭ | Expert → With guide tone. | Use one spelling, or pitch-class numbers on both. | `shots/12-expert.png` vs `shots/12-row-run.png` |
| F16 | P3 | copy | Row and leap-drill results read "WHOLE PIECE · ROW" and suggest "Next: P0, level 1" after a 100% L2 run | Expert → row with guide → finish. | The suggestion doesn't fit a generated drill. A better one: "Try no help" or "another form". | `12-screens.mjs` "row results" |
| F17 | P3 | feature request | Imported scores without metadata get the raw file name and "Unknown composer", and can't be renamed | Import `content/raw/elgar_there-is-sweet-music_op53-1.mxl`. | Title "elgar_there-is-sweet-music_op53-1". A rename/edit-composer option, or prettifying the file name, would help. | `shots/03-import-elgar.png` |
| F18 | P3 | UX | Restoring a backup replaces all progress without a confirmation | Settings → Restore from file / paste. | Replaces immediately (toast "Backup restored"). A confirmation would protect against restoring the wrong or older file. | `13-ranks-settings.mjs` |
| F19 | P3 | observation | `simulate=perfect` on Brahms Bass II, bars 1–6, scores 92% (one "ok"), not 100% | `?simulate=perfect#/piece/brahms-schaffe`, Bass II, L1. | All other perfect runs gave 100%. Possibly a low note (range 43–53) or a tie/rest quirk. Not investigated further; worth a unit check. | `06-core2.mjs` log |

## What I tested that worked

- **First run.** Home shows the setup prompt. The setup wizard works through all 4 steps: name, voice, range with fake mic (G3–G5 detected from a slide WAV, "sounds like a soprano"), latency clicks (measured 61–73 ms with the fake device) and notation. Back works on each step, back on step 1 exits, and Skip sets `onboarded`. Notation and voice persist across reload (`shots/01-*`).
- **Library.** All 7 built-ins load (~650 ms). Parts and sections look sane:
  - Warm-up: 13 bars incl. pickup bar 0.
  - Bach: 4 parts, 2 sections.
  - Bruckner: 6 sections.
  - Debussy Dieu: 4 sections.
  - Brahms: 5 parts, SATBB.
  - Ravel: 6–7 sections. Soprano correctly skips bars 14–19 where it rests.
  - Debussy Yver: 5 parts, 9 sections, key change G→E→G parsed.
- **Imports.**
  - Warm-up MusicXML, the Elgar `.mxl` (9 divisi parts) and the Reger `.mxl` all import.
  - The generated 3-track MIDI (3/4, G major) imports to 7 bars, and its piano track appears as a part.
  - Re-importing the same file is de-duplicated.
  - Imports persist across reload.
  - Delete asks for confirmation and keeps the history.
  - Friendly errors for: `.txt`, random `.mxl` ("invalid zip data"), HTML posing as `.musicxml`, rests-only score.
  - Adding and removing pieces from the cycle updates Home.
- **Core loop.** I ran perfect, flat and sloppy simulations on Bach (S/A/T/B), Debussy Alto, Ravel Tenor, Brahms Bass II and Bruckner Soprano, at L0 Listen and L1–L4:
  - Perfect gives 100% / S and "Level N reached" at each level, plus the rehearsal- and concert-ready messages.
  - Flat gives "You tend to sing flat … ~33–35¢" with loop buttons.
  - Sloppy gives "Wrong notes in bars…".
  - Pause, resume (incl. during count-in), Restart, then completing gives 100%.
  - Browser back and forward during play, and the double tap on Start, all behave.
  - Heat-strip tap and coach "Loop bars" open a working drill. Next / Again / Easier / All sections all route correctly.
  - Arcade unlocks after L2 and plays.
  - Readiness % on the piece screen and Home updates. Due-for-review (L3, 9 days old) shows on Home and the piece screen.
- **Whole piece.** Concert mode runs the full Bach and gives results.
- **Expert.**
  - P/R/I/RI row forms are mathematically correct (checked by hand).
  - The row runs with guide, without help and in arcade.
  - The leap drill builds from the cycle and plays.
  - Reloading on a generated row route rebuilds it.
- **Ranks.** All tabs work. Share copies a code to the clipboard. Pasting codes adds rankings and ignores garbage. HTML in names is escaped.
- **Settings.**
  - All notation, strictness and tuning toggles persist.
  - The notation preview is key-aware ("in D major").
  - The latency field clamps to 0–600.
  - The cycle name and dates drive the Home countdown, including "done" for past dates.
  - Backup save (JSON download), restore from file and restore from paste all work.
  - Invalid backups (`{not json`, `{"foo":1}`, `[]`, wrong schema, a `.txt` file) all get friendly errors.
- **Tuner.** Works with the fake WAV mic: A4 ≈ 440 Hz, C4/C5 detected with sensible cents.
- **Robustness.**
  - Unknown piece, part or section deep links show "Not found" with Back, and `level=9` clamps to 4.
  - Reload mid-session returns to the ready overlay.
  - Clearing localStorage mid-run still completes, and Home falls back to first-run.
  - No horizontal overflow at 390 or 320 px on any screen, or at 844 px landscape.
  - No console or page errors anywhere except F7.
- **Notation (Bach BWV 315, G major, Alto axis C4–C5).**
  - Fixed do: Do Re Mi…
  - Movable do: C=Fa, C♯=Fi, D=Sol, D♯=Si, E=La, F=Te, F♯=Ti, G=Do, A=Re, B=Mi. Correct.
  - Jianpu: E=6, F♯=7, G=1̇ with octave dots relative to G4, F=♭7. Correct.
  - Pitch classes and letters are also correct.
  - The Settings preview shows D E F♯ G for the D-major warm-up.
