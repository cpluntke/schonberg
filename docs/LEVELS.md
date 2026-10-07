# Levels: sections and the whole piece

Every piece is cut into short sections, and there are five levels (`src/progress/ladder.ts`):

| Level | Name | Tempo | Sung on | Your part plays | Note names | Start | Tolerance | Pass |
|---|---|---|---|---|---|---|---|---|
| 1 | Note-learning | 70% | “doo” | yes | yes | your note | ±50¢ | every note right, with headphones on |
| 2 | In time | 100% | the words | yes | yes | your note | ±35¢ | 80% |
| 3 | Independent | 100% | the words | no | yes | your note | ±30¢ | 80% |
| 4 | Concert-ready | 100% | the words | no | no | chord only | ±25¢ | 85% |
| 5 | Off book | 100% | the words | no | hidden | chord only | ±25¢ | 85% |

## Level 1: the notes, on “doo”

Level 1 is for learning the notes, so it is sung on **“doo”**: the pre-run card says so, a small
“on doo” tag sits by the words while you sing, and the words stay on screen, dimmed, for
orientation. The words come in at level 2. (Words-in-rhythm and the lyrics quiz are separate and
unchanged.) Nothing in the scoring uses the words: notes are judged on pitch and onset only, and
“doo” suits the pitch tracker well (a voiced, steady “u”; the short “d” before each note is a gap
the scorer already allows for, like any consonant).

**Level 1 counts only with headphones on** (`LevelSpec.headphones`, `ladder.speakerPractice`). The
pre-run card of a level-1 section or full run asks **“Headphones on?”** (Yes / No, speaker), and
Start waits for an answer. The answer is kept in the profile (`Profile.headphones`) and pre-filled
next time, one tap to change. It belongs to the phone, like the headphone delay: it is not part of
the copy kept with a choir account (`sync.ts`). Without headphones the guide (your own part) plays
through the speaker into the mic, and the tracker can't hear every note reliably (in the realism
harness, honest singers on the phone speaker passed level 1 on “doo” in about a third of runs;
`docs/qa/realism-current.md`, section 8 and observation 15). So a level-1 run without headphones is
**practice**: it is scored, kept in the bar history, and Results lists the notes that weren't right,
but it never raises a section level, never grants piece level 1 and never changes a fix list.
Results says: “Practice: level 1 counts with headphones on, because through the speaker the app
can’t hear every note reliably.” Levels 2–5 don't ask.

**Every note must be right** (`LevelSpec.everyNote`): a level-1 attempt passes only when every note
is graded *good* or *perfect* (±50¢ at 70% tempo, the usual grades, see [SCORING.md](SCORING.md)).
One flat note fails it, and Results says which: “Bar 5: note 3 was flat (−62¢)” (big misses in
words: “a wrong note (about 2 semitones low)”, “sung an octave low”), with a button to loop that bar
slowly; that bar shows as “needs work” in the bar strip, and the grade letter shows at most a B.

