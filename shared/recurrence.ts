import type { CalEvent, EventException, ISODate, Occurrence, Recurrence } from './types.ts';
import {
  addDays, addMonths, daysInMonth, diffDays, localDate, localTime, makeDate, parseDate,
  rangesOverlap, weekday, ymd,
} from './dates.ts';

// Recurrence is expanded on local calendar dates, then combined with the event's local
// time-of-day and IANA zone. A 9:00 weekly event therefore stays at 9:00 local time across
// DST transitions instead of drifting by an hour.

const HARD_LIMIT = 5000;

/** Generate occurrence dates (local) of a rule starting at `start`, within [from, to]. */
export function occurrenceDates(start: ISODate, rule: Recurrence | null, from: ISODate, to: ISODate): ISODate[] {
  if (!rule) return start >= from && start <= to ? [start] : [];
  const out: ISODate[] = [];
  const interval = Math.max(1, rule.interval || 1);
  const until = rule.until && rule.until < to ? rule.until : to;
  let produced = 0;
  const emit = (d: ISODate): boolean => {
    if (d < start) return true;
    if (rule.until && d > rule.until) return false;
    produced++;
    if (rule.count && produced > rule.count) return false;
    if (d >= from && d <= to) out.push(d);
    return d <= until;
  };

  if (rule.freq === 'daily') {
    // Jump close to `from` when no count is involved to keep long ranges cheap.
    let d = start;
    if (!rule.count && from > start) {
      const skip = Math.floor(diffDays(from, start) / interval) * interval;
      d = addDays(start, skip);
    }
    for (let i = 0; i < HARD_LIMIT * 10 && emit(d); i++) d = addDays(d, interval);
  } else if (rule.freq === 'weekly') {
    const days = (rule.byWeekday && rule.byWeekday.length ? [...rule.byWeekday] : [weekday(start)]).sort();
    // Weeks are anchored on the Monday of the start week.
    let weekStart = addDays(start, -(weekday(start) - 1));
    if (!rule.count && from > start) {
      const weeks = Math.floor(diffDays(from, weekStart) / 7);
      weekStart = addDays(weekStart, Math.max(0, Math.floor(weeks / interval) - 1) * interval * 7);
    }
    outer: for (let i = 0; i < HARD_LIMIT; i++) {
      for (const wd of days) {
        if (!emit(addDays(weekStart, wd - 1))) break outer;
      }
      weekStart = addDays(weekStart, 7 * interval);
    }
  } else if (rule.freq === 'monthly') {
    const [sy, sm, sd] = ymd(start);
    const dom = rule.byMonthDay ?? sd;
    for (let i = 0; i < HARD_LIMIT; i++) {
      const total = sm - 1 + i * interval;
      const y = sy + Math.floor(total / 12);
      const m = (total % 12) + 1;
      // Months without that day are skipped (RFC 5545 behaviour), not clamped.
      if (dom > daysInMonth(y, m)) {
        if (makeDate(y, m, 1) > until) break;
        continue;
      }
      if (!emit(makeDate(y, m, dom))) break;
    }
  } else if (rule.freq === 'yearly') {
    const [sy, sm, sd] = ymd(start);
    for (let i = 0; i < HARD_LIMIT; i++) {
      const y = sy + i * interval;
      if (sd > daysInMonth(y, sm)) {
        // Feb 29 only occurs in leap years.
        if (makeDate(y, sm, 1) > until) break;
        continue;
      }
      if (!emit(makeDate(y, sm, sd))) break;
    }
  }
  return out;
}

export function eventSpanDays(ev: Pick<CalEvent, 'startDate' | 'endDate'>): number {
  return diffDays(ev.endDate, ev.startDate);
}

function baseOccurrence(ev: CalEvent, originalDate: ISODate): Occurrence {
  const shift = diffDays(originalDate, ev.startDate);
  return {
    key: `${ev.id}:${originalDate}`,
    eventId: ev.id,
    originalDate,
    title: ev.title,
    calendarId: ev.calendarId,
    ownerId: ev.ownerId,
    allDay: ev.allDay,
    startDate: originalDate,
    endDate: addDays(ev.endDate, shift),
    startLocal: ev.startLocal ? `${originalDate}T${localTime(ev.startLocal)}` : null,
    endLocal: ev.endLocal ? `${addDays(localDate(ev.endLocal), shift)}T${localTime(ev.endLocal)}` : null,
    tz: ev.tz,
    location: ev.location,
    notes: ev.notes,
    recurring: !!ev.recurrence,
    isException: false,
    redacted: ev.redacted,
    taskId: ev.taskId,
  };
}

