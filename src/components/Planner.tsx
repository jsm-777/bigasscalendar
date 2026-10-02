import { useState } from 'react';
import { useStore } from '../store.tsx';
import { api } from '../api.ts';
import { planSchema, type Plan } from '../../shared/schemas.ts';
import { Modal } from './Modal.tsx';
import { addDays } from '../../shared/dates.ts';

interface PreviewItem { index: number; op: string; description: string; destination: string; conflicts: string[]; error: string | null }
interface Preview { summary: string; questions: string[]; items: PreviewItem[] }

const exampleFor = (date: string) => JSON.stringify({
  version: 1,
  summary: 'Example: one workout and a bill reminder',
  operations: [
    { op: 'create_event', calendar: 'Workouts', title: 'Workout', date, start: '06:30', end: '07:15', alertMinutesBefore: [15] },
    { op: 'create_task', title: 'Pay phone bill', dueDate: addDays(date, 3), remind: true },
  ],
}, null, 2);

export function PlannerDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState<'chat' | 'import'>(s.config.assistant ? 'chat' : 'import');
  const [json, setJson] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [source, setSource] = useState<'import' | 'assistant'>('import');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const doPreview = async (p: Plan, src: 'import' | 'assistant') => {
    setPlan(p);
    setSource(src);
    setApplied(null);
    setPreview(await api<Preview>('POST', '/api/plan/preview', { plan: p }));
  };

  const fromJson = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return setError('That is not valid JSON.');
    }
    const r = planSchema.safeParse(parsed);
    if (!r.success) {
      const i = r.error.issues[0];
      return setError(`Plan is not valid: ${i.path.join('.')} ${i.message}`);
    }
    setBusy(true);
    try {
      await doPreview(r.data, 'import');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ plan: Plan; raw: string }>('POST', '/api/plan/draft', { message, history });
      setHistory([...history, { role: 'user', content: message }, { role: 'assistant', content: r.raw }]);
      setMessage('');
      await doPreview(r.plan, 'assistant');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ proposalId: string }>('POST', '/api/plan/apply', { plan, source });
      setApplied(r.proposalId);
      await s.reload();
      s.toast(`Applied ${plan.operations.length} change${plan.operations.length === 1 ? '' : 's'}.`, 'info', { label: 'Undo', run: () => void undoPlan(r.proposalId) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const undoPlan = async (id: string) => {
    try {
      const r = await api<{ conflicts: string[] }>('POST', `/api/plan/${id}/undo`);
      await s.reload();
      s.toast(r.conflicts.length ? `Undone, except: ${r.conflicts.join(' ')}` : 'Plan undone.', r.conflicts.length ? 'error' : 'info');
      setApplied(null);
    } catch (e) {
      s.toast((e as Error).message, 'error');
    }
  };

  const hasErrors = preview?.items.some((i) => i.error);

  return (
    <Modal title="Plan" onClose={onClose} wide footer={
      <>
        {applied && <button className="btn ghost" onClick={() => void undoPlan(applied)}>Undo this plan</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn primary" disabled={!preview || !!hasErrors || busy || !!applied || !plan?.operations.length} onClick={() => void apply()}>
          {applied ? 'Applied' : `Apply ${plan?.operations.length ?? 0} change${plan?.operations.length === 1 ? '' : 's'}`}
        </button>
      </>
    }>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Describe a plan</button>
        <button role="tab" aria-selected={tab === 'import'} className={tab === 'import' ? 'on' : ''} onClick={() => setTab('import')}>Import JSON plan</button>
      </div>
      {tab === 'chat' && (
        s.config.assistant ? (
          <div className="stack">
            <p className="hint">The assistant drafts changes for you to review; nothing changes until you press Apply. It sees your schedule for the next ~6 weeks, your calendars and open to-dos, and your planning constraints. This is the in-app assistant, separate from any chat outside the app.</p>
            {history.filter((h) => h.role === 'user').map((h, i) => <div key={i} className="chat-user">{h.content}</div>)}
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Add three workouts next week, avoiding my work hours." onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask(); }} />
            <button className="btn" onClick={() => void ask()} disabled={busy || !message.trim()}>{busy ? 'Thinking…' : 'Draft plan'}</button>
          </div>
        ) : (
          <div className="notice">
            <p><strong>The in-app assistant isn't connected yet.</strong> It needs an Anthropic API key configured on the server (<code>ANTHROPIC_API_KEY</code> in <code>.env</code>); keys are never put in the browser.</p>
            <p>You can still plan with any chat tool: ask it to produce a plan in the JSON format shown in the Import tab, then paste it there to preview and apply.</p>
          </div>
        )
      )}
      {tab === 'import' && (
        <div className="stack">
          <p className="hint">Paste a plan (version 1). It is validated, previewed with conflicts and destinations, and only applied when you press Apply.</p>
          <textarea className="mono" rows={10} value={json} onChange={(e) => setJson(e.target.value)} placeholder={exampleFor(s.selected)} spellCheck={false} />
          <div className="row">
            <button className="btn" onClick={() => void fromJson()} disabled={busy || !json.trim()}>Preview</button>
            <button className="btn ghost" onClick={() => setJson(exampleFor(s.selected))}>Insert example</button>
          </div>
          <details>
            <summary className="small">Operation reference</summary>
            <pre className="mono small">{`create_event  calendar, title, date, start?, end?, endDate?, allDay?, location?, notes?, recurrence?, alertMinutesBefore?
move_event    eventId, occurrenceDate?, scope? (this|following|all), newDate?, newStart?
resize_event  eventId, occurrenceDate?, scope?, newEnd
delete_event  eventId, occurrenceDate?, scope?
set_event_alert eventId, minutesBefore[]
create_task   title, list?, dueDate?, dueTime?, priority? (0-3), notes?, remind?
complete_task taskId
set_task_due  taskId, dueDate|null, dueTime?
Dates YYYY-MM-DD and times HH:mm, in your time zone (${s.tz}).`}</pre>
          </details>
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      {preview && (
        <section className="preview">
          <h3 className="small-head">Preview</h3>
          {preview.summary && <p>{preview.summary}</p>}
          {preview.questions.length > 0 && (
            <div className="notice">
              <strong>Needs your input:</strong>
              <ul>{preview.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              {s.config.assistant && tab === 'chat' && <p className="hint">Answer above and draft again.</p>}
            </div>
          )}
          {preview.items.length === 0 ? <p className="quiet">No changes proposed.</p> : (
            <ol className="preview-list">
              {preview.items.map((i) => (
                <li key={i.index} className={i.error ? 'bad' : ''}>
                  <div>{i.description || i.op}{i.destination && <span className="tag">{i.destination}</span>}</div>
                  {i.error && <div className="error-text small">✕ {i.error}</div>}
                  {i.conflicts.map((c, k) => <div key={k} className="warn-text small">⚠ {c}</div>)}
                </li>
              ))}
            </ol>
          )}
          {hasErrors && <p className="error-text small">Fix or remove the failing operations before applying.</p>}
        </section>
      )}
    </Modal>
  );
}
