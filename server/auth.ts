import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import type { DB } from './db.ts';
import { get, run, nowIso } from './db.ts';
import { HttpError } from './repo.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = 'bac_session';
const SESSION_DAYS = 60;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

export async function createSession(db: DB, res: Response, userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await run(db, 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)', sha256(token), userId, nowIso(), expires.toISOString());
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/',
  });
}

export async function destroySession(db: DB, req: Request, res: Response) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function sessionMiddleware(getDb: () => DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return next();
    get<{ user_id: string; expires_at: string }>(getDb(), 'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', sha256(token))
      .then((s) => {
        if (s && s.expires_at > nowIso()) req.userId = s.user_id;
        next();
      })
      .catch(next);
  };
}

export function requireUser(req: Request): string {
  if (!req.userId) throw new HttpError(401, 'Please sign in');
  return req.userId;
}

/** Basic CSRF defence for cookie auth: mutations must be JSON with a custom header. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-bac'] !== '1') return next(new HttpError(403, 'Missing request header'));
  next();
}
