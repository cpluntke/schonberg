# Intonation courses (the lab)

Find a **just fifth** (3:2, 702¢, about 2¢ wider than the piano's) and a **just major third**
(5:4, 386¢, about 14¢ lower than the piano's) by ear, at home, on your own phone. "Just" is the
word the app uses for an interval tuned to its exact ratio, with no pulse (as in *just intonation*);
the wording avoids sentences where "just" could be read as "only".

## Courses, for every singer

The lab's two ladders are two **courses** under Train (`src/game/courses.ts`, the screens in
`src/ui/screens/IntonationLab.tsx`): **Just fifth** ("Make the open fifth stand still.") and **Just
major third** ("Make the chord ring."). Each is that interval's 5-step ladder (below), about 25 minutes
(5 · 5 · 4 · 5 · 6), with "one step a day" suggested and never enforced: every step up to the current
one opens; a step passed today makes the next one "tomorrow" on the course page, Train and Today.

Every singer has them; there is no admin or programme gate any more. A choir **recommends** them by
putting the lab into a cycle's programme, like a piece (the cycle editor, "Intonation lab" under
Pieces, or the choir's Library, "Put it in the programme"); in a programme it is the id
`lab:intonation` (`LAB_ID`): not a score, so piece lists, readiness and ranks skip it. Then the course
page and Train's course card say "Your choir recommends", Today keeps its "Intonation courses" card,
and Today offers the warm-up (below).

- **Train** (C1): today's warm-up (the active course's next step, while it isn't done today), the tools
  (Check a note, a Drone: do or do + a sol tuned just, at any pitch), the active course (its steps as check
  circles, "Next: … · N min") and one suggestion, "All courses" (`#/courses`), drills from your music
  and the Zwölfton row. A course is **active** once its first round is sung and until its last step is
  passed (both started: the one practised last).
- **The course page** (`#/intonation/<fifth|third>`, C2): the outcome, two demo sounds through the
  drone (piano chord · a soft shimmer / just-tuned chord · calm and still; for the fifth: a little off · a
  slow wobble), "5 steps · about 25 min · one step a day", "What's a cent?", the steps with goal,
  minutes, the day (done Wed · today · Sun) and the pass rule in words ("To pass: 3 of your last 4
  holds close to the just pitch"), and a sticky Continue.
- **A step** (`#/intonation/<interval>/<1–5>`, C3): which course and step, a goal line, a how line,
  labelled progress ("Tries that rang just ✓ ✓ ✗ ④ · 1 more to pass"), then the feedback words first: the pulse
  word, then the direction on the app's pitch scale with the cents in brackets ("Almost still · a touch
  high (6 cents)"; `feelWords`), what to do next, and where it landed. While a hold is under way only
  the picture (or the ear) and the hold timer show. Rung 4 is now called **Sing it by ear**.
- **Step done** (C4): a quiet card ("Step 3 done ✓", the pass rule met, what you can do now, the
  course's progress, "Step 4 of the course waits for tomorrow."). Inside today's session the primary
  is today's next step, with "Keep practising this step" and "Finish for today"; outside it "Back to
  Train", "Keep practising this step" and "Or go on to step 4 now".
- **Course done** (`#/intonation/<interval>/done`, C6): the green band ("You can hear a just fifth",
  what you can do now), **Use it in your music**, the quick check's date and the next course. Inside a
  session the primary is today's next step.
- **Use it in your music** (`src/game/heldIntervals.ts`): the programme's pieces are searched for a
  note of the singer's part held (≥ 0.75 s together) a fifth or a major third (plus octaves, counted up
  from the lower note) against another sung part (organ, piano and other instruments left out); the
  passage of up to 4 bars with the most such held time against one voice wins (at least two spots and
  2 s). "Sing Abendlied bars 3–6 slowly" loops those bars at Level 1 slow. None found: the card is left
  out.

## The quick check a week later

Passing a course's last step books a **quick check** 7 days later (`LabTrack.review.due`). From that
day Train's warm-up and Today's warm-up offer it (1 minute, `#/intonation/<interval>/check`): three
holds by ear, no picture (rung 4's screen); **kept** when 2 of 3 are within 8¢. If it slipped, rung 4
("Sing it by ear") is suggested once more (`LabTrack.redo`, its rounds start afresh); passing it again
books a new check a week later ("It locks again ✓ · quick check on …"). A course page and Train show
where the check stands. The check's screen opens only on or after its day and until it is taken;
otherwise its address shows the course page. Today ticks the check once taken today (kept even when a
redo the same day books the next one) and the redo once passed today; "What moved" says "Quick check:
it held ✓" or "Quick check: it slipped · sing it by ear once more".

## Today

Today's warm-up (`courseWarmUp`, via `ui/today.ts labNext`) appears only when the choir recommends the
courses or the singer has started one, so Today doesn't grow for everyone: a due quick check first, then
a redo after a slip, then the active course's next step (none once a step of it was passed today: one
step a day), and with the choir's recommendation the fifth, then the third, then a 2-minute tune-up once
both are done. A course finished on one's own adds nothing more (except its quick check). See
docs/TODAY.md.

## What to listen for

Two notes that are nearly in tune *beat*: a pair of their overtones lands a few hertz apart and the
sound pulses ("wah-wah-wah").
- In a fifth, the root's 3rd partial meets the fifth's 2nd partial.
- In a major third, the root's 5th partial meets the third's 4th partial.

The closer the notes, the slower the pulse. When the interval is just, the pulse stops.

The lab shows that pulse as one second of waveform. It shows how much the sound pulses, never which
way to move: finding the direction is the singer's ear's job. The rate is `|m·f_hi − n·f_lo|` for a
ratio n:m (`beatHz`, `wobble` in `src/game/intonation.ts`).

On middle C, the piano's third pulses about 10 times a second. On a lower do it pulses more slowly
(about 6 times a second on D3).

## The ladder (per interval; help fades as you climb)

| Step | What | Passes with |
|---|---|---|
| 1 Listen | Three examples (just, nearly, piano or further off), then "which is calmer?" pairs | 5 of the last 6 right |
| 2 Tune it by hand | The app plays do and an off note (15–40¢ above or below, at random). Move it with a slider (no numbers) until the pulse stops | 3 of the last 4 within 5¢ |
| 3 Sing it, with the wobble | Drone (do, and sol for the third). Sing, see the pulse, hold 2 s | 3 of the last 4 within 8¢ |
| 4 Sing it by ear | The same with no pulse on screen; the result is shown after the hold | 3 of the last 4 within 8¢ |
| 5 In the chord | The app sings the other two triad notes (tuned just). You pick do, mi or sol. The wobble can be shown for practice; only rounds with it off count | 3 of the last 4 within 8¢, wobble off |

## How singing is judged

- **Holding:** a hold of 2 s locks the result. Readings are averaged over 0.34 s first, so a vibrato
  counts at its centre. A slide (start and end of the hold more than 6¢ apart), a jump of more than
  18¢, or a break of more than 0.2 s starts the hold over. The locked value is the median of the
  last 1.5 s (`HoldDetector`).
- **Octaves:** cents are folded to the octave of the target, so an octave slip still counts.
- **Wrong note:** a note more than 60¢ from the target is "a different note" and is not counted.
- **Do:** set from the singer's measured range when there is one (with sol still inside it);
  otherwise S D4, A A3, T D3, B A2.
- **Headphones:** the singing steps need them, so the drone doesn't reach the microphone.

"3 of the last 4" also passes after the first 3 tries if all 3 rang just.

The pulse on screen and its words ("still", "almost still", "pulsing", "fast buzz") follow the cents
off the just pitch, drawn as the pulse would be on a do of D3. The real pulse is faster on a higher do, but
this way every voice sees the same picture for the same tolerance (`shownBeats`, `wobbleWord`).

In "tune it by hand", the just pitch sits at a different place on the slider every round (a hidden shift of up
to ±25¢), so it can only be found by ear.

## Stored, and synced

Progress is on the phone (`sh:intonation`): per interval the rung, the last rounds per rung, the day
each rung was passed, the last round's time, the quick check (due, taken, kept), a redo, and (this
phone only, for Today's ticks) the last check taken and the day a redo was passed. A course finished
before the quick check existed gets one booked a week from the first look. It travels with the choir
account as the snapshot's `lab` field (`sync.ts encodeLab/decodeLab/mergeLab`; typically 200–300 bytes,
about 620 at most with every round of both ladders; older apps ignore it, so SNAPSHOT_VERSION stays):
merging takes the higher rung, each rung's rounds from the copy practised last, the earlier pass day,
and the quick check with the later due day (on the same day the one taken) with its redo; the redo's
rounds come only from that copy (an empty list after a slip is sent too), so old passing rounds never
come back. Never lowers a rung. (An older app that saves the account copy drops
the field; the phones that have it keep theirs and put it back on their next save.)
