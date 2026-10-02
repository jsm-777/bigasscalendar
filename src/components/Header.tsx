import { useEffect, useState } from 'react';
import { useStore, type View } from '../store.tsx';
import { MONTH_NAMES, addDays, addMonths, monthKey, startOfWeek, formatLongDate, ymd } from '../../shared/dates.ts';
import { computePushState, useNotifData, type PushState } from '../notifications.ts';

const VIEWS: { id: View; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

export function Header({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const s = useStore();
  const notif = useNotifData();
  const [pushState, setPushState] = useState<PushState | null>(null);
  const unread = notif?.items.filter((i) => !i.readAt).length ?? 0;

  useEffect(() => {
    void computePushState(s.config.pushConfigured).then(setPushState);
  }, [s.config.pushConfigured, s.dialog]);

  const label = (() => {
    const [y, m] = ymd(s.selected);
    if (s.view === 'year') {
      const [a, b] = [s.range.months[0], s.range.months[11]];
      return `${MONTH_NAMES[Number(a.slice(5)) - 1].slice(0, 3)} ${a.slice(0, 4)} – ${MONTH_NAMES[Number(b.slice(5)) - 1].slice(0, 3)} ${b.slice(0, 4)}`;
    }
    if (s.view === 'month') return `${MONTH_NAMES[m - 1]} ${y}`;
    if (s.view === 'week') {
      const ws = startOfWeek(s.selected, s.me.settings.weekStartsOn ?? 7);
      const we = addDays(ws, 6);
      return `${MONTH_NAMES[Number(ws.slice(5, 7)) - 1].slice(0, 3)} ${Number(ws.slice(8))} – ${MONTH_NAMES[Number(we.slice(5, 7)) - 1].slice(0, 3)} ${Number(we.slice(8))}, ${we.slice(0, 4)}`;
    }
    return formatLongDate(s.selected);
  })();

  const step = (dir: 1 | -1) => {
    if (s.view === 'year') {
      const next = monthKey(addMonths(`${s.rangeStart}-01`, 12 * dir));
      s.setRangeStart(next);
      const sel = addMonths(s.selected, 12 * dir);
      s.setSelected(sel);
    } else if (s.view === 'month') s.setSelected(addMonths(s.selected, dir));
    else if (s.view === 'week') s.setSelected(addDays(s.selected, 7 * dir));
    else s.setSelected(addDays(s.selected, dir));
  };

  const prefs = s.me.prefs;
  const statusText = !prefs.enabled ? 'Reminders off' : pushState === 'enabled' ? 'Reminders on · push' : 'Reminders on · in-app';
  const statusClass = !prefs.enabled ? 'off' : pushState === 'enabled' ? 'ok' : 'partial';

  return (
    <header className="header">
      <div className="h-left">
        <h1 className="brand">Big Ass Calendar</h1>
        <div className="nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label={`Previous ${s.view === 'year' ? '12 months' : s.view}`}>‹</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label={`Next ${s.view === 'year' ? '12 months' : s.view}`}>›</button>
          <span className="range-label" aria-live="polite">{label}</span>
          <input
            type="date"
            className="date-pick"
            aria-label="Go to date"
            value={s.selected}
            onChange={(e) => e.target.value && s.setSelected(e.target.value)}
          />
          <button className="btn" onClick={s.goToday} title="Select today and bring it into view (T)">Today</button>
        </div>
      </div>
      <div className="h-mid">
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} className={s.view === v.id ? 'on' : ''} aria-pressed={s.view === v.id} onClick={() => s.setView(v.id)} title={`${v.label} view (${v.id[0].toUpperCase()})`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Whose calendar">
          <button className={s.workspace === 'me' ? 'on' : ''} aria-pressed={s.workspace === 'me'} onClick={() => s.setWorkspace('me')}>{s.me.user.displayName}</button>
          {s.me.partner ? (
            <>
              <button className={s.workspace === 'partner' ? 'on' : ''} aria-pressed={s.workspace === 'partner'} onClick={() => s.setWorkspace('partner')} title="Shows only calendars they share with you">{s.me.partner.displayName}</button>
              <button className={s.workspace === 'together' ? 'on' : ''} aria-pressed={s.workspace === 'together'} onClick={() => s.setWorkspace('together')}>Together</button>
            </>
          ) : (
            <button onClick={() => s.setDialog({ type: 'settings', tab: 'account' })} title="Invite someone to compare schedules">+ Invite</button>
          )}
        </div>
      </div>
      <div className="h-right">
        {s.undoLabel && (
          <button className="btn ghost small" onClick={() => void s.undo()} title={`Undo: ${s.undoLabel} (Ctrl/⌘+Z)`}>↶ Undo</button>
        )}
        <button className="btn primary" onClick={() => s.setDialog({ type: 'add' })}>+ Add</button>
        <button className="icon-btn" onClick={() => s.setDialog({ type: 'search' })} aria-label="Search (/)" title="Search (/)">⌕</button>
        <button className="icon-btn" onClick={() => s.setDialog({ type: 'planner' })} aria-label="Plan with chat or import" title="Planner">✦</button>
        <button className={`notif-btn ${statusClass}`} onClick={() => s.setDialog({ type: 'notifications' })} aria-label={`Notifications: ${statusText}${unread ? `, ${unread} unread` : ''}`} title={statusText}>
          <span aria-hidden>🔔</span>
          <span className="notif-status">{statusText}</span>
          {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        <button className="icon-btn" onClick={() => s.setDialog({ type: 'settings' })} aria-label="Settings" title="Settings">⚙</button>
        <button className="icon-btn sidebar-toggle" onClick={onToggleSidebar} aria-pressed={sidebarOpen} aria-label={sidebarOpen ? 'Hide daily dashboard' : 'Show daily dashboard'} title="Daily dashboard">▤</button>
      </div>
    </header>
  );
}
