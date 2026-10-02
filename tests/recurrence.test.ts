import { describe, expect, it } from 'vitest';
import { expandEvent, occurrenceDates } from '../shared/recurrence.ts';
import { deleteOccurrence, editOccurrence, moveByDays, moveToStart } from '../shared/edits.ts';
import { localToInstant } from '../shared/dates.ts';
import type { CalEvent } from '../shared/types.ts';

const base = (over: Partial<CalEvent> = {}): CalEvent => ({
  id: 'e1', ownerId: 'u1', calendarId: 'c1', title: 'Workout', allDay: false,
  startDate: '2026-10-05', endDate: '2026-10-05', startLocal: '2026-10-05T07:00', endLocal: '2026-10-05T08:00',
  tz: 'America/Los_Angeles', location: '', notes: '', recurrence: null, exceptions: [], alerts: [],
  taskId: null, goalId: null, version: 1, updatedAt: '', ...over,
});
let n = 0;
const newId = () => `new${++n}`;

describe('recurrence expansion', () => {
  it('weekly on several weekdays with count', () => {
    const d = occurrenceDates('2026-10-05', { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5], count: 5 }, '2026-01-01', '2027-01-01');
    expect(d).toEqual(['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14']);
  });

  it('every other week until a date', () => {
    const d = occurrenceDates('2026-10-05', { freq: 'weekly', interval: 2, until: '2026-11-16' }, '2026-01-01', '2027-01-01');
    expect(d).toEqual(['2026-10-05', '2026-10-19', '2026-11-02', '2026-11-16']);
  });

  it('monthly on the 31st skips short months', () => {
    const d = occurrenceDates('2026-10-31', { freq: 'monthly', interval: 1 }, '2026-10-01', '2027-03-31');
    expect(d).toEqual(['2026-10-31', '2026-12-31', '2027-01-31', '2027-03-31']);
  });

  it('yearly on Feb 29 only in leap years', () => {
    const d = occurrenceDates('2028-02-29', { freq: 'yearly', interval: 1 }, '2028-01-01', '2036-12-31');
    expect(d).toEqual(['2028-02-29', '2032-02-29', '2036-02-29']);
  });

  it('jumps ahead efficiently for far ranges without changing results', () => {
    const d = occurrenceDates('2026-01-01', { freq: 'daily', interval: 3 }, '2027-06-01', '2027-06-10');
    expect(d).toEqual(['2027-06-01', '2027-06-04', '2027-06-07', '2027-06-10']);
    const w = occurrenceDates('2026-01-05', { freq: 'weekly', interval: 2 }, '2027-06-01', '2027-06-30');
    expect(w).toEqual(['2027-06-07', '2027-06-21']);
  });

  it('keeps local wall time across DST (9:00 stays 9:00)', () => {
    const ev = base({ startDate: '2026-10-26', endDate: '2026-10-26', startLocal: '2026-10-26T09:00', endLocal: '2026-10-26T10:00', recurrence: { freq: 'weekly', interval: 1 } });
    const occ = expandEvent(ev, '2026-10-26', '2026-11-09');
    expect(occ.map((o) => o.startLocal)).toEqual(['2026-10-26T09:00', '2026-11-02T09:00', '2026-11-09T09:00']);
    // UTC offsets differ before/after Nov 1 fall-back
    expect(localToInstant(occ[0].startLocal!, ev.tz).toISOString()).toBe('2026-10-26T16:00:00.000Z');
    expect(localToInstant(occ[1].startLocal!, ev.tz).toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });

  it('multi-day events crossing a month boundary are found from either month', () => {
    const ev = base({ allDay: true, startLocal: null, endLocal: null, startDate: '2026-10-30', endDate: '2026-11-02' });
    expect(expandEvent(ev, '2026-11-01', '2026-11-30')).toHaveLength(1);
    expect(expandEvent(ev, '2026-10-01', '2026-10-31')).toHaveLength(1);
  });
});

