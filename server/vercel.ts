import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.ts';

// Vercel function entry. Every /api/* request is routed here (see scripts/build-vercel.mjs);
// the original path arrives as ?__path=… and is restored before Express routes it.
const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const original = url.searchParams.get('__path');
  if (original !== null) {
    url.searchParams.delete('__path');
    req.url = `/api/${original}${url.search}`;
  }
  return app(req as never, res as never);
}
