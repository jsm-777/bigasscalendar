import type { DB } from './db.ts';
import { get, nowIso, run, tx, uid } from './db.ts';
import {
  HttpError, calendarAccess, canEditCalendar, getEvent, getTask, listCalendars, listEvents, listTaskLists,
  rowToTask, userProfile, writeEvent,
} from './repo.ts';
import type { Plan, PlanOp } from '../shared/schemas.ts';
import type { CalEvent, Occurrence, Task } from '../shared/types.ts';
import { todayIn, addDays, addWallMinutes, localDate, localTime, minutesOfDay, wallDiffMinutes } from '../shared/dates.ts';
import { deleteOccurrence, editOccurrence, type EditScope } from '../shared/edits.ts';
import { expandAll, expandEvent, occurrenceDates } from '../shared/recurrence.ts';

// Plans are compiled into concrete record changes against the current database state,
// checked against the viewer's permissions, previewed, and only written on Apply.

export type Change =
  | { type: 'event'; before: CalEvent | null; after: CalEvent | null }
  | { type: 'task'; before: Task | null; after: Task | null };

export interface PreviewItem {
  index: number;
  op: PlanOp['op'];
  description: string;
  destination: string;
  conflicts: string[];
  error: string | null;
}

export interface Compiled {
  items: PreviewItem[];
  changes: Change[];
}

function findOccurrence(ev: CalEvent, date: string | undefined): Occurrence {
  if (!ev.recurrence) return expandEvent(ev, ev.startDate, ev.endDate)[0] ?? expandEvent(ev, ev.startDate, ev.startDate)[0];
  if (!date) throw new Error('This is a recurring event: occurrenceDate is required');
  const occ = expandEvent(ev, addDays(date, -40), addDays(date, 40)).find((o) => o.originalDate === date);
  if (!occ) throw new Error(`No occurrence on ${date}`);
  return occ;
}

