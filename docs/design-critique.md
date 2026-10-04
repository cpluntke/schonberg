# Design critique: does Schönberg Hero coach anyone?

A review of the first mockups (Home, Voice setup, Practice 2D, Arcade 3D, Settings,
Results, Ranks, Zwölfton), judged as a **coaching progression** for one concert
cycle rather than as a game.

## Verdict

The mockups are a strong *game loop* (sing → score → combo) with good *diagnostics*
(bar heat strip, coach notes), but they are **not yet a progression**. Nothing says
what "learned" means, what a singer should do next, or what level is expected
before rehearsal. A singer who opens it can play forever without knowing whether
they are ready.

## What works

- **Live feedback is right for singers:** a continuous pitch trace against note
  bars, cents readout, and other voices visible as ghosts. You see *how* you were
  wrong, not just *that* you were wrong.
- **The coach notes are diagnostic,** naming the musical cause ("sinking on long
  notes", "late after rests") and offering one action ("loop bars 24–31 at 70%").
  This is the most valuable screen.
- **The notation choices (letters / fixed do / movable do / jianpu)** and the
  **just-intonation tuning target** take a chamber choir seriously.
- **Voice setup** sets up headphones, raw mic input and latency, all of which matter.

## What's missing

1. **The cycle has no structure.** Home shows "64% learned" with no definition.
   It should show the concert, the pieces in the cycle, and readiness per piece
   against a target date.
2. **There is no mastery ladder.** A section of music needs explicit levels with
   pass criteria that remove support step by step. Today, a high score at 60%
   tempo with your part playing looks the same as singing it alone at full tempo.
3. **The unit of practice is wrong.** Runs cover a whole piece. Singers learn
   phrases. Each piece should split into sections (rehearsal marks / 4–8 bars),
   each with its own level, so progress is visible and targetable.
4. **Feedback stops at diagnosis.** The coach should *prescribe* the next
   exercise and it should be one tap away: a loop of the weak bars at the right
   level, an "entry pitch" drill, an interval drill built from the actual leaps.
5. **Entries in 20th-century music are the real difficulty.** In Poulenc and
   early Schoenberg the hard part is finding your note from the surrounding
   harmony, not singing a scale. The design has no "find your note from the
   chord" practice. It should be part of the top level.
6. **The expert (Zwölfton) mode is disconnected from the repertoire.** A random
   row of the day is fun but doesn't help the concert. It should also draw the
   *hardest intervals of your own part* into drills (arcade-style), with the
   random row kept as the playful extra.
7. **Pieces you've learned are never reviewed.** Sections passed two weeks ago
   decay. Sections should come back as "due for review" (simple spaced
   repetition).
8. **The leaderboard rewards grinding.** Raw scores favour people who replay easy
   sections. In a high-level choir, rank by **readiness** (sections at
   concert level), **consistency** (streak) and **most improved**, keep
   score-chasing per section, and make posting opt-in.
9. **The 3D arcade is fun but bad for learning.** Perspective hides phrase shape
   and look-ahead, and there's barely room for lyrics. Make it a *reward* mode,
   unlocked for a section once it reaches level 2.
10. **Notation should fade out.** At concert level note names should disappear
    (lyrics only), because the singer should no longer rely on them.

## The progression (implemented)

Every piece is split into **sections**. Each section of your part climbs a ladder:

| Level | Name | Tempo | Your part audible | Note names | Starting pitch | Tolerance | Pass |
|---|---|---|---|---|---|---|---|
| 1 | **Note-learning** | 70% | yes | yes | played | ±50¢ | 75% |
| 2 | **In time** | 100% | yes | yes | played | ±35¢ | 80% |
| 3 | **Independent** | 100% | no (others only) | yes | played | ±30¢ | 80% |
| 4 | **Concert-ready** | 100% | no | no (lyrics only) | chord only | ±25¢ | 85% |

- **Level 0, Listen:** hear the section once, all parts, unscored.
- **Piece readiness** is the share of section-levels reached. The targets are
  **rehearsal-ready** = every section at level 3, and **concert-ready** = every
  section at level 4.
- A section **due for review** (level ≥3 not practised for 7 days) is flagged
  on Home.

## Feedback model

- **Live:** pitch trace, note-bar fill (cyan when hit), cents readout, combo.
- **Per attempt:** accuracy, pitch %, rhythm %, a per-bar heat strip and at most
  three insights (flat/sharp tendency, sagging long notes, late/early entries,
  scooping, wrong octave, missed leaps). Each insight has a one-tap drill.
- **Per piece:** the ladder map (sections × levels) and what to do next.

## Remaining risks

- The quality of imported MusicXML varies (voices sharing a staff, divisi). The
  importer splits voices, but the director should check the parts once.
- Phone microphones and Bluetooth latency are covered by the setup flow, but
  wired headphones remain strongly recommended.
- The just-intonation target is a reasonable approximation (relative to the
  chord root), not a model of how real choirs tune.
