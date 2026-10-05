// Merges qa/realism/out/parts/*.json (written by cmp-*.test.ts) into
// qa/realism/out/report-current.json and docs/qa/realism-current.md (before/after tables).
// Runs from the vitest global teardown (global-setup.ts); imports no app code.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const PARTS = resolve(ROOT, 'qa/realism/out/parts');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : `${Math.round(x * 100)}%`);
const p0 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : `${Math.round(x * 100)}`);
const f0 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : `${Math.round(x)}`);
const f1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(1));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const hist = (ls: string[]) => ['S', 'A', 'B', 'C', 'D'].map((l) => [l, ls.filter((x) => x === l).length] as const).filter(([, n]) => n).map(([l, n]) => `${l}×${n}`).join(' ');
const pass = (p: boolean) => (p ? 'pass' : 'FAIL');

/** One run, compact: "S 99 ✓ al+120 →L250 TF310 [late]". */
function run(r: Any, opts: { tips?: boolean } = {}): string {
  let s = `${r.letter} ${p0(r.accuracy)}${r.passed ? '' : ' ✗'}`;
  if (r.alignedMs) s += ` al${r.alignedMs > 0 ? '+' : ''}${r.alignedMs}`;
  if (r.learnedMs) s += ` →${r.learnedMs}ms`;
  if (r.timingFailMs) s += ` TF${r.timingFailMs}`;
  if (opts.tips) {
    const t = (r.insights as string[]).filter((k) => /late|behind|early|wrong/.test(k));
    if (t.length) s += ` [${t.join(',')}]`;
  }
  return s;
}
const runs = (chain: Any, o?: { tips?: boolean }) => (chain ? chain.runs.map((r: Any) => run(r, o)).join(' · ') : '–');
const chain = (chains: Any[], label: string) => chains.find((c: Any) => c.label === label);

function read(name: string): Any | null {
  try { return JSON.parse(readFileSync(resolve(PARTS, `${name}.json`), 'utf8')); } catch { return null; }
}

