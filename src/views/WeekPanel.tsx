import { useStore } from '../store.tsx';
import { addDays, startOfWeek } from '../../shared/dates.ts';
import { dayNum, monthShort, onColor, plural, shortDate, time12, weekdayShort } from '../lib/format.ts';

export function WeekPanel() {
  const s = useStore();
  const start = startOfWeek(s.selected, s.app.weekStartsOn);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const total = days.reduce((n, d) => n + s.eventsOn(d).length, 0);
  const tasksDue = s.tasks.filter((t) => !t.completed && t.due && t.due >= days[0] && t.due <= days[6]).length;
  const open = (d: string) => {
    s.setSelected(d);
    s.setPanel(0);
  };
  return (
    <section className="panel week-panel" aria-label={`Week of ${shortDate(start)}`}>
      <header className="hero hero-blue">
        <div className="hero-nav">
          <button className="round-btn light" onClick={() => s.setSelected(addDays(s.selected, -7))} aria-label="Previous week">‹</button>
          <div className="hero-kicker">{days.includes(s.today) ? 'This week' : 'Week'}</div>
          <button className="round-btn light" onClick={() => s.setSelected(addDays(s.selected, 7))} aria-label="Next week">›</button>
        </div>
        <div className="hero-title">
          <span className="hero-weekday">Week of</span>
          <span className="hero-big">{shortDate(start)} – {monthShort(days[6]) === monthShort(start) ? dayNum(days[6]) : shortDate(days[6])}</span>
        </div>
        <div className="hero-stats">
          <span className="stat">{plural(total, 'event')}</span>
          <span className="stat">{plural(tasksDue, 'to-do')} due</span>
        </div>
      </header>
      <div className="panel-body">
        <div className="week-grid">
          {days.map((d) => {
            const evs = s.eventsOn(d);
            const due = s.tasks.filter((t) => t.due === d && !t.completed).length;
            const isToday = d === s.today;
            return (
              <div key={d} className={`week-day ${isToday ? 'today' : ''} ${d === s.selected ? 'selected' : ''}`}>
                <button className="wd-head" onClick={() => open(d)} aria-label={`Open ${shortDate(d)}`}>
                  <span className="wd-name">{weekdayShort(d)}</span>
                  <span className="wd-num">{dayNum(d)}</span>
                  {due > 0 && <span className="wd-due">{plural(due, 'to-do')}</span>}
                </button>
                <div className="wd-events">
                  {evs.length === 0 && <button className="wd-empty" onClick={() => s.setSheet({ type: 'event', date: d })}>+ add</button>}
                  {evs.map((e) => {
                    const c = s.colorOf(e);
                    return (
                      <button key={e.id} className="wd-ev" style={{ background: c, color: onColor(c) }} onClick={() => s.setSheet({ type: 'event', event: e })}>
                        <span className="wd-ev-time">{e.allDay || !e.startLocal || e.startDate < d ? 'All day' : time12(e.startLocal)}</span>
                        <span className="wd-ev-title">{e.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
