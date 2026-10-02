import { useCallback, useEffect, useState } from 'react';
import { useStore } from './store.tsx';
import type { CalEvent, ISODate, Occurrence, Task } from '../shared/types.ts';
import { deleteOccurrence, editOccurrence, moveByDays, moveToStart, type EditScope, type OccurrencePatch } from '../shared/edits.ts';
import { expandEvent } from '../shared/recurrence.ts';
import { addDays, addWallMinutes, convertLocal, diffDays, formatTime12, localDate, localTime } from '../shared/dates.ts';
import { newId } from './api.ts';

// ---- Scope prompt (this / following / all) for recurring edits ----

type ScopeRequest = { title: string; allowThis: boolean; resolve: (s: EditScope | null) => void };
let pushScopeRequest: ((r: ScopeRequest) => void) | null = null;

export function askScope(title: string, allowThis = true): Promise<EditScope | null> {
  return new Promise((resolve) => {
    if (!pushScopeRequest) return resolve('this');
    pushScopeRequest({ title, allowThis, resolve });
  });
}

export function ScopeDialogHost() {
  const [req, setReq] = useState<ScopeRequest | null>(null);
  useEffect(() => {
    pushScopeRequest = setReq;
    return () => {
      pushScopeRequest = null;
    };
  }, []);
  if (!req) return null;
  const done = (s: EditScope | null) => {
    req.resolve(s);
    setReq(null);
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <div className="modal small" role="alertdialog" aria-modal="true" aria-labelledby="scope-title" onKeyDown={(e) => e.key === 'Escape' && done(null)}>
        <h2 id="scope-title">{req.title}</h2>
        <p className="muted">This is a repeating event. What should change?</p>
        <div className="stack">
          {req.allowThis && <button className="btn" autoFocus onClick={() => done('this')}>Only this occurrence</button>}
          <button className="btn" autoFocus={!req.allowThis} onClick={() => done('following')}>This and following</button>
          <button className="btn" onClick={() => done('all')}>All occurrences</button>
          <button className="btn ghost" onClick={() => done(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---- Event actions shared by every view ----

export function useEventActions() {
  const s = useStore();

  const findEvent = useCallback((id: string) => s.data.events.find((e) => e.id === id), [s.data.events]);

  /** The raw occurrence (in the event's own zone) for a possibly converted display occurrence. */
  const rawOcc = (ev: CalEvent, occ: Occurrence): Occurrence =>
    expandEvent(ev, addDays(occ.originalDate, -1), addDays(occ.originalDate, 1)).find((o) => o.originalDate === occ.originalDate) ?? occ;

  const warnOverlap = useCallback((ev: CalEvent, date: ISODate, ignoreId: string) => {
    if (ev.allDay) return;
    const mine = expandEvent(ev, date, date);
    for (const o of s.occurrences) {
      if (o.eventId === ignoreId || o.allDay || !o.startLocal || o.startDate !== date || o.ownerId !== ev.ownerId) continue;
      for (const m of mine) {
        if (m.startLocal! < o.endLocal! && o.startLocal < m.endLocal!) {
          s.toast(`Heads up: overlaps “${o.title}” at ${formatTime12(localTime(o.startLocal))}. Kept as you placed it.`);
          return;
        }
      }
    }
  }, [s]);

  const applyEdit = useCallback(async (occ: Occurrence, patch: OccurrencePatch, label: string, forcedScope?: EditScope) => {
    const ev = findEvent(occ.eventId);
    if (!ev) return false;
    const cal = s.calendarsById.get(ev.calendarId);
    if (!cal || (cal.access !== 'owner' && cal.access !== 'edit')) {
      s.toast('You do not have permission to change this event.', 'error');
      return false;
    }
    let scope: EditScope = forcedScope ?? 'all';
    if (ev.recurrence && !forcedScope) {
      const chosen = await askScope(label);
      if (!chosen) return false;
      scope = chosen;
    }
    const res = editOccurrence(ev, rawOcc(ev, occ), scope, patch, newId);
    const ok = await s.saveEvents([...(res.updated ? [res.updated] : []), ...res.created], [], label);
    if (ok) {
      const target = res.created[0] ?? res.updated!;
      warnOverlap(target, patch.startDate ?? occ.startDate, ev.id);
    }
    return ok;
  }, [findEvent, s, warnOverlap]);

  /** Move by whole days (year/month drag): keeps local start time and duration. */
  const moveDays = useCallback((occ: Occurrence, days: number) => {
    if (!days) return;
    const ev = findEvent(occ.eventId);
    if (!ev) return;
    return applyEdit(occ, moveByDays(rawOcc(ev, occ), days), `Move “${occ.title}”`);
  }, [applyEdit, findEvent]);

  /** Move a timed occurrence to a new start expressed in the viewer's zone. */
  const moveTo = useCallback((occ: Occurrence, newStartViewer: string) => {
    const ev = findEvent(occ.eventId);
    if (!ev) return;
    const raw = rawOcc(ev, occ);
    const newStart = convertLocal(newStartViewer, s.tz, ev.tz);
    return applyEdit(occ, moveToStart(raw, newStart), `Move “${occ.title}”`);
  }, [applyEdit, findEvent, s.tz]);

  const resizeTo = useCallback((occ: Occurrence, newEndViewer: string) => {
    const ev = findEvent(occ.eventId);
    if (!ev) return;
    const end = convertLocal(newEndViewer, s.tz, ev.tz);
    return applyEdit(occ, { endLocal: end, endDate: localDate(end) }, `Resize “${occ.title}”`);
  }, [applyEdit, findEvent, s.tz]);

  const remove = useCallback(async (occ: Occurrence) => {
    const ev = findEvent(occ.eventId);
    if (!ev) return false;
    let scope: EditScope = 'all';
    if (ev.recurrence) {
      const chosen = await askScope(`Delete “${occ.title}”`);
      if (!chosen) return false;
      scope = chosen;
    }
    const res = deleteOccurrence(ev, rawOcc(ev, occ), scope);
    return s.saveEvents(res.updated ? [res.updated] : [], res.updated ? [] : [ev], `Delete “${occ.title}”`);
  }, [findEvent, s]);

  /** Scheduling a task creates a linked time block. It never completes the task. */
  const scheduleTask = useCallback(async (task: Task, startViewer: string, minutes = 60) => {
    const cal = s.data.calendars.find((c) => c.access === 'owner' && !c.archived && c.visible) ?? s.data.calendars.find((c) => c.access === 'owner' && !c.archived);
    if (!cal) {
      s.toast('Add a calendar first (Settings → Calendars) so the time block has a home.', 'error');
      return;
    }
    const end = addWallMinutes(startViewer, minutes);
    const ev: CalEvent = {
      id: newId(), ownerId: s.me.user.id, calendarId: cal.id, title: task.title, allDay: false,
      startDate: localDate(startViewer), endDate: localDate(end), startLocal: startViewer, endLocal: end, tz: s.tz,
      location: '', notes: '', recurrence: null, exceptions: [], alerts: [], taskId: task.id, goalId: task.goalId,
      version: 0, updatedAt: '',
    };
    if (await s.saveEvents([ev], [], `Schedule “${task.title}”`)) warnOverlap(ev, ev.startDate, ev.id);
  }, [s, warnOverlap]);

  return { applyEdit, moveDays, moveTo, resizeTo, remove, scheduleTask, findEvent };
}

export function occDurationDays(o: Occurrence) {
  return diffDays(o.endDate, o.startDate);
}
