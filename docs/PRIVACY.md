# Privacy: what Schönberg Hero sends, who sees it, how long it stays

Practice data lives on the singer's phone. Four things can reach the choir server (the
messiermarathon Flask app, `/schonberg/api`): the choir's leaderboard and progress shared with the
section lead (both part of joining a choir), and things that are the singer's own choice (usage
statistics, a choir account, the daily practice reminder). Settings → Privacy shows a short version of this page.

## In short: who sees what, by name

- **Everyone in the choir** (anyone with the choir code): your first name, voice part and readiness for
  each programme piece, with your streak and weekly points, on the choir's leaderboard (unless you switch it off).
- **Your section lead and the choir admins** (every choir member shares unless they switch it off): your voice range, by name. Per-bar
  detail (hardest bars, level spread, ready counts, trends) only as totals for the section.
- **In a small section** (three or four singers sharing), a lead who knows who practised what may still
  be able to work out one singer's detail from the totals, or from how they change after that singer
  practises.
- **The super admin**: anonymous usage totals (daily, and hourly for the last two days), never linked to a name.
- **Everyone in the choir, live**: how many singers of each voice part have the singing screen open right
  now (counts only, no names; see 0a).
- **Nobody**: the daily practice reminder (if switched on) is known to the server only by the
  browser's push address, with no name and no link to a choir or an account (see 4).

## 0. The choir's leaderboard (every choir member with a name)

- **Sent** when the singer opens Ranks and after each finished run on a programme piece (at most once a minute per piece), to
  `PUT /schonberg/api/choirs/<code>/entries/<name>`: first name, voice part, piece, readiness, weekly
  points, streak and the 7-day readiness gain. Joining a choir with a code puts the singer on its board; **Settings → Privacy → "Show me on the
  choir's leaderboard"** takes them off: the app stops posting and asks the server to delete all
  entries under their name (`DELETE …/entries/<name>`).
- **Who sees it**: anyone who opens Ranks (or the Choir tab's short board) with the choir's code, by name.

## 0a. Practising now (every choir member, counts only)

- **Sent** while the singing screen is open (and the app is in the foreground), every 20 seconds, to
  `POST /schonberg/api/choirs/<code>/presence`: a random id made for this purpose only (not the member
  token, not the account, no name; new for each browser tab, kept only while the tab is open), the singer's voice part, and whether they are on the screen or just
  left it.
- **Switch**: Settings → Privacy → "Count me in Practising now" (on by default).
- **Who sees it**: anyone with the choir code, on Home, as counts per voice part ("S 2 · A 0 · T 1 · B 0"),
  updated every few seconds. In a small choir a count of 1 may tell others who it probably is.
- **Kept** in the server's memory only, never on disk by the app; a heartbeat stops counting after 50
  seconds and everything is gone when the server restarts. The client address is held in memory for a
  minute for the rate limit; the hosting's request logs may record requests like any other page load.

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
  or failed, voice lined up), the headphone/mic delay in use (50 ms buckets, once a day; once an hour for the last 24 hours) and error
  counts (microphone, score import, JavaScript errors as an 8-hex hash of the first line of the
  message, digits removed: the message itself is not sent).
- **What is sent** for the daily totals: at most once a day (when the app starts or is hidden on a later day), the finished
  days (up to a week back) to `POST /schonberg/api/metrics` as
  `{ v: 1, id, days: [{ day, c: { counter: number } }] }`. `id` is a random 128-bit install id made only
  for this (`localStorage['shm:anonId']`): not the member token, not the choir account, not the name,
  and outside the `sh:` keys, so backups and synced progress never carry it.
- **Also sent, for the "last 24 hours" view**: while the app is in use, what was counted since the
  last send, by UTC hour, at most every 5 minutes (and when the app is hidden), to
  `POST /schonberg/api/metrics/live` as `{ v: 1, id, batch, hours: [{ hour: "YYYY-MM-DDTHH", c }] }`
  (same counters and install id; `batch` is a random id per send so a resend counts once).
