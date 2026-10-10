# Today: the daily loop

Home is **Today**: what to do today, when today is done, the week, and what changed. The plan is
worked out by `src/progress/today.ts` (pure functions, tested in `today.test.ts`); `src/ui/today.ts`
builds its input from the library and the store, keeps the plan for the day and runs today's session;
the cards are in `src/ui/components/Today.tsx`; Your progress is `src/ui/screens/Progress.tsx`.

## The plan

`buildPlan(ctx)`: **3–4 steps, about 10–15 minutes**, never two steps on the same passage.

1. **Warm-up** first: the intonation lab's next rung (the fifth, then the third; once both ladders are
   done a 2-minute tune-up), only when the lab is on for this singer (`labEnabled`: in the choir's
   programme, or an admin's preview).
2. **What matters most**: passages the singer said felt shaky at the last rehearsal ("You said it felt
   shaky"); passages to fix after a full run and reviews due (any piece); the first step of each
   rehearsal piece (`Cycle.focusPieceIds`) that isn't rehearsal-ready yet.
3. A rehearsal piece that **is** rehearsal-ready and wasn't sung through in the last 2 days (the last
   run of the whole piece that counted, `PlanPiece.lastFullRun`), when the rehearsal is at most 3 days away: **sing it all once** ("Keeps it fresh for Tuesday"); then the
   rehearsal pieces' other passages.
4. **Progress on the other pieces**, one step per piece in turn (the piece sung most recently first);
   concert-ready pieces last.

A piece's steps (`pieceCandidates`) follow `ladder.nextStep`'s order: fixes, the full run's weekly
review, passage reviews, a full run that confirms a level, then each passage at its current step (the
lowest first, slow before in tempo); Level 2 slow with the words in rhythm not passed is a **words**
step. Whatever `nextStep` says comes first stays first.

Steps are added in that order while there are fewer than 3 or the plan is under 10 minutes, up to 4
steps; a step that would take the plan past 16 minutes is skipped (from the third step on). When the
programme holds less than 10 minutes (one short piece), the card says so: "A short day: 6 min".

**Minutes** (`estimateMinutes`): the passage's length at the step's tempo plus a count-in (8 s) and a
look at Results (20 s), times the tries (a passage 3, a fix or review 2, the whole piece 1, words 2), plus
one listen for a passage never sung; whole minutes, 1–6. Lab rungs: 5, 5, 4, 5, 6 minutes. The plan's
"about N min" is the exact sum.

### Rehearsal day, the day after, a break

- **Rehearsal day** (the weekly rehearsal, or the one-off date, until 2½ hours after it starts:
  `NextRehearsal.over`): a 5-minute warm-up for tonight: a rehearsal piece that's ready, sung through
  once; up to two passages being worked on, once each (in tempo once the notes are known; a passage to
  fix at its fix level), never the same passage twice; a 1-minute lab tune-up. "Best in the hour
  before you leave." Once the rehearsal is over, the rest of a frozen warm-up is planned again as a
  normal day.
- **The day after** (up to 3 days after it, until answered; also on a welcome-back day): "How was rehearsal?" with **I was at rehearsal**
  (the day counts for the week) and chips of the rehearsal pieces' passages ("What felt shaky?", or
  **All fine**). The answer re-plans the rest of today with those passages first (done steps stay);
  what they pushed out is listed ("Moved to tomorrow: …"). The card then folds to one line with
  **change**.
- **Welcome back** (the last practice 7 or more days ago; a rehearsal the singer confirmed counts as
  practice): "Welcome back, NAME", one calm line with the plan's real minutes, and a short restart: a
  piece they know sung through once (or the passage they know best), then one small next step, with
  the usual minute estimates. Nothing is lost: the week counts days, there is no streak to break.

## Keeping the plan, ticking steps off

- The plan is **frozen for the day** (`sh:today`) once the singer starts it or sings anything today;
  until then it is planned afresh on every look (so new dates or pieces show up). A rehearsal answer
  re-plans it on purpose. The steps not done yet are planned again (done ones stay) when they no
  longer fit: the piece left the programme, the singer changed voice part, the passages changed, or
  the rehearsal a warm-up was for is over.
- **Singing before the day's first look at Today**: the day's plan starts with that work, ticked
  (`stepsSungOn`: one step per passage at the latest level and step sung, when it counts as done),
  then the next steps.
- Home plans once per change of the store or of the day (`useDay`: midnight, or the app coming back
  from the background) and stores the plan after drawing, never while drawing.
