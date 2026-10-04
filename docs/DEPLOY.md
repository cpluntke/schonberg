# Putting Schönberg Hero online

The app is a static site: `npm run build` produces `dist/`, which any static host can serve.
The microphone needs **https**, which all of the hosts below provide.

## Option A: Render (Blueprint, recommended)

1. On render.com: **Account settings → GitHub** and give Render access to `cpluntke/schonberg`.
   During the overnight build Render couldn't read the private repo, which is why it isn't online yet.
2. **New → Blueprint**, pick the repo and branch. `render.yaml` creates:
   - `schonberg-hero`: the app (static, free).
   - `schonberg-leaderboard`: the optional live choir leaderboard (free web service; the
     free plan sleeps when idle and loses data on redeploys, which is fine for a weekly board).
3. Share the `https://schonberg-hero.onrender.com` link with the choir. On a phone:
   **Share → Add to Home Screen** installs it like an app (it works offline after the first visit).

To skip the leaderboard server, delete its block from `render.yaml`; the app then uses
share codes that singers paste into the group chat.

## Option B: GitHub Pages

`.github/workflows/pages.yml` builds and deploys on every push to `main`. Enable it under
**Settings → Pages → Source: GitHub Actions**. Pages on a private repo needs a paid GitHub plan.

## Option C: Netlify / Vercel / Cloudflare Pages

Build command `npm run build`, output directory `dist`. No other settings are needed.

## Choir leaderboard

Set `VITE_LEADERBOARD_URL` at build time to the server's URL (the Render blueprint does this
for you). In the app, singers enter the same **choir code** under Ranks. See `server/README.md`.
