import { useEffect, useState } from 'react';
import { useStore } from '../store.tsx';
import type { Ev, Task } from '../../shared/types.ts';
import { addDays, nowLocal } from '../../shared/dates.ts';
import { goalProgress, STREAK_RULES } from '../../shared/streaks.ts';
import { dayNum, monthShort, onColor, plural, relativeDay, shortDate, time12, timeParts, weekdayLong } from '../lib/format.ts';

export function DayPanel() {
  const s = useStore();
  const d = s.selected;
  const evs = s.eventsOn(d);
  const allDay = evs.filter((e) => e.allDay || (e.startDate < d && e.endDate > d));
  const timed = evs.filter((e) => !allDay.includes(e));
  const dueToday = s.tasks.filter((t) => t.due === d);
  const open = dueToday.filter((t) => !t.completed).length;

  return (
    <section className="panel day-panel" aria-label={`Day: ${weekdayLong(d)}, ${shortDate(d)}`}>
      <header className="hero hero-coral">
        <div className="hero-nav">
          <button className="round-btn light" onClick={() => s.setSelected(addDays(d, -1))} aria-label="Previous day">‹</button>
          <div className="hero-kicker">{relativeDay(d, s.today)}</div>
          <button className="round-btn light" onClick={() => s.setSelected(addDays(d, 1))} aria-label="Next day">›</button>
        </div>
        <div className="hero-title">
          <span className="hero-weekday">{weekdayLong(d)}</span>
          <span className="hero-big">{monthShort(d)} {dayNum(d)}</span>
        </div>
        <div className="hero-stats">
          <span className="stat">{plural(evs.length, 'event')}</span>
          <span className="stat">{plural(open, 'to-do')} left</span>
          {d !== s.today && <button className="stat stat-btn" onClick={s.goToday}>Back to today</button>}
        </div>
      </header>

      <div className="panel-body">
        {allDay.length > 0 && (
          <div className="allday-strip">
            {allDay.map((e) => <EventPill key={e.id} e={e} />)}
          </div>
        )}

        <Card title="Schedule" action={{ label: '+ Event', run: () => s.setSheet({ type: 'event', date: d }) }}>
          {s.loading ? (
            <div className="skeleton-list" aria-busy="true"><div /><div /><div /></div>
          ) : timed.length === 0 ? (
            <p className="empty">{allDay.length ? 'No timed events.' : 'Nothing planned. Tap + to add something.'}</p>
          ) : (
            <Timeline events={timed} />
          )}
        </Card>

        <TodoCard />
        <GoalsCard />
        <NoteCard />
      </div>
    </section>
  );
}

function Card({ title, action, children, tone }: { title: string; action?: { label: string; run: () => void }; children: React.ReactNode; tone?: string }) {
  return (
    <section className={`card ${tone ?? ''}`}>
      <div className="card-head">
        <h3>{title}</h3>
        {action && <button className="chip-btn" onClick={action.run}>{action.label}</button>}
      </div>
      {children}
    </section>
  );
}

function EventPill({ e }: { e: Ev }) {
  const s = useStore();
  const c = s.colorOf(e);
  return (
    <button className="pill" style={{ background: c, color: onColor(c) }} onClick={() => s.setSheet({ type: 'event', event: e })}>
      {e.title}
      {e.endDate > e.startDate && <span className="pill-sub"> · until {shortDate(e.endDate)}</span>}
    </button>
  );
}

