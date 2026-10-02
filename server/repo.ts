import type { DB } from './db.ts';
import { all, get, run, nowIso } from './db.ts';
import type {
  CalEvent, Calendar, CheckIn, EventException, Goal, Note, NotificationPrefs, Partner, ShareLevel, Task, TaskList,
  UserProfile,
} from '../shared/types.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const j = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

export function partnerOf(db: DB, userId: string): Partner | null {
  const row = get<{ id: string; display_name: string; tz: string }>(
    db,
    `SELECT u.id, u.display_name, u.tz FROM partnerships p
     JOIN users u ON u.id = CASE WHEN p.user_a = ? THEN p.user_b ELSE p.user_a END
     WHERE p.user_a = ? OR p.user_b = ? LIMIT 1`,
    userId, userId, userId,
  );
  return row ? { id: row.id, displayName: row.display_name, tz: row.tz } : null;
}

export function userProfile(db: DB, userId: string): UserProfile {
  const r = get<{ id: string; email: string; display_name: string; tz: string }>(
    db, 'SELECT id, email, display_name, tz FROM users WHERE id = ?', userId,
  );
  if (!r) throw new HttpError(401, 'Not signed in');
  return { id: r.id, email: r.email, displayName: r.display_name, tz: r.tz };
}

// ---------- Calendars & access ----------

interface CalRow {
  id: string; owner_id: string; name: string; color: string; archived: number; share_level: ShareLevel;
  version: number; visible: number | null;
}

export function calendarAccess(db: DB, viewerId: string, calendarId: string): Calendar['access'] | null {
  const cal = get<{ owner_id: string; share_level: ShareLevel }>(
    db, 'SELECT owner_id, share_level FROM calendars WHERE id = ?', calendarId,
  );
  if (!cal) return null;
  if (cal.owner_id === viewerId) return 'owner';
  const partner = partnerOf(db, viewerId);
  if (!partner || partner.id !== cal.owner_id || cal.share_level === 'private') return null;
  return cal.share_level;
}

export function canEditCalendar(access: Calendar['access'] | null): boolean {
  return access === 'owner' || access === 'edit';
}

export function listCalendars(db: DB, viewerId: string): Calendar[] {
  const partner = partnerOf(db, viewerId);
  const rows = all<CalRow>(
    db,
    `SELECT c.*, v.visible FROM calendars c
     LEFT JOIN calendar_visibility v ON v.calendar_id = c.id AND v.user_id = ?
     WHERE c.owner_id = ? OR (c.owner_id = ? AND c.share_level != 'private')
     ORDER BY c.sort, c.created_at`,
    viewerId, viewerId, partner?.id ?? '',
  );
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    color: r.color,
    archived: !!r.archived,
    visible: r.visible === null ? true : !!r.visible,
    shareLevel: r.owner_id === viewerId ? r.share_level : 'private',
    access: r.owner_id === viewerId ? 'owner' : r.share_level,
    version: r.version,
  }));
}

// ---------- Events ----------

interface EventRow {
  id: string; owner_id: string; calendar_id: string; title: string; all_day: number; start_date: string;
  end_date: string; start_local: string | null; end_local: string | null; tz: string; location: string;
  notes: string; recurrence: string | null; alerts: string; task_id: string | null; goal_id: string | null;
  version: number; updated_at: string;
}

export function rowToEvent(db: DB, r: EventRow): CalEvent {
  const exceptions = all<{ original_date: string; cancelled: number; override: string | null }>(
    db, 'SELECT original_date, cancelled, override FROM event_exceptions WHERE event_id = ? ORDER BY original_date', r.id,
  ).map<EventException>((x) => ({ originalDate: x.original_date, cancelled: !!x.cancelled, override: j(x.override) }));
  return {
    id: r.id,
    ownerId: r.owner_id,
    calendarId: r.calendar_id,
    title: r.title,
    allDay: !!r.all_day,
    startDate: r.start_date,
    endDate: r.end_date,
    startLocal: r.start_local,
    endLocal: r.end_local,
    tz: r.tz,
    location: r.location,
    notes: r.notes,
    recurrence: j(r.recurrence),
    exceptions,
    alerts: j(r.alerts) ?? [],
    taskId: r.task_id,
    goalId: r.goal_id,
    version: r.version,
    updatedAt: r.updated_at,
  };
}

