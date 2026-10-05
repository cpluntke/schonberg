# Levels: sections and the whole piece

Every piece is cut into short sections, and there are five levels (`src/progress/ladder.ts`):

| Level | Name | Tempo | Your part plays | Note names | Start | Tolerance | Pass |
|---|---|---|---|---|---|---|---|
| 1 | Note-learning | 70% | yes | yes | your note | ±50¢ | 75% |
| 2 | In time | 100% | yes | yes | your note | ±35¢ | 80% |
| 3 | Independent | 100% | no | yes | your note | ±30¢ | 80% |
| 4 | Concert-ready | 100% | no | no | chord only | ±25¢ | 85% |
| 5 | Off book | 100% | no | hidden | chord only | ±25¢ | 85% |

## Section levels are practice steps

A section level says "you can sing bars 9–16 at level 2". You can try any level of any section at
any time, and a pass raises the section's level. Section levels show your practice, but **on their
own they never make a piece ready**.

## The piece level: sing it all in one go

A piece reaches level N only through a **full run-through at level N**, in one go:

- The whole piece, at the level's tempo, support, tolerance and pass mark.
- **Not stopped early and not paused** (after your first note; a pause in the count-in is fine).
  A run that was stopped, or paused and carried on, is practice: it is scored and kept in the bar history, but it doesn't count. (Slower than the
  level's tempo, e.g. the level-1 tempo slider below 70%, is practice too, and so is a level-5 run
  with bars still showing or a peek. Arcade runs of the whole piece are just for fun and never count.)
- **Every section is scored within the run** (the same measure as the run's accuracy: the
  average grade of its notes). Sections with fewer than 8 notes get one weak note of slack, so a
  single "ok" note can't fail a level. The level is granted only when the run passes overall **and every
  section reaches the pass mark**.
- A section below the pass mark is **"to fix at level N"**. Until it passes at level N (or higher)
  as a section on its own, a full run at level N can't count: the piece screen greys out that
  level's "Sing it all" button and lists the sections to fix. We chose locking over "you can run it
  but it won't count" because it makes the next step obvious, and nobody sings a five-minute run
  for nothing. A full run at another level stays open.
- Fix lists only lock and lead Next up for the level you're working toward (the next piece level, or
  the level every section has reached), or when the run mostly held (at most half the sections slipped
  and the others are at that level). A new singer who tries level 5 and slips everywhere just sees the
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
  are shown greyed on Ranks; Ranks explains the recalculation once.

## Next up

In order: sections to fix after a full run; a weekly review of the full run (piece level ≥ 3, last
passed full run more than 7 days ago); section reviews; after the whole piece passed from memory on
one day, the full run from memory again on a later day (day 2 of 2); the full run when every section has reached
a level above the piece's ("Level 3 in every section: confirm it with a full run-through"); else the
weakest section. Home also offers "Know it already? Sing the whole piece at level N".

## Singers who practised before piece levels

Their section levels stay as they were. Piece levels come only from full runs, so their pieces start
at piece level 0. The piece screen says "Level 3 in every section. Confirm it with a full
run-through" and Next up suggests exactly that run. Stored data is only added to
(`PieceProgress.full`). The old `all` record, which mixed in stopped and slower runs, is left alone and
ignored. The readiness history moved to a new key (`sh:readiness2`), so "most improved" doesn't show
a false drop.