function Timeline({ events }: { events: Ev[] }) {
  const s = useStore();
  const [now, setNow] = useState(() => nowLocal(s.tz));
  useEffect(() => {
    const t = setInterval(() => setNow(nowLocal(s.tz)), 60_000);
    return () => clearInterval(t);
  }, [s.tz]);
  const isToday = s.selected === s.today;
  const nowIndex = isToday ? events.findIndex((e) => (e.startLocal ?? '') > now) : -2;
  return (
    <ol className="timeline">
      {events.map((e, i) => {
        const c = s.colorOf(e);
        const fg = onColor(c);
        const [t, ap] = e.startLocal && e.startDate === s.selected ? timeParts(e.startLocal) : ['…', ''];
        const past = isToday && (e.endLocal ?? '') < now;
        return [
          i === nowIndex && <li key="now" className="now-row"><div className="now-line" aria-label="Now"><span>now</span></div></li>,
          <li key={e.id} className={past ? 'past' : ''}>
            <div className="tl-time"><b>{t}</b><small>{ap}</small></div>
            <button className="tl-card" style={{ background: c, color: fg }} onClick={() => s.setSheet({ type: 'event', event: e })}>
              <span className="tl-title">{e.title}</span>
              <span className="tl-sub">
                {e.startLocal && e.endLocal ? `${time12(e.startLocal)} – ${time12(e.endLocal)}` : ''}
                {e.location ? ` · ${e.location}` : ''}
                {e.recurringEventId ? ' · repeats' : ''}
              </span>
              <span className="tl-cal">{s.calById.get(e.calendarId)?.summary}</span>
            </button>
          </li>,
        ];
      })}
      {nowIndex === -1 && <li className="now-row"><div className="now-line"><span>now</span></div></li>}
    </ol>
  );
}

function TaskRow({ t, tag }: { t: Task; tag?: string }) {
  const s = useStore();
  return (
    <li className={`todo ${t.completed ? 'done' : ''}`}>
      <button className="check" role="checkbox" aria-checked={t.completed} aria-label={`${t.completed ? 'Mark not done' : 'Mark done'}: ${t.title}`} onClick={() => void s.toggleTask(t)}>
        {t.completed ? '✓' : ''}
      </button>
      <button className="todo-title" onClick={() => s.setSheet({ type: 'task', task: t })}>
        {t.title}
        {tag && <span className="tag">{tag}</span>}
      </button>
    </li>
  );
}

function TodoCard() {
  const s = useStore();
  const d = s.selected;
  const [showSomeday, setShowSomeday] = useState(false);
  const due = s.tasks.filter((t) => t.due === d).sort((a, b) => Number(a.completed) - Number(b.completed));
  const overdue = d === s.today ? s.tasks.filter((t) => !t.completed && t.due && t.due < d) : [];
  const someday = s.tasks.filter((t) => !t.completed && !t.due);
  return (
    <Card title="To-dos" action={{ label: '+ To-do', run: () => s.setSheet({ type: 'task', date: d }) }}>
      {overdue.length > 0 && (
        <>
          <h4 className="sub warn">Overdue</h4>
          <ul className="todos">{overdue.map((t) => <TaskRow key={t.id} t={t} tag={shortDate(t.due!)} />)}</ul>
        </>
      )}
      {due.length === 0 && overdue.length === 0 && <p className="empty">No to-dos due {d === s.today ? 'today' : 'this day'}.</p>}
      {due.length > 0 && <ul className="todos">{due.map((t) => <TaskRow key={t.id} t={t} />)}</ul>}
      {someday.length > 0 && (
        <>
          <button className="sub sub-btn" onClick={() => setShowSomeday(!showSomeday)} aria-expanded={showSomeday}>
            No date ({someday.length}) {showSomeday ? '▾' : '▸'}
          </button>
          {showSomeday && <ul className="todos">{someday.map((t) => <TaskRow key={t.id} t={t} />)}</ul>}
        </>
      )}
      <p className="hint">Synced with Google Tasks.</p>
    </Card>
  );
}

