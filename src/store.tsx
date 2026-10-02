import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api.ts';
import type {
  CalEvent, Calendar, CheckIn, Goal, ISODate, Note, NotificationPrefs, Occurrence, Partner, Task, TaskList, UserProfile,
} from '../shared/types.ts';
import { addDays, addMonths, convertLocal, localDate, monthKey, todayIn, yearRange } from '../shared/dates.ts';
import { expandAll } from '../shared/recurrence.ts';

export type View = 'year' | 'month' | 'week' | 'day';
export type Workspace = 'me' | 'partner' | 'together';

export interface Config {
  openSignup: boolean;
  pushConfigured: boolean;
  vapidPublicKey: string | null;
  assistant: boolean;
  templates: { name: string; color: string }[];
}

export interface Settings {
  planningConstraints?: string;
  showMoon?: boolean;
  showReflection?: boolean;
  weekStartsOn?: 1 | 7;
}

interface Data {
  calendars: Calendar[];
  events: CalEvent[];
  taskLists: TaskList[];
  tasks: Task[];
  notes: Note[];
  goals: Goal[];
  checkIns: CheckIn[];
}

const EMPTY: Data = { calendars: [], events: [], taskLists: [], tasks: [], notes: [], goals: [], checkIns: [] };

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export type Dialog =
  | { type: 'event'; event?: CalEvent; occurrence?: Occurrence; defaults?: Partial<CalEvent> }
  | { type: 'task'; task?: Task; defaults?: Partial<Task> }
  | { type: 'goal'; goal?: Goal }
  | { type: 'settings'; tab?: string }
  | { type: 'notifications' }
  | { type: 'planner' }
  | { type: 'search' }
  | { type: 'dayList'; date: ISODate }
  | { type: 'monthNotes'; month: string }
  | { type: 'add' }
  | null;

interface UndoEntry {
  label: string;
  run: () => Promise<void>;
}

