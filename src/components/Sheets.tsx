import { useState } from 'react';
import { useStore } from '../store.tsx';
import type { Goal, Task, Weekday } from '../../shared/types.ts';
import { MONTH_NAMES, WEEKDAY_SHORT } from '../../shared/dates.ts';
import { STREAK_RULES } from '../../shared/streaks.ts';
import { onColor } from '../lib/format.ts';
import { Sheet } from './Sheet.tsx';
import { EventSheet } from './EventSheet.tsx';
import { signOut } from '../lib/auth.ts';
import { resetDemo } from '../lib/demo.ts';
import { SaveStatus } from '../views/DayPanel.tsx';

export const GOAL_COLORS = ['#ff4f5e', '#ff9f1c', '#ffc531', '#0fb88a', '#2d6bff', '#7b3ff2', '#ff5fa2', '#16131c'];

export function Sheets() {
  const s = useStore();
  const sh = s.sheet;
  const close = () => s.setSheet(null);
  if (!sh) return null;
  switch (sh.type) {
    case 'add': return <AddSheet date={sh.date ?? s.selected} onClose={close} />;
    case 'event': return <EventSheet key={sh.event?.id ?? 'new'} event={sh.event} date={sh.date} startTime={sh.startTime} onClose={close} />;
    case 'task': return <TaskSheet task={sh.task} date={sh.date} onClose={close} />;
    case 'goal': return <GoalSheet goal={s.app.goals.find((g) => g.id === sh.goalId)} onClose={close} />;
    case 'monthNote': return <MonthNoteSheet month={sh.month} onClose={close} />;
    case 'calendars': return <CalendarsSheet onClose={close} />;
    case 'menu': return <MenuSheet onClose={close} />;
  }
}

function AddSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const s = useStore();
  const tiles = [
    { label: 'Event', sub: 'Goes on your Google Calendar', color: '#2d6bff', run: () => s.setSheet({ type: 'event', date }) },
    { label: 'To-do', sub: 'Goes in Google Tasks', color: '#0fb88a', run: () => s.setSheet({ type: 'task', date }) },
    { label: 'Goal', sub: 'Weekly target or daily streak', color: '#7b3ff2', run: () => s.setSheet({ type: 'goal' }) },
    { label: 'Month note', sub: `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} notes`, color: '#ffc531', run: () => s.setSheet({ type: 'monthNote', month: date.slice(0, 7) }) },
  ];
  return (
    <Sheet title="Add" onClose={onClose}>
      <div className="add-tiles">
        {tiles.map((t) => (
          <button key={t.label} className="add-tile" style={{ background: t.color, color: onColor(t.color) }} onClick={t.run}>
            <b>{t.label}</b>
            <span>{t.sub}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function TaskSheet({ task, date, onClose }: { task?: Task; date?: string | null; onClose: () => void }) {
  const s = useStore();
  const [t, setT] = useState<Omit<Task, 'id'> & { id?: string }>(task ?? { listId: s.lists[0]?.id ?? '', title: '', notes: '', due: date ?? null, completed: false });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!t.title.trim()) return;
    setBusy(true);
    const ok = task ? await s.actions.updateTask({ ...(t as Task), title: t.title.trim() }) : await s.actions.createTask({ listId: t.listId, title: t.title.trim(), notes: t.notes, due: t.due });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Sheet title={task ? 'Edit to-do' : 'New to-do'} onClose={onClose} accent="#0fb88a" footer={
      <>
        {task && <button className="btn danger" disabled={busy} onClick={async () => { if (await s.actions.deleteTask(task)) onClose(); }}>Delete</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !t.title.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      </>
    }>
      <input className="title-input" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} placeholder="What needs doing?" autoFocus aria-label="To-do" onKeyDown={(e) => e.key === 'Enter' && void save()} />
      {s.lists.length > 1 && (
        <label>List
          <select value={t.listId} onChange={(e) => setT({ ...t, listId: e.target.value })} disabled={!!task}>
            {s.lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
          </select>
        </label>
      )}
      <label>Due date (optional)
        <input type="date" value={t.due ?? ''} onChange={(e) => setT({ ...t, due: e.target.value || null })} />
      </label>
      {task && (
        <label className="switch-row">
          <span>Done</span>
          <input type="checkbox" role="switch" checked={t.completed} onChange={(e) => setT({ ...t, completed: e.target.checked })} />
        </label>
      )}
      <label>Notes<textarea rows={3} value={t.notes} onChange={(e) => setT({ ...t, notes: e.target.value })} /></label>
      <p className="hint">Saved to Google Tasks. To-dos with a date also show up in the Google Calendar app.</p>
    </Sheet>
  );
}

function GoalSheet({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const s = useStore();
  const [g, setG] = useState<Goal>(goal ?? { id: crypto.randomUUID(), title: '', color: GOAL_COLORS[5], mode: 'weekly', weeklyTarget: 3, restDays: [], archived: false });
  const save = () => {
    if (!g.title.trim()) return;
    s.updateApp((a) => ({ ...a, goals: goal ? a.goals.map((x) => (x.id === g.id ? { ...g, title: g.title.trim() } : x)) : [...a.goals, { ...g, title: g.title.trim() }] }));
    onClose();
  };
  const remove = () => {
    if (!goal || !confirm(`Delete “${goal.title}” and its check-ins?`)) return;
    s.updateApp((a) => ({ ...a, goals: a.goals.filter((x) => x.id !== goal.id), checkIns: a.checkIns.filter((c) => c.goalId !== goal.id) }));
    onClose();
  };
  return (
    <Sheet title={goal ? 'Edit goal' : 'New goal'} onClose={onClose} accent={g.color} footer={
      <>
        {goal && <button className="btn danger" onClick={remove}>Delete</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!g.title.trim()}>Save</button>
      </>
    }>
      <input className="title-input" value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} placeholder="e.g. Workout, Trading practice, Create" autoFocus aria-label="Goal" />
      <div className="swatches" role="radiogroup" aria-label="Color">
        {GOAL_COLORS.map((c) => <button key={c} role="radio" aria-checked={g.color === c} aria-label={c} className={`swatch ${g.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setG({ ...g, color: c })} />)}
      </div>
      <div className="seg-big" role="radiogroup" aria-label="Goal type">
        <button role="radio" aria-checked={g.mode === 'weekly'} className={g.mode === 'weekly' ? 'on' : ''} onClick={() => setG({ ...g, mode: 'weekly' })}>Times per week</button>
        <button role="radio" aria-checked={g.mode === 'daily'} className={g.mode === 'daily' ? 'on' : ''} onClick={() => setG({ ...g, mode: 'daily' })}>Daily streak</button>
      </div>
      {g.mode === 'weekly' ? (
        <div className="stepper">
          <button onClick={() => setG({ ...g, weeklyTarget: Math.max(1, g.weeklyTarget - 1) })} aria-label="Fewer">−</button>
          <b>{g.weeklyTarget}</b><span>× per week</span>
          <button onClick={() => setG({ ...g, weeklyTarget: Math.min(14, g.weeklyTarget + 1) })} aria-label="More">+</button>
        </div>
      ) : (
        <>
          <p className="muted small">Rest days (won't break your streak):</p>
          <div className="day-picks">
            {WEEKDAY_SHORT.map((n, i) => {
              const wd = (i + 1) as Weekday;
              const on = g.restDays.includes(wd);
              return <button key={n} className={`day-pick ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setG({ ...g, restDays: on ? g.restDays.filter((x) => x !== wd) : [...g.restDays, wd] })}>{n.slice(0, 2)}</button>;
            })}
          </div>
        </>
      )}
      <p className="hint">{g.mode === 'weekly' ? STREAK_RULES.weekly : STREAK_RULES.daily} Saved privately in your Google Drive.</p>
    </Sheet>
  );
}

function MonthNoteSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const s = useStore();
  const [text, setText] = useState(s.app.monthNotes[month] ?? '');
  const save = (v: string) => {
    setText(v);
    s.updateApp((a) => {
      const monthNotes = { ...a.monthNotes };
      if (v.trim()) monthNotes[month] = v;
      else delete monthNotes[month];
      return { ...a, monthNotes };
    });
  };
  return (
    <Sheet title={`${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`} onClose={onClose} accent="#ffc531">
      <textarea className="big-note" rows={10} value={text} onChange={(e) => save(e.target.value)} placeholder="Bills to watch, goals, things to remember this month…" autoFocus aria-label="Month notes" />
      <div className="note-foot"><SaveStatus /><span className="hint">Private · saved in your Google Drive</span></div>
    </Sheet>
  );
}

function CalendarsSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const toggle = (id: string) => s.updateApp((a) => ({ ...a, hiddenCalendars: a.hiddenCalendars.includes(id) ? a.hiddenCalendars.filter((x) => x !== id) : [...a.hiddenCalendars, id] }));
  const role = { owner: 'Yours', writer: 'Can edit', reader: 'View only', freeBusyReader: 'Free/busy only' } as const;
  return (
    <Sheet title="Calendars" onClose={onClose}>
      <ul className="cal-list">
        {s.calendars.map((c) => {
          const on = !s.app.hiddenCalendars.includes(c.id);
          return (
            <li key={c.id}>
              <button className={`cal-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => toggle(c.id)} style={{ ['--c' as string]: c.color }}>
                <i aria-hidden>{on ? '✓' : ''}</i>
                <span className="cal-name">{c.summary}</span>
                <small>{role[c.accessRole]}</small>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="tip">
        <b>Seeing Tehron's schedule</b>
        <p>In Google Calendar on a computer, Tehron opens Settings → his calendar → <i>Share with specific people</i> and adds your Gmail. Choose “See all event details” (or “Make changes”). It then appears here automatically.</p>
        <p>To add calendars like Bills or Paydays, create them in Google Calendar (Other calendars → +). They show up here after a refresh.</p>
      </div>
    </Sheet>
  );
}

function MenuSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const demo = s.backend.kind === 'demo';
  return (
    <Sheet title={s.user.name || 'Menu'} onClose={onClose}>
      {!demo && <p className="muted">{s.user.email}</p>}
      {demo && <p className="tip">You're in <b>demo mode</b>: sample data stored only in this browser. Nothing touches a real calendar.</p>}
      <div className="menu-list">
        <button onClick={() => s.setSheet({ type: 'calendars' })}>Calendars <span>›</span></button>
        <label className="switch-row">
          <span>Week starts Monday</span>
          <input type="checkbox" role="switch" checked={s.app.weekStartsOn === 1} onChange={(e) => s.updateApp((a) => ({ ...a, weekStartsOn: e.target.checked ? 1 : 7 }))} />
        </label>
        {!demo && <a href="https://calendar.google.com" target="_blank" rel="noreferrer">Open Google Calendar <span>↗</span></a>}
        <button onClick={() => { void s.reload(); onClose(); }}>Refresh <span>↻</span></button>
        {demo ? (
          <>
            <button onClick={() => { resetDemo(); location.reload(); }}>Reset demo data</button>
            <button onClick={() => { localStorage.removeItem('bac-mode'); location.href = '/'; }}>Exit demo</button>
          </>
        ) : (
          <button onClick={async () => { await signOut(); location.href = '/'; }}>Sign out</button>
        )}
      </div>
      <p className="hint">Times are shown in {s.tz}.</p>
    </Sheet>
  );
}
