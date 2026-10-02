import { useEffect, useState } from 'react';
import { useStore, type Settings } from '../store.tsx';
import { api, newId } from '../api.ts';
import type { Calendar, ShareLevel } from '../../shared/types.ts';
import { MONTH_NAMES, monthKey, addMonths } from '../../shared/dates.ts';
import { Modal } from './Modal.tsx';
import { NotificationPrefsForm } from './NotificationCenter.tsx';

const TABS = [
  ['calendars', 'Calendars'],
  ['account', 'Account & sharing'],
  ['notifications', 'Reminders'],
  ['display', 'Display'],
  ['planning', 'Planning'],
  ['data', 'Data'],
] as const;

const SHARE_TEXT: Record<ShareLevel, string> = {
  private: 'Private',
  freebusy: 'Free/busy only',
  details: 'See details',
  edit: 'Can edit',
};

export function SettingsDialog({ initialTab, onClose }: { initialTab?: string; onClose: () => void }) {
  const [tab, setTab] = useState(initialTab ?? 'calendars');
  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'calendars' && <CalendarsTab />}
        {tab === 'account' && <AccountTab />}
        {tab === 'notifications' && <NotificationPrefsForm />}
        {tab === 'display' && <DisplayTab />}
        {tab === 'planning' && <PlanningTab />}
        {tab === 'data' && <DataTab />}
      </div>
    </Modal>
  );
}

async function saveSettings(s: ReturnType<typeof useStore>, patch: Settings) {
  try {
    await api('PUT', '/api/settings', patch);
    await s.reloadMe();
  } catch (e) {
    s.toast((e as Error).message, 'error');
  }
}

