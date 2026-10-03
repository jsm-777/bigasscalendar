import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { DB } from './db.ts';
import { all, get, nowIso, run, tx, uid } from './db.ts';
import {
  createSession, csrfGuard, destroySession, hashPassword, randomToken, requireUser, sessionMiddleware, sha256,
  verifyPassword,
} from './auth.ts';
import {
  HttpError, calendarAccess, canEditCalendar, getEvent, getPrefs, getTask, listCalendars, listCheckIns, listEvents,
  listGoals, listNotes, listTaskLists, listTasks, partnerOf, setPrefs, userProfile, writeEvent,
} from './repo.ts';
import {
  calendarSchema, checkInSchema, eventBatchSchema, goalSchema, noteSchema, planSchema, prefsSchema, taskSchema, tzSchema,
} from '../shared/schemas.ts';
import type { CalEvent } from '../shared/types.ts';
import { cronRun, enqueueImmediate, pushConfigured, reconcileUser, tick } from './notify.ts';
import { applyChanges, compilePlan, undoPlan, writeTask } from './plan.ts';
import { assistantConfigured, draftPlan } from './assistant.ts';

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .then((out) => {
      if (!res.headersSent) res.json(out ?? { ok: true });
    })
    .catch(next);
};

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(400, `${issue?.path.join('.') || 'input'}: ${issue?.message}`, r.error.issues);
  }
  return r.data;
}

/** Re-plan reminders for everyone affected; failures here must not fail the user's write. */
async function replan(db: DB, ...userIds: (string | undefined)[]) {
  for (const id of new Set(userIds.filter(Boolean) as string[])) {
    try {
      await reconcileUser(db, id);
    } catch (e) {
      console.error('[replan]', (e as Error).message);
    }
  }
}

export const CALENDAR_TEMPLATES = [
  { name: 'Personal', color: '#3b82f6' },
  { name: 'Bills', color: '#ef4444' },
  { name: 'Paydays', color: '#16a34a' },
  { name: 'Trading', color: '#f59e0b' },
  { name: 'Workouts', color: '#8b5cf6' },
  { name: 'Creating', color: '#ec4899' },
];

let lastOpportunisticTick = 0;

/** The very first account can always sign up; after that only with ALLOW_OPEN_SIGNUP or an invite. */
async function openSignup(db: DB): Promise<boolean> {
  if (process.env.ALLOW_OPEN_SIGNUP === 'true') return true;
  return !(await get(db, 'SELECT 1 AS x FROM users LIMIT 1'));
}

