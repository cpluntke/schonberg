import { describe, it, expect } from 'vitest';
import { nextRehearsal } from './rehearsal';

describe('nextRehearsal (weekly)', () => {
  const thu = { rehearsalWeekday: 4, rehearsalTime: '19:30' };
  it('finds the coming Thursday', () => {
    const r = nextRehearsal(thu, new Date(2026, 9, 4, 12, 0))!; // Sun 4 Oct 2026
    expect(r.iso).toBe('2026-10-08');
    expect(r.days).toBe(4);
    expect(r.at.getHours()).toBe(19);
  });
  it('is today on Thursday until the rehearsal is over', () => {
    expect(nextRehearsal(thu, new Date(2026, 9, 8, 18, 0))!.days).toBe(0);
    expect(nextRehearsal(thu, new Date(2026, 9, 8, 21, 30))!.days).toBe(0);
    expect(nextRehearsal(thu, new Date(2026, 9, 8, 23, 0))!.iso).toBe('2026-10-15');
  });
  it('falls back to a one-off date', () => {
    expect(nextRehearsal({ rehearsalDate: '2026-10-10' }, new Date(2026, 9, 4))!.days).toBe(6);
    expect(nextRehearsal({}, new Date())).toBeNull();
  });
});
