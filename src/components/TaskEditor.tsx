import { useState } from 'react';
import { useStore } from '../store.tsx';
import { newId } from '../api.ts';
import type { Priority, Recurrence, Task } from '../../shared/types.ts';
import { addDays, todayIn } from '../../shared/dates.ts';
import { describeRecurrence } from '../../shared/recurrence.ts';
import { leadText } from '../../shared/notifyPlan.ts';
import { Modal } from './Modal.tsx';
import { useEventActions } from '../actions.tsx';

export function TaskEditor({ task, defaults, onClose }: { task?: Task; defaults?: Partial<Task>; onClose: () => void }) {
  const s = useStore();
  const actions = useEventActions();
  const [t, setT] = useState<Task>(() => task ?? {
    id: newId(), ownerId: s.me.user.id, listId: s.data.taskLists[0]?.id ?? '', title: '', notes: '', priority: 0,
    dueDate: defaults?.dueDate ?? null, dueTime: null, tz: s.tz, recurrence: null, completedAt: null,
    alerts: s.me.prefs.enabled ? [{ minutesBefore: s.me.prefs.taskLeadMinutes }] : [], goalId: null, version: 0, updatedAt: '',
    ...defaults,
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Task>) => setT((x) => ({ ...x, ...p }));
  const remind = t.alerts.length > 0;

  const save = async () => {
    if (!t.title.trim()) return;
    setBusy(true);
    const saved = await s.saveTask({ ...t, title: t.title.trim() }, task ? `Edit “${t.title}”` : `Add “${t.title}”`);
    setBusy(false);
    if (saved) onClose();
  };

  const schedule = async () => {
    const saved = await s.saveTask({ ...t, title: t.title.trim() }, 'Save task');
    if (!saved) return;
    const date = t.dueDate ?? s.selected;
    onClose();
    s.setDialog({ type: 'event', defaults: { title: saved.title, startDate: date, startLocal: `${date}T${t.dueTime ?? '09:00'}`, taskId: saved.id, allDay: false } });
  };

  const rule = t.recurrence;
  const setRule = (freq: string) => set({ recurrence: freq === 'none' ? null : { freq: freq as Recurrence['freq'], interval: 1 } });
  const blocks = task ? s.data.events.filter((e) => e.taskId === task.id) : [];

  return (
    <Modal title={task ? 'Edit to-do' : 'New to-do'} onClose={onClose} footer={
      <>
        {task && <button className="btn danger ghost" onClick={() => { void s.deleteTask(task); onClose(); }}>Delete</button>}
        {task && !task.completedAt && (
          <button className="btn ghost" onClick={() => void s.saveTask({ ...t, dueDate: addDays(t.dueDate ?? todayIn(s.tz), 1) }, `Snooze “${t.title}” to tomorrow`).then((ok) => ok && onClose())}>Snooze to tomorrow</button>
        )}
        <span className="grow" />
        <button className="btn ghost" onClick={schedule} disabled={!t.title.trim()} title="Create a linked time block (does not complete the to-do)">Schedule time…</button>
        <button className="btn primary" onClick={save} disabled={busy || !t.title.trim()}>Save</button>
      </>
    }>
      <label>To-do<input value={t.title} onChange={(e) => set({ title: e.target.value })} autoFocus onKeyDown={(e) => e.key === 'Enter' && void save()} /></label>
      <div className="row">
        <label>List
          <select value={t.listId} onChange={(e) => set({ listId: e.target.value })}>
            {s.data.taskLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label>Priority
          <select value={t.priority} onChange={(e) => set({ priority: Number(e.target.value) as Priority })}>
            <option value={0}>None</option><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option>
          </select>
        </label>
      </div>
      <div className="row">
        <label>Due date<input type="date" value={t.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null, dueTime: e.target.value ? t.dueTime : null })} /></label>
        <label>Due time (optional)<input type="time" value={t.dueTime ?? ''} disabled={!t.dueDate} onChange={(e) => set({ dueTime: e.target.value || null })} /></label>
      </div>
      <p className="hint">{!t.dueDate ? 'No date: shows under Unscheduled.' : t.dueTime ? 'Due at a specific time.' : 'Date-only: due any time that day.'}</p>
      <label className="inline">
        <input type="checkbox" checked={remind} disabled={!t.dueDate} onChange={(e) => set({ alerts: e.target.checked ? [{ minutesBefore: t.dueTime ? s.me.prefs.taskLeadMinutes : 0 }] : [] })} />
        Remind me {t.dueTime ? (remind && t.alerts[0].minutesBefore ? `${leadText(t.alerts[0].minutesBefore)} before` : 'at the due time') : `at ${s.me.prefs.dateOnlyTaskTime} on the due date`}
      </label>
      {remind && t.dueTime && (
        <select value={t.alerts[0].minutesBefore} onChange={(e) => set({ alerts: [{ minutesBefore: Number(e.target.value) }] })} aria-label="Reminder lead time">
          {[0, 5, 10, 15, 30, 60, 120, 1440].map((m) => <option key={m} value={m}>{m === 0 ? 'At due time' : `${leadText(m)} before`}</option>)}
        </select>
      )}
      {remind && !s.me.prefs.enabled && <p className="hint warn-text">Reminders are off in settings, so this won't fire yet.</p>}
      <label>Repeat
        <select value={rule?.freq ?? 'none'} onChange={(e) => setRule(e.target.value)} disabled={!t.dueDate}>
          <option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
        </select>
      </label>
      {rule && <p className="hint">{describeRecurrence(rule, t.dueDate ?? undefined)}. Completing it creates the next one.</p>}
      {s.data.goals.length > 0 && (
        <label>Counts toward goal
          <select value={t.goalId ?? ''} onChange={(e) => set({ goalId: e.target.value || null })}>
            <option value="">None</option>
            {s.data.goals.filter((g) => !g.archived).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </label>
      )}
      <label>Notes<textarea rows={3} value={t.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      {blocks.length > 0 && <p className="hint">⏱ {blocks.length} scheduled time block{blocks.length > 1 ? 's' : ''}. Scheduling never marks the to-do complete.</p>}
      {blocks.length === 0 && task && <button className="link small" onClick={() => void actions.scheduleTask(task, `${t.dueDate ?? s.selected}T${t.dueTime ?? '09:00'}`)}>Quick-block 1 hour</button>}
    </Modal>
  );
}
