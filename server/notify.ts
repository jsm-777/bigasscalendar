import webpush from 'web-push';
import type { DB } from './db.ts';
import { all, get, run, tx, uid, nowIso } from './db.ts';
import { getPrefs, listEvents, listTasks, userProfile } from './repo.ts';
import { HORIZON_DAYS, inQuietHours, planJobs } from '../shared/notifyPlan.ts';
import { addDays, todayIn, formatTime12, localTime } from '../shared/dates.ts';
import { expandAll } from '../shared/recurrence.ts';

// Notification pipeline:
//   1. reconcileUser(): after any change, plan desired jobs for the next HORIZON_DAYS and
//      upsert them by dedupe key; pending jobs that are no longer wanted are cancelled.
//   2. tick(): claim due pending jobs atomically (so overlapping runs never double-send).
//      Stale ones (past expires_at) are marked expired instead of delivered. Others create
//      exactly one in-app notification (unique per job) and one push delivery row per device.
//   3. Push deliveries retry with backoff up to MAX_ATTEMPTS while the job is not expired.
//      410/404 responses delete the subscription (revoked or stale endpoint).
// Jobs live in Postgres. tick() is driven by Vercel Cron (/api/cron), by in-app polling while
// the app is open, and by a timer when running the server locally.

export const MAX_ATTEMPTS = 3;

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

let vapidSet = false;
function ensureVapid() {
  if (vapidSet || !pushConfigured()) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  vapidSet = true;
}

interface PendingRow { id: string; dedupe_key: string; kind: string; source_type: string | null; source_id: string | null; fire_at: string; expires_at: string; payload: string }

export async function reconcileUser(db: DB, userId: string, now = new Date()) {
  const user = await userProfile(db, userId);
  const prefs = await getPrefs(db, userId);
  const today = todayIn(user.tz, now);
  // Only the user's own calendars produce reminders for them; a partner's items never do.
  const events = (await listEvents(db, userId, addDays(today, -2), addDays(today, HORIZON_DAYS + 2))).filter((e) => e.ownerId === userId);
  const tasks = await listTasks(db, userId);
  const desired = planJobs(prefs, user.tz, events, tasks, now);
  const ts = nowIso();
  await tx(db, async (t) => {
    const keys = new Set(desired.map((d) => d.dedupeKey));
    const pending = await all<PendingRow>(
      t, "SELECT id, dedupe_key, kind, source_type, source_id, fire_at, expires_at, payload FROM notification_jobs WHERE user_id = ? AND status = 'pending'", userId,
    );
    const byKey = new Map(pending.map((p) => [p.dedupe_key, p]));
    for (const p of pending) {
      if (p.kind === 'test') continue;
      if (p.kind === 'snooze') {
        if (!(await sourceStillActive(t, p.source_type, p.source_id))) {
          await run(t, "UPDATE notification_jobs SET status='cancelled', updated_at=? WHERE id=?", ts, p.id);
        }
        continue;
      }
      if (!keys.has(p.dedupe_key)) await run(t, "UPDATE notification_jobs SET status='cancelled', updated_at=? WHERE id=?", ts, p.id);
    }
    for (const d of desired) {
      const payload = JSON.stringify({ title: d.title, body: d.body, url: d.url });
      const cur = byKey.get(d.dedupeKey);
      // Skip unchanged pending jobs so re-planning stays cheap.
      if (cur && cur.payload === payload && cur.fire_at === d.fireAt && cur.expires_at === d.expiresAt) continue;
      await run(
        t,
        `INSERT INTO notification_jobs (id, user_id, kind, source_type, source_id, dedupe_key, fire_at, expires_at, status, payload, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)
         ON CONFLICT (user_id, dedupe_key) DO UPDATE SET
           payload = excluded.payload, fire_at = excluded.fire_at, expires_at = excluded.expires_at,
           status = CASE WHEN notification_jobs.status = 'cancelled' THEN 'pending' ELSE notification_jobs.status END,
           updated_at = excluded.updated_at`,
        uid(), userId, d.kind, d.sourceType, d.sourceId, d.dedupeKey, d.fireAt, d.expiresAt, payload, ts, ts,
      );
    }
  });
}

async function sourceStillActive(db: DB, type: string | null, id: string | null): Promise<boolean> {
  if (!type || !id) return true;
  if (type === 'event') return !!(await get(db, 'SELECT 1 AS x FROM events WHERE id = ?', id));
  if (type === 'task') return !!(await get(db, 'SELECT 1 AS x FROM tasks WHERE id = ? AND completed_at IS NULL', id));
  return true;
}

