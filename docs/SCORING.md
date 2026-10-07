# How Schönberg Hero hears you and scores you

This page is for singers and testers who want to know what the app is doing.

## Pitch detection

| Step | What happens |
|---|---|
| Microphone | `getUserMedia` with echo cancellation, noise suppression and auto-gain **off**, so the raw voice reaches the app. |
| Input filters | Before the detector (only what it analyses; recordings stay raw): a gentle **high-pass** at 0.7 × the frequency of the part's lowest note (at most 90 Hz, so a voice an octave low is still heard; 46 Hz when no part is known, as in the tuner), and **notches** at the mains hum (50 or 60 Hz, measured in the quiet before you sing) and its harmonics below your lowest note. They add about 2 ms of delay at the lowest note, less above. |
| Algorithm | **McLeod Pitch Method (MPM)**, from the `pitchy` library: a normalised square-difference function (a refined autocorrelation) with peak picking and parabolic interpolation. It is accurate to well under a cent on a steady tone. |
| Window | The latest **1024 samples** (≈21 ms at 48 kHz) for voices that don't go below about C3 (sopranos, altos, most tenors). Otherwise **2048 samples** (≈43 ms) for basses, because MPM needs about 2 periods of the lowest note. The shorter window halves how much a note change smears. |
| Hop | A new reading every **20 ms**. |
| Harmonic check | MPM picks the first strong period of the sound. Hum mixing with the voice in a laptop's input can make that period two or three times the voice's, so a sung C#4 reads as C#3 or F#2. A voice at the reading would have energy at every multiple of it; when the multiples that aren't multiples of 3 are far (9 dB) weaker than those that are, the reading is lifted ×3, and ×2 when the odd ones are 15 dB weaker. Between 3 and 9 dB the note due or the voice's previous reading decide the ×3 lift; the octave never uses a hint. A voice really singing an octave or an octave and a fifth low has its own harmonics and still reads low. |
| Gates | A reading only counts as sung when the level is above the noise floor, the MPM *clarity* is at least 0.85 (clearly pitched sound, not a consonant or breath) and the pitch is between 60 and 1400 Hz. |
| Smoothing | Each reading is checked against the one before and the one after it (so it is reported one reading, 20 ms, later). A reading more than 1.5 semitones away from **both** neighbours on the same side (a one-frame octave jump or a wild reading) is replaced by the median of the three. Every other reading is passed on unchanged, so the one or two readings a fast note gets are not flattened. Nothing else: the trace you see is what the detector heard. |
| Time stamp | Each reading is stamped at the centre of its own window (it is sent one reading later, with that window's level and clarity). The device delay is then subtracted (see below). |

**About "overshoot" at note changes:** real voices do overshoot. A leap is usually a quick glide that goes past the new note and rings back within roughly 0.1–0.3 s. A small vibrato often starts right after. The trace shows this faithfully, and the scoring no longer counts it against you (next section).

## What is judged

For every note in your part:

- **Intonation ("In tune").**
  - Judging starts when your voice *arrives* within tolerance of the note: at most 0.15 s (and 35% of the note) after the written start, plus the device delay the line-up corrects. The glide into the note, the overshoot and a late consonant don't count.
  - Judging stops when you head for the next note (at most 0.12 s early).
  - Vibrato is cancelled by two cascaded moving averages (≈180 ms and ≈220 ms of real time, whatever the tempo: at level 1's 70% they span fewer score seconds). These remove vibratos from about 4 to 8 Hz almost completely, so a vibrato centred on the note counts as in tune.
  - A short dropout of the detector (up to 20% of the note) doesn't count against you.
- **Very short notes** (fast passages, e.g. 16ths at 104–144 bpm, ~0.1 s). The voice rarely settles: it glides in, overshoots, and the next syllable's consonant cuts it off, so the detector gets only two to four readings per note.
  - When it has at least **two readings**, including an **uninterrupted run** (no unvoiced reading between) that stands for at least **30%** of the note and reaches past its first **35%**, it is judged on the **median of all its readings from the written start to the written end** (full credit once they stand for 40% of it). One reading, readings only in the attack, or scattered single frames — where consonants and the guide leaking into the mic land — are not enough. Readings at the start still nearer the previous note, and at the end already nearer the next note, are the transitions and don't count (within the same 0.15 s / 35% and 0.12 s / 20% limits as above). Readings after the written end never count for the note: they could just as well be a singer one note behind.
  - A reading more than **6 semitones** away from the note and from both neighbouring notes is a detector error (in a fast change it sometimes locks onto a fraction of the pitch) and is ignored, unless most of the note's readings are like that.
  - If that median is off, the note still counts as *good* when the median is within **1.6 × the tolerance (at most 50¢)** **and** the voice touched the note: one reading within the tolerance in the judged part, or two consecutive readings on either side of the note (each within twice the tolerance, neither more than 1.5 times as far from it as the other: the voice swinging around the note). A single in-tune reading while the voice sits on the previous or a wrong note doesn't count, and a voice swinging around a pitch that is off (flat, or another note) doesn't straddle the note evenly.
- **Tolerance per level.** Note-learning ±50¢, In time ±35¢, Independent ±30¢, Concert-ready ±25¢. "Forgiving" strictness widens these by 30%, and "strict" narrows them by 20%.
- **Grade per note.**
  - *Perfect*: ≥80% of the judged part in tune, and the median within half the tolerance.
  - *Good*: ≥60% in tune.
  - *OK*: ≥35% in tune.
  - Otherwise *miss*.
  - Accuracy is the average over notes (perfect 1, good 0.85, OK 0.5). The letter grade comes from accuracy.
- **Notes tied over the end of a section** are judged on the part before the end: playback stops
  there, and the app stops listening shortly after.
- **Practising on the phone speaker.** With the backing bleeding into the mic, the detector can
  lock onto the common period of voice and backing: an octave and a fifth (×⅓) or two octaves (×¼)
  below the voice, or an octave (×½). After the run, readings an octave and a fifth or two octaves
  under the note that is due are moved onto it. Readings an octave under it are moved up only when
  the same note also has readings at the right octave (the detector flickering): at least 30% of
  them, and at level 1 **more than half**. A note sung an octave low can still get some
  right-octave readings (the detector reading a low “oo” an octave up, or the guide in the mic), and
  at level 1 one such note fails the run; a flickering detector on a note sung at the right octave
  reads mostly at the right octave.
  Even so, through the speaker the detector misses too many notes for level 1's every-note rule
  (whole notes read an octave low with nothing at the right octave), so **level 1 counts only with
  headphones on**; without them it is practice ([LEVELS.md](LEVELS.md)).
- **Level 1: every note right.** Level 1 (sung on “doo”) passes only when every note is *good* or
  better. A note the scorer can't judge reliably is let off below *good*: a very short note (as
  above), or a written pitch outside the detector's 60–1400 Hz. It still counts as wrong when it was
  clearly wrong: **no sound at all** inside the note (no pitched reading, and every reading below the
  detector's level gate; this applies to both kinds), or, for a very short note, a *miss* whose own
  readings were enough to judge it with their median at least 1.5 × the tolerance off, however far,
  except 18–46 semitones low (the detector locking onto a third, a quarter … of the pitch, not a
  sung note) and an octave up on a note under 200 Hz (see below). A note outside the detector's range that was sung (there is sound, but no pitch
  the detector can read) is let off. Two more detector errors are let off at level 1:
  - **Low notes read an octave up** (`'octave'`): below 200 Hz a sung “oo” can put its strongest
    partial at twice the pitch, and the detector then reads some or all of the note an octave up. If
    the note is *good* once those readings are folded down, it is let off. Only upward: a note sung
    or read an octave **low** still fails, and so does a wrong note. Trade-off: a bass who really
    sings a low note an octave up is let off too (only at level 1; the levels above judge by
    percentage and grade such a note as missed).
  - **Subharmonic readings** (`'tracker'`): a minority of readings 18–46 semitones under the note
    and more than 6 semitones from both neighbours (the detector locking onto a third, a quarter … of
    the pitch, e.g. on a high soprano note with a wide vibrato). If the note is *good* once each is
    replaced by the reading before it, it is let off. Nothing a voice sings lands there; readings an
    octave below, a fifth or a sixth off, or anything above the note always count.
  - **Microphone trouble** (`'mic'`): a note sung through (sound in 70% of it) and right wherever
    the detector heard a pitch, whose shortfall comes with the detector's own evidence of input
    trouble on at least a quarter of it: readings it lifted from ½ or ⅓, or strong components at ½ / ⅓
    of the pitch (`PitchSample.mic`). A note with pitched readings elsewhere (a wrong note, an octave
    off) is never let off, and hum alone excuses nothing. Results names these bars and says what to
    fix on the microphone; the 75% backstop still applies, so a run mostly lost to the microphone
    doesn't pass.
  Each note result carries this as `unsure` (`'short'` / `'range'` / `'octave'` / `'tracker'` / `'mic'`) and `clearly` (`'silent'` / `'off'`); see
  [LEVELS.md](LEVELS.md).
- **Sections within a full run.** A run of the whole piece also scores each section (the average grade of its notes). A section below the level's pass mark within the run is “to fix”: the piece reaches the level once each of those passes on its own (and a run where more than half slipped is practice); see [LEVELS.md](LEVELS.md).
- **Rhythm.** When each note starts: the first sustained (≥60 ms) sound that is closer to this note than to the previous one. This is judged separately from pitch.

## Device delay (latency)

What you hear from the phone and what the microphone picks up arrive late by the **round-trip delay**: output buffers, the speaker or Bluetooth, the microphone and input buffers. This delay is often 100–250 ms on Android and less on iPhones with wired headphones. If the app assumes the wrong delay, the previous note's pitch appears inside the current one, and good intonation looks wrong.

- **Delay check** (Voice setup): sing "ta" with 6 clicks and the app measures the delay directly.
- **Automatic line-up after every run:**
  - The app tries a range of delays and keeps the one where your pitches agree best with the written notes. It uses pitch, not onsets, because consonants and breaths blur those.
  - The search never goes beyond a plausible total device delay. With a **measured** delay it only corrects by up to 80 ms, and first checks where the voice really lines up (within ±250 ms): a voice that lines up only about a note late (more than 85% of a typical note and more than 0.1 s) or early (more than half a note, at least 50 ms and at most 80 ms) is singing the neighbouring notes, not suffering a delay error, and is not shifted, so a singer one note behind or ahead fails. In fast passages (a typical note shorter than 0.16 s), a voice that lines up a little beyond 80 ms is corrected by 80 ms (a slightly larger delay error costs a little, not everything); a voice on the wrong notes lines up nowhere and is not shifted.
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
