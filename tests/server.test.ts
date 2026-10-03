import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, SCOPES } from '../server/app.ts';
import { seal } from '../server/session.ts';

let server: Server;
let base = '';
const realFetch = globalThis.fetch;

beforeAll(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

const req = (path: string, init: RequestInit = {}) => realFetch(base + path, { redirect: 'manual', ...init });

describe('without Google configured', () => {
  it('reports not configured and refuses sign-in', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    expect(await (await req('/api/config')).json()).toEqual({ googleConfigured: false });
    expect((await req('/api/auth/login')).status).toBe(503);
  });
});

describe('with Google configured', () => {
  const secret = 'test-session-secret-0123456789';
  beforeAll(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret');
    vi.stubEnv('SESSION_SECRET', secret);
    vi.stubEnv('APP_ORIGIN', 'https://bac.example');
  });

  it('starts the OAuth flow with offline access and the needed scopes', async () => {
    const r = await req('/api/auth/login');
    expect(r.status).toBe(302);
    const url = new URL(r.headers.get('location')!);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://bac.example/api/auth/callback');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(SCOPES);
    expect(r.headers.get('set-cookie')).toMatch(/bac_state=.*HttpOnly/i);
  });

  it('rejects a callback with a mismatched state', async () => {
    const r = await req('/api/auth/callback?code=x&state=forged', { headers: { cookie: 'bac_state=real' } });
    expect(r.headers.get('location')).toMatch(/authError=/);
  });

  it('completes sign-in, enforces ALLOWED_EMAILS, and issues access tokens', async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'Jasmin@Example.com', name: 'Jasmin' })).toString('base64url')}.y`;
    const google = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3599, refresh_token: 'rt-1', id_token: idToken, scope: SCOPES.join(' ') }), { status: 200 });
      }
      return realFetch(url as string);
    });
    vi.stubGlobal('fetch', google);
    try {
      vi.stubEnv('ALLOWED_EMAILS', 'someone-else@example.com');
      let r = await req('/api/auth/callback?code=c&state=s1', { headers: { cookie: 'bac_state=s1' } });
      expect(decodeURIComponent(r.headers.get('location')!)).toMatch(/not allowed/);

      vi.stubEnv('ALLOWED_EMAILS', 'jasmin@example.com, tehron@example.com');
      r = await req('/api/auth/callback?code=c&state=s2', { headers: { cookie: 'bac_state=s2' } });
      expect(r.headers.get('location')).toBe('/');
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith('bac_s='))!.split(';')[0];
      expect(cookie).toMatch(/^bac_s=/);
      expect(cookie).not.toContain('rt-1');

      const t = await req('/api/auth/token', { method: 'POST', headers: { cookie, 'x-bac': '1' } });
      const body = await t.json();
      expect(body.accessToken).toBe('at-1');
      expect(body.user.email).toBe('jasmin@example.com');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses token requests without a valid session or header', async () => {
    expect((await req('/api/auth/token', { method: 'POST', headers: { 'x-bac': '1' } })).status).toBe(401);
    const forged = seal({ refreshToken: 'x', email: 'e', name: 'n', picture: null, createdAt: 0 }, 'a-different-secret-entirely');
    expect((await req('/api/auth/token', { method: 'POST', headers: { 'x-bac': '1', cookie: `bac_s=${forged}` } })).status).toBe(401);
    expect((await req('/api/auth/token', { method: 'POST' })).status).toBe(403);
  });
});
