# Round 6 QA gate: Schönberg Hero

HEAD `5a56ec6`, which contains the round-5 gate fixes. Date 2026-10-04. Priorities follow `docs/priorities.md`.

## Verdict

**CLEAN: P0: 0, P1: 0, P2: 6, P3: 3.**

R5-01 (P1) is fixed:

- An on-time singer no longer gets 'behind-beat': 0 of 207 runs, down from 191.
- A dragging singer gets it in 207 of 207 runs.
- 'Scooping' is shown again in 162 of 207 scooper runs, up from 52.

No good-singer style fails across the board at L1. Failures at L2–L3 are limited to a few fast or patter sections, and they depend on the singer model (see R6-01). The real-audio matrix gave 40/40 cases with no page errors, and every verdict is defensible. The 390×844 smoke had 0 page errors and 0 horizontal overflow.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | `npx vitest run` | **PASS**: 16 files, 192 tests |
| 1 | `npx playwright test e2e/flow.spec.ts --project=chromium` | **PASS**: 3/3 (1.2 min) |
| 2 | QA probes (`vitest.qa.config.mjs`) | 14/18 files, 38/46 tests. **No product failures.** The failures are all expected or stale (details below). |
| 3 | Real-audio matrix `PAR=3 r4audio-run.mjs` | **40/40 ran, 0 page errors, verdicts musically right** (table below) |
| 4 | New adversarial probes `r6-singers` and `r6-staccato` | 10 styles × L1–L4 × 6 pieces, about 9,000 scored runs. No crash. The degenerate inputs (empty, all-null, NaN, ±Inf, duplicate, negative or shuffled timestamps) all give finite results and the 'quiet' insight. No NaN or undefined appears in coach text. |
| 5 | Browser smoke `r6-smoke.mjs`, 390×844, `?simulate=perfect` and `?simulate=sloppy` | Home, Library, all 6 Piece pages, Setup, Settings, Ranks, Expert, Tuner, Play L1 → Results, Arcade L4 → Results. **0 page errors, 0 horizontal overflow** in both modes. Perfect: L1 and L4 reached at 100%. Sloppy: "Not yet: 52% of 75%" and "51% of 85%". Screenshots are in `docs/qa/shots-r6/`. |

The QA probe failures from check 2:

- `r3cr-timing` CR-05 and CR-10 fail because they copy the old formulas. This is expected.
- `scoring-realism` and `r2-scoring-realism` (2 tests each) fail with ENOENT on the deleted Bach fixtures. This is stale tooling (R5-07).
- `r5-singers` has 2 intentionally strict asserts. The 'good lag50' test fails 57 of 207 runs at L4, which is R5-04 and unchanged (150/207 at HEAD, 150/207 with `R5_OLD`). The 'scooping' test gets 162/207, or 78%, against its 80% bar.

### r5-singers: HEAD vs `R5_OLD=1` (pre-round-4)

| Singer | HEAD | Old |
|---|---|---|
| good lag50 | pass 150/207, **behind-beat 0**, scooping 0 | 150/207, scooping 25 |
| good lag50, consonant 60–80, no jitter | 201/207, **behind-beat 0** | 202/207, scooping 104 |
| drag +150 | **behind-beat 207/207**, wrong-notes 0 | behind-beat 0, wrong-notes 152 |
| scoop 150¢ | **scooping 162**, behind-beat 22, flat-overall 165 | scooping 185, flat-overall 75 |
| flat −35¢ | flat-overall 207/207 | 172 |
| quiet | quiet only, 207/207 | — |
| 'great' on a failed run | 0 | 0 |

In the r5-singers results, 'early-entries' appears 39 times for **every** singer, at both HEAD and old. **This is a probe artifact:** the r5 singer model holds the previous note through written rests. The r6 model rests during rests, and gives 0 early-entries for on-time singers.

### Real-audio matrix

The new smoother compensation lowers the "ok" median onset from about 48–57 ms to **28–35 ms**.

