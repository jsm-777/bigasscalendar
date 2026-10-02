import { describe, expect, it } from 'vitest';
import {
  addDays, daysInMonth, isLeapYear, localToInstant, weekday, yearRange, instantToLocal, todayIn,
} from '../shared/dates.ts';

describe('calendar dates', () => {
  it('builds the Sep 2026 – Aug 2027 board range', () => {
    const r = yearRange('2026-09');
    expect(r.from).toBe('2026-09-01');
    expect(r.to).toBe('2027-08-31');
    expect(r.months).toHaveLength(12);
    expect(r.months[0]).toBe('2026-09');
    expect(r.months[11]).toBe('2027-08');
  });

  it('knows weekdays (ISO 1=Mon … 7=Sun)', () => {
    expect(weekday('2026-09-01')).toBe(2); // Tuesday
    expect(weekday('2026-10-02')).toBe(5); // Friday
    expect(weekday('2027-01-01')).toBe(5); // Friday
    expect(weekday('2027-08-31')).toBe(2); // Tuesday
  });

  it('handles month lengths and leap years', () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('resolves DST gaps forward and overlaps to the earlier instant (Los Angeles)', () => {
    // 2027-03-14 02:30 does not exist in LA (clocks jump 02:00 → 03:00).
    const gap = localToInstant('2027-03-14T02:30', 'America/Los_Angeles');
    expect(instantToLocal(gap, 'America/Los_Angeles')).toBe('2027-03-14T03:30');
    // 2026-11-01 01:30 happens twice; we pick the first (PDT, UTC-7).
    const overlap = localToInstant('2026-11-01T01:30', 'America/Los_Angeles');
    expect(overlap.toISOString()).toBe('2026-11-01T08:30:00.000Z');
  });

  it('computes "today" in the user zone, not UTC', () => {
    const instant = new Date('2026-10-03T05:00:00Z'); // still Oct 2 in LA
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-10-02');
    expect(todayIn('Europe/London', instant)).toBe('2026-10-03');
  });
});
