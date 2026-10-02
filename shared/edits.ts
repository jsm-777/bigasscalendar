import type { CalEvent, EventException, EventOverride, ISODate, Occurrence } from './types.ts';
import { addDays, diffDays, localDate, localTime, wallDiffMinutes, addWallMinutes } from './dates.ts';
import { countBefore, shiftRule } from './recurrence.ts';

export type EditScope = 'this' | 'following' | 'all';

/** New values for a single occurrence (any subset). */
export type OccurrencePatch = EventOverride;

export interface EditResult {
  /** Updated original event, or null when it should be deleted. */
  updated: CalEvent | null;
  /** Newly created events (e.g. the tail of a split series). */
  created: CalEvent[];
}

/** Resolve the occurrence fields after a patch (used for moves/resizes). */
export function patchedOccurrence(occ: Occurrence, patch: OccurrencePatch): Occurrence {
  const next = { ...occ, ...stripUndefined(patch) } as Occurrence;
  if (next.allDay) {
    next.startLocal = null;
    next.endLocal = null;
  }
  return next;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Move a single occurrence by whole days, preserving local start time and duration. */
export function moveByDays(occ: Occurrence, days: number): OccurrencePatch {
  return {
    startDate: addDays(occ.startDate, days),
    endDate: addDays(occ.endDate, days),
    startLocal: occ.startLocal ? `${addDays(localDate(occ.startLocal), days)}T${localTime(occ.startLocal)}` : null,
    endLocal: occ.endLocal ? `${addDays(localDate(occ.endLocal), days)}T${localTime(occ.endLocal)}` : null,
  };
}

/** Move a timed occurrence to a new local start, preserving its wall-clock duration. */
export function moveToStart(occ: Occurrence, newStartLocal: string): OccurrencePatch {
  if (!occ.startLocal || !occ.endLocal) return moveByDays(occ, diffDays(localDate(newStartLocal), occ.startDate));
  const duration = wallDiffMinutes(occ.endLocal, occ.startLocal);
  const endLocal = addWallMinutes(newStartLocal, duration);
  return { startDate: localDate(newStartLocal), endDate: localDate(endLocal), startLocal: newStartLocal, endLocal };
}

function overrideFor(base: Occurrence, patch: OccurrencePatch, previous: EventOverride | null): EventOverride {
  const merged: EventOverride = { ...(previous ?? {}) };
  for (const [k, v] of Object.entries(stripUndefined(patch))) {
    (merged as Record<string, unknown>)[k] = v;
  }
  // Drop fields equal to the series value so later series edits still flow through.
  for (const k of Object.keys(merged) as (keyof EventOverride)[]) {
    if ((base as unknown as Record<string, unknown>)[k] === merged[k]) delete merged[k];
  }
  return merged;
}

/** Apply a whole-series change, expressed relative to one occurrence. */
function applyToSeries(ev: CalEvent, occ: Occurrence, patch: OccurrencePatch): CalEvent {
  const next = patchedOccurrence(occ, patch);
  const dayDelta = diffDays(next.startDate, occ.originalDate);
  const startDate = addDays(ev.startDate, dayDelta);
  const span = diffDays(next.endDate, next.startDate);
  const out: CalEvent = {
    ...ev,
    title: next.title,
    calendarId: next.calendarId,
    location: next.location,
    notes: next.notes,
    allDay: next.allDay,
    startDate,
    endDate: addDays(startDate, span),
    startLocal: null,
    endLocal: null,
  };
  if (!next.allDay && next.startLocal && next.endLocal) {
    out.startLocal = `${startDate}T${localTime(next.startLocal)}`;
    out.endLocal = addWallMinutes(out.startLocal, wallDiffMinutes(next.endLocal, next.startLocal));
    out.endDate = localDate(out.endLocal);
  }
  if (ev.recurrence && dayDelta !== 0) {
    out.recurrence = shiftRule(ev.recurrence, dayDelta);
    out.exceptions = ev.exceptions.map((e) => ({ ...e, originalDate: addDays(e.originalDate, dayDelta) }));
  }
  return out;
}

export function editOccurrence(
  ev: CalEvent,
  occ: Occurrence,
  scope: EditScope,
  patch: OccurrencePatch,
  newId: () => string,
): EditResult {
  if (!ev.recurrence || scope === 'all' || (scope === 'following' && occ.originalDate === ev.startDate)) {
    return { updated: applyToSeries(ev, occ, patch), created: [] };
  }
  if (scope === 'this') {
    const prev = ev.exceptions.find((e) => e.originalDate === occ.originalDate);
    const baseOcc = { ...occ, ...seriesValues(ev, occ.originalDate) };
    const override = overrideFor(baseOcc, { ...occOverrideValues(occ), ...patch }, prev?.override ?? null);
    const exceptions: EventException[] = ev.exceptions.filter((e) => e.originalDate !== occ.originalDate);
    exceptions.push({ originalDate: occ.originalDate, cancelled: false, override });
    return { updated: { ...ev, exceptions }, created: [] };
  }
  // 'following': end the original series the day before, start a new one at this occurrence.
  const { head, tail } = splitSeries(ev, occ.originalDate, newId());
  const tailOcc: Occurrence = { ...occ, eventId: tail.id, key: `${tail.id}:${occ.originalDate}` };
  return { updated: head, created: [applyToSeries(tail, tailOcc, patch)] };
}

export function deleteOccurrence(ev: CalEvent, occ: Occurrence, scope: EditScope): EditResult {
  if (!ev.recurrence || scope === 'all' || (scope === 'following' && occ.originalDate === ev.startDate)) {
    return { updated: null, created: [] };
  }
  if (scope === 'this') {
    const exceptions = ev.exceptions.filter((e) => e.originalDate !== occ.originalDate);
    exceptions.push({ originalDate: occ.originalDate, cancelled: true, override: null });
    return { updated: { ...ev, exceptions }, created: [] };
  }
  const { head } = splitSeries(ev, occ.originalDate, 'unused');
  return { updated: head, created: [] };
}

/** Split a recurring series at `date`: head ends the day before, tail starts on `date`. */
export function splitSeries(ev: CalEvent, date: ISODate, tailId: string): { head: CalEvent; tail: CalEvent } {
  const rule = ev.recurrence!;
  const before = countBefore(ev.startDate, rule, date);
  const headRule = rule.count ? { ...rule, count: before, until: undefined } : { ...rule, until: addDays(date, -1) };
  const head: CalEvent = {
    ...ev,
    recurrence: headRule,
    exceptions: ev.exceptions.filter((e) => e.originalDate < date),
  };
  const shift = diffDays(date, ev.startDate);
  const tail: CalEvent = {
    ...ev,
    id: tailId,
    startDate: date,
    endDate: addDays(ev.endDate, shift),
    startLocal: ev.startLocal ? `${date}T${localTime(ev.startLocal)}` : null,
    endLocal: ev.endLocal ? `${addDays(localDate(ev.endLocal), shift)}T${localTime(ev.endLocal)}` : null,
    recurrence: rule.count ? { ...rule, count: Math.max(1, rule.count - before) } : { ...rule },
    exceptions: ev.exceptions.filter((e) => e.originalDate >= date),
    version: 0,
  };
  return { head, tail };
}

function seriesValues(ev: CalEvent, originalDate: ISODate): Partial<Occurrence> {
  const shift = diffDays(originalDate, ev.startDate);
  return {
    title: ev.title,
    calendarId: ev.calendarId,
    allDay: ev.allDay,
    location: ev.location,
    notes: ev.notes,
    startDate: originalDate,
    endDate: addDays(ev.endDate, shift),
    startLocal: ev.startLocal ? `${originalDate}T${localTime(ev.startLocal)}` : null,
    endLocal: ev.endLocal ? `${addDays(localDate(ev.endLocal), shift)}T${localTime(ev.endLocal)}` : null,
  };
}

function occOverrideValues(occ: Occurrence): OccurrencePatch {
  return {
    title: occ.title,
    calendarId: occ.calendarId,
    allDay: occ.allDay,
    location: occ.location,
    notes: occ.notes,
    startDate: occ.startDate,
    endDate: occ.endDate,
    startLocal: occ.startLocal,
    endLocal: occ.endLocal,
  };
}
