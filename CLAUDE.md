# Working on Schönberg Hero

- Deploy: see docs/DEPLOY.md (export into the messiermarathon repo with `scripts/export-messier.sh`, PR there, merge, check `/schonberg/VERSION`).
- Before every deploy, review with sub-agents (code review + browser QA) and classify findings P0–P3; ship only with no P0/P1 open.
- **Onboarding video:** with every feature change, decide whether `public/media/onboarding.*` is still true
  (screens shown, number of levels, setup steps, wording). If not, update `media-src/onboarding/script.json`
  and re-render (see `media-src/onboarding/README.md`). The video must end on one or two concrete things a
  first-time viewer can do right away; the "Try it now" steps under the player (`src/ui/components/IntroVideo.tsx`)
  must match the video's ending.