- **What the server keeps** (`utils/schonberg_metrics.py`, `DATA_DIR/schonberg_metrics/`):
  - daily totals only (`days/YYYY-MM-DD.json`): installs active, counters summed over installs, how many
    installs used each feature, browser / OS / mobile-or-desktop families parsed from the User-Agent
    (the header itself is not stored), and once a day can no longer change (8 days later) the weekly
    and 28-day actives and, on Mondays, how many of that week's installs came back the next week.
    Kept 400 days.
  - to count an install once a day and compute weekly/28-day actives and the return rate:
    `actives/YYYY-MM-DD.json`, the set of 16-hex HMAC-SHA256 hashes of the install ids active that day,
    keyed with a random server secret. Raw ids are never written. Each day's set is deleted after
    35 days; only the totals remain.
  - for the last 24 hours: `hours/YYYY-MM-DDTHH.json`, that hour's counter totals and, per hashed install
    (same keyed hash), the features and browser / OS / device families it used and its last batch ids.
    Deleted after about 48 hours (the next clean-up, at most hourly); only the daily totals remain. The
    hour files have their own 5 MB cap, so they can never crowd out the daily totals.
- **Abuse limits**: unknown keys ignored, counts clamped per key, 16 KB per request (refused without a
  Content-Length), 8 days per request, 10 distinct error hashes per install and day (200 per day file),
  30 requests an hour per client address (IPv6: /64), 3000 an hour in all (live sends: 600 and
  12000 an hour, 8 hours per request, 2000 installs per hour file), and the metrics folder is
  capped at 20 MB (then 507). Summaries older than 7 days are refused.
- **Who sees it**: only the super admin (Admin → Usage), as charts and a CSV of
  daily totals (and of the last 24 hours, by the hour).

## 2. Sharing progress with the choir (on when joining a choir; switch in Settings → Privacy)

- **Switching it off** (Settings → Privacy → "Share my practice with my section lead", after a
  confirmation that explains the totals) withdraws what was shared from the server and stops sending.
  The app then never asks to start again; a new join or login keeps it off; the choice follows a
  choir account to other phones (running the current app version).

- **Sent** after runs (at most once a minute): the singer's name (or account name), voice part, per
  programme piece the readiness, the piece level, how each bar is going, the notes that keep going
  wrong (note number, how often lately, the usual kind: flat, sharp, a wrong note, not sung, too short,
  an octave off or unsteady; only notes wrong in half the recent runs or more, after at least two runs; at
  most 150 per piece and 1200 in all, from `src/progress/notestats.ts`) with the id of the part sung, and the voice
  range from the range check (steady range, wider reach, date measured).
- **Section leads and admins see progress only aggregated** (`utils/schonberg_insights.py`): per
  section how many share and were active this week; per piece the level distribution, rehearsal- and
  concert-ready counts, average readiness, hardest bars, the trend versus a week ago and the
  **rehearsal cheat sheet**: per part (divisi parts apart) with at least 3 singers sharing in it, the
  notes at least two of them keep getting wrong, how many, and their usual faults counted together. It
  is computed when viewed, so in a small section a change right after one singer's run may hint at
  that singer's notes (as with the other totals, see below). Distributions,
  bars and trends appear only when **at least 3 singers** share that piece (a bar only when 3 have
  sung it); below that only the counts. These views show no name next to bars, levels or readiness.
  (Readiness by name is on the choir's leaderboard anyway, see above.)
- **Small sections**: with only three or four singers sharing, a lead may still be able to work out one
  singer's detail (for example the only singer who practised this week, or the change in the totals
  after someone's run). The 3-singer rule hides one or two singers' numbers, not more.
- **Choir admins: who uses the app.** Admin → Sections lists each singer who shares or is on the
  leaderboard by first name and voice part (as the voice ranges already do), and for singers on the
  leaderboard when their entry there last changed (as every member can see on the board). Nothing
  more is sent for it. Section leads don't see this list.
- **By name**: the voice range, so leads can plan divisi. A lead sees the ranges of the sections
  they lead, an admin all sections; members see none.
- Trend snapshots: one per day of the section totals (no names), kept 28 days in
  `DATA_DIR/schonberg_insights/<choir>.json`, deleted with the choir.

## 3. A choir account (optional)

Keeps the singer's progress on the server so it follows them to another phone (see
`utils/schonberg_sync.py`). Admins see members' names in People and can remove them (their progress
goes too).

