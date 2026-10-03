import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// The session lives entirely in an encrypted, httpOnly cookie (AES-256-GCM), so the server needs
// no database. It holds the Google refresh token and basic profile.

export interface Session {
  refreshToken: string;
  email: string;
  name: string;
  picture: string | null;
  createdAt: number;
}

function key(secret: string) {
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET must be set (at least 16 characters).');
  return createHash('sha256').update(secret).digest();
}

export function seal(data: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function unseal<T>(token: string | null | undefined, secret: string): T | null {
  if (!token) return null;
  try {
    const [iv, tag, body] = token.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key(secret), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')) as T;
  } catch {
    return null;
  }
}
