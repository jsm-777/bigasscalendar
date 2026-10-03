import { useEffect, useState } from 'react';
import { useStore, type View } from '../store.tsx';
import { MONTH_NAMES, addDays, addMonths, monthKey, startOfWeek, formatLongDate, ymd, WEEKDAY_SHORT, weekday } from '../../shared/dates.ts';
import { computePushState, useNotifData, type PushState } from '../notifications.ts';
import { useIsPhone, weekSpan } from '../hooks.ts';

const VIEWS: { id: View; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

const short = (d: string) => `${MONTH_NAMES[Number(d.slice(5, 7)) - 1].slice(0, 3)} ${Number(d.slice(8))}`;

/** First day shown by the Week view (phones show 3 days starting at the selected date). */
export function weekStartFor(selected: string, phone: boolean, weekStartsOn: 1 | 7) {
  return phone ? selected : startOfWeek(selected, weekStartsOn);
}

function usePeriod() {
  const s = useStore();
  const phone = useIsPhone();
  const [y, m] = ymd(s.selected);
  const span = weekSpan(phone);
  let label: string;
  if (s.view === 'year') {
    const [a, b] = [s.range.months[0], s.range.months[11]];
    const yr = (k: string) => (phone ? `’${k.slice(2, 4)}` : k.slice(0, 4));
    label = `${MONTH_NAMES[Number(a.slice(5)) - 1].slice(0, 3)} ${yr(a)} – ${MONTH_NAMES[Number(b.slice(5)) - 1].slice(0, 3)} ${yr(b)}`;
  } else if (s.view === 'month') {
    label = `${phone ? MONTH_NAMES[m - 1].slice(0, 3) : MONTH_NAMES[m - 1]} ${y}`;
  } else if (s.view === 'week') {
    const ws = weekStartFor(s.selected, phone, s.me.settings.weekStartsOn ?? 7);
    const we = addDays(ws, span - 1);
    label = `${short(ws)} – ${short(we)}${phone ? '' : `, ${we.slice(0, 4)}`}`;
  } else {
    label = phone ? `${WEEKDAY_SHORT[weekday(s.selected) - 1]}, ${short(s.selected)}` : formatLongDate(s.selected);
  }
  const step = (dir: 1 | -1) => {
    if (s.view === 'year') {
      s.setRangeStart(monthKey(addMonths(`${s.rangeStart}-01`, 12 * dir)));
      s.setSelected(addMonths(s.selected, 12 * dir));
    } else if (s.view === 'month') s.setSelected(addMonths(s.selected, dir));
    else if (s.view === 'week') s.setSelected(addDays(s.selected, span * dir));
    else s.setSelected(addDays(s.selected, dir));
  };
  const unit = s.view === 'year' ? '12 months' : s.view === 'week' ? (phone ? '3 days' : 'week') : s.view;
  return { label, step, unit };
}

function useStatus() {
  const s = useStore();
  const notif = useNotifData();
  const [pushState, setPushState] = useState<PushState | null>(null);
  useEffect(() => {
    void computePushState(s.config.pushConfigured).then(setPushState);
  }, [s.config.pushConfigured, s.dialog]);
  const unread = notif?.items.filter((i) => !i.readAt).length ?? 0;
  const prefs = s.me.prefs;
  const text = !prefs.enabled ? 'Reminders off' : pushState === 'enabled' ? 'Reminders on · push' : 'Reminders on · in-app';
  const cls = !prefs.enabled ? 'off' : pushState === 'enabled' ? 'ok' : 'partial';
  return { unread, text, cls };
}

function ViewSwitch() {
  const s = useStore();
  return (
    <div className="seg views" role="group" aria-label="View">
      {VIEWS.map((v) => (
        <button key={v.id} className={s.view === v.id ? 'on' : ''} aria-pressed={s.view === v.id} onClick={() => s.setView(v.id)} title={`${v.label} view (${v.id[0].toUpperCase()})`}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

function WorkspaceSwitch({ compact }: { compact?: boolean }) {
  const s = useStore();
  const p = s.me.partner;
  if (compact) {
    if (!p) return null;
    return (
      <select className="ws-select" value={s.workspace} onChange={(e) => s.setWorkspace(e.target.value as typeof s.workspace)} aria-label="Whose calendar">
        <option value="me">{s.me.user.displayName}</option>
        <option value="partner">{p.displayName}</option>
        <option value="together">Together</option>
      </select>
    );
  }
  return (
    <div className="seg" role="group" aria-label="Whose calendar">
      <button className={s.workspace === 'me' ? 'on' : ''} aria-pressed={s.workspace === 'me'} onClick={() => s.setWorkspace('me')}>{s.me.user.displayName}</button>
      {p ? (
        <>
          <button className={s.workspace === 'partner' ? 'on' : ''} aria-pressed={s.workspace === 'partner'} onClick={() => s.setWorkspace('partner')} title="Shows only calendars they share with you">{p.displayName}</button>
          <button className={s.workspace === 'together' ? 'on' : ''} aria-pressed={s.workspace === 'together'} onClick={() => s.setWorkspace('together')}>Together</button>
        </>
      ) : (
        <button onClick={() => s.setDialog({ type: 'settings', tab: 'account' })} title="Invite someone to compare schedules">+ Invite</button>
      )}
    </div>
  );
}

export function Header({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const s = useStore();
  const phone = useIsPhone();
  const { label, step, unit } = usePeriod();
  const status = useStatus();

  if (phone) {
    return (
      <header className="header phone">
        <div className="ph-row">
          <button className="icon-btn" onClick={() => step(-1)} aria-label={`Previous ${unit}`}>‹</button>
          <label className="ph-label">
            <span aria-live="polite">{label}</span>
            <input type="date" className="ph-date" aria-label="Go to date" value={s.selected} onChange={(e) => e.target.value && s.setSelected(e.target.value)} />
          </label>
          <button className="icon-btn" onClick={() => step(1)} aria-label={`Next ${unit}`}>›</button>
          <button className="btn small" onClick={s.goToday}>Today</button>
          <span className="grow" />
          {s.undoLabel && <button className="icon-btn" onClick={() => void s.undo()} aria-label={`Undo: ${s.undoLabel}`}>↶</button>}
          <WorkspaceSwitch compact />
          <button className="icon-btn" onClick={() => s.setDialog({ type: 'search' })} aria-label="Search">⌕</button>
        </div>
        <ViewSwitch />
      </header>
    );
  }

  return (
    <header className="header">
      <h1 className="brand">Big Ass Calendar</h1>
      <div className="nav">
        <button className="icon-btn" onClick={() => step(-1)} aria-label={`Previous ${unit}`} title={`Previous ${unit}`}>‹</button>
        <button className="icon-btn" onClick={() => step(1)} aria-label={`Next ${unit}`} title={`Next ${unit}`}>›</button>
        <span className="range-label" aria-live="polite">{label}</span>
        <input type="date" className="date-pick" aria-label="Go to date" value={s.selected} onChange={(e) => e.target.value && s.setSelected(e.target.value)} />
        <button className="btn" onClick={s.goToday} title="Select today and bring it into view (T)">Today</button>
      </div>
      <span className="grow" />
      <ViewSwitch />
      <WorkspaceSwitch />
      <div className="h-actions">
        {s.undoLabel && <button className="btn ghost small" onClick={() => void s.undo()} title={`Undo: ${s.undoLabel} (Ctrl/⌘+Z)`}>↶ Undo</button>}
        <button className="btn primary" onClick={() => s.setDialog({ type: 'add' })}>+ Add</button>
        <button className="tool-btn" onClick={() => s.setDialog({ type: 'search' })} title="Search (/)" aria-label="Search"><span aria-hidden>⌕</span><span className="tool-label">Search</span></button>
        <button className="tool-btn" onClick={() => s.setDialog({ type: 'planner' })} title="Plan with chat or import a plan" aria-label="Plan"><span aria-hidden>✦</span><span className="tool-label">Plan</span></button>
        <button className={`tool-btn notif-btn ${status.cls}`} onClick={() => s.setDialog({ type: 'notifications' })} aria-label={`Notifications: ${status.text}${status.unread ? `, ${status.unread} unread` : ''}`} title={status.text}>
          <span aria-hidden>🔔</span>
          <span className="tool-label notif-status">{status.text}</span>
          {status.unread > 0 && <span className="badge">{status.unread}</span>}
        </button>
        <button className="tool-btn" onClick={() => s.setDialog({ type: 'settings' })} title="Settings" aria-label="Settings"><span aria-hidden>⚙</span><span className="tool-label">Settings</span></button>
        <button className={`tool-btn ${sidebarOpen ? 'on' : ''}`} onClick={onToggleSidebar} aria-pressed={sidebarOpen} aria-label="Today panel" title={sidebarOpen ? 'Hide the daily dashboard' : 'Show the daily dashboard'}>
          <span aria-hidden>▤</span><span className="tool-label">Today panel</span>
        </button>
      </div>
    </header>
  );
}

/** Phone bottom navigation. */
export function BottomBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const s = useStore();
  const status = useStatus();
  const showBoard = () => sidebarOpen && onToggleSidebar();
  return (
    <nav className="bottom-bar" aria-label="Main">
      <button className={!sidebarOpen ? 'on' : ''} onClick={showBoard} aria-current={!sidebarOpen}><span aria-hidden>▦</span>Board</button>
      <button className={sidebarOpen ? 'on' : ''} onClick={() => !sidebarOpen && onToggleSidebar()} aria-current={sidebarOpen}><span aria-hidden>☀</span>Today</button>
      <button className="bb-add" onClick={() => s.setDialog({ type: 'add' })} aria-label="Add"><span aria-hidden>+</span></button>
      <button onClick={() => s.setDialog({ type: 'notifications' })} aria-label={`Alerts: ${status.text}${status.unread ? `, ${status.unread} unread` : ''}`}>
        <span aria-hidden className={`bb-dot ${status.cls}`}>🔔</span>Alerts{status.unread > 0 && <span className="badge">{status.unread}</span>}
      </button>
      <button onClick={() => s.setDialog({ type: 'settings' })}><span aria-hidden>⚙</span>Settings</button>
    </nav>
  );
}