export async function reconcileAll(db: DB, now = new Date()) {
  for (const u of await all<{ id: string }>(db, 'SELECT id FROM users')) {
    try {
      await reconcileUser(db, u.id, now);
    } catch (e) {
      console.error('[reconcile]', u.id, (e as Error).message);
    }
  }
}

export async function enqueueImmediate(
  db: DB, userId: string, kind: 'test' | 'snooze', payload: { title: string; body: string; url: string },
  fireAt: Date, source: { type: string | null; id: string | null } = { type: null, id: null },
): Promise<string> {
  const id = uid();
  const ts = nowIso();
  await run(
    db,
    `INSERT INTO notification_jobs (id, user_id, kind, source_type, source_id, dedupe_key, fire_at, expires_at, status, payload, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)`,
    id, userId, kind, source.type, source.id, `${kind}:${id}`, fireAt.toISOString(),
    new Date(fireAt.getTime() + 2 * 3600_000).toISOString(), JSON.stringify(payload), ts, ts,
  );
  return id;
}

interface JobRow { id: string; user_id: string; kind: string; fire_at: string; expires_at: string; payload: string }

export interface PushSender {
  (sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<{ statusCode: number }>;
}

export const webPushSender: PushSender = async (sub, payload) => {
  ensureVapid();
  return webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload,
    { TTL: 3600, urgency: 'normal' },
  );
};

async function agendaBody(db: DB, userId: string, date: string): Promise<string> {
  const events = (await listEvents(db, userId, date, date)).filter((e) => e.ownerId === userId);
  const occ = expandAll(events, date, date);
  const tasks = (await listTasks(db, userId)).filter((t) => !t.completedAt && t.dueDate && t.dueDate <= date);
  const first = occ.find((o) => !o.allDay);
  const parts = [`${occ.length} event${occ.length === 1 ? '' : 's'}`, `${tasks.length} task${tasks.length === 1 ? '' : 's'} due`];
  if (first?.startLocal) parts.push(`first at ${formatTime12(localTime(first.startLocal))}`);
  return parts.join(' · ');
}

/** Deliver due jobs. Safe to run concurrently: jobs and deliveries are claimed atomically. */
export async function tick(db: DB, send: PushSender | null = pushConfigured() ? webPushSender : null, now = new Date()) {
  const nowS = now.toISOString();
  const due = await all<JobRow>(
    db, "SELECT id, user_id, kind, fire_at, expires_at, payload FROM notification_jobs WHERE status = 'pending' AND fire_at <= ? ORDER BY fire_at LIMIT 100", nowS,
  );
  for (const job of due) {
    if (job.expires_at <= nowS) {
      await run(db, "UPDATE notification_jobs SET status='expired', updated_at=? WHERE id=? AND status='pending'", nowS, job.id);
      continue;
    }
    const payload = JSON.parse(job.payload) as { title: string; body: string; url: string };
    if (job.kind === 'agenda') payload.body = await agendaBody(db, job.user_id, new URL(payload.url, 'http://x').searchParams.get('date')!);
    const prefs = await getPrefs(db, job.user_id);
    const user = await userProfile(db, job.user_id);
    const quiet = job.kind !== 'test' && inQuietHours(prefs, user.tz, now);
    await tx(db, async (t) => {
      // Claim: only one runner moves the job from pending to sent.
      const claimed = await run(t, "UPDATE notification_jobs SET status='sent', payload=?, updated_at=? WHERE id=? AND status='pending'", JSON.stringify(payload), nowS, job.id);
      if (!claimed.changes) return;
      await run(
        t,
        'INSERT INTO inapp_notifications (id, user_id, job_id, title, body, url, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (job_id) DO NOTHING',
        uid(), job.user_id, job.id, payload.title, payload.body, payload.url, nowS,
      );
      const subs = await all<{ id: string }>(t, 'SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC', job.user_id);
      const targets = prefs.pushTarget === 'all' ? subs : subs.slice(0, 1);
      for (const s of targets) {
        await run(
          t,
          `INSERT INTO notification_deliveries (id, job_id, subscription_id, status, attempts, next_attempt_at, error, updated_at)
           VALUES (?,?,?,?,0,?,?,?) ON CONFLICT (job_id, subscription_id) DO NOTHING`,
          uid(), job.id, s.id, quiet ? 'suppressed' : send ? 'pending' : 'failed', nowS,
          quiet ? 'quiet hours' : send ? null : 'push not configured', nowS,
        );
      }
    });
  }
  if (send) await deliverPush(db, send, now);
}

