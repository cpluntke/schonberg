# Overnight build report

Good morning! Here is what happened between midnight and 7.

## TL;DR

- **Schönberg Hero works end to end** as an installable web app (PWA): import your MusicXML/MIDI →
  choose your part → sing → live pitch feedback → scored results with coach notes → a mastery
  ladder per section → cycle readiness on Home.
- **The coaching progression** from the design critique (`docs/design-critique.md`) is built:
  Listen → Note-learning → In time → Independent → Concert-ready, with rehearsal-ready (L3) and
  concert-ready (L4) targets, review reminders and a daily plan paced to your rehearsal and concert
  dates.
- **Tested by 13 sub-agent QA passes in 6 rounds** (functional, choir-singer UX, audio/perf, regression,
  exploratory and a11y, code review, a week-long acceptance test, a real-audio pipeline test, two
  final gates with about 11,000 synthetic singer runs). Every P0/P1 they found was fixed and re-verified. The final
  gate (round 6) found **0 P0 and 0 P1**; see "Testing" below.
- **LIVE:** **https://messiermarathon-latest.onrender.com/schonberg/**, deployed through messiermarathon
  (PR #291, merged and deployed 4 Oct 12:15 UTC). The choir leaderboard runs on that service's disk.
- **Onboarding video:** a 100-second narrated intro (coach + singer dialogue over the real app), playable from
  Home, voice setup and Settings. Sources are in `media-src/onboarding/`. "Schönberg" is now pronounced with a German "sch".
- **Next cycle programme** (preset in `public/pieces/cycle.json`; since 5 Oct gone: the app ships only the Abendlied,
  and choir admins add these pieces from the choir library in Choir admin): Fauré *Madrigal*, Debussy *Trois chansons*,
  Poulenc *Vinea mea* and *Huit chansons françaises*, Vierne *Kyrie* (Messe solennelle). Weekly rehearsals on Thursdays at 19:30;
  the next one focuses on the Fauré, Debussy no. 2 (*Quand j'ai ouy le tabourin*) and the Vierne.
  - Bundled: Debussy nos. 1–3 and the Vierne *Kyrie* (Hößl edition from CPDL, choir + organ + pedal reduction rather than two organs).
  - Import slots: the Poulenc pieces (in copyright) and the Fauré *Madrigal* (CPDL blocks automated downloads; download
    it in a browser and import it). Home shows each one as "import your score" and links it automatically once imported.

## Try it

```bash
npm install
npm run dev          # http://localhost:5173
```

Add `?simulate=perfect` (or `flat` / `sloppy`) before the `#` to watch a synthetic singer instead
of using your mic, e.g. `http://localhost:5173/?simulate=sloppy#/`.

## What's in it

| Area | What you get |
|---|---|
| Repertoire | MusicXML (.musicxml/.xml/.mxl) and MIDI import, with divisi split and lyrics, dynamics, tempo and key changes. Built-in: an original warm-up chorale plus public-domain Debussy (*Dieu! qu'il la fait*, *Yver*), Ravel (*Nicolette*), Bruckner (*Locus iste*) and Brahms (Op. 29/2 opening) |
| Practice (2D) | Piano-roll highway, live pitch trace, cents bubble, other voices as ghosts, lyrics karaoke, dynamics, entry countdown, mixer, slow tempo at L1 |
| Arcade (3D) | Perspective lanes, combo multiplier, PERFECT/GOOD popups, sparks; unlocks per section at level 2 |
| Coaching | Bar-by-bar heat strip and coach notes: flat/sharp, sagging long notes, late/early entries, scooping, missed leaps, wrong notes, wrong octave, too quiet. Each has a one-tap loop drill |
| Drills | Entry drill (hear two beats of harmony, find your note without a cue), leap drill from your parts' hardest intervals, 12-tone row of the day (P/R/I/RI) |
| Notation | Letters, fixed do, movable do (la-minor), jianpu with octave dots, pitch classes; key-aware spelling |
| Intonation | Equal temperament or chord-aware just intonation; strictness forgiving/standard/strict |
| Setup | Name, voice, rehearsal/concert dates, the cycle's pieces, live tuner, range finder, headphone-delay calibration (it also learns the delay from your singing if you skip calibration) |
| Ranks | Readiness / climbers / streak / weekly points; section battle; choir overview (voice part × piece). Works offline via share codes pasted into the choir chat, or live with the optional server (`server/`) |
| Other | Backup/restore, offline PWA, reduced-motion support, focus management, 44px touch targets, landscape layout |

## Judgement calls I made (you said to decide)

- **Look:** a dark, high-contrast "stage" look, based on the mockups.
- **3D:** arcade is a *reward*, unlocked per section at level 2. The 2D highway is the main learning view, because perspective hides phrase shape.
- **Leaderboard:** it ranks by **readiness / improvement / streak** rather than raw points, to avoid rewarding grinding in a high-level choir. Posting to a shared server is opt-in, and the default works offline with share codes.
- **Demo content:** the Poulenc you mentioned isn't public domain, so it's not bundled; import your own scores. Schoenberg's *Friede auf Erden* only exists as PDF scans, so it isn't bundled either.
  - I removed a Bach chorale edition that had wrong notes.
  - I left out Vaughan Williams: still in copyright in the EU until 2028.
- **Scoring for real singers:**
  - Vibrato is judged over whole notes.
  - Singing another voice's part an octave away is fine.
  - Just intonation accepts both the pure pitch and the tempered pitch you hear from the backing.
  - Timing is judged independently of pitch.

## Testing

All QA reports are in `docs/qa/`. Priority scale: `docs/priorities.md`.

| Round | Focus | P0 | P1 | Outcome |
|---|---|---|---|---|
| 1 | functional / singer UX / audio & perf | 0 | 10 | all P1s fixed |
| 2 | verification / exploratory and a11y | 0 | 2 | fixed |
| 3 | verification / code review / acceptance (go) | 0 | 4 | fixed |
| 4 | final verification / real-audio pipeline | 0 | 0 | P2 fixes (short consonant notes, mic loss, storage guards) |
| 5 | gate: real audio + 2,277 synthetic singers | 0 | 1 | "behind the beat" fired on normal singing: fixed (drag vs scoop told apart) |
| 6 | final gate (≈9,000 runs, real audio, smoke) | **0** | **0** | 6 P2 remain (below) |

Morning additions after the gate: a crash screen and error log, a **Diagnostics** page (mic test, storage check,
copyable report), an update prompt instead of automatic reloads, persistent-storage request,
gentler mic release, vibrato-proof drift detection, and an importer hardening pass on a large
MusicXML corpus (`docs/qa/importer-hardening.md`).

### Open P2s (accepted for the field test)

- **Fastest passages:** a good singer may fall just short of level 2–4 in the fastest passages (Debussy *Yver* bars 1–23, *Dieu* bars 1–5,
  Ravel *Nicolette* bars 20–45) in synthetic tests. Real recordings will tell. The knobs are in `docs/FIELD-TEST.md`.
- **Uncalibrated delay of about 120–150 ms:** not learned automatically (to avoid learning consonants). The 10-second delay check
  fixes it.
- **Portamento:** a singer sliding into every note may be told "behind the beat".
- **Staccato marks:** not yet used in scoring.
- **Learned delay:** the latency learner may store a very steady ≥230 ms drag as headphone delay.

Automated tests: 189 unit tests (`npm test`) and Playwright end-to-end tests (`npm run e2e`),
including a fake-microphone test that feeds a WAV through the real pitch pipeline.

## Known limitations / next steps

- **Field test:** follow `docs/FIELD-TEST.md` (what to check, what to tell singers, which knobs to turn).
- **Not tested on real phones** (iOS Safari / Android). Testing was in desktop Chromium with fake
  microphones and CPU throttling. The first real-device session should check headphone latency
  calibration and Bluetooth behaviour.
- **Hosting:** see `docs/DEPLOY.md`.
- **Content:** the quality of scores imported from MuseScore varies. Wrong notes in a source file show up as "hard leaps".
  Import the choir's own MusicXML exports.
- **Ideas for later:**
  - a director dashboard backed by the server;
  - breath marks and phrase view;
  - a verse picker;
  - a tuning drill with a drone;
  - an AudioWorklet pitch tracker;
  - join/seam runs between sections.
