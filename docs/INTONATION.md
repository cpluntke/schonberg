# Intonation lab (preview)

Find a **pure fifth** (3:2, 702¢, about 2¢ wider than the piano's) and a **pure major third**
(5:4, 386¢, about 14¢ lower than the piano's) by ear, at home, on your own phone.

Open to choir admins and the super admin only for now (`labEnabled` in
`src/ui/screens/IntonationLab.tsx`). Those accounts see an "Intonation lab" card on Home. The lab's
address is `#/intonation`.

## What to listen for

Two notes that are nearly in tune *beat*: a pair of their overtones lands a few hertz apart and the
sound pulses ("wah-wah-wah").
- In a fifth, the root's 3rd partial meets the fifth's 2nd partial.
- In a major third, the root's 5th partial meets the third's 4th partial.

The closer the notes, the slower the pulse. When the interval is pure, the pulse stops.

The lab shows that pulse as one second of waveform. It shows how much the sound pulses, never which
way to move: finding the direction is the singer's ear's job. The rate is `|m·f_hi − n·f_lo|` for a
ratio n:m (`beatHz`, `wobble` in `src/game/intonation.ts`).

On middle C, the piano's third pulses about 10 times a second. On a lower do it pulses more slowly
(about 6 times a second on D3).

## The ladder (per interval; help fades as you climb)

| Step | What | Passes with |
|---|---|---|
| 1 Listen | Three examples (pure, nearly, piano or further off), then "which is calmer?" pairs | 5 of the last 6 right |
| 2 Tune it by hand | The app plays do and an off note (15–40¢ above or below, at random). Move it with a slider (no numbers) until the pulse stops | 3 of the last 4 within 5¢ |
| 3 Sing it, with the wobble | Drone (do, and sol for the third). Sing, see the pulse, hold 2 s | 3 of the last 4 within 8¢ |
| 4 Sing it blind | The same with no pulse on screen; the result is shown after the hold | 3 of the last 4 within 8¢ |
| 5 In the chord | The app sings the other two triad notes (pure). You pick do, mi or sol. The wobble can be shown for practice; only rounds with it off count | 3 of the last 4 within 8¢, wobble off |

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

Progress stays on the phone (`sh:intonation`, not synced).
