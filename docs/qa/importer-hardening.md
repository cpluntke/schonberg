# Importer hardening (MusicXML / MXL / MIDI), 2026-10-04

This is preparation for the real-world import test, where choir members bring files exported from MuseScore 3/4, Sibelius, Dorico and Finale, `.mxl` files from IMSLP/CPDL, and MIDI. Only `src/music/` was changed.

## Corpus

The corpus has 205 files, and every one of them goes through `importScoreFile` → `computeSections` in `src/music/corpus.test.ts`:

| Set | Files | Notes |
|---|---|---|
| `src/music/fixtures/corpus/lilypond/` | 166 | The complete Kainhofer "(unofficial) MusicXML Test Suite" from LilyPond's `input/regression/musicxml` (MIT). |
| `src/music/fixtures/corpus/w3c/` | 23 | W3C MusicXML spec tutorials and examples, schema test files, and full-score snippets (W3C Community CLA). |
| `content/raw/` | 11 | Real choir `.mxl` files (MuseScore 3.6 re-exports from PDMX, music21 Bach). |
| `public/pieces/` | 6 | Built-in pieces. |

Sources, commits and licences are listed in `src/music/fixtures/corpus/README.md`. The whole corpus is 1.9 MB.

The checks are in `src/music/invariants.ts` (`invariantViolations(score, sections)`):
- **Errors:** the import never throws, except with a user-facing `Error` for genuinely unsupported input. A `TypeError`/`RangeError` always counts as a failure.
- **Numbers:** no NaN or Infinity anywhere.
- **Notes:** sorted, `dur > 0`, MIDI pitch in 0–127, each note inside its measure and before `score.duration`.
- **Measures:** contiguous from 0 in both beats and seconds, each with positive length.
- **Tempos and keys:** tempos are positive and sorted; key fifths stay within −7..7.
- **Sung parts:** every part not typed `other` is strictly monophonic.
- **Part fields:** lyrics and syllabic values are strings; low/high match the notes; part ids are unique.
- **Sections:** they tile every measure with no gaps or overlaps.
- **Speed:** under 1 s per file.

`src/music/hardening.test.ts` adds 33 synthetic cases:
- **Exporter-specific layouts:**
  - Sibelius-style SATB on a grand staff, with voices 1–4 on staff 1 and 5–8 on staff 2.
  - Dorico-style `<print>`/`<credit>`/`<defaults>`-heavy files.
  - Finale `<score-timewise>`.
- **Notes and voices:**
  - Grace notes with chords and without `<duration>`.
  - Cross-staff notes.
  - `<forward>` gaps and hidden rests in voice 2.
  - Quintuplets, triplets and septuplets with `divisions=15`.
  - `<cue/>` notes.
  - `<instrument-change>` and `<unpitched>` percussion.
  - `<multiple-rest>`, and `measure="yes"` rests without a duration.
- **Tempo, key and transposition:**
  - A `<sound tempo>` that appears only in a later part.
  - Key and time changes mid-piece and mid-bar, including `3+2/8`.
  - `<transpose>` with `<double/>`.
- **Structure:**
  - Repeats, voltas and D.S.
  - Pickup bars numbered "0" and "X1", and empty bar numbers.
- **Lyrics:** `<extend/>`, `<elision>`, multi-`<text>`, unicode, entities, and lyrics on rests.
- **Unusual parts:**
  - Empty, rest-only and 1-note parts.
  - A part with no measures.
  - Parts with different bar counts.
  - A file with no notes at all.
- **Corrupt or degenerate input:**
  - Zero, negative or garbage `<divisions>`.
  - `beats=0` or `beat-type=0`.
  - Tempo 0, −5 or NaN; metronome "c. 0".
  - Overlapping notes in one voice caused by a bad `<backup>`.
  - Overfull bars, and a backup past the bar start.
  - BOM, DOCTYPE and entities.
  - An `.mxl` whose container points to a missing file.
  - Garbage input with every extension.
- **Scale:**
  - 500-bar SATB with lyrics, tempo changes and rehearsal marks.
  - 300 bars of 16th-note piano chords (19 200 notes).
  - A 60 000-note MIDI file.
- **Edge-case MIDI:** legato overlaps and chords in a vocal track, zero-length notes, a note 4 000 bars out, time signature 0/0, and a file with no notes.

## Failures found → fixes (all in `src/music/`)

