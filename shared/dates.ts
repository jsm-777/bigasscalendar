import { DateTime } from 'luxon';
import type { ISODate, LocalDateTime } from './types.ts';

// Date-only values are handled as plain calendar dates (UTC-anchored arithmetic) so
// they can never shift because of a time-zone conversion.

const DAY_MS = 86_400_000;

export function parseDate(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fmtDate(dt: Date): ISODate {
  return dt.toISOString().slice(0, 10);
}

export function makeDate(y: number, m: number, d: number): ISODate {
  return fmtDate(new Date(Date.UTC(y, m - 1, d)));
}

export function addDays(d: ISODate, n: number): ISODate {
  return fmtDate(new Date(parseDate(d).getTime() + n * DAY_MS));
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / DAY_MS);
}

export function addMonths(d: ISODate, n: number): ISODate {
  const dt = parseDate(d);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + n;
  const target = new Date(Date.UTC(y, m, 1));
  const dim = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  return makeDate(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(dt.getUTCDate(), dim));
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** ISO weekday 1 (Mon) … 7 (Sun). */
export function weekday(d: ISODate): number {
  const w = parseDate(d).getUTCDay();
  return w === 0 ? 7 : w;
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function ymd(d: ISODate): [number, number, number] {
  const [y, m, day] = d.split('-').map(Number);
  return [y, m, day];
}

export function monthKey(d: ISODate): string {
  return d.slice(0, 7);
}

export function startOfWeek(d: ISODate, weekStartsOn: 1 | 7 = 7): ISODate {
  const w = weekday(d);
  const offset = weekStartsOn === 1 ? w - 1 : w % 7;
  return addDays(d, -offset);
}

export function startOfMonth(d: ISODate): ISODate {
  return d.slice(0, 8) + '01';
}

export function endOfMonth(d: ISODate): ISODate {
  const [y, m] = ymd(d);
  return makeDate(y, m, daysInMonth(y, m));
}

export function inRange(d: ISODate, from: ISODate, to: ISODate): boolean {
  return d >= from && d <= to;
}

export function rangesOverlap(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Today's date in an IANA zone. */
export function todayIn(tz: string, now: Date = new Date()): ISODate {
  return DateTime.fromJSDate(now).setZone(tz).toISODate()!;
}

export function nowLocal(tz: string, now: Date = new Date()): LocalDateTime {
  return DateTime.fromJSDate(now).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm");
}

/**
 * Resolve a wall-clock time in a zone to a UTC instant.
 * DST gap (time that does not exist): moves forward by the gap length (02:30 → 03:30).
 * DST overlap (time that happens twice): picks the earlier instant.
 */
export function localToInstant(local: LocalDateTime, tz: string): Date {
  const dt = DateTime.fromISO(local, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid local time ${local} in ${tz}`);
  return dt.toJSDate();
}

export function instantToLocal(instant: Date, tz: string): LocalDateTime {
  return DateTime.fromJSDate(instant).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm");
}

export function localDate(local: LocalDateTime): ISODate {
  return local.slice(0, 10);
}

export function localTime(local: LocalDateTime): string {
  return local.slice(11, 16);
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Wall-clock difference in minutes between two local date-times (ignores DST). */
export function wallDiffMinutes(a: LocalDateTime, b: LocalDateTime): number {
  return diffDays(localDate(a), localDate(b)) * 1440 + minutesOfDay(localTime(a)) - minutesOfDay(localTime(b));
}

export function addWallMinutes(local: LocalDateTime, minutes: number): LocalDateTime {
  const total = minutesOfDay(localTime(local)) + minutes;
  const dayShift = Math.floor(total / 1440);
  return `${addDays(localDate(local), dayShift)}T${hhmm(total - dayShift * 1440)}`;
}

export function formatTime12(hhmmStr: string): string {
  const [h, m] = hhmmStr.split(':').map(Number);
  const suffix = h < 12 ? 'a' : 'p';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

export function formatLongDate(d: ISODate): string {
  const [y, m, day] = ymd(d);
  return `${WEEKDAY_SHORT[weekday(d) - 1]}, ${MONTH_NAMES[m - 1]} ${day}, ${y}`;
}

/** Twelve-month range starting at the first of a month. */
export function yearRange(startMonth: string): { from: ISODate; to: ISODate; months: string[] } {
  const from = `${startMonth}-01`;
  const months: string[] = [];
  for (let i = 0; i < 12; i++) months.push(monthKey(addMonths(from, i)));
  const to = endOfMonth(`${months[11]}-01`);
  return { from, to, months };
}

/** Convert a wall-clock time between zones (identity when equal). */
export function convertLocal(local: LocalDateTime, fromTz: string, toTz: string): LocalDateTime {
  if (fromTz === toTz) return local;
  return instantToLocal(localToInstant(local, fromTz), toTz);
}
