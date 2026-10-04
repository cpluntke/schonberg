# Importer test corpus

Used by `src/music/corpus.test.ts`, which also imports `content/raw/` and `public/pieces/`. Collected on 2026-10-04. Total size is about 1.9 MB.

## `lilypond/`: the "(unofficial) MusicXML Test Suite" (166 files)

- **Source:** `input/regression/musicxml/` of https://github.com/lilypond/lilypond (commit `45851a4`). It was copied unmodified: every `.xml` file plus `90a-Compressed-MusicXML.mxl`. The `.itexi`/`.lybook` docs were left out.
- **Licence:** MIT. Copyright (c) 2008–2026 Reinhold Kainhofer. The full text is in `lilypond/LICENSE`, which must stay next to the files. (These test files are MIT-licensed. They are not GPL like LilyPond itself, and they are not public domain.)
- **Coverage:** pitches and microtones, rests and multi-measure rests, `<backup>`/`<forward>`, division changes, missing `<divisions>`, complex, compound and senza-misura time signatures, theoretical and non-traditional keys, chords, tuplets, grace notes, directions and metronome marks, spanners, multi-part, multi-voice and multi-staff parts, repeats and voltas, pickup, incomplete and overfull measures, header and credits, lyrics (melisma, elision, multiple verses), chord names, tablature, transposing instruments, percussion, figured bass, `.mxl`, and Sibelius quirks.

## `w3c/`: MusicXML specification examples (23 files)

- **Source:** https://github.com/w3c/musicxml, branch `gh-pages`, commit `22680df`. Files come from three places:
  - `docs/src/data/examples/musicxml/*.musicxml`: the tutorial and example scores (Hello World, Après un rêve, Chopin prelude, percussion, tablature, chord symbols…).
  - `tests/files/*.musicxml`: the schema test files, renamed with a `test-` prefix. The `.invalid` ones are schema-invalid but well-formed.
  - `snippet-*.musicxml`: complete `<score-partwise>`/`<score-timewise>` documents taken from the XML code block of the spec's element-example pages (`docs/src/data/examples/musicxml/*.md`). `snippet-movement-number-and-movement-title-elements.musicxml` contains no `<part>`. It is expected to be rejected with a user-facing error.
- **Licence:** © 2004–2025 the Contributors to the MusicXML Specification. Published by the W3C Music Notation Community Group under the W3C Community Contributor License Agreement (CLA): https://www.w3.org/community/about/process/cla/. They are used here unmodified (snippets extracted verbatim) as test data, with this attribution.

## Not included

- There are no MIDI files: no suitably licensed MIDI corpus was at hand. The MIDI edge cases are synthesized with `@tonejs/midi` in `src/music/hardening.test.ts`.
- CPDL and IMSLP block automated downloads (see `content/raw/SOURCES.md`).