export function compilePlan(db: DB, userId: string, plan: Plan): Compiled {
  const me = userProfile(db, userId);
  const calendars = listCalendars(db, userId).filter((c) => !c.archived);
  const lists = listTaskLists(db, userId);
  const items: PreviewItem[] = [];
  const changes: Change[] = [];
  // Working copies so several operations on the same record compose.
  const working = new Map<string, CalEvent | null>();
  const loadEvent = (id: string): CalEvent => {
    if (working.has(id)) {
      const w = working.get(id);
      if (!w) throw new Error('Event was removed earlier in this plan');
      return w;
    }
    const ev = getEvent(db, id);
    if (!ev) throw new Error(`Event ${id} not found`);
    const access = calendarAccess(db, userId, ev.calendarId);
    if (!access) throw new Error(`Event ${id} not found`);
    if (!canEditCalendar(access)) throw new Error('You do not have permission to change this event');
    return ev;
  };
  const record = (before: CalEvent | null, after: CalEvent | null, id: string) => {
    const existing = changes.find((c) => c.type === 'event' && (c.after?.id ?? c.before?.id) === id);
    if (existing && existing.type === 'event') existing.after = after;
    else changes.push({ type: 'event', before, after });
    working.set(id, after);
  };

  plan.operations.forEach((op, index) => {
    const item: PreviewItem = { index, op: op.op, description: '', destination: '', conflicts: [], error: null };
    items.push(item);
    try {
      switch (op.op) {
        case 'create_event': {
          const cal = calendars.find((c) => c.id === op.calendar || c.name.toLowerCase() === op.calendar.toLowerCase());
          if (!cal) throw new Error(`No calendar named "${op.calendar}". Create it first or pick an existing one.`);
          if (!canEditCalendar(cal.access)) throw new Error(`You cannot add events to "${cal.name}"`);
          const allDay = op.allDay ?? !op.start;
          let endDate = op.endDate ?? op.date;
          let startLocal: string | null = null;
          let endLocal: string | null = null;
          if (!allDay) {
            if (!op.start) throw new Error('Timed events need a start time');
            startLocal = `${op.date}T${op.start}`;
            const end = op.end ?? null;
            endLocal = end
              ? `${end > op.start || op.endDate ? endDate : addDays(op.date, 1)}T${end}`
              : addWallMinutes(startLocal, 60);
            endDate = localDate(endLocal);
          }
          const ev: CalEvent = {
            id: uid(), ownerId: cal.ownerId, calendarId: cal.id, title: op.title, allDay, startDate: op.date, endDate,
            startLocal, endLocal, tz: me.tz, location: op.location ?? '', notes: op.notes ?? '',
            recurrence: (op.recurrence as CalEvent['recurrence']) ?? null, exceptions: [],
            alerts: (op.alertMinutesBefore ?? []).map((m) => ({ minutesBefore: m })),
            taskId: null, goalId: null, version: 0, updatedAt: nowIso(),
          };
          record(null, ev, ev.id);
          item.destination = cal.name;
          item.description = `Create “${op.title}” ${describeWhen(ev)}${ev.recurrence ? ' (repeating)' : ''}`;
          item.conflicts = conflictsFor(db, userId, ev, working);
          break;
        }
        case 'move_event':
        case 'resize_event':
        case 'delete_event':
        case 'set_event_alert': {
          const ev = loadEvent(op.eventId);
          const occ = findOccurrence(ev, op.occurrenceDate);
          const scope: EditScope = op.scope ?? (ev.recurrence ? 'this' : 'all');
          item.destination = calendars.find((c) => c.id === ev.calendarId)?.name ?? '';
          const scopeText = ev.recurrence ? ` (${scope === 'this' ? 'this occurrence' : scope === 'following' ? 'this and following' : 'entire series'})` : '';
          if (op.op === 'delete_event') {
            const res = deleteOccurrence(ev, occ, scope);
            record(ev, res.updated, ev.id);
            item.description = `Remove “${ev.title}” on ${occ.startDate}${scopeText}`;
            break;
          }
          if (op.op === 'set_event_alert') {
            record(ev, { ...ev, alerts: op.minutesBefore.map((m) => ({ minutesBefore: m })) }, ev.id);
            item.description = `Set alerts on “${ev.title}”: ${op.minutesBefore.map((m) => `${m} min before`).join(', ') || 'none'} (applies to the whole series)`;
            break;
          }
          let patch;
          if (op.op === 'move_event') {
            const newDate = op.newDate ?? occ.startDate;
            if (occ.allDay || !occ.startLocal) {
              const shift = Math.round((Date.parse(newDate) - Date.parse(occ.startDate)) / 86400000);
              patch = { startDate: newDate, endDate: addDays(occ.endDate, shift) };
            } else {
              const start = `${newDate}T${op.newStart ?? localTime(occ.startLocal)}`;
              const dur = wallDiffMinutes(occ.endLocal!, occ.startLocal);
              const end = addWallMinutes(start, dur);
              patch = { startDate: newDate, endDate: localDate(end), startLocal: start, endLocal: end };
            }
            item.description = `Move “${ev.title}” from ${describeOcc(occ)} to ${newDate}${op.newStart ? ` ${op.newStart}` : ''}${scopeText}`;
          } else {
            if (occ.allDay || !occ.startLocal) throw new Error('All-day events cannot be resized by time');
            let end = `${localDate(occ.startLocal)}T${op.newEnd}`;
            if (minutesOfDay(op.newEnd) <= minutesOfDay(localTime(occ.startLocal))) end = `${addDays(localDate(occ.startLocal), 1)}T${op.newEnd}`;
            patch = { endLocal: end, endDate: localDate(end) };
            item.description = `Change “${ev.title}” on ${occ.startDate} to end at ${op.newEnd}${scopeText}`;
          }
          const res = editOccurrence(ev, occ, scope, patch, uid);
          record(ev, res.updated, ev.id);
          for (const c of res.created) record(null, c, c.id);
          const moved = res.created[0] ?? res.updated!;
          item.conflicts = conflictsFor(db, userId, moved, working, occ.originalDate);
          break;
        }
        case 'create_task': {
          const list = op.list ? lists.find((l) => l.name.toLowerCase() === op.list!.toLowerCase() || l.id === op.list) : lists[0];
          if (!list) throw new Error(op.list ? `No task list named "${op.list}"` : 'No task list exists yet');
          const t: Task = {
            id: uid(), ownerId: userId, listId: list.id, title: op.title, notes: op.notes ?? '',
            priority: (op.priority ?? 0) as Task['priority'], dueDate: op.dueDate ?? null, dueTime: op.dueTime ?? null,
            tz: me.tz, recurrence: null, completedAt: null,
            alerts: op.remind ? [{ minutesBefore: 0 }] : [], goalId: null, version: 0, updatedAt: nowIso(),
          };
          changes.push({ type: 'task', before: null, after: t });
          item.destination = list.name;
          item.description = `Add task “${op.title}”${op.dueDate ? ` due ${op.dueDate}${op.dueTime ? ` ${op.dueTime}` : ''}` : ''}${op.remind ? ' with a reminder' : ''}`;
          break;
        }
        case 'complete_task':
        case 'set_task_due': {
          const t = getTask(db, op.taskId);
          if (!t || t.ownerId !== userId) throw new Error(`Task ${op.taskId} not found`);
          const after: Task = op.op === 'complete_task'
            ? { ...t, completedAt: nowIso() }
            : { ...t, dueDate: op.dueDate, dueTime: op.dueDate ? op.dueTime ?? t.dueTime : null };
          changes.push({ type: 'task', before: t, after });
          item.destination = lists.find((l) => l.id === t.listId)?.name ?? '';
          item.description = op.op === 'complete_task'
            ? `Mark “${t.title}” complete`
            : `Set “${t.title}” due ${op.dueDate ?? '(no date)'}${after.dueTime ? ` ${after.dueTime}` : ''}`;
          break;
        }
      }
    } catch (e) {
      item.error = (e as Error).message;
    }
  });
  return { items, changes };
}

