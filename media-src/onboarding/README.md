# Onboarding video source

`public/media/onboarding.{mp4,webm,jpg}` are rendered from these files: a two-voice dialogue
(Nora = coach, Ben = singer) over animated app screenshots. Current cut: about 2:10 (130 s),
scenes A title · B voice setup (choir code, range check, delay) · C practice screen (score
view with a zoom on a flat note, the Score/Highway toggle, the highway, the ± cents bubble) · D level ladder (5 levels) · E coach notes · F Home · G "try it now" checklist.

1. `script.json`: the dialogue (`say` = spoken text, `show` = subtitle, `scene` = visual group).
   `video.html` refers to lines by index (`at(i,frac,t)`, `since(i,t)`, `L(i)`, `win(t,a,b)`), so
   re-map the indices in the scene functions whenever lines are added or removed.
2. `python3 voice.py <dir>`: Kokoro TTS (kokoro-onnx, voices af_heart / am_michael; model files
   in `/tmp/kokoro`) → `narration.wav` + `timeline.json`.
3. Fresh phone screenshots (390×844 CSS px at deviceScaleFactor 2 → 780×1688) into `<dir>/img/`
   and `docs/screenshots/`: `setup-choir`, `setup-range`, `setup-delay`, `practice-score` (score view at
   level 1, `?simulate=flat`: blue ink just under a note, bubble shows −cents), `practice-highway` (same
   piece and level after tapping Highway), `practice-toggle` (the pre-start card with the Score/Highway
   toggle; render `img/` only), `piece`, `home`, `results` (plus `results-coach`, a full-page
   results screen of a sloppy run, used in scene E for its coach notes; `practice-2d` is the
   project README's highway shot and is no longer used in the video), and `public/icon.svg`. Fonts into `<dir>/fonts/` (IBM Plex Mono
   → `PlexMono.ttf`, Bricolage Grotesque → `Bricolage.ttf`, Source Serif 4 → `SourceSerif.ttf`).
   Tips: the range-check frame needs a voice; an init script that replaces `getUserMedia` with
   a WebAudio stream (an oscillator for the held note, plus the app's own output delayed by
   2.8 s, which "sings back" each pattern) gives a real mid-exercise frame without touching the
   app. `?simulate=perfect` (or `localStorage['sh:simulate']`) gives real practice/results
   screens; `sloppy` gives coach notes.
4. Stills to check layout and sync: `node render.cjs <dir> x 3,22,47.5` writes
   `<dir>/still_<t>.png`. Full render: `node render.cjs <dir> <dir>/onboarding.mp4`
   (canvas frames via Playwright → ffmpeg; must print `errors []`).
5. `ffmpeg -i onboarding.mp4 -c:v libvpx-vp9 -b:v 0 -crf 40 -c:a libopus onboarding.webm` and a
   poster: `ffmpeg -ss 3 -i onboarding.mp4 -frames:v 1 onboarding.jpg`.

Re-render whenever the UI changes noticeably, since the video shows real screenshots.
