import { DateTime } from 'luxon';
import type { CalEvent, NotificationPrefs, Task } from './types.ts';
import { expandAll } from './recurrence.ts';
import { addDays, formatTime12, localTime, minutesOfDay, todayIn } from './dates.ts';

// Pure planning of which notification jobs should exist. The server reconciles the
// result against stored jobs: missing ones are inserted, stale pending ones cancelled.
// dedupe keys include the occurrence and its resolved instant, so rescheduling an item
// produces a new key (old job cancelled) while re-planning an unchanged item is a no-op.

export interface DesiredJob {
  kind: 'event' | 'task' | 'agenda';
  sourceType: 'event' | 'task' | null;
  sourceId: string | null;
  dedupeKey: string;
  fireAt: string; // UTC ISO
  expiresAt: string; // UTC ISO; a job not delivered by then is dropped as stale
  title: string;
  body: string;
  url: string;
}

export const HORIZON_DAYS = 8;

function instant(localDate: string, time: string, tz: string): DateTime {
  return DateTime.fromISO(`${localDate}T${time}`, { zone: tz });
}

export function planJobs(
  prefs: NotificationPrefs,
  userTz: string,
  events: CalEvent[],
  tasks: Task[],
  now: Date,
  horizonDays = HORIZON_DAYS,
): DesiredJob[] {
  if (!prefs.enabled) return [];
  const out: DesiredJob[] = [];
  const nowDt = DateTime.fromJSDate(now);
  const horizon = nowDt.plus({ days: horizonDays });
  const today = todayIn(userTz, now);
  const from = addDays(today, -1);
  const to = addDays(today, horizonDays + 1);

  const consider = (job: DesiredJob) => {
    const fire = DateTime.fromISO(job.fireAt);
    const exp = DateTime.fromISO(job.expiresAt);
    // Skip anything already stale or beyond the planning horizon.
    if (exp <= nowDt || fire > horizon) return;
    out.push(job);
  };

  for (const occ of expandAll(events.filter((e) => e.alerts.length > 0 && !e.redacted), from, to)) {
    const ev = events.find((e) => e.id === occ.eventId)!;
    const start = occ.allDay
      ? instant(occ.startDate, prefs.dateOnlyTaskTime, userTz)
      : instant(occ.startDate, localTime(occ.startLocal!), occ.tz);
    for (const a of ev.alerts) {
      const fire = start.minus({ minutes: a.minutesBefore });
      const when = occ.allDay ? 'All day' : formatTime12(localTime(occ.startLocal!));
      consider({
        kind: 'event',
        sourceType: 'event',
        sourceId: ev.id,
        dedupeKey: `event:${occ.key}:${a.minutesBefore}:${start.toUTC().toISO()}`,
        fireAt: fire.toUTC().toISO()!,
        // Event cues become stale shortly after the event starts.
        expiresAt: DateTime.max(start.plus({ minutes: 10 }), fire.plus({ minutes: 10 })).toUTC().toISO()!,
        title: occ.title,
        body: `${when}${a.minutesBefore ? ` · in ${leadText(a.minutesBefore)}` : ' · starting now'}${occ.location ? ` · ${occ.location}` : ''}`,
        url: `/?date=${occ.startDate}`,
      });
    }
  }

  for (const t of tasks) {
    if (t.completedAt || !t.dueDate || t.alerts.length === 0) continue;
    const due = instant(t.dueDate, t.dueTime ?? prefs.dateOnlyTaskTime, t.dueTime ? t.tz : userTz);
    for (const a of t.alerts) {
      const fire = due.minus({ minutes: a.minutesBefore });
      consider({
        kind: 'task',
        sourceType: 'task',
        sourceId: t.id,
        dedupeKey: `task:${t.id}:${due.toUTC().toISO()}:${a.minutesBefore}`,
        fireAt: fire.toUTC().toISO()!,
        expiresAt: fire.plus({ hours: 12 }).toUTC().toISO()!,
        title: t.title,
        body: t.dueTime ? `Due ${formatTime12(t.dueTime)}` : 'Due today',
        url: `/?date=${t.dueDate}`,
      });
    }
  }

  if (prefs.dailyAgenda) {
    for (let i = 0; i <= horizonDays; i++) {
      const d = addDays(today, i);
      const fire = instant(d, prefs.dailyAgendaTime, userTz);
      consider({
        kind: 'agenda',
        sourceType: null,
        sourceId: null,
        dedupeKey: `agenda:${d}`,
        fireAt: fire.toUTC().toISO()!,
        expiresAt: fire.plus({ hours: 3 }).toUTC().toISO()!,
        title: 'Today’s plan',
        body: '', // built at delivery time so it reflects the latest schedule
        url: `/?date=${d}`,
      });
    }
  }
  return out;
}

export function leadText(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? '' : 's'}`;
  if (min % 60 === 0) return `${min / 60} hr`;
  return `${Math.floor(min / 60)} hr ${min % 60} min`;
}

/** Is a UTC instant within the user's quiet hours (local wall clock)? */
export function inQuietHours(prefs: NotificationPrefs, tz: string, at: Date): boolean {
  if (!prefs.quietStart || !prefs.quietEnd || prefs.quietStart === prefs.quietEnd) return false;
  const local = DateTime.fromJSDate(at).setZone(tz);
  const m = local.hour * 60 + local.minute;
  const s = minutesOfDay(prefs.quietStart);
  const e = minutesOfDay(prefs.quietEnd);
  return s < e ? m >= s && m < e : m >= s || m < e;
}
