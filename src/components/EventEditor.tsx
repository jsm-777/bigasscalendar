import { useMemo, useState } from 'react';
import { useStore, canEdit } from '../store.tsx';
import { newId } from '../api.ts';
import type { CalEvent, Occurrence, Recurrence, Weekday } from '../../shared/types.ts';
import { WEEKDAY_SHORT, addWallMinutes, convertLocal, localDate, localTime, weekday, addDays, formatLongDate } from '../../shared/dates.ts';
import { describeRecurrence, expandEvent } from '../../shared/recurrence.ts';
import { editOccurrence, type OccurrencePatch } from '../../shared/edits.ts';
import { leadText } from '../../shared/notifyPlan.ts';
import { askScope, useEventActions } from '../actions.tsx';
import { Modal } from './Modal.tsx';

const ALERT_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

interface Form {
  title: string;
  calendarId: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  tz: string;
  location: string;
  notes: string;
  repeat: 'none' | Recurrence['freq'];
  interval: number;
  byWeekday: Weekday[];
  ends: 'never' | 'until' | 'count';
  until: string;
  count: number;
  alerts: number[];
  goalId: string;
}

export function EventEditor({ event, occurrence, defaults, onClose }: { event?: CalEvent; occurrence?: Occurrence; defaults?: Partial<CalEvent>; onClose: () => void }) {
  const s = useStore();
  const actions = useEventActions();
  const writable = s.data.calendars.filter((c) => canEdit(c) && !c.archived);
  const cal = event ? s.calendarsById.get(event.calendarId) : undefined;
  const readOnly = !!event && (!canEdit(cal) || !!event.redacted);
  // Occurrence fields as stored (in the event's own zone).
  const raw: Occurrence | undefined = event && occurrence
    ? expandEvent(event, addDays(occurrence.originalDate, -1), addDays(occurrence.originalDate, 1)).find((o) => o.originalDate === occurrence.originalDate) ?? occurrence
    : event ? expandEvent(event, event.startDate, event.endDate)[0] : undefined;

  const initial = useMemo<Form>(() => {
    const src = raw ?? null;
    const d = defaults ?? {};
    const startDate = src?.startDate ?? d.startDate ?? s.selected;
    const allDay = src ? src.allDay : d.allDay ?? !d.startLocal;
    const startLocal = src?.startLocal ?? d.startLocal ?? `${startDate}T09:00`;
    const endLocal = src?.endLocal ?? d.endLocal ?? addWallMinutes(startLocal, 60);
    const rule = event?.recurrence;
    return {
      title: src?.title ?? d.title ?? '',
      calendarId: src?.calendarId ?? d.calendarId ?? (writable.find((c) => c.access === 'owner' && c.visible) ?? writable[0])?.id ?? '',
      allDay,
      startDate: allDay ? startDate : localDate(startLocal),
      endDate: allDay ? (src?.endDate ?? d.endDate ?? startDate) : localDate(endLocal),
      startTime: localTime(startLocal),
      endTime: localTime(endLocal),
      tz: event?.tz ?? s.tz,
      location: src?.location ?? '',
      notes: src?.notes ?? '',
      repeat: rule?.freq ?? 'none',
      interval: rule?.interval ?? 1,
      byWeekday: rule?.byWeekday ?? [weekday(startDate) as Weekday],
      ends: rule?.until ? 'until' : rule?.count ? 'count' : 'never',
      until: rule?.until ?? addDays(startDate, 90),
      count: rule?.count ?? 10,
      alerts: event ? event.alerts.map((a) => a.minutesBefore) : s.me.prefs.enabled ? [s.me.prefs.eventLeadMinutes] : [],
      goalId: event?.goalId ?? '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [f, setF] = useState<Form>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [s.tz];

  const recurrence = (): Recurrence | null => {
    if (f.repeat === 'none') return null;
    const r: Recurrence = { freq: f.repeat, interval: Math.max(1, f.interval) };
    if (f.repeat === 'weekly') r.byWeekday = [...f.byWeekday].sort() as Weekday[];
    if (f.ends === 'until') r.until = f.until;
    if (f.ends === 'count') r.count = Math.max(1, f.count);
    return r;
  };

  const occurrencePatch = (): OccurrencePatch => {
    const startLocal = f.allDay ? null : `${f.startDate}T${f.startTime}`;
    let endLocal = f.allDay ? null : `${f.endDate}T${f.endTime}`;
    if (endLocal && startLocal && endLocal <= startLocal) endLocal = addWallMinutes(startLocal, 60);
    return {
      title: f.title.trim(),
      calendarId: f.calendarId,
      allDay: f.allDay,
      startDate: f.allDay ? f.startDate : localDate(startLocal!),
      endDate: f.allDay ? (f.endDate < f.startDate ? f.startDate : f.endDate) : localDate(endLocal!),
      startLocal,
      endLocal,
      location: f.location,
      notes: f.notes,
    };
  };

  const validate = () => {
    if (!f.title.trim()) return 'Give the event a title.';
    if (!f.calendarId) return 'Add a calendar first (Settings → Calendars).';
    if (f.repeat === 'weekly' && f.byWeekday.length === 0) return 'Pick at least one weekday.';
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) return setError(v);
    setBusy(true);
    setError(null);
    const patch = occurrencePatch();
    const alerts = [...new Set(f.alerts)].map((m) => ({ minutesBefore: m }));
    let ok = false;
    if (!event) {
      const ev: CalEvent = {
        id: newId(), ownerId: s.calendarsById.get(f.calendarId)!.ownerId, calendarId: f.calendarId, title: patch.title!, allDay: f.allDay,
        startDate: patch.startDate!, endDate: patch.endDate!, startLocal: patch.startLocal!, endLocal: patch.endLocal!, tz: f.tz,
        location: f.location, notes: f.notes, recurrence: recurrence(), exceptions: [], alerts, taskId: defaults?.taskId ?? null,
        goalId: f.goalId || null, version: 0, updatedAt: '',
      };
      ok = await s.saveEvents([ev], [], `Add “${ev.title}”`);
    } else {
      const newRule = recurrence();
      const seriesChanged = JSON.stringify(newRule) !== JSON.stringify(event.recurrence) || JSON.stringify(alerts) !== JSON.stringify(event.alerts) || f.tz !== event.tz || (f.goalId || null) !== event.goalId;
      if (!event.recurrence) {
        const res = editOccurrence({ ...event, tz: f.tz }, raw!, 'all', patch, newId);
        ok = await s.saveEvents([{ ...res.updated!, recurrence: newRule, alerts, goalId: f.goalId || null }], [], `Edit “${patch.title}”`);
      } else {
        const scope = await askScope(`Save “${patch.title}”`, !seriesChanged);
        if (!scope) {
          setBusy(false);
          return;
        }
        const res = editOccurrence(event, raw!, scope, patch, newId);
        const seriesFields = (e: CalEvent): CalEvent => ({ ...e, recurrence: newRule && e.recurrence ? { ...newRule, until: scope === 'following' && e.id === event.id ? e.recurrence.until : newRule.until, count: scope === 'following' && e.id === event.id ? e.recurrence.count : newRule.count } : newRule, alerts, tz: f.tz, goalId: f.goalId || null });
        const updated = res.updated ? (scope === 'all' ? seriesFields(res.updated) : res.updated) : null;
        const created = res.created.map(seriesFields);
        ok = await s.saveEvents([...(updated ? [updated] : []), ...created], [], `Edit “${patch.title}”`);
      }
    }
    setBusy(false);
    // On failure the dialog stays open so nothing typed is lost.
    if (ok) onClose();
  };

  const duplicate = async () => {
    if (!event) return;
    const copy: CalEvent = { ...event, id: newId(), title: `${event.title} (copy)`, exceptions: [...event.exceptions], version: 0, taskId: null };
    if (await s.saveEvents([copy], [], `Duplicate “${event.title}”`)) onClose();
  };

  const remove = async () => {
    if (!occurrence && raw) {
      if (await actions.remove(raw)) onClose();
    } else if (occurrence) {
      if (await actions.remove(occurrence)) onClose();
    }
  };

  const linkedTask = event?.taskId ? s.data.tasks.find((t) => t.id === event.taskId) : defaults?.taskId ? s.data.tasks.find((t) => t.id === defaults.taskId) : undefined;
  const otherTz = f.tz !== s.tz && !f.allDay;

  if (readOnly && event) {
    return (
      <Modal title={event.redacted ? 'Busy' : event.title} onClose={onClose}>
        <p><strong>{s.personName(event.ownerId)}</strong> · {cal?.name ?? 'Shared calendar'}</p>
        <p>{raw?.allDay ? `${formatLongDate(raw.startDate)}${raw.endDate !== raw.startDate ? ` – ${formatLongDate(raw.endDate)}` : ''} (all day)` : raw ? `${formatLongDate(raw.startDate)}, ${localTime(raw.startLocal!)}–${localTime(raw.endLocal!)} ${raw.tz}` : ''}</p>
        {event.redacted ? <p className="muted">Shared as free/busy only. Details are private.</p> : (
          <>
            {event.location && <p>📍 {event.location}</p>}
            {event.notes && <p className="pre">{event.notes}</p>}
            {event.recurrence && <p className="muted">{describeRecurrence(event.recurrence, event.startDate)}</p>}
            <p className="muted small">View only. {s.personName(event.ownerId)} can give you edit access in their calendar settings.</p>
          </>
        )}
      </Modal>
    );
  }

  return (
    <Modal title={event ? 'Edit event' : 'New event'} onClose={onClose} footer={
      <>
        {event && <button className="btn danger ghost" onClick={remove} disabled={busy}>Delete</button>}
        {event && <button className="btn ghost" onClick={duplicate} disabled={busy}>Duplicate</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>
    }>
      <label>Title<input value={f.title} onChange={(e) => set({ title: e.target.value })} autoFocus placeholder="What's happening?" onKeyDown={(e) => e.key === 'Enter' && void save()} /></label>
      <label>
        Calendar
        {writable.length === 0 ? (
          <span className="no-cal">
            <span className="muted small">You don't have a calendar yet.</span>
            <button type="button" className="btn small" onClick={async () => {
              const c = await s.saveCalendar({ id: newId(), ownerId: s.me.user.id, name: 'Personal', color: '#3b82f6', archived: false, visible: true, shareLevel: 'private', access: 'owner', version: 0 }, true);
              if (c) set({ calendarId: c.id });
            }}>Create “Personal” calendar</button>
            <button type="button" className="link small" onClick={() => s.setDialog({ type: 'settings', tab: 'calendars' })}>More options</button>
          </span>
        ) : (
          <select value={f.calendarId} onChange={(e) => set({ calendarId: e.target.value })} disabled={!!event && s.calendarsById.get(event.calendarId)?.ownerId !== s.me.user.id && false}>
            {writable.filter((c) => !event || c.ownerId === event.ownerId).map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.access !== 'owner' ? ` (${s.personName(c.ownerId)})` : ''}</option>
            ))}
          </select>
        )}
      </label>
      <label className="inline"><input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} /> All day</label>
      {f.allDay ? (
        <div className="row">
          <label>Starts<input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} required /></label>
          <label>Ends<input type="date" value={f.endDate} min={f.startDate} onChange={(e) => set({ endDate: e.target.value })} required /></label>
        </div>
      ) : (
        <>
          <div className="row">
            <label>Date<input type="date" value={f.startDate} onChange={(e) => {
              const shift = Math.round((Date.parse(e.target.value) - Date.parse(f.startDate)) / 86400000);
              set({ startDate: e.target.value, endDate: addDays(f.endDate, shift) });
            }} required /></label>
            <label>Start<input type="time" value={f.startTime} onChange={(e) => {
              const dur = (Date.parse(`${f.endDate}T${f.endTime}Z`) - Date.parse(`${f.startDate}T${f.startTime}Z`)) / 60000;
              const end = addWallMinutes(`${f.startDate}T${e.target.value}`, dur > 0 ? dur : 60);
              set({ startTime: e.target.value, endDate: localDate(end), endTime: localTime(end) });
            }} step={300} required /></label>
            <label>End<input type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value, endDate: e.target.value <= f.startTime ? addDays(f.startDate, 1) : f.startDate })} step={300} required /></label>
          </div>
          {f.endDate !== f.startDate && <p className="hint">Ends the next day ({f.endDate}).</p>}
          <details>
            <summary className="small">Time zone: {f.tz}</summary>
            <select value={f.tz} onChange={(e) => set({ tz: e.target.value })} aria-label="Time zone">
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </details>
          {otherTz && <p className="hint">That's {localTime(convertLocal(`${f.startDate}T${f.startTime}`, f.tz, s.tz))} in your zone ({s.tz}).</p>}
        </>
      )}
      <fieldset>
        <legend>Repeat</legend>
        <div className="row">
          <select value={f.repeat} onChange={(e) => set({ repeat: e.target.value as Form['repeat'] })} aria-label="Repeat">
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly (same date)</option>
            <option value="yearly">Yearly</option>
          </select>
          {f.repeat !== 'none' && (
            <label className="inline">every <input type="number" min={1} max={99} value={f.interval} onChange={(e) => set({ interval: Number(e.target.value) || 1 })} style={{ width: 56 }} /> {f.repeat === 'daily' ? 'day(s)' : f.repeat === 'weekly' ? 'week(s)' : f.repeat === 'monthly' ? 'month(s)' : 'year(s)'}</label>
          )}
        </div>
        {f.repeat === 'weekly' && (
          <div className="weekday-picks">
            {WEEKDAY_SHORT.map((w, i) => {
              const wd = (i + 1) as Weekday;
              const on = f.byWeekday.includes(wd);
              return <label key={w} className="chip-check"><input type="checkbox" checked={on} onChange={() => set({ byWeekday: on ? f.byWeekday.filter((x) => x !== wd) : [...f.byWeekday, wd] })} />{w}</label>;
            })}
          </div>
        )}
        {f.repeat !== 'none' && (
          <div className="row">
            <select value={f.ends} onChange={(e) => set({ ends: e.target.value as Form['ends'] })} aria-label="Ends">
              <option value="never">Never ends</option>
              <option value="until">Ends on</option>
              <option value="count">Ends after</option>
            </select>
            {f.ends === 'until' && <input type="date" value={f.until} min={f.startDate} onChange={(e) => set({ until: e.target.value })} aria-label="End date" />}
            {f.ends === 'count' && <label className="inline"><input type="number" min={1} value={f.count} onChange={(e) => set({ count: Number(e.target.value) || 1 })} style={{ width: 64 }} /> times</label>}
          </div>
        )}
        {f.repeat === 'monthly' && Number(f.startDate.slice(8)) > 28 && <p className="hint">Months without day {Number(f.startDate.slice(8))} are skipped.</p>}
      </fieldset>
      <fieldset>
        <legend>Alerts</legend>
        <div className="alert-chips">
          {f.alerts.map((m) => (
            <span key={m} className="pill">{m === 0 ? 'At start' : `${leadText(m)} before`} <button className="link" onClick={() => set({ alerts: f.alerts.filter((x) => x !== m) })} aria-label={`Remove ${leadText(m)} alert`}>✕</button></span>
          ))}
          <select value="" onChange={(e) => e.target.value !== '' && set({ alerts: [...f.alerts, Number(e.target.value)] })} aria-label="Add alert">
            <option value="">+ Add alert</option>
            {ALERT_CHOICES.filter((m) => !f.alerts.includes(m)).map((m) => <option key={m} value={m}>{m === 0 ? 'At start' : `${leadText(m)} before`}</option>)}
          </select>
        </div>
        {f.alerts.length > 0 && !s.me.prefs.enabled && <p className="hint warn-text">Reminders are turned off, so these alerts won't fire. <button className="link" onClick={() => s.setDialog({ type: 'notifications' })}>Turn on</button></p>}
        {f.allDay && f.alerts.length > 0 && <p className="hint">All-day alerts are timed from {s.me.prefs.dateOnlyTaskTime} on the day.</p>}
      </fieldset>
      <label>Location<input value={f.location} onChange={(e) => set({ location: e.target.value })} /></label>
      <label>Notes<textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      {s.data.goals.length > 0 && (
        <label>
          Planned practice for goal
          <select value={f.goalId} onChange={(e) => set({ goalId: e.target.value })}>
            <option value="">None</option>
            {s.data.goals.filter((g) => !g.archived).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </label>
      )}
      {linkedTask && <p className="hint">⏱ Time block for to-do “{linkedTask.title}”. Completing the to-do is separate.</p>}
      {event?.recurrence && <p className="hint">{describeRecurrence(event.recurrence, event.startDate)}. Editing asks whether to change this occurrence, the following ones, or all.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </Modal>
  );
}