| Case | warm-up L2 / L3 | Dieu L2 / L3 | Notes |
|---|---|---|---|
| ok | pass 100 / 100 | pass 100 / 100 | great ✔ |
| flat30 | pass 85 / fail 48 | pass 85 / fail 71 | flat-overall first ✔. At L2, 30¢ is inside the 35¢ tolerance. |
| late150 (genuinely late) | pass 96 / 96 | **fail 68** / fail 62 | behind-beat ✔ on 3 of 4. Dieu L2 shows only "Wrong notes bars 10–12" because its median onset of 177 ms is just under the 180 ms threshold (R6-02). |
| late150-uncal | pass 100 / 100 | pass 92 / 92 | Not learned, because the onset of 135 ms is below 170. Great ✔. Dieu shows "wrong notes bars 12–13", the known accepted P2. |
| wrong | fail 52 / 52 | fail 51 / 51 | wrong-notes ✔ |
| silence | fail 0 | fail 0 | quiet only ✔ |
| x-late100 | pass 100 / 100 | pass 88 / 85 | Warm-up: great. Dieu: "wrong notes bars 12–13", the same accepted family (R6-02). |
| x-early100 | pass 100 / 100 | pass 93 / 92 | Dieu L3 now also shows early-entries ✔, so R5-06 is partly addressed. |
| x-late250-uncal | learned 239 / 235 | learned 206 / 209 | great ✔ |
| x-late350-uncal | learned 336 / 340 | learned 307 / 307 | great ✔ |

### Adversarial good-singer styles (r6-singers, lag 50 ms, consonant 60–80 ms, jitter ±20–50 ms, 278 runs per level)

| Style | L1 pass | L2 | L3 | Wrong or unfair coach notes |
|---|---|---|---|---|
| consonant-led | 278/278 | 272 | 268 | Only fast sections fail. With lag 30: L2 272, L3 272 (only Ravel A/T bars 20–26 fail). |
| plosive consonants 30–50 ms (lag 30) | 278/278 | 277 | 277 | Only Ravel Bass bars 38–45 fails (94 ms notes) |
| legato melisma, no consonants | 278/278 | 278 | 278 | none |
| very slow (score ×2.5) | 278/278 | 278 | 278 | 2 × late-entries alongside great (P3) |
| steady early, −60 ms | 278/278 | 276 | 276 | none |
| operatic vibrato ±60¢, rate wandering | 278/278 | 267 | 254 | 'Long notes sink' / 'Long notes creep up' in about 12% of runs (R6-03) |
| operatic vibrato ±90¢, rate wandering | 278/278 | 224 | 200 | Drift notes in about 33% of runs (R6-03). Fixed-rate vibrato also gives a false flat-overall or sharp-overall: a probe-model artifact. |
| portamento 150 ms into every note | 278/278 | 157 | 147 | Fails on fast Debussy with "wrong notes". This is defensible, because a 150 ms slide into a 167 ms note is mostly off-pitch. |
| portamento 250 ms | 225/278 | 120 | 119 | **behind-beat ("…Bluetooth headphones…") in 119 runs**, some of them passing runs (R6-04) |
| staccato on every note (45%, unmarked) | 3/278 | 0 | 0 | Expected: the chorales are written legato, so these are wrong durations. The coach says "missed notes" and also contradictory drift notes (R6-03). |
| **staccato only where written**, sung at 50% / 65% (r6-staccato) | 80/80 | 79/80 | 75/80, 78/80 | Ravel: 237 marks, all matched. Yver: 116 matched. Dieu: 7. The importer ignores `<staccato/>`, but the passes survive. Failures are Ravel bars 7–19 and 38–45 at L3, 78–79% against 80% (R6-05). |

## Findings

### R5-01: P1 → **FIXED**

- On-time singers get no 'behind-beat': 0 of 207 runs in every lag, consonant and jitter variant. The real-audio "ok" case is also clean.
- 'Behind-beat' no longer removes 'scooping'.

### R6-01: P2 (continues R5-04, now visible at L2/L3 in a few sections). A good singer can fail L2/L3 on the fastest passages

Affected passages:

- Ravel *Nicolette* Bass bars 38–45: 94–188 ms notes.
- Ravel *Nicolette* Alto/Tenor bars 20–26: "Ta-ka" patter of 167 ms repeated notes. These fail only with long 60–80 ms consonants and pass with realistic 30–50 ms plosives.
- Debussy *Dieu* bars 1–5.

Accuracy is 71–79% against the 80% pass mark. Every other section passes. L1 (tempo 0.7) passes everywhere, so the ladder can be climbed, and lowering strictness is a workaround.

This is model-dependent and synthetic only, so it stays P2. It should be confirmed with real recordings of these bars. It would become P1 if a real good singer cannot pass L2 there.

The root cause is the same as R5-04: about 30–50 ms of detection lag plus the consonant is not compensated on very short notes.

### R6-02: P2 (continues R5-03). A late singer just under the 180 ms threshold gets "Wrong notes" instead of "Behind the beat"

Real audio, Dieu L2, singer 150 ms late (the harness voice has no consonant): median onset 177 ms, result fail 68, coach note "Wrong notes in bars 10–12". The singer is told to learn pitches they already sing correctly. The same family covers "wrong notes bars 12–13" on x-late100 and x-early100 runs that pass.

A real late singer with consonants would measure more than 180 ms. The synthetic drag case (+150) gets behind-beat 207/207.

### R6-03: P2 (pre-existing). The drift diagnosis ('Long notes sink' / 'Long notes creep up') is not vibrato-robust

Drift is the median of the last third minus the median of the first third, compared with a threshold of 15¢. Normal vibrato at ±50–60¢ produces false drift notes:

- 8% of consonant-led good-singer runs at L2.
- 12% of runs with ±60¢ vibrato.
- 33% of runs with ±90¢ vibrato.

The note sometimes appears next to 'Excellent run', and sometimes as the only advice on a failed run. It can also show both directions at once on the same run. Pre-r4 code shows the same rates.

Suggested fix: compare vibrato-smoothed thirds, or require the drift to be at least 25–30¢ when vibrato is wide, and never emit both directions.

### R6-04: P2. Heavy portamento (a 250 ms slide into every note) is diagnosed as 'Behind the beat … Bluetooth headphones'

The voice is on time; only the pitch arrives late. The scorer's drag-vs-scoop rule ("still on the previous pitch with no voicing break" counts as dragging) classes a legato slide as dragging. This hits 119 of 278 runs at L2, some of them passing runs.

The 150 ms portamento case is mostly fine (5 runs). A scoop-like or "slide" note would be the right coach. This style is not a good singer, so it stays P2.

### R6-05: P2. Staccato marks are ignored by import/scoring

There are 237 marks in Ravel and 143 in Yver. Singers who obey them lose body coverage. The impact is small: L1/L2 pass 159 of 160, and L3 fails 4–5 Ravel sections by about 1–2 points.

### R5-02: P2 (narrowed). The latency learner can store a drag as delay

The threshold is now `med/rate > 170`. The real "uncal 150" case is no longer learned (135 ms), and on-time singers are safe. A steady dragger at about 230 ms still qualifies. This is code reading plus the measured medians.

### P3

- **Scooping residual:** 162/207, against 185 pre-r4. On the remaining scooper runs 'flat-overall' is shown instead, which is half-true.
- **Very slow pieces:** 2 runs show 'late-entries' next to 'great' (Yver bars 33–40 Bass).
- **Stale tooling:** the Bach fixtures in the old realism probes (R5-07). The r5 singer model also holds notes through rests, which produces the fake 'early-entries' results.

## Files added or touched (QA only; no changes to `src/`, `public/`, `e2e/` or configs; no commits)

- `docs/qa/scripts/r6-singers.qa.test.ts`: style matrix. `R6_LAG=30` sets the lag; `R6_ONLY=1` runs the extra styles (plosives, wandering vibrato).
- `docs/qa/scripts/r6-staccato.qa.test.ts`: a singer who follows the written staccato marks, parsed from MusicXML.
- `docs/qa/scripts/r6-smoke.mjs` and `docs/qa/shots-r6/`: browser smoke covering all 6 piece pages.
- `r4audio-run.mjs` rewrote `docs/qa/r4audio/*.png` and `results.json`.