function applyOverride(occ: Occurrence, ex: EventException): Occurrence {
  const o = ex.override ?? {};
  const next: Occurrence = { ...occ, isException: true };
  if (o.title !== undefined) next.title = o.title;
  if (o.allDay !== undefined) next.allDay = o.allDay;
  if (o.startDate !== undefined) next.startDate = o.startDate;
  if (o.endDate !== undefined) next.endDate = o.endDate;
  if (o.startLocal !== undefined) next.startLocal = o.startLocal;
  if (o.endLocal !== undefined) next.endLocal = o.endLocal;
  if (o.location !== undefined) next.location = o.location;
  if (o.notes !== undefined) next.notes = o.notes;
  if (o.calendarId !== undefined) next.calendarId = o.calendarId;
  if (next.allDay) {
    next.startLocal = null;
    next.endLocal = null;
  }
  return next;
}

/** Expand an event (recurring or not) into occurrences overlapping [from, to]. */
export function expandEvent(ev: CalEvent, from: ISODate, to: ISODate): Occurrence[] {
  const span = eventSpanDays(ev);
  const exceptions = new Map(ev.exceptions.map((e) => [e.originalDate, e]));
  const result: Occurrence[] = [];
  // Look back by the event length so multi-day occurrences that began earlier are kept.
  for (const d of occurrenceDates(ev.startDate, ev.recurrence, addDays(from, -span), to)) {
    const ex = exceptions.get(d);
    if (ex) continue; // handled below
    const occ = baseOccurrence(ev, d);
    if (rangesOverlap(occ.startDate, occ.endDate, from, to)) result.push(occ);
  }
  // Exceptions: modified occurrences may have moved into (or out of) the range.
  for (const ex of ev.exceptions) {
    if (ex.cancelled) continue;
    if (!isOccurrenceDate(ev, ex.originalDate)) continue;
    const occ = applyOverride(baseOccurrence(ev, ex.originalDate), ex);
    if (rangesOverlap(occ.startDate, occ.endDate, from, to)) result.push(occ);
  }
  return result.sort(compareOccurrences);
}

export function isOccurrenceDate(ev: Pick<CalEvent, 'startDate' | 'recurrence'>, d: ISODate): boolean {
  return occurrenceDates(ev.startDate, ev.recurrence, d, d).length === 1;
}

export function expandAll(events: CalEvent[], from: ISODate, to: ISODate): Occurrence[] {
  return events.flatMap((e) => expandEvent(e, from, to)).sort(compareOccurrences);
}

export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const sa = a.startLocal ?? '';
  const sb = b.startLocal ?? '';
  if (sa !== sb) return sa < sb ? -1 : 1;
  const la = diffDays(a.endDate, a.startDate);
  const lb = diffDays(b.endDate, b.startDate);
  if (la !== lb) return lb - la;
  return a.title.localeCompare(b.title);
}

/** Number of occurrences of a rule strictly before `date` (used to split counted series). */
export function countBefore(start: ISODate, rule: Recurrence, date: ISODate): number {
  return occurrenceDates(start, { ...rule, count: undefined, until: addDays(date, -1) }, start, addDays(date, -1))
    .length;
}

/** Shift weekday/month-day anchors when a whole series moves by `days`. */
export function shiftRule(rule: Recurrence, days: number): Recurrence {
  const next: Recurrence = { ...rule };
  if (rule.byWeekday?.length && days % 7 !== 0) {
    next.byWeekday = rule.byWeekday
      .map((w) => ((((w - 1 + days) % 7) + 7) % 7) + 1)
      .sort() as Recurrence['byWeekday'];
  }
  if (rule.byMonthDay) next.byMonthDay = undefined; // re-anchor on the new start date
  if (rule.until) next.until = addDays(rule.until, days);
  return next;
}

export function describeRecurrence(rule: Recurrence | null, start?: ISODate): string {
  if (!rule) return 'Does not repeat';
  const n = rule.interval > 1 ? rule.interval : 0;
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let s = '';
  switch (rule.freq) {
    case 'daily':
      s = n ? `Every ${n} days` : 'Daily';
      break;
    case 'weekly': {
      const days = rule.byWeekday?.length ? rule.byWeekday : start ? [weekday(start)] : [];
      s = (n ? `Every ${n} weeks` : 'Weekly') + (days.length ? ` on ${days.map((d) => names[d - 1]).join(', ')}` : '');
      break;
    }
    case 'monthly':
      s = (n ? `Every ${n} months` : 'Monthly') + (start ? ` on day ${rule.byMonthDay ?? ymd(start)[2]}` : '');
      break;
    case 'yearly':
      s = n ? `Every ${n} years` : 'Yearly';
      break;
  }
  if (rule.count) s += `, ${rule.count} times`;
  if (rule.until) s += `, until ${rule.until}`;
  return s;
}

export { parseDate, addMonths };
