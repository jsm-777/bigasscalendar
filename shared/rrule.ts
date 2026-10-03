import type { Weekday } from './types.ts';

// Minimal RFC 5545 RRULE helpers for the repeat options the app offers. Google Calendar expands
// series itself; we only build rules and cut them for "this and following" edits.

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export interface Rule {
  freq: Freq;
  interval: number;
  byDay: Weekday[];
  until: string | null; // raw RRULE UNTIL value
  count: number | null;
}

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function parseRule(recurrence: string[] | null | undefined): Rule | null {
  const line = recurrence?.find((r) => r.startsWith('RRULE:'));
  if (!line) return null;
  const parts = Object.fromEntries(line.slice(6).split(';').map((p) => p.split('=') as [string, string]));
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(parts.FREQ)) return null;
  return {
    freq: parts.FREQ as Freq,
    interval: Number(parts.INTERVAL ?? 1),
    byDay: (parts.BYDAY ?? '').split(',').filter(Boolean).map((d) => (DAYS.indexOf(d.slice(-2)) + 1) as Weekday).filter((d) => d > 0),
    until: parts.UNTIL ?? null,
    count: parts.COUNT ? Number(parts.COUNT) : null,
  };
}

export function buildRule(r: Rule): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'WEEKLY' && r.byDay.length) parts.push(`BYDAY=${[...r.byDay].sort().map((d) => DAYS[d - 1]).join(',')}`);
  if (r.until) parts.push(`UNTIL=${r.until}`);
  else if (r.count) parts.push(`COUNT=${r.count}`);
  return `RRULE:${parts.join(';')}`;
}

/** Replace the RRULE in a recurrence array, keeping EXDATE/RDATE lines. */
export function replaceRule(recurrence: string[], rule: Rule): string[] {
  return [...recurrence.filter((r) => !r.startsWith('RRULE:')), buildRule(rule)];
}

/**
 * UNTIL value that ends a series just before an occurrence.
 * Timed series: the instant one second earlier, in UTC. All-day series: the previous date.
 */
export function untilBefore(originalStart: string, allDay: boolean): string {
  if (allDay) {
    const d = new Date(`${originalStart.slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  const t = new Date(new Date(originalStart).getTime() - 1000);
  return t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function describeRule(r: Rule | null): string {
  if (!r) return 'Does not repeat';
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const every = (unit: string) => (r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`);
  let s = r.freq === 'DAILY' ? every('day') : r.freq === 'WEEKLY' ? every('week') : r.freq === 'MONTHLY' ? every('month') : every('year');
  if (r.freq === 'WEEKLY' && r.byDay.length) s += ` on ${r.byDay.map((d) => names[d - 1]).join(', ')}`;
  if (r.count) s += `, ${r.count} times`;
  if (r.until) s += `, until ${r.until.slice(0, 4)}-${r.until.slice(4, 6)}-${r.until.slice(6, 8)}`;
  return s;
}
