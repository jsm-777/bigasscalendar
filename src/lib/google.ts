import { DateTime } from 'luxon';
import type { AppData, Cal, Ev, Reminders, Task, TaskList } from '../../shared/types.ts';
import { EMPTY_APP_DATA } from '../../shared/types.ts';
import { addDays, addWallMinutes, diffDays, wallDiffMinutes } from '../../shared/dates.ts';
import { parseRule, replaceRule, untilBefore, buildRule, type Rule } from '../../shared/rrule.ts';
import { fetchToken } from './auth.ts';
import type { Backend, EventInput } from './backend.ts';

// Direct calls to Google's REST APIs with the signed-in user's access token.
const CAL = 'https://www.googleapis.com/calendar/v3';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';
const APP_FILE = 'big-ass-calendar.json';

// Google Calendar's fixed event colors (colorId 1–11).
export const EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e',
  '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
};

export class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function g<T = unknown>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
  const { token } = await fetchToken();
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' && !(init.headers as Record<string, string>)?.['content-type'] ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  } catch {
    throw new GoogleError(0, 'You appear to be offline.');
  }
  if (r.status === 401 && retry) {
    await fetchToken(true);
    return g<T>(url, init, false);
  }
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new GoogleError(r.status, json?.error?.message ?? `Google request failed (${r.status})`);
  return json as T;
}

async function pages<T>(url: string, key = 'items'): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  for (let i = 0; i < 50; i++) {
    const u = new URL(url);
    if (token) u.searchParams.set('pageToken', token);
    const res = await g<Record<string, unknown>>(u.toString());
    out.push(...((res[key] as T[]) ?? []));
    token = res.nextPageToken as string | undefined;
    if (!token) break;
  }
  return out;
}

interface GTime { date?: string; dateTime?: string; timeZone?: string }
interface GEvent {
  id: string; status?: string; summary?: string; location?: string; description?: string; colorId?: string;
  start: GTime; end: GTime; recurringEventId?: string; originalStartTime?: GTime; recurrence?: string[];
  reminders?: { useDefault?: boolean; overrides?: { method: 'popup' | 'email'; minutes: number }[] }; htmlLink?: string;
}

export function mapEvent(e: GEvent, cal: Cal, tz: string): Ev | null {
  if (e.status === 'cancelled' || !e.start) return null;
  const allDay = !!e.start.date;
  let startDate: string; let endDate: string; let startLocal: string | null = null; let endLocal: string | null = null;
  if (allDay) {
    startDate = e.start.date!;
    endDate = addDays(e.end?.date ?? addDays(startDate, 1), -1);
    if (endDate < startDate) endDate = startDate;
  } else {
    const s = DateTime.fromISO(e.start.dateTime!, { setZone: true }).setZone(tz);
    const en = DateTime.fromISO(e.end?.dateTime ?? e.start.dateTime!, { setZone: true }).setZone(tz);
    startLocal = s.toFormat("yyyy-MM-dd'T'HH:mm");
    endLocal = en.toFormat("yyyy-MM-dd'T'HH:mm");
    startDate = startLocal.slice(0, 10);
    // An event ending exactly at midnight belongs to the previous day.
    endDate = endLocal.slice(11) === '00:00' && endLocal.slice(0, 10) > startDate ? addDays(endLocal.slice(0, 10), -1) : endLocal.slice(0, 10);
  }
  const busyOnly = cal.accessRole === 'freeBusyReader';
  return {
    id: e.id,
    calendarId: cal.id,
    title: busyOnly ? 'Busy' : e.summary || '(No title)',
    allDay,
    startDate,
    endDate,
    startLocal,
    endLocal,
    location: busyOnly ? '' : e.location ?? '',
    description: busyOnly ? '' : e.description ?? '',
    recurringEventId: e.recurringEventId ?? null,
    originalStart: e.originalStartTime ? e.originalStartTime.dateTime ?? e.originalStartTime.date ?? null : null,
    reminders: { useDefault: e.reminders?.useDefault ?? true, overrides: e.reminders?.overrides ?? [] },
    busyOnly,
    colorOverride: e.colorId ? EVENT_COLORS[e.colorId] ?? null : null,
    htmlLink: e.htmlLink ?? '',
  };
}

/** Start/end in Google's shape. Nulls clear the other form when switching all-day ↔ timed. */
function times(input: EventInput, tz: string) {
  if (input.allDay) {
    return {
      start: { date: input.startDate, dateTime: null, timeZone: null },
      end: { date: addDays(input.endDate < input.startDate ? input.startDate : input.endDate, 1), dateTime: null, timeZone: null },
    };
  }
  return {
    start: { dateTime: `${input.startDate}T${input.startTime}:00`, timeZone: tz, date: null },
    end: { dateTime: `${input.endDate}T${input.endTime}:00`, timeZone: tz, date: null },
  };
}

