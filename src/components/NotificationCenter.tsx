import { useEffect, useState } from 'react';
import { useStore } from '../store.tsx';
import { api } from '../api.ts';
import type { NotificationPrefs } from '../../shared/types.ts';
import { Modal } from './Modal.tsx';
import {
  computePushState, currentSubscription, disablePushOnThisDevice, enablePushOnThisDevice, PUSH_STATE_TEXT, refreshNotifications, useNotifData,
  type PushState,
} from '../notifications.ts';
import { leadText } from '../../shared/notifyPlan.ts';

export function NotificationCenter({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const data = useNotifData();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [mySubEndpoint, setMySub] = useState<string | null>(null);

  const refreshState = async () => {
    setPush(await computePushState(s.config.pushConfigured));
    setMySub((await currentSubscription())?.endpoint ?? null);
  };
  useEffect(() => {
    void refreshState();
    void refreshNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unread = data?.items.filter((i) => !i.readAt).map((i) => i.id) ?? [];
    if (unread.length) void api('POST', '/api/notifications/read', { ids: unread }).then(() => setTimeout(() => void refreshNotifications(), 1500));
  }, [data?.items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEnabled = async (enabled: boolean) => {
    await api('PUT', '/api/notification-prefs', { ...s.me.prefs, enabled });
    await s.reloadMe();
    void refreshNotifications();
  };

  const turnOnPush = async () => {
    setBusy(true);
    try {
      if (!s.me.prefs.enabled) await setEnabled(true);
      setPush(await enablePushOnThisDevice(s.config.vapidPublicKey!));
      void refreshNotifications();
    } catch (e) {
      s.toast(`Could not enable push: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
      void refreshState();
    }
  };

  const test = async () => {
    await api('POST', '/api/notifications/test');
    s.toast('Test queued. It should arrive within ~15 seconds.');
    setTimeout(() => void refreshNotifications(), 16_000);
  };

  const enabled = s.me.prefs.enabled;
  const stateText = push ? PUSH_STATE_TEXT[push] : null;

  return (
    <Modal title="Reminders & notifications" onClose={onClose} wide>
      <section className="status-card">
        <div className="status-line">
          <span className={`status-dot ${enabled ? 'ok' : 'off'}`} />
          <strong>{enabled ? 'Reminders enabled' : 'Reminders off'}</strong>
          <button className="btn small" onClick={() => void setEnabled(!enabled)}>{enabled ? 'Turn off' : 'Turn on'}</button>
        </div>
        <p className="hint">In-app center: {enabled ? 'on — reminders appear here and as a banner while the app is open.' : 'off.'}</p>
        <div className="status-line">
          <span className={`status-dot ${push === 'enabled' ? 'ok' : push === 'blocked' || push === 'unsupported' ? 'bad' : 'partial'}`} />
          <strong>System push on this device: {stateText?.label ?? 'Checking…'}</strong>
          {(push === 'permission-needed' || push === 'off') && s.config.pushConfigured && (
            <button className="btn small primary" onClick={() => void turnOnPush()} disabled={busy}>Turn on push here</button>
          )}
          {push === 'enabled' && <button className="btn small ghost" onClick={async () => { await disablePushOnThisDevice(); void refreshState(); void refreshNotifications(); }}>Turn off here</button>}
        </div>
        {stateText && <p className="hint">{stateText.detail}</p>}
        <div className="row">
          <button className="btn" onClick={() => void test()} disabled={!enabled && push !== 'enabled'}>Send test notification</button>
          <button className="btn ghost" onClick={() => s.setDialog({ type: 'settings', tab: 'notifications' })}>Reminder settings</button>
        </div>
        <details>
          <summary className="small">What can stop a notification from appearing?</summary>
          <ul className="hint">
            <li>A queued or sent notification does not prove it appeared. Your operating system decides what is shown.</li>
            <li>Do Not Disturb / Focus modes, notification settings for your browser, and battery savers can hide or delay alerts.</li>
            <li>Desktop browsers usually need to be running (even in the background) to receive push. Closing the browser entirely may delay alerts until it reopens; stale reminders are dropped instead of arriving late in a flood.</li>
            <li>On iPhone/iPad, web push only works after “Add to Home Screen” (iOS 16.4+), opened from the Home Screen icon.</li>
            <li>Lock-screen text hides titles unless you allow them in reminder settings.</li>
            <li>Quiet hours keep reminders in the in-app center without sending push.</li>
          </ul>
        </details>
      </section>

      {data && data.subscriptions.length > 0 && (
        <section>
          <h3 className="small-head">Devices receiving push</h3>
          <ul className="sb-list">
            {data.subscriptions.map((d) => (
              <li key={d.id} className="sb-item static">
                <span className="sb-text small">
                  {d.label || 'Browser'}{mySubEndpoint && data.subscriptions[0]?.id === d.id && s.me.prefs.pushTarget === 'latest' ? ' · receives reminders' : ''}
                  {d.last_error && <span className="error-text"> · last error: {d.last_error}</span>}
                  {d.last_success_at && <span className="muted"> · last delivered {new Date(d.last_success_at).toLocaleString()}</span>}
                </span>
                <button className="link small" onClick={async () => { await api('POST', '/api/push/unsubscribe', { id: d.id }); void refreshNotifications(); }}>Remove</button>
              </li>
            ))}
          </ul>
          <p className="hint">{s.me.prefs.pushTarget === 'latest' ? 'Only the most recently registered device receives push, to avoid duplicates. Change this in reminder settings.' : 'All registered devices receive push.'}</p>
        </section>
      )}

      <section>
        <h3 className="small-head">Recent</h3>
        {!data ? <p className="quiet">Loading…</p> : data.items.length === 0 ? <p className="quiet">No notifications yet.</p> : (
          <ul className="sb-list">
            {data.items.slice(0, 30).map((n) => (
              <li key={n.id} className={`sb-item static ${n.readAt ? '' : 'unread'}`}>
                <span className="sb-time">{new Date(n.createdAt).toLocaleString(undefined, { timeZone: s.tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <span className="sb-text">{n.title}<span className="muted small"> · {n.body}</span></span>
                <button className="link small" onClick={async () => {
                  const r = await api<{ snoozedUntil: string }>('POST', `/api/notifications/${n.id}/snooze`);
                  s.toast(`Snoozed until ${new Date(r.snoozedUntil).toLocaleTimeString(undefined, { timeZone: s.tz, hour: 'numeric', minute: '2-digit' })}.`);
                  void refreshNotifications();
                }}>Snooze {s.me.prefs.snoozeMinutes}m</button>
                <button className="link small" onClick={() => { const d = new URL(n.url, location.origin).searchParams.get('date'); if (d) s.setSelected(d); onClose(); }}>View</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="small-head">Queued (next 8 days)</h3>
        {!data || data.upcoming.length === 0 ? <p className="quiet">Nothing queued.</p> : (
          <ul className="sb-list">
            {data.upcoming.slice(0, 20).map((u) => (
              <li key={u.id} className="sb-item static">
                <span className="sb-time">{new Date(u.fireAt).toLocaleString(undefined, { timeZone: s.tz, weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                <span className="sb-text">{u.title}<span className="muted small"> · {u.kind}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}

export function NotificationPrefsForm() {
  const s = useStore();
  const [p, setP] = useState<NotificationPrefs>(s.me.prefs);
  const set = (x: Partial<NotificationPrefs>) => setP((v) => ({ ...v, ...x }));
  const save = async () => {
    try {
      await api('PUT', '/api/notification-prefs', p);
      await s.reloadMe();
      void refreshNotifications();
      s.toast('Reminder settings saved.');
    } catch (e) {
      s.toast((e as Error).message, 'error');
    }
  };
  const leads = [0, 5, 10, 15, 30, 60, 120, 1440];
  return (
    <div className="settings-section">
      <label className="inline"><input type="checkbox" checked={p.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Reminders enabled</label>
      <div className="row">
        <label>Default event alert
          <select value={p.eventLeadMinutes} onChange={(e) => set({ eventLeadMinutes: Number(e.target.value) })}>
            {leads.map((m) => <option key={m} value={m}>{m === 0 ? 'At start' : `${leadText(m)} before`}</option>)}
          </select>
        </label>
        <label>Default to-do alert (timed)
          <select value={p.taskLeadMinutes} onChange={(e) => set({ taskLeadMinutes: Number(e.target.value) })}>
            {leads.map((m) => <option key={m} value={m}>{m === 0 ? 'At due time' : `${leadText(m)} before`}</option>)}
          </select>
        </label>
        <label>Date-only to-dos remind at<input type="time" value={p.dateOnlyTaskTime} onChange={(e) => set({ dateOnlyTaskTime: e.target.value })} /></label>
      </div>
      <p className="hint">Defaults apply to new events and to-dos; existing ones keep their own alerts.</p>
      <div className="row">
        <label className="inline"><input type="checkbox" checked={p.dailyAgenda} onChange={(e) => set({ dailyAgenda: e.target.checked })} /> Daily agenda at</label>
        <input type="time" value={p.dailyAgendaTime} disabled={!p.dailyAgenda} onChange={(e) => set({ dailyAgendaTime: e.target.value })} aria-label="Daily agenda time" />
      </div>
      <div className="row">
        <label className="inline"><input type="checkbox" checked={!!p.quietStart} onChange={(e) => set(e.target.checked ? { quietStart: '22:00', quietEnd: '07:00' } : { quietStart: null, quietEnd: null })} /> Quiet hours</label>
        {p.quietStart && (
          <>
            <input type="time" value={p.quietStart} onChange={(e) => set({ quietStart: e.target.value })} aria-label="Quiet hours start" />
            <span>to</span>
            <input type="time" value={p.quietEnd ?? '07:00'} onChange={(e) => set({ quietEnd: e.target.value })} aria-label="Quiet hours end" />
          </>
        )}
      </div>
      <p className="hint">During quiet hours reminders go to the in-app center only, with no push.</p>
      <label>Snooze length<select value={p.snoozeMinutes} onChange={(e) => set({ snoozeMinutes: Number(e.target.value) })}>{[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
      <label className="inline"><input type="checkbox" checked={p.showTitlesOnLockScreen} onChange={(e) => set({ showTitlesOnLockScreen: e.target.checked })} /> Show event and to-do titles in system notifications (lock screen)</label>
      <label>Push to
        <select value={p.pushTarget} onChange={(e) => set({ pushTarget: e.target.value as 'latest' | 'all' })}>
          <option value="latest">Most recently enabled device only (no duplicates)</option>
          <option value="all">Every enabled device</option>
        </select>
      </label>
      <button className="btn primary" onClick={() => void save()}>Save reminder settings</button>
    </div>
  );
}