- A step is **done** (`stepDone`) when today's attempt log has a **counted pass** of it (a pass in
  tempo at that level or above also ticks a slow step), or **two counted runs of exactly that step**
  without a pass, so a struggling singer can still finish the day. The whole piece: a run in tempo that
  opened its level, or two real goes at the level (runs that counted but where too much slipped or the
  entries came late are logged as practice with `fullRun`; stopped, slower and paused runs don't
  count). Words: a words run today. The lab: the rung passed, or a full go at it today (6 rounds of the
  listening check, 4 of the others; the session strip counts rounds while the lab is open from the
  plan, as the lab keeps no dates). A **tune-up** (a rung already passed: both ladders done, or the
  rehearsal-day minute) ticks only on rounds sung today. Listening, slower practice runs and loops don't count.
- **Today done** when every step is done, or after **Finish for today**: one stats line (minutes from
  the log, plus lab steps at their planned minutes · notes sung right today), what moved (steps passed
  for the first time today, a level the whole piece reached, a lab step passed), tomorrow's plan (the
  same function for tomorrow 9:00 on today's progress, a preview), the week line and **Practise more
  (optional)**. The week line is honest about the calendar: "your best week so far" only when better
  than every earlier week, "matches your best week" on a tie, no "practise tomorrow" on a Sunday. The
  reminder offer: once, when the browser can show reminders and the daily reminder is off, "Want a
  nudge tomorrow? · Remind me at 18:00 / No thanks" (`ReminderOffer`; the reminder itself:
  You → Practice, docs/PRIVACY.md §4).

## Today's session

**▶ Start today's practice** (or a tap on a step) starts the first step not done and makes it the
session's current step. On the pre-run card, Results and the lab (only for screens of the current
step's piece) a strip shows "Today · step 2 of 4", a tick per step and the minutes left. On Results:
once the step is done, the primary button is the next step of today ("Next: Abendlied · sing it all",
"step 3 of 4 · 3 min"), with Results' own next step as the second button (unless it is the same run)
and **Finish for today** under it; the last step's primary is **Finish for today**. After a miss
Results keeps its help and its second button, with **Skip to next step** as a link. The words screen
and its Results take part the same way (`sessionFoot`). Back on Home the session pauses; Home shows
"Carry on · step N of M" and **Finish for today** once the plan is under way. Outside a session
nothing changes. A session left open over midnight (or until the app is opened the next day) ends:
the strip says "That was yesterday's plan" and leads to today's, and Results no longer offers
yesterday's next step.

## The week

The week goal (`Profile.weekGoal`, 1–7, default 4; Settings → Your week) replaces the daily streak on
Home. A day counts when the singer practised (this phone's log and the account copy's days) or
confirmed a rehearsal. The card shows "3 days · goal 4" (✓ only once the goal is met: "4 of 4 days ✓"),
a dot per day (♪ on rehearsal days, ringed for today), the best week, and **See your progress ›**. The
streak is still computed (sync and the leaderboard use it) but no longer shown as something to lose.

## The status line

"Rehearsal Tue 19:30 · in 3 days · Concert 12 Dec · on track", muted. The pace (`pace`) is the
concert's: the steps left (slow and in tempo per passage and level, plus a full run per level) for
every piece to reach Level 4, over the practice days left (days × week goal / 7) at 3 steps a day: on
track up to that, "a little tight: about N steps a day" up to 1.5×, "behind: about N steps a day to
catch up" (orange) beyond. No pace on the concert day itself ("Concert today"), and a one-off
rehearsal that is over is never "next". With nothing ahead and no concert date: "No rehearsal or
concert dates yet. Set dates". Without a concert date, the rehearsal pieces to Level 3 by the next
rehearsal. Rehearsal pieces that are rehearsal-ready get a green line.

## Your progress (#/progress)

This week (days, minutes from the log, notes sung right), the cycle's notes since it began, the last 5
weeks (a cell per day, ♪ for a confirmed rehearsal, the best week starred), each programme piece on the
LevelMeter with when it reached its level (stamped by the run that reached it; for older progress a
passed full run in the log; unknown dates are left out), and **Getting better** only when the data
shows it: the first slow run of each new passage in the last 14 days against before (at least 5
each, a gain of 8 cents or 8 points), in cents off when both have them (words first: "a little off
(26 cents)"), else notes right; only passages whose counted attempts are all in the kept log (so their
first run there is their first). A piece with nothing sung yet says "Not started".

## Stored on this phone

`sh:today` (today's plan and session), `sh:rehearsals` (rehearsal answers), `sh:dayNotes` (notes sung
right per day, added with the cycle points), `sh:labDay` (lab rounds today), `sh:reached` (when each
piece reached each level), and the log entries' `cents`. Only the week goal travels with the choir
account (`sync.ts` PROFILE_KEYS); the rest stays on the phone (a confirmed rehearsal counts on the
phone it was confirmed on).
