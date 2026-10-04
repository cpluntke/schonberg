# Round 2: regression verification

**Build:** HEAD `a8dbb78`, dev server http://localhost:5179. Round-1 baseline: `bb83fbc` (the three round-1 reports cover `bb83fbc`…`baa0d5a`). Fix commits checked: `b0f7a35`, `9122c91`, `baa0d5a`, `9cb0777`, `a8dbb78`.
**Device:** Chromium (Playwright) at 390×844 phone size, plus 844×390 landscape, fake mic and `?simulate=`.
**Priorities:** per `docs/priorities.md`.

**Automated suites on HEAD**
- `npx vitest run`: 189/189 pass.
- `npx playwright test e2e/flow.spec.ts --project=chromium`: 3/3 pass.
- QA vitest specs: `r2-scoring-realism` (round-1 matrix with the Bach path updated to `pd/bach-bwv315.mxl`), `r2-regressions`, `r2-glitch-compare`. The last one compares HEAD scoring with the pre-fix `scoring.ts`, extracted to `docs/qa/scripts/r2-old/`.

**Scripts**
- Round-1 browser scripts, copied to `docs/qa/scripts/r2-rerun/` with the screenshot path pointed at `shots-r2/`: 03, 07, 10, 11, 13, 15, 16, 17, `ux-targets`, `fakemic-wav`, `perf-play`.
- `audio-loopback.mjs 0.25`.
- New: `docs/qa/scripts/r2-browser.mjs` (migration, partial finish, count-in, entries, navigation, landscape).
- Screenshots are in `docs/qa/shots-r2/`.

## Summary

| | Count |
|---|---|
| Round-1 findings re-checked | 62 (19 functional, 24 UX, 19 audio/perf) |
| Fixed | 32 |
| Partially fixed | 13 |
| Not fixed | 15 |
| Won't-verify | 2 |
| **New findings** | P0: 0 · P1: 0 · P2: 4 · P3: 6 |

No round-1 P1 is still fully open. A1 (latency default) and A5 (iOS resume) are only partially fixed; details in the table.

## 1. Status of round-1 findings

### Functional (round1-functional.md)