| # | Failure | Where it showed up | Fix |
|---|---|---|---|
| 1 | Key fifths of −11…+11 for theoretical keys (lilypond `13a-KeySignatures`), which the notation code assumes stay within −7..7. | corpus | `musicxml.ts`: round the value and fold it enharmonically into −7..7 (±12). |
| 2 | Negative `<divisions>` gave negative note durations. Zero or missing `<duration>` on non-grace notes gave 0-length notes. Negative `<backup>`/`<forward>` durations moved the cursor the wrong way. | synthetic | `musicxml.ts`: ignore `divisions <= 0` (keep the previous value); skip notes whose duration is not `> 0`, the same way grace notes are skipped; clamp backup/forward durations to ≥ 0. |
| 3 | A sung part could contain overlapping notes. Causes: a bad `<backup>` in one voice, a chord plus a longer note in one voice, and MIDI legato overlaps or stray chord notes in a vocal track. The scorer assumes one note at a time. | synthetic (XML + MIDI) | New `mono.ts` `monophonize()`, applied to every non-`other` part in both parsers. At a shared onset it keeps the highest note (taking the lyric from the dropped twin if needed). Otherwise it trims the earlier note so it ends where the next one starts. |
| 4 | A corrupt or truncated `.mxl` threw fflate's raw `"invalid zip data"`. | synthetic | `import.ts`: rethrow as "Invalid MusicXML archive: this .mxl file could not be unzipped…" |
| 5 | A garbage `.mid` threw `TypeError: Cannot read properties of undefined (reading 'forEach')`. | synthetic | `midi.ts`: check for the `MThd` header, and wrap library errors as "Invalid MIDI file: …". |
| 6 | Potential stack overflow: `Math.min/max(...allNotes)` spreads. Safari/iOS limits calls to 65 536 arguments, so a big piano or orchestral part or a long MIDI file would throw a `RangeError` on iPhones. | review + scale tests | Replaced with loops (`minMax()` in `mono.ts`) in `musicxml.ts` and `midi.ts`. |
| 7 | MIDI: the bar grid ran to the last *meta* event, so a stray end-of-track far after the music added hundreds of empty bars and sections. When the 10 000-bar safety cap was hit, notes fell outside the grid. | synthetic | `midi.ts`: the grid ends at the last note end (or at the last event if the file has no notes). If the cap is hit, the last bar is stretched to the end. |

Things that were checked and already handled correctly:
- score-timewise, grace and cue notes, pickups, multi-rests, measure rests without a duration.
- Cross-staff voices, Sibelius voices 5–8, tempo given only in a later part.
- UTF-16/BOM/DOCTYPE, voltas (played straight), unicode lyrics, empty parts.

The one corpus file that is rejected (`w3c/snippet-movement-number-and-movement-title-elements.musicxml`, which has no `<part>`) gets the clear error "MusicXML contains no parts".

## Test results

- `npx vitest run src/music`: 5 files, 281 tests, all pass. That is the 207 corpus tests, 33 hardening tests and the existing suites.
- Full `npx vitest run`: 18 files, 432 tests, all pass. Nothing from other folders was failing at the time of the run.
- `tsc --noEmit -p .`: clean.

In one early run of the music suite a single test failed and could not be reproduced in 4 later runs. The output was cut off, but it was most likely one of the wall-clock checks (1 s per corpus file, 3 s for the 60k-note MIDI) under CPU load. If it shows up in CI, loosen those budgets.

## Remaining limitations / risks for tomorrow

- **Repeats, voltas and D.C./D.S. are not unfolded.** The score plays as written, so both volta endings play one after the other. This doesn't crash, but a singer practising "as performed" will hear a different order.
- **Percussion and `<unpitched>` notes are dropped.** A percussion-only file imports with no notes, and the Library shows "no notes were found".
- **Only the first verse of lyrics is used.** Strophic hymns show verse 1 only.
- **Unnamed multi-voice parts** (for example "MusicXML Part" with 2 voices) are typed by range and can come out as S/S rather than S/A. Real exports from the big four programs carry voice names, so this is mainly a test-file artefact.
- **Some per-staff details are ignored:** the `<transpose number="…">` per-staff variant (the first `<transpose>` is used) and `<double/>`. Clef `octave-change` is deliberately not applied.
- **Two `<part>` elements with the same id:** the second one wins and the first is silently lost. This is very rare.
- **Speed in jsdom vs the browser:** in jsdom, a 500-bar SATB file (1.4 MB) takes about 650 ms in DOMParser alone, plus about 200 ms of our own work. Native browser parsers are much faster, so this should be well under 1 s on phones, but a very large orchestral score on an old phone could take a few seconds. The hardening test budgets only our own work, not DOMParser time.
- **Changed MIDI behaviour:** an imported MIDI file no longer gets trailing empty bars after its last note. Sung MIDI tracks are now trimmed to be monophonic, so legato overlaps are shortened and the lower note of a stray chord is dropped.
- **No real MIDI corpus or real Sibelius/Dorico/Finale exports:** the MIDI cases are synthesized, and the exporter-specific cases are synthetic reproductions of known patterns, not real files from those programs. Every file that comes in tomorrow can be added to `src/music/fixtures/corpus/` and checked with `npx vitest run src/music/corpus.test.ts`. Setting `SHOW_SCORES=/tmp/out.txt` writes a one-line summary per file.
