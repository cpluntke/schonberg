# Privacy: what Schönberg Hero sends, who sees it, how long it stays

Practice data lives on the singer's phone. Three things can reach the choir server (the
messiermarathon Flask app, `/schonberg/api`), each the singer's own choice. Settings → Privacy shows a
short version of this page.

## 1. Anonymous usage statistics (on by default, switch in Settings → Privacy)

Purpose: to see how the app is used and where it fails, so it can be improved.

- **Off by default when the browser asks not to be tracked** (`navigator.doNotTrack === '1'` or Global
  Privacy Control); the singer can still switch it on. Switching it off deletes what is pending.
- **What is counted on the phone** (`src/progress/metrics.ts`, `src/ui/usage.ts`), per day: runs by mode
  (section, whole piece, practice, drill, arcade, cold start, words in rhythm, listen) and level,
  passes, seconds practised, attempts until a level passed (bucketed), days from the first practice
  of a piece to rehearsal-ready (bucketed), whole-piece runs with or without a to-fix list, features
  used (sheet music, highway, full score, arcade, memorisation, lyrics quiz, memory map, cold start,
  words in rhythm, joined a choir, choir account, progress sync, shares progress), the first-setup
  steps reached (setup started, choir step, range check done/skipped, delay check done/skipped, first
  run, first pass), scoring quality (hit rate by note-length bucket, delay-check hints, timing unsure
  or failed, voice lined up), the headphone/mic delay in use (50 ms buckets, once a day) and error
  counts (microphone, score import, JavaScript errors as an 8-hex hash of the first line of the
  message, digits removed: the message itself is not sent).
- **What is sent**: at most once a day (when the app starts or is hidden on a later day), the finished
  days (up to a week back) to `POST /schonberg/api/metrics` as
  `{ v: 1, id, days: [{ day, c: { counter: number } }] }`. `id` is a random 128-bit install id made only
  for this (`localStorage['shm:anonId']`): not the member token, not the choir account, not the name,
  and outside the `sh:` keys, so backups and synced progress never carry it.
- **What the server keeps** (`utils/schonberg_metrics.py`, `DATA_DIR/schonberg_metrics/`):
  - daily totals only (`days/YYYY-MM-DD.json`): installs active, counters summed over installs, how many
    installs used each feature, browser / OS / mobile-or-desktop families parsed from the User-Agent
    (the header itself is not stored), and once a day can no longer change (8 days later) the weekly
    and 28-day actives and, on Mondays, how many of that week's installs came back the next week.
    Kept 400 days.
  - to count an install once a day and compute weekly/28-day actives and the return rate:
    `actives/YYYY-MM-DD.json`, the set of 16-hex SHA-256 hashes of the install ids active that day,
    keyed with a random server secret. Raw ids are never written. Each day's set is deleted after
    35 days; only the totals remain.
- **Abuse limits**: unknown keys ignored, counts clamped per key, 16 KB per request, 8 days per
  request, 10 distinct error hashes per install and day (200 per day file), 30 requests an hour per
  client address (IPv6: /64), 3000 an hour in all, and the metrics folder is capped at 20 MB (then
  507). Summaries older than 7 days are refused.
- **Who sees it**: only the super admin (Choir → super admin → Usage insights), as charts and a CSV of
  daily totals.

## 2. Sharing progress with the choir (off by default, switch in Settings → Your choir)

- **Sent** after runs (at most once a minute): the singer's name (or account name), voice part, per
  programme piece the readiness, the piece level and how each bar is going, and the voice range from
  the range check (steady range, wider reach, date measured).
- **Section leads and admins see progress only aggregated** (`utils/schonberg_insights.py`): per
  section how many share and were active this week; per piece the level distribution, rehearsal- and
  concert-ready counts, average readiness, hardest bars and the trend versus a week ago. Distributions,
  bars and trends appear only when **at least 3 singers** share that piece (a bar only when 3 have
  sung it); below that only the counts. **No name is shown next to progress.**
- **By name**: only the voice range, so leads can plan divisi. A lead sees the ranges of the sections
  they lead, an admin all sections; members see none.
- Trend snapshots: one per day of the section totals (no names), kept 28 days in
  `DATA_DIR/schonberg_insights/<choir>.json`, deleted with the choir.

## 3. A choir account (optional)

Keeps the singer's progress on the server so it follows them to another phone (see
`utils/schonberg_sync.py`). Admins see members' names in People and can remove them (their progress
goes too).

Recordings never leave the phone unless the singer shares one themselves.
