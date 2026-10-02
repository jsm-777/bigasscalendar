import { useMemo, useState } from 'react';
import { useStore } from '../store.tsx';
import { Modal } from './Modal.tsx';
import { EventEditor } from './EventEditor.tsx';
import { TaskEditor } from './TaskEditor.tsx';
import { GoalDialog } from './Goals.tsx';
import { SettingsDialog } from './Settings.tsx';
import { NotificationCenter } from './NotificationCenter.tsx';
import { PlannerDialog } from './Planner.tsx';
import { NoteEditor } from './NoteEditor.tsx';
import { ScopeDialogHost } from '../actions.tsx';
import { MONTH_NAMES, formatLongDate, formatTime12, localTime } from '../../shared/dates.ts';
import { expandAll } from '../../shared/recurrence.ts';

export function Dialogs() {
  const s = useStore();
  const d = s.dialog;
  const close = () => s.setDialog(null);
  return (
    <>
      {d?.type === 'event' && <EventEditor key={d.event?.id ?? 'new'} event={d.event} occurrence={d.occurrence} defaults={d.defaults} onClose={close} />}
      {d?.type === 'task' && <TaskEditor task={d.task} defaults={d.defaults} onClose={close} />}
      {d?.type === 'goal' && <GoalDialog goal={d.goal} onClose={close} />}
      {d?.type === 'settings' && <SettingsDialog initialTab={d.tab} onClose={close} />}
      {d?.type === 'notifications' && <NotificationCenter onClose={close} />}
      {d?.type === 'planner' && <PlannerDialog onClose={close} />}
      {d?.type === 'search' && <SearchDialog onClose={close} />}
      {d?.type === 'dayList' && <DayList date={d.date} onClose={close} />}
      {d?.type === 'monthNotes' && <MonthNotes month={d.month} onClose={close} />}
      {d?.type === 'add' && <AddMenu onClose={close} />}
      <ScopeDialogHost />
    </>
  );
}

function AddMenu({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const date = s.selected;
  return (
    <Modal title={`Add to ${formatLongDate(date)}`} onClose={onClose}>
      <div className="add-grid">
        <button className="btn big" autoFocus onClick={() => s.setDialog({ type: 'event', defaults: { startDate: date } })}>📅 Event<span>Something at a time or all day</span></button>
        <button className="btn big" onClick={() => s.setDialog({ type: 'task', defaults: { dueDate: date } })}>☑ To-do<span>With or without a due date</span></button>
        <button className="btn big" onClick={() => { onClose(); setTimeout(() => (document.querySelector('.sidebar .note-editor textarea') as HTMLTextAreaElement | null)?.focus(), 50); }}>✎ Daily note<span>Private to you</span></button>
        <button className="btn big" onClick={() => s.setDialog({ type: 'monthNotes', month: date.slice(0, 7) })}>🗒 Month note<span>{MONTH_NAMES[Number(date.slice(5, 7)) - 1]} notes column</span></button>
        <button className="btn big" onClick={() => s.setDialog({ type: 'goal' })}>🎯 Goal<span>Weekly target or daily streak</span></button>
        <button className="btn big" onClick={() => s.setDialog({ type: 'planner' })}>✦ Plan<span>Describe a plan or import JSON</span></button>
      </div>
    </Modal>
  );
}

function DayList({ date, onClose }: { date: string; onClose: () => void }) {
  const s = useStore();
  const items = s.occurrences.filter((o) => o.startDate <= date && o.endDate >= date);
  return (
    <Modal title={formatLongDate(date)} onClose={onClose} footer={<><span className="grow" /><button className="btn primary" onClick={() => s.setDialog({ type: 'event', defaults: { startDate: date } })}>+ Event</button></>}>
      {items.length === 0 ? <p className="quiet">Nothing scheduled.</p> : (
        <ul className="sb-list">
          {items.map((o) => {
            const cal = s.calendarsById.get(o.calendarId);
            const ev = s.data.events.find((e) => e.id === o.eventId);
            return (
              <li key={o.key}>
                <button className="sb-item" onClick={() => ev && s.setDialog({ type: 'event', event: ev, occurrence: o })}>
                  <span className="dot" style={{ background: cal?.color }} />
                  <span className="sb-time">{o.allDay || !o.startLocal ? 'All day' : formatTime12(localTime(o.startLocal))}</span>
                  <span className="sb-text">{o.title} <span className="muted small">· {cal?.name}{s.workspace !== 'me' ? ` · ${s.personName(o.ownerId)}` : ''}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

function MonthNotes({ month, onClose }: { month: string; onClose: () => void }) {
  return (
    <Modal title={`${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)} notes`} onClose={onClose}>
      <NoteEditor scope="month" noteKey={month} rows={10} autoFocus placeholder="Goals, bills to watch, things to remember this month…" />
      <hr />
      <h3 className="small-head">Unscheduled notes</h3>
      <NoteEditor scope="loose" noteKey="" rows={5} placeholder="Ideas and notes without a date…" />
    </Modal>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const match = (...xs: string[]) => xs.some((x) => x.toLowerCase().includes(term));
    const evs = s.data.events.filter((e) => !e.redacted && match(e.title, e.location, e.notes));
    const occs = expandAll(evs, s.loadFrom, s.loadTo).slice(0, 40).map((o) => ({ kind: 'event' as const, id: o.key, date: o.startDate, title: o.title, sub: `${o.allDay || !o.startLocal ? 'All day' : formatTime12(localTime(o.startLocal))} · ${s.calendarsById.get(o.calendarId)?.name ?? ''}`, occ: o }));
    const tasks = s.data.tasks.filter((t) => match(t.title, t.notes)).map((t) => ({ kind: 'task' as const, id: t.id, date: t.dueDate ?? '', title: t.title, sub: t.completedAt ? 'Completed to-do' : t.dueDate ? 'To-do' : 'Unscheduled to-do', task: t }));
    const notes = s.data.notes.filter((n) => match(n.body)).map((n) => ({ kind: 'note' as const, id: n.id, date: n.scope === 'day' ? n.key : n.scope === 'month' ? `${n.key}-01` : '', title: n.body.slice(0, 80), sub: n.scope === 'day' ? 'Daily note' : n.scope === 'month' ? 'Month note' : 'Unscheduled note', note: n }));
    return [...occs, ...tasks, ...notes];
  }, [q, s]);
  return (
    <Modal title="Search" onClose={onClose} wide>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events, to-dos and notes…" autoFocus aria-label="Search" />
      <p className="hint">Searches what's loaded for this 12-month range plus all to-dos and notes.</p>
      <ul className="sb-list search-results">
        {results.map((r) => (
          <li key={r.kind + r.id}>
            <button className="sb-item" onClick={() => {
              if (r.date) s.setSelected(r.date);
              if (r.kind === 'event') {
                const ev = s.data.events.find((e) => e.id === r.occ.eventId);
                if (ev) s.setDialog({ type: 'event', event: ev, occurrence: r.occ });
              } else if (r.kind === 'task') s.setDialog({ type: 'task', task: r.task });
              else if (r.note.scope === 'day') onClose();
              else s.setDialog({ type: 'monthNotes', month: r.note.scope === 'month' ? r.note.key : s.selected.slice(0, 7) });
            }}>
              <span className="sb-time">{r.date ? r.date.slice(5) : '—'}</span>
              <span className="sb-text">{r.title}<span className="muted small"> · {r.sub}</span></span>
            </button>
          </li>
        ))}
        {q.trim().length >= 2 && results.length === 0 && <li className="quiet">No matches.</li>}
      </ul>
    </Modal>
  );
}