function GoalsCard() {
  const s = useStore();
  const d = s.selected;
  const goals = s.app.goals.filter((g) => !g.archived);
  const checkIn = (goalId: string, again = false) => {
    s.updateApp((a) => {
      const key = again ? `${goalId}:${d}:${Date.now()}` : `${goalId}:${d}`;
      if (a.checkIns.some((c) => c.clientKey === key)) return a; // idempotent
      return { ...a, checkIns: [...a.checkIns, { id: crypto.randomUUID(), goalId, date: d, note: '', clientKey: key }] };
    });
  };
  const undo = (goalId: string) => s.updateApp((a) => {
    const mine = a.checkIns.filter((c) => c.goalId === goalId && c.date === d);
    const last = mine[mine.length - 1];
    return last ? { ...a, checkIns: a.checkIns.filter((c) => c.id !== last.id) } : a;
  });
  return (
    <Card title="Goals" action={{ label: '+ Goal', run: () => s.setSheet({ type: 'goal' }) }}>
      {goals.length === 0 ? (
        <p className="empty">Set a goal like “Workout 3× a week” and check in to build a streak.</p>
      ) : (
        <div className="goal-tiles">
          {goals.map((g) => {
            const p = goalProgress(g, s.app.checkIns, s.today);
            const n = s.app.checkIns.filter((c) => c.goalId === g.id && c.date === d).length;
            const fg = onColor(g.color);
            return (
              <div key={g.id} className="goal-tile" style={{ background: g.color, color: fg }}>
                <button className="goal-name" onClick={() => s.setSheet({ type: 'goal', goalId: g.id })} style={{ color: fg }}>{g.title}</button>
                <div className="goal-streak" title={g.mode === 'weekly' ? STREAK_RULES.weekly : STREAK_RULES.daily}>
                  <span className="flame" aria-hidden>🔥</span>
                  <b>{p.streak}</b>
                  <small>{g.mode === 'weekly' ? `week${p.streak === 1 ? '' : 's'}` : `day${p.streak === 1 ? '' : 's'}`}</small>
                </div>
                <div className="goal-bar" aria-label={`${p.thisWeek} of ${p.target} this week`}>
                  {Array.from({ length: p.target }, (_, i) => <span key={i} className={i < p.thisWeek ? 'on' : ''} />)}
                </div>
                {d > s.today ? (
                  <span className="goal-note">Check in on the day</span>
                ) : n === 0 ? (
                  <button className="goal-check" onClick={() => checkIn(g.id)} style={{ color: g.color }}>Check in</button>
                ) : (
                  <div className="goal-done">
                    <span>✓ Done{n > 1 ? ` ×${n}` : ''}</span>
                    <button onClick={() => checkIn(g.id, true)} style={{ color: fg }} aria-label="Log another session">+1</button>
                    <button onClick={() => undo(g.id)} style={{ color: fg }} aria-label="Undo check-in">Undo</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function NoteCard() {
  const s = useStore();
  const d = s.selected;
  const [text, setText] = useState(s.app.dayNotes[d] ?? '');
  const stored = s.app.dayNotes[d] ?? '';
  // Follow the stored note (date change, initial Drive load) unless the user is typing.
  useEffect(() => {
    if ((document.activeElement as HTMLElement | null)?.getAttribute('aria-label') !== 'Daily note') setText(stored);
  }, [d, stored]);
  const save = (v: string) => {
    setText(v);
    s.updateApp((a) => {
      const dayNotes = { ...a.dayNotes };
      if (v.trim()) dayNotes[d] = v;
      else delete dayNotes[d];
      return { ...a, dayNotes };
    });
  };
  return (
    <section className="card note-card">
      <div className="card-head"><h3>Note</h3><SaveStatus /></div>
      <textarea value={text} onChange={(e) => save(e.target.value)} placeholder="Anything to remember about this day…" rows={4} aria-label="Daily note" />
    </section>
  );
}

export function SaveStatus() {
  const s = useStore();
  if (s.appStatus === 'saving') return <span className="save-status">Saving…</span>;
  if (s.appStatus === 'saved') return <span className="save-status">Saved{s.backend.kind === 'google' ? ' to Drive' : ''}</span>;
  if (s.appStatus === 'error') return <button className="save-status error" onClick={s.retryAppSave}>Not saved · Retry</button>;
  return null;
}