- **Notes the app can't judge reliably are let off** (`ladder.noteVerdict`): a note below *good*
  is forgiven when the scorer flags it as unsure (`NoteResult.unsure`): a **very short note** (its
  judged part is under 0.15 s of score time, the notes the scorer already grades leniently because
  the voice rarely settles and the tracker gets only a few readings), or a written pitch **outside
  the tracker's range** (60–1400 Hz), or a note the tracker misread: a **low note (under 200 Hz)
  read partly or wholly an octave up** on “oo”, or a note with **a few subharmonic readings** (18–46
  semitones under it, where no voice sings), when the note is right once those readings are folded down
  or replaced (see [SCORING.md](SCORING.md); never an octave low). The end-of-run correction of
  readings an octave under a note (the phone speaker's subharmonics) needs more than half of the
  note at the right octave at level 1 (30% at levels 2–5), so a note sung an octave low with a few
  right-octave readings (the tracker, or the guide in the mic) still fails; readings an octave and a
  fifth or two octaves under it are corrected at level 1 only when 30% of the note was heard at the
  right pitch, so a bass singing F#2 for a C#4 fails. A note mostly lost to **microphone trouble**
  (`'mic'`: sung through, right wherever a pitch was heard, with the tracker's evidence of hum
  intermodulation or distortion on a quarter of it) is let off too, and Results says what to fix.
- **…unless it was clearly wrong** (`NoteResult.clearly`): **no sound at all** inside the note
  (“not sung”; for both kinds, so a note out of the tracker's range must still be sung), or a very
  short note graded *miss* whose own readings were enough to judge
  it (the same test the scorer uses for fast notes) with their median at least 1.5 tolerances off
  (75¢ at level 1: a wrong note, not a wobble), however far off, except 18–46 semitones low (the
  tracker locking onto a fraction of the pitch, not a sung note) or an octave up on a note under
  200 Hz (the tracker's octave error on “oo”).
- The 75% pass mark stays only as a backstop, so a run can't pass on forgiven notes alone. It only
  matters when many notes are forgiven (good singers in the realism harness never reach it).
- A note tied over the end of a section is judged on the part before the end, since playback and
  listening stop there (`ScoringContext.end`; before, such a last note always read as missed).
- Short sections get **no slack** at level 1 (the “one weak note” rule below is for levels 2–5).

## Section levels are practice steps

A section level says "you can sing bars 9–16 at level 2". You can try any level of any section at
any time, and a pass raises the section's level. Section levels show your practice, but **on their
own they never make a piece ready**.

## The piece level: sing it all through, then fix what slipped

For every level N = 1…5 (`store.recordFullRun`, `store.recordAttempt`):

1. **Practise in sections** (above), as much or as little as you like.
2. **A counted full run at level N opens level N.** Counted means:
   - the whole piece, at the level's tempo, support, tolerance and pass mark;
   - **not stopped early and not paused** (after your first note; a pause in the count-in is fine);
   - at level 1 with headphones on, at level 5 with everything hidden and no peek;
   - the timing was fine (a run that came in clearly late, with a measured delay, is “Not yet” on timing).
   A run that was stopped, paused, slower than the level's tempo (e.g. the level-1 tempo slider
   below 70%), through the speaker at level 1, or off book with bars showing or a peek is practice:
   it is scored and kept in the bar history, but it changes nothing. Arcade runs of the whole piece
   are just for fun and never count.
3. **Every section is scored within the run** (the same measure as the run's accuracy: the average
   grade of its notes). A section **held** when it reaches the level's pass mark within the run.
   Sections with fewer than 8 notes get one weak note of slack (it counts as “good”), so a single
   “ok” note can't fail a level; a missed note is never forgiven, and a section under 50% never
   holds. **At level 1 a section holds only when every one of its notes was right** (as above; no
   slack). Sections that held are credited as section passes at that level (so an experienced singer
   who sings it all at level 3 straight away also has every section at 3). Sections that slipped are
   **“to fix at level N”**.
4. **The piece reaches level N as soon as every section that slipped in that run has passed level N
   on its own** (or above). No second full run: the last fix grants the level, and Results says
   “Fixed! Piece level N reached”. If nothing slipped, the piece reaches level N at once.
5. **Too much slipped: practice.** A run in which **more than half of the sections slipped** does
   not open the level (`ladder.runOpensLevel`: at most half may slip; two of four opens, three of
   four doesn't; one of three opens, two of three don't). It's practice: nothing is credited and no
   fix list changes, and Results says “Too much slipped for this run to count. Practise the
   sections, then sing it all again.” This keeps the full run a real test of the piece, not a
   formality that turns the whole piece into a list of sections. (It replaces the earlier
   “the run held” heuristics, which also looked at the overall score and at section levels before
   the run: one simple rule instead.)

### The clean-run star

A counted full run at level N in which **every section held** (and the run passed overall) is a
**clean run**: the piece reaches N at once and earns a ★ for that level (`FullRunProgress.clean`,
the levels with a star). Getting everything right in one go is hard, so it's a bonus, not a
requirement. The star shows on the piece screen (“★ Clean run at level 1, 2: every section right
in one go”, and on that level's “Sing it all” button), on Results (“Clean run! Every section right
in one go ★”), and on the leaderboard entry (`LeaderboardEntry.clean`, the highest level with a
star, shown as “★ clean run at level N”). The star is not part of readiness. The leaderboard
server keeps only fields its validator knows, so until it accepts `clean` the star shows only for
entries shared by code; the app works either way.

### Running it again: the new run replaces the fix list

The full run is open at any time, at any level, fix list or not. A new counted run at N that opens
the level **replaces** the fix list at N with its own slips: a section fixed since the last run
stays off the list only if it held again in the new run, and a section still on the old list comes
off if it held now. Fair both ways: the list always says what the latest real run of the whole
piece showed. A run where too much slipped (practice) leaves the list as it was. Sections that
held also come off the fix lists of lower levels (that can finish a lower level). Reaching a level
settles the lists below it.

### Slips at or below the piece level

The piece level is never lowered. A run at or below it (a weekly review, or a lower level for fun)
that opens with slips makes a fix list too: Next up says “Fix bars 9–16 at level 3: it slipped in
your full run”, and fixing them counts as the review. The piece keeps its level either way.

### Off book: two different days

Level 5 counts once the whole piece **reached level 5 on two different days**: an off-book full run
that opened level 5 and whose slips were then fixed (or a clean one). The day counted is the day
level 5 was reached (the clean run, or the last fix). After the first day the piece is
concert-ready (4). On the second day you sing the whole piece off book again: that run opens level
5 again, and its fixes then count (fixed on the same day or later). A second completion on the same
day doesn't count as a second day.

Fix lists only exist for pieces with more than one section. A piece with only one section has
nothing to run through on top: its section level is its piece level.

## Readiness

- **Rehearsal-ready** = piece level 3. **Concert-ready** = piece level 4.
- **Memorised** = piece level 5: level 5 (off book) reached for the whole piece on **two different
  days** (above). After the first day the piece is concert-ready (level 4), as with sections.
- The readiness percentage (Home, the leaderboard, the section lead's view) is the way to
  concert-ready: the piece level counts fully, section levels above it count half. So practice
  shows, and confirming it with a full run gives the jump.
- The definition of the piece level (a level the whole piece has reached) and the formula are
  unchanged by the fix-list rule, so `READINESS_VERSION` stays 2: a piece reaches a level sooner
  now (no second run), but what the level means for readiness is the same.
- Leaderboard entries carry `v: 2` (this formula). Entries from older app versions have no `v` and
  are shown greyed and ranked after current ones on Ranks; Ranks explains the recalculation once.

## Next up

In order: open fixes after a full run (“Fix bars 9–16 at level 2 to reach level 2”, lowest level
first; at level 5 on the first day “…to finish the whole piece from memory: day 1 of 2”); a weekly
review of the full run (piece level ≥ 3, last passed full run more than 7 days ago); section
reviews; after the whole piece reached level 5 on one day, the full run from memory again on a
later day (day 2 of 2); the full run when every section has reached a level above the piece's
(“Level 3 in every section: confirm it with a full run-through”); else the weakest section. So
level 1 too gets one complete sing-through before level 2: once every section is at level 1, Next
up is the full run at level 1, then the sections that slipped in it, in their own (smaller)
stretches. Home also offers “Know it already? Sing the whole piece at level N”.

## Singers who practised before piece levels (and before “doo”)

Levels already earned are kept. Level 1 on “doo” with every note right applies to runs from now on:
section and piece levels reached under the old 75% mark stay as they are, and nothing stored is
rewritten (a full-run section record only gains the list of its wrong notes). Readiness and the
leaderboard formula are unchanged.

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

- **Fix lists already done.** When the latest counted full run at N (in the attempt log) left a fix
  list, every section has passed N since (on its own, or held within that run), and that run came
  within 10 points of the pass mark, the piece reaches N. (We can't tell from stored data how many
  sections slipped then; the 10-point margin is the earlier rules' own “nearly held” test, so a run
  that slipped almost everywhere doesn't grant a level now.)
- **Fix lists still open** become open lists under the new rule: fix the rest and the piece reaches
  the level. A stored list that still names more than half of the sections is ignored (that run
  wouldn't open the level now); the obsolete `toFixLocks` marks are ignored.
- **Clean-run stars from history.** Under the earlier rules a counted full run passed only when
  every section held, so each passed full run in the attempt log is a clean run at its level. When
  the log has none for the piece (it is trimmed, and isn't kept with a choir account), the piece
  level is: a star at that level, or at level 5 if the piece was passed off book. A record written
  by this version always has `clean` (possibly empty), so this runs once.
- Fix lists from the other phone: when merging, a list whose remaining sections were passed on the
  other phone reaches its level (`sync.mergeFull`), and stars are united.

