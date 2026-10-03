import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.tsx';
import type { Ev, Weekday } from '../../shared/types.ts';
import { addDays, addWallMinutes, weekday } from '../../shared/dates.ts';
import { describeRule, type Freq, type Rule } from '../../shared/rrule.ts';
import type { EventInput, Scope } from '../lib/backend.ts';
import { onColor, shortDate, time12 } from '../lib/format.ts';
import { Sheet } from './Sheet.tsx';

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const REMINDERS: { label: string; value: string }[] = [
  { label: 'Calendar default', value: 'default' },
  { label: 'No reminder', value: 'none' },
  { label: 'At start', value: '0' },
  { label: '10 min before', value: '10' },
  { label: '30 min before', value: '30' },
  { label: '1 hour before', value: '60' },
  { label: '1 day before', value: '1440' },
];

interface Form {
  title: string;
  calendarId: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  repeat: 'NONE' | Freq;
  interval: number;
  byDay: Weekday[];
  ends: 'never' | 'until' | 'count';
  until: string;
  count: number;
  reminder: string;
}

export function EventSheet({ event, date, startTime, onClose }: { event?: Ev; date?: string; startTime?: string; onClose: () => void }) {
  const s = useStore();
  const cal = event ? s.calById.get(event.calendarId) : undefined;
  const readOnly = !!event && (!cal || (cal.accessRole !== 'owner' && cal.accessRole !== 'writer'));
  const [seriesRule, setSeriesRule] = useState<Rule | null | undefined>(event?.recurringEventId ? undefined : null);
  const [step, setStep] = useState<'edit' | 'scope-save' | 'scope-delete'>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo<Form>(() => {
    const d = event?.startDate ?? date ?? s.selected;
    const st = event?.startLocal?.slice(11) ?? startTime ?? '09:00';
    const en = event?.endLocal?.slice(11) ?? addWallMinutes(`${d}T${st}`, 60).slice(11);
    const ov = event?.reminders;
    return {
      title: event?.title ?? '',
      calendarId: event?.calendarId ?? (s.writableCals.find((c) => c.primary) ?? s.writableCals[0])?.id ?? '',
      allDay: event ? event.allDay : !startTime,
      startDate: d,
      endDate: event ? (event.allDay ? event.endDate : event.endLocal!.slice(0, 10)) : d,
      startTime: st,
      endTime: en,
      location: event?.location ?? '',
      description: event?.description ?? '',
      repeat: 'NONE',
      interval: 1,
      byDay: [weekday(d) as Weekday],
      ends: 'never',
      until: addDays(d, 90),
      count: 10,
      reminder: !ov || ov.useDefault ? 'default' : ov.overrides.length === 0 ? 'none' : String(ov.overrides[0].minutes),
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState<Form>(initial);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  // Load the series rule for instances of a repeating event so the form shows it.
  useEffect(() => {
    if (!event?.recurringEventId) return;
    s.backend.series(event).then((r) => {
      setSeriesRule(r);
      if (r) set({ repeat: r.freq, interval: r.interval, byDay: r.byDay.length ? r.byDay : f.byDay, ends: r.until ? 'until' : r.count ? 'count' : 'never', until: r.until ? `${r.until.slice(0, 4)}-${r.until.slice(4, 6)}-${r.until.slice(6, 8)}` : f.until, count: r.count ?? 10 });
    }).catch(() => setSeriesRule(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rule = (): Rule | null => f.repeat === 'NONE' ? null : {
    freq: f.repeat,
    interval: Math.max(1, f.interval),
    byDay: f.repeat === 'WEEKLY' ? f.byDay : [],
    until: f.ends === 'until' ? f.until.replace(/-/g, '') + (f.allDay ? '' : 'T235959Z') : null,
    count: f.ends === 'count' ? Math.max(1, f.count) : null,
  };

  const input = (): EventInput => {
    let { endDate, endTime } = f;
    if (!f.allDay && `${endDate}T${endTime}` <= `${f.startDate}T${f.startTime}`) {
      const e = addWallMinutes(`${f.startDate}T${f.startTime}`, 60);
      endDate = e.slice(0, 10);
      endTime = e.slice(11);
    }
    if (f.allDay && endDate < f.startDate) endDate = f.startDate;
    return {
      calendarId: f.calendarId,
      title: f.title.trim(),
      allDay: f.allDay,
      startDate: f.startDate,
      endDate,
      startTime: f.startTime,
      endTime,
      location: f.location,
      description: f.description,
      rule: rule(),
      reminders: f.reminder === 'default' ? { useDefault: true, overrides: [] } : { useDefault: false, overrides: f.reminder === 'none' ? [] : [{ method: 'popup', minutes: Number(f.reminder) }] },
    };
  };

  const ruleChanged = () => JSON.stringify(rule()) !== JSON.stringify(seriesRule ?? null);

  const save = async (scope?: Scope) => {
    if (!f.title.trim()) return setError('Give it a title.');
    if (!f.calendarId) return setError('Pick a calendar.');
    if (f.repeat === 'WEEKLY' && !f.byDay.length) return setError('Pick at least one day.');
    if (event?.recurringEventId && !scope) return setStep('scope-save');
    setBusy(true);
    setError(null);
    const ok = event ? await s.actions.updateEvent(event, input(), scope ?? 'all') : await s.actions.createEvent(input());
    setBusy(false);
    if (ok) onClose();
  };

  const remove = async (scope?: Scope) => {
    if (!event) return;
    if (event.recurringEventId && !scope) return setStep('scope-delete');
    setBusy(true);
    const ok = await s.actions.deleteEvent(event, scope ?? 'all');
    setBusy(false);
    if (ok) onClose();
  };

  if (readOnly && event) {
    const c = s.colorOf(event);
    return (
      <Sheet title={event.title} onClose={onClose} accent={c}>
        <div className="ro-banner" style={{ background: c, color: onColor(c) }}>
          <b>{event.allDay ? (event.endDate > event.startDate ? `${shortDate(event.startDate)} – ${shortDate(event.endDate)}` : `${shortDate(event.startDate)} · all day`) : `${shortDate(event.startDate)} · ${time12(event.startLocal!)} – ${time12(event.endLocal!)}`}</b>
          <span>{cal?.summary}</span>
        </div>
        {event.busyOnly ? <p className="muted">This calendar is shared as free/busy only, so details are hidden.</p> : (
          <>
            {event.location && <p>📍 {event.location}</p>}
            {event.description && <p className="pre">{event.description}</p>}
            <p className="muted small">View only — this calendar is shared with you without edit access.</p>
          </>
        )}
        {event.htmlLink && <a className="link" href={event.htmlLink} target="_blank" rel="noreferrer">Open in Google Calendar ↗</a>}
      </Sheet>
    );
  }

  if (step !== 'edit') {
    const del = step === 'scope-delete';
    const changed = !del && ruleChanged();
    return (
      <Sheet title={del ? 'Delete repeating event' : 'Save repeating event'} onClose={() => setStep('edit')}>
        <p className="muted">{changed ? 'You changed how it repeats, so this applies to more than one event.' : 'Which events should change?'}</p>
        <div className="stack">
          {!changed && <button className="big-choice" disabled={busy} onClick={() => void (del ? remove('this') : save('this'))}>Only this event</button>}
          <button className="big-choice" disabled={busy} onClick={() => void (del ? remove('following') : save('following'))}>This and following</button>
          <button className="big-choice" disabled={busy} onClick={() => void (del ? remove('all') : save('all'))}>All events in the series</button>
          <button className="btn ghost" onClick={() => setStep('edit')}>Back</button>
        </div>
      </Sheet>
    );
  }

  const accent = s.calById.get(f.calendarId)?.color ?? '#2d6bff';
  return (
    <Sheet
      title={event ? 'Edit event' : 'New event'}
      onClose={onClose}
      accent={accent}
      footer={
        <>
          {event && <button className="btn danger" onClick={() => void remove()} disabled={busy}>Delete</button>}
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <input className="title-input" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="What's happening?" autoFocus aria-label="Title" onKeyDown={(e) => e.key === 'Enter' && void save()} />
      {s.writableCals.length === 0 ? (
        <p className="error">You don't have a Google calendar you can edit.</p>
      ) : (
        <div className="cal-chips" role="radiogroup" aria-label="Calendar">
          {s.writableCals.map((c) => (
            <button key={c.id} role="radio" aria-checked={f.calendarId === c.id} className={`cal-chip ${f.calendarId === c.id ? 'on' : ''}`} style={{ ['--c' as string]: c.color, ...(f.calendarId === c.id ? { color: onColor(c.color) } : {}) }} onClick={() => set({ calendarId: c.id })}>
              {c.summary}
            </button>
          ))}
        </div>
      )}
      <label className="switch-row">
        <span>All day</span>
        <input type="checkbox" role="switch" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
      </label>
      {f.allDay ? (
        <div className="row2">
          <label>Starts<input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} /></label>
          <label>Ends<input type="date" value={f.endDate} min={f.startDate} onChange={(e) => set({ endDate: e.target.value })} /></label>
        </div>
      ) : (
        <>
          <label>Date<input type="date" value={f.startDate} onChange={(e) => {
            const delta = Math.round((Date.parse(e.target.value) - Date.parse(f.startDate)) / 86400000);
            set({ startDate: e.target.value, endDate: addDays(f.endDate, delta) });
          }} /></label>
          <div className="row2">
            <label>From<input type="time" value={f.startTime} step={300} onChange={(e) => {
              const dur = (Date.parse(`${f.endDate}T${f.endTime}Z`) - Date.parse(`${f.startDate}T${f.startTime}Z`)) / 60000;
              const end = addWallMinutes(`${f.startDate}T${e.target.value}`, dur > 0 ? dur : 60);
              set({ startTime: e.target.value, endDate: end.slice(0, 10), endTime: end.slice(11) });
            }} /></label>
            <label>To<input type="time" value={f.endTime} step={300} onChange={(e) => set({ endTime: e.target.value, endDate: e.target.value <= f.startTime ? addDays(f.startDate, 1) : f.startDate })} /></label>
          </div>
          {f.endDate !== f.startDate && <p className="hint">Ends the next day.</p>}
        </>
      )}
      <label>Repeat
        <select value={f.repeat} onChange={(e) => set({ repeat: e.target.value as Form['repeat'] })} disabled={event?.recurringEventId ? seriesRule === undefined : false}>
          <option value="NONE">Does not repeat</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly on day {Number(f.startDate.slice(8))}</option>
          <option value="YEARLY">Yearly</option>
        </select>
      </label>
      {f.repeat === 'WEEKLY' && (
        <div className="day-picks" role="group" aria-label="Repeat on">
          {DAYS.map((n, i) => {
            const wd = (i + 1) as Weekday;
            const on = f.byDay.includes(wd);
            return <button key={n} className={`day-pick ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set({ byDay: on ? f.byDay.filter((x) => x !== wd) : [...f.byDay, wd] })}>{n}</button>;
          })}
        </div>
      )}
      {f.repeat !== 'NONE' && (
        <div className="row2">
          <label>Every
            <select value={f.interval} onChange={(e) => set({ interval: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => {
                const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[f.repeat as Freq];
                return <option key={n} value={n}>{n === 1 ? unit : `${n} ${unit}s`}</option>;
              })}
            </select>
          </label>
          <label>Ends
            <select value={f.ends} onChange={(e) => set({ ends: e.target.value as Form['ends'] })}>
              <option value="never">Never</option>
              <option value="until">On a date</option>
              <option value="count">After a number</option>
            </select>
          </label>
        </div>
      )}
      {f.repeat !== 'NONE' && f.ends === 'until' && <label>Last date<input type="date" value={f.until} min={f.startDate} onChange={(e) => set({ until: e.target.value })} /></label>}
      {f.repeat !== 'NONE' && f.ends === 'count' && <label>Times<input type="number" min={1} max={500} value={f.count} onChange={(e) => set({ count: Number(e.target.value) || 1 })} /></label>}
      {event?.recurringEventId && seriesRule !== undefined && <p className="hint">{describeRule(seriesRule)}</p>}
      <label>Reminder
        <select value={f.reminder} onChange={(e) => set({ reminder: e.target.value })}>
          {REMINDERS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      <p className="hint">Reminders are sent by the Google Calendar app on your phone.</p>
      <label>Location<input value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="Add a place" /></label>
      <label>Notes<textarea rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} /></label>
      {event?.htmlLink && <a className="link small" href={event.htmlLink} target="_blank" rel="noreferrer">Open in Google Calendar ↗</a>}
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}