function details(input: EventInput) {
  return {
    summary: input.title,
    location: input.location,
    description: input.description,
    reminders: input.reminders.useDefault ? { useDefault: true } : { useDefault: false, overrides: input.reminders.overrides },
  };
}

const enc = encodeURIComponent;

export function googleBackend(): Backend {
  let tzCache: string | null = null;
  let appFileId: string | null = null;

  const getMaster = (ev: Ev) => g<GEvent>(`${CAL}/calendars/${enc(ev.calendarId)}/events/${enc(ev.recurringEventId!)}`);
  const patch = (calId: string, id: string, body: unknown) =>
    g(`${CAL}/calendars/${enc(calId)}/events/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  const insert = (calId: string, body: unknown) =>
    g(`${CAL}/calendars/${enc(calId)}/events`, { method: 'POST', body: JSON.stringify(body) });
  const isFirst = (ev: Ev, master: GEvent) => {
    const ms = master.start.dateTime ?? master.start.date;
    return !!ev.originalStart && !!ms && new Date(ev.originalStart).getTime() === new Date(ms).getTime();
  };

  return {
    kind: 'google',
    async user() {
      return (await fetchToken()).user;
    },
    async timeZone() {
      tzCache ??= (await g<{ value: string }>(`${CAL}/users/me/settings/timezone`)).value;
      return tzCache;
    },
    async calendars() {
      const items = await pages<{ id: string; summary: string; summaryOverride?: string; backgroundColor?: string; foregroundColor?: string; accessRole: Cal['accessRole']; primary?: boolean; deleted?: boolean }>(
        `${CAL}/users/me/calendarList?minAccessRole=freeBusyReader&maxResults=250`,
      );
      return items.filter((c) => !c.deleted).map((c) => ({
        id: c.id,
        summary: c.summaryOverride ?? c.summary,
        color: c.backgroundColor ?? '#2d6bff',
        textColor: c.foregroundColor ?? '#ffffff',
        accessRole: c.accessRole,
        primary: !!c.primary,
      }));
    },
    async events(cals, from, to, tz) {
      const timeMin = DateTime.fromISO(from, { zone: tz }).minus({ days: 1 }).toUTC().toISO()!;
      const timeMax = DateTime.fromISO(to, { zone: tz }).plus({ days: 2 }).toUTC().toISO()!;
      const failed: string[] = [];
      const lists = await Promise.all(cals.map(async (cal) => {
        try {
          const items = await pages<GEvent>(`${CAL}/calendars/${enc(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${enc(timeMin)}&timeMax=${enc(timeMax)}`);
          return items.map((e) => mapEvent(e, cal, tz)).filter((e): e is Ev => !!e);
        } catch {
          failed.push(cal.summary);
          return [];
        }
      }));
      return { events: lists.flat(), failed };
    },
    async series(ev) {
      if (!ev.recurringEventId) return null;
      return parseRule((await getMaster(ev)).recurrence);
    },
    async createEvent(input, tz) {
      await insert(input.calendarId, { ...details(input), ...times(input, tz), recurrence: input.rule ? [buildRule(input.rule)] : undefined });
    },
    async updateEvent(ev, input, scope, tz) {
      const moveCalendar = input.calendarId !== ev.calendarId;
      if (!ev.recurringEventId) {
        await patch(ev.calendarId, ev.id, { ...details(input), ...times(input, tz), recurrence: input.rule ? [buildRule(input.rule)] : [] });
        if (moveCalendar) await g(`${CAL}/calendars/${enc(ev.calendarId)}/events/${enc(ev.id)}/move?destination=${enc(input.calendarId)}`, { method: 'POST' });
        return;
      }
      if (scope === 'this') {
        await patch(ev.calendarId, ev.id, { ...details(input), ...times(input, tz) });
        return;
      }
      const master = await getMaster(ev);
      if (scope === 'all' || isFirst(ev, master)) {
        // Apply the instance's change to the whole series: shift the series start by the same
        // number of days and use the new time of day and duration.
        const dayDelta = diffDays(input.startDate, ev.startDate);
        const masterStart = master.start.date ?? DateTime.fromISO(master.start.dateTime!, { setZone: true }).setZone(tz).toISODate()!;
        const newStartDate = addDays(masterStart, dayDelta);
        const span = diffDays(input.endDate, input.startDate);
        let t;
        if (input.allDay) {
          t = times({ ...input, startDate: newStartDate, endDate: addDays(newStartDate, span) }, tz);
        } else {
          const startLocal = `${newStartDate}T${input.startTime}`;
          const endLocal = addWallMinutes(startLocal, wallDiffMinutes(`${input.endDate}T${input.endTime}`, `${input.startDate}T${input.startTime}`));
          t = times({ ...input, startDate: newStartDate, endDate: endLocal.slice(0, 10), endTime: endLocal.slice(11) }, tz);
        }
        const recurrence = input.rule ? replaceRule(master.recurrence ?? [], input.rule) : [];
        await patch(ev.calendarId, ev.recurringEventId, { ...details(input), ...t, recurrence });
        if (moveCalendar) await g(`${CAL}/calendars/${enc(ev.calendarId)}/events/${enc(ev.recurringEventId)}/move?destination=${enc(input.calendarId)}`, { method: 'POST' });
        return;
      }
      // This and following: end the original series before this occurrence, start a new one here.
      const rule = parseRule(master.recurrence);
      if (rule && ev.originalStart) {
        await patch(ev.calendarId, ev.recurringEventId, { recurrence: replaceRule(master.recurrence ?? [], { ...rule, until: untilBefore(ev.originalStart, ev.allDay), count: null }) });
      }
      await insert(input.calendarId, { ...details(input), ...times(input, tz), recurrence: input.rule ? [buildRule({ ...input.rule, count: null })] : undefined });
    },
    async deleteEvent(ev, scope) {
      if (!ev.recurringEventId || scope === 'this') {
        await g(`${CAL}/calendars/${enc(ev.calendarId)}/events/${enc(ev.id)}`, { method: 'DELETE' });
        return;
      }
      const master = await getMaster(ev);
      if (scope === 'all' || isFirst(ev, master)) {
        await g(`${CAL}/calendars/${enc(ev.calendarId)}/events/${enc(ev.recurringEventId)}`, { method: 'DELETE' });
        return;
      }
      const rule = parseRule(master.recurrence);
      if (rule && ev.originalStart) {
        await patch(ev.calendarId, ev.recurringEventId, { recurrence: replaceRule(master.recurrence ?? [], { ...rule, until: untilBefore(ev.originalStart, ev.allDay), count: null }) });
      }
    },
    async taskLists() {
      const items = await pages<{ id: string; title: string }>(`${TASKS}/users/@me/lists?maxResults=100`);
      return items.map((l) => ({ id: l.id, title: l.title }));
    },
    async tasks(lists) {
      const since = new Date(Date.now() - 45 * 86400_000).toISOString();
      const all = await Promise.all(lists.map(async (l) => {
        const items = await pages<{ id: string; title?: string; notes?: string; due?: string; status: string; deleted?: boolean; hidden?: boolean; parent?: string }>(
          `${TASKS}/lists/${enc(l.id)}/tasks?showCompleted=true&showHidden=true&completedMin=${enc(since)}&maxResults=100`,
        );
        return items.filter((t) => !t.deleted && (t.title ?? '').trim()).map<Task>((t) => ({
          id: t.id, listId: l.id, title: t.title ?? '', notes: t.notes ?? '', due: t.due ? t.due.slice(0, 10) : null, completed: t.status === 'completed',
        }));
      }));
      return all.flat();
    },
    async createTask(t) {
      await g(`${TASKS}/lists/${enc(t.listId)}/tasks`, { method: 'POST', body: JSON.stringify({ title: t.title, notes: t.notes, due: t.due ? `${t.due}T00:00:00.000Z` : undefined }) });
    },
    async updateTask(t) {
      await g(`${TASKS}/lists/${enc(t.listId)}/tasks/${enc(t.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: t.title, notes: t.notes, due: t.due ? `${t.due}T00:00:00.000Z` : null, status: t.completed ? 'completed' : 'needsAction', ...(t.completed ? {} : { completed: null }) }),
      });
    },
    async deleteTask(t) {
      await g(`${TASKS}/lists/${enc(t.listId)}/tasks/${enc(t.id)}`, { method: 'DELETE' });
    },
    async loadAppData() {
      const found = await g<{ files: { id: string }[] }>(`${DRIVE}/files?spaces=appDataFolder&q=${enc(`name='${APP_FILE}'`)}&fields=files(id)`);
      appFileId = found.files[0]?.id ?? null;
      if (!appFileId) return { ...EMPTY_APP_DATA };
      const data = await g<Partial<AppData>>(`${DRIVE}/files/${enc(appFileId)}?alt=media`);
      return { ...EMPTY_APP_DATA, ...(data ?? {}) };
    },
    async saveAppData(d) {
      const body = JSON.stringify(d);
      if (appFileId) {
        await g(`${DRIVE_UP}/files/${enc(appFileId)}?uploadType=media`, { method: 'PATCH', body, headers: { 'content-type': 'application/json' } });
        return;
      }
      const boundary = `bac${Date.now()}`;
      const multipart = [
        `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ name: APP_FILE, parents: ['appDataFolder'] }),
        `--${boundary}`, 'Content-Type: application/json', '', body, `--${boundary}--`, '',
      ].join('\r\n');
      const res = await g<{ id: string }>(`${DRIVE_UP}/files?uploadType=multipart&fields=id`, { method: 'POST', body: multipart, headers: { 'content-type': `multipart/related; boundary=${boundary}` } });
      appFileId = res.id;
    },
  };
}

export type { Rule, Reminders, TaskList };