/** `getDb` resolves the shared connection (lazily on serverless cold starts). */
export function createApp(getDb: () => Promise<DB>) {
  const app = express();
  let db!: DB;
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use((_req, _res, next) => {
    getDb().then((d) => { db = d; next(); }).catch(next);
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(sessionMiddleware(() => db));
  app.use('/api', csrfGuard);

  // Scheduled work (Vercel Cron, or any external scheduler) — reconcile reminder jobs and deliver
  // due ones. Protected by CRON_SECRET (Vercel sends it as a Bearer token automatically).
  app.get('/api/cron', h(async (req) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw new HttpError(503, 'CRON_SECRET is not configured');
    } else if (req.headers.authorization !== `Bearer ${secret}`) {
      throw new HttpError(401, 'Unauthorized');
    }
    const started = Date.now();
    await cronRun(db, { reconcile: true });
    return { ok: true, ms: Date.now() - started };
  }));

  // ---------------- Auth & account ----------------

  const signupSchema = z.object({
    email: z.string().email().max(200),
    password: z.string().min(10, 'Use at least 10 characters').max(200),
    displayName: z.string().trim().min(1).max(60),
    tz: tzSchema,
    inviteToken: z.string().optional(),
  });

  app.post('/api/auth/signup', h(async (req, res) => {
    const body = parse(signupSchema, req.body);
    let invite: { id: string; inviter_id: string } | undefined;
    if (body.inviteToken) {
      invite = await get(db, 'SELECT id, inviter_id FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?', sha256(body.inviteToken), nowIso());
      if (!invite) throw new HttpError(400, 'This invitation is invalid or expired');
    } else if (!(await openSignup(db))) {
      throw new HttpError(403, 'Sign-up is by invitation only');
    }
    if (await get(db, 'SELECT 1 AS x FROM users WHERE lower(email) = lower(?)', body.email)) throw new HttpError(409, 'An account with this email already exists');
    const id = uid();
    const hash = await hashPassword(body.password);
    await tx(db, async (db) => {
      await run(db, 'INSERT INTO users (id, email, display_name, password_hash, tz, created_at) VALUES (?,?,?,?,?,?)', id, body.email, body.displayName, hash, body.tz, nowIso());
      // A blank account gets one default task list so tasks have somewhere to live. No calendars,
      // events, tasks, notes, goals or history are created.
      await run(db, 'INSERT INTO task_lists (id, owner_id, name, color, created_at) VALUES (?,?,?,?,?)', uid(), id, 'To-dos', '#64748b', nowIso());
      if (invite) await acceptInvite(db, invite, id);
    });
    await createSession(db, res, id);
    return { ok: true };
  }));

  app.post('/api/auth/login', h(async (req, res) => {
    const body = parse(z.object({ email: z.string(), password: z.string() }), req.body);
    const u = await get<{ id: string; password_hash: string }>(db, 'SELECT id, password_hash FROM users WHERE lower(email) = lower(?)', body.email);
    if (!u || !(await verifyPassword(body.password, u.password_hash))) throw new HttpError(401, 'Email or password is incorrect');
    await createSession(db, res, u.id);
    return { ok: true };
  }));

  app.post('/api/auth/logout', h(async (req, res) => {
    await destroySession(db, req, res);
    return { ok: true };
  }));

  app.get('/api/health', h(async () => {
    await get(db, 'SELECT 1 AS ok');
    return { ok: true, database: true, push: pushConfigured(), assistant: assistantConfigured(), cron: !!process.env.CRON_SECRET };
  }));

  app.get('/api/config', h(async () => ({
    openSignup: await openSignup(db),
    pushConfigured: pushConfigured(),
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    assistant: assistantConfigured(),
    templates: CALENDAR_TEMPLATES,
  })));

  app.get('/api/me', h(async (req) => {
    const userId = requireUser(req);
    const settings = await get<{ settings: string }>(db, 'SELECT settings FROM user_settings WHERE user_id = ?', userId);
    return {
      user: await userProfile(db, userId),
      partner: await partnerOf(db, userId),
      prefs: await getPrefs(db, userId),
      settings: settings ? JSON.parse(settings.settings) : {},
    };
  }));

  app.patch('/api/me', h(async (req) => {
    const userId = requireUser(req);
    const body = parse(z.object({ displayName: z.string().trim().min(1).max(60).optional(), tz: tzSchema.optional() }), req.body);
    if (body.displayName) await run(db, 'UPDATE users SET display_name = ? WHERE id = ?', body.displayName, userId);
    if (body.tz) await run(db, 'UPDATE users SET tz = ? WHERE id = ?', body.tz, userId);
    await replan(db, userId);
    return await userProfile(db, userId);
  }));

  app.put('/api/settings', h(async (req) => {
    const userId = requireUser(req);
    const body = parse(z.object({
      planningConstraints: z.string().max(2000).optional(),
      showMoon: z.boolean().optional(),
      showReflection: z.boolean().optional(),
      weekStartsOn: z.union([z.literal(1), z.literal(7)]).optional(),
    }), req.body);
    const cur = await get<{ settings: string }>(db, 'SELECT settings FROM user_settings WHERE user_id = ?', userId);
    const next = { ...(cur ? JSON.parse(cur.settings) : {}), ...body };
    await run(db, 'INSERT INTO user_settings (user_id, settings) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings', userId, JSON.stringify(next));
    return next;
  }));

  // ---------------- Invitations (Together) ----------------

  async function acceptInvite(d: DB, invite: { id: string; inviter_id: string }, userId: string) {
    if (invite.inviter_id === userId) throw new HttpError(400, 'You cannot accept your own invitation');
    if (await partnerOf(d, userId) || await partnerOf(d, invite.inviter_id)) throw new HttpError(409, 'One of you is already connected to someone');
    await run(d, 'INSERT INTO partnerships (user_a, user_b, created_at) VALUES (?,?,?)', invite.inviter_id, userId, nowIso());
    await run(d, 'UPDATE invitations SET accepted_by = ?, accepted_at = ? WHERE id = ?', userId, nowIso(), invite.id);
  }

  app.post('/api/invitations', h(async (req) => {
    const userId = requireUser(req);
    if (await partnerOf(db, userId)) throw new HttpError(409, 'You are already connected');
    const body = parse(z.object({ note: z.string().max(200).default('') }), req.body ?? {});
    const token = randomToken();
    await run(db, 'INSERT INTO invitations (id, token_hash, inviter_id, note, created_at, expires_at) VALUES (?,?,?,?,?,?)', uid(), sha256(token), userId, body.note, nowIso(), new Date(Date.now() + 7 * 86400_000).toISOString());
    // The link is returned to the inviter to share personally; the app never sends it.
    const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    return { link: `${origin}/?invite=${token}`, expiresInDays: 7 };
  }));

  app.get('/api/invitations', h(async (req) => {
    const userId = requireUser(req);
    return await all(db, 'SELECT id, note, created_at AS "createdAt", expires_at AS "expiresAt", accepted_at AS "acceptedAt", revoked_at AS "revokedAt" FROM invitations WHERE inviter_id = ? ORDER BY created_at DESC', userId);
  }));

  app.delete('/api/invitations/:id', h(async (req) => {
    const userId = requireUser(req);
    await run(db, 'UPDATE invitations SET revoked_at = ? WHERE id = ? AND inviter_id = ? AND accepted_at IS NULL', nowIso(), req.params.id, userId);
  }));

  app.get('/api/invitations/preview/:token', h(async (req) => {
    const inv = await get<{ display_name: string }>(db, `SELECT u.display_name FROM invitations i JOIN users u ON u.id = i.inviter_id
      WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`, sha256(String(req.params.token)), nowIso());
    if (!inv) throw new HttpError(404, 'This invitation is invalid or expired');
    return { inviterName: inv.display_name };
  }));

  app.post('/api/invitations/accept', h(async (req) => {
    const userId = requireUser(req);
    const { token } = parse(z.object({ token: z.string() }), req.body);
    const invite = await get<{ id: string; inviter_id: string }>(db, 'SELECT id, inviter_id FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?', sha256(token), nowIso());
    if (!invite) throw new HttpError(400, 'This invitation is invalid or expired');
    await tx(db, (t) => acceptInvite(t, invite, userId));
    return { partner: await partnerOf(db, userId) };
  }));

  app.delete('/api/partnership', h(async (req) => {
    const userId = requireUser(req);
    const p = await partnerOf(db, userId);
    await run(db, 'DELETE FROM partnerships WHERE user_a = ? OR user_b = ?', userId, userId);
    await replan(db, userId, p?.id);
  }));

  // ---------------- Data ----------------

  app.get('/api/data', h(async (req) => {
    const userId = requireUser(req);
    const q = parse(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.query);
    return {
      calendars: await listCalendars(db, userId),
      events: await listEvents(db, userId, q.from, q.to),
      taskLists: await listTaskLists(db, userId),
      tasks: await listTasks(db, userId),
      // Notes are always private to their owner and never included for a partner.
      notes: await listNotes(db, userId),
      goals: await listGoals(db, userId),
      checkIns: await listCheckIns(db, userId),
    };
  }));

  app.get('/api/export', h(async (req, res) => {
    const userId = requireUser(req);
    res.setHeader('Content-Disposition', `attachment; filename="big-ass-calendar-export-${new Date().toISOString().slice(0, 10)}.json"`);
    const own = (e: CalEvent) => e.ownerId === userId;
    return {
      exportedAt: nowIso(),
      user: await userProfile(db, userId),
      calendars: (await listCalendars(db, userId)).filter((c) => c.access === 'owner'),
      events: (await listEvents(db, userId, '0000-01-01', '9999-12-31')).filter(own),
      taskLists: await listTaskLists(db, userId),
      tasks: await all(db, 'SELECT * FROM tasks WHERE owner_id = ?', userId),
      notes: await listNotes(db, userId),
      goals: await listGoals(db, userId),
      checkIns: await listCheckIns(db, userId),
      notificationPrefs: await getPrefs(db, userId),
    };
  }));

  // Calendars
  app.post('/api/calendars', h(async (req) => {
    const userId = requireUser(req);
    const c = parse(calendarSchema, req.body);
    const sort = ((await get<{ n: number }>(db, 'SELECT COUNT(*)::int AS n FROM calendars WHERE owner_id = ?', userId))?.n ?? 0) + 1;
    await run(db, 'INSERT INTO calendars (id, owner_id, name, color, archived, share_level, sort, version, created_at) VALUES (?,?,?,?,0,?,?,1,?)', c.id, userId, c.name, c.color, c.shareLevel, sort, nowIso());
    return (await listCalendars(db, userId)).find((x) => x.id === c.id);
  }));

  app.put('/api/calendars/:id', h(async (req) => {
    const userId = requireUser(req);
    const c = parse(calendarSchema, { ...req.body, id: req.params.id });
    const access = await calendarAccess(db, userId, c.id);
    if (access !== 'owner') throw new HttpError(access ? 403 : 404, 'Only the owner can change this calendar');
    const r = await run(db, 'UPDATE calendars SET name=?, color=?, archived=?, share_level=?, version=version+1 WHERE id=? AND version=?', c.name, c.color, c.archived ? 1 : 0, c.shareLevel, c.id, c.version);
    if (!r.changes) throw new HttpError(409, 'This calendar changed elsewhere. Reload and try again.');
    const p = await partnerOf(db, userId);
    await replan(db, userId, p?.id);
    return (await listCalendars(db, userId)).find((x) => x.id === c.id);
  }));

  app.put('/api/calendars/:id/visibility', h(async (req) => {
    const userId = requireUser(req);
    const { visible } = parse(z.object({ visible: z.boolean() }), req.body);
    if (!await calendarAccess(db, userId, String(req.params.id))) throw new HttpError(404, 'Calendar not found');
    await run(db, 'INSERT INTO calendar_visibility (user_id, calendar_id, visible) VALUES (?,?,?) ON CONFLICT(user_id, calendar_id) DO UPDATE SET visible = excluded.visible', userId, req.params.id, visible ? 1 : 0);
  }));

  app.delete('/api/calendars/:id', h(async (req) => {
    const userId = requireUser(req);
    if (await calendarAccess(db, userId, String(req.params.id)) !== 'owner') throw new HttpError(403, 'Only the owner can delete this calendar');
    await run(db, 'DELETE FROM calendars WHERE id = ?', req.params.id);
    await replan(db, userId);
  }));

  // Events: batch writes so recurrence splits (update + create) are atomic.
  app.post('/api/events/batch', h(async (req) => {
    const userId = requireUser(req);
    const body = parse(eventBatchSchema, req.body);
    const owners = new Set<string>();
    const saved = await tx(db, async (db) => {
      for (const d of body.deletes) {
        const cur = await getEvent(db, d.id);
        if (!cur) continue; // already gone: deleting is idempotent
        if (!canEditCalendar(await calendarAccess(db, userId, cur.calendarId))) throw new HttpError(403, 'You cannot delete this event');
        if (cur.version !== d.version) throw new HttpError(409, `“${cur.title}” changed elsewhere. Reload to see the latest.`);
        await run(db, 'DELETE FROM events WHERE id = ?', d.id);
        owners.add(cur.ownerId);
      }
      const out: CalEvent[] = [];
      for (const e of body.upserts) {
        const target = await calendarAccess(db, userId, e.calendarId);
        if (!canEditCalendar(target)) throw new HttpError(403, 'You cannot add events to that calendar');
        const calOwner = (await get<{ owner_id: string }>(db, 'SELECT owner_id FROM calendars WHERE id = ?', e.calendarId))!.owner_id;
        const cur = await getEvent(db, e.id);
        if (cur) {
          if (!canEditCalendar(await calendarAccess(db, userId, cur.calendarId))) throw new HttpError(403, 'You cannot change this event');
          if (cur.ownerId !== calOwner) throw new HttpError(400, 'Events cannot be moved between people');
          if (cur.version !== e.version) throw new HttpError(409, `“${cur.title}” changed elsewhere. Reload to see the latest.`);
        }
        if (e.taskId) {
          const t = await getTask(db, e.taskId);
          if (!t || t.ownerId !== calOwner) throw new HttpError(400, 'Linked task not found');
        }
        await writeEvent(db, calOwner, { ...(e as CalEvent), ownerId: calOwner }, !cur);
        owners.add(calOwner);
        out.push((await getEvent(db, e.id))!);
      }
      return out;
    });
    await replan(db, ...owners);
    return { events: saved };
  }));

  // Tasks
  app.put('/api/tasks/:id', h(async (req) => {
    const userId = requireUser(req);
    const t = parse(taskSchema, { ...req.body, id: req.params.id });
    if (!(await listTaskLists(db, userId)).some((l) => l.id === t.listId)) throw new HttpError(400, 'Unknown task list');
    if (t.goalId && !(await listGoals(db, userId)).some((g) => g.id === t.goalId)) throw new HttpError(400, 'Unknown goal');
    const saved = await tx(db, async (db) => {
      const cur = await getTask(db, t.id);
      if (cur && cur.ownerId !== userId) throw new HttpError(404, 'Task not found');
      if (cur && cur.version !== t.version) throw new HttpError(409, `“${cur.title}” changed elsewhere. Reload to see the latest.`);
      return await writeTask(db, userId, { ...t, ownerId: userId, updatedAt: nowIso() } as never, !cur);
    });
    await replan(db, userId);
    return { task: saved, tasks: await listTasks(db, userId), checkIns: await listCheckIns(db, userId) };
  }));

  app.delete('/api/tasks/:id', h(async (req) => {
    const userId = requireUser(req);
    await run(db, 'DELETE FROM tasks WHERE id = ? AND owner_id = ?', req.params.id, userId);
    await replan(db, userId);
  }));

  app.post('/api/task-lists', h(async (req) => {
    const userId = requireUser(req);
    const b = parse(z.object({ id: z.string().min(1).max(64), name: z.string().trim().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }), req.body);
    await run(db, 'INSERT INTO task_lists (id, owner_id, name, color, created_at) VALUES (?,?,?,?,?)', b.id, userId, b.name, b.color, nowIso());
    return await listTaskLists(db, userId);
  }));

  // Notes (autosaved from the client; version check prevents silent overwrites)
  app.put('/api/notes/:id', h(async (req) => {
    const userId = requireUser(req);
    const n = parse(noteSchema, { ...req.body, id: req.params.id });
    return await tx(db, async (db) => {
      const cur = await get<{ owner_id: string; version: number }>(db, 'SELECT owner_id, version FROM notes WHERE id = ?', n.id);
      if (cur && cur.owner_id !== userId) throw new HttpError(404, 'Note not found');
      if (cur && cur.version !== n.version) throw new HttpError(409, 'This note changed on another device. Your text is kept locally; reload to merge.');
      if (cur) {
        await run(db, 'UPDATE notes SET title=?, body=?, version=version+1, updated_at=? WHERE id=?', n.title, n.body, nowIso(), n.id);
      } else {
        const existing = n.scope !== 'loose' ? await get(db, 'SELECT 1 AS x FROM notes WHERE owner_id=? AND scope=? AND key=?', userId, n.scope, n.key) : null;
        if (existing) throw new HttpError(409, 'A note for this date already exists on another device. Reload to merge.');
        await run(db, 'INSERT INTO notes (id, owner_id, scope, key, title, body, version, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)', n.id, userId, n.scope, n.key, n.title, n.body, nowIso(), nowIso());
      }
      return (await listNotes(db, userId)).find((x) => x.id === n.id);
    });
  }));

  app.delete('/api/notes/:id', h(async (req) => {
    const userId = requireUser(req);
    await run(db, 'DELETE FROM notes WHERE id = ? AND owner_id = ?', req.params.id, userId);
  }));

  // Goals & check-ins
  app.put('/api/goals/:id', h(async (req) => {
    const userId = requireUser(req);
    const g = parse(goalSchema, { ...req.body, id: req.params.id });
    const cur = await get<{ owner_id: string; version: number }>(db, 'SELECT owner_id, version FROM goals WHERE id = ?', g.id);
    if (cur && cur.owner_id !== userId) throw new HttpError(404, 'Goal not found');
    if (cur) {
      if (cur.version !== g.version) throw new HttpError(409, 'This goal changed elsewhere. Reload and try again.');
      await run(db, 'UPDATE goals SET title=?, color=?, mode=?, weekly_target=?, rest_days=?, unit=?, archived=?, version=version+1 WHERE id=?', g.title, g.color, g.mode, g.weeklyTarget, JSON.stringify(g.restDays), g.unit, g.archived ? 1 : 0, g.id);
    } else {
      await run(db, 'INSERT INTO goals (id, owner_id, title, color, mode, weekly_target, rest_days, unit, archived, version, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)', g.id, userId, g.title, g.color, g.mode, g.weeklyTarget, JSON.stringify(g.restDays), g.unit, g.archived ? 1 : 0, nowIso());
    }
    return (await listGoals(db, userId)).find((x) => x.id === g.id);
  }));

  app.delete('/api/goals/:id', h(async (req) => {
    const userId = requireUser(req);
    await run(db, 'DELETE FROM goals WHERE id = ? AND owner_id = ?', req.params.id, userId);
  }));

  app.post('/api/check-ins', h(async (req) => {
    const userId = requireUser(req);
    const c = parse(checkInSchema, req.body);
    if (!(await listGoals(db, userId)).some((g) => g.id === c.goalId)) throw new HttpError(404, 'Goal not found');
    // Idempotent: the same clientKey (e.g. a double-click or retry) never creates a second check-in.
    await run(db, 'INSERT INTO check_ins (id, goal_id, owner_id, date, quantity, reflection, client_key, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(goal_id, client_key) DO UPDATE SET date=excluded.date, quantity=excluded.quantity, reflection=excluded.reflection', c.id, c.goalId, userId, c.date, c.quantity, c.reflection, c.clientKey, nowIso());
    return await listCheckIns(db, userId);
  }));

  app.delete('/api/check-ins/:id', h(async (req) => {
    const userId = requireUser(req);
    await run(db, 'DELETE FROM check_ins WHERE id = ? AND owner_id = ?', req.params.id, userId);
    return await listCheckIns(db, userId);
  }));

  // ---------------- Notifications ----------------

  app.get('/api/notifications', h(async (req) => {
    const userId = requireUser(req);
    // While the app is open its polling also delivers due reminders, so in-app cues stay timely
    // even when the cron schedule is coarse (e.g. Vercel Hobby).
    if (Date.now() - lastOpportunisticTick > 20_000) {
      lastOpportunisticTick = Date.now();
      await tick(db).catch((e) => console.error('[tick]', (e as Error).message));
    }
    const items = await all(db, 'SELECT id, title, body, url, created_at AS "createdAt", read_at AS "readAt", job_id AS "jobId" FROM inapp_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', userId);
    const upcoming = (await all<{ id: string; kind: string; fire_at: string; payload: string }>(db, "SELECT id, kind, fire_at, payload FROM notification_jobs WHERE user_id = ? AND status = 'pending' ORDER BY fire_at LIMIT 50", userId))
      .map((j) => ({ id: j.id, kind: j.kind, fireAt: j.fire_at, ...JSON.parse(j.payload) }));
    const subs = await all<{ id: string; label: string; created_at: string; last_success_at: string | null; last_error: string | null }>(db, 'SELECT id, label, created_at, last_success_at, last_error FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC', userId);
    const recentDeliveries = await all(db, `SELECT d.status, d.error, d.updated_at AS "updatedAt", j.kind FROM notification_deliveries d JOIN notification_jobs j ON j.id = d.job_id
      WHERE j.user_id = ? ORDER BY d.updated_at DESC LIMIT 10`, userId);
    return { items, upcoming, subscriptions: subs, recentDeliveries, pushConfigured: pushConfigured() };
  }));

  app.post('/api/notifications/read', h(async (req) => {
    const userId = requireUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(200) }), req.body);
    for (const id of ids) await run(db, 'UPDATE inapp_notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', nowIso(), id, userId);
  }));

  app.post('/api/notifications/:id/snooze', h(async (req) => {
    const userId = requireUser(req);
    const n = await get<{ title: string; body: string; url: string; job_id: string }>(db, 'SELECT title, body, url, job_id FROM inapp_notifications WHERE id = ? AND user_id = ?', req.params.id, userId);
    if (!n) throw new HttpError(404, 'Notification not found');
    const job = await get<{ source_type: string | null; source_id: string | null }>(db, 'SELECT source_type, source_id FROM notification_jobs WHERE id = ?', n.job_id);
    const minutes = (await getPrefs(db, userId)).snoozeMinutes;
    const at = new Date(Date.now() + minutes * 60_000);
    await enqueueImmediate(db, userId, 'snooze', { title: n.title, body: `Snoozed · ${n.body}`, url: n.url }, at, { type: job?.source_type ?? null, id: job?.source_id ?? null });
    await run(db, 'UPDATE inapp_notifications SET read_at = ? WHERE id = ?', nowIso(), req.params.id);
    return { snoozedUntil: at.toISOString() };
  }));

  app.post('/api/notifications/test', h(async (req) => {
    const userId = requireUser(req);
    await enqueueImmediate(db, userId, 'test', { title: 'Test reminder', body: 'If you can see this, reminders reach this device.', url: '/' }, new Date());
    return { queued: true };
  }));

  app.get('/api/notification-prefs', h(async (req) => await getPrefs(db, requireUser(req))));
  app.put('/api/notification-prefs', h(async (req) => {
    const userId = requireUser(req);
    const prefs = parse(prefsSchema, req.body);
    await setPrefs(db, userId, prefs);
    await replan(db, userId);
    return prefs;
  }));

  const subSchema = z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
    label: z.string().max(100).default(''),
  });

  app.post('/api/push/subscribe', h(async (req) => {
    const userId = requireUser(req);
    const s = parse(subSchema, req.body);
    // An endpoint belongs to exactly one user; re-subscribing moves it and refreshes keys.
    await run(db, `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, label, created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, created_at = excluded.created_at, last_error = NULL`,
      uid(), userId, s.endpoint, s.keys.p256dh, s.keys.auth, s.label, nowIso());
  }));

  app.post('/api/push/unsubscribe', h(async (req) => {
    const userId = requireUser(req);
    const { endpoint, id } = parse(z.object({ endpoint: z.string().optional(), id: z.string().optional() }), req.body);
    if (endpoint) await run(db, 'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', endpoint, userId);
    if (id) await run(db, 'DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?', id, userId);
  }));

  // ---------------- Planning ----------------

  app.post('/api/plan/preview', h(async (req) => {
    const userId = requireUser(req);
    const plan = parse(planSchema, req.body.plan);
    const compiled = await compilePlan(db, userId, plan);
    return { summary: plan.summary ?? '', questions: plan.questions ?? [], items: compiled.items };
  }));

  app.post('/api/plan/apply', h(async (req) => {
    const userId = requireUser(req);
    const plan = parse(planSchema, req.body.plan);
    const source = req.body.source === 'assistant' ? 'assistant' : 'import';
    const out = await applyChanges(db, userId, plan, source);
    await replan(db, userId, ...out.owners);
    return { proposalId: out.proposalId, items: out.items };
  }));

  app.post('/api/plan/:id/undo', h(async (req) => {
    const userId = requireUser(req);
    const out = await undoPlan(db, userId, String(req.params.id));
    await replan(db, userId, ...out.owners);
    return { conflicts: out.conflicts };
  }));

  app.post('/api/plan/draft', h(async (req) => {
    const userId = requireUser(req);
    if (!assistantConfigured()) throw new HttpError(501, 'The in-app assistant is not configured on this server (ANTHROPIC_API_KEY is not set). You can still import a JSON plan.');
    const body = parse(z.object({
      message: z.string().min(1).max(4000),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20000) })).max(20).default([]),
    }), req.body);
    try {
      return await draftPlan(db, userId, body.message, body.history);
    } catch (e) {
      throw new HttpError(502, (e as Error).message);
    }
  }));

  // ---------------- Errors & static ----------------

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  const dist = join(process.cwd(), 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    console.error(err);
    const msg = (err as Error)?.message ?? '';
    // Configuration problems are safe and useful to show; other errors stay generic.
    if (/DATABASE_URL/.test(msg)) {
      res.status(503).json({ error: msg });
      return;
    }
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}