export function writeCurrentReport(): boolean {
  if (!existsSync(PARTS) || readdirSync(PARTS).filter((f: string) => f.endsWith('.json')).length === 0) return false;
  const meta = read('meta');
  const grid = [...(read('grid-l1') ?? []), ...(read('grid-l4') ?? [])];
  const seqL2 = read('seq-l2');
  const rep = read('repeat');
  const sanity = read('sanity');
  const violations = read('sanity-violations');
  const tm = read('tm');
  const fid = read('fidelity');
  const bleed = read('bleed');
  const abl = read('ablation');
  const roundtrip = read('roundtrip');
  const fast = read('fast');
  writeFileSync(resolve(ROOT, 'qa/realism/out/report-current.json'), JSON.stringify({ meta, grid, seqL2, rep, sanity, violations, tm, fid, bleed, abl, roundtrip, fast }, null, 1));

  const L: string[] = [];
  L.push('# Realism: before / after the scoring fixes');
  L.push('');
  L.push(`Generated ${new Date().toISOString()} by \`npx vitest run --config vitest.realism.config.ts\` (files \`qa/realism/cmp-*.test.ts\`). The same rendered takes are scored by both pipelines:`);
  L.push('');
  L.push('- **before** = baseline app (frozen `qa/realism/baseline/`, as in `docs/qa/realism-baseline.md`): N=2048 window, `scoreAttempt`, onset-based delay learning that re-scores the same run, pass = accuracy only, and an uncalibrated estimate of 80 ms.');
  L.push(`- **after** = current app at ${meta ? `\`${meta.head}\`${meta.dirty?.length ? ` plus uncommitted changes in ${meta.dirty.map((f: string) => `\`${f}\``).join(', ')}` : ''}` : 'the working tree'}. The analysis window comes from \`windowFor(part.low)\` (${meta?.windowN ?? '1024'} for these alto parts). Then \`scoreAttempt\` → \`scoreAligned\`, two-run delay learning and the Android estimate of 130 ms. Play.tsx/session policy detected from the source: ${meta ? meta.policy.join('; ') : '–'}.`);
  L.push('- **after (80 ms estimate)** = the current app with the old 80 ms estimate (an iPhone-like device). It separates the estimate change from the rest.');
  L.push('');
  L.push('Run cells: `grade accuracy%` (✗ = run failed), `al±N` = the voice was shifted N ms for intonation, `→N ms` = the stored delay changed to N, `TF` = failed by the timing gate (median entry in ms), `[…]` = timing/wrong-note tips. Sequences are 3 consecutive runs (new performance each run) on a phone whose stored delay carries over.');
  L.push('');

  // ---------------- key numbers
  L.push('## Key numbers');
  L.push('');
  const good = grid.filter((g: Any) => g.singer === 'good choir singer');
  for (const lvl of [1, 4]) {
    const gl = good.filter((g: Any) => g.level === lvl);
    if (!gl.length) continue;
    const cb = gl.map((g: Any) => g.cal.before);
    const ca = gl.map((g: Any) => g.cal.after);
    L.push(`- **Good singer L${lvl}, calibrated:** before ${pct(mean(cb.map((r: Any) => r.pitch)))} in tune / ${pct(mean(cb.map((r: Any) => r.accuracy)))} acc (${hist(cb.map((r: Any) => r.letter))}), after ${pct(mean(ca.map((r: Any) => r.pitch)))} / ${pct(mean(ca.map((r: Any) => r.accuracy)))} (${hist(ca.map((r: Any) => r.letter))}).`);
    for (const ms of ['200', '280']) {
      const per = (label: string, k: number) => gl.map((g: Any) => chain(g.uncal[ms], label)?.runs[k]).filter(Boolean);
      const txt = (label: string) => [0, 1, 2].map((k) => { const rs = per(label, k); return rs.length ? `run ${k + 1}: ${pct(mean(rs.map((r: Any) => r.pitch)))}/${pct(mean(rs.map((r: Any) => r.accuracy)))} ${hist(rs.map((r: Any) => r.letter))} (${rs.filter((r: Any) => r.passed).length}/${rs.length} pass)` : ''; }).filter(Boolean).join('; ');
      L.push(`- **Good singer L${lvl}, true ${ms} ms, uncalibrated** (in tune/acc over 6 sections): before ${txt('before')}. After ${txt('after')}. After with 80 ms estimate: ${txt('after (80 ms estimate)')}.`);
    }
  }
  if (seqL2) {
    const by = (ms: number, label: string) => seqL2.filter((q: Any) => q.trueLatencyMs === ms).map((q: Any) => chain(q.chains, label).runs.map((r: Any) => r.letter).join('/')).join(', ');
    L.push(`- **C/A/A check, Debussy bars 1–5 at L2, 3 runs × 4 seeds (letters per run):** ${[200, 215, 230, 280].map((ms) => `true ${ms} ms: before ${by(ms, 'before')}; after ${by(ms, 'after')}`).join('. ')}.`);
  }
  if (fid) {
    const g = fid.find((r: Any) => r.singer === 'good choir singer');
    const bl = fid.find((r: Any) => /bleed/.test(r.singer));
    if (g) L.push(`- **Tracker (good singer):** steady median ${f1(g.before.smoothed.steady.medianAbs)} → ${f1(g.after.smoothed.steady.medianAbs)}¢, near-transition p90 ${f1(g.before.smoothed.nearTransitions.p90Abs)} → ${f1(g.after.smoothed.nearTransitions.p90Abs)}¢, displayed overshoot ${f0(g.before.overshoot.detected)} → ${f0(g.after.overshoot.detected)}¢ (voice ${f0(g.after.overshoot.voiceCentre)}¢), invented ${pct(g.before.overshoot.invented)} → ${pct(g.after.overshoot.invented)}.`);
    if (bl) L.push(`- **Tracker with speaker bleed −13 dB (L1):** octave/subharmonic readings ${pct(bl.before.smoothed.overall.octave)} → ${pct(bl.after.smoothed.overall.octave)}, >50¢ off ${pct(bl.before.smoothed.overall.over50)} → ${pct(bl.after.smoothed.overall.over50)}, scored ${pct(bl.scored.before.acc)} → ${pct(bl.scored.after.acc)} accuracy.`);
  }
  if (bleed) {
    const cell = (db: number, lvl: number, k: 'before' | 'after') => {
      const rs = bleed.filter((r: Any) => r.singer === 'good choir singer' && r.latency === 'cal' && r.bleedDb === db && r.level === lvl);
      return `${pct(mean(rs.map((r: Any) => r[k].accuracy)))}`;
    };
    L.push(`- **Speaker bleed, good singer, calibrated (accuracy, mean of 2 sections, before → after):** ${[-18, -13, -8].map((db) => `${db} dB: L1 ${cell(db, 1, 'before')} → ${cell(db, 1, 'after')}, L4 ${cell(db, 4, 'before')} → ${cell(db, 4, 'after')}`).join('; ')}.`);
  }
  {
    const gl = good.filter((g: Any) => g.level === 1);
    if (gl.length) {
      const b = (k: 'before' | 'after', f: string) => mean(gl.map((g: Any) => g.cal[k].bubble[f]));
      const u = (k: string, f: string) => mean(gl.map((g: Any) => chain(g.uncal['280'], k)?.runs[0]?.bubble[f]).filter((x: Any) => x != null));
      L.push(`- **Live cents bubble after a note change (good singer, L1):** readout toward the previous note beyond tolerance in ${pct(b('before', 'lagShare'))} → ${pct(b('after', 'lagShare'))} of changes (calibrated), ${pct(u('before', 'lagShare'))} → ${pct(u('after', 'lagShare'))} at true 280 ms uncalibrated (run 1); beyond the new note ${pct(b('before', 'overShare'))} → ${pct(b('after', 'overShare'))}; out of tolerance until ${f0(b('before', 'settleMs'))} → ${f0(b('after', 'settleMs'))} ms.`);
    }
  }
  if (roundtrip) L.push(`- **Real-recording path** (16-bit WAV + current-app sidecar → \`scoreRecordingApp\`): accuracy ${pct(roundtrip.direct)} direct vs ${pct(roundtrip.viaWav)} via the file (shift ${roundtrip.alignedDirect} / ${roundtrip.alignedWav} ms).`);
  if (violations) L.push(`- **Sanity guard (current app):** ${violations.length ? `**${violations.length} violation(s)**: ${violations.join('; ')}` : 'all must-fail runs fail'}.`);
  if (fast) {
    const lost = (lvl: number, k: 'before' | 'after') => {
      const rs = fast.good.filter((r: Any) => r.level === lvl && r[k]);
      const n = rs.reduce((x: number, r: Any) => x + fastTotal(r[k]), 0);
      return rs.length ? pct1(rs.reduce((x: number, r: Any) => x + fastLost(r[k]), 0) / Math.max(1, n)) : '–';
    };
    L.push(`- **Fast notes (< 0.15 s), good singer, measured delay — share scored ok/miss, before (\`${fast.baseRef ?? '–'}\`) → after:** ${[1, 2, 4].map((l) => `L${l} ${lost(l, 'before')} → ${lost(l, 'after')}`).join(', ')}. See section 7.`);
  }
  L.push('');

  const obsPath = resolve(ROOT, 'qa/realism/observations-current.md');
  if (existsSync(obsPath)) {
    L.push(readFileSync(obsPath, 'utf8').trim());
    L.push('');
  }

  // ---------------- 1. fidelity
  if (fid) {
    L.push('## 1. Tracker fidelity (smoothed output vs ground-truth f0, cents), before → after');
    L.push('');
    L.push('Takes: dieu-1-5 and warmup-7-12 (Alto), L4 tempo, calibrated, headphones unless noted. "after" = current window and the subharmonic correction the scorer applies.');
    L.push('');
    const ba = (r: Any, f: (x: Any) => number, fmt = f1) => `${fmt(f(r.before))} → ${fmt(f(r.after))}`;
    L.push(table(
      ['singer', 'steady med', 'steady p90', 'near p90', 'near p99', '>50¢ near', 'octave', 'missed voiced', 'false voiced', 'overshoot voice / tracker', 'invented', 'scored in tune / acc'],
      fid.map((r: Any) => [
        r.singer, ba(r, (x) => x.smoothed.steady.medianAbs), ba(r, (x) => x.smoothed.steady.p90Abs), ba(r, (x) => x.smoothed.nearTransitions.p90Abs),
        ba(r, (x) => x.smoothed.nearTransitions.p99Abs, f0), ba(r, (x) => x.smoothed.nearTransitions.over50, pct), ba(r, (x) => x.smoothed.overall.octave, pct),
        ba(r, (x) => x.missedVoiced, pct), ba(r, (x) => x.falseVoiced, pct),
        `${f0(r.before.overshoot.voiceCentre)} / ${f0(r.before.overshoot.detected)} → ${f0(r.after.overshoot.detected)}`,
        ba(r, (x) => x.overshoot.invented, pct),
        `${pct(r.scored.before.pitch)}/${pct(r.scored.before.acc)} → ${pct(r.scored.after.pitch)}/${pct(r.scored.after.acc)}`,
      ]),
    ));
    L.push('');
  }

  // ---------------- 2. grid
  if (grid.length) {
    L.push('## 2. Good singers: latency × section × level, before → after');
    L.push('');
    for (const singer of [...new Set(grid.map((g: Any) => g.singer))] as string[]) {
      L.push(`### ${singer}`);
      L.push('');
      L.push('Calibrated = true and measured delay 150 ms. Oracle = true f0 with the true latency (no tracker), plain scorer.');
      L.push('');
      L.push(table(
        ['section', 'L', 'before in tune / acc', 'before', 'after in tune / acc', 'after', 'oracle acc before / after', 'bubble lag before / after'],
        grid.filter((g: Any) => g.singer === singer).map((g: Any) => [
          g.target, g.level, `${pct(g.cal.before.pitch)} / ${pct(g.cal.before.accuracy)}`, `${g.cal.before.letter} ${pass(g.cal.before.passed)}`,
          `${pct(g.cal.after.pitch)} / ${pct(g.cal.after.accuracy)}`, `${run(g.cal.after)}`,
          `${pct(g.cal.oracleBefore)} / ${pct(g.cal.oracleAfter)}`, `${pct(g.cal.before.bubble.lagShare)} / ${pct(g.cal.after.bubble.lagShare)}`,
        ]),
      ));
      L.push('');
      L.push('Uncalibrated phone (fresh profile, then runs 2–3 with whatever the app stored):');
      L.push('');
      L.push(table(
        ['section', 'L', 'true', 'before', 'after', 'after (80 ms estimate)'],
        grid.filter((g: Any) => g.singer === singer).flatMap((g: Any) => ['200', '280'].map((ms) => [
          g.target, g.level, `${ms} ms`, runs(chain(g.uncal[ms], 'before')), runs(chain(g.uncal[ms], 'after')), runs(chain(g.uncal[ms], 'after (80 ms estimate)')),
        ])),
      ));
      L.push('');
    }
  }
  if (seqL2) {
    L.push('### Three runs in a row at L2 near the old learning threshold (Debussy bars 1–5)');
    L.push('');
    L.push(table(
      ['true', 'seed', 'before', 'after', 'after (80 ms estimate)'],
      seqL2.map((q: Any) => [`${q.trueLatencyMs} ms`, q.seed, runs(chain(q.chains, 'before')), runs(chain(q.chains, 'after')), runs(chain(q.chains, 'after (80 ms estimate)'))]),
    ));
    L.push('');
  }

  // ---------------- bleed
  if (bleed) {
    L.push('### Phone speaker, no headphones (bleed sweep), before → after');
    L.push('');
    L.push(table(
      ['singer', 'bleed', 'section', 'L', 'latency', 'before in tune / acc', 'before', 'after in tune / acc', 'after', 'octave/subharm. readings'],
      bleed.map((r: Any) => [r.singer, `${r.bleedDb} dB`, r.target, r.level, r.latency, `${pct(r.before.pitch)} / ${pct(r.before.accuracy)}`, `${r.before.letter} ${pass(r.before.passed)}`,
        `${pct(r.after.pitch)} / ${pct(r.after.accuracy)}`, run(r.after), `${pct(r.octBefore)} → ${pct(r.octAfter)}`]),
    ));
    L.push('');
  }

  // ---------------- 3. repeatability
  if (rep) {
    L.push('## 3. Repeatability (good singer, Debussy bars 1–5, fresh profile each run)');
    L.push('');
    L.push(table(
      ['L', 'latency', 'mode', 'pipeline', 'accuracy min–max (sd)', 'in tune min–max', 'letters', 'passes'],
      rep.flatMap((r: Any) => Object.entries(r.byPipeline).map(([k, e]: [string, Any]) => [
        r.level, r.latency, r.mode, k, `${pct(Math.min(...e.accs))}–${pct(Math.max(...e.accs))} (${f1(100 * sd(e.accs))})`,
        `${pct(Math.min(...e.pitches))}–${pct(Math.max(...e.pitches))}`, hist(e.letters), `${e.passes}/${e.accs.length}`,
      ])),
    ));
    L.push('');
  }

  // ---------------- 4. sanity
  if (sanity) {
    L.push('## 4. Sanity and adversarial singers (device round trip 130 ms)');
    L.push('');
    L.push('"measured 130" = the delay check was done; "uncalibrated" = 3 runs in a row with the app\'s learning. Echo = right notes, 300 ms behind what the singer hears; one note behind = each pitch one note late; late pitch arrival = consonant on time, pitch moves 200 ms after the beat.');
    L.push('');
    L.push(table(
      ['singer', 'section', 'L', 'delay', 'before', 'after'],
      sanity.map((r: Any) => [r.singer, r.target, r.level, r.latency, runs(chain(r.chains, 'before'), { tips: true }), runs(chain(r.chains, 'after'), { tips: true })]),
    ));
    L.push('');
  }

  // ---------------- TM
  if (tm) {
    const vals = Object.keys(tm[0]?.byTm ?? {});
    L.push('## 5. TRANSITION_MAX sweep (current scorer + alignment, calibrated 150 ms)');
    L.push('');
    L.push('Cells: in tune / accuracy grade (✗ = fails the level). Generated scorer variants differ only in `TRANSITION_MAX` (35 %-of-note cap unchanged).');
    L.push('');
    L.push(table(
      ['singer', 'section', 'L', ...vals.map((v) => `${v} s`)],
      tm.map((r: Any) => [r.singer, r.target, r.level, ...vals.map((v) => { const c = r.byTm[v]; return `${pct(c.pitch)} / ${pct(c.accuracy)} ${c.letter}${c.passed ? '' : ' ✗'}`; })]),
    ));
    L.push('');
  }

  // ---------------- ablation
  if (abl) {
    L.push('## 6. Ablation (calibrated, headphones), before → after');
    L.push('');
    L.push(table(
      ['step', 'section', 'L', 'before in tune / acc', 'after in tune / acc', 'oracle acc before / after'],
      abl.map((r: Any) => [r.step, r.target, r.level, `${pct(r.before.pitch)} / ${pct(r.before.accuracy)} ${r.before.letter}`, `${pct(r.after.pitch)} / ${pct(r.after.accuracy)} ${r.after.letter}`, `${pct(r.oracleBefore)} / ${pct(r.oracleAfter)}`]),
    ));
    L.push('');
  }
  if (fast) fastSection(L, fast);
  const l1 = read('l1-doo');
  const l1adv = read('l1-doo-adv');
  if (l1 || l1adv) l1Section(L, l1 ?? [], l1adv);
  writeFileSync(resolve(ROOT, 'docs/qa/realism-current.md'), L.join('\n'));
  return true;
}

