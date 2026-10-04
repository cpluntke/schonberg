# Round 4: final verification

**Build:** HEAD `9b13580`, which includes `7e69e6b` (code-review fixes), `cc55c35` (acceptance fixes) and `9b13580` (round-3 fixes).
**Device:** Playwright Chromium, 390×844 and 844×390, with a fake mic or `?simulate=`. Dev server on :5179.
**Priorities:** per `docs/priorities.md`.

**Automated suites (HEAD)**
- `npx vitest run`: **189/189 pass**.
- `npx playwright test e2e/flow.spec.ts --project=chromium`: **3/3 pass**.
- QA config (`r3`): 14/16 pass. The 2 failures are `r3cr-timing` CR-05 and CR-10. Those probes re-implement the *old* formulas inline. The real code paths were re-checked with the new `r4-*` probes, and both items are fixed (see below).
- `r3cr-howto-strictmode.mjs` still prints `howtoShown:false`. The probe is flawed: it hash-navigates to Play, which mounts Play and sets the flag, and *then* reloads. A clean first load (`r4-browser howto`) shows the card.

**New scripts** (`docs/qa/scripts/`)
- `r4-session.qa.test.ts`: the real `PracticeSession` with mocked audio. Covers partial-finish trimming, the end tail, pause or dispose during the tail, and the resume race.
- `r4-latency.qa.test.ts`: the HEAD `Play.tsx onDone` learning rule, copied verbatim, run per real section with realistic singers.
- `r4-consonant.qa.test.ts`: onsets for short syllables that start with a consonant, HEAD vs the pre-`232b934` copy.
- `r4-browser.mjs` and `r4-lib.mjs`, with sections: `howto url setup listen flow ranks landscape blocked`.

**Screenshots:** `docs/qa/shots-r4/`.

## Verdict

- **Open P0: none.**
- **Open P1: none.**
  - R3-01 (the only open P1 after round 3) is fixed.
  - CR-01, CR-02 and CR-03 are fixed, or reduced to a P2 residual.
  - A1 (latency) is still only partially fixed. The remaining effect is a Rhythm stat that reads low for uncalibrated Bluetooth users. Voice-setup calibration is a workaround, so it is now rated **P2**.
- **Open P2s:** 5 from the round-3 lists and 1 new (R4-01). They are listed at the end.

## 1. Status of round-3 findings

### Round-3 verification (R3-xx)

| ID | Pri | Status | Evidence |
|---|---|---|---|
| R3-01 | P1 | **Fixed** | A repeated pitch now accepts ±1 semitone (`scoring.ts:337`). `r3-onset-compare` on HEAD: repeated G4 with vibrato ±25–60¢ at tolerance 25/35 → **rhythm 100%** (was 13–28%). Built-in pieces with vibrato ±50: Debussy, warm-up, Bruckner and Yver all at **100%**, with 0 notes lacking an onset. `r3-scoring` R3-repeat-vib: 100% at every vibrato and level. |
| R3-02 | P3 | **Fixed** | One dropout frame is tolerated (`runMiss`). `R3-dropout-onset`: 15% dropout → rhythm 100% (was 94%). 30% → 96% (was 73%). |
| R3-03 | P2 | **Partially fixed** | `r4-latency` uses the HEAD rule (all onsets if fewer than 2 entries; `med/rate > 150`, `iqr/rate < 120`). **(a)** Bluetooth 250/350 ms on Debussy and Bruckner sections now learns after one run (250–370 ms). **On the warm-up chorale, the first piece, it still never learns.** The onsets are bimodal: repeated notes get onset ≈ 0 by design since the R3-01 fix, and moving notes get ≈ 210 ms, so IQR ≈ 200 > 120. Warm-up L2 Rhythm stays at **78% (250 ms) / 60% (350 ms)**. **(b)** A wired singer who is *genuinely* 200 ms late with low spread is still written to `profile.latencyMs`: Debussy bars 1–5 → 260 ms, Bruckner → 240–260 ms. The setup tip then disappears. Levels are unaffected, because passing uses accuracy. Workaround: run voice setup. Stays **P2**. |
| R3-04 | P3 | **Fixed** | `r4-session` R3-04 runs the real `finish()`. With latency 80/150/250 ms, Finish just after note 3 now scores only fully-arrived notes, all perfect (was ok/miss). The trim is conservative: at 80 ms the note that ended 10 ms before Finish is left out, not graded. |
| R3-05 | P3 | **Fixed** | `level=abc`, `1`, empty or `-3` give **L2 Arcade**; `9` gives L4 (`r4-browser url`). |
| R3-06 | P3 | **Fixed** | Setup shows `role=alert` messages: "The concert is before the rehearsal: check the dates." and "That date is in the past." Today and valid dates show no alert (`shots-r4/r4-setup-dates-warn.png`). There is a small timezone gap: R4-03. |
| R3-07 | P3 | **Fixed** | An unnamed singer shows as "You" on Ranks. Share stays disabled until a name is saved. |
| R3-08 | P3 | **Partially fixed** | In landscape the howto is hidden (`display:none`) and the overlay can scroll. The Start button is at y 251–299 of 390 (`r4-land-ready.png`). Still: the "Soprano" mixer chip is clipped to "Sopran" and "Alto · you" wraps to two lines (`r4-land-running.png`). New side effect: R4-02. |
| R3-09 | P3 | **Not fixed** | `migrateIds()` still only checks `sh:cycle` for removed pieces. Progress-only Bach users get no notice. |
| R3-10 | P3 | **Fixed** | The copy now reads "…the bar fills with blue when you're on the note." |