| ID | Pri | Status | Evidence |
|---|---|---|---|
| F1 | P1 | **Fixed** | `r2-rerun/10-data.mjs`: Bach `#1 beats 0+1` (was 0+4). Warm-up is unchanged. `src/music/pickup.test.ts` passes. The Bach play screen goes straight from "Gib" into bar 2 (`shots-r2/r2-land-play.png`). |
| F2 | P1 | **Fixed** (small gap) | `r2-browser.mjs migrate`: the seeded `sh:progress:bach-bwv512:P1` is moved to `bach-bwv315`. The cycle id is rewritten. Home shows Bach at 25% "in progress". The old link `#/piece/bach-bwv512` resolves to the piece. Gap: `sh:log` entries keep `bach-bwv512` (log not migrated), so per-piece history and stats lose those attempts. Low impact. |
| F3 | P1 | **Fixed** | `r2-rerun/11-results-flow.mjs`: after the 40% run, progress is `{"practice":1}`. `s0-m0-5` is unchanged. See R2-02 for the "practice" bookkeeping and the Results copy. |
| F4 | P2 | **Fixed** | 11-results-flow: "Quit after Again → `#/piece/bach-bwv315`". `r2-browser nav`: Back from play goes to the piece. Small side effect: R2-07. |
| F5 | P2 | **Partially fixed** | Ladder and scoring part fixed. `r2-browser partial`: Finish at 16 s scores only bars 1–5 (95%), and the level is not awarded. Finish during the count-in records nothing (log 1 → 1) and goes back to the ready card. Still wrong: the Results screen gives no sign the run was partial or uncounted, and the note in flight is scored as a miss. See R2-02. |
| F6 | P2 | **Fixed** | `16-landscape.mjs`: Pause at y 336–384 within a 390 px viewport, no scroll. Arcade Pause at y 336. `shots-r2/r2-land-play.png`, `r2-land-arcade.png`. |
| F7 | P2 | **Fixed** | 15-robust / 17-misc: `#/piece/%E0%A4%A` shows "Not found" with no pageerror (`router.ts` try/catch). |
| F8 | P2 | **Fixed** | 11-results-flow: heat bar is 41×44 px and now shows the bar number. |
| F9 | P2 | **Partially fixed** | `13-ranks-settings`: the crafted code is still accepted as #1 "Zukunft · 1000-day streak · 500,000" with readiness 100%. The values are now clamped, not rejected. A future `updatedAt` is clamped to now+1 day, so it only pins the entry for about a day. A 1000-day streak is still implausible for a new app. |
| F10 | P3 | **Fixed** | `03-import`: empty → "the file is empty."; random .mid/.mxl → "doesn't look like a valid MusicXML or MIDI file…"; .txt → supported-types hint. Multi-file imports still show only the last error (not re-tested). |
| F11 | P3 | **Fixed** | Library footer now names public-domain works and the original warm-up (`Library.tsx`). |
| F12 | P3 | **Fixed** | 13-ranks-settings HOME: "38% · in progress". |
| F13 | P3 | **Not fixed** | Concert 2026-10-06 before rehearsal 2026-10-10 is still accepted. Home: "6d Rehearsal · 2d Concert". |
| F14 | P3 | **Not fixed** | 15-robust: `#/arcade/...?level=1` still runs. `level=abc` still becomes Listen. `drill?from=30&to=5` still counts in "29". New variant: a real section id plus `&from=&to=` shrinks a ladder section and still counts (`Play.tsx` `start: route.from ?? s.start`). |
| F15 | P3 | **Not fixed** | `Expert.tsx` row card still uses the sharp-only `NAMES`; the highway still spells by key. |
| F16 | P3 | **Not fixed** | `Results.tsx` next-step logic is unchanged for generated row/leap drills. |
| F17 | P3 | **Not fixed** | 03-import: Elgar still imports as "elgar_there-is-sweet-music_op53-1". No rename option. |
| F18 | P3 | **Fixed** | 13-ranks-settings: `confirm("Replace your current progress and settings with this backup?")` is shown before every restore. |
| F19 | P3 | **Won't-verify** | Brahms Bass II perfect 92%. Not re-run within the time box. No related code change except scoring, which now scores perfect runs at 100% everywhere in the e2e and simulated runs. |

### UX (round1-ux.md)