/** Free/busy sharing: keep only the time block. */
export function redact(ev: CalEvent): CalEvent {
  return {
    ...ev,
    title: 'Busy',
    location: '',
    notes: '',
    alerts: [],
    taskId: null,
    goalId: null,
    redacted: true,
    exceptions: ev.exceptions.map((x) => ({
      ...x,
      override: x.override
        ? { ...x.override, title: undefined, notes: undefined, location: undefined }
        : null,
    })),
  };
}

export function getEvent(db: DB, id: string): CalEvent | null {
  const r = get<EventRow>(db, 'SELECT * FROM events WHERE id = ?', id);
  return r ? rowToEvent(db, r) : null;
}

/** Events the viewer may see whose occurrences could fall in [from, to]. */
export function listEvents(db: DB, viewerId: string, from: string, to: string): CalEvent[] {
  const cals = listCalendars(db, viewerId);
  const access = new Map(cals.map((c) => [c.id, c.access]));
  if (!cals.length) return [];
  const ids = cals.map((c) => c.id);
  const rows = all<EventRow>(
    db,
    `SELECT * FROM events WHERE calendar_id IN (${ids.map(() => '?').join(',')})
     AND start_date <= ? AND (end_date >= ? OR recurrence IS NOT NULL)`,
    ...ids, to, from,
  );
  return rows
    .map((r) => rowToEvent(db, r))
    .filter((e) => !e.recurrence?.until || e.recurrence.until >= from || e.exceptions.some((x) => x.override))
    .map((e) => (access.get(e.calendarId) === 'freebusy' ? redact(e) : e));
}