async function deliverPush(db: DB, send: PushSender, now: Date) {
  const nowS = now.toISOString();
  const pending = await all<{
    id: string; attempts: number; job_id: string; user_id: string; payload: string; expires_at: string; kind: string;
    endpoint: string; p256dh: string; auth: string; subscription_id: string;
  }>(
    db,
    `SELECT d.id, d.attempts, d.job_id, j.user_id, j.payload, j.expires_at, j.kind, s.endpoint, s.p256dh, s.auth, s.id AS subscription_id
     FROM notification_deliveries d
     JOIN notification_jobs j ON j.id = d.job_id
     JOIN push_subscriptions s ON s.id = d.subscription_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= ? LIMIT 100`,
    nowS,
  );
  for (const d of pending) {
    if (d.expires_at <= nowS) {
      await run(db, "UPDATE notification_deliveries SET status='failed', error='expired before delivery', updated_at=? WHERE id=?", nowS, d.id);
      continue;
    }
    // Claim the delivery so a concurrent runner cannot send it too.
    const claimed = await run(db, "UPDATE notification_deliveries SET status='sending', updated_at=? WHERE id=? AND status='pending'", nowS, d.id);
    if (!claimed.changes) continue;
    const prefs = await getPrefs(db, d.user_id);
    const p = JSON.parse(d.payload) as { title: string; body: string; url: string };
    // Lock-screen privacy: hide titles unless the user opted in (test messages are generic anyway).
    const body = prefs.showTitlesOnLockScreen || d.kind === 'test'
      ? { title: p.title, body: p.body, url: p.url, tag: d.job_id }
      : { title: 'Big Ass Calendar', body: 'You have a reminder. Open to view.', url: p.url, tag: d.job_id };
    try {
      await send({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, JSON.stringify(body));
      await run(db, "UPDATE notification_deliveries SET status='sent', attempts=attempts+1, error=NULL, updated_at=? WHERE id=?", nowS, d.id);
      await run(db, 'UPDATE push_subscriptions SET last_success_at=?, last_error=NULL WHERE id=?', nowS, d.subscription_id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 0;
      const msg = `${status || ''} ${(err as Error).message ?? 'error'}`.trim().slice(0, 300);
      if (status === 404 || status === 410) {
        // Endpoint revoked or expired: remove it so it is never retried.
        await run(db, 'DELETE FROM push_subscriptions WHERE id = ?', d.subscription_id);
        continue;
      }
      const attempts = d.attempts + 1;
      const retryable = status === 0 || status === 429 || status >= 500;
      const final = !retryable || attempts >= MAX_ATTEMPTS;
      await run(
        db,
        'UPDATE notification_deliveries SET status=?, attempts=?, next_attempt_at=?, error=?, updated_at=? WHERE id=?',
        final ? 'failed' : 'pending', attempts, new Date(now.getTime() + 2 ** attempts * 30_000).toISOString(), msg, nowS, d.id,
      );
      await run(db, 'UPDATE push_subscriptions SET last_error=? WHERE id=?', msg, d.subscription_id);
    }
  }
}

/** Periodic work: roll the planning horizon forward, deliver, clean up. */
export async function cronRun(db: DB, opts: { reconcile: boolean }) {
  if (opts.reconcile) await reconcileAll(db);
  await tick(db);
  await run(db, "DELETE FROM notification_jobs WHERE status IN ('cancelled','expired') AND updated_at < ?", new Date(Date.now() - 30 * 86400_000).toISOString());
  await run(db, 'DELETE FROM sessions WHERE expires_at < ?', nowIso());
}

let timer: NodeJS.Timeout | null = null;
let lastReconcile = 0;
/** Local/long-running server only. On Vercel, /api/cron drives the same work. */
export function startScheduler(db: DB, intervalMs = 15_000) {
  if (timer) return;
  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try {
      const reconcile = Date.now() - lastReconcile > 10 * 60_000;
      if (reconcile) lastReconcile = Date.now();
      await cronRun(db, { reconcile });
    } catch (e) {
      console.error('[scheduler]', (e as Error).message);
    } finally {
      busy = false;
    }
  };
  timer = setInterval(loop, intervalMs);
  void loop();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
