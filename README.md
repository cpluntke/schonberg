# Schönberg Hero

A Guitar-Hero-style **part-learning trainer for choirs**. Sing your part into your
phone. Notes scroll toward you, your voice draws a live pitch line, and every
phrase climbs a mastery ladder until it's concert-ready.

Built for a young, high-level chamber choir (Poulenc, Ravel, Debussy, early Schoenberg),
so it takes intonation seriously: cents-level feedback, a chord-aware just-intonation
target, movable/fixed solfège and Chinese numbered notation (jianpu), and an atonal
**Zwölfton** expert mode.

<p>
  <img src="docs/screenshots/home.png" width="200" alt="Home: cycle readiness and today's plan">
  <img src="docs/screenshots/practice-2d.png" width="200" alt="Practice mode: note highway with live pitch trace">
  <img src="docs/screenshots/arcade-3d.png" width="200" alt="Arcade mode: 3D lanes">
  <img src="docs/screenshots/results.png" width="200" alt="Results with coach notes">
</p>

## Features

- **Repertoire:** import your choir's **MusicXML** (`.musicxml`, `.xml`, `.mxl`) or **MIDI**.
  Parts, divisi voices, lyrics, tempo and key changes are read automatically. Built-in demo
  pieces: public-domain Debussy, Ravel, Bruckner and Brahms (via the PDMX dataset) plus an
  original warm-up chorale.
- **Coaching ladder:** each piece is split into sections, and each section climbs
  Listen → 1 Note-learning → 2 In time → 3 Independent → 4 Concert-ready.
  Support is removed step by step: tempo, your part playing along, note names, and the
  starting pitch. Readiness is shown per piece and per cycle; levels needed: rehearsal-ready
  = everything at level 3, concert-ready = level 4. Sections you haven't sung in 7 days come back for review.
- **Practice mode (2D):** piano-roll highway, live pitch trace, cents readout, other voices as
  ghosts, lyrics, per-voice mixer, slow tempo for level 1.
- **Arcade mode (3D):** notes rush down perspective lanes, combo multiplier,
  PERFECT/GOOD popups. Unlocks per section at level 2.
- **Coach notes after each run:** a bar-by-bar heat strip and diagnoses such as sinking on
  long notes, late entries after rests, scooping, missed leaps and wrong octave, each with a
  one-tap "loop these bars" drill.
- **Expert mode:** a 12-tone row of the day (P/R/I/RI forms), and a leap drill built from the
  hardest intervals in *your own* parts.
- **Leaderboard:** ranked by readiness, 7-day improvement, streak or weekly points. Works
  offline by sharing codes in the choir chat; an optional tiny server (`server/`) gives a
  live choir board.
- **Voice setup:** live tuner, range finder, headphone-delay calibration and notation choice.
- Settings for notation (letters / fixed do / movable do / jianpu / pitch classes),
  strictness, equal vs just intonation, cycle dates, backup/restore.
- Installable **PWA** that works offline. Everything runs on the device; no audio leaves the phone.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (use --host to try on your phone over https/tunnel)
npm test           # unit tests (vitest)
npm run e2e        # browser tests (Playwright, fake microphone)
npm run build      # production build in dist/
```

The microphone needs **https** (or localhost). For phones, deploy the `dist/` folder to any
static host (GitHub Pages workflow included in `.github/workflows/pages.yml`, or Render /
Netlify / Vercel).

**Testing without singing:** add `?simulate=perfect` (or `flat`, `sloppy`) to the URL and a
synthetic singer replaces the microphone.

## Docs

- [docs/design-critique.md](docs/design-critique.md): critique of the first design and
  the coaching model that came out of it
- [docs/architecture.md](docs/architecture.md): module contracts
- [docs/priorities.md](docs/priorities.md): P0–P3 bug scale used in testing
- [content/raw/SOURCES.md](content/raw/SOURCES.md): sources and licences of the demo scores

## Licences of demo content

The Debussy, Ravel, Bruckner and Brahms editions (and the Reger, Elgar and Bach files in `content/raw/`) come from the
[PDMX dataset](https://zenodo.org/records/15571083) (CC BY 4.0), which collects
MuseScore.com scores marked Public Domain / CC0 by their uploaders. The compositions
themselves are in the public domain.
