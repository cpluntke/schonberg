// Super admin: anonymous usage statistics (daily totals, and hourly ones for the last 24 hours;
// docs/PRIVACY.md), to improve the app.

import React, { useEffect, useMemo, useState } from 'react';
import { go } from '../router';
import { apiBase, loadSuperSession } from '../../progress/choir';
import { useSession } from './Choir';
import { fetchLiveMetrics, fetchMetrics, metricsCsv, sumKeys, type LiveView, type MetricsDay } from '../../progress/insights';
import { BarList, Sparkline } from '../components/InsightCharts';

const RANGES = ['24h', 7, 30, 90] as const;
type Range = (typeof RANGES)[number];
/** The last-24-hours tab asks again this often while it is open. */
const LIVE_REFRESH = 60_000;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');
const int = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

function Section({ title, note, children, id }: { title: string; note?: string; children: React.ReactNode; id?: string }) {
  return (
    <div className="card" data-testid={id}>
      <strong>{title}</strong>
      {note && <span className="tiny muted">{note}</span>}
      {children}
    </div>
  );
}

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="v">{v}</span>
      <span className="k">{k}</span>
      {sub && <span className="tiny muted">{sub}</span>}
    </div>
  );
}

const MODES: [string, string][] = [['section', 'Sections'], ['full', 'Whole piece'], ['practice', 'Practice (slow / stopped)'], ['drill', 'Drills / loops'],
  ['arcade', 'Arcade'], ['cold', 'Cold start'], ['words', 'Words in rhythm'], ['listen', 'Listen only']];
const FUNNEL: [string, string][] = [['setup_started', 'Setup started'], ['choir_step', 'Choir step done'], ['range_done', 'Range check done'], ['range_skipped', 'Range check skipped'],
  ['delay_done', 'Delay check done'], ['delay_skipped', 'Delay check skipped'], ['first_run', 'First run'], ['first_pass', 'First level passed']];
const FEATURES: [string, string][] = [['score', 'Sheet music'], ['highway', 'Highway'], ['fullscore', 'Full score (wide screens)'], ['arcade', 'Arcade'], ['l5', 'Memorisation (L5)'],
  ['lyrics', 'Lyrics quiz'], ['memorymap', 'Memory map'], ['cold', 'Cold start'], ['words', 'Words in rhythm'], ['choir_join', 'Joined a choir'], ['account', 'Choir account'],
  ['sync', 'Progress sync'], ['share', 'Shares progress']];
const ATT: [string, string][] = [['1', '1st try'], ['2', '2'], ['3', '3'], ['4_5', '4–5'], ['6_10', '6–10'], ['11p', '11+']];
const T2RR: [string, string][] = [['d0_1', '0–1 days'], ['d2_3', '2–3 days'], ['d4_7', '4–7 days'], ['d8_14', '8–14 days'], ['d15_30', '15–30 days'], ['d31p', '31+ days']];
const DUR: [string, string][] = [['xs', 'Short notes (< ¼ s)'], ['s', '¼–0.6 s'], ['m', '0.6–1.5 s'], ['l', 'Long (≥ 1.5 s)']];
const LAT = ['0', '50', '100', '150', '200', '300'];

