import { useMemo, useState } from 'react';
import { useStore } from '../store.tsx';
import type { Task } from '../../shared/types.ts';
import { MONTH_NAMES, formatLongDate, formatTime12, localTime, monthKey, weekday, WEEKDAY_SHORT } from '../../shared/dates.ts';
import { affirmationFor } from '../../shared/quotes.ts';
import { moonForDate, REFLECTIONS, MOON_SYMBOL } from '../../shared/moon.ts';
import { TASK_MIME } from '../views/layout.ts';
import { NoteEditor } from './NoteEditor.tsx';
import { GoalsSection } from './Goals.tsx';
import { useNotifData } from '../notifications.ts';
import { leadText } from '../../shared/notifyPlan.ts';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  if (!open) return null;
  const d = s.selected;
  const isToday = d === s.today;
  return (
    <aside className="sidebar" aria-label="Daily dashboard">
      <div className="sb-head">
        <div>
          <div className="sb-kicker">{isToday ? 'Today' : 'Selected day'}</div>
          <h2 className="sb-date">{formatLongDate(d)}</h2>
        </div>
        <button className="icon-btn sb-close" onClick={onClose} aria-label="Close dashboard">✕</button>
      </div>
      {!isToday && <button className="link return-today" onClick={s.goToday}>← Return to today</button>}
      <Schedule />
      <Tasks />
      <Reminders />
      <section className="sb-section">
        <h3>Daily note</h3>
        <NoteEditor scope="day" noteKey={d} placeholder="Anything to remember about this day…" />
        <button className="link small" onClick={() => s.setDialog({ type: 'monthNotes', month: monthKey(d) })}>
          {MONTH_NAMES[Number(d.slice(5, 7)) - 1]} notes →
        </button>
      </section>
      <GoalsSection />
      <Quote />
      <Moon />
    </aside>
  );
}