## 4. The daily practice reminder (optional, off by default)

A notification at a time the singer picks ("Time for today's practice · About 10 minutes: your plan
is ready."), only on days they haven't practised yet. Works for singers with or without a choir
account; it needs the browser's notification permission, asked only when the singer switches it on
(You → Practice, or the one-time offer on Today done). On iPhone and iPad it works only in the app
added to the Home Screen (iOS 16.4 or later).

- **Sent** (`src/progress/reminders.ts`): when switched on, and again when the app starts (at most
  every 6 hours, or when the subscription or the time zone changed, or a new time hasn't reached the
  server yet: a time changed offline goes when the phone is back online or the app is opened again), to
  `POST /schonberg/api/reminders`: the browser's push subscription (the push service's address for this
  browser, e.g. at Google, Mozilla, Apple or Microsoft, and the two keys that encrypt the message), the
  reminder time (`HH:MM`), the phone's time zone (e.g. `Europe/Berlin`) and, if the singer already
  practised that day, the date. After the day's first run (any run: counted or practice), once a day, to
  `POST /schonberg/api/reminders/practised`: the push address and the date (`YYYY-MM-DD`) only, nothing
  about the run (sent again when back online if the phone was offline). If the server answers that it
  doesn't know the subscription (404, e.g. it expired), the app posts the subscription again as above.
  When the browser renews its push subscription, the service worker posts the new one with the old
  address (`replaces`) and no time or zone: the server copies them from the old one, which it then
  deletes. No name, no choir code, no account, no member token.
- **A confirmation**: a new subscription gets one visible notification within a minute, "Reminder set
  for 18:00". That is how the server knows the subscription is real.
- **Kept on the server** (`utils/schonberg_reminders.py`, `DATA_DIR/schonberg_reminders/subs.json`), per
  subscription: the push address and its two keys, the time, the time zone, the last day practised, the
  last day a reminder was sent, the day it was made, the day the app was last in touch (to expire it),
  whether a notification ever reached it, and how many sends in a row failed. The server's own signing
  key for push (VAPID) is made on the server and kept in the same folder (never in the code repository,
  the server image or its seed data).
- **Deleted**: when the singer switches the reminder off (the browser drops the subscription too; if
  the phone is offline, the app asks again on its next start); when the push service says the
  subscription doesn't exist or isn't valid (400, 403, 404 or 410, e.g. the app was removed or
  notifications were turned off); after 5 failed sends in a row; when no notification (not even the
  confirmation) reached a new subscription within 2 days; and after 60 days without any contact from
  the app. Posting the subscription again doesn't extend the last three. Switching notifications off in
  the phone's settings also switches the reminder off on the next start.
- **Who sees it**: nobody. The server only uses it to send the reminder. The message is encrypted for
  the singer's browser; the push service (Google, Mozilla, Apple or Microsoft, depending on the browser)
  delivers it and sees when it is sent, not what it says.
- **Abuse limits**: only addresses of the known push services are accepted (checked strictly; the
  server never follows a redirect, reads at most 64 KB of an answer and gives up on a push after 10
  seconds), the encryption key must be a valid P-256 key, at most 5,000 reminders on the server; new
  ones: 80 an hour per client address (a choir on one Wi-Fi), 200 per IPv6 /48 and 500 in all; 120
  changes a minute per client address (600 in all) besides the general limit. The client address is
  held in memory for the rate limits only.

Recordings never leave the phone unless the singer shares one themselves.
