# Schönberg Hero leaderboard server (optional)

The app works without it. Singers can swap "ranking codes" in the group chat instead.
This server is a small shared board per choir. It needs Node 22 and has no dependencies.

## Run locally

```sh
node server/index.mjs            # listens on :8787, data in ./data/leaderboard.json
VITE_LEADERBOARD_URL=http://localhost:8787 npm run dev
```

Environment variables: `PORT` (default 8787) and `DATA_FILE` (default `./data/leaderboard.json`).

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ ok: true }` |
| GET | `/choirs/:code/entries?pieceId=…` | `{ entries: [...] }` |
| PUT | `/choirs/:code/entries/:name` | body is a `LeaderboardEntry`. `name` must match the URL. One entry is kept per name and piece. |

- The choir code is 3–40 characters from `[A-Za-z0-9_-]` and is case-insensitive. Anyone who knows the code can read and post to that board, so treat it as a shared password.
- Limits: a 4 KB body, 60 requests per minute per IP, 2000 entries per choir and 500 choirs.
- CORS is `*`. The server sets `updatedAt` itself.

## Deploy on Render

1. Create a new **Web Service** from this repo.
2. Set Runtime to Node, Build Command to `true` (nothing to build), and Start Command to `node server/index.mjs`.
3. Optional: attach a **Disk** (for example mounted at `/var/data`) and set `DATA_FILE=/var/data/leaderboard.json`. Without a disk, entries are lost on every redeploy, which is acceptable for a weekly board.
4. Build the app with `VITE_LEADERBOARD_URL=https://<your-service>.onrender.com`.

The same steps work on any host that runs Node, such as Fly.io, a VPS or Railway.
