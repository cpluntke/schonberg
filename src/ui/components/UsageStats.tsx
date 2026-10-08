// Settings: the switch for the anonymous usage statistics, and what they contain (docs/PRIVACY.md).

import React, { useEffect, useState } from 'react';
import { ChoirPrivacy } from './ChoirPrivacy';
import { browserSaysDoNotTrack, onUsageStatsChange, setUsageStats, usageStatsDefault, usageStatsOn } from '../../progress/metrics';

export function UsageStats() {
  const [, setV] = useState(0);
  useEffect(() => onUsageStatsChange(() => setV((x) => x + 1)), []);
  const on = usageStatsOn();
  return (
    <section className="col" style={{ gap: 8 }} data-testid="usage-stats">
      <h2 className="eyebrow">Privacy</h2>
      <label className="toggle-row">
        <span>Send anonymous usage statistics
          <span className="tiny muted" style={{ display: 'block' }}>Counts only (runs, levels, features, scoring problems): no names, no recordings, nothing that links them to you or your choir.</span>
        </span>
        <input type="checkbox" checked={on} data-testid="usage-stats-toggle" onChange={(e) => setUsageStats(e.target.checked)} />
      </label>
      {!on && usageStatsDefault() && browserSaysDoNotTrack() && (
        <span className="tiny muted">Off because your browser asks sites not to track you. Switch it on if you'd like to help anyway.</span>
      )}
      <ChoirPrivacy />
      <details>
        <summary className="small muted" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>What the app sends and keeps</summary>
        <div className="col small muted" style={{ gap: 6, marginTop: 4 }}>
          <span><strong>Usage statistics</strong> (with the switch on): once a day, a summary of the day before: how many runs at which mode and level, minutes practised, passes and attempts, which features were used, setup steps reached, scoring problems (missed short or long notes, delay-check hints, the delay in use, rounded) and error counts (a short code per error message, not the message). It carries a random number made only for this, so the server can count this phone once a day; it is never linked to your name, account or choir. The server adds it to that day's totals (and browser, system and phone-or-computer, from the browser's own description) and keeps only the totals: the per-day list of anonymous numbers is deleted after 35 days, the totals after 400 days. While you use the app, the same counts also go out every few minutes for the developer's "last 24 hours" view; the server keeps those as hourly totals, with the same anonymous number per hour (to count this phone once), and deletes them after about two days.</span>
          <span><strong>Your choir's leaderboard</strong> (with a choir code, unless you switch it off above): everyone in the choir sees your first name, voice and readiness for each piece (with your streak and weekly points).</span>
          <span><strong>Practising now</strong> (unless switched off above): while the singing screen is open, a count per voice part, no names, kept only in the server's memory.</span>
          <span><strong>Sharing progress with your section lead</strong> (on when you join a choir; you can switch it off above): how each bar of the programme's pieces is going, your piece levels and your voice range. Your section lead and the admins see your voice range by name; bars and levels only as totals for the whole section (from 3 singers sharing), though in a small section they may be able to work out yours.</span>
          <span><strong>A choir account</strong> (if you make one) keeps your progress on the choir server so it follows you to another phone.</span>
          <span>Recordings never leave this phone unless you share one yourself.</span>
        </div>
      </details>
    </section>
  );
}