export function writeEvent(db: DB, ownerId: string, e: CalEvent, isNew: boolean) {
  const now = nowIso();
  const vals = [
    e.calendarId, e.title, e.allDay ? 1 : 0, e.startDate, e.endDate, e.startLocal, e.endLocal, e.tz, e.location,
    e.notes, e.recurrence ? JSON.stringify(e.recurrence) : null, JSON.stringify(e.alerts), e.taskId, e.goalId,
  ];
  if (isNew) {
    run(
      db,
      `INSERT INTO events (calendar_id, title, all_day, start_date, end_date, start_local, end_local, tz, location,
        notes, recurrence, alerts, task_id, goal_id, id, owner_id, version, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      ...vals, e.id, ownerId, now, now,
    );
  } else {
    run(
      db,
      `UPDATE events SET calendar_id=?, title=?, all_day=?, start_date=?, end_date=?, start_local=?, end_local=?, tz=?,
        location=?, notes=?, recurrence=?, alerts=?, task_id=?, goal_id=?, version = version + 1, updated_at=?
       WHERE id = ?`,
      ...vals, now, e.id,
    );
  }
  run(db, 'DELETE FROM event_exceptions WHERE event_id = ?', e.id);
  for (const x of e.exceptions) {
    run(
      db, 'INSERT INTO event_exceptions (event_id, original_date, cancelled, override) VALUES (?,?,?,?)',
      e.id, x.originalDate, x.cancelled ? 1 : 0, x.override ? JSON.stringify(x.override) : null,
    );
  }
}

// ---------- Tasks, notes, goals ----------

interface TaskRow {
  id: string; owner_id: string; list_id: string; title: string; notes: string; priority: number;
  due_date: string | null; due_time: string | null; tz: string; recurrence: string | null;
  completed_at: string | null; alerts: string; goal_id: string | null; version: number; updated_at: string;
}

export function rowToTask(r: TaskRow): Task {
  return {
    id: r.id, ownerId: r.owner_id, listId: r.list_id, title: r.title, notes: r.notes,
    priority: r.priority as Task['priority'], dueDate: r.due_date, dueTime: r.due_time, tz: r.tz,
    recurrence: j(r.recurrence), completedAt: r.completed_at, alerts: j(r.alerts) ?? [], goalId: r.goal_id,
    version: r.version, updatedAt: r.updated_at,
  };
}

export function listTasks(db: DB, ownerId: string): Task[] {
  // Open tasks plus anything completed in the last 400 days (history for goals/reviews).
  const since = new Date(Date.now() - 400 * 86400000).toISOString();
  return all<TaskRow>(
    db, 'SELECT * FROM tasks WHERE owner_id = ? AND (completed_at IS NULL OR completed_at >= ?) ORDER BY created_at',
    ownerId, since,
  ).map(rowToTask);
}

export function getTask(db: DB, id: string): Task | null {
  const r = get<TaskRow>(db, 'SELECT * FROM tasks WHERE id = ?', id);
  return r ? rowToTask(r) : null;
}

export function listTaskLists(db: DB, ownerId: string): TaskList[] {
  return all<{ id: string; owner_id: string; name: string; color: string }>(
    db, 'SELECT id, owner_id, name, color FROM task_lists WHERE owner_id = ? ORDER BY created_at', ownerId,
  ).map((r) => ({ id: r.id, ownerId: r.owner_id, name: r.name, color: r.color }));
}

export function listNotes(db: DB, ownerId: string): Note[] {
  return all<{ id: string; owner_id: string; scope: Note['scope']; key: string; title: string; body: string; version: number; updated_at: string }>(
    db, 'SELECT * FROM notes WHERE owner_id = ? ORDER BY updated_at DESC', ownerId,
  ).map((r) => ({
    id: r.id, ownerId: r.owner_id, scope: r.scope, key: r.key, title: r.title, body: r.body, version: r.version,
    updatedAt: r.updated_at,
  }));
}

export function listGoals(db: DB, ownerId: string): Goal[] {
  return all<{ id: string; owner_id: string; title: string; color: string; mode: Goal['mode']; weekly_target: number; rest_days: string; unit: string; archived: number; version: number }>(
    db, 'SELECT * FROM goals WHERE owner_id = ? ORDER BY created_at', ownerId,
  ).map((r) => ({
    id: r.id, ownerId: r.owner_id, title: r.title, color: r.color, mode: r.mode, weeklyTarget: r.weekly_target,
    restDays: JSON.parse(r.rest_days), unit: r.unit, archived: !!r.archived, version: r.version,
  }));
}

export function listCheckIns(db: DB, ownerId: string): CheckIn[] {
  return all<{ id: string; goal_id: string; date: string; quantity: number | null; reflection: string; client_key: string; created_at: string }>(
    db, 'SELECT * FROM check_ins WHERE owner_id = ? ORDER BY date', ownerId,
  ).map((r) => ({
    id: r.id, goalId: r.goal_id, date: r.date, quantity: r.quantity, reflection: r.reflection,
    clientKey: r.client_key, createdAt: r.created_at,
  }));
}

// ---------- Notification preferences ----------

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: false,
  eventLeadMinutes: 15,
  taskLeadMinutes: 0,
  dateOnlyTaskTime: '09:00',
  dailyAgenda: false,
  dailyAgendaTime: '07:30',
  quietStart: '22:00',
  quietEnd: '07:00',
  showTitlesOnLockScreen: false,
  pushTarget: 'latest',
  snoozeMinutes: 10,
};

export function getPrefs(db: DB, userId: string): NotificationPrefs {
  const r = get<{ prefs: string }>(db, 'SELECT prefs FROM notification_prefs WHERE user_id = ?', userId);
  return { ...DEFAULT_PREFS, ...(r ? JSON.parse(r.prefs) : {}) };
}

export function setPrefs(db: DB, userId: string, prefs: NotificationPrefs) {
  run(
    db,
    'INSERT INTO notification_prefs (user_id, prefs) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs',
    userId, JSON.stringify(prefs),
  );
}
