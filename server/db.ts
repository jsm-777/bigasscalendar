import { randomUUID } from 'node:crypto';
import { MIGRATIONS } from './migrations/index.ts';

// PostgreSQL. In production this is Supabase via its connection pooler (DATABASE_URL /
// POSTGRES_URL). Without a URL (local dev, tests) it uses PGlite, an embedded Postgres, stored in
// ./data/pglite (or in memory for tests). All access is async and uses `?` placeholders, which are
// rewritten to Postgres' $1, $2 … here.

export interface DB {
  query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[]; affected: number }>;
  /** Runs fn inside one transaction. Absent on a DB that is already a transaction. */
  transaction?<T>(fn: (t: DB) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

export function databaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function toPg(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

const clean = (params: unknown[]) => params.map((p) => (p === undefined ? null : p));

async function openPostgres(rawUrl: string): Promise<DB> {
  const { default: postgres } = await import('postgres');
  // Connection options are set explicitly below; drop query params (e.g. Supabase's
  // `sslmode`/`supa`) that would otherwise be sent to the server as runtime settings.
  const parsed = new URL(rawUrl);
  parsed.search = '';
  const url = parsed.toString();
  const local = /^(localhost|127\.0\.0\.1)$/.test(parsed.hostname);
  const sql = postgres(url, {
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    ssl: local ? false : 'require',
    max: Number(process.env.DATABASE_POOL_MAX || 3),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => undefined,
  });
  // Root pool and transaction handles share the `unsafe` method.
  type Q = { unsafe: (q: string, p: never[]) => Promise<Record<string, unknown>[] & { count?: number }> };
  const wrap = (q: Q, root: boolean): DB => ({
    async query(text, params) {
      const res = await q.unsafe(toPg(text), clean(params) as never[]);
      return { rows: [...res] as Record<string, unknown>[], affected: res.count ?? 0 };
    },
    transaction: root ? async (fn) => (await sql.begin((t) => fn(wrap(t as unknown as Q, false)))) as never : undefined,
    close: root ? () => sql.end() : undefined,
  });
  return wrap(sql as unknown as Q, true);
}

async function openPglite(dataDir?: string): Promise<DB> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
  }
  const pg = new PGlite(dataDir);
  type Q = Pick<typeof pg, 'query'>;
  const wrap = (q: Q, root: boolean): DB => ({
    async query(text, params) {
      const res = await q.query<Record<string, unknown>>(toPg(text), clean(params));
      return { rows: res.rows, affected: res.affectedRows ?? 0 };
    },
    transaction: root ? (fn) => pg.transaction((t) => fn(wrap(t, false))) : undefined,
    close: root ? () => pg.close() : undefined,
  });
  return wrap(pg, true);
}

/** Open the configured database and apply migrations. `memory` forces an in-memory PGlite. */
export async function openDb(opts: { memory?: boolean } = {}): Promise<DB> {
  const url = opts.memory ? null : databaseUrl();
  if (!url && process.env.VERCEL) {
    throw new Error('DATABASE_URL is not set. Add your Supabase connection string (Transaction pooler, port 6543) in Vercel → Settings → Environment Variables.');
  }
  const db = url ? await openPostgres(url) : await openPglite(opts.memory ? undefined : process.env.PGLITE_DIR || './data/pglite');
  await migrate(db);
  return db;
}

/** One connection pool per process (one per warm serverless instance). */
export function sharedDb(): Promise<DB> {
  const g = globalThis as { __bacDb?: Promise<DB> };
  g.__bacDb ??= openDb().catch((e) => {
    g.__bacDb = undefined;
    throw e;
  });
  return g.__bacDb;
}

export async function migrate(db: DB): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)', []);
  await db.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY', []);
  const ran: string[] = [];
  for (const [name, text] of MIGRATIONS) {
    const done = await db.query('SELECT 1 FROM schema_migrations WHERE version = ?', [name]);
    if (done.rows.length) continue;
    try {
      await tx(db, async (t) => {
        // Serialize concurrent cold starts; the lock is released at commit.
        await t.query('SELECT pg_advisory_xact_lock(424242)', []);
        const again = await t.query('SELECT 1 FROM schema_migrations WHERE version = ?', [name]);
        if (again.rows.length) return;
        for (const stmt of text.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await t.query(stmt, []);
        await t.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [name, new Date().toISOString()]);
        ran.push(name);
      });
    } catch (e) {
      const now = await db.query('SELECT 1 FROM schema_migrations WHERE version = ?', [name]);
      if (!now.rows.length) throw e;
    }
  }
  return ran;
}

export async function tx<T>(db: DB, fn: (t: DB) => Promise<T>): Promise<T> {
  return db.transaction ? db.transaction(fn) : fn(db);
}

export const uid = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export async function all<T>(db: DB, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}
export async function get<T>(db: DB, sql: string, ...params: unknown[]): Promise<T | undefined> {
  return (await all<T>(db, sql, ...params))[0];
}
export async function run(db: DB, sql: string, ...params: unknown[]): Promise<{ changes: number }> {
  return { changes: (await db.query(sql, params)).affected };
}
