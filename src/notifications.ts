import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { useStore } from './store.tsx';
import type { InAppNotification } from '../shared/types.ts';

export type PushState = 'unsupported' | 'setup-incomplete' | 'off' | 'permission-needed' | 'blocked' | 'enabled';

export interface NotifData {
  items: InAppNotification[];
  upcoming: { id: string; kind: string; fireAt: string; title: string; body: string; url: string }[];
  subscriptions: { id: string; label: string; created_at: string; last_success_at: string | null; last_error: string | null }[];
  recentDeliveries: { status: string; error: string | null; updatedAt: string; kind: string }[];
  pushConfigured: boolean;
}

let listeners: ((d: NotifData) => void)[] = [];
let latest: NotifData | null = null;

export async function refreshNotifications() {
  try {
    latest = await api<NotifData>('GET', '/api/notifications');
    listeners.forEach((l) => l(latest!));
  } catch {
    /* status shows stale data; next poll retries */
  }
  return latest;
}

export function useNotifData(): NotifData | null {
  const [d, setD] = useState(latest);
  useEffect(() => {
    listeners.push(setD);
    return () => {
      listeners = listeners.filter((l) => l !== setD);
    };
  }, []);
  return d;
}

/** Poll the in-app notification center; surface new items as a toast while the page is open. */
export function useNotificationPolling() {
  const s = useStore();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const d = await refreshNotifications();
      if (!d || stop) return;
      if (seen.current === null) {
        seen.current = new Set(d.items.map((i) => i.id));
        return;
      }
      for (const n of d.items) {
        if (seen.current.has(n.id)) continue;
        seen.current.add(n.id);
        // Avoid a duplicate cue when the OS notification is already shown on this device.
        const pushHere = typeof Notification !== 'undefined' && Notification.permission === 'granted' && (await currentSubscription());
        if (!n.readAt && !(pushHere && document.visibilityState !== 'visible')) {
          s.toast(`🔔 ${n.title}${n.body ? ` — ${n.body}` : ''}`, 'info', { label: 'Open', run: () => s.setDialog({ type: 'notifications' }) });
        }
      }
    };
    void tick();
    const t = setInterval(tick, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function computePushState(configured: boolean): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!configured) return 'setup-incomplete';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'default') return 'permission-needed';
  return (await currentSubscription()) ? 'enabled' : 'off';
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Ask for permission (only from a user action) and register this device for push. */
export async function enablePushOnThisDevice(vapidKey: string): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'permission-needed';
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }));
  const json = sub.toJSON();
  await api('POST', '/api/push/subscribe', { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() });
  return 'enabled';
}

export async function disablePushOnThisDevice() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}

export const PUSH_STATE_TEXT: Record<PushState, { label: string; detail: string }> = {
  enabled: { label: 'Push on for this device', detail: 'Reminders are sent to this browser as system notifications, and always appear in the in-app center.' },
  off: { label: 'Push off on this device', detail: 'Permission is granted but this device is not registered. Turn it on to receive system notifications here.' },
  'permission-needed': { label: 'Permission needed', detail: 'Your browser will ask for permission when you turn on push for this device.' },
  blocked: { label: 'Blocked by the browser', detail: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then return here. In-app reminders still work.' },
  unsupported: { label: 'Not supported here', detail: 'This browser cannot receive web push. On iPhone/iPad, add the app to your Home Screen first (iOS 16.4+). In-app reminders still work while the app is open.' },
  'setup-incomplete': { label: 'Server setup incomplete', detail: 'Push needs VAPID keys on the server (see README). Until then, reminders appear in the in-app center only.' },
};