function useStoreValue(config: Config, me: { user: UserProfile; partner: Partner | null; prefs: NotificationPrefs; settings: Settings }, reloadMe: () => Promise<void>) {
  const tz = me.user.tz;
  const [today, setToday] = useState(() => todayIn(tz));
  useEffect(() => {
    const t = setInterval(() => setToday(todayIn(tz)), 30_000);
    setToday(todayIn(tz));
    return () => clearInterval(t);
  }, [tz]);

  const initialDate = new URLSearchParams(location.search).get('date');
  const [selected, setSelectedRaw] = useState<ISODate>(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : today);
  const [view, setView] = useState<View>('year');
  const [rangeStart, setRangeStart] = useState('2026-09');
  const [workspace, setWorkspace] = useState<Workspace>('me');
  const [togetherMode, setTogetherMode] = useState<'side' | 'overlay'>('side');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const undoStack = useRef<UndoEntry[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const range = useMemo(() => yearRange(rangeStart), [rangeStart]);
  const loadFrom = addDays(range.from, -42);
  const loadTo = addDays(range.to, 42);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 6000);
  }, []);

  const reload = useCallback(async () => {
    try {
      const d = await api<Data>('GET', `/api/data?from=${loadFrom}&to=${loadTo}`);
      setData(d);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadFrom, loadTo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Refresh when returning to the tab so edits from other devices or the partner appear.
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(() => document.visibilityState === 'visible' && void reload(), 120_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, [reload]);

  /** Select a date, moving the 12-month window if needed (keeping its starting month). */
  const ensureInRange = useCallback((d: ISODate) => {
    setRangeStart((rs) => {
      let start = rs;
      for (let i = 0; i < 50 && d < `${start}-01`; i++) start = monthKey(addMonths(`${start}-01`, -12));
      for (let i = 0; i < 50 && d > yearRange(start).to; i++) start = monthKey(addMonths(`${start}-01`, 12));
      return start;
    });
  }, []);

  const setSelected = useCallback((d: ISODate) => {
    setSelectedRaw(d);
    ensureInRange(d);
  }, [ensureInRange]);

  const goToday = useCallback(() => {
    setSelected(today);
    requestAnimationFrame(() => document.querySelector('[data-today="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }));
  }, [today, setSelected]);

  const pushUndo = useCallback((entry: UndoEntry) => {
    undoStack.current = [...undoStack.current.slice(-19), entry];
    setUndoLabel(entry.label);
  }, []);

  const undo = useCallback(async () => {
    const entry = undoStack.current.pop();
    setUndoLabel(undoStack.current.at(-1)?.label ?? null);
    if (!entry) return;
    try {
      await entry.run();
      toast(`Undid: ${entry.label}`);
    } catch (e) {
      toast(`Could not undo: ${(e as Error).message}`, 'error');
      void reload();
    }
  }, [toast, reload]);

  /**
   * Save event changes optimistically. On failure the previous state is restored and the
   * error shown; on success an undo entry restores the prior versions of touched events.
   */
  const saveEvents = useCallback(async (upserts: CalEvent[], deletes: CalEvent[], label: string, opts: { undoable?: boolean } = {}) => {
    const prev = dataRef.current;
    const beforeById = new Map(prev.events.map((e) => [e.id, e]));
    const ids = new Set([...upserts.map((e) => e.id), ...deletes.map((e) => e.id)]);
    setData((d) => ({
      ...d,
      events: [...d.events.filter((e) => !ids.has(e.id)), ...upserts],
    }));
    try {
      const res = await api<{ events: CalEvent[] }>('POST', '/api/events/batch', {
        upserts,
        deletes: deletes.map((e) => ({ id: e.id, version: e.version })),
      });
      setData((d) => {
        const savedIds = new Set(res.events.map((e) => e.id));
        return { ...d, events: [...d.events.filter((e) => !savedIds.has(e.id)), ...res.events] };
      });
      if (opts.undoable !== false) {
        pushUndo({
          label,
          run: async () => {
            const current = new Map(dataRef.current.events.map((e) => [e.id, e]));
            const restore: CalEvent[] = [];
            const remove: CalEvent[] = [];
            for (const id of ids) {
              const before = beforeById.get(id);
              const now = current.get(id);
              if (before) restore.push({ ...before, version: now?.version ?? 0 });
              else if (now) remove.push(now);
            }
            await saveEventsRef.current(restore, remove, `undo ${label}`, { undoable: false });
          },
        });
      }
      return true;
    } catch (e) {
      setData(prev);
      const err = e as ApiError;
      toast(`${label} failed: ${err.message}`, 'error', err.status === 409 ? { label: 'Reload', run: () => void reload() } : undefined);
      return false;
    }
  }, [pushUndo, toast, reload]);
  const saveEventsRef = useRef(saveEvents);
  saveEventsRef.current = saveEvents;

  const saveTask = useCallback(async (t: Task, label = 'Save task') => {
    const prev = dataRef.current;
    const before = prev.tasks.find((x) => x.id === t.id);
    setData((d) => ({ ...d, tasks: [...d.tasks.filter((x) => x.id !== t.id), t] }));
    try {
      const res = await api<{ task: Task; tasks: Task[]; checkIns: CheckIn[] }>('PUT', `/api/tasks/${t.id}`, t);
      setData((d) => ({ ...d, tasks: res.tasks, checkIns: res.checkIns }));
      if (before) {
        pushUndo({
          label,
          run: async () => {
            const cur = dataRef.current.tasks.find((x) => x.id === t.id);
            const r = await api<{ tasks: Task[]; checkIns: CheckIn[] }>('PUT', `/api/tasks/${t.id}`, { ...before, version: cur?.version ?? 0 });
            setData((d) => ({ ...d, tasks: r.tasks, checkIns: r.checkIns }));
          },
        });
      }
      return res.task;
    } catch (e) {
      setData(prev);
      toast(`${label} failed: ${(e as Error).message}`, 'error');
      return null;
    }
  }, [pushUndo, toast]);

  const deleteTask = useCallback(async (t: Task) => {
    const prev = dataRef.current;
    setData((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== t.id) }));
    try {
      await api('DELETE', `/api/tasks/${t.id}`);
      pushUndo({
        label: `Delete “${t.title}”`,
        run: async () => {
          const r = await api<{ tasks: Task[]; checkIns: CheckIn[] }>('PUT', `/api/tasks/${t.id}`, { ...t, version: 0 });
          setData((d) => ({ ...d, tasks: r.tasks, checkIns: r.checkIns }));
        },
      });
    } catch (e) {
      setData(prev);
      toast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }, [pushUndo, toast]);

  const saveCalendar = useCallback(async (c: Calendar, isNew = false) => {
    try {
      const saved = await api<Calendar>(isNew ? 'POST' : 'PUT', isNew ? '/api/calendars' : `/api/calendars/${c.id}`, c);
      setData((d) => ({ ...d, calendars: [...d.calendars.filter((x) => x.id !== c.id), saved] }));
      return saved;
    } catch (e) {
      toast((e as Error).message, 'error');
      return null;
    }
  }, [toast]);

  const setCalendarVisible = useCallback(async (c: Calendar, visible: boolean) => {
    setData((d) => ({ ...d, calendars: d.calendars.map((x) => (x.id === c.id ? { ...x, visible } : x)) }));
    try {
      await api('PUT', `/api/calendars/${c.id}/visibility`, { visible });
    } catch (e) {
      setData((d) => ({ ...d, calendars: d.calendars.map((x) => (x.id === c.id ? { ...x, visible: !visible } : x)) }));
      toast((e as Error).message, 'error');
    }
  }, [toast]);

  const patchData = useCallback((fn: (d: Data) => Data) => setData(fn), []);

  // ----- Derived -----
  const calendarsById = useMemo(() => new Map(data.calendars.map((c) => [c.id, c])), [data.calendars]);
  const partner = me.partner;

  const ownerFilter = useCallback((ownerId: string) => {
    if (workspace === 'me') return ownerId === me.user.id;
    if (workspace === 'partner') return ownerId === partner?.id;
    return true;
  }, [workspace, me.user.id, partner?.id]);

  const visibleEvents = useMemo(
    () => data.events.filter((e) => {
      const c = calendarsById.get(e.calendarId);
      return c && c.visible && !c.archived;
    }),
    [data.events, calendarsById],
  );

  // Timed events in another zone (e.g. a partner elsewhere) are shown in the viewer's local time.
  const allOccurrences = useMemo(
    () => expandAll(visibleEvents, loadFrom, loadTo).map((o) => toViewerZone(o, tz)),
    [visibleEvents, loadFrom, loadTo, tz],
  );
  const occurrences = useMemo(() => allOccurrences.filter((o) => ownerFilter(o.ownerId)), [allOccurrences, ownerFilter]);

  const personName = useCallback((ownerId: string) => (ownerId === me.user.id ? me.user.displayName : partner?.id === ownerId ? partner.displayName : 'Unknown'), [me.user, partner]);

  return {
    config, me, reloadMe, tz, today, selected, setSelected, goToday, view, setView, rangeStart, setRangeStart, range,
    loadFrom, loadTo, workspace, setWorkspace, togetherMode, setTogetherMode, dialog, setDialog, toasts, toast,
    setToasts, data, patchData, reload, loading, loadError, online, saveEvents, saveTask, deleteTask, saveCalendar,
    setCalendarVisible, calendarsById, occurrences, allOccurrences, ownerFilter, personName, undo, undoLabel, pushUndo,
  };
}

export type Store = ReturnType<typeof useStoreValue>;
const Ctx = createContext<Store | null>(null);

export function StoreProvider(props: { config: Config; me: Parameters<typeof useStoreValue>[1]; reloadMe: () => Promise<void>; children: ReactNode }) {
  const value = useStoreValue(props.config, props.me, props.reloadMe);
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function canEdit(c: Calendar | undefined): boolean {
  return !!c && (c.access === 'owner' || c.access === 'edit');
}

/** Re-express a timed occurrence in the viewer's zone (for Together across time zones). */
export function toViewerZone(o: Occurrence, viewerTz: string): Occurrence {
  if (o.allDay || !o.startLocal || !o.endLocal || o.tz === viewerTz) return o;
  const startLocal = convertLocal(o.startLocal, o.tz, viewerTz);
  const endLocal = convertLocal(o.endLocal, o.tz, viewerTz);
  return { ...o, startLocal, endLocal, startDate: localDate(startLocal), endDate: localDate(endLocal) };
}
