# Field test plan: first week with the choir

Everything was tested in desktop Chromium with simulated and fake-microphone singers. Real
phones, real voices and real headphones are the unknowns. This plan finds the problems quickly.

## Before you hand out the link

1. Deploy it (see `docs/DEPLOY.md`) and open the link on **one iPhone and one Android** yourself.
2. On each: **Settings → Diagnostics → Test microphone** with headphones on, humming a note.
   - You should see `readings/s` ≥ 40, voiced > 50 %, and a sensible last note.
   - `echoCancellation false` is ideal. If it says `true`, pitch is still usable but less accurate.
3. Import one of the choir's real MusicXML exports and open every part: check names, octave
   (tenor!), lyrics and section splits.

## What to tell singers (copy-paste)

> **Schönberg Hero:** our part-learning app. Open the link on your phone, then *Share → Add to Home Screen*.
> 1. Do the 2-minute voice setup with **wired headphones** if you have them; it measures the delay.
> 2. Each piece is split into sections. Climb each section from level 1 (slow, your part plays) to
>    level 3 (alone) before rehearsal, and to level 4 (no note names, chord only) before the concert.
> 3. Home tells you what to do today.
> 4. If anything is odd, open Settings → Diagnostics → *Copy diagnostics report* and send it to me.

## What to collect after a week

| Question | Where to look |
|---|---|
| Did the mic work on every phone? Which phones/browsers failed? | Diagnostics reports |
| Do good singers pass level 2/3 in the fast passages? | Ask; known risk in fast Debussy/Ravel sections (QA R5-04 / R6-01) |
| Are the coach notes right? Any "wrong notes" or "behind the beat" that felt unfair? | Ask singers for screenshots of Results |
| Was the delay calibration needed? (Bluetooth users) | Diagnostics: `latencySettingMs` |
| Did anyone lose progress? | Diagnostics: storage persistent? |
| Were the levels too hard or too easy? | Strictness setting they ended up on |

## Tuning knobs (if real singers disagree with the scoring)

| Symptom | Knob | File |
|---|---|---|
| Good singers fail fast passages | onset grace / short-note judgement | `src/game/scoring.ts` (`DEFAULT_ONSET_GRACE`, short-note branch in `finalize`) |
| Pass thresholds feel off | `LEVELS[].pass` / `tolerance` | `src/progress/ladder.ts` |
| "Behind the beat" too eager / too shy | `BEHIND_MS` | `src/game/analysis.ts` |
| Auto-learned delay wrong | threshold 170 ms, offset 50 ms | `src/ui/screens/Play.tsx` (`onDone`) |
| Vibrato treated as out of tune | `vibratoWindow` (default 0.18 s) | `src/game/scoring.ts` |

## Known limitations going in

- Pitch tracking listens to one voice. Practising in a room with others singing won't score well.
- Bluetooth headphones add 150–300 ms. The app learns it, but the 10-second delay check is better.
- Repeats in scores are played straight through, without volta handling.
- Staccato marks aren't used in scoring yet. Notes are judged over their written length.
