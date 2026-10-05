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
  right-octave readings (the tracker, or the guide in the mic) still fails.
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

## The piece level: sing it all in one go

A piece reaches level N only through a **full run-through at level N**, in one go:

- The whole piece, at the level's tempo, support, tolerance and pass mark.
- **Not stopped early and not paused** (after your first note; a pause in the count-in is fine).
  A run that was stopped, or paused and carried on, is practice: it is scored and kept in the bar history, but it doesn't count. (Slower than the
  level's tempo, e.g. the level-1 tempo slider below 70%, is practice too, and so is a level-1 run
  without headphones, and a level-5 run with bars still showing or a peek. Arcade runs of the whole
  piece are just for fun and never count.)
- **Every section is scored within the run** (the same measure as the run's accuracy: the
  average grade of its notes). Sections with fewer than 8 notes get one weak note of slack (it counts as
  "good"), so a single "ok" note can't fail a level; a missed note is never forgiven. A section under 50% in the run never counts as held. The level is granted only when the run passes overall **and every
  section reaches the pass mark**.
- **At level 1 every note of every section must be right** (as above; no slack). Any section with a
  note that wasn't right is "to fix at level 1", and piece level 1 is granted only when every
  section in the run had every note right.
- A section below the pass mark is **"to fix at level N"**. Until it passes at level N (or higher)
  as a section on its own, a full run at level N can't count: the piece screen greys out that
  level's "Sing it all" button and lists the sections to fix. We chose locking over "you can run it
  but it won't count" because it makes the next step obvious, and nobody sings a five-minute run
  for nothing. A full run at another level stays open.
- Fix lists only lock and lead Next up for the level you're working toward (the next piece level, or
  the level every section has reached), or when the run held at its level: at most half the sections
  slipped and either the run passed overall, or it came within 10 points of the pass mark while every
  other section had passed that level before the run. A new singer who tries level 5 and slips everywhere just sees the
  slips as information ("practise them at level 5 when you get there"); Next up stays level 1.
- Sections that held within a counted run are credited as section passes at that level (so an
  experienced singer who sings it all at level 3 straight away also has every section at 3).
- **The full run is available right away**, at any level: an experienced singer can skip the sections.

A piece with only one section has nothing to run through on top: its section level is its piece level.

## Readiness

- **Rehearsal-ready** = piece level 3. **Concert-ready** = piece level 4.
- **Memorised** = the full run at level 5 (off book) passed on **two different days**. After the
  first day the piece is concert-ready (level 4), as with sections.
- The readiness percentage (Home, the leaderboard, the section lead's view) is the way to
  concert-ready: the piece level counts fully, section levels above it count half. So practice
  shows, and confirming it with a full run gives the jump.
- Leaderboard entries carry `v: 2` (this formula). Entries from older app versions have no `v` and
  are shown greyed and ranked after current ones on Ranks; Ranks explains the recalculation once.

## Next up

In order: sections to fix after a full run; a weekly review of the full run (piece level ≥ 3, last
passed full run more than 7 days ago); section reviews; after the whole piece passed from memory on
one day, the full run from memory again on a later day (day 2 of 2); the full run when every section has reached
a level above the piece's ("Level 3 in every section: confirm it with a full run-through"); else the
weakest section. Home also offers "Know it already? Sing the whole piece at level N".

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