function describeWhen(ev: CalEvent): string {
  if (ev.allDay) return ev.endDate !== ev.startDate ? `${ev.startDate} → ${ev.endDate} (all day)` : `${ev.startDate} (all day)`;
  return `${ev.startDate} ${localTime(ev.startLocal!)}–${localTime(ev.endLocal!)}`;
}

function describeOcc(o: Occurrence): string {
  return o.startLocal ? `${o.startDate} ${localTime(o.startLocal)}` : o.startDate;
}

/** Timed overlaps with the user's own existing events (warn only; overlap is allowed). */
function conflictsFor(db: DB, userId: string, ev: CalEvent, working: Map<string, CalEvent | null>, origDate?: string): string[] {
  if (ev.allDay) return [];
  const from = ev.startDate;
  const to = addDays(ev.startDate, 1);
  const base = listEvents(db, userId, from, to).filter((e) => !working.has(e.id) && e.ownerId === userId);
  const pending = [...working.values()].filter((e): e is CalEvent => !!e);
  const mine = expandEvent(ev, from, to).filter((o) => !origDate || o.originalDate === origDate || !ev.recurrence);
  const out: string[] = [];
  for (const o of expandAll([...base, ...pending], from, to)) {
    if (o.eventId === ev.id || o.allDay || !o.startLocal) continue;
    for (const m of mine) {
      if (m.startLocal! < o.endLocal! && o.startLocal < m.endLocal!) {
        out.push(`Overlaps “${o.title}” ${localTime(o.startLocal)}–${localTime(o.endLocal!)}`);
      }
    }
  }
  return [...new Set(out)];
}

// ---------- Apply & undo ----------

interface UndoEntry {
  type: 'event' | 'task';
  id: string;
  before: CalEvent | Task | null;
  /** Version after apply, or null when the record was deleted. */
  afterVersion: number | null;
}

export function applyChanges(db: DB, userId: string, plan: Plan, source: 'import' | 'assistant') {
  return tx(db, () => {
    const compiled = compilePlan(db, userId, plan);
    const failed = compiled.items.filter((i) => i.error);
    if (failed.length) throw new HttpError(400, 'Some operations cannot be applied', compiled.items);
    const undo: UndoEntry[] = [];
    for (const c of compiled.changes) {
      if (c.type === 'event') {
        const id = (c.after ?? c.before)!.id;
        if (c.after) {
          writeEvent(db, c.after.ownerId, c.after, !c.before);
          const v = get<{ version: number }>(db, 'SELECT version FROM events WHERE id = ?', id)!.version;
          undo.push({ type: 'event', id, before: c.before, afterVersion: v });
        } else {
          run(db, 'DELETE FROM events WHERE id = ?', id);
          undo.push({ type: 'event', id, before: c.before, afterVersion: null });
        }
      } else {
        const t = c.after!;
        writeTask(db, userId, t, !c.before);
        const v = get<{ version: number }>(db, 'SELECT version FROM tasks WHERE id = ?', t.id)!.version;
        undo.push({ type: 'task', id: t.id, before: c.before, afterVersion: v });
      }
    }
    const id = uid();
    run(
      db, 'INSERT INTO plan_proposals (id, user_id, source, plan, status, undo, created_at, applied_at) VALUES (?,?,?,?,?,?,?,?)',
      id, userId, source, JSON.stringify(plan), 'applied', JSON.stringify(undo), nowIso(), nowIso(),
    );
    return { proposalId: id, items: compiled.items, owners: new Set(compiled.changes.map((c) => (c.after ?? c.before)!.ownerId)) };
  });
}