function CalendarsTab() {
  const s = useStore();
  const own = s.data.calendars.filter((c) => c.access === 'owner');
  const shared = s.data.calendars.filter((c) => c.access !== 'owner');
  const missing = s.config.templates.filter((t) => !own.some((c) => c.name.toLowerCase() === t.name.toLowerCase()));
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0ea5e9');

  const add = async (n: string, c: string) => {
    await s.saveCalendar({ id: newId(), ownerId: s.me.user.id, name: n, color: c, archived: false, visible: true, shareLevel: 'private', access: 'owner', version: 0 }, true);
  };

  return (
    <div className="settings-section">
      <h3>Your calendars</h3>
      {own.length === 0 && <p className="quiet">No calendars yet. Start from a template or create your own. Templates add an empty calendar — no events.</p>}
      <ul className="cal-list">
        {own.map((c) => <CalendarRow key={c.id} c={c} />)}
      </ul>
      {missing.length > 0 && (
        <div className="templates">
          <span className="muted small">Templates:</span>
          {missing.map((t) => (
            <button key={t.name} className="btn small" onClick={() => void add(t.name, t.color)}>
              <span className="dot" style={{ background: t.color }} /> {t.name}
            </button>
          ))}
        </div>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { void add(name.trim(), color); setName(''); } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New calendar name" aria-label="New calendar name" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color" />
        <button className="btn">Add calendar</button>
      </form>
      <p className="hint">Sharing applies to your connected partner only. New calendars are private. “Free/busy” shows time blocks as Busy without titles, notes or locations. Showing or hiding a calendar only affects your own view.</p>
      {shared.length > 0 && (
        <>
          <h3>Shared with you</h3>
          <ul className="cal-list">
            {shared.map((c) => (
              <li key={c.id} className="cal-row">
                <input type="checkbox" checked={c.visible} onChange={(e) => void s.setCalendarVisible(c, e.target.checked)} aria-label={`Show ${c.name}`} />
                <span className="dot" style={{ background: c.color }} />
                <span className="grow">{c.name} <span className="muted small">· {s.personName(c.ownerId)} · {SHARE_TEXT[c.access as ShareLevel]}</span></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CalendarRow({ c }: { c: Calendar }) {
  const s = useStore();
  const [name, setName] = useState(c.name);
  useEffect(() => setName(c.name), [c.name]);
  const update = (patch: Partial<Calendar>) => void s.saveCalendar({ ...c, ...patch });
  return (
    <li className={`cal-row ${c.archived ? 'archived' : ''}`}>
      <input type="checkbox" checked={c.visible} onChange={(e) => void s.setCalendarVisible(c, e.target.checked)} aria-label={`Show ${c.name}`} title="Show on board" />
      <input type="color" value={c.color} onChange={(e) => update({ color: e.target.value })} aria-label={`${c.name} color`} />
      <input className="grow" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== c.name && update({ name: name.trim() })} aria-label="Calendar name" />
      {s.me.partner && (
        <select value={c.shareLevel} onChange={(e) => update({ shareLevel: e.target.value as ShareLevel })} aria-label={`Sharing for ${c.name}`}>
          {(Object.keys(SHARE_TEXT) as ShareLevel[]).map((l) => <option key={l} value={l}>{SHARE_TEXT[l]}</option>)}
        </select>
      )}
      <button className="btn small ghost" onClick={() => update({ archived: !c.archived })}>{c.archived ? 'Unarchive' : 'Archive'}</button>
    </li>
  );
}

function AccountTab() {
  const s = useStore();
  const [name, setName] = useState(s.me.user.displayName);
  const [tz, setTz] = useState(s.me.user.tz);
  const [link, setLink] = useState<string | null>(null);
  const [invites, setInvites] = useState<{ id: string; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null }[]>([]);
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [tz];

  const loadInvites = () => api<typeof invites>('GET', '/api/invitations').then(setInvites).catch(() => undefined);
  useEffect(() => {
    void loadInvites();
  }, []);

  const saveProfile = async () => {
    try {
      await api('PATCH', '/api/me', { displayName: name, tz });
      await s.reloadMe();
      s.toast('Profile saved.');
    } catch (e) {
      s.toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="settings-section">
      <h3>Profile</h3>
      <div className="row">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Time zone
          <select value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</select>
        </label>
      </div>
      <p className="hint">Signed in as {s.me.user.email}. Your time zone drives “today”, streaks and reminder times.</p>
      <button className="btn" onClick={saveProfile}>Save profile</button>

      <h3>Together</h3>
      {s.me.partner ? (
        <>
          <p>Connected with <strong>{s.me.partner.displayName}</strong> ({s.me.partner.tz}). Each of you controls what the other sees per calendar (Calendars tab). Notes and reminders are never shared.</p>
          <button className="btn danger ghost" onClick={async () => {
            if (!confirm(`Disconnect from ${s.me.partner!.displayName}? Shared calendars stop being visible to both of you.`)) return;
            await api('DELETE', '/api/partnership');
            await s.reloadMe();
            s.setWorkspace('me');
            void s.reload();
          }}>Disconnect</button>
        </>
      ) : (
        <>
          <p>Invite someone to keep their own private account and compare schedules side by side. The app does not send anything — copy the link and share it yourself. Links expire after 7 days and work once.</p>
          <button className="btn" onClick={async () => {
            try {
              const r = await api<{ link: string }>('POST', '/api/invitations', {});
              setLink(r.link);
              void loadInvites();
            } catch (e) {
              s.toast((e as Error).message, 'error');
            }
          }}>Create invitation link</button>
          {link && (
            <div className="invite-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
              <button className="btn small" onClick={() => void navigator.clipboard?.writeText(link).then(() => s.toast('Link copied.'))}>Copy</button>
            </div>
          )}
          {invites.filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > new Date().toISOString()).length > 0 && (
            <ul className="sb-list">
              {invites.filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > new Date().toISOString()).map((i) => (
                <li key={i.id} className="sb-item static">
                  <span className="sb-text small">Pending invite · expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                  <button className="link small" onClick={async () => { await api('DELETE', `/api/invitations/${i.id}`); void loadInvites(); }}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <h3>Session</h3>
      <button className="btn ghost" onClick={async () => { await api('POST', '/api/auth/logout'); location.href = '/'; }}>Sign out</button>
    </div>
  );
}

function DisplayTab() {
  const s = useStore();
  const st = s.me.settings;
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const [startMonth, setStartMonth] = useState(Number(s.rangeStart.slice(5)));
  const [startYear, setStartYear] = useState(Number(s.rangeStart.slice(0, 4)));
  return (
    <div className="settings-section">
      <h3>Year board range</h3>
      <div className="row">
        <label>Start month<select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>{months.map((m) => <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>)}</select></label>
        <label>Year<input type="number" value={startYear} min={1900} max={2200} onChange={(e) => setStartYear(Number(e.target.value))} /></label>
        <button className="btn" onClick={() => {
          const rs = `${startYear}-${String(startMonth).padStart(2, '0')}`;
          s.setRangeStart(rs);
          s.setSelected(`${rs}-01`);
          s.setView('year');
        }}>Show 12 months</button>
      </div>
      <p className="hint">Currently {MONTH_NAMES[Number(s.rangeStart.slice(5)) - 1]} {s.rangeStart.slice(0, 4)} – {MONTH_NAMES[Number(monthKey(addMonths(`${s.rangeStart}-01`, 11)).slice(5)) - 1]} {monthKey(addMonths(`${s.rangeStart}-01`, 11)).slice(0, 4)}.</p>
      <h3>Moon</h3>
      <label className="inline"><input type="checkbox" checked={st.showMoon !== false} onChange={(e) => void saveSettings(s, { showMoon: e.target.checked })} /> Show moon phases (board markers and dashboard widget)</label>
      <label className="inline"><input type="checkbox" checked={st.showReflection !== false} disabled={st.showMoon === false} onChange={(e) => void saveSettings(s, { showReflection: e.target.checked })} /> Show optional reflection prompts (interpretive, not astronomy)</label>
      <p className="hint">Phases are calculated on your device with astronomy-engine (accurate to within minutes) and shown in your time zone. Events are never moved because of the moon.</p>
      <h3>Weeks</h3>
      <label>Week starts on
        <select value={st.weekStartsOn ?? 7} onChange={(e) => void saveSettings(s, { weekStartsOn: Number(e.target.value) as 1 | 7 })}>
          <option value={7}>Sunday</option><option value={1}>Monday</option>
        </select>
      </label>
    </div>
  );
}

function PlanningTab() {
  const s = useStore();
  const [text, setText] = useState(s.me.settings.planningConstraints ?? '');
  return (
    <div className="settings-section">
      <h3>Planning constraints</h3>
      <p className="hint">Used by the in-app planning assistant, e.g. “Work hours Mon–Fri 9–5. No workouts after 8pm. Trading practice before 7:30am.”</p>
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" onClick={() => void saveSettings(s, { planningConstraints: text }).then(() => s.toast('Saved.'))}>Save</button>
    </div>
  );
}

function DataTab() {
  return (
    <div className="settings-section">
      <h3>Export</h3>
      <p>Download a JSON backup of your calendars, events, to-dos, notes, goals and check-ins.</p>
      <a className="btn" href="/api/export" download>Download backup</a>
      <p className="hint">The backup contains only your own data, never your partner's.</p>
    </div>
  );
}