function Schedule() {
  const s = useStore();
  const d = s.selected;
  const items = s.occurrences.filter((o) => o.startDate <= d && o.endDate >= d);
  return (
    <section className="sb-section">
      <div className="sb-title-row">
        <h3>Schedule</h3>
        <button className="link small" onClick={() => s.setDialog({ type: 'event', defaults: { startDate: d } })}>+ Event</button>
      </div>
      {items.length === 0 ? (
        <p className="quiet">Nothing scheduled.</p>
      ) : (
        <ul className="sb-list">
          {items.map((o) => {
            const cal = s.calendarsById.get(o.calendarId);
            const ev = s.data.events.find((e) => e.id === o.eventId);
            return (
              <li key={o.key}>
                <button className="sb-item" onClick={() => ev && s.setDialog({ type: 'event', event: ev, occurrence: o })}>
                  <span className="dot" style={{ background: cal?.color }} />
                  <span className="sb-time">{o.allDay || !o.startLocal ? 'All day' : o.startDate < d ? 'cont.' : formatTime12(localTime(o.startLocal))}</span>
                  <span className="sb-text">{o.title}{s.workspace === 'together' && <span className="muted"> · {s.personName(o.ownerId)}</span>}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TaskRow({ t, label }: { t: Task; label?: string }) {
  const s = useStore();
  const toggle = () => void s.saveTask({ ...t, completedAt: t.completedAt ? null : new Date().toISOString() }, t.completedAt ? `Reopen “${t.title}”` : `Complete “${t.title}”`);
  const linked = s.data.events.some((e) => e.taskId === t.id);
  return (
    <li className={`task-row ${t.completedAt ? 'done' : ''}`} draggable={!t.completedAt} onDragStart={(e) => { e.dataTransfer.setData(TASK_MIME, t.id); e.dataTransfer.effectAllowed = 'copy'; }}>
      <input type="checkbox" checked={!!t.completedAt} onChange={toggle} aria-label={`${t.completedAt ? 'Reopen' : 'Complete'} ${t.title}`} />
      <button className="sb-text task-title" onClick={() => s.setDialog({ type: 'task', task: t })}>
        {t.priority > 0 && <span className={`prio p${t.priority}`} aria-label={`priority ${['', 'low', 'medium', 'high'][t.priority]}`}>{'!'.repeat(t.priority)}</span>}
        {t.title}
        {t.dueTime && <span className="muted small"> · {formatTime12(t.dueTime)}</span>}
        {label && <span className="tag">{label}</span>}
        {linked && <span className="tag" title="Has a scheduled time block">⏱</span>}
        {t.alerts.length > 0 && <span className="tag" title="Reminder set">🔔</span>}
      </button>
    </li>
  );
}

function Tasks() {
  const s = useStore();
  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const d = s.selected;
  const mine = s.data.tasks;
  const due = mine.filter((t) => t.dueDate === d).sort((a, b) => (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') || b.priority - a.priority);
  const overdue = mine.filter((t) => !t.completedAt && t.dueDate && t.dueDate < s.today && d === s.today);
  const unscheduled = mine.filter((t) => !t.completedAt && !t.dueDate);
  return (
    <section className="sb-section">
      <div className="sb-title-row">
        <h3>To-dos</h3>
        <button className="link small" onClick={() => s.setDialog({ type: 'task', defaults: { dueDate: d } })}>+ Task</button>
      </div>
      {overdue.length > 0 && (
        <>
          <h4 className="sb-sub warn-text">Overdue</h4>
          <ul className="sb-list">{overdue.map((t) => <TaskRow key={t.id} t={t} label={t.dueDate!.slice(5)} />)}</ul>
        </>
      )}
      {due.length === 0 && overdue.length === 0 && <p className="quiet">No to-dos due {d === s.today ? 'today' : 'this day'}.</p>}
      {due.length > 0 && <ul className="sb-list">{due.map((t) => <TaskRow key={t.id} t={t} />)}</ul>}
      {unscheduled.length > 0 && (
        <>
          <button className="sb-sub link-like" onClick={() => setShowUnscheduled(!showUnscheduled)} aria-expanded={showUnscheduled}>
            Unscheduled ({unscheduled.length}) {showUnscheduled ? '▾' : '▸'}
          </button>
          {showUnscheduled && <ul className="sb-list">{unscheduled.map((t) => <TaskRow key={t.id} t={t} />)}</ul>}
        </>
      )}
      {(due.length > 0 || unscheduled.length > 0) && <p className="hint">Drag a to-do onto the Day or Week grid to block time for it.</p>}
    </section>
  );
}

function Reminders() {
  const s = useStore();
  const n = useNotifData();
  const upcoming = (n?.upcoming ?? []).filter((u) => u.kind !== 'agenda').slice(0, 4);
  const unread = (n?.items ?? []).filter((i) => !i.readAt).length;
  return (
    <section className="sb-section">
      <div className="sb-title-row">
        <h3>Reminders</h3>
        <button className="link small" onClick={() => s.setDialog({ type: 'notifications' })}>Center{unread ? ` (${unread})` : ''}</button>
      </div>
      {!s.me.prefs.enabled ? (
        <p className="quiet">
          Reminders are off. <button className="link" onClick={() => s.setDialog({ type: 'notifications' })}>Turn on</button> to get cues before events and when to-dos are due.
        </p>
      ) : upcoming.length === 0 ? (
        <p className="quiet">No reminders queued in the next week. Add an alert to an event or to-do.</p>
      ) : (
        <ul className="sb-list">
          {upcoming.map((u) => {
            const when = new Date(u.fireAt);
            return (
              <li key={u.id} className="sb-item static">
                <span className="sb-time">{when.toLocaleDateString(undefined, { timeZone: s.tz, weekday: 'short' })} {when.toLocaleTimeString(undefined, { timeZone: s.tz, hour: 'numeric', minute: '2-digit' })}</span>
                <span className="sb-text">{u.title}</span>
              </li>
            );
          })}
        </ul>
      )}
      {s.me.prefs.enabled && <p className="hint">Default: {leadText(s.me.prefs.eventLeadMinutes)} before events.</p>}
    </section>
  );
}

function Quote() {
  const s = useStore();
  return (
    <section className="sb-section quote">
      <h3>For today</h3>
      <blockquote>{affirmationFor(s.today)}</blockquote>
      <p className="hint">Original affirmation · changes daily</p>
    </section>
  );
}

function Moon() {
  const s = useStore();
  const show = s.me.settings.showMoon !== false;
  const info = useMemo(() => {
    try {
      return show ? moonForDate(s.selected, s.tz) : null;
    } catch {
      return 'error' as const;
    }
  }, [s.selected, s.tz, show]);
  if (!show) return null;
  if (info === 'error' || !info) return <section className="sb-section"><h3>Moon</h3><p className="quiet">Moon data is unavailable right now.</p></section>;
  const nq = info.nextQuarter;
  return (
    <section className="sb-section moon">
      <h3>Moon</h3>
      <div className="moon-row">
        <MoonDisc angle={info.angle} />
        <div>
          <div className="moon-phase">{info.phase}</div>
          <div className="muted small">{Math.round(info.illumination * 100)}% illuminated{info.quarterToday ? ` · exact at ${formatTime12(info.quarterToday.localTime)}` : ''}</div>
          <div className="muted small">Next: {MOON_SYMBOL[nq.name]} {nq.name}, {WEEKDAY_SHORT[weekday(nq.localDate) - 1]} {MONTH_NAMES[Number(nq.localDate.slice(5, 7)) - 1].slice(0, 3)} {Number(nq.localDate.slice(8))}</div>
        </div>
      </div>
      {s.me.settings.showReflection !== false && (
        <div className="reflection">
          <div className="reflection-label">Reflection prompt <span className="muted">· optional, interpretive</span></div>
          <p>{REFLECTIONS[info.phase]}</p>
        </div>
      )}
    </section>
  );
}

/** Simple lit-fraction rendering of the moon (decorative; the phase name carries the meaning). */
function MoonDisc({ angle }: { angle: number }) {
  const r = 16;
  const k = Math.cos((angle * Math.PI) / 180); // 1 new, -1 full
  const waxing = angle < 180;
  const rx = Math.abs(k) * r;
  const litRight = waxing;
  // Lit area: half disc on lit side + ellipse that adds (gibbous) or subtracts (crescent).
  const half = litRight ? `M20 4 A16 16 0 0 1 20 36` : `M20 4 A16 16 0 0 0 20 36`;
  const sweep = (k > 0) === litRight ? 0 : 1;
  const path = `${half} A${rx} 16 0 0 ${sweep} 20 4 Z`;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="moon-disc">
      <circle cx="20" cy="20" r={r} className="moon-dark" />
      <path d={path} className="moon-lit" />
    </svg>
  );
}