describe('recurring edits', () => {
  const series = () => base({ recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] } });
  const occOn = (ev: CalEvent, date: string) => expandEvent(ev, date, date).find((o) => o.originalDate === date)!;

  it('this occurrence: creates an exception and leaves the rest alone', () => {
    const ev = series();
    const occ = occOn(ev, '2026-10-19');
    const { updated, created } = editOccurrence(ev, occ, 'this', moveByDays(occ, 2), newId);
    expect(created).toHaveLength(0);
    const all = expandEvent(updated!, '2026-10-01', '2026-11-01').map((o) => o.startDate);
    expect(all).toEqual(['2026-10-05', '2026-10-12', '2026-10-21', '2026-10-26']);
    expect(updated!.recurrence).toEqual(ev.recurrence);
  });

  it('a moved occurrence still shows when its original date is outside the range', () => {
    const ev = series();
    const occ = occOn(ev, '2026-10-26');
    const { updated } = editOccurrence(ev, occ, 'this', moveByDays(occ, 7), newId);
    const nov = expandEvent(updated!, '2026-11-02', '2026-11-02');
    expect(nov.map((o) => o.originalDate).sort()).toEqual(['2026-10-26', '2026-11-02']);
  });

  it('this and following: splits the series and keeps earlier exceptions', () => {
    let ev = series();
    const early = occOn(ev, '2026-10-12');
    ev = editOccurrence(ev, early, 'this', { title: 'Leg day' }, newId).updated!;
    const occ = occOn(ev, '2026-10-26');
    const { updated, created } = editOccurrence(ev, occ, 'following', moveToStart(occ, '2026-10-26T18:00'), newId);
    expect(updated!.recurrence!.until).toBe('2026-10-25');
    expect(updated!.exceptions).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(created[0].startLocal).toBe('2026-10-26T18:00');
    expect(created[0].endLocal).toBe('2026-10-26T19:00');
    const head = expandEvent(updated!, '2026-10-01', '2026-12-01');
    const tail = expandEvent(created[0], '2026-10-01', '2026-11-10');
    expect(head.map((o) => o.title)).toEqual(['Workout', 'Leg day', 'Workout']);
    expect(tail.map((o) => o.startLocal)).toEqual(['2026-10-26T18:00', '2026-11-02T18:00', '2026-11-09T18:00']);
  });

  it('counted series split keeps the total number of occurrences', () => {
    const ev = base({ recurrence: { freq: 'daily', interval: 1, count: 10 } });
    const occ = occOn(ev, '2026-10-09');
    const { updated, created } = editOccurrence(ev, occ, 'following', { title: 'Later' }, newId);
    expect(updated!.recurrence!.count).toBe(4);
    expect(created[0].recurrence!.count).toBe(6);
  });

  it('entire series: moving by a day shifts weekdays and exceptions', () => {
    let ev = series();
    ev = deleteOccurrence(ev, occOn(ev, '2026-10-12'), 'this').updated!;
    const occ = occOn(ev, '2026-10-19');
    const { updated } = editOccurrence(ev, occ, 'all', moveByDays(occ, 1), newId);
    expect(updated!.recurrence!.byWeekday).toEqual([2]);
    expect(updated!.startDate).toBe('2026-10-06');
    const dates = expandEvent(updated!, '2026-10-01', '2026-10-31').map((o) => o.startDate);
    expect(dates).toEqual(['2026-10-06', '2026-10-20', '2026-10-27']); // the skipped week stays skipped
  });

  it('deleting one occurrence never removes the series', () => {
    const ev = series();
    const { updated } = deleteOccurrence(ev, occOn(ev, '2026-10-12'), 'this');
    expect(updated).not.toBeNull();
    expect(expandEvent(updated!, '2026-10-01', '2026-10-31')).toHaveLength(3);
  });

  it('moving preserves duration across midnight', () => {
    const ev = base({ startLocal: '2026-10-05T23:00', endLocal: '2026-10-06T01:00', endDate: '2026-10-06' });
    const occ = expandEvent(ev, '2026-10-05', '2026-10-06')[0];
    const p = moveToStart(occ, '2026-10-08T22:30');
    expect(p.endLocal).toBe('2026-10-09T00:30');
    expect(p.endDate).toBe('2026-10-09');
  });
});
