import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api.ts';
import { StoreProvider, useStore, type Config, type Settings } from './store.tsx';
import type { NotificationPrefs, Partner, UserProfile } from '../shared/types.ts';
import { AuthScreen } from './components/AuthScreen.tsx';
import { Header } from './components/Header.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { BoardArea } from './views/BoardArea.tsx';
import { Dialogs } from './components/Dialogs.tsx';
import { Toasts } from './components/Toasts.tsx';
import { useNotificationPolling } from './notifications.ts';

type Me = { user: UserProfile; partner: Partner | null; prefs: NotificationPrefs; settings: Settings };

export function Root() {
  const [config, setConfig] = useState<Config | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api<Me>('GET', '/api/me'));
    } catch (e) {
      if ((e as ApiError).status === 401) setMe(null);
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api<Config>('GET', '/api/config').then(setConfig).catch((e) => setError((e as Error).message));
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  if (error && !me) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1 className="brand">Big Ass Calendar</h1>
          <p className="error-text">Could not reach the server: {error}</p>
          {/404/.test(error) && (
            <p className="hint">The site loaded but its API did not respond. On Vercel, check that the project uses this repo's <code>vercel.json</code> (build command <code>npm run build:vercel</code>) and that <code>DATABASE_URL</code> is set.</p>
          )}
          {/50\d/.test(error) && <p className="hint">The API is running but failed to start. Check the database settings (DATABASE_URL) in your hosting provider.</p>}
          <button className="btn" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!config || me === undefined) return <div className="center-screen muted" aria-busy="true">Loading…</div>;
  if (me === null) return <AuthScreen config={config} onSignedIn={loadMe} />;
  return (
    <StoreProvider config={config} me={me} reloadMe={loadMe}>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const s = useStore();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // On small screens the dashboard is a drawer and the Year board stays the default view.
    if (matchMedia('(max-width: 860px)').matches) return false;
    try {
      return localStorage.getItem('bac-sidebar') !== 'closed';
    } catch {
      return true;
    }
  });
  const toggleSidebar = () => {
    setSidebarOpen((o) => {
      try {
        localStorage.setItem('bac-sidebar', o ? 'closed' : 'open');
      } catch {
        /* ignore */
      }
      return !o;
    });
  };
  useNotificationPolling();
  useInviteFromUrl();

  // Global keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void s.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, () => void> = {
        t: s.goToday,
        y: () => s.setView('year'),
        m: () => s.setView('month'),
        w: () => s.setView('week'),
        d: () => s.setView('day'),
        n: () => s.setDialog({ type: 'event', defaults: { startDate: s.selected } }),
        '/': () => s.setDialog({ type: 'search' }),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [s]);

  return (
    <div className={`app ${sidebarOpen ? 'with-sidebar' : 'sidebar-closed'}`}>
      <Header sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
      {!s.online && <div className="banner warn" role="status">You are offline. Viewing the last loaded data; changes will fail until you reconnect.</div>}
      {s.loadError && (
        <div className="banner error" role="alert">
          Could not load your calendar: {s.loadError} <button className="link" onClick={() => void s.reload()}>Retry</button>
        </div>
      )}
      <div className="main">
        <BoardArea />
        {sidebarOpen && <div className="drawer-backdrop" onClick={toggleSidebar} aria-hidden />}
        <Sidebar open={sidebarOpen} onClose={toggleSidebar} />
      </div>
      <Dialogs />
      <Toasts />
    </div>
  );
}

function useInviteFromUrl() {
  const s = useStore();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get('invite');
    if (!token) return;
    history.replaceState(null, '', location.pathname);
    if (s.me.partner) {
      s.toast('You are already connected, so this invitation was not used.', 'error');
      return;
    }
    api<{ inviterName: string }>('GET', `/api/invitations/preview/${encodeURIComponent(token)}`)
      .then(({ inviterName }) => {
        if (!confirm(`Connect with ${inviterName}? You will each see only the calendars the other chooses to share.`)) return;
        return api('POST', '/api/invitations/accept', { token }).then(() => {
          s.toast(`Connected with ${inviterName}.`);
          void s.reloadMe();
          void s.reload();
        });
      })
      .catch((e) => s.toast((e as Error).message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