### Code review (CR-xx)

| ID | Pri | Status | Evidence |
|---|---|---|---|
| CR-01 | P1 | **Fixed** | `start()` checks `disposed` after every await. Play.tsx has a `startingRef` double-tap guard. `r3cr-session-race`: `playedAfterDispose:0, onDoneCalls:0`. `r4-session`: dispose during the end tail → onDone not called. |
| CR-02 | P1 | **Fixed (main path); P2 residual** | `PitchTracker.alive`, and `getTracker()` reopens a dead tracker. `r3cr-tracker-ended`: `same:false, gumCalls:2, readingsDelivered:1`. **Residual:** if the mic dies *during* a run, the session doesn't notice. There is no pause and no "mic disconnected" message, so the rest of that run silently scores as misses. The next Start recovers. Workaround: retry. **P2**. |
| CR-03 | P1 | **Fixed** | `beatSecAt` now uses `dur/durBeats`. `r3cr-timing` CR-03: warm-up "Upbeat–bar 6" count-in beat **0.833 s** (was 0.208). The entry-drill excerpt beat equals the quarter (0.833). |
| CR-04 | P2 | **Fixed** | `resumeToken`. `r4-session` CR-04: Pause tapped while `resume()` awaits `unlockAudio` → 0 plays, phase stays `paused`. |
| CR-05 | P2 | **Fixed** | `Play.tsx` converts to real ms: `med/rate`, and the shift is `×rate`. The `r3cr-timing` failure comes from its inline copy of the old formula. |
| CR-06 | P2 | **Fixed** | Null-prototype DB plus `RESERVED` codes. `r3cr-server`: PUT `__proto__`/`constructor` → **404**. |
| CR-07 | P2 | **Partially fixed** | The rate-limit IP is the last X-Forwarded-For hop, and only with `TRUST_PROXY=1` (set in `render.yaml`). `r3cr-server`: rotating XFF no longer gets a fresh budget. Still synchronous `writeFileSync` (debounce 2 s) and no global write or total-entries cap. Residual **P2** (server abuse). |
| CR-08 | P2 | **Partially fixed** | `loadAll` guards `sh:cycleSeeded`, and `r3cr-storage-blocked` passes (no rejection). **But** with `localStorage`/`sessionStorage` throwing (`r4-browser blocked`): Home renders; every in-app navigation throws in the `hashchange` handler (`router.ts:80`, unguarded `sessionStorage.setItem`), so the app is stuck on Home; and a direct load of a Play URL renders a **blank screen** (PlayScreen crash at `Play.tsx:67`). Only affects browsers with site data blocked. Stays **P2**. |
| CR-09 | P2 | **Fixed** | `r3cr-ranks-loop`: 0 writes/s (was ~1,100). |
| CR-10 | P2 | **Fixed** | A tail wait of `min(700, latency+120)` ms after the player ends. `lastMap` keeps late samples mapped. `r4-session` CR-10, 250 ms latency: late samples are accepted during the tail, and the final note is **perfect** (hit 1.0). `r3cr-timing` still fails only because it models the old cut. |
| CR-11 | P2 | **Fixed** | `saveImportedScore` returns `persisted`. Library shows "…but this browser won't keep it after a reload…". |
| CR-12 | P2 | **Not fixed** | Section ids are still `s{i}-m{a}-{b}`. There is no migration and no frozen-id test. |
| CR-13 | P3 | **Fixed** | Flag written in an effect. Clean first load shows the card at 390×844, hidden after reload (`r4-howto-390x844.png`). (The old probe is flawed, see above.) |
| CR-14 | P3 | **Fixed** | `Tuner` `mountedRef` check after `getTracker()`, and unsubscribe on unmount. |
| CR-15 | P3 | **Partially fixed** | Unnamed singers no longer post (`profile.name` required before `put`). There is still no ownership on the server. |
| CR-16 | P3 | **Not fixed** | `clipNote` is unchanged. |
| CR-17 | P3 | **Not fixed** | No update prompt or `registration.update()`. |
| CR-18 | P3 | **Not fixed** | Backup still leaves out imported scores. |

