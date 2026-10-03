import type { UserInfo } from '../../shared/types.ts';

// Short-lived Google access tokens come from our server, which keeps the refresh token in an
// encrypted httpOnly cookie. Tokens are cached in memory until a minute before they expire.

type Cached = { token: string; expiresAt: number; user: UserInfo };
let cached: Cached | null = null;
let inflight: Promise<Cached> | null = null;

export class AuthError extends Error {}

export async function fetchToken(force = false): Promise<{ token: string; user: UserInfo }> {
  if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached;
  inflight ??= (async (): Promise<Cached> => {
    try {
      const r = await fetch('/api/auth/token', { method: 'POST', headers: { 'x-bac': '1' }, credentials: 'same-origin' });
      const json = await r.json().catch(() => ({}));
      if (r.status === 401) throw new AuthError(json.error ?? 'Not signed in');
      if (!r.ok) throw new Error(json.error ?? `Sign-in service error (${r.status})`);
      const next: Cached = { token: json.accessToken, expiresAt: json.expiresAt, user: json.user };
      cached = next;
      return next;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function signOut(revoke = false) {
  cached = null;
  await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bac': '1' }, body: JSON.stringify({ revoke }) }).catch(() => undefined);
}

export function signIn() {
  location.href = '/api/auth/login';
}
