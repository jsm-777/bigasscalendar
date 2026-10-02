import { describe, expect, it } from 'vitest';
import { moonForDate, moonQuarters } from '../shared/moon.ts';
import { dailyStreak, weeklyStreak } from '../shared/streaks.ts';
import { affirmationFor } from '../shared/quotes.ts';
import type { CheckIn, Goal } from '../shared/types.ts';

describe('moon phases', () => {
  // Reference instants from the US Naval Observatory phase tables (UTC).
  const reference: [string, number, string][] = [
    ['Last quarter', 3, '2024-01-04T03:30Z'],
    ['New moon', 0, '2024-01-11T11:57Z'],
    ['First quarter', 1, '2024-01-18T03:53Z'],
    ['Full moon', 2, '2024-01-25T17:54Z'],
    ['New moon', 0, '2024-04-08T18:21Z'], // total solar eclipse
  ];
  it.each(reference)('%s at %s matches within 3 minutes', (_name, quarter, iso) => {
    const expected = Date.parse(iso.replace('Z', ':00Z'));
    const day = iso.slice(0, 10);
    const found = moonQuarters(day, day, 'UTC').find((q) => q.quarter === quarter);
    expect(found).toBeTruthy();
    expect(Math.abs(Date.parse(found!.instant) - expected)).toBeLessThan(3 * 60_000);
  });

  it('labels the local date of a quarter in the user zone', () => {
    // Full moon 2024-01-25 17:54 UTC is 09:54 in Los Angeles, same date.
    const info = moonForDate('2024-01-25', 'America/Los_Angeles');
    expect(info.phase).toBe('Full moon');
    expect(info.illumination).toBeGreaterThan(0.98);
  });

  it('gives roughly four quarters per month across the board year', () => {
    const q = moonQuarters('2026-09-01', '2027-08-31', 'America/Los_Angeles');
    expect(q.length).toBeGreaterThanOrEqual(48);
    expect(q.length).toBeLessThanOrEqual(51);
  });
});

describe('streaks', () => {
  const ci = (date: string, i = 0): CheckIn => ({ id: `${date}-${i}`, goalId: 'g', date, quantity: null, reflection: '', clientKey: `${date}-${i}`, createdAt: '' });
  const goal = (over: Partial<Goal> = {}): Goal => ({ id: 'g', ownerId: 'u', title: 'Practice', color: '#000000', mode: 'daily', weeklyTarget: 3, restDays: [], unit: '', archived: false, version: 1, ...over });

  it('daily streak: today pending does not break it', () => {
    const c = ['2026-09-29', '2026-09-30', '2026-10-01'].map((d) => ci(d));
    expect(dailyStreak(goal(), c, '2026-10-02')).toBe(3);
    expect(dailyStreak(goal(), [...c, ci('2026-10-02')], '2026-10-02')).toBe(4);
  });

  it('planned rest days do not break a daily streak', () => {
    // 2026-09-27 is a Sunday (rest day)
    const c = ['2026-09-25', '2026-09-26', '2026-09-28', '2026-09-29'].map((d) => ci(d));
    expect(dailyStreak(goal({ restDays: [7] }), c, '2026-09-29')).toBe(4);
    expect(dailyStreak(goal(), c, '2026-09-29')).toBe(2);
  });

  it('weekly target streak counts complete weeks; current week only once met', () => {
    const c = [
      '2026-09-14', '2026-09-16', '2026-09-18', // week of Sep 14: 3
      '2026-09-21', '2026-09-23', '2026-09-25', // week of Sep 21: 3
      '2026-09-28', // current week (Sep 28): 1 so far
    ].map((d) => ci(d));
    expect(weeklyStreak(goal({ mode: 'weekly', weeklyTarget: 3 }), c, '2026-10-01')).toBe(2);
    expect(weeklyStreak(goal({ mode: 'weekly', weeklyTarget: 3 }), [...c, ci('2026-09-30'), ci('2026-10-01')], '2026-10-01')).toBe(3);
  });
});

describe('daily affirmation', () => {
  it('is stable for a local date', () => {
    expect(affirmationFor('2026-10-02')).toBe(affirmationFor('2026-10-02'));
  });
});