### Acceptance (R3A-xx)

| ID | Pri | Status | Evidence |
|---|---|---|---|
| R3A-01 | P2 | **Fixed** | Setup step 1 has a "Pieces your choir is singing this cycle" chip picker (44 px, aria-pressed, no horizontal scroll). Deselecting updates `sh:cycle.pieceIds`. Setting dates renames "Demo cycle" to "This cycle" in Setup and Settings. Users who skip setup still pace across all 4 demo pieces, which is acceptable. |
| R3A-02 | P2 | **Fixed** | Home "Next up" follows the most recently practised piece: after one Debussy run it shows "Dieu!… Start Bars 6–13". "Also today" lists the warm-up and Nicolette (`r4-home-plan.png`). |
| R3A-03 | P2 | **Partially fixed (P3 residual)** | Drill Results now has "**Back to Dieu! qu'il la fait bon regarder!**" (→ `#/piece/debussy-dieu`) instead of the bogus "Next". The entry count is consistent: the piece screen says 4, and the drill has b.1, b.6, b.14, b.27. Still: "99% accuracy across bars b.1–b.27" and the coach note "Move on to the next level or the next section" (`r4-entries-result.png`). **P3.** |
| R3A-04 | P2 | **Fixed (P3 residual)** | "Share my progress (all pieces)" shares 4 codes plus a summary. Pasting them in a second context shows Clara 6% on the Debussy board and the A column in the choir overview (`r4-ranks-b-debussy.png`). The dropdown still defaults to the first piece, not the most recent one. **P3.** |
| R3A-05 | P2 | **Fixed** | After a section listen: "Now learn it: level 1" (→ `?level=1`) plus "Listen again" (`r4-listen-done.png`). |
| R3A-06 | P3 | Not fixed | No review nudge for stale L1–L2 sections. |
| R3A-07 | P3 | Not fixed | Nothing prompts for the next rehearsal once it has passed. |
| R3A-08 | P3 | Not fixed | Flat singing at L1 still gets an "A". |
| R3A-09 | P3 | Not re-verified | Copy for title and body bar ranges unchanged in the code path. |
| R3A-10 | P3 | Not fixed | "Pour les gran biens" is still on the piece screen. |
| R3A-11 | P3 | Not fixed | "Guten Morgen". |
| R3A-12 | P3 | **Fixed** | The combo label is `white-space: nowrap`. |
| R3A-13 | P3 | Not fixed | The Settings preview still uses D major. |

Earlier-round items that were still open after round 3 (R2X, F, UX, A series) were not changed by these commits. Their round-3 status carries over, except A1 (above, under R3-03) and R2-02/F5. For R2-02/F5, the partial-finish trimming is now correct (R3-04), but the partial Results page still says "Excellent run… Move on" and "bars 0–1" for "Upbeat–bar 6" (`r4-partial-result.png`).

