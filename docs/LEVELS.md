# Levels: passages and the whole piece

Every piece is cut into short **passages** (in code: `Section`; in the app "section" now means the
voice group, S/A/T/B), and there are five levels (`src/progress/ladder.ts`). **Every level adds one
new thing**, and every level has **two steps: slow (70%), then in tempo (100%)**. You can't add the
words and go up to tempo in the same jump.

| Level | Name | What's new | Your part plays | Note names | Start | Tolerance | Pass |
|---|---|---|---|---|---|---|---|
| 1 | Notes | the notes, on “doo” | yes | yes | your note | ±50¢ | slow: every note right, with headphones on; in tempo: 80% and the entries on time |
| 2 | Words | the words (no “doo”) | yes | yes | your note | ±35¢ | 80% |
| 3 | Alone | your part muted, the others play | no | yes | your note | ±30¢ | 80% |
| 4 | Concert | no note names | no | no | chord only | ±25¢ | 85% |
| 5 | By heart | from memory (off-book fading) | no | hidden | chord only | ±25¢ | 85%; in tempo on two different days |

## The two steps: slow, then in tempo

- `ladder.stepSpec(level, step)` gives a step's rules: tempo (`SLOW_RATE` = 0.7, or 1), tolerance,
  pass mark, every-note rule, headphones, entries check, plus the level's guide, note names, cue and
  “doo”. Tolerance and pass mark are the same for both steps, except at Level 1 (below).
- **Passing in tempo at level L completes level L** (and ticks its slow step). A singer may always try
  in tempo straight away; the app suggests slow first when a level is new.
- Stored per passage (`SectionProgress`): `level` = the highest level passed **in tempo** (as before),
  and `slow` = the highest level whose slow step was passed, kept only while it is above `level`.
  A passage's **current step** (`ladder.currentStep`): the next level (level + 1, at most 5), slow until
  `slow` reaches it, then in tempo. `ladder.stepFor(sp, L)` is the default step for starting level L:
  in tempo once L (or its slow step) was passed, else slow.
- A counted pass at slow above the in-tempo level raises `slow` (a **step-up**: Results says
  “Level 2 · slow ✓” and offers **Now in tempo** next to the next step); a counted pass in tempo raises the level (a
  **level-up**). A slow pass never reviews a passage, never clears a fix list and never moves the
  piece level. `store.recordAttempt` returns both (`stepUp`, `prevSlow`/`newSlow`, `prevLevel`/`newLevel`)
  and the piece milestone (`reached`).
- The practise screen's route carries the step (`step=slow|tempo`); without it, Play uses the
  passage's step for that level. On the pre-run card a passage's step can be switched (Slow / In tempo).
  Whole-piece runs default to in tempo, drills keep what their level used to sing at (Level 1 slow),
  the arcade is always in tempo.
- **Practise slowly** below the step's tempo (the tempo slider, 40–100%) stays practice only.
- Best results (`best`, `bestScore`, personal bests) are kept for runs in tempo.
- Labels: “Level 2 · Words · slow” / “Level 2 · Words · in tempo” (`ladder.stepLabel`); never “Level 0”
  (listening is “Listen”).

### Level 1 in tempo: the entries on time

Level 1 in tempo is judged on 80% (no every-note rule, no headphones needed), and the **entries** must
come in on time (`ladder.entriesOnTime`): the first note of the run and every note after a rest of at
least `ENTRY_REST_SEC` (0.5 s, as `game/analysis.ts` defines entries) must each be sung (an onset), and
their mean onset must be at most `LATE_MS` (180 ms). Without a measured delay, the part of the delay
the line-up showed to be the device's is taken off first. Late entries fail the run (`entriesLate`,
like late timing at Level 2 and up); Results says “Not yet: come in on time” with how late or how many
entries weren't sung.

## Listening and singing slowly, at every level

Singers start from scratch but aren't held back (`src/progress/struggle.ts`):

- **First read-through.** A passage met for the first time at Level 1 (never sung or listened to)
  offers **Listen first** on its pre-run card; Start reads **Sing it now**, so a singer who knows it
  sings straight away. Listening is route level 0 with `after` (and `step`) in the route: when it ends,
  **Now sing it** returns to that level and step.
