import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData, Cal, Ev, ISODate, Task, TaskList, UserInfo } from '../shared/types.ts';
import { EMPTY_APP_DATA } from '../shared/types.ts';
import { addDays, addMonths, endOfMonth, monthKey, todayIn } from '../shared/dates.ts';
import type { Backend, EventInput, Scope } from './lib/backend.ts';
import { AuthError } from './lib/auth.ts';

export type Panel = 0 | 1 | 2; // Day, Week, Year

export type Sheet =
  | { type: 'add'; date?: ISODate }
  | { type: 'event'; event?: Ev; date?: ISODate; startTime?: string }
  | { type: 'task'; task?: Task; date?: ISODate | null }
  | { type: 'goal'; goalId?: string }
  | { type: 'monthNote'; month: string }
  | { type: 'calendars' }
  | { type: 'menu' }
  | null;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

/** Twelve months starting in September, containing `date` (school-year style, like the paper board). */
export function boardStartFor(date: ISODate): string {
  const [y, m] = date.split('-').map(Number);
  return `${m >= 9 ? y : y - 1}-09`;
}

export function boardMonths(start: string): string[] {
  return Array.from({ length: 12 }, (_, i) => monthKey(addMonths(`${start}-01`, i)));
}

function useStoreValue(backend: Backend, user: UserInfo, onSignedOut: () => void) {
  const [tz, setTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [today, setToday] = useState(() => todayIn(tz));
  const [selected, setSelectedRaw] = useState<ISODate>(() => todayIn(tz));
  const [panel, setPanel] = useState<Panel>(0);
  const [boardStart, setBoardStart] = useState(() => boardStartFor(todayIn(tz)));
  const [calendars, setCalendars] = useState<Cal[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [app, setApp] = useState<AppData>(EMPTY_APP_DATA);
  const [appStatus, setAppStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);

  const handle = useCallback((e: unknown) => {
    if (e instanceof AuthError) {
      onSignedOut();
      return;
    }
    toast((e as Error).message || 'Something went wrong', 'error');
  }, [toast, onSignedOut]);

  useEffect(() => {
    const t = setInterval(() => setToday(todayIn(tz)), 60_000);
    setToday(todayIn(tz));
    return () => clearInterval(t);
  }, [tz]);

  const months = useMemo(() => boardMonths(boardStart), [boardStart]);
  const rangeFrom = addDays(`${months[0]}-01`, -7);
  const rangeTo = addDays(endOfMonth(`${months[11]}-01`), 7);

  // Initial load: time zone, calendars, task lists, private app data.
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const [zone, cals, tl, data] = await Promise.all([backend.timeZone(), backend.calendars(), backend.taskLists(), backend.loadAppData()]);
        if (stop) return;
        setTz(zone);
        setSelectedRaw(todayIn(zone));
        setBoardStart(boardStartFor(todayIn(zone)));
        setCalendars(cals);
        setLists(tl);
        setApp(data);
        setTasks(await backend.tasks(tl));
      } catch (e) {
        if (!stop) {
          setError((e as Error).message);
          handle(e);
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [backend, handle]);

  const loadEvents = useCallback(async () => {
    if (!calendars.length) {
      setLoading(false);
      return;
    }
    try {
      const { events: evs, failed } = await backend.events(calendars, rangeFrom, rangeTo, tz);
      setEvents(evs.sort((a, b) => (a.startDate === b.startDate ? (a.allDay === b.allDay ? (a.startLocal ?? '').localeCompare(b.startLocal ?? '') : a.allDay ? -1 : 1) : a.startDate < b.startDate ? -1 : 1)));
      if (failed.length) toast(`Couldn't load: ${failed.join(', ')}`, 'error');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      handle(e);
    } finally {
      setLoading(false);
    }
  }, [backend, calendars, rangeFrom, rangeTo, tz, handle, toast]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // Refresh when coming back to the app (changes made in Google Calendar on another device).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      void loadEvents();
      void backend.tasks(lists).then(setTasks).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [loadEvents, backend, lists]);

  const setSelected = useCallback((d: ISODate) => {
    setSelectedRaw(d);
    setBoardStart((bs) => {
      const ms = boardMonths(bs);
      return d < `${ms[0]}-01` || d > endOfMonth(`${ms[11]}-01`) ? boardStartFor(d) : bs;
    });
  }, []);

  const goToday = useCallback(() => setSelected(today), [today, setSelected]);

  const run = useCallback(async (label: string, fn: () => Promise<void>, after: () => Promise<void> = loadEvents) => {
    setBusy(true);
    try {
      await fn();
      await after();
      toast(label);
      return true;
    } catch (e) {
      handle(e);
      return false;
    } finally {
      setBusy(false);
    }
  }, [loadEvents, toast, handle]);

  const reloadTasks = useCallback(async () => setTasks(await backend.tasks(lists)), [backend, lists]);

  const actions = {
    createEvent: (input: EventInput) => run('Event added', () => backend.createEvent(input, tz)),
    updateEvent: (ev: Ev, input: EventInput, scope: Scope) => run('Event updated', () => backend.updateEvent(ev, input, scope, tz)),
    deleteEvent: (ev: Ev, scope: Scope) => run('Event deleted', () => backend.deleteEvent(ev, scope)),
    createTask: (t: Omit<Task, 'id' | 'completed'>) => run('To-do added', () => backend.createTask(t), reloadTasks),
    updateTask: (t: Task, label = 'To-do updated') => run(label, () => backend.updateTask(t), reloadTasks),
    deleteTask: (t: Task) => run('To-do deleted', () => backend.deleteTask(t), reloadTasks),
  };

  /** Optimistic task completion toggle (no toast). */
  const toggleTask = useCallback(async (t: Task) => {
    const next = { ...t, completed: !t.completed };
    setTasks((ts) => ts.map((x) => (x.id === t.id ? next : x)));
    try {
      await backend.updateTask(next);
    } catch (e) {
      setTasks((ts) => ts.map((x) => (x.id === t.id ? t : x)));
      handle(e);
    }
  }, [backend, handle]);

  // Private app data (goals, check-ins, notes, preferences): saved to Drive after a short pause.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(app);
  const updateApp = useCallback((fn: (d: AppData) => AppData) => {
    setApp((d) => {
      const next = fn(d);
      latest.current = next;
      return next;
    });
    setAppStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await backend.saveAppData(latest.current);
        setAppStatus('saved');
      } catch (e) {
        setAppStatus('error');
        handle(e);
      }
    }, 700);
  }, [backend, handle]);
  const retryAppSave = useCallback(() => updateApp((d) => d), [updateApp]);

  const visibleCals = useMemo(() => calendars.filter((c) => !app.hiddenCalendars.includes(c.id)), [calendars, app.hiddenCalendars]);
  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const visibleEvents = useMemo(() => {
    const ids = new Set(visibleCals.map((c) => c.id));
    return events.filter((e) => ids.has(e.calendarId));
  }, [events, visibleCals]);
  const eventsOn = useCallback((d: ISODate) => visibleEvents.filter((e) => e.startDate <= d && e.endDate >= d), [visibleEvents]);
  const colorOf = useCallback((e: Ev) => e.colorOverride ?? calById.get(e.calendarId)?.color ?? '#2d6bff', [calById]);
  const writableCals = useMemo(() => calendars.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer'), [calendars]);

  return {
    backend, user, tz, today, selected, setSelected, goToday, panel, setPanel, boardStart, setBoardStart, months,
    calendars, visibleCals, writableCals, calById, events: visibleEvents, eventsOn, colorOf, lists, tasks, app, updateApp,
    appStatus, retryAppSave, loading, busy, error, sheet, setSheet, toasts, setToasts, toast, actions, toggleTask,
    reload: loadEvents, onSignedOut,
  };
}

export type Store = ReturnType<typeof useStoreValue>;
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ backend, user, onSignedOut, children }: { backend: Backend; user: UserInfo; onSignedOut: () => void; children: ReactNode }) {
  const value = useStoreValue(backend, user, onSignedOut);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
