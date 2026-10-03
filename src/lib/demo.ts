import type { AppData, Cal, Ev, Task, TaskList } from '../../shared/types.ts';
import { EMPTY_APP_DATA } from '../../shared/types.ts';
import { addDays, addMonths, addWallMinutes, daysInMonth, diffDays, makeDate, todayIn, wallDiffMinutes, weekday, ymd } from '../../shared/dates.ts';
import type { Rule } from '../../shared/rrule.ts';
import type { Backend, EventInput } from './backend.ts';

// Demo mode: the same interface as the Google backend, kept in memory (and in this browser's
// localStorage) with sample data, so the design can be tried before Google sign-in is set up.
// Nothing here touches a real calendar.

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
const KEY = 'bac-demo-v1';
const WINDOW_FROM = '2025-09-01';
const WINDOW_TO = '2028-12-31';

interface Store {
  calendars: Cal[];
  events: Ev[];
  rules: Record<string, Rule | null>;
  lists: TaskList[];
  tasks: Task[];
  app: AppData;
  seq: number;
}

/** Expand a simple rule into dates within the demo window. */
function expand(start: string, rule: Rule | null): string[] {
  if (!rule) return [start];
  const out: string[] = [];
  const untilD = rule.until ? `${rule.until.slice(0, 4)}-${rule.until.slice(4, 6)}-${rule.until.slice(6, 8)}` : WINDOW_TO;
  const end = untilD < WINDOW_TO ? untilD : WINDOW_TO;
  const push = (d: string) => {
    if (d < start || d > end) return true;
    if (rule.count && out.length >= rule.count) return false;
    out.push(d);
    return true;
  };
  const step = Math.max(1, rule.interval);
  if (rule.freq === 'DAILY') for (let d = start; d <= end && push(d); d = addDays(d, step));
  else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length ? rule.byDay : [weekday(start)];
    for (let w = addDays(start, -(weekday(start) - 1)); w <= end; w = addDays(w, 7 * step)) {
      let go = true;
      for (const wd of [...days].sort()) if (!push(addDays(w, wd - 1))) { go = false; break; }
      if (!go) break;
    }
  } else if (rule.freq === 'MONTHLY') {
    const [, , dom] = ymd(start);
    for (let m = start.slice(0, 7) + '-01'; m <= end; m = addMonths(m, step)) {
      const [y, mo] = ymd(m);
      if (dom <= daysInMonth(y, mo) && !push(makeDate(y, mo, dom))) break;
    }
  } else {
    const [y0, mo, dom] = ymd(start);
    for (let y = y0; makeDate(y, 1, 1) <= end; y += step) if (dom <= daysInMonth(y, mo) && !push(makeDate(y, mo, dom))) break;
  }
  return out;
}

function seed(): Store {
  const today = todayIn(TZ);
  const cals: Cal[] = [
    { id: 'personal', summary: 'Personal', color: '#2d6bff', textColor: '#fff', accessRole: 'owner', primary: true },
    { id: 'bills', summary: 'Bills', color: '#ff4f5e', textColor: '#fff', accessRole: 'owner', primary: false },
    { id: 'paydays', summary: 'Paydays', color: '#0fb88a', textColor: '#fff', accessRole: 'owner', primary: false },
    { id: 'workouts', summary: 'Workouts', color: '#7b3ff2', textColor: '#fff', accessRole: 'owner', primary: false },
    { id: 'trading', summary: 'Trading practice', color: '#ff9f1c', textColor: '#fff', accessRole: 'owner', primary: false },
    { id: 'tehron', summary: 'Tehron (shared)', color: '#ff5fa2', textColor: '#fff', accessRole: 'reader', primary: false },
  ];
  const s: Store = { calendars: cals, events: [], rules: {}, lists: [{ id: 'todo', title: 'To-dos' }], tasks: [], app: { ...EMPTY_APP_DATA }, seq: 1 };
  const monday = addDays(today, -(weekday(today) - 1));
  const add = (calendarId: string, title: string, startDate: string, opts: Partial<EventInput> = {}) =>
    createIn(s, { calendarId, title, allDay: !opts.startTime, startDate, endDate: opts.endDate ?? startDate, startTime: '09:00', endTime: '10:00', location: '', description: '', rule: null, reminders: { useDefault: true, overrides: [] }, ...opts });
  add('workouts', 'Workout', addDays(monday, -14), { startTime: '06:30', endTime: '07:15', rule: { freq: 'WEEKLY', interval: 1, byDay: [1, 3, 5], until: null, count: null } });
  add('trading', 'Market practice', addDays(monday, -13), { startTime: '06:00', endTime: '07:30', rule: { freq: 'WEEKLY', interval: 1, byDay: [2, 4], until: null, count: null } });
  add('bills', 'Rent', `${today.slice(0, 7)}-01`, { rule: { freq: 'MONTHLY', interval: 1, byDay: [], until: null, count: null } });
  add('bills', 'Phone bill', `${today.slice(0, 7)}-18`, { rule: { freq: 'MONTHLY', interval: 1, byDay: [], until: null, count: null } });
  add('paydays', 'Payday', addDays(monday, -10), { rule: { freq: 'WEEKLY', interval: 2, byDay: [5], until: null, count: null } });
  add('personal', 'Dentist', addDays(today, 1), { startTime: '10:00', endTime: '11:00', location: 'Main St Dental' });
  add('personal', 'Lunch with Sam', today, { startTime: '12:30', endTime: '13:30' });
  add('personal', 'Study session', today, { startTime: '18:00', endTime: '19:30' });
  add('personal', 'Weekend trip', addDays(monday, 12), { endDate: addDays(monday, 14) });
  add('tehron', 'Shift', addDays(monday, -7), { startTime: '09:00', endTime: '17:00', rule: { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 4], until: null, count: null } });
  s.tasks = [
    { id: 't1', listId: 'todo', title: 'Renew car registration', notes: '', due: today, completed: false },
    { id: 't2', listId: 'todo', title: 'Email landlord', notes: '', due: addDays(today, -2), completed: false },
    { id: 't3', listId: 'todo', title: 'Sort photos', notes: '', due: null, completed: false },
  ];
  s.app.goals = [
    { id: 'g1', title: 'Workouts', color: '#7b3ff2', mode: 'weekly', weeklyTarget: 3, restDays: [], archived: false },
    { id: 'g2', title: 'Creating', color: '#ff9f1c', mode: 'daily', weeklyTarget: 5, restDays: [6, 7], archived: false },
  ];
  s.app.checkIns = [addDays(today, -1), addDays(today, -2), addDays(today, -3)].map((d, i) => ({ id: `c${i}`, goalId: 'g2', date: d, note: '', clientKey: `seed${i}` }));
  return s;
}

