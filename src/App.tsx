import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserInfo } from '../shared/types.ts';
import { AuthError, fetchToken, signIn } from './lib/auth.ts';
import { googleBackend } from './lib/google.ts';
import { demoBackend } from './lib/demo.ts';
import type { Backend } from './lib/backend.ts';
import { StoreProvider, useStore, type Panel } from './store.tsx';
import { DayPanel } from './views/DayPanel.tsx';
import { WeekPanel } from './views/WeekPanel.tsx';
import { YearPanel } from './views/YearPanel.tsx';
import { Sheets } from './components/Sheets.tsx';

type Session = { backend: Backend; user: UserInfo };

export function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const params = new URLSearchParams(location.search);
  const authError = params.get('authError');

  const startDemo = useCallback(async () => {
    try {
      localStorage.setItem('bac-mode', 'demo');
    } catch {
      /* demo still works this visit */
    }
    const backend = demoBackend();
    setSession({ backend, user: await backend.user() });
  }, []);

  useEffect(() => {
    if (authError) history.replaceState(null, '', '/');
    if (params.has('demo') || safeGet('bac-mode') === 'demo') {
      void startDemo();
      return;
    }
    (async () => {
      const ok = await fetch('/api/config').then((r) => r.json()).then((c) => !!c.googleConfigured).catch(() => false);
      setConfigured(ok);
      if (!ok) return setSession(null);
      try {
        const { user } = await fetchToken();
        setSession({ backend: googleBackend(), user });
      } catch (e) {
        if (!(e instanceof AuthError)) console.warn(e);
        setSession(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (session === undefined) return <div className="splash"><Logo /></div>;
  if (!session) return <Landing configured={configured} authError={authError} onDemo={startDemo} />;
  return (
    <StoreProvider backend={session.backend} user={session.user} onSignedOut={() => setSession(null)}>
      <Shell />
    </StoreProvider>
  );
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function Logo({ small }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'small' : ''}`} aria-label="Big Ass Calendar">
      <span className="l1">BIG</span><span className="l2">ASS</span><span className="l3">CALENDAR</span>
    </div>
  );
}

function Landing({ configured, authError, onDemo }: { configured: boolean | null; authError: string | null; onDemo: () => void }) {
  return (
    <main className="landing">
      <div className="landing-blocks" aria-hidden>
        <i style={{ background: '#ff4f5e' }} /><i style={{ background: '#ffc531' }} /><i style={{ background: '#2d6bff' }} /><i style={{ background: '#0fb88a' }} /><i style={{ background: '#7b3ff2' }} /><i style={{ background: '#ff5fa2' }} />
      </div>
      <Logo />
      <p className="landing-tag">Your whole year on one board — built on your Google Calendar and Tasks.</p>
      {authError && <p className="landing-error" role="alert">{authError}</p>}
      <button className="google-btn" onClick={signIn} disabled={configured === false}>
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Sign in with Google
      </button>
      {configured === false && (
        <p className="landing-note">Google sign-in isn't connected on this site yet. The owner needs to add the Google keys in Vercel (see docs/GOOGLE_SETUP.md). You can try the demo meanwhile.</p>
      )}
      <button className="demo-btn" onClick={onDemo}>Try the demo</button>
      <p className="landing-fine">Uses Google Calendar, Google Tasks, and a private app folder in your Google Drive. Nothing is stored on our server.</p>
    </main>
  );
}

const PANELS: { label: string; color: string }[] = [
  { label: 'Day', color: 'var(--coral)' },
  { label: 'Week', color: 'var(--blue)' },
  { label: 'Year', color: 'var(--violet)' },
];

function Shell() {
  const s = useStore();
  const track = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);

  // Keep the carousel and the tabs in sync both ways.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const target = s.panel * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 4) {
      programmatic.current = true;
      el.scrollTo({ left: target, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      setTimeout(() => (programmatic.current = false), 450);
    }
  }, [s.panel]);

  // Re-align to the current panel when the window size changes (rotation, desktop resize).
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      programmatic.current = true;
      el.scrollLeft = s.panel * el.clientWidth;
      requestAnimationFrame(() => (programmatic.current = false));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.panel]);

  const onScroll = () => {
    const el = track.current;
    if (!el || programmatic.current) return;
    const i = Math.round(el.scrollLeft / el.clientWidth) as Panel;
    if (i !== s.panel) s.setPanel(i);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role="dialog"]')) return;
      if (e.key === 't') s.goToday();
      if (e.key === 'ArrowRight' && e.altKey) s.setPanel(Math.min(2, s.panel + 1) as Panel);
      if (e.key === 'ArrowLeft' && e.altKey) s.setPanel(Math.max(0, s.panel - 1) as Panel);
      if (e.key === 'n') s.setSheet({ type: 'add', date: s.selected });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [s]);

  const initials = useMemo(() => (s.user.name || s.user.email || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase(), [s.user]);

  return (
    <div className="shell" style={{ ['--panel-color' as string]: PANELS[s.panel].color }}>
      <header className="topbar">
        <Logo small />
        <nav className="tabs" role="tablist" aria-label="Views">
          {PANELS.map((p, i) => (
            <button key={p.label} role="tab" aria-selected={s.panel === i} className={s.panel === i ? 'on' : ''} style={{ ['--tab' as string]: p.color }} onClick={() => s.setPanel(i as Panel)}>
              {p.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {s.backend.kind === 'demo' && <span className="demo-badge">Demo</span>}
          <button className="round-btn" onClick={s.goToday} aria-label="Go to today" title="Today (T)">◎</button>
          <button className="avatar" onClick={() => s.setSheet({ type: 'menu' })} aria-label="Menu">
            {s.user.picture ? <img src={s.user.picture} alt="" referrerPolicy="no-referrer" /> : initials}
          </button>
        </div>
      </header>
      {s.error && !s.loading && (
        <div className="banner" role="alert">{s.error} <button onClick={() => void s.reload()}>Retry</button></div>
      )}
      <div className="carousel" ref={track} onScroll={onScroll}>
        <DayPanel />
        <WeekPanel />
        <YearPanel />
      </div>
      <div className="dots" aria-hidden>
        {PANELS.map((p, i) => <i key={p.label} className={s.panel === i ? 'on' : ''} />)}
      </div>
      <button className="fab" onClick={() => s.setSheet({ type: 'add', date: s.selected })} aria-label="Add">+</button>
      {s.busy && <div className="busy-bar" aria-hidden />}
      <Sheets />
      <div className="toasts" role="status" aria-live="polite">
        {s.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