const fastTotal = (r: Any) => r.fast.perfect + r.fast.good + r.fast.ok + r.fast.miss;
const fastLost = (r: Any) => r.fast.ok + r.fast.miss;
const pct1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : `${(x * 100).toFixed(1)}%`);

/** Section 7: fast notes (cmp-fast.test.ts / fastnotes.ts). */
/** Level 1 on "doo" with the every-note rule (cmp-l1-doo*.test.ts, qa/realism/l1doo.ts). */
function l1Section(L: string[], cells: Any[], adv: Any | null): void {
  L.push('## 8. Level 1 on “doo”: every note right (current app)');
  L.push('');
  L.push('Each good voice sings the six sections on the lyrics and on “doo” (a 20–45 ms “d” before every note, vowel “u”) at 70% tempo: calibrated (150 ms) and an uncalibrated phone (true 200 ms, first run). *new* = passes with every note right (ladder.attemptPasses; unreliable notes forgiven unless clearly wrong), *old* = accuracy ≥ 75%. *below good*: notes graded ok/miss, of which *forgiven* by the exemption; *wrong*: notes that failed the run (target · note · grade · cents).');
  L.push('');
  const row = (c: Any) => [c.singer, c.doo ? 'doo' : 'lyrics', c.latency, `${c.passes}/${c.runs}`, `${c.oldPasses}/${c.runs}`, pct(c.meanAcc), c.belowGood, c.forgiven,
    c.wrong.length ? c.wrong.slice(0, 4).map((w: Any) => `${w.target} #${w.index} ${w.grade} ${w.cents ?? '–'}¢`).join('; ') + (c.wrong.length > 4 ? ` …+${c.wrong.length - 4}` : '') : '–',
    f0(c.medOnsetMs)];
  const head = ['singer', 'sung on', 'delay', 'new', 'old', 'acc', 'below good', 'forgiven', 'wrong notes', 'median onset ms'];
  if (cells.length) L.push(table(head, cells.map(row)));
  L.push('');
  if (adv?.fast?.length) {
    L.push('**Fast bars** (Debussy *Yver* 1–23, *Dieu* 1–5, Ravel *Nicolette* 20–45, synthetic 16ths at 104/144 bpm and 8ths at 144 bpm; good singer, calibrated):');
    L.push('');
    L.push(table(head, adv.fast.map(row)));
    L.push('');
  }
  if (adv?.adversarial?.length) {
    L.push('**Singers with wrong notes, on “doo”** (calibrated; runs passing level 1, new vs old rule):');
    L.push('');
    const by = new Map<string, Any[]>();
    for (const r of adv.adversarial) by.set(r.singer, [...(by.get(r.singer) ?? []), r]);
    L.push(table(['singer', 'new', 'old', 'mean acc', 'wrong / run', 'forgiven'], [...by].map(([s, rs]) => [
      s, `${rs.filter((r: Any) => r.passed).length}/${rs.length}`, `${rs.filter((r: Any) => r.oldPassed).length}/${rs.length}`, pct(mean(rs.map((r: Any) => r.acc))),
      f1(mean(rs.map((r: Any) => r.wrong))), rs.reduce((a: number, r: Any) => a + r.forgiven, 0),
    ])));
    L.push('');
  }
}