function instance(s: Store, seriesId: string | null, input: EventInput, date: string): Ev {
  const span = diffDays(input.endDate, input.startDate);
  const startLocal = input.allDay ? null : `${date}T${input.startTime}`;
  const endLocal = input.allDay ? null : addWallMinutes(startLocal!, wallDiffMinutes(`${input.endDate}T${input.endTime}`, `${input.startDate}T${input.startTime}`));
  return {
    id: seriesId ? `${seriesId}_${date}` : `e${s.seq++}`,
    calendarId: input.calendarId,
    title: input.title,
    allDay: input.allDay,
    startDate: date,
    endDate: input.allDay ? addDays(date, span) : endLocal!.slice(0, 10),
    startLocal,
    endLocal,
    location: input.location,
    description: input.description,
    recurringEventId: seriesId,
    originalStart: seriesId ? date : null,
    reminders: input.reminders,
    busyOnly: false,
    colorOverride: null,
    htmlLink: '',
  };
}

function createIn(s: Store, input: EventInput) {
  if (!input.rule) {
    s.events.push(instance(s, null, input, input.startDate));
    return;
  }
  const id = `s${s.seq++}`;
  s.rules[id] = input.rule;
  for (const d of expand(input.startDate, input.rule)) if (d >= WINDOW_FROM) s.events.push(instance(s, id, input, d));
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* fall through */
  }
  return seed();
}

export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function demoBackend(): Backend {
  const s = load();
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked: demo still works for this visit */
    }
  };
  const wait = () => new Promise((r) => setTimeout(r, 120));
  const inSeries = (ev: Ev) => s.events.filter((e) => e.recurringEventId === ev.recurringEventId);

  return {
    kind: 'demo',
    async user() {
      return { email: 'demo@example.com', name: 'Demo', picture: null };
    },
    async timeZone() {
      return TZ;
    },
    async calendars() {
      return s.calendars;
    },
    async events(cals, from, to) {
      await wait();
      const ids = new Set(cals.map((c) => c.id));
      return { events: s.events.filter((e) => ids.has(e.calendarId) && e.endDate >= from && e.startDate <= to), failed: [] };
    },
    async series(ev) {
      return ev.recurringEventId ? s.rules[ev.recurringEventId] ?? null : null;
    },
    async createEvent(input) {
      await wait();
      createIn(s, input);
      persist();
    },
    async updateEvent(ev, input, scope) {
      await wait();
      if (!ev.recurringEventId || scope === 'this') {
        const i = s.events.findIndex((e) => e.id === ev.id);
        if (i >= 0) s.events[i] = { ...instance(s, ev.recurringEventId, input, input.startDate), id: ev.id, originalStart: ev.originalStart };
        if (!ev.recurringEventId && input.rule) {
          s.events.splice(i, 1);
          createIn(s, input);
        }
      } else {
        const cutoff = scope === 'following' ? ev.startDate : '0000';
        const shift = diffDays(input.startDate, ev.startDate);
        const affected = inSeries(ev).filter((e) => e.startDate >= cutoff);
        s.events = s.events.filter((e) => !affected.includes(e));
        const newId = scope === 'following' ? `s${s.seq++}` : ev.recurringEventId;
        s.rules[newId] = input.rule;
        if (input.rule && JSON.stringify(input.rule) !== JSON.stringify(s.rules[ev.recurringEventId])) {
          const first = scope === 'all' ? addDays(inSeries(ev)[0]?.startDate ?? affected[0].startDate, shift) : input.startDate;
          createIn(s, { ...input, startDate: first, endDate: addDays(first, diffDays(input.endDate, input.startDate)), rule: input.rule });
        } else {
          for (const e of affected) s.events.push(instance(s, newId, input, addDays(e.startDate, shift)));
        }
      }
      persist();
    },
    async deleteEvent(ev, scope) {
      await wait();
      if (!ev.recurringEventId || scope === 'this') s.events = s.events.filter((e) => e.id !== ev.id);
      else {
        const cutoff = scope === 'following' ? ev.startDate : '0000';
        s.events = s.events.filter((e) => !(e.recurringEventId === ev.recurringEventId && e.startDate >= cutoff));
      }
      persist();
    },
    async taskLists() {
      return s.lists;
    },
    async tasks() {
      return s.tasks;
    },
    async createTask(t) {
      s.tasks.push({ ...t, id: `t${s.seq++}`, completed: false });
      persist();
    },
    async updateTask(t) {
      s.tasks = s.tasks.map((x) => (x.id === t.id ? t : x));
      persist();
    },
    async deleteTask(t) {
      s.tasks = s.tasks.filter((x) => x.id !== t.id);
      persist();
    },
    async loadAppData() {
      return s.app;
    },
    async saveAppData(d) {
      s.app = d;
      persist();
    },
  };
}
