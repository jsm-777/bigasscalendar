import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { seal, unseal, type Session } from './session.ts';

// Tiny backend: Google sign-in (OAuth 2.0 authorization-code flow) and short-lived access
// tokens for the browser. All calendar, task and Drive data goes directly from the browser to
// Google's APIs with those tokens; nothing is stored on this server.

export const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar', // read/write events, list calendars
  'https://www.googleapis.com/auth/tasks', // Google Tasks
  'https://www.googleapis.com/auth/drive.appdata', // private app folder for goals & notes
];

const SESSION_COOKIE = 'bac_s';
const STATE_COOKIE = 'bac_state';
const SESSION_DAYS = 180;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const env = () => ({
  clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  secret: process.env.SESSION_SECRET ?? '',
  allowed: (process.env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
});

export function googleConfigured() {
  const e = env();
  return !!(e.clientId && e.clientSecret && e.secret.length >= 16);
}

function origin(req: Request): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const cookieOpts = (maxAgeMs: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
  path: '/',
  maxAge: maxAgeMs,
});

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .then((out) => {
      if (!res.headersSent && out !== undefined) res.json(out);
    })
    .catch(next);
};

async function tokenRequest(params: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, json };
}

/** Decode the ID token we just received from Google's token endpoint over TLS. */
function decodeIdToken(idToken: string): { email?: string; name?: string; picture?: string; email_verified?: boolean } {
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/config', h(() => ({ googleConfigured: googleConfigured() })));
  app.get('/api/health', h(() => ({ ok: true, googleConfigured: googleConfigured() })));

  app.get('/api/auth/login', h((req, res) => {
    if (!googleConfigured()) throw new HttpError(503, 'Google sign-in is not configured yet. See docs/GOOGLE_SETUP.md.');
    const state = randomBytes(16).toString('base64url');
    res.cookie(STATE_COOKIE, state, cookieOpts(10 * 60_000));
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: env().clientId,
      redirect_uri: `${origin(req)}/api/auth/callback`,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      // Always ask for consent so Google returns a refresh token.
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    }).toString();
    res.redirect(url.toString());
  }));

  app.get('/api/auth/callback', h(async (req, res) => {
    const fail = (msg: string) => res.redirect(`/?authError=${encodeURIComponent(msg)}`);
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return fail(error === 'access_denied' ? 'Sign-in was cancelled.' : error);
    if (!code || !state || state !== readCookie(req, STATE_COOKIE)) return fail('Sign-in expired. Please try again.');
    res.clearCookie(STATE_COOKIE, { path: '/' });
    const e = env();
    const { ok, json } = await tokenRequest({
      code,
      client_id: e.clientId,
      client_secret: e.clientSecret,
      redirect_uri: `${origin(req)}/api/auth/callback`,
      grant_type: 'authorization_code',
    });
    if (!ok) return fail(`Google rejected the sign-in (${String(json.error_description ?? json.error ?? 'unknown')}).`);
    const profile = decodeIdToken(String(json.id_token ?? ''));
    const email = (profile.email ?? '').toLowerCase();
    if (e.allowed.length && !e.allowed.includes(email)) return fail(`${email || 'This account'} is not allowed to use this app.`);
    const granted = String(json.scope ?? '').split(' ');
    const missing = SCOPES.filter((s) => s.startsWith('https://') && !granted.includes(s));
    if (missing.length) return fail('Please allow access to Calendar, Tasks and the app folder in Drive — the app needs all three.');
    if (!json.refresh_token) return fail('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and sign in again.');
    const session: Session = {
      refreshToken: String(json.refresh_token),
      email,
      name: profile.name ?? email,
      picture: profile.picture ?? null,
      createdAt: Date.now(),
    };
    res.cookie(SESSION_COOKIE, seal(session, e.secret), cookieOpts(SESSION_DAYS * 86400_000));
    res.redirect('/');
  }));

  // Exchange the stored refresh token for a short-lived access token for the browser.
  app.post('/api/auth/token', h(async (req, res) => {
    if (req.headers['x-bac'] !== '1') throw new HttpError(403, 'Missing request header');
    const e = env();
    if (!googleConfigured()) throw new HttpError(503, 'Google sign-in is not configured yet.');
    const s = unseal<Session>(readCookie(req, SESSION_COOKIE), e.secret);
    if (!s) throw new HttpError(401, 'Not signed in');
    const { ok, json } = await tokenRequest({
      client_id: e.clientId,
      client_secret: e.clientSecret,
      refresh_token: s.refreshToken,
      grant_type: 'refresh_token',
    });
    if (!ok) {
      // Revoked or expired (e.g. the app is still in Google's "Testing" mode: 7-day tokens).
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      throw new HttpError(401, json.error === 'invalid_grant' ? 'Your Google sign-in expired. Please sign in again.' : 'Could not refresh Google access.');
    }
    return {
      accessToken: String(json.access_token),
      expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
      user: { email: s.email, name: s.name, picture: s.picture },
    };
  }));

  app.post('/api/auth/logout', h(async (req, res) => {
    const s = unseal<Session>(readCookie(req, SESSION_COOKIE), env().secret);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    if (s && req.body?.revoke) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.refreshToken)}`, { method: 'POST' }).catch(() => undefined);
    }
    return { ok: true };
  }));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  const dist = join(process.cwd(), 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    const msg = (err as Error)?.message ?? '';
    res.status(500).json({ error: /SESSION_SECRET/.test(msg) ? msg : 'Something went wrong on the server' });
  });
  return app;
}