export function UsageInsights() {
  useSession(); // re-renders when the super-admin login starts or ends
  const token = loadSuperSession()?.token ?? null;
  const [n, setN] = useState<Range>(30);
  const [days, setDays] = useState<MetricsDay[] | null>(null);
  const [live, setLive] = useState<LiveView | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!token) return;
    let alive = true;
    setErr('');
    if (n !== '24h') {
      fetchMetrics({ bearer: token }, n).then((r) => { if (alive) setDays(r.days); }).catch((e) => { if (alive) setErr((e as Error).message); });
      return () => { alive = false; };
    }
    const load = () => fetchLiveMetrics({ bearer: token }).then((r) => { if (alive) { setLive(r); setErr(''); } }).catch((e) => { if (alive) setErr((e as Error).message); });
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, LIVE_REFRESH);
    const onShow = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onShow); };
  }, [token, n]);
  const stats = useMemo(() => (days ? summarise(days) : null), [days]);
  if (!apiBase()) return <><div className="notice">Needs the online version of the app.</div></>;
  if (!token) {
    return (
      <>
        <div className="notice">Log in as super admin first.</div>
        <button className="btn" onClick={() => go({ name: 'superadmin' })}>Super admin</button>
      </>
    );
  }
  // (the last 24 hours: one row per UTC hour)
  const rows: MetricsDay[] | null = n === '24h'
    ? live && live.hours.map((h) => ({ day: `${h.hour}:00Z`, installs: h.installs, c: h.c, u: {}, tech: {}, jserr: h.jserr }))
    : days;
  const csv = () => {
    if (!rows?.length) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([metricsCsv(rows)], { type: 'text/csv' }));
    a.download = n === '24h' ? `schonberg-usage-24h-to-${live?.now}.csv` : `schonberg-usage-${rows[0]?.day}-to-${rows[rows.length - 1]?.day}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <>
      <span className="small muted">{n === '24h'
        ? 'Anonymous hourly totals: no names, no accounts, no recordings. Phones send what they counted every few minutes while the app is in use (app versions from 8 Oct 2026 on); this page updates every minute. Hours are kept for two days.'
        : 'Anonymous daily totals only: no names, no accounts, no recordings. Phones send each day\'s summary when the app is next opened, so the last days fill in over a week; the "24 hours" tab shows today\'s practice as it happens.'}</span>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="seg" role="group" aria-label="Date range" style={{ flex: 1 }}>
          {RANGES.map((r) => <button key={r} aria-pressed={n === r} onClick={() => setN(r)} data-testid={`usage-range-${r}`}>{r === '24h' ? '24 hours' : `${r} days`}</button>)}
        </div>
        <button className="btn small" onClick={csv} disabled={!rows?.length} data-testid="usage-csv">Export CSV</button>
      </div>
      {err && <div className="notice" role="alert">{err}</div>}
      {n === '24h' && !live && !err && <span className="muted">Loading…</span>}
      {n === '24h' && live && <LastDay live={live} />}
      {n !== '24h' && !days && !err && <span className="muted">Loading…</span>}
      {n !== '24h' && stats && days && (
        <>
          <div className="stats3" data-testid="usage-tiles">
            <Tile k="Daily actives (yesterday)" v={int(stats.dauY)} sub={`peak ${int(stats.dauMax)}`} />
            <Tile k="Weekly actives" v={int(stats.wau)} />
            <Tile k="28-day actives" v={int(stats.mau)} />
            <Tile k="Runs a day" v={stats.runsPerDay.toFixed(stats.runsPerDay < 10 ? 1 : 0)} sub={daysWithData(stats.withData)} />
            <Tile k="Minutes practised a day" v={int(stats.minPerDay)} sub={daysWithData(stats.withData)} />
            <Tile k="Back the next week" v={stats.ret ? pct(stats.ret.back, stats.ret.base) : '–'} sub={stats.ret ? `of ${stats.ret.base} installs` : 'needs 2 full weeks'} />
          </div>
          <Section title="Daily actives" note={`${days[0].day} to ${days[days.length - 1].day}`} id="usage-actives">
            <Sparkline values={days.map((d) => d.installs ?? 0)} labels={days.map((d) => d.day)} />
          </Section>
          <Section title="Runs a day">
            <Sparkline values={days.map((d) => sumKeys([d], (k) => k.startsWith('run.')))} labels={days.map((d) => d.day)} />
          </Section>
          <Breakdown days={days} />
        </>
      )}
    </>
  );
}

/** The breakdowns, over days (or the last 24 hours as one record: `hours`). */
function Breakdown({ days, hours }: { days: MetricsDay[]; hours?: boolean }) {
  const qRuns = sumKeys(days, (k) => k === 'q.runs');
  const jsTop = topErrors(days);
  return (
    <>
    <Section title="Runs by mode" id="usage-modes">
      <BarList rows={MODES.map(([m, l]) => ({ label: l, value: sumKeys(days, (k) => k.startsWith(`run.${m}.`)) }))} format={int} />
    </Section>
    <Section title="Runs by level" note="Level 0 = listening">
      <BarList rows={[0, 1, 2, 3, 4, 5].map((l) => ({ label: `Level ${l}`, value: sumKeys(days, (k) => k.startsWith('run.') && k.endsWith(`.L${l}`)) }))} format={int} />
    </Section>
    <Section title="Onboarding funnel" note="New installs reaching each step (share of setups started)" id="usage-funnel">
      <BarList rows={FUNNEL.map(([s, l]) => ({ label: l, value: sumKeys(days, (k) => k === `onb.${s}`) }))}
        format={(v) => { const base = sumKeys(days, (k) => k === 'onb.setup_started'); return base ? `${int(v)} · ${pct(v, base)}` : int(v); }} />
    </Section>
    <Section title="Level pass rates" note="Counted section and whole-piece runs that passed">
      <BarList rows={[1, 2, 3, 4, 5].map((l) => {
        const runs = sumKeys(days, (k) => /^run\.(section|full)\./.test(k) && k.endsWith(`.L${l}`));
        const pass = sumKeys(days, (k) => /^pass\.(section|full)\./.test(k) && k.endsWith(`.L${l}`));
        return { label: `Level ${l}`, value: runs ? pass / runs : 0, note: `${pass} of ${runs}` };
      })} format={(v) => `${Math.round(v * 100)}%`} max={1} />
    </Section>
    <Section title="Attempts to pass a level" note="Counted runs at a section and level until it passed">
      <BarList rows={ATT.map(([b, l]) => ({ label: l, value: sumKeys(days, (k) => k.startsWith('att2pass.') && k.endsWith(`.${b}`)) }))} format={int} />
    </Section>
    <Section title="Time to rehearsal-ready" note="From first practice of a piece to piece level 3">
      <BarList rows={T2RR.map(([b, l]) => ({ label: l, value: sumKeys(days, (k) => k === `t2rr.${b}`) }))} format={int} />
    </Section>
    <Section title="Whole-piece runs">
      <BarList rows={[
        { label: 'Clean (nothing to fix)', value: sumKeys(days, (k) => k === 'full.clean') },
        { label: 'With a to-fix list', value: sumKeys(days, (k) => k === 'full.tofix') },
        { label: 'Too much slipped (practice)', value: sumKeys(days, (k) => k === 'full.toomuch') },
        { label: 'Blocked (fix first, earlier rules)', value: sumKeys(days, (k) => k === 'full.blocked') },
      ]} format={int} />
    </Section>
    <Section title="Feature usage" note={hours ? 'Installs using each feature' : 'Install-days using each feature'} id="usage-features">
      <BarList rows={FEATURES.map(([f, l]) => ({ label: l, value: sumKeys(days, (k) => k === `feat.${f}`, 'u') }))} format={int} />
    </Section>
    <Section title="Scoring quality" id="usage-scoring">
      <BarList rows={DUR.map(([b, l]) => {
        const all = sumKeys(days, (k) => k === `acc.${b}.n`);
        return { label: l, value: all ? sumKeys(days, (k) => k === `acc.${b}.hit`) / all : 0, note: `${all} notes` };
      })} format={(v) => `${Math.round(v * 100)}% hit`} max={1} />
      <div className="row wrap small" style={{ gap: 14 }}>
        <span>Delay check suggested: <span className="mono">{pct(sumKeys(days, (k) => k === 'q.delay_suggested'), qRuns)}</span></span>
        <span>Timing unsure: <span className="mono">{pct(sumKeys(days, (k) => k === 'q.timing_unsure'), qRuns)}</span></span>
        <span>Failed on timing: <span className="mono">{pct(sumKeys(days, (k) => k === 'q.timing_fail'), qRuns)}</span></span>
        <span>Voice lined up: <span className="mono">{pct(sumKeys(days, (k) => k === 'q.aligned'), qRuns)}</span></span>
      </div>
      <span className="small">Headphone/mic delay in use ({hours ? 'install-hours' : 'install-days'})</span>
      <BarList rows={LAT.map((b, i) => ({
        label: i === LAT.length - 1 ? `${b}+ ms` : `${b}–${LAT[i + 1]} ms`,
        value: sumKeys(days, (k) => k.startsWith('lat.') && k.endsWith(`.${b}`)),
        note: ['measured', 'learned', 'est'].map((s) => `${s} ${sumKeys(days, (k) => k === `lat.${s}.${b}`)}`).join(', '),
      }))} format={int} />
    </Section>
    <Section title="Devices" note={`${hours ? 'Installs' : 'Install-days'}, from the browser\'s user agent (families only)`} id="usage-tech">
      {(['browser', 'os', 'device'] as const).map((f) => (
        <BarList key={f} rows={Object.entries(techTotals(days, f)).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: `${f === 'os' ? 'OS' : f}: ${k}`, value: v }))} format={int} />
      ))}
    </Section>
    <Section title="Problems" id="usage-errors">
      <BarList rows={[
        { label: 'Microphone errors', value: sumKeys(days, (k) => k === 'err.mic') },
        { label: 'Score imports that failed', value: sumKeys(days, (k) => k === 'err.import') },
        { label: 'JavaScript errors', value: sumKeys(days, (k) => k === 'err.js') },
      ]} format={int} />
      {jsTop.length > 0 && (
        <span className="tiny muted">Most frequent errors (message hash, match it with a diagnostics report): {jsTop.map(([h, v]) => `${h} ×${v}`).join(', ')}</span>
      )}
    </Section>
    </>
  );
}

