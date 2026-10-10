// When is the next rehearsal? Supports a weekly slot (e.g. Thursdays 19:30) or a one-off date.
import type { Cycle } from './store';

export interface NextRehearsal {
  /** Local date-time of the rehearsal start. */
  at: Date;
  /** YYYY-MM-DD (local). */
  iso: string;
  /** Whole days from today (0 = today). */
  days: number;
  /** e.g. "Thu 19:30". */
  label: string;
  /** A one-off rehearsal today that has finished (about 2½ hours after it began). */
  over?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function parseTime(t?: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? '');
  return m ? [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))] : [19, 30];
}

export function nextRehearsal(c: Pick<Cycle, 'rehearsalWeekday' | 'rehearsalTime' | 'rehearsalDate'>, now = new Date()): NextRehearsal | null {
  let at: Date | null = null;
  if (c.rehearsalWeekday != null && c.rehearsalWeekday >= 0 && c.rehearsalWeekday <= 6) {
    const [h, m] = parseTime(c.rehearsalTime);
    at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    let add = (c.rehearsalWeekday - now.getDay() + 7) % 7;
    // Today's rehearsal counts until it has finished (assume ~2.5 h).
    if (add === 0 && now.getTime() > at.getTime() + 2.5 * 3600_000) add = 7;
    at.setDate(at.getDate() + add);
  } else if (c.rehearsalDate) {
    const d = new Date(c.rehearsalDate + 'T19:30:00');
    if (!isNaN(d.getTime())) at = d;
  }
  if (!at) return null;
  const days = Math.round((dayStart(at) - dayStart(now)) / 86400_000);
  // (a weekly one moves on to next week by then; a one-off date stays, marked as over)
  const over = c.rehearsalWeekday == null && days === 0 && now.getTime() > at.getTime() + 2.5 * 3600_000;
  const label = at.toLocaleDateString(undefined, { weekday: 'short' }) + (c.rehearsalWeekday != null ? ` ${pad(at.getHours())}:${pad(at.getMinutes())}` : ` ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
  return { at, iso: isoDate(at), days, label, ...(over ? { over } : {}) };
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
