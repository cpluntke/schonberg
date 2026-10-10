// The daily practice reminder: its settings (Settings → Your week, the You sheet's Practice row) and
// the one-time offer on Today done. The logic lives in progress/reminders.ts.
import React, { useEffect, useState } from 'react';
import {
  DEFAULT_TIME, disableReminders, enableReminders, loadReminder, markReminderOffered, onReminderChange, reminderSupport,
  setReminderTime, shouldOfferReminder, supportNote,
} from '../../progress/reminders';
import { openAt } from '../router';

function useReminder() {
  const [, setV] = useState(0);
  useEffect(() => onReminderChange(() => setV((x) => x + 1)), []);
  return loadReminder();
}

export function ReminderSettings() {
  const st = useReminder();
  const support = reminderSupport();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [time, setTime] = useState(st.time);
  useEffect(() => setTime(st.time), [st.time]);
  const note = st.on ? '' : supportNote(support);

  async function toggle(on: boolean) {
    setBusy(true);
    setError('');
    try {
      if (on) {
        const r = await enableReminders(time);
        if (!r.ok) setError(r.reason);
      } else {
        await disableReminders();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 0 }} data-testid="reminder-settings">
      <label className="toggle-row"><span>Daily reminder
        <span className="tiny muted" style={{ display: 'block' }}>A notification at your time: “Time for today's practice”.</span></span>
        <input type="checkbox" data-testid="reminder-toggle" checked={st.on} disabled={busy || (!st.on && support !== 'ok')}
          aria-describedby={note || error ? 'reminder-note' : undefined}
          onChange={(e) => { void toggle(e.target.checked); }} />
      </label>
      <label className="toggle-row"><span>Time</span>
        <input type="time" data-testid="reminder-time" value={time} disabled={busy || (!st.on && support !== 'ok')} required
          onChange={(e) => {
            const v = e.target.value || DEFAULT_TIME;
            setTime(v);
            void setReminderTime(v).then((ok) => { if (!ok && loadReminder().on) setError("Couldn't reach the choir server: the new time is kept on this phone and sent next time."); });
          }}
          style={{ width: 120, minHeight: 44, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 8px' }} />
      </label>
      <label className="toggle-row"><span>Only on days you haven't practised yet
        <span className="tiny muted" style={{ display: 'block' }}>Always on: once you've sung today, today's reminder doesn't come.</span></span>
        <input type="checkbox" checked disabled aria-readonly="true" />
      </label>
      {(note || error) && <span id="reminder-note" className="small muted" role={error ? 'alert' : undefined} data-testid="reminder-note" style={{ marginTop: 6 }}>{error || note}</span>}
      {st.on && <span className="tiny muted" style={{ marginTop: 6 }}>A first notification, “Reminder set”, confirms it within a minute. The choir server keeps only what it needs to send it (no name): see Privacy.</span>}
    </div>
  );
}

/** Today done: offer the reminder once (only where it can work, and when it's off). */
export function ReminderOffer() {
  const [show] = useState(() => shouldOfferReminder());
  const st = useReminder();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { if (show) markReminderOffered(); }, [show]);
  if (!show || dismissed) return null;
  if (st.on) {
    return (
      <section className="card" data-testid="reminder-offer">
        <span className="t14">Reminder on: every day at {st.time} when you haven't practised yet.</span>
        <button className="link start" onClick={() => openAt({ name: 'settings' }, 'settings-practice')}>Change it in Settings ›</button>
      </section>
    );
  }
  return (
    <section className="card col" style={{ gap: 8 }} data-testid="reminder-offer">
      <span className="t16">Want a nudge tomorrow?</span>
      <span className="t14 muted">A reminder at {st.time}, only on days you haven't practised yet.</span>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn small primary grow" disabled={busy} data-testid="reminder-offer-yes"
          onClick={() => { setBusy(true); setError(''); void enableReminders(st.time).then((r) => { if (!r.ok) setError(r.reason); }).finally(() => setBusy(false)); }}>
          Remind me at {st.time}
        </button>
        <button className="btn small ghost grow" disabled={busy} data-testid="reminder-offer-no" onClick={() => setDismissed(true)}>
          No thanks
        </button>
      </div>
      {error && <span className="small muted" role="alert">{error}</span>}
    </section>
  );
}
