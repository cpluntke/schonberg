# Onboarding video source

`public/media/onboarding.{mp4,webm,jpg}` are rendered from these files: a two-voice dialogue
(Nora = coach, Ben = singer) over animated app screenshots.

1. `script.json`: the dialogue (`say` = spoken text, `show` = subtitle, `scene` = visual group).
2. `python3 voice.py <dir>`: Kokoro TTS (kokoro-onnx, voices af_heart / am_michael) →
   `narration.wav` + `timeline.json`.
3. Copy fresh screenshots into `<dir>/img/` (`docs/screenshots/*.png`, `public/icon.svg`) and
   fonts into `<dir>/fonts/` (IBM Plex Mono, Bricolage Grotesque, Source Serif 4).
4. `node render.cjs <dir> <dir>/onboarding.mp4`: canvas frames via Playwright → ffmpeg.
5. `ffmpeg -i onboarding.mp4 -c:v libvpx-vp9 -b:v 0 -crf 40 -c:a libopus onboarding.webm` and a
   poster: `ffmpeg -ss 3 -i onboarding.mp4 -frames:v 1 onboarding.jpg`.

Re-render whenever the UI changes noticeably, since the video shows real screenshots.
