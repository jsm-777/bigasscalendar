import type { CheckIn, Goal, ISODate } from './types.ts';
import { addDays, startOfWeek, weekday } from './dates.ts';

// Streak rules (shown to the user in the Goals panel):
//  • Daily goals: count consecutive scheduled days with at least one check-in, ending today
//    or yesterday. Planned rest weekdays are skipped and never break the streak. Today not
//    being checked in yet does not break it either.
//  • Weekly goals: count consecutive Monday–Sunday weeks that met the weekly target. The
//    current week is included only once it has met the target; an unfinished current week
//    never breaks the streak.
// All dates are the user's local dates.

export const STREAK_RULES = {
  daily:
    'Consecutive scheduled days with a check-in. Planned rest days are skipped, and today stays open until it ends.',
  weekly:
    'Consecutive weeks (Mon–Sun) that met the weekly target. The current week counts once it reaches the target.',
};

export function uniqueDays(checkIns: CheckIn[]): Set<ISODate> {
  return new Set(checkIns.map((c) => c.date));
}

export function dailyStreak(goal: Goal, checkIns: CheckIn[], today: ISODate): number {
  const days = uniqueDays(checkIns);
  const rest = new Set(goal.restDays);
  if (rest.size >= 7) return 0;
  let streak = 0;
  let d = today;
  // Today counts if done; otherwise it does not break.
  if (!days.has(d)) d = addDays(d, -1);
  for (let i = 0; i < 3660; i++) {
    if (rest.has(weekday(d) as Goal['restDays'][number])) {
      if (days.has(d)) streak++; // bonus practice on a rest day still counts
      d = addDays(d, -1);
      continue;
    }
    if (!days.has(d)) break;
    streak++;
    d = addDays(d, -1);
  }
  return streak;
}

export function weekCount(checkIns: CheckIn[], weekStart: ISODate): number {
  const end = addDays(weekStart, 6);
  // Multiple check-ins on the same day count as separate sessions; duplicates are
  // prevented by clientKey at write time.
  return checkIns.filter((c) => c.date >= weekStart && c.date <= end).length;
}

export function weeklyStreak(goal: Goal, checkIns: CheckIn[], today: ISODate): number {
  let ws = startOfWeek(today, 1);
  let streak = 0;
  if (weekCount(checkIns, ws) >= goal.weeklyTarget) streak++;
  ws = addDays(ws, -7);
  for (let i = 0; i < 520; i++) {
    if (weekCount(checkIns, ws) < goal.weeklyTarget) break;
    streak++;
    ws = addDays(ws, -7);
  }
  return streak;
}

export function goalProgress(goal: Goal, checkIns: CheckIn[], today: ISODate) {
  const mine = checkIns.filter((c) => c.goalId === goal.id);
  const ws = startOfWeek(today, 1);
  return {
    thisWeek: weekCount(mine, ws),
    target: goal.mode === 'weekly' ? goal.weeklyTarget : 7 - goal.restDays.length,
    streak: goal.mode === 'weekly' ? weeklyStreak(goal, mine, today) : dailyStreak(goal, mine, today),
    doneToday: mine.some((c) => c.date === today),
  };
}
