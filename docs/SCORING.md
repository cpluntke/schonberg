# How Schönberg Hero hears you and scores you

This page is for singers and testers who want to know what the app is doing.

## Pitch detection

| Step | What happens |
|---|---|
| Microphone | `getUserMedia` with echo cancellation, noise suppression and auto-gain **off**, so the raw voice reaches the app. |
| Algorithm | **McLeod Pitch Method (MPM)**, from the `pitchy` library: a normalised square-difference function (a refined autocorrelation) with peak picking and parabolic interpolation. It is accurate to well under a cent on a steady tone. |
| Window | The latest **1024 samples** (≈21 ms at 48 kHz) for voices that don't go below about C3 (sopranos, altos, most tenors). Otherwise **2048 samples** (≈43 ms) for basses, because MPM needs about 2 periods of the lowest note. The shorter window halves how much a note change smears. |
| Hop | A new reading every **20 ms**. |
| Gates | A reading only counts as sung when the level is above the noise floor, the MPM *clarity* is at least 0.85 (clearly pitched sound, not a consonant or breath) and the pitch is between 60 and 1400 Hz. |
| Smoothing | A **median of the last 3 readings** removes single-frame glitches, plus a guard against one-frame octave jumps. Nothing else: the trace you see is what the detector heard. |
| Time stamp | Each reading is stamped at the centre of its window. The device delay is then subtracted (see below). |

**About "overshoot" at note changes:** real voices do overshoot. A leap is usually a quick glide that goes past the new note and rings back within roughly 0.1–0.3 s. A small vibrato often starts right after. The trace shows this faithfully, and the scoring no longer counts it against you (next section).

## What is judged

For every note in your part:

- **Intonation ("In tune").**
  - Judging starts when your voice *arrives* within tolerance of the note: at most 0.15 s (and 35% of the note) after the written start, plus the device delay the line-up corrects. The glide into the note, the overshoot and a late consonant don't count.
  - Judging stops when you head for the next note (at most 0.12 s early).
  - Vibrato is cancelled by two cascaded moving averages (≈180 ms and ≈220 ms). These remove vibratos from about 4 to 8 Hz almost completely, so a vibrato centred on the note counts as in tune.
  - A short dropout of the detector (up to 20% of the note) doesn't count against you.
- **Tolerance per level.** Note-learning ±50¢, In time ±35¢, Independent ±30¢, Concert-ready ±25¢. "Forgiving" strictness widens these by 30%, and "strict" narrows them by 20%.
- **Grade per note.**
  - *Perfect*: ≥80% of the judged part in tune, and the median within half the tolerance.
  - *Good*: ≥60% in tune.
  - *OK*: ≥35% in tune.
  - Otherwise *miss*.
  - Accuracy is the average over notes (perfect 1, good 0.85, OK 0.5). The letter grade comes from accuracy.
- **Sections within a full run.** A run of the whole piece also scores each section (the average grade of its notes). The piece level needs the run *and* every section at the level's pass mark; see [LEVELS.md](LEVELS.md).
- **Rhythm.** When each note starts: the first sustained (≥60 ms) sound that is closer to this note than to the previous one. This is judged separately from pitch.

## Device delay (latency)

What you hear from the phone and what the microphone picks up arrive late by the **round-trip delay**: output buffers, the speaker or Bluetooth, the microphone and input buffers. This delay is often 100–250 ms on Android and less on iPhones with wired headphones. If the app assumes the wrong delay, the previous note's pitch appears inside the current one, and good intonation looks wrong.

- **Delay check** (Voice setup): sing "ta" with 6 clicks and the app measures the delay directly.
- **Automatic line-up after every run:**
  - The app tries a range of delays and keeps the one where your pitches agree best with the written notes. It uses pitch, not onsets, because consonants and breaths blur those.
  - The search never goes beyond a plausible total device delay.
  - **Only intonation** is judged on the lined-up voice. Onsets, rhythm and the timing tips stay on the delay the app applied, so singing late still shows as late.
- **Learning the delay** (phones without a measured delay):
  - The app suggests a delay after each complete run.
  - It stores the delay once **two runs agree** (within 60 ms).
  - While the guide plays your own part (levels 1–2), you might be following it by ear, so those runs can't teach a delay much above what the device itself suggests.
- **Timing at level 2 and up:** when the delay was **measured** with the delay check, a run with the right notes still fails if your entries come more than 250 ms behind the beat (median). Without a measured delay, the app can't tell a late singer from a slow phone (Bluetooth headphones can add 200–300 ms). So when entries come clearly late (L2+), or your voice only lines up with a delay far beyond what phones usually have, the run is shown but **doesn't count toward the level**, and the app asks for the 10-second delay check.

## Recordings for tuning

After a run, **Results → "Share this run's recording"** creates a small zip:

- `run.wav`: your microphone, 16-bit.
- `run.json`: the piece, part, bars, tempo, level, the delay used, the app's own pitch readings and the result.

`qa/realism/` can re-score these offline with exactly the same pipeline. The audio is kept on the phone and only leaves it when you share it. You can turn this off in Settings ("Keep a recording of my last run").