function fastSection(L: string[], f: Any): void {
  const base = f.baseRef ? `\`${f.baseRef}\`` : '–';
  L.push('## 7. Fast notes (good singer, measured delay), before → after');
  L.push('');
  L.push(`Before = the app at ${base} (\`scoring.ts\`, \`align.ts\`, \`pitch.ts\` from git), after = the working tree, both through the current pipeline on the same renders (true delay 150 ms, measured). "Fast" = shorter than 0.15 s as sung. Cells: accuracy, and the share of fast notes scored ok/miss. Synthetic runs are scales, thirds and neighbour figures, 2 bars per phrase; \`ta\` = a consonant on every note, \`a\` = none (melisma-like), \`nolyr\` = the singer model's default (a consonant on about half).`);
  L.push('');
  const groups = [...new Set(f.good.map((r: Any) => r.passage))] as string[];
  const cell = (rs: Any[], k: 'before' | 'after') => {
    const xs = rs.map((r: Any) => r[k]).filter(Boolean);
    if (!xs.length) return '–';
    const n = xs.reduce((a: number, r: Any) => a + fastTotal(r), 0);
    return `${pct(mean(xs.map((r: Any) => r.acc)))}${n ? ` · ${pct1(xs.reduce((a: number, r: Any) => a + fastLost(r), 0) / n)}` : ''}${xs.some((r: Any) => !r.passed) ? ` (${xs.filter((r: Any) => !r.passed).length}✗)` : ''}`;
  };
  L.push(table(['passage', ...[1, 2, 4].flatMap((l) => [`L${l} before`, `L${l} after`])],
    groups.map((g) => [g, ...[1, 2, 4].flatMap((l) => { const rs = f.good.filter((r: Any) => r.passage === g && r.level === l); return [cell(rs, 'before'), cell(rs, 'after')]; })])));
  L.push('');
  L.push('**Why short notes were lost** (good singer, all levels; the diagnosis replays the scorer on the exact samples it judged and names the rule that dropped each ok/miss note; counts per 1000 notes of that length):');
  L.push('');
  const buckets = Object.keys(f.reasons.after);
  const reasons = [...new Set(buckets.flatMap((b) => [...Object.keys(f.reasons.after[b] ?? {}), ...Object.keys(f.reasons.before?.[b] ?? {})]).filter((r) => r !== 'notes'))];
  const per1000 = (k: 'before' | 'after', b: string, r: string) => {
    const e = f.reasons[k]?.[b];
    return e ? f1(((e[r] ?? 0) / Math.max(1, e.notes)) * 1000) : '–';
  };
  L.push(table(['reason', ...buckets.flatMap((b) => [`${b} before`, `${b} after`])],
    [...reasons.map((r) => [r, ...buckets.flatMap((b) => [per1000('before', b, r), per1000('after', b, r)])]),
      ['**all lost**', ...buckets.flatMap((b) => (['before', 'after'] as const).map((k) => { const e = f.reasons[k]?.[b]; return e ? f1((Object.entries(e).filter(([r]) => r !== 'notes').reduce((a, [, v]) => a + (v as number), 0) / Math.max(1, e.notes)) * 1000) : '–'; }))],
      ['notes', ...buckets.flatMap((b) => [f.reasons.before?.[b]?.notes ?? '–', f.reasons.after[b]?.notes ?? '–'])]]));
  L.push('');
  L.push('**Adversarial singers** (accuracy, ✗ = fails the level; `plain` = without the end-of-run line-up, i.e. what the live view shows; `al+N` = the voice was shifted N ms):');
  L.push('');
  const adv = (r: Any) => (r ? `${pct(r.acc)}${r.passed ? '' : ' ✗'} (plain ${pct(r.plainAcc)}${r.alignedMs ? `, al${r.alignedMs > 0 ? '+' : ''}${r.alignedMs}` : ''})` : '–');
  L.push(table(['singer', 'passage', 'L', 'before', 'after'], f.adversarial.map((r: Any) => [r.singer, r.passage, r.level, adv(r.before), adv(r.after)])));
  L.push('');
  const cal = f.good.filter((r: Any) => r.level >= 2);
  if (cal.length) {
    const n = cal.reduce((a: number, r: Any) => a + fastTotal(r.after), 0);
    L.push(`**Live display vs result, measured delay** (good singer, L2+L4, after): fast notes shown ok/miss while singing ${pct1(cal.reduce((a: number, r: Any) => a + r.after.liveFastMiss, 0) / Math.max(1, n))} vs ${pct1(cal.reduce((a: number, r: Any) => a + fastLost(r.after), 0) / Math.max(1, n))} in the result.`);
    L.push('');
  }
  if (f.live?.length) {
    L.push('**Live display vs result, uncalibrated phone** (true delay 200 ms, estimate 130 ms; notes shorter than 0.25 s shown ok/miss while singing vs in the result after the line-up): ' +
      f.live.map((r: Any) => `${r.passage} L${r.level}: ${r.liveMiss}/${r.fastN} live vs ${r.finalMiss}/${r.fastN} result`).join('; ') + '.');
    L.push('');
  }
}
