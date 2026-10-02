import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import type { Config } from '../store.tsx';

export function AuthScreen({ config, onSignedIn }: { config: Config; onSignedIn: () => void }) {
  const invite = new URLSearchParams(location.search).get('invite');
  const [mode, setMode] = useState<'login' | 'signup'>(invite || config.openSignup ? 'signup' : 'login');
  const [inviter, setInviter] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [tz, setTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!invite) return;
    api<{ inviterName: string }>('GET', `/api/invitations/preview/${encodeURIComponent(invite)}`)
      .then((r) => setInviter(r.inviterName))
      .catch((e) => setError((e as Error).message));
  }, [invite]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await api('POST', '/api/auth/signup', { email, password, displayName: name, tz, inviteToken: invite ?? undefined });
        history.replaceState(null, '', location.pathname);
      } else {
        await api('POST', '/api/auth/login', { email, password });
      }
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSignup = !!invite || config.openSignup;
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [tz];

  return (
    <div className="center-screen">
      <form className="card auth" onSubmit={submit}>
        <h1 className="brand">Big Ass Calendar</h1>
        <p className="muted">
          {inviter ? `${inviter} invited you to connect calendars. Create your own private account to join.` : 'Your whole year on one board.'}
        </p>
        {mode === 'signup' && (
          <>
            <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>
            <label>
              Time zone
              <select value={tz} onChange={(e) => setTz(e.target.value)}>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </label>
          </>
        )}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'signup' ? 10 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{mode === 'signup' ? 'Create account' : 'Sign in'}</button>
        {canSignup ? (
          <button type="button" className="link" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
            {mode === 'signup' ? 'I already have an account' : 'Create an account'}
          </button>
        ) : (
          <p className="muted small">New accounts join by invitation.</p>
        )}
      </form>
    </div>
  );
}
