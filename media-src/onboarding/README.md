# Onboarding video source

`public/media/onboarding.{mp4,webm,jpg}` are rendered from these files: a two-voice dialogue
(Nora = coach, Ben = singer) over animated app screenshots. Current cut: about 2:40 (160 s),
scenes A title · B voice setup (choir code, range check, delay) · C practice screen (score
view with a zoom on a flat note, the Score/Highway toggle under Display & tempo, the highway, a laptop
showing the full choir score; how close you are: big words above the staff on the score, a small bubble on the
highway and the laptop, spot on · a touch · a little · clearly) · D passages
and Your path, the level ladder (5 levels: Notes on “doo”, Words, Alone, Concert, By heart; each level first
slow, then in tempo) and "Sing it all" (a full run opens the level, a passage that slips is "to fix" and fixing
just that bit earns the level, no second run; everything right first time = a clean-run star;
know it already? sing it all at any level, under More ways to practise) · E after a run (Results lead with
the one note to fix, how far off, a tip, Loop that bar slowly) · F Today (the plan with minutes, the status
line paced to rehearsal and concert, the week card; no streak) · G "try it now" checklist (voice setup, then
▶ Start today's practice: it must match “Try it now” under the player, `src/ui/components/IntroVideo.tsx`).

1. `script.json`: the dialogue (`say` = spoken text, `show` = subtitle, `scene` = visual group).
   `video.html` refers to lines by index (`at(i,frac,t)`, `since(i,t)`, `L(i)`, `win(t,a,b)`), so
   re-map the indices in the scene functions whenever lines are added or removed.
2. `python3 voice.py <dir>`: Kokoro TTS (kokoro-onnx, voices af_heart / am_michael; model files
   in `/tmp/kokoro`) → `narration.wav` + `timeline.json`.
3. Fresh screenshots (phone: 390×844 CSS px at deviceScaleFactor 2 → 780×1688) into `<dir>/img/`.
   `shoot/` takes them all from the dev server (`npx vite --port 5191`, then from `<dir>`:
   `node .../shoot/shoot-setup.cjs` (needs a server started with `VITE_CHOIR_URL` set, any URL, so the
   choir step shows the code field; restart without it for the rest), `node .../shoot/shoot-piece.cjs`, `node .../shoot/shoot-rest.cjs toggle|score 8|highway 9.5|fix|laptop 14`, `node .../shoot/shoot-today.cjs`;
   `BASE=http://localhost:PORT` for another port;
   they import the scores from `library/scores/` and print element boxes in css px, which is what
   `video.html` uses for callouts, boxes and the zoom):
   - `setup-choir` (the code typed, not joined), `setup-range` (going up, round 2 “Your turn”, the first
     round ✓: the script sings each pattern back with the fake mic's oscillator), `setup-delay` (the
     count-in “3”);
   - `practice-score` (Locus iste, soprano, Level 1 slow, `?simulate=flat`: the blue ink just under the
     first note, the readout above the staff says “C · a little flat ↓”), `practice-highway` (the same after choosing Highway),
     `practice-toggle` (the pre-run card with Display & tempo open on the Score/Highway toggle);
   - `piece` (Debussy “Dieu!”, alto, fresh user: Your path with the level meter and the passages),
     `piece-more` (More ways to practise open on the Sing it all card), `piece-tofix` (after a clean full
     run at level 1 and a level-2 run where two of the four passages slipped: the ★ line and “Now · Fix”;
     both runs in tempo, the slipped passages graded `good`/`ok` rather than `miss` so the run still
     opens the level; recorded through the app's own modules, `recordFullRun`);
   - `fullscore-laptop` (1280×800 at dpr 1: Vierne Kyrie, alto, Level 3 in tempo, `?simulate=flat`,
     about 14 s into the run);
   - `results-fix` (the same passage as `practice-score`, `?simulate=oneflat`: “Not yet: one note to fix”);
   - `home` (`shoot-today.cjs`: Today mid-cycle from seeded progress, Abendlied rehearsal-ready, Locus iste
     started, a confirmed rehearsal; clock fixed to Sat 10 Oct 2026 17:30, rehearsal Tue, concert 12 Dec;
     scrolled so the status line, the plan and the week card fill the phone);
   - and `public/icon.svg`. Fonts into `<dir>/fonts/` (IBM Plex Mono
   → `PlexMono.ttf`, Bricolage Grotesque → `Bricolage.ttf`, Source Serif 4 → `SourceSerif.ttf`).
   Tips: the range-check frame needs a voice; an init script that replaces `getUserMedia` with
   a WebAudio stream (an oscillator for the held note, plus the app's own output delayed by
   2.8 s, which "sings back" each pattern) gives a real mid-exercise frame without touching the
   app. `?simulate=perfect|flat|sloppy|oneflat` (or `localStorage['sh:simulate']`) gives real
   practice/results screens.
4. Stills to check layout and sync: `node render.cjs <dir> x 3,22,47.5` writes
   `<dir>/still_<t>.png`. Full render: `node render.cjs <dir> <dir>/onboarding.mp4`
   (canvas frames via Playwright → ffmpeg; must print `errors []`). Subtitles: `voice.py` splits each
   `show` into sentences timed by length, and joins a very short one (“Sure.”) to the next.
5. `ffmpeg -i onboarding.mp4 -c:v libvpx-vp9 -b:v 0 -crf 40 -c:a libopus onboarding.webm` and a
   poster: `ffmpeg -ss 3 -i onboarding.mp4 -frames:v 1 onboarding.jpg`.

Re-render whenever the UI changes noticeably, since the video shows real screenshots.