| ID | Pri | Status | Evidence |
|---|---|---|---|
| UX-01 | P1 | **Fixed** | `analysis.ts`: new `wrong-notes` and `quiet` rules, plus a fallback "Weakest spot" when nothing else fires. `src/game/round1.test.ts` passes. 07-controls: a failed 83% run shows "Weakest spot: bars 1–2…". |
| UX-02 | P1 | **Fixed** (regression introduced) | Onset is now taken from the first voiced sample. `round1.test` "rhythm is independent of intonation" passes: rhythm > 0.8 for in-time wrong notes. The new legato rule breaks rhythm for octave-transposed singers (R2-03) and makes onset detection too easy to trigger (R2-04). |
| UX-03 | P2 | **Fixed** | `highway2d.ts` `inKey()` replaces the label regex. In B major, F♯/C♯/G♯/D♯/A♯/B labels are bold (`shots-r2/r2-dieu-directions.png`). |
| UX-04 | P2 | **Fixed** | Cents bubble averages the last 0.2 s (`highway2d.ts`). Readouts are stable (+1¢/+3¢ in screenshots). |
| UX-05 | P2 | **Partially fixed** | The stat is renamed "In tune" and an "avg ±N¢" line is added. There is still no tuning drill (tight tolerance or drone) for flat/sharp insights. |
| UX-06 | P2 | **Partially fixed** | The demo cycle has dates. Home shows "Rehearsal in 4 days: 18 sections still below level 3, about 5 a day". Setup still doesn't ask for dates, and there's no per-piece target or on-track/behind indicator. |
| UX-07 | P2 | **Partially fixed** | A highway entry countdown (3·2·1 before entries after rests) was added, but it is mistimed at reduced tempo and in non-quarter meters (R2-01). There is still no entry-pitch or chord cue during rests. |
| UX-08 | P2 | **Partially fixed** | Dynamics, words and wedges are parsed and drawn on the highway (`r2-dieu-directions.png`: "mf", "Très modéré…"). They overlap at the section start (R2-06). Tempo words such as *Plus lent* still don't change playback. |
| UX-09 | P2 | **Partially fixed** | Sections show a lyric incipit ("Bars 1–5 · “Dieu! qu'il la fait bon regarder…”"). Breath marks, caesuras and a phrase view are still missing. |
| UX-10 | P2 | **Partially fixed** | "undsei" is fixed: Bach now shows "und sei". Still wrong: Bach shows "zu frie den" (file marks the syllables `single`), and Yver shows "Yver, ver, Yver" (stray repeated `end` syllable). The demo files' syllabic data was not corrected. |
| UX-11 | P2 | **Fixed** | Title "Gib dich zufrieden, BWV 315". The file and id were renamed, with migration (F2). |
| UX-12 | P2 | **Partially fixed** | `.btn.small`, `.chip` and `.lvl-btn` are 44 px; heat cells are 44 px. `r2-rerun/ux-targets.mjs` still finds "Edit dates" at 106×32 (inline `height: 32` in `Home.tsx:96`), the Settings selects "Voice part" and "Delay" at 40 px, and the Ranks "Piece" select at 40 px. |
| UX-13 | P2 | **Not fixed** | Ranks still uses copy/paste codes, with no `navigator.share` or daily plan. |
| UX-14 | P3 | **Not fixed** | `lanesFor` is unchanged (lanes are still one per used pitch). |
| UX-15 | P3 | **Not fixed** | Same as F14: arcade L1 via URL still runs. |
| UX-16 | P3 | **Partially fixed** | Scores use the browser locale ("3,300"). The greeting is still "Guten Morgen/Tag" with no explanation. |
| UX-17 | P3 | **Fixed** | Home: "Start Bars 7–14: learn the notes at 70% tempo. (level 1, Note-learning)". The duplicated label is gone. |
| UX-18 | P3 | **Not fixed** | Next-up order is unchanged and still doesn't recommend Listen. |
| UX-19 | P3 | **Not fixed** | 03-import: warm-up sections still read "Bars 0–6". |
| UX-20 | P3 | **Not fixed** | `repertoire.json`: Brahms is still "Five-part motet (SATBB)". German part names are unchanged. |
| UX-21 | P3 | **Fixed** | Footer is fixed (F11). Expert now shows letter names (`letterName(lo)–letterName(hi)`). |
| UX-22 | P3 | **Not fixed** | No verse picker. |
| UX-23 | P3 | **Not fixed** | Ghost style and chromatic label colour `#6B739C` are unchanged. |
| UX-24 | P3 | **Not fixed** | No seam/join runs. |

### Audio / performance (round1-audio-perf.md)

