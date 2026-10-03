import { describe, expect, it } from 'vitest';
import { dailyStreak, weeklyStreak } from '../shared/streaks.ts';
import type { CheckIn, Goal } from '../shared/types.ts';

const ci = (date: string, i = 0): CheckIn => ({ id: `${date}-${i}`, goalId: 'g', date, note: '', clientKey: `${date}-${i}` });
const goal = (over: Partial<Goal> = {}): Goal => ({ id: 'g', title: 'Practice', color: '#000000', mode: 'daily', weeklyTarget: 3, restDays: [], archived: false, ...over });

describe('streaks', () => {
  it('daily: today pending does not break the streak', () => {
    const c = ['2026-09-29', '2026-09-30', '2026-10-01'].map((d) => ci(d));
    expect(dailyStreak(goal(), c, '2026-10-02')).toBe(3);
    expect(dailyStreak(goal(), [...c, ci('2026-10-02')], '2026-10-02')).toBe(4);
  });
  it('daily: planned rest days never break it', () => {
    const c = ['2026-09-25', '2026-09-26', '2026-09-28', '2026-09-29'].map((d) => ci(d)); // Sep 27 is a Sunday
    expect(dailyStreak(goal({ restDays: [7] }), c, '2026-09-29')).toBe(4);
    expect(dailyStreak(goal(), c, '2026-09-29')).toBe(2);
  });
  it('weekly: counts complete weeks; the current week only once met', () => {
    const c = ['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28'].map((d) => ci(d));
    expect(weeklyStreak(goal({ mode: 'weekly' }), c, '2026-10-01')).toBe(2);
    expect(weeklyStreak(goal({ mode: 'weekly' }), [...c, ci('2026-09-30'), ci('2026-10-01')], '2026-10-01')).toBe(3);
  });
});