- **Always there.** In tempo, a passage's card offers **Sing it slow (70%)** (its slow step, which
  counts); at the slow step, **Slower (50%)** (practice). Whole-piece runs and drills offer **Practise
  slowly** (70%, practice). A run slower than its step is practice: it is scored and kept in the bar
  history but never moves anything; its Results put **Now at 70%/100%** first.
- **When it goes wrong.** Results of a missed counted run of a passage act on the diagnosis: when
  notes weren't right, the first button loops the worst bar slowly (**Loop bar 25 slowly (50%)** at a
  slow step, 70% in tempo; a practice loop that leads back to the passage step it came from:
  **Now sing bars 22–29 again**), also after misses in a row, since that loop is the slow practice. When
  the entries were late (Level 1 in tempo) it loops the bar of the first late entry in tempo. Listening
  and singing slower stay one tap away in the help card (not for a run whose notes were right but late,
  nor one through the phone's speaker). After `STUCK_AFTER` (2) misses in a row of the same passage at
  the same level and step (`failsInARow`, a pass ends the count) the card says so (“Tricky one”); a miss
  without notes to name puts its help first: Level 1 slow **Listen again, then sing it**; in tempo
  **Sing it slow (70%)**; other slow steps **Sing it slower (50%)**. “Easier” after a miss: in tempo →
  the same level slow; slow → the level below in tempo (for a run of the whole piece: the whole piece at
  the level below).

## Streak and cycle points

Home (Today, [TODAY.md](TODAY.md)) shows the **week** (days practised against the week goal; the practice
streak, consecutive days with any run, is still kept for sync and the leaderboard) and Your progress the **notes sung
right this cycle** (`src/progress/points.ts`): every sung run adds its notes graded right (practice
runs too). A choir's **cycles** have dates (Admin → Cycles: start date, optional end date, each with
its own programme). A cycle runs from its start date until its end date or until the next cycle (by
start) begins, whichever comes first: on any day the running cycle is the one with the latest start
up to that day, and only while it hasn't ended. If that one has ended, none runs: an earlier cycle
never comes back (a deleted cycle is as if it never was). Of two cycles starting the same day, the
one created later runs (each keeps its `createdAt`; editing a cycle doesn't move it).

Members get only the cycle running by their phone's date and the ones to come, never past ones (the
server sends the ones running yesterday and today in UTC, for time zones, and all later ones). When
the next one starts it replaces the programme and everyone's count starts again from 0. A phone
applies the programme again only when another cycle starts running or an admin changes the running
one (each cycle has its own `updatedAt`); changes to other cycles leave the singer's own tweaks
alone. Between cycles (one ended, the next not started) the choir's programme leaves Home, the "This
cycle" dates card goes, and a notice names the next cycle; the same after joining another choir that
is between cycles (the old choir's programme goes).

Admins see every cycle, past ones too, labelled Running now / Starts … / Over by the phone's date
(the members' rule), and can start, edit and delete them. Saving in the programme editor saves the
whole programme (what it leaves out, e.g. the concert, is cleared); a change of dates alone keeps the
rest. The library's "Put it in the programme" adds to the cycle being edited. Without a choir, the
singer's own cycle name decides (the starting "Demo cycle" and "This cycle" count as one).

Results show the run's notes right, the cycle total and the week ("3 days · goal 4 this week"). Both travel with the choir
account's copy (`ProgressSnapshot.pts`, `days`): another phone's practice days keep the streak, and
the larger count of the same cycle wins.

## Level 1 slow: the notes, on “doo”, every note right

Level 1 (both steps) is for learning the notes, so it is sung on **“doo”**: the pre-run card says so, a small
“on doo” tag sits by the words while you sing, and the words stay on screen, dimmed, for
orientation. The words come in at level 2. (Words-in-rhythm and the lyrics quiz are separate and
unchanged.) Nothing in the scoring uses the words: notes are judged on pitch and onset only, and
“doo” suits the pitch tracker well (a voiced, steady “u”; the short “d” before each note is a gap
the scorer already allows for, like any consonant).

**Level 1 slow counts only with headphones on** (`StepRules.headphones`, `ladder.speakerPractice`). The
pre-run card of a Level 1 slow passage asks **“Headphones on?”** (Yes / No, speaker), and
Start waits for an answer. The answer is kept in the profile (`Profile.headphones`) and pre-filled
next time, one tap to change. It belongs to the phone, like the headphone delay: it is not part of
the copy kept with a choir account (`sync.ts`). Without headphones the guide (your own part) plays
through the speaker into the mic, and the tracker can't hear every note reliably (in the realism
harness, honest singers on the phone speaker passed level 1 on “doo” in about a third of runs;
`docs/qa/realism-current.md`, section 8 and observation 15). So a Level 1 slow run without headphones is
**practice**: it is scored, kept in the bar history, and Results lists the notes that weren't right,
but it never ticks the slow step. Results says: “Practice: Level 1 slow counts with headphones on,
because through the speaker the app can’t hear every note reliably.” Level 1 in tempo and Levels 2–5
don't ask (in tempo the app no longer needs every note).

**Every note must be right** (`StepRules.everyNote`): a Level 1 slow attempt passes only when every note
is graded *good* or *perfect* (±50¢ at 70% tempo, the usual grades, see [SCORING.md](SCORING.md)).
One flat note fails it, and Results says which, words first (the pitch word scale,
`game/pitchwords.ts`: spot on ≤10 cents, a touch ≤25, a little ≤50, clearly beyond): “Not yet: one note to
fix. The raised B (B♯) in bar 25 was clearly flat (65 cents).” (big misses in words: “a wrong note
(about 2 semitones low)”, “sung an octave low”), and its first button loops that bar slowly (50%); that bar shows as “needs work” in the bar strip, and the grade letter shows at most a B.

- **Notes the app can't judge reliably are let off** (`ladder.noteVerdict`): a note below *good*
  is forgiven when the scorer flags it as unsure (`NoteResult.unsure`): a **very short note** (its
  judged part is under 0.15 s of score time, the notes the scorer already grades leniently because
  the voice rarely settles and the tracker gets only a few readings), or a written pitch **outside
  the tracker's range** (60–1400 Hz), or a note the tracker misread: a **low note (under 200 Hz)
  read partly or wholly an octave up** on “oo”, or a note with **a few subharmonic readings** (18–46
  semitones under it, where no voice sings), when the note is right once those readings are folded down
  or replaced (see [SCORING.md](SCORING.md); never an octave low). The end-of-run correction of
  readings an octave under a note (the phone speaker's subharmonics) needs more than half of the
  note at the right octave at Level 1 slow (30% elsewhere), so a note sung an octave low with a few
  right-octave readings (the tracker, or the guide in the mic) still fails; readings an octave and a
  fifth or two octaves under it are corrected at Level 1 slow only when 30% of the note was heard at the
  right pitch, so a bass singing F#2 for a C#4 fails. A note mostly lost to **microphone trouble**
  (`'mic'`: sung through, right wherever a pitch was heard, with the tracker's evidence of hum
  intermodulation or distortion on a quarter of it) is let off too, and Results says what to fix.
- **…unless it was clearly wrong** (`NoteResult.clearly`): **no sound at all** inside the note
  (“not sung”; for both kinds, so a note out of the tracker's range must still be sung), or a very
  short note graded *miss* whose own readings were enough to judge
  it (the same test the scorer uses for fast notes) with their median at least 1.5 tolerances off
  (75¢ at Level 1: a wrong note, not a wobble), however far off, except 18–46 semitones low (the
  tracker locking onto a fraction of the pitch, not a sung note) or an octave up on a note under
  200 Hz (the tracker's octave error on “oo”).
- The 75% pass mark stays only as a backstop, so a run can't pass on forgiven notes alone. It only
  matters when many notes are forgiven (good singers in the realism harness never reach it).
- A note tied over the end of a passage is judged on the part before the end, since playback and
  listening stop there (`ScoringContext.end`; before, such a last note always read as missed).
- Short passages get **no slack** at Level 1 slow (the “one weak note” rule below is for the other steps).

## Passage levels are practice steps

A passage level says "you can sing bars 9–16 at Level 2 in tempo". You can try any level and step of
any passage at any time; a pass in tempo raises the passage's level, a slow pass its slow step.
Passage levels show your practice, but **on their own they never make a piece ready**.

## The piece level: sing it all through, then fix what slipped

For every level N = 1…5 (`store.recordFullRun`, `store.recordAttempt`):

1. **Practise in passages** (above), as much or as little as you like.
2. **A counted full run at level N opens level N.** Only runs **in tempo** count for the piece: a
   slow run of the whole piece is practice (`fullRunCounts` says `'slow'`). Counted means:
   - the whole piece, in tempo, with the level's support, tolerance and pass mark;
   - **not stopped early and not paused** (after your first note; a pause in the count-in is fine);
   - at level 5 with everything hidden and no peek;
   - the timing was fine (a run that came in clearly late, with a measured delay, is “Not yet” on
     timing; at Level 1, entries late or not sung, see above).
   A run that was slow, stopped, paused, slower than 100%, or off book with bars showing or a peek
   is practice: it is scored and kept in the bar history, but it changes nothing. Arcade runs of the
   whole piece are just for fun and never count.
3. **Every passage is scored within the run** (the same measure as the run's accuracy: the average
   grade of its notes). A passage **held** when it reaches the level's pass mark within the run.
   Passages with fewer than 8 notes get one weak note of slack (it counts as “good”), so a single
   “ok” note can't fail a level; a missed note is never forgiven, and a passage under 50% never
   holds. (Full runs are in tempo, so the every-note rule of Level 1 slow never applies to them.)
   Passages that held are credited as passes in tempo at that level (so an experienced singer who
   sings it all at Level 3 straight away also has every passage at 3). Passages that slipped are
   **“to fix at Level N”**.
4. **The piece reaches level N as soon as every passage that slipped in that run has passed level N
   in tempo on its own** (or above; a slow pass doesn't fix). No second full run: the last fix grants
   the level, and Results says “Fixed! The whole piece reached Level N · …”. If nothing slipped, the piece reaches
   level N at once.
5. **Too much slipped: practice.** A run opens the level only when **at most half of the passages
   slipped** and **its overall accuracy came within 10 points of the level's pass mark**
   (`ladder.runOpensLevel`, `OPEN_MARGIN`: levels 1–3 from 70%, levels 4–5 from 75%). Two of four slipping opens, three of four doesn't; one of three opens, two of three don't;
   two of four not sung at all (about 48%) doesn't. Otherwise it's practice: nothing is credited and
   no fix list changes, and Results says “Too much slipped for this run to count. Practise the
   passages, then sing it all again.” This keeps the full run a real test of the piece, not a
   formality that turns the whole piece into a list of passages. (The 10-point floor is the earlier
   rules' own “nearly held” test; the earlier check of section levels before the run is gone.)

### The clean-run star

A counted full run at level N in which **every passage held** (and the run passed overall) is a
**clean run**: the piece reaches N at once and earns a ★ for that level (`FullRunProgress.clean`,
the levels with a star). Getting everything right in one go is hard, so it's a bonus, not a
requirement. The star shows on the piece screen (“★ Clean run at Level 1, 2: every passage right
in one go”, and on that level's “Sing it all” button), on Results (“Clean run! Every passage right
in one go ★”), and on the leaderboard entry (`LeaderboardEntry.clean`, the highest level with a
star, shown as “★ clean run at level N”). The star is not part of readiness. The leaderboard
server keeps only fields its validator knows, so until it accepts `clean` the star shows only for
entries shared by code; the app works either way.

### Running it again: the new run replaces the fix list

The full run is open at any time, at any level, fix list or not. A new counted run at N that opens
the level **replaces** the fix list at N with its own slips: a passage fixed since the last run
stays off the list only if it held again in the new run, and a passage still on the old list comes
off if it held now. Fair both ways: the list always says what the latest real run of the whole
piece showed. A run where too much slipped (practice) leaves the list as it was. Passages that
held also come off the fix lists of lower levels (that can finish a lower level). Reaching a level
settles the lists below it.

### Slips at or below the piece level

The piece level is never lowered. A run at or below it (a weekly review, or a lower level for fun)
that opens with slips makes a fix list too: Next up says “Fix Bars 9–16 at Level 3 in tempo: it
slipped in your full run”, and fixing them counts as the review. The piece keeps its level either way.

### By heart: two different days

The two-days rule is for the **in-tempo** step only: Level 5 slow is ticked by one pass (a passage
passed in tempo on its first day is at Level 4 with Level 5 slow ticked). Level 5 counts once the
whole piece **reached level 5 on two different days**: an off-book full run (in tempo)
that opened level 5 and whose slips were then fixed (or a clean one). The day counted is the day
level 5 was reached (the clean run, or the last fix). After the first day the piece is
concert-ready (4). On the second day you sing the whole piece off book again: that run opens level
5 again, and its fixes then count (fixed on the same day or later). A second completion on the same
day doesn't count as a second day.

Fix lists only exist for pieces with more than one passage. A piece with only one passage has
nothing to run through on top: its passage level is its piece level.

## Readiness

- **Rehearsal-ready** = piece level 3. **Concert-ready** = piece level 4.
- **Memorised** = piece level 5: level 5 (off book) reached for the whole piece on **two different
  days** (above). After the first day the piece is concert-ready (level 4), as with passages.
- The readiness percentage (Home, the leaderboard, the section lead's view) is the way to
  concert-ready: the piece level counts fully, passage levels (in tempo) above it count half; slow
  steps don't count. So practice shows, and confirming it with a full run gives the jump.
- The definition of the piece level (a level the whole piece has reached) and the formula are
  unchanged by the fix-list rule, so `READINESS_VERSION` stays 2: a piece reaches a level sooner
  now (no second run), but what the level means for readiness is the same.
- Leaderboard entries carry `v: 2` (this formula). Entries from older app versions have no `v` and
  are shown greyed and ranked after current ones on Ranks; Ranks explains the recalculation once.

## Next up

Next up (`ladder.nextStep`) gives the passage (or `'all'`), the level and the **step**. Fixes,
reviews and full runs are always in tempo. In order: open fixes after a full run (“Fix Bars 9–16 in
tempo to reach Level 2 · Words”, lowest level first; at level 5 on the first day “…to finish the whole
piece from memory: day 1 of 2”); a weekly
review of the full run (piece level ≥ 3, last passed full run more than 7 days ago); passage
reviews; after the whole piece reached level 5 on one day, the full run from memory again on a
later day (day 2 of 2); the full run when every passage has reached a level above the piece's
(“Level 3 in every passage: confirm it with a full run-through”); else the weakest passage at its
current step: the lowest level, and of those a passage still on its slow step before one whose slow
step is done, so the whole piece goes slow first (“Bars 22–29: Level 1 · Notes · slow. Last passage to
sing slow.”; “… · in tempo. Slow is done: now in tempo.”). So Level 1 too gets one complete sing-through (in tempo) before Level 2: once
every passage is at Level 1 in tempo, Next up is the full run at Level 1, then the passages that
slipped in it, in their own (smaller) stretches. When the step is Level 2 slow and the passage's words
in rhythm (`words.ts`, at least the first stage) aren't passed, Next up says so (`wordsFirst`), and
the piece screen offers **Say it in rhythm first** (in today's plan it is a words step,
[TODAY.md](TODAY.md)). The piece screen offers “Know it already?” (in tempo, or any level).

The cycle target (`ladder.targetForDate`, e.g. “Rehearsal in 3 days: get 3 more passages to Level 3
· Alone (about 1 a day), then sing it all through at that level”) counts the passages not yet at the
level in tempo, spread over the days left (today up to the day before).

## Singers who practised before piece levels (and before “doo”)

(History: this section describes earlier changes. For the slow / in-tempo steps, see “Progress saved
before the steps” below, which does rewrite stored level-1 records once.)

Levels already earned were kept. Level 1 on “doo” with every note right applied to runs from then on:
passage and piece levels reached under the old 75% mark stayed as they were (a full-run record only
gained the list of its wrong notes). Readiness and the leaderboard formula were unchanged.

Their section levels stay as they were. Piece levels come only from full runs, so their pieces start
at piece level 0. The piece screen says "Level 3 in every section. Confirm it with a full
run-through" and Next up suggests exactly that run. Stored data is only added to
(`PieceProgress.full`). The old `all` record, which mixed in stopped and slower runs, is left alone and
ignored. The readiness history moved to a new key (`sh:readiness2`), so "most improved" doesn't show
a false drop.

## Progress saved under the earlier rules (a second full run after the fixes)

Until this change a fix list locked the full run at its level, and once every section on it had
passed on its own the singer had to sing the whole piece again. Nothing stored is lowered, and the
app upgrades on load (`store.upgradeFullRuns`, run for every piece when the library is ready and
again after progress changes, e.g. pulled from another phone):

- **Every grant needs a run that would open the level now** (at most half slipped, within 10
  points of the mark). A fix list counts (is shown, leads Next up, grants its level when done) only
  when it comes from such a run: `FullRunProgress.toFixLocks[N]` marks it. This version sets the
  mark on every list it writes; earlier versions set it only for a run that “held”, a stricter test.
- **Fix lists still open** saved without the mark are checked once: kept (and marked) when the latest
  counted run at that level in the attempt log came within 10 points of the mark and the list names
  at most half of the sections; otherwise **dropped**. Earlier versions wrote a list for every counted
  run, also a beginner's run far above their level where everything slipped; such a list shrank as
  sections passed, and must never grant the level. An unmarked list is never granted from, even
  before the check runs.
- **Fix lists already done.** When the latest counted full run at N (in the attempt log) left a fix
  list that is done, the piece reaches N if that run would open N now: within 10 points of the mark,
  and the sections that needed a pass of their own afterwards (rather than holding within the run)
  at most half; and every section has passed N since, on its own or held within that run. (We can't
  tell from stored data exactly how many sections slipped then, so this errs on the strict side.) A
  run that failed on timing credited no section, so every section needed its own pass afterwards:
  it grants nothing.
- **Clean-run stars from history.** Under the earlier rules a counted full run passed only when
  every section held, so each passed full run in the attempt log is a clean run at its level. When
  the log has none for the piece (it is trimmed, and isn't kept with a choir account), the piece
  level is: a star at that level, or at level 5 if the piece was passed off book. A record written
  by this version always has `clean` (possibly empty), so this runs once.
- Fix lists from the other phone: when merging, a marked list whose remaining sections were passed
  on the other phone reaches its level (`sync.mergeFull`), and stars are united.


## Progress saved before the steps (schema 2)

Nobody loses a level. The old Level 1 (70%, on “doo”) is the new **Level 1 slow**: stored progress is
migrated once (`store.SCHEMA_VERSION` 2, `store.migrateToSteps`), when the app first reads it:

- A passage at level 1 → level 0 with `slow: 1` (“Level 1 · slow ✓”; Next up continues with Level 1 in
  tempo). Levels 2 and up stay as they are (they were sung at full tempo), and so do their best results;
  bests at Level 1 (`best[1]`, `bestScore[1]`, of passages and of the whole piece) were sung at 70% and go, as bests are
  kept for runs in tempo only.
- A full-run record at level 1 → level 0. Level-1 fix lists (`toFix[1]`, `toFixLocks[1]`) and a
  level-1 clean-run star were earned slowly: dropped (at any piece level).
- Attempt-log entries from before the steps have no `step`; at level 1 they count as slow
  (`store.logStep`), so `upgradeFullRuns` never grants a piece level or a star from them.
- A **backup** from schema 1 gets the same migration on import (the backup's own `sh:schema`, else
  the file's `schema`, decides).
- **The copy kept with a choir account** (`sync.ts`): `SNAPSHOT_VERSION` 2 adds `slow` as an optional
  seventh element of a passage (`SectionC`), after the off-book days (an empty list when there are
  none), so older apps still read the first six. A copy with `v` < 2 (an older app on another phone)
  is migrated the same way before merging, so it can never grant Level 1 in tempo; merging takes the
  higher `slow`, kept only above the merged level.
- Readiness counts levels in tempo, so a piece whose passages were only at the old level 1 reads a
  little lower after the update; nothing else changes (`READINESS_VERSION` stays 2).