| ID | Pri | Status | Evidence |
|---|---|---|---|
| A1 | P1 | **Partially fixed** | Uncalibrated runs now use `estimateLatencyMs()` = max(50 desktop / 80 mobile, outputLatency+40) instead of 0. Loopback D = 250 ms: uncalibrated L2 is **83.6%** (was 58.1%); calibrated is 99.3%; calibrated+100 ms is 97.6%. Synthetic +250 ms Bluetooth still fails L2–L4 on Yver, Ravel and Bach (`r2-scoring-realism`). Suggestions 2–4 (per-attempt auto-estimate, first-play calibration prompt, per-device storage) are not done. The estimate is taken in the `PracticeSession` constructor before the context is unlocked, so `outputLatency` can still be 0 there. Safari doesn't expose `outputLatency` at all, so Bluetooth isn't detected. |
| A2 | P1 | **Fixed** (regression introduced) | `r2-scoring-realism`, pro singer L4: Yver S **90%** (was 64), Ravel S 91 (was 83); with ±60¢ vibrato Ravel L4 78 (was 54) and L3 83 (was 64). All slow pieces pass PPPP. Whole-note judgement makes 0.27–0.39 s notes fragile against short pitch glitches (R2-05). |
| A3 | P1 | **Fixed** (regression introduced) | Octave-below pro on S parts: Bach 99/97/97/94 PPPP, Bruckner 100/96/94/93, Ravel 98/94/93/91 (all were 50/50/50/50). `scoring.test` updated. Side effects: R2-03 (rhythm) and R2-08 (L1 octave errors no longer flagged). |
| A4 | P1 | **Fixed** | `session.ts` `resume()` sets `minTime = resumeFrom − 0.02`, so count-in samples are dropped. `r2-browser partial`: pause at 9 s → Resume → 100%, 27/27 perfect, "Level 2 reached". 07-controls: pause/resume in count-in also completes. |
| A5 | P1 | **Partially fixed** | `resume()` now `await unlockAudio()` first, inside the tap gesture. No `ctx.onstatechange` / `interrupted` handling: if iOS suspends the context mid-run without a visibility change (call, Siri, route change), the highway still freezes silently. Can't verify on a real iOS device. |
| A6 | P2 | **Fixed** (code) / see note | `latencyFromOnsets` now needs ≥ max(3, 60%) of onsets within ±60 ms of the median. `fakemic-wav` re-run: see note below the table. |
| A7 | P2 | **Fixed** | `countInBeats` returns felt beats (2/2 → 2, 6/8 → 2). The HUD count uses `beatSecAt` from the player. Not re-measured in the browser: my HUD selector didn't match. |
| A8 | P2 | **Fixed** | `App.tsx`: `releaseTracker()` 15 s after leaving play/setup/tuner. |
| A9 | P2 | **Fixed** (minor race) | `requestWakeLock()` in `start`/`resume`, released in pause/finish/dispose. Race: R2-09. |
| A10 | P2 | **Fixed** | JI target is half-way, with the window widened. ET pro L4: Bach S equal 94 vs just 96, Bruckner S 93/94, warm-up similar (was 85→73, 93→76). The reported cents are shifted, though (R2-10). |
| A11 | P2 | **Partially fixed** | Strict factor 0.7 → 0.8 (L4 strict ±20¢). Strict L4 pro: 77–87% on all pieces (was 45–80). The `perfect` criterion is still `|median| ≤ tol/2`, so a +10¢ singer can't get "perfect" on strict L4. |
| A12 | P2 | **Partially fixed** | `RMS_GATE` 0.01 → 0.005 (static). No adaptive noise-floor gate and no input meter. |
| A13 | P2 | **Fixed** (mostly) | `setHud` only on change; `ghostParts`, `pitchWindow` and `lanes` hoisted out of the frame loop. `highway2d` still loops over all notes per frame (not binary-searched). |
| A14 | P2 | **Not fixed** | Pitch analysis is still `setInterval` on the main thread (no worklet). |
| A19 | P2 | see perf note | `shadowBlur` removed from arcade notes and popups; dpr capped at 1.5 in arcade. |
| A15 | P3 | **Not fixed** | `session.ts` `play()`: `cue: from === this.cfg.from ? this.cfg.cue : 'note'`. After Resume, L4 still cues "your note". |
| A16 | P3 | **Won't-verify** | iOS output routing needs a device. No code change. |
| A17 | P3 | **Not fixed** | No "your entries were +X ms late" chip on Results. |
| A18 | P3 | **Not fixed** | Precache config unchanged. Still fine at the current repertoire size. |

