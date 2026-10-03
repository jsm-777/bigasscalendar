import { describe, expect, it } from 'vitest';
import { mapEvent } from '../src/lib/google.ts';
import type { Cal } from '../shared/types.ts';

const cal: Cal = { id: 'c', summary: 'Personal', color: '#2d6bff', textColor: '#fff', accessRole: 'owner', primary: true };
const LA = 'America/Los_Angeles';

describe('mapping Google events', () => {
  it('turns exclusive all-day end dates into inclusive local dates', () => {
    const e = mapEvent({ id: '1', summary: 'Trip', start: { date: '2026-10-30' }, end: { date: '2026-11-03' } }, cal, LA)!;
    expect(e.allDay).toBe(true);
    expect([e.startDate, e.endDate]).toEqual(['2026-10-30', '2026-11-02']);
  });

  it('shows timed events in the user zone', () => {
    // 9:00 in New York is 6:00 in Los Angeles.
    const e = mapEvent({ id: '2', summary: 'Shift', start: { dateTime: '2026-10-05T09:00:00-04:00' }, end: { dateTime: '2026-10-05T17:00:00-04:00' } }, cal, LA)!;
    expect(e.startLocal).toBe('2026-10-05T06:00');
    expect(e.endLocal).toBe('2026-10-05T14:00');
  });

  it('crosses midnight correctly in the user zone', () => {
    const e = mapEvent({ id: '3', summary: 'Late', start: { dateTime: '2026-10-06T05:30:00Z' }, end: { dateTime: '2026-10-06T08:00:00Z' } }, cal, LA)!;
    expect(e.startDate).toBe('2026-10-05');
    expect(e.endDate).toBe('2026-10-06');
  });

  it('treats an end at exactly midnight as the previous day', () => {
    const e = mapEvent({ id: '4', summary: 'Evening', start: { dateTime: '2026-10-05T22:00:00-07:00' }, end: { dateTime: '2026-10-06T00:00:00-07:00' } }, cal, LA)!;
    expect(e.endDate).toBe('2026-10-05');
  });

  it('hides details on free/busy calendars and skips cancelled events', () => {
    const fb = { ...cal, accessRole: 'freeBusyReader' as const };
    const e = mapEvent({ id: '5', summary: 'Secret', location: 'Home', description: 'x', start: { dateTime: '2026-10-05T09:00:00-07:00' }, end: { dateTime: '2026-10-05T10:00:00-07:00' } }, fb, LA)!;
    expect([e.title, e.location, e.description, e.busyOnly]).toEqual(['Busy', '', '', true]);
    expect(mapEvent({ id: '6', status: 'cancelled', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }, cal, LA)).toBeNull();
  });

  it('keeps recurring instance info and event colors', () => {
    const e = mapEvent({ id: 'm_20261005', summary: 'Workout', colorId: '11', recurringEventId: 'm', originalStartTime: { dateTime: '2026-10-05T06:30:00-07:00' }, start: { dateTime: '2026-10-05T06:30:00-07:00' }, end: { dateTime: '2026-10-05T07:15:00-07:00' } }, cal, LA)!;
    expect(e.recurringEventId).toBe('m');
    expect(e.originalStart).toBe('2026-10-05T06:30:00-07:00');
    expect(e.colorOverride).toBe('#d50000');
  });
});