function topErrors(days: MetricsDay[]): [string, number][] {
  const js: Record<string, number> = {};
  for (const d of days) for (const [h, v] of Object.entries(d.jserr ?? {})) js[h] = (js[h] ?? 0) + v;
  return Object.entries(js).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

const hourLabel = (h: string) => new Date(`${h}:00:00Z`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The last 24 hours, by the hour (local time on the labels). */
function LastDay({ live }: { live: LiveView }) {
  const t = live.total;
  const runs = (c: Record<string, number>) => Object.entries(c).reduce((a, [k, v]) => a + (k.startsWith('run.') ? v : 0), 0);
  const labels = live.hours.map((h) => hourLabel(h.hour));
  const thisHour = live.hours[live.hours.length - 1];
  return (
    <>
      <div className="stats3" data-testid="usage-24h-tiles">
        <Tile k="Active in the last 24 hours" v={int(t.installs)} sub={`${int(thisHour?.installs ?? 0)} this hour`} />
        <Tile k="Runs" v={int(runs(t.c))} sub={`${int(runs(thisHour?.c ?? {}))} this hour`} />
        <Tile k="Minutes practised" v={int((t.c['sec.practice'] ?? 0) / 60)} />
      </div>
      <Section title="Active by the hour" note={`${labels[0]} to now`} id="usage-24h-actives">
        <Sparkline values={live.hours.map((h) => h.installs)} labels={labels} />
      </Section>
      <Section title="Runs by the hour">
        <Sparkline values={live.hours.map((h) => runs(h.c))} labels={labels} />
      </Section>
      <Breakdown days={[t]} hours />
    </>
  );
}

function techTotals(days: MetricsDay[], fam: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) for (const [k, v] of Object.entries(d.tech ?? {})) if (k.startsWith(`${fam}.`)) out[k.slice(fam.length + 1)] = (out[k.slice(fam.length + 1)] ?? 0) + v;
  return out;
}

const daysWithData = (n: number) => `avg. of ${n} day${n === 1 ? '' : 's'} with data`;

function summarise(days: MetricsDay[]) {
  const y = days.length >= 2 ? days[days.length - 2] : days[days.length - 1];
  const last = days[days.length - 1];
  // Averages over the days that have data (a new server or a quiet stretch would otherwise dilute them).
  const withData = days.filter((d) => (d.installs ?? 0) > 0).length;
  const nDays = Math.max(1, withData);
  const rets = days.filter((d) => d.ret && d.ret.base > 0);
  const ret = rets.length ? rets.reduce((a, d) => ({ base: a.base + d.ret!.base, back: a.back + d.ret!.back }), { base: 0, back: 0 }) : null;
  return {
    dauY: y?.installs ?? 0,
    dauMax: Math.max(0, ...days.map((d) => d.installs ?? 0)),
    wau: y?.wau ?? last?.wau ?? 0,
    mau: y?.mau ?? last?.mau ?? 0,
    runsPerDay: sumKeys(days, (k) => k.startsWith('run.')) / nDays,
    minPerDay: sumKeys(days, (k) => k === 'sec.practice') / 60 / nDays,
    withData,
    ret,
  };
}