/** Undo an applied plan. Records edited since are left alone and reported as conflicts. */
export function undoPlan(db: DB, userId: string, proposalId: string) {
  return tx(db, () => {
    const p = get<{ undo: string; status: string }>(db, 'SELECT undo, status FROM plan_proposals WHERE id = ? AND user_id = ?', proposalId, userId);
    if (!p) throw new HttpError(404, 'Plan not found');
    if (p.status !== 'applied') throw new HttpError(409, 'This plan was already undone');
    const entries = JSON.parse(p.undo) as UndoEntry[];
    const conflicts: string[] = [];
    const owners = new Set<string>();
    for (const e of entries.reverse()) {
      const table = e.type === 'event' ? 'events' : 'tasks';
      const cur = get<{ version: number; owner_id: string }>(db, `SELECT version, owner_id FROM ${table} WHERE id = ?`, e.id);
      const unchanged = e.afterVersion === null ? !cur : cur?.version === e.afterVersion;
      const label = (e.before as { title?: string } | null)?.title ?? e.id;
      if (!unchanged) {
        conflicts.push(`“${label}” was changed after the plan was applied, so it was left as is.`);
        continue;
      }
      if (e.type === 'event' && cur) {
        const access = calendarAccess(db, userId, (getEvent(db, e.id) as CalEvent).calendarId);
        if (!canEditCalendar(access)) { conflicts.push(`No longer allowed to change “${label}”.`); continue; }
      }
      if (cur) owners.add(cur.owner_id);
      if (!e.before) {
        run(db, `DELETE FROM ${table} WHERE id = ?`, e.id);
      } else if (e.type === 'event') {
        const before = e.before as CalEvent;
        owners.add(before.ownerId);
        writeEvent(db, before.ownerId, before, !cur);
      } else {
        writeTask(db, userId, e.before as Task, !cur);
      }
    }
    run(db, "UPDATE plan_proposals SET status = 'undone' WHERE id = ?", proposalId);
    return { conflicts, owners };
  });
}

export function writeTask(db: DB, ownerId: string, t: Task, isNew: boolean) {
  const now = nowIso();
  const prev = isNew ? null : get<{ completed_at: string | null }>(db, 'SELECT completed_at FROM tasks WHERE id = ?', t.id);
  const wasDone = !!prev?.completed_at;
  const vals = [
    t.listId, t.title, t.notes, t.priority, t.dueDate, t.dueTime, t.tz,
    t.recurrence ? JSON.stringify(t.recurrence) : null, t.completedAt, JSON.stringify(t.alerts), t.goalId,
  ];
  if (isNew) {
    run(
      db,
      `INSERT INTO tasks (list_id, title, notes, priority, due_date, due_time, tz, recurrence, completed_at, alerts, goal_id, id, owner_id, version, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      ...vals, t.id, ownerId, now, now,
    );
  } else {
    run(
      db,
      `UPDATE tasks SET list_id=?, title=?, notes=?, priority=?, due_date=?, due_time=?, tz=?, recurrence=?, completed_at=?, alerts=?, goal_id=?,
       version = version + 1, updated_at=? WHERE id = ?`,
      ...vals, now, t.id,
    );
  }
  const saved = rowToTask(get(db, 'SELECT * FROM tasks WHERE id = ?', t.id)!);
  taskCompletionEffects(db, ownerId, saved, wasDone);
  return saved;
}

/**
 * Completing a task: records one goal check-in (idempotent key per task occurrence) and, for
 * repeating tasks, creates the next occurrence once. Reopening removes that check-in.
 * Scheduling a time block never completes a task; only this transition does.
 */
function taskCompletionEffects(db: DB, ownerId: string, t: Task, wasDone: boolean) {
  const isDone = !!t.completedAt;
  if (isDone === wasDone) return;
  const key = `task:${t.id}`;
  if (t.goalId) {
    if (isDone) {
      run(
        db,
        'INSERT OR IGNORE INTO check_ins (id, goal_id, owner_id, date, quantity, reflection, client_key, created_at) VALUES (?,?,?,?,NULL,?,?,?)',
        uid(), t.goalId, ownerId, localDateOf(db, ownerId, t.completedAt!), `Completed task: ${t.title}`, key, nowIso(),
      );
    } else {
      run(db, 'DELETE FROM check_ins WHERE goal_id = ? AND client_key = ?', t.goalId, key);
    }
  }
  if (isDone && t.recurrence && t.dueDate) {
    const next = occurrenceDates(t.dueDate, t.recurrence, addDays(t.dueDate, 1), addDays(t.dueDate, 800))[0];
    if (next) {
      const nextId = `${t.id.slice(0, 40)}~${next}`;
      if (!get(db, 'SELECT 1 FROM tasks WHERE id = ?', nextId)) {
        const rule = t.recurrence.count ? { ...t.recurrence, count: t.recurrence.count - 1 } : t.recurrence;
        if (!rule.count || rule.count > 0) {
          writeTask(db, ownerId, { ...t, id: nextId, dueDate: next, completedAt: null, recurrence: rule, version: 0 }, true);
        }
      }
    }
  }
}

/** Check-ins land on the user's local date of completion. */
function localDateOf(db: DB, userId: string, instant: string): string {
  const tz = get<{ tz: string }>(db, 'SELECT tz FROM users WHERE id = ?', userId)?.tz ?? 'UTC';
  return todayIn(tz, new Date(instant));
}