## 2. Regression sweep and new findings

Checked with no defect found:
- **Scoring:** onset acceptance within a semitone for repeated pitches, and dropout tolerance (above). The octave singer, JI and the round-2 regressions are unchanged (`r3-scoring` all match round 3).
- **Session:** the dispose guards, resume token and tail timer cleared on dispose/finish.
- **Player:** `lastMap` and `beatSecAt` (pickup bar and excerpt).
- **Router:** arcade clamp.
- **Screens:** Home plan, Setup picker and warnings, Ranks share-all and "You", drill "Back to…", Listen → learn, entry count. The e2e suite and a full landscape run finish with Results. No page errors in any `r4-browser` section except `blocked`.

| ID | Priority | Type | Title | Evidence | Suggested fix |
|---|---|---|---|---|---|
| R4-01 | **P2** | bug (from `232b934`; missed in R3) | Short syllables that start with a consonant get no onset at full tempo, so Rhythm reads low for correct singing | `r4-consonant`: Debussy bars 1–5, perfectly timed, each syllable voiced after a consonant gap. Alto: **88% (60 ms) / 63% (80 ms)**. Tenor: 85% / 56%. The pre-`232b934` scoring gives 100%. The affected notes are all 0.17 s eighths. The 60 ms run must fit between voicing and `bodyEnd` (`start + dur − 0.034`), which leaves about 50 ms. The warm-up and Bruckner (longer notes) are unaffected. Only the Rhythm stat is affected. Pass/level uses accuracy, and the late-entry insight ignores null onsets. | Measure the onset run up to `note.end` rather than `bodyEnd`. Or use `min(ONSET_RUN, 0.25·dur)`, or fall back to the first voiced sample when the note is too short for a full run. |
| R4-02 | P3 | UX (`9b13580`) | A first practice run in landscape hides the howto but still marks it as seen | `r4-browser howto` at 844×390: howto `visible:false`, `sh:seenHowto=1`. The singer never sees it, even in portrait. | Write the flag only when the card is actually visible (`matchMedia`), or show a compact version in landscape. |
| R4-03 | P3 | bug (`9b13580`) | The Setup "in the past" check uses the UTC date | `Setup.tsx`: `new Date().toISOString().slice(0,10)`. West of UTC in the evening, today's rehearsal is flagged "in the past". East of UTC just after midnight, yesterday is not flagged. (Code inspection; the test browser runs in UTC.) | Use a local `YYYY-MM-DD`, as in `daysUntil`. |
| R4-04 | P3 | edge case (`7e69e6b`) | Pause or interruption during the ≤700 ms end tail | `r4-session`: pause after the player ended → the tail timer still fires and `finish()` runs from `paused`. Results open behind the overlay; the result is full and correct. If the singer also taps Resume inside the tail, `play(to)` sets `countin` and the timer then finishes with `phase==='countin'`, so a complete run is marked "stopped early" (practice run, no level). The window is very narrow. | In `pause()`, if `endTimer` is pending, call `finish()` immediately (the run is over). |

## Open items by priority (round-3 lists plus new)

- **P0:** none.
- **P1:** none.
- **P2 (6 from the round-3 lists plus new):**
  - R3-03 / A1: latency learning misses the warm-up and absorbs genuine lateness.
  - CR-02 residual: mic loss mid-run.
  - CR-07 residual: no global server write cap; sync writes.
  - CR-08 residual: blocked storage leaves the app stuck on Home, and Play is blank.
  - CR-12: section-id migration.
  - **R4-01**: short consonant syllables lose onsets.
  - Carried over and unchanged: R2X-03 (200% zoom overflow) and the other R2X/UX/A P2s from round 3, which are not re-listed here.
- **P3 (from the R3 lists plus new):**
  - Round 3: R3-08 (residual), R3-09, CR-15 (residual), CR-16, CR-17, CR-18, R3A-03 (residual), R3A-04 (residual), R3A-06, R3A-07, R3A-08, R3A-10, R3A-11, R3A-13.
  - New: R4-02, R4-03, R4-04.
  - Total: **17**.