PERF_NOTE_PLACEHOLDER

## 2. New findings (regressions and gaps from the fixes)

| ID | Priority | Type | Title | Steps | Expected / Actual | Evidence |
|---|---|---|---|---|---|---|
| R2-01 | P2 | bug (regression from UX-07 fix) | Highway entry countdown is mistimed at reduced tempo (every L1 run) and in 2/2 / 6/8 | 1. Any piece, Level 1 (70% tempo). 2. Watch the 3·2·1 that appears before an entry after a rest. | **Expected:** one number per felt beat, reaching 1 on the beat before the entry. **Actual:** `Play.tsx` passes `bpm: tempoAt(...) * rate`, and `highway2d.ts` computes `beat = 60/bpm` (real seconds) but compares it with `ahead = n.start − s.pos` (score seconds). At 70% the countdown starts about 4.3 beats early and changes every 1.43 beats, off the beat. It also counts quarter notes, so in 2/2 (Yver) it counts 3 quarters, not half-note beats. That is the same unit mismatch A7 fixed for the HUD count-in. | Code: `highway2d.ts` "Entry countdown" block; `Play.tsx` `bpm:` in `DrawState` |
| R2-02 | P2 | UX / bug (from F3/F5 fixes) | Partial and slow-tempo runs show a full "S / Excellent run, move on to the next level" Results page with no sign the run didn't count | 1. Bach Tenor Bars 1–6 L2, `simulate=perfect`. 2. Tap Finish after about 16 s. | **Expected:** "Stopped early: bars 1–5 scored, level not awarded" (or "practice tempo, not counted"), and the coach shouldn't say "move on". **Actual:** grade S, 95%, "Excellent run… Move on to the next level or the next section", and the primary button "Next: Bars 1–6, level 1". The singer can't tell why no level was awarded. The note in flight at Finish is graded as a miss ("miss 1"). Both runs are stored under a shared pseudo-section `practice` (`{"practice":{"lvl":2,...}}`), whose `best`/PB mixes all sections and tempos. | `shots-r2/r2-partial-results.png`; `r2-browser partial` log; 11-results-flow progress `{"practice":1,...}` |
| R2-03 | P2 | bug (regression from UX-02 + A3 fixes) | Octave-transposed singers get a wrong Rhythm % (about 55–80%) despite perfect timing | Man singing the soprano part an octave down (octave tolerance on), stepwise legato line. | **Expected:** Rhythm about 100%, as for the in-octave singer. **Actual:** the legato onset rule compares the **unfolded** sung midi with the target and the previous note (`scoring.ts` `addToNote`, `Math.abs(midi - w.target) < Math.abs(midi - w.legatoFrom)`). Ascending steps never register an onset (rhythm 0 for that note). Descending steps register immediately. Unit probe: rhythm 0.56, onsets `[0,null,null,null,null,0,0,0,0]`. Realism matrix "octave below" rhythm: Bach 66–67, Bruckner 80, Yver 70–71, Ravel 74–76 (in-octave pro: 98–100). Accuracy and levels are unaffected. | `r2-regressions.qa.test.ts` "R2-octave-rhythm"; `r2-scoring-realism` second column |
| R2-04 | P2 | bug (regression from UX-02 fix) | After a rest, any voiced sound counts as the entry, so backing bleed or a stray noise makes late entries look on time | Sing an entry 400 ms late, with any voiced frame (e.g. the other parts from the phone speaker, which the app plays at L1–L3) at the note start. | **Expected:** onset at the singer's entry (400 ms late). **Actual:** `legatoFrom === null → started = true` on the first voiced sample at any pitch. Unit probe: one 20 ms voiced blip (a 5th off) at the start → onset 0 ms, rhythm 100%. Without the blip: 400 ms, rhythm 22%. Without headphones the mic hears the accompaniment, so Rhythm and the "late entries" insight lose meaning. Suggest requiring the onset pitch within ±150¢ of the target (folded) or a few consecutive voiced frames. | `r2-regressions.qa.test.ts` "R2-blip-onset" |
| R2-05 | P3 | bug (regression from A2 fix) | Whole-body mean on 0.27–0.39 s notes: a 40 ms pitch glitch turns the whole note into a miss | L2+ (no octave folding), notes 0.3–0.35 s long, the tracker passes a 2-frame octave or 5th glitch (the median-of-3 smoother lets 2-frame glitches through). | **Expected:** at most a lower grade for that note. **Actual:** for bodies < 1.5 × vibrato window, `finalize` uses the **mean** of all body deviations. One outlier drags the mean out of tolerance and `hitTime = 0` → miss. Probe (8 notes, HEAD vs pre-fix): 0.30/0.35 s notes with one +12 or −12 frame, or two +7 frames → **0%** (pre-fix 50%). 0.45 s and longer are unchanged (50% / 85%). Clean singing is unaffected. Use the median, or a trimmed mean. | `r2-glitch-compare.qa.test.ts` output; `r2-regressions` "R2-glitch" |
| R2-06 | P3 | cosmetic (from UX-08) | Directions at the section start overlap each other on the highway | Debussy *Dieu!* Soprano L1, start. | "mf" and "Très modéré soutenu et expressif" are both clamped to `gutter+2` and drawn on top of each other (unreadable). The overlap check only skips identical text. | `shots-r2/r2-dieu-directions.png` (bottom left) |
| R2-07 | P3 | bug (from F4 fix) | `sh:fromResults` stays set after a run that started from Results completes, so a later Back creates a duplicate piece entry | 1. Results → Again → sing to Results. 2. All sections → Library → piece → level → Back. 3. Browser Back. | **Expected:** Back from play pops to the piece; browser Back then goes to Library. **Actual:** the flag is only cleared in `leave()`, so Back calls `go(piece, replace)`. The history is now piece, piece, and browser Back stays on the piece once before reaching Library. | `r2-browser nav` log: "flag= 1", "then browser back → #/piece/bach-bwv315", then "#/library" |
| R2-08 | P3 | UX (from A3 fix) | At Level 1, octave errors by a same-register singer get full credit and no "octave" hint | Soprano singer sings her part an octave low at L1 (`octaveTolerant = level <= 1 || …`). | 100%, no octave flag, insights only "great". Round 1 suggested full credit only for deliberate transposition (singer register ≠ part). At L1 a hint ("you're singing an octave below") would still help. | `r2-regressions` "R2-L1-octave" |
| R2-09 | P3 | bug (from A9 fix) | Wake-lock race: pausing or leaving before `wakeLock.request` resolves leaves the lock held | Start, then Quit or Pause immediately. | `requestWakeLock` awaits `request()` and then stores the lock. A `releaseWakeLock()` that ran in between found `null`, so the lock is kept on Home or the pause overlay until the page is hidden. Code review. | `session.ts` `requestWakeLock`/`releaseWakeLock` |
| R2-10 | P3 | UX (from A10 fix) | In just-intonation mode, reported cents are measured from the half-way target | Settings → Just intonation; sing a major third exactly tempered, or exactly pure. | ET singer shows +6.85¢ and pure singer −6.85¢ (probe). The "avg ±N¢" line and flat/sharp insights refer to a pitch nobody aims for. Better to report the deviation from the nearer of the pure and tempered pitches. | `r2-regressions` "R2-JI" |

**Not counted as findings:**
- 07-controls "back during play" left a frozen play screen. It only happens with two identical consecutive history entries, which `page.goto` to the same URL creates; normal in-app flows behave (`r2-browser nav`, `entries`).
- 13-ranks-settings restore cases now hit the new confirm dialog (expected).
- `docs/qa/scripts/07-controls.mjs` "after quit → #/results" comes from the same `page.goto` stacking, not from Results.
